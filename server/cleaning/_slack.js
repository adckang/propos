/**
 * Slack 알림 단일 진입점. _dispatch.js와 _notify.js가 각자 복붙해서 쓰던 걸 통합.
 * Vercel 함수 수에 포함되지 않도록 server/ 아래에 둔다.
 */

const SLACK_WEBHOOK = process.env.PROPOS_SLACK_WEBHOOK;

/** 보내졌으면 true — 실패해도 예외를 던지지 않는다(기존 호출부는 결과를 쓰지 않음, RF-16 알림은 실패 시 다음에 다시 보냄) */
export async function postSlack(text) {
  if (!SLACK_WEBHOOK) return false;
  try {
    const response = await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) console.error("Slack 발송 실패:", response.status);
    return response.ok;
  } catch (e) {
    console.error("Slack 발송 실패:", e.message);
    return false;
  }
}
