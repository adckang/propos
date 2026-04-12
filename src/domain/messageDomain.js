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
export function buildWelcomeMessage(booking, pinRecord) {
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

// ── S02 메시지 함수 ──────────────────────────────────────────

/**
 * 입실 확인 메시지 텍스트 조립 (순수 문자열 반환)
 * @param {{ guestName: string, propName: string, checkOut: string }} booking
 * @param {string} actualCheckInTime  - "HH:MM" (실제 입실 시각)
 * @returns {string}
 */
export function buildCheckinConfirmMessage(booking, actualCheckInTime) {
  if (!booking)            throw new Error('booking is required');
  if (!actualCheckInTime)  throw new Error('actualCheckInTime is required');

  const { guestName, checkOut } = booking;
  if (!guestName) throw new Error('booking.guestName is required');

  const checkOutFormatted = _formatDateTime(checkOut);

  const lines = [
    `${guestName}님, 입실이 확인되었습니다.`,
    `입실 시각: ${actualCheckInTime}`,
  ];

  if (checkOutFormatted) {
    lines.push(`체크아웃: ${checkOutFormatted}`);
  }

  lines.push(
    ``,
    `편안한 여행 되세요!`,
    `불편하신 점은 채팅으로 알려주세요.`
  );

  return lines.join('\n');
}

/**
 * PIN 오류 긴급 알림 텍스트 조립 (순수 문자열 반환)
 * @param {string} propId
 * @param {number} failCount
 * @returns {string}
 */
export function buildPinLockoutAlert(propId, failCount) {
  if (!propId)               throw new Error('propId is required');
  if (failCount == null)     throw new Error('failCount is required');
  if (typeof failCount !== 'number' || failCount < 0) throw new Error('failCount must be a non-negative number');

  return `PIN 오류 ${failCount}회 초과 — 도어락 잠금\n게스트 확인 필요 (${propId})`;
}

// ── S03 메시지 함수 ──────────────────────────────────────────

const _REPLY_TEMPLATES = [
  {
    keywords: ['wifi', '와이파이', '인터넷', 'wi-fi'],
    build: (b) => `안녕하세요 ${b.guestName}님!\nWiFi 관련 문의 감사합니다.\nSSID와 비밀번호를 다시 안내드릴게요. 잠시만 기다려 주세요.`,
  },
  {
    keywords: ['덥', '뜨겁', '더워', '춥', 'cold', 'hot', '온도', '에어컨', '냉방', '난방'],
    build: (b) => `안녕하세요 ${b.guestName}님!\n실내 온도 불편 사항을 전달해 주셔서 감사합니다.\n에어컨/난방 조절 방법을 안내해 드리겠습니다. 잠시만 기다려 주세요.`,
  },
  {
    keywords: ['청소', 'clean', '더럽', '냄새', '쓰레기'],
    build: (b) => `안녕하세요 ${b.guestName}님!\n불편을 드려 죄송합니다.\n청소 담당자가 신속하게 방문하도록 조치하겠습니다.`,
  },
  {
    keywords: ['체크아웃', 'checkout', '퇴실', '떠나', '나가'],
    build: (b) => `안녕하세요 ${b.guestName}님!\n체크아웃 안내드립니다.\n키는 현관에 두시고 문만 닫아 주시면 됩니다. 즐거운 여행 되셨길 바랍니다!`,
  },
];

/**
 * 게스트 메시지에서 키워드를 감지해 AI 답장 초안 생성 (순수 문자열 반환)
 * @param {string}  guestMessage
 * @param {{ guestName: string }} booking
 * @returns {string}
 */
export function buildReplyDraft(guestMessage, booking) {
  if (!guestMessage) throw new Error('guestMessage is required');
  if (!booking)      throw new Error('booking is required');
  if (!booking.guestName) throw new Error('booking.guestName is required');

  const lower = guestMessage.toLowerCase();

  for (const tpl of _REPLY_TEMPLATES) {
    if (tpl.keywords.some(kw => lower.includes(kw))) {
      return tpl.build(booking);
    }
  }

  return `안녕하세요 ${booking.guestName}님!\n문의 주셔서 감사합니다.\n확인 후 빠르게 답변 드리겠습니다.`;
}

// ── S04 메시지 함수 ──────────────────────────────────────────

/**
 * 체크아웃 감사 메시지 텍스트 조립 (순수 문자열 반환)
 * @param {{ guestName: string, propName?: string }} booking
 * @returns {string}
 */
export function buildCheckoutThankYouMessage(booking) {
  if (!booking)          throw new Error('booking is required');
  if (!booking.guestName) throw new Error('booking.guestName is required');

  const { guestName, propName } = booking;

  return [
    `${guestName}님, 퇴실이 확인되었습니다.`,
    `${propName ? propName + ' ' : ''}이용해 주셔서 감사합니다.`,
    ``,
    `다음에 또 방문해 주세요! 좋은 하루 보내세요.`,
  ].join('\n');
}
