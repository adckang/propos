/**
 * activeWeekDomain — this_week 통합 stats 분리 로직
 *
 * this_week 기간의 stats 객체에는 두 패널이 공유하는 필드가 섞여 있다:
 *   - pastStats  → EventMatrixPanel (완료 지표)
 *   - futureStats → FutureMatrixPanel ({ checkIns: 남은 체크인 예정 수 })
 *
 * checkIns 필드만 futureStats로 분리; 나머지 전체는 pastStats.
 */

const FUTURE_FIELDS = new Set(['checkIns']);

/**
 * @param {object|null|undefined} stats
 * @returns {{ pastStats: object|null, futureStats: object|null }}
 */
export function splitActiveStats(stats) {
  if (stats == null) return { pastStats: null, futureStats: null };

  const pastStats = {};
  for (const [key, val] of Object.entries(stats)) {
    if (!FUTURE_FIELDS.has(key)) pastStats[key] = val;
  }

  return {
    pastStats,
    futureStats: {
      checkIns: 'checkIns' in stats ? stats.checkIns : null,
    },
  };
}
