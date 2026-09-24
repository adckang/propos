/**
 * nowMarkerDomain — 캘린더의 "지금" 표시 계산 (순수 함수)
 *
 * 월간 캘린더는 KST 달력 날짜로 칸을 나누므로 "오늘"과 하루 중 위치도 KST 기준으로 계산한다.
 * 시각 라벨 형식은 리스트 화면의 "지금" 표식과 같다 (AM/PM + 12시간제).
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * @param {Date} [now]
 * @returns {{ dateKey: string, dayFraction: number, label: string }}
 *   dateKey     — KST 오늘 'YYYY-MM-DD' (월간 캘린더 칸의 key 와 같은 형식)
 *   dayFraction — KST 하루 중 지난 비율 [0, 1)  (0 = 00:00, 0.5 = 정오)
 *   label       — 'AM 12:05' · 'PM 1:53' 형식 (리스트 화면과 동일)
 */
export function kstNowMarker(now = new Date()) {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  const hours = shifted.getUTCHours();
  const msOfDay = ((shifted.getTime() % DAY_MS) + DAY_MS) % DAY_MS;

  return {
    dateKey: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
    dayFraction: msOfDay / DAY_MS,
    label: `${hours < 12 ? 'AM' : 'PM'} ${hours % 12 || 12}:${pad2(shifted.getUTCMinutes())}`,
  };
}
