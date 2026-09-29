/**
 * operationalMetricsDomain — 7개 운영 지표("완료" 섹션)의 정의·계산·요약 문장을 한 곳에서 관리.
 *
 * EventMatrixPanel(표 렌더링)과 generateSummary/SelectedPropertyReport(요약 문장) 양쪽이 이
 * 파일을 공유한다 — 표에 뜨는 라벨·숫자와 그 위 요약 문장이 항상 같은 숫자를 말하게 하기 위함.
 * (사용자 요청 2026-09-25: "진짜 담당자가 보고하는 느낌으로" 요약 문장 + 표 워딩 개선 — D-026)
 */

import { describePeriod } from './periodDomain.js';

/**
 * stats(countPeriodEvents + injectCleaningMetrics 결과) → 7개 지표 원자료(라벨+분자+분모).
 * @param {object} stats
 * @returns {{ key: string, label: string, numerator: number|null, denominator: number|null }[]}
 */
export function computeOperationalMetrics(stats) {
  if (!stats) return [];

  const checkOuts        = stats.checkOuts        ?? 0;
  // countPeriodEvents는 cleaningFinished를 항상 명시적으로 채운다(집계 0건이어도 undefined가 아님) —
  // 여기서 undefined인 경우는 stats 자체가 이 지표를 아예 담고 있지 않은 것(예: 얕은 테스트 픽스처,
  // generateSummary의 옛 fallback 경로)이므로 checkOuts로 대신 채우지 않고 0으로 둔다. checkOuts로
  // 대신 채우면 "청소 데이터가 없을 뿐"인 걸 "청소시간 기준 미달"로 잘못 셀 수 있다.
  const cleaningFinished = stats.cleaningFinished  ?? 0;

  // 역산 패턴: 위반 건수를 분모에서 빼면 적용(성공) 건수
  const postCheckoutEnergyOk   = Math.max(0, checkOuts - (stats.postCheckoutEnergyWaste ?? 0));
  const postCheckoutSecurityOk = Math.max(0, checkOuts - (stats.postCheckoutSecurityBreach ?? 0));
  const vacantEnergyOk         = Math.max(0, cleaningFinished - (stats.vacantEnergyWaste ?? 0));
  const postCleaningSecurityOk = Math.max(0, cleaningFinished - (stats.postCleaningSecurityBreach ?? 0));

  return [
    { key: 'pre_stay_optimization',  label: '게스트 맞이 준비', numerator: stats.preStayOptimized ?? 0, denominator: stats.preStayAttempts ?? 0 },
    { key: 'post_checkout_energy',   label: '퇴실 후 절전',     numerator: postCheckoutEnergyOk,        denominator: checkOuts },
    { key: 'post_checkout_security', label: '퇴실 후 보안',     numerator: postCheckoutSecurityOk,      denominator: checkOuts },
    { key: 'vacant_energy',          label: '빈방 절전 유지',   numerator: vacantEnergyOk,              denominator: cleaningFinished },
    { key: 'post_cleaning_security', label: '빈방 보안 유지',   numerator: postCleaningSecurityOk,      denominator: cleaningFinished },
    { key: 'cleaning_time',          label: '청소시간 준수',    numerator: stats.cleaningOnTime ?? 0,   denominator: cleaningFinished },
    // cleaning_jobs 집계값 그대로 — 조회 실패(null)면 "해당 없음", 체크아웃 수로 대체하지 않는다
    { key: 'cleaning_assign',        label: '청소 담당자 배정', numerator: stats.cleaningAssigned,      denominator: stats.cleaningCreated },
  ];
}

/**
 * 측정 가능한(분모>0, 분자 있음) 지표만 pct·failCount를 붙여 반환. 안심지수·요약 문장 둘 다 이걸 쓴다.
 * @param {object} stats
 * @returns {{ key, label, numerator, denominator, pct, failCount }[]}
 */
export function computeMeasurableMetrics(stats) {
  return computeOperationalMetrics(stats)
    .filter(m => (m.denominator ?? 0) > 0 && m.numerator != null)
    .map(m => ({
      ...m,
      pct: Math.round((m.numerator / m.denominator) * 100),
      failCount: Math.max(0, m.denominator - m.numerator),
    }));
}

// 5단계 등급 — measurable 지표의 평균 점수(= 표 하단 "안심지수"와 같은 계산) 기준.
// "완벽해요"는 평균이 아니라 실패 총건수 0으로 직접 판정한다 — 평균은 반올림되므로 실패가
// 있어도 100으로 반올림될 여지가 있고, 그러면 "완벽해요 (실패 1건)" 같은 모순 문장이 나온다.
const TIER_BY_MIN_SCORE = [
  { min: 90, label: '양호해요' },
  { min: 75, label: '보통이에요' },
  { min: 50, label: '조금 불안정해요' },
  { min: 0,  label: '아주 불안정해요' },
];

function tierLabel(avgScore, totalFails) {
  if (totalFails === 0) return '완벽해요';
  return TIER_BY_MIN_SCORE.find(t => avgScore >= t.min).label;
}

/**
 * "지난주 양호해요 (실패 3건)" 같은 5단계 등급 + 실패 총건수 한 줄 요약. 측정 가능한 지표가
 * 하나도 없으면 null(호출부가 기존 문장으로 대체). 등급 기준은 표 하단 "안심지수"와 같은
 * 평균 점수라, 요약의 등급과 표를 펼쳤을 때 보이는 숫자가 항상 서로 맞아떨어진다.
 *
 * @param {string} period  — periodDomain이 아는 기간 키 (last_week/this_month/yesterday 등)
 * @param {object} stats
 * @returns {string|null}
 */
export function summarizeOperationalMetrics(period, stats) {
  const desc = describePeriod(period);
  if (!desc || (desc.tense !== 'past' && desc.tense !== 'active')) return null;

  const measurable = computeMeasurableMetrics(stats);
  if (measurable.length === 0) return null;

  const avgScore    = Math.round(measurable.reduce((sum, m) => sum + (m.numerator / m.denominator) * 100, 0) / measurable.length);
  const totalFails  = measurable.reduce((sum, m) => sum + m.failCount, 0);

  return `${desc.label} ${tierLabel(avgScore, totalFails)} (실패 ${totalFails}건)`;
}
