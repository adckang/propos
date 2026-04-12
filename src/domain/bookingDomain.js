/**
 * bookingDomain — 예약 관련 순수 도메인 함수
 * 외부 의존성 없음. 입력 → 출력만.
 */

/**
 * 익일 체크인 + confirmed 상태 예약만 필터링
 * @param {Array}  bookings - 전체 예약 목록
 * @param {string} today    - "YYYY-MM-DD" (테스트 주입용)
 * @returns {Array}
 */
export function filterTomorrowCheckIns(bookings, today) {
  if (!Array.isArray(bookings)) return [];

  const tomorrow = _addDays(today, 1);

  return bookings.filter(b => {
    if (!b || !b.checkIn || !b.status) return false;
    const checkInDate = b.checkIn.slice(0, 10);
    return checkInDate === tomorrow && b.status === 'confirmed';
  });
}

/**
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {number} days
 * @returns {string} "YYYY-MM-DD"
 */
function _addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
