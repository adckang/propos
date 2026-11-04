/**
 * reservationHistoryDomain.js — 예약 기록 → 타임라인 구간 (지난 구간 + 미래 예측이 공유하는 한 벌의 규칙)
 *
 * Airbnb iCal·구글 캘린더는 지난 일정을 내보내지 않지만, PROPOS 는 동기화한 예약을 지우지 않고
 * 운영 DB(property_reservations)에 계속 갖고 있다. 지난 타임라인은 감지기 기록이 아니라 이 예약
 * 기록을 뼈대로 그린다 — 감지기가 응답하지 않던 기간에도 "체류 → 청소 → 공실 → 입실준비" 흐름이
 * 사라지거나 한 상태(예: 청소중)로 며칠씩 굳지 않게 하기 위해서다(실사용 중 발견, 2026-11-04).
 *
 * 숙박 한 번의 순서(appendStayCycle)는 미래 예측(roomStateMockData 의 addResCycles)과 같은 함수를
 * 쓴다 — docs/room-state-machine.md:
 *   공실 → 입실준비(체크인 1시간 전 최적화중, 30분 전 최적화완료) → 체류 → 청소(대기/진행) → 공실
 * 청소 시각은 예약에 저장된 실제 청소 시각을 우선하고, 없으면 퇴실 + 기본 청소시간을 쓴다.
 */

import { asDate, reservationCleaningWindow } from './cleaningScheduleDomain.js';

const HOUR_MS = 3_600_000;

/**
 * 퇴실 뒤 청소 구간(대기 → 진행)을 push 하고 청소가 끝나는 시각을 돌려준다.
 * push(mainStatus, subStatus, start, end, checkoutAt) — 길이 0 이하 구간은 push 쪽에서 버린다.
 * 대기·진행 구간에는 원래 퇴실 시각(checkoutAt)을 넘겨, 화면이 담당자를 그 예약에서 찾게 한다.
 */
export function appendCleaningSegments(push, reservation, cursor, durationHours) {
  const window = reservationCleaningWindow(reservation, durationHours);
  const start = window?.start ?? cursor;
  const end = window?.end ?? new Date(cursor.getTime() + durationHours * HOUR_MS);
  const checkoutAt = reservation?.checkOut;
  if (start > cursor) push('CLEANING', 'CLEANING_PENDING', cursor, start, checkoutAt);
  push('CLEANING', 'CLEANING_IN_PROGRESS', new Date(Math.max(cursor.getTime(), start.getTime())), end, checkoutAt);
  return new Date(Math.max(cursor.getTime(), end.getTime()));
}

/**
 * 숙박 한 번: [공실] → 입실준비(최적화중·최적화완료) → 체류 → 청소. cursor 이전으로는 되돌아가지 않는다
 * (앞 청소가 늦게 끝나면 입실준비가 그만큼 짧아진다). 다음 cursor 를 돌려준다.
 */
export function appendStayCycle(push, reservation, cursor, durationHours) {
  const checkIn = asDate(reservation.checkIn);
  const checkOut = asDate(reservation.checkOut);
  const prepAt = new Date(Math.max(cursor.getTime(), checkIn.getTime() - HOUR_MS));
  const optimizedAt = new Date(checkIn.getTime() - 0.5 * HOUR_MS);
  if (prepAt > cursor) { push('VACANT', 'CLEANING_FINISHED', cursor, prepAt); cursor = prepAt; }
  if (cursor < optimizedAt) { push('PRE_STAY_READY', 'OPTIMIZING', cursor, optimizedAt); cursor = optimizedAt; }
  if (cursor < checkIn) { push('PRE_STAY_READY', 'OPTIMIZED', cursor, checkIn); cursor = new Date(checkIn); }
  if (checkOut && checkOut > cursor) { push('OCCUPIED', 'GOOD_CONDITION', cursor, checkOut); cursor = new Date(checkOut); }
  return appendCleaningSegments(push, reservation, cursor, durationHours);
}

/**
 * 날짜가 깨진 예약을 빼고 체크인 순으로 정렬한 뒤, 기간이 겹치는 예약은 하나의 숙박으로 합친다
 * (가장 이른 체크인 ~ 가장 늦은 체크아웃, 청소 정보는 가장 늦게 퇴실하는 예약 것).
 * 같은 예약이 다른 uid 로 두 번 들어오거나 날짜가 바뀐 예약의 옛 행이 남아도(D-031·D-032,
 * listProperties 주석에서 확인된 실제 현상) 청소 뒤에 체류가 한 번 더 생기는 유령 구간을 막는다.
 */
export function mergeOverlappingStays(reservations) {
  const stays = (reservations ?? [])
    .map(reservation => ({ ...reservation, checkIn: asDate(reservation?.checkIn), checkOut: asDate(reservation?.checkOut) }))
    .filter(stay => stay.checkIn && stay.checkOut && stay.checkOut > stay.checkIn)
    .sort((a, b) => a.checkIn - b.checkIn || a.checkOut - b.checkOut);
  const merged = [];
  for (const stay of stays) {
    const last = merged.at(-1);
    if (last && stay.checkIn < last.checkOut) {
      if (stay.checkOut > last.checkOut) merged[merged.length - 1] = { ...stay, checkIn: last.checkIn };
      continue;
    }
    merged.push(stay);
  }
  return merged;
}

