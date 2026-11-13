/**
 * 청소 요청 시각 규칙 — 순수 함수(브라우저·서버 공용). server/cleaning/_dispatch.js 가 그대로 다시 내보낸다.
 */

// 청소 시작까지 이만큼 이하로 남았으면 바로 요청한다(SHORT_NOTICE)
export const SHORT_NOTICE_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * 새 청소 작업의 출처와 첫 요청 시각 — 작업을 만드는 곳(iCal 동기화·월간 배치·관리자 일괄 등록·백필 스크립트)이 같은 규칙을 쓴다
 * (docs/cleaning-scenario-matrix.md S01·S03·S04: 2주 이내 신규 예약은 바로, 그 밖은 청소 2주 전).
 * 청소 시작이 SHORT_NOTICE_DAYS 일 안이면 지금, 그보다 멀면 시작 SHORT_NOTICE_DAYS 일 전.
 * 발송 시각을 저장하지 않으면 DB 기본값(지금)이 들어가 다음 크론이 몇 달 뒤 청소 요청을 바로 보낸다
 * (2026-10-12 백필에서 실제로 발생 — 12월·내년 9월 퇴실 요청이 그날 밤 나가 아무도 받지 않고 "배정 실패"가 됨, RF-17).
 * 월간 배치(매월 15일)도 다음 달 일정의 요청 시각을 이 규칙(+같은 날 여러 건은 10분 간격)으로 잡는다 — 예전엔 "지금"으로 덮어써
 * 다음 달 요청이 15일에 한꺼번에 나갔다(RF-19).
 * 이미 지난 시작은 "지금"을 돌려주지만, 크론은 시작이 지난 작업을 발송하지 않는다.
 */
export function planJobDispatch(cleaningStartAt, now = Date.now()) {
  const startMs = new Date(cleaningStartAt).getTime();
  const nowMs = new Date(now).getTime();
  if ((startMs - nowMs) / DAY_MS <= SHORT_NOTICE_DAYS) return { source: 'SHORT_NOTICE', dispatchAfter: new Date(nowMs) };
  return { source: 'MONTHLY_BATCH', dispatchAfter: new Date(startMs - SHORT_NOTICE_DAYS * DAY_MS) };
}
