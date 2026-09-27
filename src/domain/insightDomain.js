/**
 * insightDomain — 월간 레포트 Summary 하위에 보여줄 "발견된 패턴" 최대 3문장.
 *
 * 이 기능은 통계적 추론이나 AI 추천이 아니다. 기존 표에 이미 있는 숫자들(지표별 성공률 등)
 * 사이에서, 사람이 여러 표·숙소·기간을 직접 비교해야 알아챌 수 있는 관계를 **정해진 규칙**으로
 * 자동으로 찾아주는 것뿐이다. "합리적으로 판단"/"의미 있다고 판단" 같은 주관적 로직은 없다 —
 * 모든 발생 조건은 아래 INSIGHT_THRESHOLDS 하나로만 정의된다.
 *
 * V1 범위: REPEAT / CONCENTRATION / MONTH_OVER_MONTH / CONSECUTIVE 4종만 구현.
 * CO_OCCURRENCE·WORKER_CONCENTRATION은 "같은 사건인지" 신뢰성 있게 판별할 방법이 지금 데이터
 * 구조로는 부족해 보류(사용자 결정, 2026-09-28).
 *
 * 파이프라인: detect(타입별) → (threshold는 detect 안에서 이미 적용됨) → rankInsights에서
 * dedupe → 결정적 정렬 → 상위 3개. 임의의 가중치·AI-like score 없음.
 */

// ── 임계값 — 이 파일 이 위치 하나에서만 관리 ──────────────────────────────────────
export const INSIGHT_THRESHOLDS = Object.freeze({
  REPEAT:           Object.freeze({ MIN_COUNT: 2 }),
  CONCENTRATION:    Object.freeze({ MIN_TOTAL_FAILURES: 3, MIN_PROPERTY_FAILURES: 2, MIN_RATIO: 0.5 }),
  MONTH_OVER_MONTH: Object.freeze({ MIN_CURRENT_TOTAL: 5, MIN_PREVIOUS_TOTAL: 5, MIN_DELTA_PP: 10 }),
  CONSECUTIVE:      Object.freeze({ MIN_MONTHS: 2 }),
});

// ── A. REPEAT — 같은 숙소에서 같은 실패 유형이 이번 기간에 N번 이상 반복 ────────────────
/**
 * @param {{ propertyId, propertyName, metricKey, metricLabel, failCount }[]} propertyMetricRows
 *   현재 reportPeriod 한 달치, 숙소별×지표별 실패 건수(REPEAT/CONCENTRATION 공용 입력).
 * @param {string} reportPeriod — 'YYYY-MM'
 * @returns {object[]} Insight[]
 */
export function detectRepeatInsights(propertyMetricRows, reportPeriod) {
  const { MIN_COUNT } = INSIGHT_THRESHOLDS.REPEAT;
  return propertyMetricRows
    .filter(r => r.failCount >= MIN_COUNT)
    .map(r => ({
      type: 'REPEAT',
      reportPeriod,
      propertyId: r.propertyId,
      propertyName: r.propertyName,
      metricKey: r.metricKey,
      metricLabel: r.metricLabel,
      evidence: { count: r.failCount },
      internalPriority: r.failCount,
    }));
}

// ── B. CONCENTRATION — 한 지표의 전체 실패 중 절반 이상이 한 숙소에 몰림 ─────────────────
/**
 * @param {{ propertyId, propertyName, metricKey, metricLabel, failCount }[]} propertyMetricRows
 *   REPEAT과 완전히 같은 입력 — 관점만 "숙소별 몇 번"이 아니라 "지표별 분포"로 바꾼 것.
 * @param {string} reportPeriod
 */
export function detectConcentrationInsights(propertyMetricRows, reportPeriod) {
  const { MIN_TOTAL_FAILURES, MIN_PROPERTY_FAILURES, MIN_RATIO } = INSIGHT_THRESHOLDS.CONCENTRATION;

  const byMetric = new Map();
  for (const row of propertyMetricRows) {
    if (row.failCount <= 0) continue;
    if (!byMetric.has(row.metricKey)) byMetric.set(row.metricKey, { metricLabel: row.metricLabel, rows: [] });
    byMetric.get(row.metricKey).rows.push(row);
  }

  const insights = [];
  for (const [metricKey, { metricLabel, rows }] of byMetric) {
    const totalFailures = rows.reduce((sum, r) => sum + r.failCount, 0);
    if (totalFailures < MIN_TOTAL_FAILURES) continue;

    const top = rows.reduce((a, b) => (b.failCount > a.failCount ? b : a));
    if (top.failCount < MIN_PROPERTY_FAILURES) continue;

    const ratio = top.failCount / totalFailures;
    if (ratio < MIN_RATIO) continue;

    insights.push({
      type: 'CONCENTRATION',
      reportPeriod,
      propertyId: top.propertyId,
      propertyName: top.propertyName,
      metricKey,
      metricLabel,
      evidence: { propertyFailures: top.failCount, totalFailures, ratio },
      internalPriority: ratio,
    });
  }
  return insights;
}

