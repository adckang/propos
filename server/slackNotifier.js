/**
 * Slack Incoming Webhook 발송.
 * PROPOS_SLACK_WEBHOOK 환경변수 없으면 no-op (로컬/테스트 안전).
 * 내용은 담지 않는다 — 링크만 전송. (reporting-feature-design.md 섹션 1)
 */

const WEBHOOK_URL = process.env.PROPOS_SLACK_WEBHOOK;

// PROPOS_BASE_URL 우선, 그 다음 Vercel 자동 주입 URL, 마지막 localhost
function getBaseUrl() {
  if (process.env.PROPOS_BASE_URL) return process.env.PROPOS_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:5173";
}

/**
 * 이벤트 발생을 Slack에 알린다.
 * @param {string} eventId - Postgres events.id (UUID)
 * @param {string} propertyId
 * @param {string} type - 이벤트 타입
 * @returns {Promise<{ sent: boolean }>}
 */
export async function notifyEvent(eventId, propertyId, type) {
  if (!WEBHOOK_URL) return { sent: false };

  const url = `${getBaseUrl()}/events/${eventId}`;
  const text = `[${propertyId}] ${type} → ${url}`;

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  return { sent: res.ok };
}
