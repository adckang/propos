// GET /api/cron/tick-evening — UTC 13:00 (KST 22:00) 저녁 결산 크론
// tick.js와 동일한 핸들러. KST 시각(22시)을 감지해 daily-result만 실행.
export { default } from "./tick.js";
