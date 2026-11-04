/** 예약에 저장된 청소 시각을 우선하고, 없으면 퇴실 + 기본 청소시간을 쓴다. */
export function reservationCleaningWindow(reservation, durationHours = 2.5) {
  const asDate = value => {
    if (value == null) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const checkout = asDate(reservation?.checkOut);
  if (!checkout) return null;
  const start = asDate(reservation.cleaningAt), end = asDate(reservation.cleaningEnd);
  if (start && end && start >= checkout && end > start) return { start, end };
  const duration = Number(durationHours);
  const hours = Number.isFinite(duration) && duration > 0 ? duration : 2.5;
  return { start: checkout, end: new Date(checkout.getTime() + hours * 3_600_000) };
}
