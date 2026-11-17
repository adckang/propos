/**
 * MetricRow 표시 로직 — EventMatrixPanel / FutureMatrixPanel 공유
 *
 * 모드 (우선순위 순):
 *   rateExcluded — 판정 기록이 없어 성공률을 정책상 측정 제외한 행 (RF-26: 대상 건수·실제 실패 배지만)
 *   isCount — 건수 전용 행 (ratio 없음)
 *   noData  — 로딩/준비 중 상태
 *   dataUnavailable — 값을 못 불러온 행 ("데이터 없음", RF-26)
 *   (그 밖에 분모 0 → "해당 없음")
 *   ratio   — 기본 n/m건 + % 행
 */

const COLOR_GREEN = '#059669';
const COLOR_AMBER = '#d97706';
const COLOR_RED   = '#dc2626';
const COLOR_MUTED = '#94a3b8';

const BG_GREEN = '#dcfce7';
const BG_AMBER = '#fef9c3';
const BG_RED   = '#fee2e2';

export function pctColor(pct) {
  if (pct >= 90) return COLOR_GREEN;
  if (pct >= 70) return COLOR_AMBER;
  return COLOR_RED;
}

export function pctBg(pct) {
  if (pct >= 90) return BG_GREEN;
  if (pct >= 70) return BG_AMBER;
  return BG_RED;
}

/**
 * @param {{ numerator, denominator, isCount, noData, rateExcluded, dataUnavailable, observedFailCount }} params
 *   noData — 로딩 중("준비 중"). dataUnavailable — 값을 못 불러온 지표("데이터 없음", RF-26).
 *   rateExcluded — 판정 기록이 없어 성공률을 정책상 측정 제외한 지표(RF-26). 대상 건수와 실제 감지 실패는 그대로 보이고
 *   성공률 칸만 "측정 제외". observedFailCount — 그 지표에서 실제로 감지된 실패 건수(대상이 0이어도 숨기지 않는다).
 * @returns {{ countText, ratioText, ratioColor, ratioBg, failCount }}
 *   failCount — 드릴다운 트리거 기준 (>0 이면 onDrilldown 있을 때 tappable)
 */
export function computeMetricRowDisplay({ numerator, denominator, isCount = false, noData = false, rateExcluded = false, dataUnavailable = false, observedFailCount = null }) {
  if (rateExcluded) {
    // 대상 건수는 0이어도 그대로 보인다("0건") — 대상 건수를 유지한다는 RF-26 계약
    return {
      countText:  `${denominator ?? 0}건`,
      ratioText:  '측정 제외',
      ratioColor: COLOR_MUTED,
      ratioBg:    'transparent',
      failCount:  observedFailCount ?? 0,
      compactText: true,
    };
  }

  if (isCount) {
    const count = numerator != null ? numerator : null;
    return {
      countText:  count != null ? `${count}건` : '—',
      ratioText:  '—',
      ratioColor: COLOR_MUTED,
      ratioBg:    'transparent',
      failCount:  count != null && count > 0 ? count : 0,
    };
  }

  if (noData) {
    return {
      countText:  '—',
      ratioText:  '준비 중',
      ratioColor: COLOR_MUTED,
      ratioBg:    'transparent',
      failCount:  0,
    };
  }

  // 대상은 있을 수 있는데 값을 못 불러온 지표(rateEligibility = no_data, RF-26) — "해당 없음"(대상 없음)과
  // 구분한다. 로딩 중 "준비 중"(noData)과도 다른 상태다.
  if (dataUnavailable) {
    return {
      countText:  '—',
      ratioText:  '데이터 없음',
      ratioColor: COLOR_MUTED,
      ratioBg:    'transparent',
      failCount:  0,
      compactText: true,
    };
  }

  const isEmpty = numerator == null || denominator == null || denominator === 0;
  if (isEmpty) {
    return {
      countText:  '—',
      ratioText:  '해당 없음',
      ratioColor: COLOR_MUTED,
      ratioBg:    'transparent',
      failCount:  0,
    };
  }

  const pct       = Math.round((numerator / denominator) * 100);
  // 도메인이 넘긴 실제 감지 실패가 있으면 그대로(요약 "실패 N건"·패턴과 같은 출처), 없으면 분모 − 분자
  const failCount = observedFailCount ?? Math.max(0, denominator - numerator);
  return {
    countText:  `${numerator}/${denominator}건`,
    ratioText:  `${pct}%`,
    ratioColor: pctColor(pct),
    ratioBg:    pctBg(pct),
    failCount,
    pct,
  };
}
