/**
 * ACT-18 (DEC-13) — 담당자 청소 "하루 전" 알림.
 * 밤 정기 작업(KST 22:00)이 다음 날(한국 날짜)에 배정된 실제 청소를 담당자에게 알린다. 시작 시각(9시든 11시든)과 무관하게
 * 같은 규칙이고, 같은 청소·같은 담당자에게 한 번만 보낸다. 보내지 못하거나 담당자가 활동 중지면 운영자에게 직접 연락하라고 알린다(DEC-11).
 */
import { notify as defaultNotify } from "./_notify.js";
import { postSlack as defaultPostSlack, toKstDateKey } from "./_dispatch.js";
import { isCheckoutCancelled as defaultIsCheckoutCancelled } from "./_reservationSync.js";

const DAY_MS = 86_400_000;
const ONCE_TTL_SECONDS = 3 * 24 * 3600;

function kstTime(ts) {
  const kst = new Date(new Date(ts).getTime() + 9 * 3_600_000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

/** now의 한국 날짜 기준 "내일" 0시부터 하루 */
export function tomorrowKstRange(now) {
  const date = toKstDateKey(new Date(now.getTime() + DAY_MS));
  const from = new Date(`${date}T00:00:00+09:00`);
  return { date, from, to: new Date(from.getTime() + DAY_MS) };
}

export function dayBeforeMessage(propertyName, cleaningStartAt) {
  const time = kstTime(cleaningStartAt);
  return {
    title: "[PROPOS] 내일 청소 안내",
    body: `${propertyName} 내일 ${time} 청소가 있습니다`,
    data: {},
    smsText: `[PROPOS] 내일(${toKstDateKey(cleaningStartAt)}) ${time} ${propertyName} 청소가 있습니다.`,
  };
}

// 한 번만 — 보낸 뒤에 표시한다(표시 먼저면 도중에 끊긴 실행이 "보냄"만 남긴다). 표시를 읽거나 쓰지 못하면(KV 장애)
// 빠뜨리는 것보다 한 번 더 받는 쪽이 낫다고 보고 보낸다
const onceKey = job => `cleaning_day_before:${job.id}:${job.cleaner_id}`;
async function alreadySent(kv, job) {
  try { return (await kv.get(onceKey(job))) != null; }
  catch (e) { console.error(`[day-before] 보냄 표시 읽기 실패 — 보낸다 (${job.id}):`, e.message); return false; }
}
async function markSent(kv, job) {
  try { await kv.set(onceKey(job), "1", { ex: ONCE_TTL_SECONDS }); }
  catch (e) { console.error(`[day-before] 보냄 표시 실패 (${job.id}):`, e.message); }
}

/** @returns {Promise<number>} 보낸 알림 수 */
export async function remindTomorrowCleanings(db, {
  kv, now = new Date(),
  notify = defaultNotify, postSlack = defaultPostSlack, isCheckoutCancelled = defaultIsCheckoutCancelled,
} = {}) {
  const { from, to } = tomorrowKstRange(now);
  const { rows } = await db.query(
    `SELECT j.id, j.property_id, j.cleaning_start_at, j.checkout_at, j.reservation_uid,
            c.id AS cleaner_id, c.name AS cleaner_name, c.phone, c.fcm_token, c.fcm_status, c.active AS cleaner_active,
            p.name AS property_name
       FROM cleaning_jobs j
       JOIN cleaners c ON c.id = j.assigned_cleaner_id
       LEFT JOIN property_cleaning_config p ON p.property_id = j.property_id
      WHERE j.status = 'ASSIGNED' AND j.data_origin = 'REAL'
        AND j.cleaning_start_at >= $1::timestamptz AND j.cleaning_start_at < $2::timestamptz
      ORDER BY j.cleaning_start_at, j.id`,
    [from.toISOString(), to.toISOString()]
  );
  let sent = 0;
  for (const job of rows) {
    const name = job.property_name ?? job.property_id;
    try {
      if (await isCheckoutCancelled(db, job)) continue;
      if (await alreadySent(kv, job)) continue;
      // 활동 중지된 담당자에게는 보내지 않는다 — 내일 청소에 확실한 담당자가 없는 것이라 운영자에게 넘긴다
      if (job.cleaner_active === false) {
        console.error(`[day-before] 담당자가 활동 중지 (${job.id})`);
      } else {
        const cleaner = { id: job.cleaner_id, name: job.cleaner_name, phone: job.phone, fcm_token: job.fcm_token, fcm_status: job.fcm_status };
        const result = await notify(db, cleaner, dayBeforeMessage(name, job.cleaning_start_at));
        if (result?.ok) { sent++; await markSent(kv, job); continue; }
        console.error(`[day-before] 알림 실패 (${job.id}):`, result?.channel ?? "unknown");
      }
    } catch (e) {
      console.error(`[day-before] 처리 실패 (${job.id}):`, e.message);
    }
    // 보냈는지 확인되지 않으면 운영자에게 넘긴다
    await postSlack(`[PROPOS] ⚠️ ${name} ${toKstDateKey(job.cleaning_start_at)} ${kstTime(job.cleaning_start_at)} 청소 — 담당자에게 하루 전 알림을 보내지 못했어요. 직접 연락해 주세요.`)
      .catch(() => {});
  }
  return sent;
}
