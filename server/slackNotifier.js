/**
 * Slack Incoming Webhook 발송.
 * PROPOS_SLACK_WEBHOOK 환경변수 없으면 no-op (로컬/테스트 안전).
 * 내용은 담지 않는다 — 링크만 전송. (reporting-feature-design.md 섹션 1)
 * 운영자에게 넘기는 종류는 무엇이 안 됐고 무엇을 해 달라는지 고정 문구를 앞에 붙인다(기록 내용은 넣지 않음, DEC-11·16).
 */
import { OPERATOR_ALERT_LABELS } from "../src/config/eventTypes.js";


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
 * @param {{ signal?: AbortSignal, label?: string }} [options] - 제한 시간과 이상 사건의 실제 기준 문구
 * @returns {Promise<{ sent: boolean }>}
 */
export async function notifyEvent(eventId, propertyId, type, { signal, label } = {}) {
  if (!WEBHOOK_URL) return { sent: false };

  const url = `${getBaseUrl()}/events/${eventId}`;
  const text = `[${propertyId}] ${label ?? OPERATOR_ALERT_LABELS[type] ?? type} → ${url}`;

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    ...(signal ? { signal } : {}),
  });

  return { sent: res.ok };
}

/** Independent operator channel when HA itself cannot deliver its own alert. */
export function hasOperatorAlertWebhook() {
  try { return new URL(process.env.PROPOS_SLACK_WEBHOOK).protocol === 'https:'; }
  catch { return false; }
}

export async function notifyPreparationSafety({ propertyId, message }) {
  if (!hasOperatorAlertWebhook()) return { sent: false };
  try {
    const response = await fetch(process.env.PROPOS_SLACK_WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `[${propertyId ?? '숙소'}] ${message}` }), signal: AbortSignal.timeout(10_000),
    });
    return { sent: response.ok };
  } catch { return { sent: false }; }
}
