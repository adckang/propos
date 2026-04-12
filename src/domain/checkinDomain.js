/**
 * checkinDomain — 체크인 당일 판별 순수 도메인 함수
 * 외부 의존성 없음. 입력 → 출력만.
 */

/**
 * 도어락 열림 이벤트가 게스트 체크인인지 판별
 * @param {{ event: string, propId: string, time: string, context?: string }} haEvent
 * @param {{ propId: string, checkIn: string, checkOut: string, status: string }} booking
 * @param {string} now  - "HH:MM" (테스트 주입용)
 * @returns {boolean}
 *
 * true 조건:
 *   event.context === "guest_checkin"
 *   AND booking.status === "confirmed"
 *   AND now가 getCheckinWindow(booking.checkIn) 범위 내
 */
export function isCheckinEvent(haEvent, booking, now) {
  if (!haEvent)  throw new Error('haEvent is required');
  if (!booking)  throw new Error('booking is required');
  if (!now)      throw new Error('now is required');

  if (haEvent.context !== 'guest_checkin') return false;
  if (booking.status !== 'confirmed')      return false;

  const window = getCheckinWindow(booking.checkIn);
  return _isTimeInWindow(now, window.from, window.until);
}

/**
 * 체크인 가능 시간창 계산
 * @param {string} checkIn  - ISO 8601 (예: "2026-03-28T15:00:00")
 * @returns {{ from: string, until: string }}  "HH:MM" 형식
 * from  = checkIn - 1시간
 * until = checkIn + 5시간
 */
export function getCheckinWindow(checkIn) {
  if (!checkIn) throw new Error('checkIn is required');

  // ISO 문자열에서 시/분을 직접 파싱 — new Date()의 로컬/UTC 혼용 방지
  const match = String(checkIn).match(/T(\d{2}):(\d{2})/);
  if (!match) throw new Error('Invalid checkIn date');

  const totalMins = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);

  return {
    from:  _minsToHHMM(Math.max(0, totalMins - 60)),
    until: _minsToHHMM(Math.min(23 * 60 + 59, totalMins + 5 * 60)),
  };
}

// ── private helpers ──────────────────────────────────────────

/**
 * 분(0~1439) → "HH:MM"
 * @param {number} mins
 * @returns {string}
 */
function _minsToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * "HH:MM" 문자열이 [from, until] 범위 내인지 (자정 경계 미고려 — 단순 문자열 비교)
 * @param {string} time
 * @param {string} from
 * @param {string} until
 * @returns {boolean}
 */
function _isTimeInWindow(time, from, until) {
  // until이 from보다 작으면 자정을 넘는 케이스 (미지원 — 단순 비교)
  return time >= from && time <= until;
}
