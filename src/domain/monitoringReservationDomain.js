/**
 * Pi 워처에 넘길 "지금 예약" — 대시보드와 서버가 같은 규칙을 쓴다 (RF-27).
 *
 * 워처는 이 예약 하나로 입실 준비·입실·퇴실 시각을 판단한다. 예전엔 대시보드(RoomStateApp)를 브라우저에서 열어 둘 때만
 * 예약이 Pi로 갔다 — 아무도 화면을 열지 않으면 Pi 예약이 낡았다(DEC-04, 2026-11-17 Pi 11-14→11-15, DB 다음 예약 11-20→11-23).
 * 이제 서버 정기 작업도 iCal 동기화 뒤 같은 예약을 보낸다. 고르는 규칙은 이 파일 한 곳.
 */

// 입실 시각 순, 같으면 uid 순 — 같은 예약이 uid 만 다르게 두 줄 있어도(Airbnb 재발행) 매번 같은 줄을 고른다.
// 워처의 입실 준비 식별값에 uid 가 들어가서, 고른 줄이 바뀌면 진행 중인 준비가 "예약 변경"으로 취소된다.
const uidOf = r => String(r.uid ?? '');
const byCheckInThenUid = (a, b) => (a.checkIn - b.checkIn) || (uidOf(a) < uidOf(b) ? -1 : uidOf(a) > uidOf(b) ? 1 : 0);

/**
 * 예약 목록에서 지금 진행 중인 예약과 앞으로 올 예약(입실 순)을 나눈다.
 * @param {{ uid?: string, checkIn: Date, checkOut: Date }[]} reservations — 취소 예약은 호출부가 이미 뺀 목록
 * @param {Date} now
 */
export function splitReservationsAt(reservations, now) {
  const list = Array.isArray(reservations) ? reservations : [];
  const active = list.filter(r => r.checkIn <= now && r.checkOut > now).sort(byCheckInThenUid)[0] ?? null;
  const future = list.filter(r => r.checkIn > now).sort(byCheckInThenUid);
  return { active, future };
}

/** 지금 진행 중인 예약, 없으면 가장 가까운 다음 예약, 둘 다 없으면 null. */
export function pickCurrentReservation(reservations, now) {
  const { active, future } = splitReservationsAt(reservations, now);
  return active ?? future[0] ?? null;
}

// 손님 숙박이 아닌 상태 — 취소, 그리고 스키마가 허용하는 차단(BLOCKED, 지금 쓰는 곳은 없다: iCal 의 차단 날짜는 읽을 때 버린다)
const NOT_A_STAY = new Set(['CANCELLED', 'BLOCKED']);

/**
 * DB·API의 예약 행({ uid, checkIn, checkOut, status })을 고를 수 있는 예약으로 — 취소·차단 행과 날짜가 잘못된 행을 뺀다.
 * 대시보드(cloudRowToLiveProperty)와 서버가 같은 기준을 쓴다.
 */
export function usableReservations(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(row => row && !NOT_A_STAY.has(row.status))
    .map(row => ({ ...row, checkIn: new Date(row.checkIn), checkOut: new Date(row.checkOut) }))
    .filter(row => Number.isFinite(row.checkIn.getTime()) && Number.isFinite(row.checkOut.getTime()));
}

/** 워처 설정(`reservation`)에 넣는 모양 — 대시보드가 보내던 것과 같다(uid·입실·퇴실 ISO 시각). 예약이 없으면 null. */
export function toMonitoringReservation(reservation) {
  if (!reservation) return null;
  return {
    uid: reservation.uid ?? null,
    checkIn: reservation.checkIn?.toISOString?.() ?? null,
    checkOut: reservation.checkOut?.toISOString?.() ?? null,
  };
}
