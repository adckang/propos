'use strict';

/**
 * messageDomain — 메시지 텍스트 조립 순수 도메인 함수
 * 외부 의존성 없음. 입력 → 출력만.
 */

/**
 * 웰컴 메시지 텍스트 조립
 * @param {{ guestName: string, propName: string, checkIn: string, wifi: { ssid: string, pw: string } }} booking
 * @param {{ pin: string, validFrom: string, validUntil: string }} pinRecord
 * @returns {string}
 */
function buildWelcomeMessage(booking, pinRecord) {
  if (!booking) throw new Error('booking is required');
  if (!pinRecord) throw new Error('pinRecord is required');

  const { guestName, propName, checkIn, wifi } = booking;
  const { pin } = pinRecord;

  if (!guestName) throw new Error('booking.guestName is required');
  if (!pin)       throw new Error('pinRecord.pin is required');

  const checkInFormatted = _formatDateTime(checkIn);

  const lines = [
    `안녕하세요 ${guestName}님!`,
    `${propName ? propName + ' ' : ''}내일 체크인 안내드립니다.`,
    ``,
    `도어락 PIN: ${pin}`,
    `체크인: ${checkInFormatted} 이후 입실 가능합니다.`,
  ];

  if (wifi && wifi.ssid) {
    lines.push(`WiFi: ${wifi.ssid} / ${wifi.pw || ''}`);
  }

  lines.push(``, `불편하신 점은 채팅으로 알려주세요.`);

  return lines.join('\n');
}

/**
 * ISO 8601 → "YYYY-MM-DD HH:MM" 형식
 * @param {string} iso
 * @returns {string}
 */
function _formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

module.exports = { buildWelcomeMessage };
