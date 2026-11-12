/**
 * 청소 알림 발송 공통 로직.
 * Vercel 함수 수에 포함되지 않도록 server/ 아래에 둔다.
 */

import { notify } from "./_notify.js";
import { isCheckoutCancelled } from "./_reservationSync.js";
import { createNotif, prepareInitialDelivery, maySendInitialDelivery,
  recordInitialResult, projectAcceptedDelivery, findInitialDelivery, getInitialRecoveryJobs } from './_initialDelivery.js';
export { createNotif, getVipFollowupJobs } from './_initialDelivery.js';

const BASE_URL =
  process.env.PROPOS_BASE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : null) ||
  "https://www.proposonline.com";

// ── 토큰 생성 ──────────────────────────────────────────────

// sendSms, toE164 → _sms.js 로 이동 (re-export for backwards compat)
export { sendSms, toE164 } from "./_sms.js";

// RF-16: 그날 퇴실이 없어져 요청을 보내지 않음 — 다른 "보내지 않음" 결과와 같은 모양(호출부 변경 없음)
const RESERVATION_CANCELLED = Object.freeze({ ok: false, state: 'CANCELLED', errorCode: 'RESERVATION_CANCELLED' });

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

// Slack → _slack.js 로 이동 (re-export for backwards compat)
export { postSlack } from "./_slack.js";

// ── 핵심 dispatch 함수들 ────────────────────────────────────

/**
 * job 현재 상태에서 다음 VIP/BULK 단계로 전환하고 발송.
 * @param {object} [opts.deleteBlocker] - PENDING → 첫 알림 전 블로커 삭제 콜백 (async fn(job))
 */
export async function advanceJob(db, job, { deleteBlocker } = {}) {
  // 시뮬레이션 일정은 실제 청소자·SMS·FCM·Slack·Google 캘린더를 절대 건드리지 않는다.
  // 데이터 구조와 상태는 동일하게 유지하되 외부 부작용만 차단한다.
  if (job?.data_origin === "SIMULATED") {
    return { simulated: true, skippedExternalSideEffects: true };
  }
  const nextStatus = {
    PENDING:           "NOTIFYING_VIP_1",
    NOTIFYING_VIP_1:  "NOTIFYING_VIP_2",
    NOTIFYING_VIP_2:  "NOTIFYING_VIP_3",
    NOTIFYING_VIP_3:  "NOTIFYING_BULK",
  }[job.status];

  if (!nextStatus) return; // NOTIFYING_BULK 이후는 followup 크론이 처리

  const propCfg = await getPropertyConfig(db, job.property_id);
  if (propCfg?.data_origin === 'SIMULATED') return { ok: false, state: 'CANCELLED', errorCode: 'DELIVERY_NOT_REAL' };
  const propertyName = propCfg?.name ?? job.property_id;

  // RF-16: 그날 퇴실이 없어졌으면(예약 취소·같은 예약의 날짜 변경) 이번엔 요청을 보내지 않는다. 작업·요청 기록은 그대로 둔다 —
  // 운영자 알림은 동기화가, 취소·연락은 운영자가 정하고, 예약이 다시 나타나면 다음 실행에서 이어서 진행한다.
  if (nextStatus === "NOTIFYING_BULK") {
    if (await isCheckoutCancelled(db, job)) return RESERVATION_CANCELLED;
    return dispatchBulk(db, job, propertyName, propCfg);
  }

  const tier = nextStatus.replace("NOTIFYING_", ""); // VIP_1 | VIP_2 | VIP_3
  const savedRequest = await findInitialDelivery(db, job);
  // 이미 접수된 요청(ACCEPTED)의 상태 반영은 보내는 일이 아니라서 그대로 한다
  if (savedRequest?.initial_delivery_state !== 'ACCEPTED' && await isCheckoutCancelled(db, job)) return RESERVATION_CANCELLED;
  const cleaner = savedRequest?.initial_delivery_data.cleaner ?? await getAvailableVip(db, job, tier);

  if (!cleaner) {
    // 해당 VIP 없거나 이미 다른 job으로 바쁨 → 다음 단계로 재귀
    const updated = await db.query(
      `UPDATE cleaning_jobs SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3
       AND checkout_at=$4 AND cleaning_start_at=$5 AND property_id=$6
       AND data_origin='REAL' AND EXISTS (SELECT 1 FROM property_cleaning_config p
         WHERE p.property_id=cleaning_jobs.property_id AND p.data_origin='REAL') RETURNING id`,
      [nextStatus, job.id, job.status, job.checkout_at, job.cleaning_start_at, job.property_id]
    );
    if (!updated.rows.length) return { ok: false, state: 'CANCELLED', errorCode: 'JOB_STATE_CHANGED' };
    if (job.status === 'PENDING' && typeof deleteBlocker === 'function') {
      await deleteBlocker(job).catch(e => console.error('[dispatch] 블로커 삭제 실패:', e.code ?? e.name));
    }
    return advanceJob(db, { ...job, status: nextStatus }, { deleteBlocker });
  }

  const notif = await prepareInitialDelivery(db, { job, cleaner, nextStatus, payload: (n, current) => ({
    title: "[PROPOS] 청소 요청",
    body: `${current.property_name ?? current.property_id} ${fmtDate(current.cleaning_start_at)}`,
    data: { jobId: String(current.id), token: n.token,
      calendarUrl: current.booking_url ?? `${BASE_URL}/c/${current.property_id}`, hostPhone: current.host_phone ?? "" },
    smsText: buildSmsVip(current, current.property_name ?? current.property_id, n.token),
  }) });
  if (notif.state === 'ACCEPTED') return projectAcceptedDelivery(db, notif);
  if (notif.state !== 'CLAIMED') return notif;
  const saved = notif.initial_delivery_data;
  if (job.status === 'PENDING' && typeof deleteBlocker === 'function') {
    await deleteBlocker({ ...job, property_id: saved.propertyId, checkout_at: saved.checkoutAt,
      cleaning_start_at: saved.cleaningStartAt }).catch(e => console.error('[dispatch] 블로커 삭제 실패:', e.code ?? e.name));
  }
  if (!await maySendInitialDelivery(db, notif)) {
    return recordInitialResult(db, notif, { outcome: 'CANCELLED', channel: 'NONE', errorCode: 'JOB_OR_RECIPIENT_CHANGED' });
  }
  let result;
  try { result = await notify(db, saved.cleaner, { ...saved.payload, deliveryId: notif.id, deliveryFallbackCode: saved.result?.fcmFailureCode }); }
  catch { result = { ok: false, outcome: 'UNKNOWN', channel: 'NONE', errorCode: 'DELIVERY_OUTCOME_UNKNOWN' }; }
  const receipt = await recordInitialResult(db, notif, result);
  return receipt.state === 'ACCEPTED' ? projectAcceptedDelivery(db, receipt) : receipt;
}

