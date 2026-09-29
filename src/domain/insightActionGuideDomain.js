/**
 * insightActionGuideDomain — "발견된 패턴"(insightDomain) 한 건을 눌렀을 때 뜨는 상세 팝업의
 * 내용을 결정하는 순수 함수들 (D-028).
 *
 * 팝업은 인사이트 모양에 따라 셋 중 하나다:
 *   - 'property_items'     — REPEAT/CONCENTRATION이면서 그 지표에 건별 상세 기록이 있음
 *                             → 기존 DrilldownSheet(async 모드)를 그대로 재사용해 실제 실패 목록을 보여줌
 *   - 'property_no_history'— REPEAT/CONCENTRATION인데 그 지표(현재는 cleaning_assign만)는
 *                             cleaning_jobs가 상태 이력을 안 남겨(단일 status 컬럼) 건별 목록이
 *                             원래 불가능함 — 집계 숫자만 정직하게 보여준다(꾸며내지 않음).
 *   - 'scope_comparison'    — MONTH_OVER_MONTH/CONSECUTIVE처럼 숙소 하나로 특정되지 않는 패턴
 *                             → 실패 목록 대신 기간별 비교 수치(2개월 또는 N개월)를 보여준다.
 *
 * "해야 할 일"은 두 축의 조합이다: 패턴 타입(왜 이 패턴으로 뽑혔는지 힌트) + 지표(무엇이
 * 실패했는지 점검 체크리스트). 둘 다 규칙(고정 텍스트)일 뿐 추측·AI 판단이 아니다.
 *
 * 월간·주간(D-029) 인사이트 둘 다 다룬다 — `insight.periodUnit`으로 문구를 분기.
 */

import { periodLabel } from './insightDomain.js';

// 건별 드릴다운이 가능한 지표 — api/stats/drilldown이 실제로 지원하는 6개(cleaning_assign 제외).
const DRILLABLE_METRICS = new Set([
  'pre_stay_optimization',
  'post_checkout_energy',
  'post_checkout_security',
  'vacant_energy',
  'post_cleaning_security',
  'cleaning_time',
]);

/**
 * @param {object} insight  insightDomain.buildMonthlyInsights가 반환하는 원소 하나
 * @returns {'property_items'|'property_no_history'|'scope_comparison'}
 */
export function insightDrilldownShape(insight) {
  if (insight.propertyId == null) return 'scope_comparison';
  return DRILLABLE_METRICS.has(insight.metricKey) ? 'property_items' : 'property_no_history';
}

// ── 해야 할 일 ────────────────────────────────────────────────────────────────
const METRIC_ACTION_GUIDE = Object.freeze({
  pre_stay_optimization:  '체크인 전 자동화 씬이 트리거 시간에 정상 실행됐는지, 스마트기기가 응답했는지 확인해보세요.',
  post_checkout_energy:   '퇴실 감지 후 조명·냉난방 자동 차단 씬이 정상 실행되는지, 스마트플러그 연결 상태를 확인해보세요.',
  post_checkout_security: '도어락 자동 잠금, 창문 센서 자동화가 정상인지 확인해보세요.',
  vacant_energy:          '청소자가 청소 중 켜둔 걸 끄고 나가는지, 절전 재실행 로직을 확인해보세요.',
  post_cleaning_security: '청소 후 문단속 절차, 청소자 교육이 필요한지 확인해보세요.',
  cleaning_time:          '담당 청소자와 소통해보고, 숙소 면적 대비 배정 시간이 현실적인지 확인해보세요.',
  cleaning_assign:        '그 숙소 담당 청소 인력 풀이 부족한 건 아닌지, 배정 알림이 제대로 가는지 확인해보세요.',
});