// ── C. MONTH_OVER_MONTH — 이번 달 대비 지난달 실패율이 10%p 이상 변함 ──────────────────
/**
 * @param {{ metricKey, metricLabel, numerator, denominator }[]} currentAgg   — reportPeriod 달, 스코프 전체 합산
 * @param {{ metricKey, metricLabel, numerator, denominator }[]} previousAgg — 그 전달, 스코프 전체 합산
 * @param {string} reportPeriod
 */
export function detectMonthOverMonthInsights(currentAgg, previousAgg, reportPeriod) {
  const { MIN_CURRENT_TOTAL, MIN_PREVIOUS_TOTAL, MIN_DELTA_PP } = INSIGHT_THRESHOLDS.MONTH_OVER_MONTH;
  const prevByKey = new Map(previousAgg.map(m => [m.metricKey, m]));

  const insights = [];
  for (const cur of currentAgg) {
    const prev = prevByKey.get(cur.metricKey);
    if (!prev) continue;
    if ((cur.denominator ?? 0) < MIN_CURRENT_TOTAL) continue;
    if ((prev.denominator ?? 0) < MIN_PREVIOUS_TOTAL) continue;

    // 실패율(= 100 - 성공률) 기준 — "실패율이 올랐다/내렸다"가 사람이 더 바로 이해하는 방향
    const currentFailRate  = 100 - (cur.numerator  / cur.denominator)  * 100;
    const previousFailRate = 100 - (prev.numerator / prev.denominator) * 100;
    const deltaPp = currentFailRate - previousFailRate;
    if (Math.abs(deltaPp) < MIN_DELTA_PP) continue;

    insights.push({
      type: 'MONTH_OVER_MONTH',
      reportPeriod,
      propertyId: null,
      propertyName: null,
      metricKey: cur.metricKey,
      metricLabel: cur.metricLabel,
      evidence: {
        currentFailRate: Math.round(currentFailRate),
        previousFailRate: Math.round(previousFailRate),
        deltaPp: Math.round(deltaPp),
      },
      internalPriority: Math.abs(deltaPp),
    });
  }
  return insights;
}

// ── D. CONSECUTIVE — 같은 지표가 2개월 이상 연속으로 실패 발생 ────────────────────────
/**
 * @param {{ month: string, metricKey, metricLabel, failCount }[]} monthlyHistory
 *   reportPeriod을 포함해 최근 완료된 여러 달치, 스코프 전체 합산(월별×지표별 실패 건수).
 *   month은 'YYYY-MM', 최신 달부터 과거 순으로 안 줘도 된다(이 함수 안에서 정렬함).
 * @param {string} reportPeriod — 연속 판정의 "가장 최근 달" (보통 monthlyHistory의 최신 달과 같음)
 */
export function detectConsecutiveInsights(monthlyHistory, reportPeriod) {
  const { MIN_MONTHS } = INSIGHT_THRESHOLDS.CONSECUTIVE;

  const byMetric = new Map();
  for (const row of monthlyHistory) {
    if (!byMetric.has(row.metricKey)) byMetric.set(row.metricKey, { metricLabel: row.metricLabel, rows: [] });
    byMetric.get(row.metricKey).rows.push(row);
  }

  const insights = [];
  for (const [metricKey, { metricLabel, rows }] of byMetric) {
    const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month)); // 최근 달 → 과거
    const streakMonths = [];
    for (const row of sorted) {
      if (row.failCount >= 1) streakMonths.push(row.month);
      else break; // 연속이 끊기면 중단 — 가장 최근 달부터 이어진 연속만 본다
    }
    if (streakMonths.length < MIN_MONTHS) continue;

    insights.push({
      type: 'CONSECUTIVE',
      reportPeriod,
      propertyId: null,
      propertyName: null,
      metricKey,
      metricLabel,
      evidence: { consecutiveMonths: streakMonths.length, months: [...streakMonths].reverse() }, // 과거→최근
      internalPriority: streakMonths.length,
    });
  }
  return insights;
}

