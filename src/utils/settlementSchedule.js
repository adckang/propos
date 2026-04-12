// ============================================================
// settlementSchedule.js — 월말 정산 스케줄 유틸리티
// 순수 함수. 테스트 주입용 date 인수 지원.
// ============================================================

/**
 * 정산 실행일(매월 1일) 여부 확인
 * @param {Date} [date]  생략 시 현재 날짜 사용
 * @returns {boolean}
 */
export function isSettlementDay(date) {
  const d = date instanceof Date ? date : new Date();
  return d.getDate() === 1;
}

/**
 * 정산 대상 기간 계산 — 호출일 기준 전월
 * @param {Date} [date]  생략 시 현재 날짜 사용
 * @returns {{ year: number, month: number, label: string }}
 */
export function getSettlementPeriod(date) {
  const d = date instanceof Date ? date : new Date();
  const year  = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const month = d.getMonth() === 0 ? 12 : d.getMonth();   // getMonth()는 0-based
  return { year, month, label: `${year}년 ${month}월` };
}
