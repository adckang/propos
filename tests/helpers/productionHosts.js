// RF-23: 단위·기능 테스트가 진짜 네트워크로 닿으면 안 되는 운영 쪽 주소.
// 운영 사이트·API·집 Pi 워처(proposonline.com), Vercel, Slack, Neon(DB), Upstash(KV), Google(캘린더·Gmail·FCM), 집 HA.
const PRODUCTION_HOST = /(^|\.)(proposonline\.com|vercel\.app|slack\.com|neon\.tech|upstash\.io|googleapis\.com)$|^192\.168\.45\.76$/i;

export function isProductionHost(hostname) {
  return typeof hostname === 'string' && PRODUCTION_HOST.test(hostname);
}
