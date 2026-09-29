/**
 * insightDomain — 월간/주간 레포트 Summary 하위에 보여줄 "발견된 패턴" 최대 3문장.
 *
 * 이 기능은 통계적 추론이나 AI 추천이 아니다. 기존 표에 이미 있는 숫자들(지표별 성공률 등)
 * 사이에서, 사람이 여러 표·숙소·기간을 직접 비교해야 알아챌 수 있는 관계를 **정해진 규칙**으로
 * 자동으로 찾아주는 것뿐이다. "합리적으로 판단"/"의미 있다고 판단" 같은 주관적 로직은 없다 —
 * 모든 발생 조건은 아래 INSIGHT_THRESHOLDS/WEEKLY_INSIGHT_THRESHOLDS 두 곳으로만 정의된다.
 *
 * V1 범위: REPEAT / CONCENTRATION / MONTH_OVER_MONTH / CONSECUTIVE 4종만 구현.
 * CO_OCCURRENCE·WORKER_CONCENTRATION은 "같은 사건인지" 신뢰성 있게 판별할 방법이 지금 데이터
 * 구조로는 부족해 보류(사용자 결정, 2026-09-28).
 *
 * 파이프라인: detect(타입별) → (threshold는 detect 안에서 이미 적용됨) → rankInsights에서
 * dedupe → 결정적 정렬 → 상위 3개. 임의의 가중치·AI-like score 없음.
 *
 * **월/주 겸용(D-029, 2026-09-28)**: 4개 detect 함수는 원래 월간 전용으로 만들었지만, 실제로는
 * `reportPeriod`를 불투명한 문자열로만 다뤄서 그 자체로는 월/주 어느 쪽에도 종속되지 않았다.
 * 종속된 부분(CONSECUTIVE의 "바로 전 기간" 계산, 문장의 "이번 달"/"몇 개월" 같은 단위 표현)만
 * `periodUnit`('month'|'week') 옵션으로 분리했다. `type`(예: 'MONTH_OVER_MONTH') 문자열 자체는
 * 역사적으로 월 이름이 붙어 있지만 주간에도 그대로 재사용한다 — 랭킹·중복제거의 내부 키일 뿐
 * 화면에 노출되지 않고, 실제 표현은 `periodUnit`이 결정하므로 바꿀 실익이 없다.
 */

// ── 임계값 — 월간은 이 파일 이 위치, 주간은 WEEKLY_INSIGHT_THRESHOLDS 한 곳에서만 관리 ──────
export const INSIGHT_THRESHOLDS = Object.freeze({
  REPEAT:           Object.freeze({ MIN_COUNT: 2 }),
  CONCENTRATION:    Object.freeze({ MIN_TOTAL_FAILURES: 3, MIN_PROPERTY_FAILURES: 2, MIN_RATIO: 0.5 }),
  MONTH_OVER_MONTH: Object.freeze({ MIN_CURRENT_TOTAL: 5, MIN_PREVIOUS_TOTAL: 5, MIN_DELTA_PP: 10 }),
  CONSECUTIVE:      Object.freeze({ MIN_STREAK: 2 }),
});

// 한 주는 대략 한 달의 1/4 물량이라, 월간 기준(예: 표본 5건)을 그대로 쓰면 거의 안 터지거나
// 반대로 사소한 흔들림도 과하게 잡아낼 수 있다. 물량성 기준(표본 수)은 비례해서 낮추고,
// %p 변화 기준은 오히려 높였다(표본이 적을수록 우연에 의한 흔들림 폭이 커짐 — 예: 3건 중
// 1건 차이만으로도 33%p가 흔들릴 수 있음). D-018과 같은 원칙으로 제안값을 그대로 채택 —
// 운영해보고 조정.
export const WEEKLY_INSIGHT_THRESHOLDS = Object.freeze({
  REPEAT:           Object.freeze({ MIN_COUNT: 2 }),
  CONCENTRATION:    Object.freeze({ MIN_TOTAL_FAILURES: 2, MIN_PROPERTY_FAILURES: 2, MIN_RATIO: 0.5 }),
  MONTH_OVER_MONTH: Object.freeze({ MIN_CURRENT_TOTAL: 3, MIN_PREVIOUS_TOTAL: 3, MIN_DELTA_PP: 15 }),
  CONSECUTIVE:      Object.freeze({ MIN_STREAK: 2 }),
});

