import { describePeriod } from './periodDomain.js';

// 2026-11-10 사용자 결정: 지난 모든 기간에 기존 노쇼 안내를 동일하게 표시한다.
// 지표·집계값은 그대로 두고 운영/명시적 DEMO가 같은 표시 규칙을 사용한다.
export function appendPastNoShowNotice(period, stats, summary) {
  if (describePeriod(period)?.tense !== 'past') return summary;
  const count = stats.noShowSuspected ?? 0;
  return count > 0 ? `${summary} 노쇼 의심 ${count}건 확인이 필요해요.` : summary;
}
