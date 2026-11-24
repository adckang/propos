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

/** 워처 설정(`reservation`)에 넣는 모양. 서버 행에 내부 숙박 ID가 있으면 RF-25 감지용으로 함께 보낸다. */
export function toMonitoringReservation(reservation) {
  if (!reservation) return null;
  return {
    uid: reservation.uid ?? null,
    ...(reservation.stayId ? { stayId: reservation.stayId } : {}),
    checkIn: reservation.checkIn?.toISOString?.() ?? null,
    checkOut: reservation.checkOut?.toISOString?.() ?? null,
  };
}

// 빈 값(null)은 읽을 수 없는 시각이다 — new Date(null)은 1970-01-01(0)이 되어 "이미 지난 시각"으로 보인다
const timeOf = value => (value == null || value === '' ? NaN : new Date(value).getTime());

/**
 * Pi에 보낼 청소 일정(DEC-17) — 보내는 예약의 퇴실에 딸린 청소, 아직 끝 시각이 지나지 않은 것.
 * Pi는 처리한 퇴실과 같은 퇴실의 일정만 쓰므로, 다른 퇴실의 청소(날짜가 바뀌어 남은 옛 청소 등)는 보내지 않는다.
 * 끝 시각이 비어 있으면 숙소의 청소 소요 시간으로 정한다. 배정 완료(담당자 있음)만 담당자 미감지 판정 대상이다.
 * @param {{ id, checkout_at, cleaning_start_at, cleaning_end_at, status }[]} rows
 * @param {Date|number} now
 * @param {number} [durationHours] - 숙소 청소 소요 시간(설정 기본값과 같은 2.5)
 * @param {string|Date|null} [checkoutAt] - 보내는 예약의 퇴실 시각. 주면 그 퇴실의 청소만
 * @returns {{ jobId, checkoutAt, startAt, endAt, assigned }|null}
 */
export function pickCurrentCleaning(rows, now, durationHours = 2.5, checkoutAt = null) {
  const wantCheckout = checkoutAt == null ? null : timeOf(checkoutAt);
  const nowMs = now instanceof Date ? now.getTime() : now;
  const plans = [];
  for (const row of rows ?? []) {
    const startMs = timeOf(row.cleaning_start_at), checkoutMs = timeOf(row.checkout_at);
    const endMs = Number.isFinite(timeOf(row.cleaning_end_at)) ? timeOf(row.cleaning_end_at) : startMs + Number(durationHours) * 3_600_000;
    if (!row.id || !Number.isFinite(startMs) || !Number.isFinite(checkoutMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs <= nowMs) continue;
    if (wantCheckout != null && checkoutMs !== wantCheckout) continue;
    plans.push({ jobId: String(row.id), checkoutAt: new Date(checkoutMs).toISOString(), startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(), assigned: ['ASSIGNED', 'COMPLETED'].includes(row.status), startMs });
  }
  plans.sort((a, b) => a.startMs - b.startMs);
  if (!plans.length) return null;
  const { startMs, ...plan } = plans[0];
  return plan;
}

function sameReservation(a, b) {
  if (!a || !b) return a === b;
  if (a.uid != null && b.uid != null) return String(a.uid) === String(b.uid);
  return timeOf(a.checkIn) === timeOf(b.checkIn) && timeOf(a.checkOut) === timeOf(b.checkOut);
}

/**
 * 체류 상태가 아직 예약의 예정 퇴실을 처리하지 못했는데(RF-29) 서버·화면이 다음 예약이나
 * "예약 없음"(퇴실 시각이 지나 고를 예약이 없을 때 null)을 보내면, 지난 예약을 퇴실 전환이
 * 끝날 때까지 보존하고 받은 값은 대기시킨다(deferred). 전환 뒤 호출부가 pendingReservation을
 * 승격한다 — null도 승격할 값이다. 그 밖에는 받은 예약을 그대로 쓴다.
 * 다음 손님의 입실 시각까지 이미 지난 예약이 오면 보존하지 않는다(그 숙박이 지금 체류다).
 * 지금 예약과 같은 예약이 다시 오면 이미 대기 중인 값은 그대로 둔다(keepPending) — 늦게 온 같은 예약이
 * 대기 중인 다음 예약을 지우지 않게.
 */
export function planMonitoringReservationUpdate(currentReservation, incomingReservation, roomState, now = new Date()) {
  const nowMs = timeOf(now);
  const currentCheckOut = timeOf(currentReservation?.checkOut);
  const currentStayUnprocessed = roomState?.mainStatus === 'OCCUPIED'
    && Boolean(currentReservation)
    && Number.isFinite(nowMs)
    && Number.isFinite(currentCheckOut)
    && currentCheckOut <= nowMs;
  const incomingCheckIn = timeOf(incomingReservation?.checkIn);
  const sameIncomingStay = Boolean(currentReservation && incomingReservation
    && sameReservation(currentReservation, incomingReservation));
  // 입실 시각을 읽을 수 없는 다른 예약도 보존 쪽으로 — 지난 예약의 퇴실 전환을 잃는 것보다 한 주기 늦게 쓰는 게 낫다
  const replacesWithLaterOrNone = incomingReservation == null
    || (!sameReservation(currentReservation, incomingReservation)
      && (!Number.isFinite(incomingCheckIn) || incomingCheckIn > nowMs));

  if (currentStayUnprocessed && replacesWithLaterOrNone) {
    return { reservation: currentReservation, pendingReservation: incomingReservation ?? null, deferred: true, keepPending: false };
  }
  return {
    reservation: sameIncomingStay && currentReservation.stayId && !incomingReservation.stayId
      ? { ...incomingReservation, stayId: currentReservation.stayId }
      : incomingReservation,
    pendingReservation: null,
    deferred: false,
    keepPending: sameIncomingStay,
  };
}