// ── A. REPEAT — 같은 숙소에서 같은 실패 유형이 이번 기간에 N번 이상 반복 ────────────────
/**
 * @param {{ propertyId, propertyName, metricKey, metricLabel, failCount }[]} propertyMetricRows
 *   현재 reportPeriod 한 기간치, 숙소별×지표별 실패 건수(REPEAT/CONCENTRATION 공용 입력).
 * @param {string} reportPeriod — 월이면 'YYYY-MM', 주면 그 주 월요일의 'YYYY-MM-DD'(KST)
 * @param {{ periodUnit?: 'month'|'week', thresholds?: object }} [opts]
 * @returns {object[]} Insight[]
 */
export function detectRepeatInsights(propertyMetricRows, reportPeriod, { periodUnit = 'month', thresholds = INSIGHT_THRESHOLDS.REPEAT } = {}) {
  const { MIN_COUNT } = thresholds;
  return propertyMetricRows
    .filter(r => r.failCount >= MIN_COUNT)
    .map(r => ({
      type: 'REPEAT',
      reportPeriod,
      periodUnit,
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
 * @param {{ periodUnit?: 'month'|'week', thresholds?: object }} [opts]
 */
export function detectConcentrationInsights(propertyMetricRows, reportPeriod, { periodUnit = 'month', thresholds = INSIGHT_THRESHOLDS.CONCENTRATION } = {}) {
  const { MIN_TOTAL_FAILURES, MIN_PROPERTY_FAILURES, MIN_RATIO } = thresholds;

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
      periodUnit,
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
 * @param {{ metricKey, metricLabel, numerator, denominator }[]} currentAgg   — reportPeriod 기간, 스코프 전체 합산
 * @param {{ metricKey, metricLabel, numerator, denominator }[]} previousAgg — 그 바로 전 기간, 스코프 전체 합산
 * @param {string} reportPeriod
 * @param {{ periodUnit?: 'month'|'week', thresholds?: object }} [opts]
 */
export function detectMonthOverMonthInsights(currentAgg, previousAgg, reportPeriod, { periodUnit = 'month', thresholds = INSIGHT_THRESHOLDS.MONTH_OVER_MONTH } = {}) {
  const { MIN_CURRENT_TOTAL, MIN_PREVIOUS_TOTAL, MIN_DELTA_PP } = thresholds;
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
      periodUnit,
      propertyId: null,
      propertyName: null,
      metricKey: cur.metricKey,
      metricLabel: cur.metricLabel,
      evidence: {
        currentFailRate: Math.round(currentFailRate),
        previousFailRate: Math.round(previousFailRate),
        deltaPp: Math.round(deltaPp),
        // 팝업 상세("18건 중 1건 실패")용 원본 건수 — 문장 자체엔 안 쓰지만 popup 표시용으로 보존
        currentNumerator: cur.numerator, currentDenominator: cur.denominator,
        previousNumerator: prev.numerator, previousDenominator: prev.denominator,
      },
      internalPriority: Math.abs(deltaPp),
    });
  }
  return insights;
}

// 'YYYY-MM' → 그 한 달 전의 'YYYY-MM'.
function prevMonthKey(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)); // m은 1-indexed → m-1이 이번 달(0-indexed), 그 전달은 -1 더
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 'YYYY-MM-DD'(그 주 월요일, KST) → 그 한 주 전 월요일의 'YYYY-MM-DD'.
function prevWeekKey(weekKey) {
  const d = new Date(`${weekKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

// detectConsecutiveInsights가 달력상 진짜 연속(바로 전 기간)인지 확인하는 데만 쓰는 순수 유틸.
function prevPeriodKey(periodKey, periodUnit) {
  return periodUnit === 'week' ? prevWeekKey(periodKey) : prevMonthKey(periodKey);
}

// ── D. CONSECUTIVE — 같은 지표가 2개 기간(월/주) 이상 연속으로 실패 발생 ─────────────────
/**
 * @param {{ period: string, metricKey, metricLabel, failCount }[]} periodHistory
 *   reportPeriod을 포함해 최근 완료된 여러 기간치, 스코프 전체 합산(기간별×지표별 실패 건수).
 *   period는 월이면 'YYYY-MM', 주면 그 주 월요일의 'YYYY-MM-DD'(KST) — 최신 기간부터 과거 순으로
 *   안 줘도 된다(이 함수 안에서 정렬함). 그 지표가 해당 기간에 측정 불가(분모 0)였으면 그 기간
 *   자체가 배열에서 아예 빠질 수 있다 — 이 함수는 그런 빠진 기간을 "실패 없음"으로 이어붙이지
 *   않고 연속이 끊긴 것으로 본다(과다 주장 방지).
 * @param {string} reportPeriod — 연속 판정의 "가장 최근 기간" (보통 periodHistory의 최신 기간과 같음)
 * @param {{ periodUnit?: 'month'|'week', thresholds?: object }} [opts]
 */
export function detectConsecutiveInsights(periodHistory, reportPeriod, { periodUnit = 'month', thresholds = INSIGHT_THRESHOLDS.CONSECUTIVE } = {}) {
  const { MIN_STREAK } = thresholds;

  const byMetric = new Map();
  for (const row of periodHistory) {
    if (!byMetric.has(row.metricKey)) byMetric.set(row.metricKey, { metricLabel: row.metricLabel, rows: [] });
    byMetric.get(row.metricKey).rows.push(row);
  }

  const insights = [];
  for (const [metricKey, { metricLabel, rows }] of byMetric) {
    const sorted = [...rows].sort((a, b) => b.period.localeCompare(a.period)); // 최근 기간 → 과거
    const streak = []; // [{period, failCount}], 최근 → 과거
    let expectedPeriod = null;
    for (const row of sorted) {
      if (expectedPeriod !== null && row.period !== expectedPeriod) break; // 중간 기간이 빠짐 — 달력상 연속이 아님
      if (row.failCount < 1) break; // 연속이 끊기면 중단 — 가장 최근 기간부터 이어진 연속만 본다
      streak.push({ period: row.period, failCount: row.failCount });
      expectedPeriod = prevPeriodKey(row.period, periodUnit);
    }
    if (streak.length < MIN_STREAK) continue;

    const chronological = [...streak].reverse(); // 과거 → 최근 (팝업의 추이 표시용)
    insights.push({
      type: 'CONSECUTIVE',
      reportPeriod,
      periodUnit,
      propertyId: null,
      propertyName: null,
      metricKey,
      metricLabel,
      evidence: {
        consecutivePeriods: streak.length,
        periods: chronological.map(s => s.period),
        // 팝업 상세("7월 2건 → 8월 1건 → 9월 3건")용 기간별 건수 — 문장 자체엔 안 쓰지만 popup 표시용으로 보존
        periodCounts: chronological,
      },
      internalPriority: streak.length,
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

// weekKey = 그 주 월요일의 'YYYY-MM-DD'(KST) → "9/22~9/28". 서수(몇 주차) 대신 날짜 범위로
// 표시 — ReportPanel 제목("2주 뒤 레포트 · 9/28~10/4", D-017)과 같은 표기 관례를 따른 것.
function weekLabel(weekKey) {
  const mon = new Date(`${weekKey}T00:00:00Z`);
  const sun = new Date(mon);
  sun.setUTCDate(sun.getUTCDate() + 6);
  return `${mon.getUTCMonth() + 1}/${mon.getUTCDate()}~${sun.getUTCMonth() + 1}/${sun.getUTCDate()}`;
}

/** 기간 키(월 'YYYY-MM' 또는 주 월요일 'YYYY-MM-DD') → 화면 표시 라벨. insightActionGuideDomain도 재사용. */
export function periodLabel(periodKey, periodUnit) {
  return periodUnit === 'week' ? weekLabel(periodKey) : monthLabel(periodKey);
}

/**
 * @param {object} insight — periodUnit('month'|'week', 기본 'month')이 문구를 결정
 * @returns {string}
 */
export function formatInsightSentence(insight) {
  const unit = insight.periodUnit ?? 'month';
  const label = periodLabel(insight.reportPeriod, unit);
  const thisWord   = unit === 'week' ? '이번 주' : '이번 달';
  const lastWord    = unit === 'week' ? '지난주' : '지난달';
  const streakWord = unit === 'week' ? '주' : '개월';

  switch (insight.type) {
    case 'REPEAT':
      return `${insight.propertyName}에서 ${insight.metricLabel} 실패가 ${label}에 ${insight.evidence.count}번 반복됐어요.`;

    case 'CONCENTRATION':
      return `${label} ${insight.metricLabel} 실패 ${insight.evidence.totalFailures}건 중 ${insight.evidence.propertyFailures}건이 ${insight.propertyName}에서 나왔어요.`;

    case 'MONTH_OVER_MONTH': {
      const { deltaPp, previousFailRate, currentFailRate } = insight.evidence;
      const direction = deltaPp > 0 ? '올랐어요' : '내려갔어요';
      return `${insight.metricLabel} 실패율이 ${lastWord}보다 ${Math.abs(deltaPp)}%p ${direction} (${lastWord} ${previousFailRate}% → ${thisWord} ${currentFailRate}%).`;
    }

    case 'CONSECUTIVE': {
      const periodsText = insight.evidence.periods.map(p => periodLabel(p, unit)).join(', ');
      return `${insight.metricLabel} 실패가 ${insight.evidence.consecutivePeriods}${streakWord} 연속 발생했어요 (${periodsText}).`;
    }

    default:
      return '';
  }
}

/**
 * 4개 detect + rank + format을 한 번에 실행하는 내부 공용 파이프라인 — buildMonthlyInsights/
 * buildWeeklyInsights가 이 함수를 감싸는 얇은 래퍼일 뿐이다(리뷰로 발견, 2026-09-28: 처음엔 두
 * 함수가 이 4줄짜리 파이프라인을 각각 따로 갖고 있어서, periodUnit 옵션을 만든 원래 목적 —
 * "월/주 로직이 갈라지지 않게"— 이 완전히는 안 지켜지고 있었다).
 */
function buildInsights(data, reportPeriod, { periodUnit, thresholds } = {}) {
  const opt = (key) => ({ periodUnit, thresholds: thresholds?.[key] });
  const all = [
    ...detectRepeatInsights(data.propertyMetricRows ?? [], reportPeriod, opt('REPEAT')),
    ...detectConcentrationInsights(data.propertyMetricRows ?? [], reportPeriod, opt('CONCENTRATION')),
    ...detectMonthOverMonthInsights(data.currentAgg ?? [], data.previousAgg ?? [], reportPeriod, opt('MONTH_OVER_MONTH')),
    ...detectConsecutiveInsights(data.periodHistory ?? [], reportPeriod, opt('CONSECUTIVE')),
  ];
  return rankInsights(all).map(insight => ({ ...insight, sentence: formatInsightSentence(insight) }));
}

/**
 * 화면(팝업 등)이 문장뿐 아니라 타입·지표·숙소·evidence까지 필요할 때 이 함수를 쓴다.
 * `sentence` 필드가 덧붙은 것 외엔 rankInsights의 반환값과 동일하다.
 *
 * @param {object} data
 * @param {{propertyId, propertyName, metricKey, metricLabel, failCount}[]} data.propertyMetricRows — 이번 달, 숙소별×지표별
 * @param {{metricKey, metricLabel, numerator, denominator}[]} data.currentAgg  — 이번 달, 스코프 합산
 * @param {{metricKey, metricLabel, numerator, denominator}[]} data.previousAgg — 지난달, 스코프 합산
 * @param {{period, metricKey, metricLabel, failCount}[]} data.periodHistory   — 최근 여러 달, 스코프 합산
 * @param {string} reportPeriod
 * @returns {object[]} 최대 3개, 각 원소는 Insight(type/reportPeriod/periodUnit/propertyId/propertyName/metricKey/metricLabel/evidence) + sentence
 */
export function buildMonthlyInsights(data, reportPeriod) {
  return buildInsights(data, reportPeriod, { periodUnit: 'month', thresholds: INSIGHT_THRESHOLDS });
}

/**
 * buildMonthlyInsights와 완전히 같은 파이프라인이지만 WEEKLY_INSIGHT_THRESHOLDS(주간 임계값)를
 * 쓰고 모든 insight에 `periodUnit: 'week'`를 붙인다(D-029, ListView 주간 레포트용).
 *
 * @param {object} data  buildMonthlyInsights와 같은 모양, 단 periodHistory의 period는 주 월요일 'YYYY-MM-DD'
 * @param {string} reportPeriod — 그 주 월요일의 'YYYY-MM-DD'(KST)
 * @returns {object[]}
 */
export function buildWeeklyInsights(data, reportPeriod) {
  return buildInsights(data, reportPeriod, { periodUnit: 'week', thresholds: WEEKLY_INSIGHT_THRESHOLDS });
}

/**
 * buildMonthlyInsights의 문장만 필요할 때(예: 기존 텍스트 전용 호출부) 쓰는 얇은 래퍼.
 *
 * @param {object} data
 * @param {string} reportPeriod
 * @returns {string[]} 최대 3문장
 */
export function buildMonthlyInsightSentences(data, reportPeriod) {
  return buildMonthlyInsights(data, reportPeriod).map(insight => insight.sentence);
}
