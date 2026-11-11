/**
 * RF-16 — Airbnb 피드에서 사라진 예약을 정리하고, 퇴실이 없어진 날의 청소 작업을 막고 알린다.
 *
 * 사용자 상황(2026-11-11 운영 확인): 동기화는 피드에 있는 예약을 추가·갱신만 해서, Airbnb 가 같은 예약을 새 번호로 다시
 * 내보내거나(파주201 옛 번호 2건) 손님이 취소해도 옛 행이 "예약됨"으로 남았다. 같은 번호로 날짜만 바뀌면 옛 날짜의
 * 청소 작업이 그대로 남았다. 화면엔 숙박이 그대로 보이고, 발송은 예약이 남아 있는지 확인하지 않아 퇴실 없는 날로
 * 청소 요청이 나가거나 배정된 담당자가 올 수 있었다.
 *
 * - 피드에서 한 시간 넘게 안 보인 미래 예약은 CANCELLED 로 표시한다(retireVanishedReservations). 다시 나타나면 기존
 *   동기화 저장이 ACTIVE 로 되돌린다 — 표시는 언제든 되돌아가고, 한 번 흔들린 피드로는 바뀌지 않는다.
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

/**
 * 성공한 동기화 한 번(숙소 하나)에 대해, 피드에 없는 미래 예약을 CANCELLED 로 표시한다.
 *  - 피드에 예약이 하나도 없으면(일시 장애·빈 응답·"예약 불가" 표시뿐) 아무것도 바꾸지 않는다.
 *  - 이번 동기화 시작보다 VANISH_GRACE_MS 이상 전에 마지막으로 본 예약만 — 겹쳐 돈 다른 동기화가 방금 넣은 예약,
 *    피드가 한 번 흔들려 잠깐 빠진 예약은 건드리지 않는다.
 *  - 미래 예약의 절반 넘게(그리고 MASS_VANISH_MIN 건 이상) 한꺼번에 사라지면 잘린 피드일 수 있어 그만둔다.
 *
 * @param {{ query: Function }} db
 * @param {{ propertyId: string, seenUids: string[], syncStartedAt: Date|string, now?: Date }} options
 * @returns {Promise<{ retired: object[], skipped: null|'NO_RESERVATIONS'|'MASS_VANISH' }>}
 */
export async function retireVanishedReservations(db, { propertyId, seenUids, syncStartedAt, now = new Date() }) {
  if (!seenUids?.length) return { retired: [], skipped: 'NO_RESERVATIONS' };
  const seenBefore = new Date(new Date(syncStartedAt).getTime() - VANISH_GRACE_MS);
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

/**
 * 퇴실이 없어진 날의 살아 있는 미래 청소 작업(숙소 하나) — 운영자에게 알릴 목록.
 * @returns {Promise<Array<{ id, checkout_at, status, has_cleaner, cleaner_name }>>}
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
 * 숙소 하나의 "퇴실이 없어진 작업" 알림. 이미 알린 작업은 다시 알리지 않고, 정상으로 돌아온 작업은 목록에서 빼서
 * 나중에 다시 사라지면 다시 알린다. 보내기에 실패한 작업은 알린 목록에 넣지 않아 다음 동기화에 다시 보낸다.
 *
 * @param {{ propertyName: string, jobs: object[], previouslyAlertedIds: string[]|null, send: (text: string) => Promise<boolean> }} options
 *   previouslyAlertedIds — 지난번까지 알린 작업 id. null 이면 기록을 못 읽은 것 — 이번엔 보내지 않는다(같은 알림 반복 방지)
 * @returns {Promise<{ alerted: number, alertedIds: string[]|null }>}  alertedIds 는 다음에 저장할 목록(null = 저장하지 않음)
 */
export async function alertGoneCheckoutJobs({ propertyName, jobs, previouslyAlertedIds, send }) {
  if (!Array.isArray(previouslyAlertedIds)) return { alerted: 0, alertedIds: null };
  const previous = new Set(previouslyAlertedIds);
  const stillGone = (jobs ?? []).filter(job => previous.has(job.id)).map(job => job.id);
  const fresh = (jobs ?? []).filter(job => !previous.has(job.id));
  const message = describeOrphanedJobs(propertyName, fresh);
  if (!message || !(await send(message))) return { alerted: 0, alertedIds: stillGone };
  return { alerted: fresh.length, alertedIds: [...stillGone, ...fresh.map(job => job.id)] };
}
