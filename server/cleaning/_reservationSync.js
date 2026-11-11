/**
 * RF-16 — Airbnb 피드에서 사라진 예약을 정리하고, 퇴실이 없어진 날의 청소 작업을 막고 알린다.
 *
 * 사용자 상황(2026-11-11 운영 확인): 동기화는 피드에 있는 예약을 추가·갱신만 해서, Airbnb 가 같은 예약을 새 번호로 다시
 * 내보내거나(파주201 옛 번호 2건) 손님이 취소해도 옛 행이 "예약됨"으로 남았다. 같은 번호로 날짜만 바뀌면 옛 날짜의
 * 청소 작업이 그대로 남았다. 화면엔 숙박이 그대로 보이고, 발송은 예약이 남아 있는지 확인하지 않아 퇴실 없는 날로
 * 청소 요청이 나가거나 배정된 담당자가 올 수 있었다.
 *
 * - 직전 정상 동기화와 이번 동기화에 연속으로 안 보였고 한 시간도 넘은 미래 예약은 CANCELLED 로 표시한다
 *   (retireVanishedReservations·retireAfterSync). 다시 나타나면 기존 동기화 저장이 ACTIVE 로 되돌린다 — 표시는 언제든
 *   되돌아가고, 한 번 흔들린 피드로는 바뀌지 않는다(동기화는 정해진 주기 없이 돈다: 화면·새 예약 메일·수동).
 * - "퇴실이 없어진 작업" 규칙은 한 곳(checkoutGoneSql) — 그 날짜(KST)에 살아 있는 예약이 없고, 그 날짜의 예약이 취소로
 *   표시됐거나 작업이 만들어진 예약(같은 번호)이 취소·다른 날로 옮겨졌으면 해당. 예약 기록이 아예 없는 날(다른 경로로 만든
 *   작업 등)은 판단 근거가 없어 해당하지 않는다. 발송 확인(isCheckoutCancelled)과 운영자 알림 목록(listGoneCheckoutJobs)이 같이 쓴다.
 * - 작업과 요청 기록은 바꾸지 않는다 — 취소·담당자 연락은 운영자가 정하고, 예약이 돌아오면 멈췄던 요청이 이어서 진행된다.
 */
import { formatKstDayTime } from '../../src/domain/violationDetailDomain.js';
import { LIVE_CLEANING_STATUSES } from '../../src/domain/monthlyCalendarDomain.js';

// 이만큼 피드에서 안 보여야 사라진 것으로 본다 — 피드가 한 번 흔들려 예약이 잠깐 빠져도 바꾸지 않는다
export const VANISH_GRACE_MS = 60 * 60 * 1000;
// 한 번에 이만큼 넘게 사라지면 잘린 피드일 수 있어 정리하지 않는다(진짜 취소는 보통 한두 건)
const MASS_VANISH_MIN = 3;

const kstDate = expr => `(${expr} AT TIME ZONE 'Asia/Seoul')::date`;

/** 퇴실이 없어진 작업 규칙(SQL 조각) — 발송 확인과 알림 목록이 같은 조건을 쓴다 */
function checkoutGoneSql({ property, checkout, uid }) {
  return `NOT EXISTS (SELECT 1 FROM property_reservations r
                       WHERE r.property_id = ${property} AND r.status = 'ACTIVE' AND ${kstDate('r.check_out')} = ${kstDate(checkout)})
    AND (EXISTS (SELECT 1 FROM property_reservations r
                  WHERE r.property_id = ${property} AND r.status = 'CANCELLED' AND ${kstDate('r.check_out')} = ${kstDate(checkout)})
      OR EXISTS (SELECT 1 FROM property_reservations r
                  WHERE r.property_id = ${property} AND r.reservation_uid = ${uid}
                    AND (r.status <> 'ACTIVE' OR ${kstDate('r.check_out')} <> ${kstDate(checkout)})))`;
}

