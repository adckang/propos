import { describePeriod } from './periodDomain.js';

// 요약 배너를 빨간 경고로 띄울 문장 — "이상 없었어요" 같은 정상 문장과 구분하기 위해 구체적 표현만 매칭한다.
// "이상감지"는 반드시 뒤에 [1-9]로 시작하는 건수가 붙어야 매칭한다 — "이상감지 0건이 있었어요"처럼 0건이
// 그대로 들어가는 문장이 빨간 배너로 뜨던 버그가 실사용 중 실제로 발견됐다(2026-09-26).
// "불안정해요"는 summarizeOperationalMetrics 5단계 등급 중 하위 두 단계에서만 쓰는 문구 — "완벽해요"/
// "양호해요"/"보통이에요"는 urgent 취급하지 않는다(D-026 후속, 2026-09-25).
// "실패 N건이 있(었)어요"는 계산 가능한 지표가 0개인데 실제 실패가 있을 때의 문장(RF-26, 사용자 결정 2026-11-17).
// 실패를 초록 체크로 보이지 않게 이 문장에만 경고색을 쓴다 — "양호해요 (실패 N건)"처럼 괄호 안 실패 건수는
// 매칭하지 않아 기존 등급 색 규칙이 그대로다.
const URGENT_SUMMARY_PATTERNS = [/이상감지 [1-9]\d*건/, /이상 징후/, /바로 확인/, /불안정해요/, /실패 [1-9]\d*건이 있(?:었)?어요/];

/** 요약 문장을 빨간 경고 배너로 보일지. SummaryBanner가 이 함수 하나를 쓴다. */
export function isUrgentSummary(text) {
  return typeof text === 'string' && URGENT_SUMMARY_PATTERNS.some(p => p.test(text));
}

// 2026-11-10 사용자 결정: 지난 모든 기간에 기존 노쇼 안내를 동일하게 표시한다.
// 지표·집계값은 그대로 두고 운영/명시적 DEMO가 같은 표시 규칙을 사용한다.
export function appendPastNoShowNotice(period, stats, summary) {
  if (describePeriod(period)?.tense !== 'past') return summary;
  const count = stats.noShowSuspected ?? 0;
  return count > 0 ? `${summary} 노쇼 의심 ${count}건 확인이 필요해요.` : summary;
}
