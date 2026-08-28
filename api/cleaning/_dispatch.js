/**
 * 청소 알림 발송 공통 로직.
 * Vercel 라우팅에서 제외되는 _ 접두사 파일.
 */

import { notify } from "./_notify.js";

const SLACK_WEBHOOK = process.env.PROPOS_SLACK_WEBHOOK;
const BASE_URL =
  process.env.PROPOS_BASE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : null) ||
  "https://www.proposonline.com";

// ── 토큰 생성 ──────────────────────────────────────────────

const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomToken() {
  let t = "";
  for (let i = 0; i < 6; i++) t += TOKEN_CHARS[Math.floor(Math.random() * 36)];
  return t;
}

export async function createNotif(db, { jobId, cleanerId, tier }) {
  // 이미 존재하면 기존 레코드 반환 (멱등성 보장, 동시 호출 방어)
  const { rows: existing } = await db.query(
    `SELECT id, token FROM cleaning_notifs WHERE job_id=$1 AND cleaner_id=$2`,
    [jobId, cleanerId]
  );
  if (existing.length) return existing[0];

  // token UNIQUE 충돌만 재시도 (최대 5회)
  for (let i = 0; i < 5; i++) {
    const token = randomToken();
    try {
      const { rows } = await db.query(
        `INSERT INTO cleaning_notifs (job_id, cleaner_id, tier, token)
         VALUES ($1, $2, $3, $4)
         RETURNING id, token`,
        [jobId, cleanerId, tier, token]
      );
      return rows[0];
    } catch (e) {
      if (e.code !== "23505") throw e;
    }
  }
  throw new Error(`토큰 생성 실패 (job=${jobId}, cleaner=${cleanerId})`);
}

// sendSms, toE164 → _sms.js 로 이동 (re-export for backwards compat)
export { sendSms, toE164 } from "./_sms.js";

// ── SMS 메시지 빌더 ───────────────────────────────────────

function fmtDate(ts) {
  const d = new Date(ts);
  const kst = new Date(d.getTime() + 9 * 3600_000);
  return `${kst.toISOString().slice(0, 10)} ${String(kst.getUTCHours()).padStart(2, "0")}:00`;
}

export function buildSmsVip(job, propertyName, token) {
  const dt = fmtDate(job.cleaning_start_at);
  return (
    `[PROPOS] 청소 요청 드립니다\n` +
    `📍 ${propertyName}\n` +
    `🕐 ${dt}\n` +
    `수락(예약): ${BASE_URL}/c/${job.property_id}\n` +
    `거절: ${BASE_URL}/d/${token}\n` +
    `1시간 내 응답 부탁드립니다`
  );
}

export function buildSmsBulk(job, propertyName, token) {
  const dt = fmtDate(job.cleaning_start_at);
  return (
    `[PROPOS] 청소 아르바이트 안내\n` +
    `📍 ${propertyName}\n` +
    `🕐 ${dt}\n` +
    `선착순 예약: ${BASE_URL}/c/${job.property_id}\n` +
    `불가 시: ${BASE_URL}/d/${token}`
  );
}

export function buildSmsRemind(job, propertyName, token) {
  const date = new Date(job.cleaning_start_at).toISOString().slice(0, 10);
  return (
    `[PROPOS] 재안내 드립니다\n` +
    `${propertyName} ${date} 청소 아직 미확정입니다\n` +
    `예약: ${BASE_URL}/c/${job.property_id}\n` +
    `거절: ${BASE_URL}/d/${token}`
  );
}

export function buildSmsComplete(propertyName, date) {
  return `[PROPOS] ${propertyName} ${date} 청소가 배정 완료됐습니다. 감사합니다.`;
}

// ── Slack ──────────────────────────────────────────────────

export async function postSlack(text) {
  if (!SLACK_WEBHOOK) return;
  await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch((e) => console.error("Slack 발송 실패:", e.message));
}

// ── 핵심 dispatch 함수들 ────────────────────────────────────

/** job 현재 상태에서 다음 VIP/BULK 단계로 전환하고 발송 */
export async function advanceJob(db, job) {
  const nextStatus = {
    PENDING:           "NOTIFYING_VIP_1",
    NOTIFYING_VIP_1:  "NOTIFYING_VIP_2",
    NOTIFYING_VIP_2:  "NOTIFYING_VIP_3",
    NOTIFYING_VIP_3:  "NOTIFYING_BULK",
  }[job.status];

  if (!nextStatus) return; // NOTIFYING_BULK 이후는 followup 크론이 처리

  const propCfg = await getPropertyConfig(db, job.property_id);
  const propertyName = propCfg?.name ?? job.property_id;

  if (nextStatus === "NOTIFYING_BULK") {
    return dispatchBulk(db, job, propertyName, propCfg);
  }

  const tier = nextStatus.replace("NOTIFYING_", ""); // VIP_1 | VIP_2 | VIP_3
  const cleaner = await getAvailableVip(db, job, tier);

  if (!cleaner) {
    // 해당 VIP 없거나 이미 다른 job으로 바쁨 → 다음 단계로 재귀
    await db.query(
      `UPDATE cleaning_jobs SET status=$1, updated_at=NOW() WHERE id=$2`,
      [nextStatus, job.id]
    );
    return advanceJob(db, { ...job, status: nextStatus });
  }

  const notif = await createNotif(db, { jobId: job.id, cleanerId: cleaner.id, tier });
  const calendarUrl = propCfg?.google_calendar_booking_url ?? `${BASE_URL}/c/${job.property_id}`;
  const dt = fmtDate(job.cleaning_start_at);
  await notify(db, cleaner, {
    title: "[PROPOS] 청소 요청",
    body: `${propertyName} ${dt}`,
    data: { jobId: String(job.id), token: notif.token, calendarUrl, hostPhone: propCfg?.host_phone ?? "" },
    smsText: buildSmsVip(job, propertyName, notif.token),
    notifId: notif.id,
  });

  await db.query(
    `UPDATE cleaning_jobs SET status=$1, updated_at=NOW() WHERE id=$2`,
    [nextStatus, job.id]
  );
}