// ── 랭킹 — detect → (threshold는 이미 적용됨) → dedupe → 결정적 정렬 → 상위 3개 ─────────
// 타입별 우선순위는 "이게 더 심각하다"는 가중치가 아니라, 같은 개수의 근거가 있을 때 어느 걸
// 먼저 보여줄지 정하는 고정 순서일 뿐이다(설정값이라 나중에 그냥 순서만 바꾸면 됨).
const TYPE_TIER = { CONCENTRATION: 4, CONSECUTIVE: 3, MONTH_OVER_MONTH: 2, REPEAT: 1 };

function dedupeKey(insight) {
  return [insight.type, insight.propertyId ?? '-', insight.metricKey].join('|');
}

/**
 * @param {object[]} insights — 4개 detect 함수 결과를 합친 배열
 * @param {number} [limit=3]
 * @returns {object[]} 최대 limit개, 결정적 순서
 */
export function rankInsights(insights, limit = 3) {
  const seen = new Set();
  const deduped = [];
  for (const insight of insights) {
    const key = dedupeKey(insight);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(insight);
  }

  const sorted = deduped.sort((a, b) => {
    const tierDiff = (TYPE_TIER[b.type] ?? 0) - (TYPE_TIER[a.type] ?? 0);
    if (tierDiff !== 0) return tierDiff;
    return (b.internalPriority ?? 0) - (a.internalPriority ?? 0);
  });

  return sorted.slice(0, limit);
}

// ── 문장 생성 — reportPeriod를 그대로 써서 "이번달"/"지난달" 하드코딩 없음 ────────────────
function monthLabel(reportPeriod) {
  const month = Number(reportPeriod.slice(5, 7));
  return `${month}월`;
}

/**
 * @param {object} insight
 * @returns {string}
 */
export function formatInsightSentence(insight) {
  const month = monthLabel(insight.reportPeriod);
  switch (insight.type) {
    case 'REPEAT':
      return `${insight.propertyName}에서 ${insight.metricLabel} 실패가 ${month}에 ${insight.evidence.count}번 반복됐어요.`;

    case 'CONCENTRATION':
      return `${month} ${insight.metricLabel} 실패 ${insight.evidence.totalFailures}건 중 ${insight.evidence.propertyFailures}건이 ${insight.propertyName}에서 나왔어요.`;

    case 'MONTH_OVER_MONTH': {
      const { deltaPp, previousFailRate, currentFailRate } = insight.evidence;
      const direction = deltaPp > 0 ? '올랐어요' : '내려갔어요';
      return `${insight.metricLabel} 실패율이 지난달보다 ${Math.abs(deltaPp)}%p ${direction} (지난달 ${previousFailRate}% → 이번 달 ${currentFailRate}%).`;
    }

    case 'CONSECUTIVE': {
      const monthsText = insight.evidence.months.map(monthLabel).join(', ');
      return `${insight.metricLabel} 실패가 ${insight.evidence.consecutiveMonths}개월 연속 발생했어요 (${monthsText}).`;
    }

    default:
      return '';
  }
}

/**
 * 4개 detect + rank + format을 한 번에 — reportingService/서버가 다듬어진 문장 배열만 필요할 때.
 *
 * @param {object} data
 * @param {{propertyId, propertyName, metricKey, metricLabel, failCount}[]} data.propertyMetricRows — 이번 달, 숙소별×지표별
 * @param {{metricKey, metricLabel, numerator, denominator}[]} data.currentAgg  — 이번 달, 스코프 합산
 * @param {{metricKey, metricLabel, numerator, denominator}[]} data.previousAgg — 지난달, 스코프 합산
 * @param {{month, metricKey, metricLabel, failCount}[]} data.monthlyHistory   — 최근 여러 달, 스코프 합산
 * @param {string} reportPeriod
 * @returns {string[]} 최대 3문장
 */
export function buildMonthlyInsightSentences(data, reportPeriod) {
  const all = [
    ...detectRepeatInsights(data.propertyMetricRows ?? [], reportPeriod),
    ...detectConcentrationInsights(data.propertyMetricRows ?? [], reportPeriod),
    ...detectMonthOverMonthInsights(data.currentAgg ?? [], data.previousAgg ?? [], reportPeriod),
    ...detectConsecutiveInsights(data.monthlyHistory ?? [], reportPeriod),
  ];
  return rankInsights(all).map(formatInsightSentence);
}