// MONTH_OVER_MONTH/CONSECUTIVE는 "지난달"/"몇 달째" 같은 단위 표현이 들어가 있어 월/주 두
// 버전을 따로 둔다 — 나머지(REPEAT/CONCENTRATION)는 특정 기간명을 언급하지 않아 공용.
const TYPE_HINT = Object.freeze({
  REPEAT:        '한 번이 아니라 계속되고 있어요 — 우연이 아닐 가능성이 큽니다.',
  CONCENTRATION: '다른 숙소는 괜찮은데 이 숙소만 그래요 — 그 숙소 고유의 원인부터 의심하세요.',
});
const TYPE_HINT_BY_UNIT = Object.freeze({
  month: Object.freeze({
    MONTH_OVER_MONTH: '지난달과 뭐가 달라졌는지부터 확인하세요 (담당자 교체, 신규 숙소, 계절·설정 변경 등).',
    CONSECUTIVE:      '몇 달째 이어지고 있어요 — 일시적 문제가 아니라 구조적 문제일 가능성이 높습니다.',
  }),
  week: Object.freeze({
    MONTH_OVER_MONTH: '지난주와 뭐가 달라졌는지부터 확인하세요 (담당자 교체, 신규 숙소, 이벤트성 변화 등).',
    CONSECUTIVE:      '몇 주째 이어지고 있어요 — 일시적 문제가 아니라 구조적 문제일 가능성이 높습니다.',
  }),
});

/**
 * @param {object} insight
 * @returns {string} "[타입 힌트] [지표 체크리스트]" 한 문단
 */
export function describeInsightAction(insight) {
  const unit = insight.periodUnit ?? 'month';
  const hint = TYPE_HINT[insight.type] ?? TYPE_HINT_BY_UNIT[unit]?.[insight.type] ?? '';
  const checklist = METRIC_ACTION_GUIDE[insight.metricKey] ?? '';
  return [hint, checklist].filter(Boolean).join(' ');
}

// ── scope_comparison 팝업 내용 ─────────────────────────────────────────────────
function pct(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

/**
 * MONTH_OVER_MONTH/CONSECUTIVE 인사이트의 evidence를 팝업에 그릴 비교 행 배열로 바꾼다.
 * MONTH_OVER_MONTH → 2행(지난 기간/이번 기간), CONSECUTIVE → N행(연속된 각 기간, 과거→최근).
 *
 * @param {object} insight
 * @returns {{ label: string, text: string }[]}
 */
export function buildScopeComparisonRows(insight) {
  const unit = insight.periodUnit ?? 'month';
  if (insight.type === 'MONTH_OVER_MONTH') {
    const { previousNumerator, previousDenominator, currentNumerator, currentDenominator } = insight.evidence;
    const previousFail = Math.max(0, previousDenominator - previousNumerator);
    const currentFail  = Math.max(0, currentDenominator - currentNumerator);
    const lastWord = unit === 'week' ? '지난주' : '지난달';
    const thisWord = unit === 'week' ? '이번 주' : '이번 달';
    return [
      { label: lastWord, text: `${previousDenominator}건 중 ${previousFail}건 실패 (${pct(previousFail, previousDenominator)}%)` },
      { label: thisWord, text: `${currentDenominator}건 중 ${currentFail}건 실패 (${pct(currentFail, currentDenominator)}%)` },
    ];
  }
  if (insight.type === 'CONSECUTIVE') {
    return insight.evidence.periodCounts.map(({ period, failCount }) => ({
      label: periodLabel(period, unit),
      text: `${failCount}건 실패`,
    }));
  }
  return [];
}

/**
 * scope_comparison 팝업의 제목 접미사 — MONTH_OVER_MONTH는 2개 기간 비교("전월/전주 대비"),
 * CONSECUTIVE는 N개 기간 추이("월별/주별 추이")라 같은 문구를 쓰면 안 맞는다(리뷰로 발견,
 * 2026-09-28: 처음엔 두 타입·월/주 구분 없이 "— 전월 대비"로 고정돼 있었음).
 *
 * @param {object} insight
 * @returns {string} 예: " — 전주 대비", " — 월별 추이"
 */
export function describeScopeComparisonTitle(insight) {
  const unit = insight.periodUnit ?? 'month';
  if (insight.type === 'CONSECUTIVE') {
    return unit === 'week' ? ' — 주별 추이' : ' — 월별 추이';
  }
  return unit === 'week' ? ' — 전주 대비' : ' — 전월 대비';
}