/**
 * 예약 목록 → until 까지의 상태 구간들 (시간순, 빈틈·겹침 없음, isFuture=false).
 *
 * - 입실준비(체크인 1시간 전)가 until 이전에 시작된 숙박만 쓴다.
 * - 청소가 다음 체크인을 넘기면 체크인에서 끊는다 (손님이 들어오면 체류가 우선).
 * - 첫 예약 이전(기록이 없는 기간)은 그리지 않는다 — 모르는 것을 공실로 지어내지 않는다.
 * - openEnded=false: 모든 구간이 until 에서 잘린다 (캘린더의 "지금까지").
 * - since: 이 시각 이전에 끝난 숙박은 계산하지 않는다(바로 앞 한 건만 문맥으로 남김). 생략하면 전부.
 * - openEnded=true : until 을 포함하는 구간을 end=null(지금 진행 중)로 남기고 끝낸다 —
 *   deriveTimeline 의 "마지막 구간 = 현재 상태" 계약. 마지막 청소가 until 전에 끝났으면 공실로 열어 둔다.
 *
 * @param {object[]} reservations  { checkIn, checkOut, cleaningAt?, cleaningEnd? }
 * @param {Date}     until
 * @param {number}   cleanDurationHours 청소 시각이 저장돼 있지 않을 때 쓰는 기본 청소시간
 */
export function buildReservationHistorySegments(reservations, until, cleanDurationHours = 2.5, { openEnded = false, since = null } = {}) {
  const end = asDate(until);
  if (!end) return [];
  const merged = mergeOverlappingStays(reservations);
  const drawable = merged.filter(stay => stay.checkIn.getTime() - HOUR_MS <= end.getTime());
  // since: 그 이전에 끝난 숙박은 바로 앞 한 건만 남긴다 (그 청소 종료가 since 직후 입실준비를 줄일 수 있어서) —
  // 한 달만 그리는 캘린더가 숙소의 전체 역사를 매번 다시 계산하지 않게
  const sinceDate = asDate(since);
  const firstIndex = sinceDate
    ? Math.max(0, drawable.findIndex(stay => stay.checkOut >= sinceDate) - 1)
    : 0;
  const stays = sinceDate && drawable.every(stay => stay.checkOut < sinceDate)
    ? drawable.slice(-1)
    : drawable.slice(firstIndex);
  if (!stays.length) return [];

  const raw = [];
  const push = (mainStatus, subStatus, start, stop, checkoutAt) => {
    if (!(start < stop)) return;
    raw.push({
      mainStatus, subStatus, start: new Date(start), end: new Date(stop), isFuture: false,
      ...(checkoutAt ? { cleaningCheckoutAt: new Date(checkoutAt) } : {}),
    });
  };
  let cursor = new Date(stays[0].checkIn.getTime() - HOUR_MS);
  stays.forEach(stay => {
    // 예약된 청소가 다음 손님 체크인을 넘겨도 체크인에서 끊는다 — 손님이 들어온 뒤엔 체류가 우선
    // (끊지 않으면 "청소중"이 이어져 다음 숙박이 타임라인·예측에서 통째로 빠졌다, 코드 리뷰에서 재현).
    // 다음 숙박은 아직 입실준비 전이라 그리지 않는 것까지 포함한 전체 목록(merged)에서 찾는다.
    const nextCheckIn = merged[merged.indexOf(stay) + 1]?.checkIn;
    const pushUntilNextStay = nextCheckIn
      ? (mainStatus, subStatus, start, stop, checkoutAt) => push(mainStatus, subStatus, start, stop > nextCheckIn ? nextCheckIn : stop, checkoutAt)
      : push;
    cursor = appendStayCycle(pushUntilNextStay, stay, cursor, cleanDurationHours);
    if (nextCheckIn && cursor > nextCheckIn) cursor = new Date(nextCheckIn);
  });

  const segments = [];
  for (const seg of raw) {
    if (openEnded ? seg.start > end : seg.start >= end) break;
    if (seg.end > end) {
      segments.push({ ...seg, end: openEnded ? null : new Date(end) });
      return segments;
    }
    segments.push(seg);
  }
  const lastEnd = segments.at(-1)?.end ?? cursor;
  if (openEnded) {
    segments.push({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED', start: new Date(lastEnd), end: null, isFuture: false });
  } else if (lastEnd < end) {
    segments.push({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED', start: new Date(lastEnd), end: new Date(end), isFuture: false });
  }
  return segments;
}

/** 다른 출처(감지기·목업)의 구간 중 cutoff 이전 부분만 남긴다 — 예약 기록이 시작되기 전 기간 보충용. */
export function segmentsBefore(segments, cutoff) {
  const limit = asDate(cutoff);
  if (!limit) return [];
  return (segments ?? []).flatMap(segment => {
    const start = asDate(segment.start);
    if (!start || start >= limit) return [];
    const end = asDate(segment.end);
    return [{ ...segment, start, end: end && end < limit ? end : new Date(limit) }];
  });
}
