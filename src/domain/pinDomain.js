/**
 * pinDomain — PIN 생성/유효기간 순수 도메인 함수
 * 외부 의존성 없음. 입력 → 출력만.
 */

/**
 * 6자리 랜덤 PIN 생성
 * @returns {string} "000000"~"999999"
 */
export function generatePIN() {
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(6, '0');
}

/**
 * PIN 유효기간 계산
 * validFrom  = checkIn - 1시간
 * validUntil = checkOut
 *
 * @param {string} checkIn  - ISO 8601 (예: "2026-03-28T15:00:00")
 * @param {string} checkOut - ISO 8601 (예: "2026-03-30T11:00:00")
 * @returns {{ validFrom: string, validUntil: string }}
 */
export function calcExpiry(checkIn, checkOut) {
  if (!checkIn || !checkOut) throw new Error('checkIn and checkOut are required');

  const from = new Date(_asUTC(checkIn));
  if (isNaN(from.getTime())) throw new Error('Invalid checkIn date: ' + checkIn);

  const until = new Date(_asUTC(checkOut));
  if (isNaN(until.getTime())) throw new Error('Invalid checkOut date: ' + checkOut);

  if (until <= from) throw new Error('checkOut must be after checkIn');

  const validFrom = new Date(from.getTime() - 60 * 60 * 1000);

  return {
    validFrom:  validFrom.toISOString(),
    validUntil: until.toISOString(),
  };
}

/**
 * timezone 정보 없는 ISO 문자열을 UTC로 간주
 * @param {string} dateStr
 * @returns {string}
 */
function _asUTC(dateStr) {
  if (dateStr.endsWith('Z') || dateStr.includes('+') || /\d{2}-\d{2}:\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  return dateStr + 'Z';
}
