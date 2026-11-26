/**
 * 청소 알림 발송 공통 로직.
 * Vercel 함수 수에 포함되지 않도록 server/ 아래에 둔다.
 */

import { notify, canReachInitially } from "./_notify.js";
import { postSlack as sendSlack } from "./_slack.js";
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

// RF-56(사용자 결정 c, 2026-11-26): 이 담당자에게 닿을 경로가 없어서 실패한 최초 요청 — 기다리지 않고 다음 담당자로 넘긴다.
// 앱 연결이 없거나(문자 설정 없음·번호 오류·채널 없음) 알림 서버가 토큰 폐기를 확정했는데 문자로도 못 보낸 경우다.
// 그 밖의 실패(재시도 한도·받는 사람 정보 변경 등)는 ACT-11대로 그 자리에 두고 운영자가 본다.
const UNREACHABLE_CODES = Object.freeze(['SMS_CONFIG_MISSING', 'SMS_INPUT_INVALID', 'DELIVERY_CHANNEL_UNAVAILABLE', 'UNREGISTERED', 'INVALID_ARGUMENT']);
const UNREACHABLE_SQL = UNREACHABLE_CODES.map(code => `'${code}'`).join(',');
function isUnreachableFailure(request) {
  if (!request) return false;
  const state = request.state ?? request.initial_delivery_state;
  const code = request.errorCode ?? request.initial_delivery_data?.result?.errorCode;
  return state === 'FAILED' && UNREACHABLE_CODES.includes(code);
}
const cleanerLabel = cleaner => cleaner?.name?.trim() || '이름 없음'; // 이름만 — 전화번호는 싣지 않는다(RF-57)
function addPassedOver(list, cleaner) {
  if (cleaner && !list.some(c => c.id === cleaner.id)) list.push(cleaner);
  return list;
}
// 운영자에게 한 번만 알린다 — 작업이 실제로 다음 담당자·다음 단계로 넘어간 뒤에 부른다. Slack이 실패해도 요청 흐름은 계속한다
async function alertPassedOver(propertyName, job, passedOver, { movedToNextTier }) {
  if (!passedOver.length) return;
  const names = passedOver.map(cleanerLabel).join(', ');
  const next = movedToNextTier
    ? '건너뛰었어요. 이 단계에 보낼 수 있는 담당자가 없어 다음 단계로 넘깁니다'
    : '건너뛰고 다음 담당자에게 보냈어요';
  await sendSlack(`[PROPOS] ⚠️ ${propertyName} ${fmtDate(job.cleaning_start_at)} 청소 요청 — ${names} 담당자는 앱 알림이 연결돼 있지 않아 ${next}. 앱 연결을 확인해 주세요.`)
    .catch(error => console.error('[dispatch] 건너뛴 담당자 Slack 실패:', error?.message ?? error));
}

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
  const date = toKstDateKey(job.cleaning_start_at);
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
export async function advanceJob(db, job, { deleteBlocker, passedOver = [] } = {}) {
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
  const passed = [...passedOver];
  let savedRequest = await findInitialDelivery(db, job);
  // RF-56: 닿을 경로가 없어 실패한 요청은 이어받지 않는다 — 그 담당자는 건너뛰고 같은 단계의 다음 담당자를 고른다
  if (isUnreachableFailure(savedRequest)) {
    addPassedOver(passed, savedRequest.initial_delivery_data.cleaner);
    savedRequest = null;
  }
  // 이미 접수된 요청(ACCEPTED)의 상태 반영은 보내는 일이 아니라서 그대로 한다
  if (savedRequest?.initial_delivery_state !== 'ACCEPTED' && await isCheckoutCancelled(db, job)) return RESERVATION_CANCELLED;
  let cleaner = savedRequest?.initial_delivery_data.cleaner;
  if (!cleaner) {
    const pick = await getAvailableVip(db, job, tier);
    cleaner = pick.cleaner;
    pick.passedOver.forEach(c => addPassedOver(passed, c));
  }

  if (!cleaner) {
    // 해당 VIP 없거나·닿을 수 없거나·이미 다른 job으로 바쁨 → 다음 단계로 재귀
    const updated = await db.query(
      `UPDATE cleaning_jobs SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3
       AND checkout_at=$4 AND cleaning_start_at=$5 AND property_id=$6
       AND data_origin='REAL' AND EXISTS (SELECT 1 FROM property_cleaning_config p
         WHERE p.property_id=cleaning_jobs.property_id AND p.data_origin='REAL') RETURNING id`,
      [nextStatus, job.id, job.status, job.checkout_at, job.cleaning_start_at, job.property_id]
    );
    if (!updated.rows.length) return { ok: false, state: 'CANCELLED', errorCode: 'JOB_STATE_CHANGED' };
    await alertPassedOver(propertyName, job, passed, { movedToNextTier: true });
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
  // 이 담당자에게 처음 보낼 때 한 번 — 이어받은 요청의 재시도에는 건너뛴 사람이 없다
  await alertPassedOver(propertyName, job, passed, { movedToNextTier: false });
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
  if (receipt.state === 'ACCEPTED') return projectAcceptedDelivery(db, receipt);
  // RF-56: 보내 보니 닿지 않았다(토큰 폐기 확정 + 문자 경로 없음) — 같은 단계를 다시 골라 다음 담당자로. 이 담당자는 실패 기록 때문에 다시 뽑히지 않는다
  // 앞서 건너뛴 사람은 위에서 이미 알렸으니 이번에 닿지 않은 담당자만 넘긴다
  if (isUnreachableFailure(receipt)) return advanceJob(db, job, { deleteBlocker, passedOver: [saved.cleaner] });
  return receipt;
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

/**
 * 이 단계에서 요청을 보낼 담당자 하나 — 먼저 등록된 순서로, 닿을 수 없는 담당자는 건너뛴다(RF-56).
 * 이 작업에서 이미 "닿을 경로 없음"으로 실패한 담당자는 다시 고르지 않는다(같은 사람을 되풀이해 고르지 않게).
 * 중복 발송 방지: 고른 담당자가 같은 날 다른 job의 NOTIFYING 상태면 이 단계는 비운다(기존 규칙 그대로).
 * @returns {Promise<{ cleaner: object|null, passedOver: object[] }>} passedOver = 앞에서 건너뛴 닿을 수 없는 담당자
 */
async function getAvailableVip(db, job, tier) {
  const { rows: candidates } = await db.query(
    `SELECT * FROM cleaners WHERE tier=$1 AND active=true AND (fcm_token IS NOT NULL OR phone IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM cleaning_notifs n WHERE n.job_id=$2 AND n.cleaner_id=cleaners.id
         AND n.initial_delivery_state='FAILED' AND n.initial_delivery_data->'result'->>'errorCode' IN (${UNREACHABLE_SQL}))
     ORDER BY created_at ASC`,
    [tier, job.id]
  );
  const passedOver = [];
  const cleaner = candidates.find(c => canReachInitially(c) || (passedOver.push(c), false)) ?? null;
  if (!cleaner) return { cleaner: null, passedOver };

  // "같은 날"은 한국 날짜로 — 양쪽을 DB가 같은 규칙으로 계산한다(RF-51)
  const { rows } = await db.query(
    `SELECT 1 FROM cleaning_jobs j
     JOIN cleaning_notifs n ON n.job_id = j.id
     WHERE n.cleaner_id = $1
       AND to_char(j.checkout_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = to_char($2::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
       AND j.status NOT IN ('ASSIGNED','COMPLETED','ESCALATED','CANCELLED')
       AND j.id != $3
     LIMIT 1`,
    [cleaner.id, job.checkout_at, job.id]
  );
  return { cleaner: rows.length ? null : cleaner, passedOver };
}

async function dispatchBulk(db, job, propertyName, propCfg) {
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
           AND to_char(j2.checkout_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = to_char($1::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
           AND j2.status NOT IN ('ASSIGNED','COMPLETED','ESCALATED','CANCELLED')
           AND j2.id != $2
       )`,
    [job.checkout_at, job.id]
  );

  // RF-56: 닿을 수 없는 담당자(앱 연결 없음 + 문자 설정 없음)에게는 보내지 않고, 상태가 넘어간 뒤 운영자에게 한 번 알린다
  const reachable = cleaners.filter(c => canReachInitially(c));
  const unreachable = cleaners.filter(c => !canReachInitially(c));
  for (const cleaner of reachable) {
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

  // 받을 수 있는 사람이 한 명도 없으면 기다릴 응답이 없다 — 전원 거절과 같이 바로 배정 실패(수동배정 필요)로.
  // 단체 요청 기록이 없으면 3시간 뒤 실패로 넘기는 크론도 이 청소를 찾지 못해 "배정 요청중"에 계속 남는다
  const nobody = reachable.length === 0;
  const updated = await db.query(
    `UPDATE cleaning_jobs SET status=$6, updated_at=NOW() WHERE id=$1 AND status=$2
      AND checkout_at=$3 AND cleaning_start_at=$4 AND property_id=$5
      AND data_origin='REAL' AND EXISTS (SELECT 1 FROM property_cleaning_config p
        WHERE p.property_id=cleaning_jobs.property_id AND p.data_origin='REAL') RETURNING id`,
    [job.id, job.status, job.checkout_at, job.cleaning_start_at, job.property_id, nobody ? 'ESCALATED' : 'NOTIFYING_BULK']
  );
  if (!updated.rows.length) return { ok: false, state: 'CANCELLED', errorCode: 'JOB_STATE_CHANGED' };
  if (nobody && !unreachable.length) {
    await sendSlack(`[PROPOS] 🚨 ${propertyName} ${toKstDateKey(job.cleaning_start_at)} 청소 배정 실패. 수동 처리 필요.`)
      .catch(error => console.error('[dispatch] 배정 실패 Slack 실패:', error?.message ?? error));
  }
  if (unreachable.length) {
    const names = unreachable.map(cleanerLabel).join(', ');
    const message = reachable.length
      ? `[PROPOS] ⚠️ ${propertyName} ${dt} 단체 요청 — ${names} 담당자는 앱 알림이 연결돼 있지 않아 받지 못했어요. 앱 연결을 확인해 주세요.`
      : `[PROPOS] ⚠️ ${propertyName} ${dt} 청소 요청 — 앱 알림이 연결된 단체 담당자가 없어 아무에게도 보내지 못했어요(앱 연결 없음: ${names}). 직접 연락해 주세요.`;
    await sendSlack(message).catch(error => console.error('[dispatch] 단체 요청 Slack 실패:', error?.message ?? error));
  }
  return { ok: true };
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
  const date = toKstDateKey(job[0].cleaning_start_at); // 안내 날짜는 한국 날짜
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

// 청소 요청 시각 규칙 — 화면(절차 점검)과 서버가 같이 쓰도록 src/domain 에 둔다(규칙 한 곳)
export { SHORT_NOTICE_DAYS, planJobDispatch } from '../../src/domain/cleaningDispatchRule.js';