/** 중복 발송 방지: 해당 날짜에 이미 해당 VIP가 다른 job의 NOTIFYING 상태인지 */
async function getAvailableVip(db, job, tier) {
  const { rows: [cleaner] } = await db.query(
    `SELECT * FROM cleaners WHERE tier=$1 AND active=true AND (fcm_token IS NOT NULL OR phone IS NOT NULL) ORDER BY created_at ASC LIMIT 1`,
    [tier]
  );
  if (!cleaner) return null;

  const checkoutDate = new Date(job.checkout_at).toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT 1 FROM cleaning_jobs j
     JOIN cleaning_notifs n ON n.job_id = j.id
     WHERE n.cleaner_id = $1
       AND j.checkout_at::date = $2
       AND j.status NOT IN ('ASSIGNED','COMPLETED','ESCALATED','CANCELLED')
       AND j.id != $3
     LIMIT 1`,
    [cleaner.id, checkoutDate, job.id]
  );
  return rows.length ? null : cleaner;
}

async function dispatchBulk(db, job, propertyName, propCfg) {
  const checkoutDate = new Date(job.checkout_at).toISOString().slice(0, 10);
  const calendarUrl = propCfg?.google_calendar_booking_url ?? `${BASE_URL}/c/${job.property_id}`;
  const dt = fmtDate(job.cleaning_start_at);

  // BULK 대상: active + (FCM 또는 SMS 가능) + 같은 날 다른 job에 NOTIFYING 중이지 않은 청소자
  const { rows: cleaners } = await db.query(
    `SELECT c.* FROM cleaners c
     WHERE c.active = true
       AND c.tier = 'BULK'
       AND (c.fcm_token IS NOT NULL OR c.phone IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM cleaning_notifs n2
         JOIN cleaning_jobs j2 ON j2.id = n2.job_id
         WHERE n2.cleaner_id = c.id
           AND j2.checkout_at::date = $1
           AND j2.status NOT IN ('ASSIGNED','COMPLETED','ESCALATED','CANCELLED')
           AND j2.id != $2
       )`,
    [checkoutDate, job.id]
  );

  for (const cleaner of cleaners) {
    try {
      const notif = await createNotif(db, { jobId: job.id, cleanerId: cleaner.id, tier: "BULK" });
      await notify(db, cleaner, {
        title: "[PROPOS] 청소 아르바이트 안내",
        body: `${propertyName} ${dt} 선착순`,
        data: { jobId: String(job.id), token: notif.token, calendarUrl, hostPhone: propCfg?.host_phone ?? "" },
        smsText: buildSmsBulk(job, propertyName, notif.token),
        notifId: notif.id,
      });
    } catch (e) {
      console.error(`BULK 발송 실패 (${cleaner.id}):`, e.message);
    }
  }

  await db.query(
    `UPDATE cleaning_jobs SET status='NOTIFYING_BULK', updated_at=NOW() WHERE id=$1`,
    [job.id]
  );
}

/** 배정 완료 시 나머지 청소자들에게 완료 알림 발송 (FCM + SMS 듀얼 모드) */
export async function sendCompletionSmsToRest(db, jobId, assignedCleanerId) {
  const { rows: job } = await db.query(
    `SELECT j.*, p.name AS prop_name
     FROM cleaning_jobs j
     LEFT JOIN property_cleaning_config p ON p.property_id = j.property_id
     WHERE j.id = $1`,
    [jobId]
  );
  if (!job.length) return;

  const propertyName = job[0].prop_name ?? job[0].property_id;
  const date = new Date(job[0].cleaning_start_at).toISOString().slice(0, 10);
  const smsText = buildSmsComplete(propertyName, date);

  const { rows: notifs } = await db.query(
    `SELECT n.*, c.phone, c.fcm_token, c.fcm_status FROM cleaning_notifs n
     JOIN cleaners c ON c.id = n.cleaner_id
     WHERE n.job_id = $1 AND n.cleaner_id != $2 AND n.response IS NULL`,
    [jobId, assignedCleanerId]
  );

  for (const n of notifs) {
    await notify(db, { id: n.cleaner_id, fcm_token: n.fcm_token, fcm_status: n.fcm_status, phone: n.phone }, {
      title: "[PROPOS] 청소 배정 완료",
      body: `${propertyName} ${date} 건이 배정됐습니다. 감사합니다.`,
      data: {},
      smsText,
    }).catch((e) => console.error(`완료 알림 실패 (${n.cleaner_id}):`, e.message));
  }
}

// ── 헬퍼 ──────────────────────────────────────────────────

export async function getPropertyConfig(db, propertyId) {
  const { rows } = await db.query(
    `SELECT * FROM property_cleaning_config WHERE property_id = $1`,
    [propertyId]
  );
  return rows[0] ?? null;
}

export function calcCleaningTimes(checkoutDateStr, checkOutHour, durationHours) {
  const pad = (n) => String(n).padStart(2, "0");
  const startIso = `${checkoutDateStr}T${pad(checkOutHour)}:00:00+09:00`;
  const startMs = new Date(startIso).getTime();
  const endMs = startMs + durationHours * 3_600_000;
  return { cleaning_start_at: new Date(startMs), cleaning_end_at: new Date(endMs) };
}