/** 동기화가 예약·청소 작업을 저장할 때 쓰는 예약 번호 — 피드에 번호가 없으면 "숙소:입실시각". 저장과 정리가 같은 규칙을 쓴다 */
export function reservationUidOf(propertyId, reservation) {
  return reservation.uid || `${propertyId}:${reservation.checkIn.toISOString()}`;
}

/** 피드가 끝까지 온 달력인지 — 오류 페이지·빈 응답·중간에 잘린 응답이면 false(예약이 0건인 정상 달력은 true) */
export function isCompleteCalendar(icalText) {
  return typeof icalText === 'string' && /BEGIN:VCALENDAR/.test(icalText) && /END:VCALENDAR\s*$/.test(icalText);
}

/**
 * 성공한 동기화 한 번(숙소 하나)에 대해, 피드에 없는 미래 예약을 CANCELLED 로 표시한다.
 *  - 피드가 끝까지 온 달력이 아니면(오류 페이지·빈 응답·잘린 응답) 아무것도 바꾸지 않는다.
 *  - 피드에 예약이 하나도 없으면 바꾸지 않는다 — Airbnb 피드엔 앞으로의 숙박만 와서(2026-11-11 운영 확인: 지난 숙박 0건) "남은 예약이
 *    모두 취소됨"과 "형식이 바뀌어 아무것도 못 읽음"을 구별할 수 없다. 잘못 판단하면 진짜 퇴실의 청소 요청이 막히고(다음 손님이
 *    청소 안 된 방), 놓치면 빈 방에 담당자가 한 번 헛걸음한다 — 덜 나쁜 쪽을 택한다. 다른 예약이 하나라도 생기면 그때 정리된다.
 *  - 직전 정상 동기화(previousSyncStartedAt)에도 안 보였고, 이번 동기화 시작보다 VANISH_GRACE_MS 이상 전에 마지막으로 본
 *    예약만 — 한 번 흔들린 피드, 겹쳐 돈 다른 동기화가 방금 넣은 예약은 건드리지 않는다. 직전 기록이 없으면 판단하지 않는다.
 *  - 미래 예약의 절반 넘게(그리고 MASS_VANISH_MIN 건 이상) 한꺼번에 사라지면 잘린 피드일 수 있어 그만둔다.
 *
 * @param {{ query: Function }} db
 * @param {{ propertyId: string, seenUids: string[], feedIsCalendar: boolean, syncStartedAt: Date|string,
 *           previousSyncStartedAt: Date|string|null, now?: Date }} options
 * @returns {Promise<{ retired: object[], skipped: null|'INVALID_FEED'|'NO_RESERVATIONS'|'NO_PREVIOUS_SYNC'|'MASS_VANISH' }>}
 */
