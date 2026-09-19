/**
 * MetricRow 표시 로직 — EventMatrixPanel / FutureMatrixPanel 공유
 *
 * 모드 (우선순위 순):
 *   isCount — 건수 전용 행 (ratio 없음)
 *   noData  — 로딩/준비 중 상태
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
 * @param {{ numerator, denominator, isCount, noData }} params
 * @returns {{ countText, ratioText, ratioColor, ratioBg, failCount }}
 *   failCount — 드릴다운 트리거 기준 (>0 이면 onDrilldown 있을 때 tappable)
 */
export function computeMetricRowDisplay({ numerator, denominator, isCount = false, noData = false }) {
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
  const failCount = Math.max(0, denominator - numerator);
  return {
    countText:  `${numerator}/${denominator}건`,
    ratioText:  `${pct}%`,
    ratioColor: pctColor(pct),
    ratioBg:    pctBg(pct),
    failCount,
    pct,
  };
}
