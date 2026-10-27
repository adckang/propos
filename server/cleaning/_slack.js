/**
 * Slack 알림 단일 진입점. _dispatch.js와 _notify.js가 각자 복붙해서 쓰던 걸 통합.
 * Vercel 함수 수에 포함되지 않도록 server/ 아래에 둔다.
 */

const SLACK_WEBHOOK = process.env.PROPOS_SLACK_WEBHOOK;

export async function postSlack(text) {
  if (!SLACK_WEBHOOK) return;
  await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch((e) => console.error("Slack 발송 실패:", e.message));
}