export async function recoverInitialDeliveries(db) {
  const { rows } = await getInitialRecoveryJobs(db);
  let recovered = 0;
  for (const job of rows) {
    try { const result = await advanceJob(db, job); if (result?.ok && result.jobAdvanced) recovered++; }
    catch (error) { console.error('[dispatch] 최초 요청 복구 실패:', error.code ?? error.name); }
  }
  return recovered;
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
      const notif = await createNotif(db, { jobId: job.id, cleanerId: cleaner.id, tier: "BULK", dataOrigin: job.data_origin });
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

  const updated = await db.query(
    `UPDATE cleaning_jobs SET status='NOTIFYING_BULK', updated_at=NOW() WHERE id=$1 AND status=$2
      AND checkout_at=$3 AND cleaning_start_at=$4 AND property_id=$5
      AND data_origin='REAL' AND EXISTS (SELECT 1 FROM property_cleaning_config p
        WHERE p.property_id=cleaning_jobs.property_id AND p.data_origin='REAL') RETURNING id`,
    [job.id, job.status, job.checkout_at, job.cleaning_start_at, job.property_id]
  );
  return updated.rows.length ? { ok: true } : { ok: false, state: 'CANCELLED', errorCode: 'JOB_STATE_CHANGED' };
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
  if (job[0].data_origin === "SIMULATED") return;

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

/**
 * Date/ISO timestamp를 한국 표준시 기준 달력 날짜(YYYY-MM-DD)로 변환한다.
 * 청소 일정은 시각이 아니라 숙소의 체크아웃 달력 날짜를 기준으로 계산한다.
 * 잘못된 입력은 빈 문자열로 반환해 Invalid Date가 후속 로직으로 전파되지 않게 한다.
 */
export function toKstDateKey(raw) {
  if (raw == null) return '';
  const date = raw instanceof Date ? raw : new Date(raw);
  if (!Number.isFinite(date.getTime())) return '';

  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
}

export function calcCleaningTimes(checkoutDateStr, checkOutHour, durationHours) {
  const pad = (n) => String(n).padStart(2, "0");
  const startIso = `${checkoutDateStr}T${pad(checkOutHour)}:00:00+09:00`;
  const startMs = new Date(startIso).getTime();
  const endMs = startMs + durationHours * 3_600_000;
  return { cleaning_start_at: new Date(startMs), cleaning_end_at: new Date(endMs) };
}

// 청소 시작까지 이만큼 이하로 남았으면 바로 요청한다(SHORT_NOTICE)
export const SHORT_NOTICE_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * 새 청소 작업의 출처와 첫 요청 시각 — 작업을 만드는 곳(iCal 동기화·월간 배치·관리자 일괄 등록·백필 스크립트)이 같은 규칙을 쓴다
 * (docs/cleaning-scenario-matrix.md S01·S03·S04: 2주 이내 신규 예약은 바로, 그 밖은 청소 2주 전).
 * 청소 시작이 SHORT_NOTICE_DAYS 일 안이면 지금, 그보다 멀면 시작 SHORT_NOTICE_DAYS 일 전.
 * 발송 시각을 저장하지 않으면 DB 기본값(지금)이 들어가 다음 크론이 몇 달 뒤 청소 요청을 바로 보낸다
 * (2026-10-12 백필에서 실제로 발생 — 12월·내년 9월 퇴실 요청이 그날 밤 나가 아무도 받지 않고 "배정 실패"가 됨, RF-17).
 * 월간 배치(매월 15일)도 다음 달 일정의 요청 시각을 이 규칙(+같은 날 여러 건은 10분 간격)으로 잡는다 — 예전엔 "지금"으로 덮어써
 * 다음 달 요청이 15일에 한꺼번에 나갔다(RF-19).
 * 이미 지난 시작은 "지금"을 돌려주지만, 크론은 시작이 지난 작업을 발송하지 않는다.
 */
export function planJobDispatch(cleaningStartAt, now = Date.now()) {
  const startMs = new Date(cleaningStartAt).getTime();
  const nowMs = new Date(now).getTime();
  if ((startMs - nowMs) / DAY_MS <= SHORT_NOTICE_DAYS) return { source: 'SHORT_NOTICE', dispatchAfter: new Date(nowMs) };
  return { source: 'MONTHLY_BATCH', dispatchAfter: new Date(startMs - SHORT_NOTICE_DAYS * DAY_MS) };
}
