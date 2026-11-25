/** Airbnb Gmail 답장 메일에서 RF-25 정본 신호만 추출한다. 원문은 반환하지 않는다. */

const TOPIC_KEYWORDS = Object.freeze({
  temperature: [
    '덥', '더워', '더움', '뜨겁', '추워', '추움', '춥', '온도', '에어컨', '냉방', '난방', '보일러',
    'hot', 'cold', 'temperature', 'air conditioner', 'air conditioning', 'heating', 'cooling',
  ],
  humidity: [
    '습도', '습해', '습함', '습하', '눅눅', '건조', '제습', '곰팡이',
    'humidity', 'humid', 'damp', 'dry', 'dehumidifier', 'mold', 'mould',
  ],
});

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !value) return '';
  return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
}

function parts(payload) {
  if (!payload || typeof payload !== 'object') return [];
  return [payload, ...(payload.parts ?? []).flatMap(parts)];
}

function header(message, name) {
  const wanted = name.toLowerCase();
  return (message?.payload?.headers ?? []).find(item => item?.name?.toLowerCase() === wanted)?.value ?? '';
}

function senderDomain(value) {
  return value.match(/@([a-z0-9.-]+)>?\s*$/i)?.[1]?.toLowerCase() ?? '';
}

function trustedAirbnbSender(value) {
  const domain = senderDomain(value);
  return domain === 'airbnb.com' || domain.endsWith('.airbnb.com');
}

function plainText(message) {
  return parts(message?.payload)
    .filter(part => part?.mimeType === 'text/plain')
    .map(part => decodeBase64Url(part?.body?.data))
    .filter(Boolean)
    .join('\n');
}

function groups(text) {
  return text.split(/(?:\r?\n){2,}/)
    .map(group => group.split(/\r?\n/).map(line => line.trim()).filter(Boolean))
    .filter(group => group.length);
}

function extractLatestMessage(text) {
  const blocks = groups(text);
  const replyAt = blocks.findIndex(block => block.some(line => /^(답장 보내기|reply(?:\b|$))/i.test(line)));
  if (replyAt < 1) return null;
  const messageBlock = blocks[replyAt - 1];
  // 실제 Airbnb 텍스트 메일은 발신자 표시명·보낸 시각 다음 줄부터 새 메시지다.
  if (messageBlock.length < 3) return null;
  const value = messageBlock.slice(2).join('\n').trim();
  return value || null;
}

function airbnbRefs(text) {
  const normalized = text.replaceAll('&amp;', '&');
  const roomIds = new Set([...normalized.matchAll(/airbnb\.[^/\s]+\/rooms\/(\d+)/gi)].map(match => match[1]));
  const threadIds = new Set([...normalized.matchAll(/airbnb\.[^/\s]+\/hosting\/thread\/(\d+)/gi)].map(match => match[1]));
  return {
    roomId: roomIds.size === 1 ? [...roomIds][0] : null,
    threadId: threadIds.size === 1 ? [...threadIds][0] : null,
  };
}
export function classifyGuestComplaintTopics(messageText) {
  const normalized = String(messageText ?? '').normalize('NFKC').toLowerCase();
  if (!normalized.trim()) return [];
  return Object.entries(TOPIC_KEYWORDS)
    .filter(([, keywords]) => keywords.some(keyword => normalized.includes(keyword)))
    .map(([topic]) => topic);
}

export function extractAirbnbListingId(icalUrl) {
  if (typeof icalUrl !== 'string') return null;
  try {
    const url = new URL(icalUrl);
    return url.pathname.match(/\/calendar\/ical\/(\d+)\.ics$/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function extractAirbnbGuestComplaint(message) {
  const id = typeof message?.id === 'string' ? message.id.trim() : '';
  if (!id || !trustedAirbnbSender(header(message, 'From')) || !/^\s*re\s*:/i.test(header(message, 'Subject'))) {
    return null;
  }
  const occurredMs = Number(message?.internalDate);
  if (!Number.isFinite(occurredMs)) return null;
  const text = plainText(message);
  const latestMessage = extractLatestMessage(text);
  if (!latestMessage) return null;
  const topics = classifyGuestComplaintTopics(latestMessage);
  if (!topics.length) return null;
  const refs = airbnbRefs(text);
  if (!refs.roomId || !refs.threadId) return null;
  return {
    gmailMessageId: id,
    gmailThreadId: typeof message.threadId === 'string' ? message.threadId : null,
    airbnbRoomId: refs.roomId,
    airbnbThreadId: refs.threadId,
    occurredAt: new Date(occurredMs).toISOString(),
    topics,
  };
}