export async function retireVanishedReservations(db, { propertyId, seenUids, feedIsCalendar, syncStartedAt, previousSyncStartedAt, now = new Date() }) {
  if (!feedIsCalendar) return { retired: [], skipped: 'INVALID_FEED' };
  if (!seenUids?.length) return { retired: [], skipped: 'NO_RESERVATIONS' };
  const previousMs = previousSyncStartedAt ? new Date(previousSyncStartedAt).getTime() : NaN;
  const startedMs = new Date(syncStartedAt).getTime();
  if (!Number.isFinite(previousMs) || !Number.isFinite(startedMs) || previousMs >= startedMs) return { retired: [], skipped: 'NO_PREVIOUS_SYNC' };
  const seenBefore = new Date(Math.min(startedMs - VANISH_GRACE_MS, previousMs));
  const vanishedWhere = `property_id=$1 AND data_origin='REAL' AND status='ACTIVE' AND check_out > $2
        AND NOT (reservation_uid = ANY($3::text[])) AND last_seen_at < $4`;
  const params = [propertyId, new Date(now).toISOString(), seenUids, seenBefore.toISOString()];
  const { rows: [counts] } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE ${vanishedWhere}) AS vanished,
            COUNT(*) FILTER (WHERE property_id=$1 AND data_origin='REAL' AND status='ACTIVE' AND check_out > $2) AS future_active
       FROM property_reservations`,
    params,
  );
  const vanished = Number(counts?.vanished ?? 0);
  if (vanished >= MASS_VANISH_MIN && vanished * 2 > Number(counts?.future_active ?? 0)) return { retired: [], skipped: 'MASS_VANISH' };
  if (vanished === 0) return { retired: [], skipped: null };
  const { rows: retired } = await db.query(
    `UPDATE property_reservations SET status='CANCELLED', updated_at=NOW()
      WHERE ${vanishedWhere}
      RETURNING reservation_uid, check_in, check_out`,
    params,
  );
  return { retired, skipped: null };
}

// 숙소마다 마지막 정상 동기화의 시작 시각(다음 동기화가 "직전에도 안 보였는지" 판단) — 한 달 넘게 동기화가 없으면 사라져 한 번 더 기다린다
const LAST_SYNC_TTL_S = 30 * 86_400;
export const lastSyncStoreKey = propertyId => `cleaning:ical-last-sync:${propertyId}`;

/**
 * 동기화 한 번(숙소 하나)의 정리 — 직전 정상 동기화 시각을 읽어 정리하고, 이번 피드가 판단할 수 있는 피드(온전한 달력 + 예약 1건
 * 이상)였으면 이번 시작 시각을 남긴다 — "두 번 연속 안 보임"은 판단할 수 있는 피드 두 번을 뜻한다.
 * 기록을 못 읽으면 정리하지 않는다(안전한 쪽). 기록 저장 실패는 로그만(다음엔 더 오래된 기록으로 판단 — 역시 안전한 쪽).
 */
export async function retireAfterSync(db, { propertyId, seenUids, feedIsCalendar, syncStartedAt, now = new Date(), store }) {
  const key = lastSyncStoreKey(propertyId);
  const previousSyncStartedAt = await Promise.resolve()
    .then(() => store.get(key))
    .catch((e) => { console.error(`[ical-sync] 직전 동기화 기록 조회 실패 (${propertyId}):`, e?.message); return null; });
  const result = await retireVanishedReservations(db, { propertyId, seenUids, feedIsCalendar, syncStartedAt, previousSyncStartedAt, now });
  if (feedIsCalendar && seenUids?.length) {
    await Promise.resolve()
      .then(() => store.set(key, new Date(syncStartedAt).toISOString(), { ex: LAST_SYNC_TTL_S }))
      .catch((e) => console.error(`[ical-sync] 동기화 기록 저장 실패 (${propertyId}):`, e?.message));
  }
  return result;
}

/**
 * 퇴실이 없어진 날의 살아 있는 미래 청소 작업(숙소 하나) — 운영자에게 알릴 목록.
 * @returns {Promise<Array<{ id, checkout_at, status, has_cleaner, cleaner_name }>>}  has_cleaner — 알림 기록 값(goneAlertKeyOf)
 */
export async function listGoneCheckoutJobs(db, { propertyId, now = new Date() }) {
  const { rows } = await db.query(
    `SELECT j.id, j.checkout_at, j.status, (j.assigned_cleaner_id IS NOT NULL) AS has_cleaner, c.name AS cleaner_name
       FROM cleaning_jobs j
       LEFT JOIN cleaners c ON c.id = j.assigned_cleaner_id
      WHERE j.property_id = $1 AND j.data_origin = 'REAL' AND j.checkout_at > $2 AND j.status = ANY($3::text[])
        AND ${checkoutGoneSql({ property: 'j.property_id', checkout: 'j.checkout_at', uid: 'j.reservation_uid' })}
      ORDER BY j.checkout_at`,
    [propertyId, new Date(now).toISOString(), [...LIVE_CLEANING_STATUSES]],
  );
  return rows;
}

/**
 * 이 작업의 퇴실이 없어졌는지 — 요청을 보내기 직전에 본다. 판단 근거가 없거나 확인이 실패하면 false(예전처럼 보낸다):
 * 확인 하나가 흔들려 정상 요청이 멈추거나 크론 전체가 멈추지 않게.
 */
export async function isCheckoutCancelled(db, job) {
  if (!job?.property_id || !job?.checkout_at) return false;
  try {
    const result = await db.query(
      `SELECT (${checkoutGoneSql({ property: '$1', checkout: '$2::timestamptz', uid: '$3' })}) AS gone`,
      [job.property_id, new Date(job.checkout_at).toISOString(), job.reservation_uid ?? null],
    );
    return result?.rows?.[0]?.gone === true;
  } catch (error) {
    console.error('[cleaning] 퇴실 확인 실패 — 평소대로 진행:', error?.code ?? error?.message);
    return false;
  }
}

function jobStateLabel(job) {
  if (job.status === 'ASSIGNED') return job.cleaner_name ? `${job.cleaner_name}님 배정됨` : '담당자 배정됨';
  if (job.status === 'ESCALATED') return '배정 실패로 남아 있음';
  if (job.status === 'PENDING') return '아직 요청 전 — 요청은 보내지 않아요';
  return '청소 요청 진행 중 — 새 요청은 보내지 않아요';
}

/** 운영자 Slack 알림 문장 — 퇴실이 없어진 날의 청소 작업과 지금 상태 */
export function describeOrphanedJobs(propertyName, orphanedJobs) {
  if (!orphanedJobs?.length) return null;
  const lines = orphanedJobs.map(job => `• ${formatKstDayTime(job.checkout_at)} 퇴실 청소 — ${jobStateLabel(job)}`);
  return [
    `[PROPOS] ⚠️ ${propertyName} 예약이 Airbnb에서 사라지거나 날짜가 바뀌어 그날 퇴실이 없어요. 청소 일정을 확인해 주세요.`,
    ...lines,
    '담당자에게 알리거나 청소 관리에서 일정을 취소해 주세요.',
  ].join('\n');
}

/**
 * 알림 기록에 남기는 값 — 담당자가 실제로 붙은 작업은 id 에 "담당자 배정됨"을 붙인다. 요청 중일 때 알린 작업에 나중에 담당자가
 * 붙으면(이미 나간 요청을 수락) 값이 달라져 다시 알린다 — 담당자가 퇴실 없는 날 오게 되는 가장 위험한 순간을 놓치지 않게.
 * 상태만 "배정됨"이고 담당자가 비어 있는 작업은 아직 아무도 오지 않으니 붙이지 않는다(나중에 담당자가 붙으면 다시 알림).
 */
export function goneAlertKeyOf(job) {
  return job.status === 'ASSIGNED' && job.has_cleaner ? `${job.id}:assigned` : String(job.id);
}

/**
 * 숙소 하나의 "퇴실이 없어진 작업" 알림. 이미 알린 작업(같은 배정 상태)은 다시 알리지 않고, 정상으로 돌아온 작업은 목록에서
 * 빼서 나중에 다시 사라지면 다시 알린다. 보내기에 실패한 작업은 알린 목록에 넣지 않아 다음에 다시 보낸다.
 *
 * @param {{ propertyName: string, jobs: object[], previouslyAlertedIds: string[]|null, send: (text: string) => Promise<boolean> }} options
 *   previouslyAlertedIds — 지난번까지 알린 기록(goneAlertKeyOf). null 이면 기록을 못 읽은 것 — 이번엔 보내지 않는다(같은 알림 반복 방지)
 * @returns {Promise<{ alerted: number, alertedIds: string[]|null, sentIds: string[] }>}  alertedIds 는 다음에 저장할 목록
 *   (null = 저장하지 않음), sentIds 는 이번에 실제로 알린 작업의 기록 값
 */
export async function alertGoneCheckoutJobs({ propertyName, jobs, previouslyAlertedIds, send }) {
  if (!Array.isArray(previouslyAlertedIds)) return { alerted: 0, alertedIds: null, sentIds: [] };
  const previous = new Set(previouslyAlertedIds);
  const stillGone = (jobs ?? []).filter(job => previous.has(goneAlertKeyOf(job))).map(goneAlertKeyOf);
  const fresh = (jobs ?? []).filter(job => !previous.has(goneAlertKeyOf(job)));
  const message = describeOrphanedJobs(propertyName, fresh);
  if (!message || !(await send(message))) return { alerted: 0, alertedIds: stillGone, sentIds: [] };
  const sentIds = fresh.map(goneAlertKeyOf);
  return { alerted: fresh.length, alertedIds: [...stillGone, ...sentIds], sentIds };
}

// 알린 기록 — 숙소마다 하나, 반년 보관(보내졌을 때만 넣고, 정상으로 돌아오면 뺀다)
const GONE_ALERT_TTL_S = 180 * 86_400;
export const goneAlertStoreKey = propertyId => `cleaning:gone-checkout-alerts:${propertyId}`;

/**
 * 숙소 하나의 퇴실이 없어진 청소 작업을 운영자에게 알린다(이미 알린 것은 빼고) — 동기화와 캘린더 배정이 같이 쓴다.
 * 기록을 못 읽으면 보내지 않고(같은 알림 반복 방지), 기록 저장 실패는 로그만 남긴다.
 *
 * @param {{ query: Function }} db
 * @param {{ propertyId: string, propertyName?: string, now?: Date, store: { get: Function, set: Function }, send: (text: string) => Promise<boolean> }} options
 */
export async function alertGoneCheckouts(db, { propertyId, propertyName, now = new Date(), store, send }) {
  const key = goneAlertStoreKey(propertyId);
  const previouslyAlertedIds = await Promise.resolve()
    .then(() => store.get(key))
    .then(saved => (Array.isArray(saved) ? saved : []))
    .catch((e) => { console.error(`[gone-checkout] 알림 기록 조회 실패 (${propertyId}):`, e?.message); return null; });
  const result = await alertGoneCheckoutJobs({
    propertyName: propertyName ?? propertyId,
    jobs: await listGoneCheckoutJobs(db, { propertyId, now }),
    previouslyAlertedIds,
    send,
  });
  if (result.alertedIds && JSON.stringify(result.alertedIds) !== JSON.stringify(previouslyAlertedIds)) {
    await Promise.resolve()
      .then(() => store.set(key, result.alertedIds, { ex: GONE_ALERT_TTL_S }))
      .catch((e) => console.error(`[gone-checkout] 알림 기록 저장 실패 (${propertyId}):`, e?.message));
  }
  return result;
}

/**
 * 캘린더로 담당자가 배정됐을 때의 운영자 Slack. 그날 퇴실이 없어졌으면 "배정 완료" 대신 퇴실 없음 경고를 보낸다 —
 * 손님이 취소한 뒤 이미 나간 요청을 담당자가 수락하면, 담당자가 퇴실 없는 날(연장이면 손님이 있는 방) 오게 된다.
 * 경고는 동기화와 같은 기록을 써서 다음 동기화에 다시 가지 않는다. 기록을 못 읽었거나 이미 알렸어도 "배정 완료"라고는 하지 않는다.
 */
export async function postAssignmentSlack(db, { job, propertyName, cleanerName, normalText, store, send }) {
  if (!(await isCheckoutCancelled(db, job))) return send(normalText);
  const name = propertyName ?? job.property_id;
  try {
    // 이 작업(담당자 붙음)이 이번 메시지에 실제로 들어갔을 때만 끝 — 다른 작업만 알렸으면 아래에서 이 작업을 따로 알린다
    const { sentIds } = await alertGoneCheckouts(db, { propertyId: job.property_id, propertyName: name, store, send });
    if (sentIds.includes(goneAlertKeyOf({ id: job.id, status: 'ASSIGNED', has_cleaner: true }))) return true;
  } catch (e) {
    console.error(`[gone-checkout] 배정 경고 실패 (${job.property_id}):`, e?.message);
  }
  return send(describeOrphanedJobs(name, [{ checkout_at: job.checkout_at, status: 'ASSIGNED', cleaner_name: cleanerName }]));
}
