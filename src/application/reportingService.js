import { getPeriodRange, countCurrentStats, countPeriodEvents } from "../domain/reportingDomain.js";
import { describePeriod, monthsAgoRange, periodForOffset, periodToDateRange } from "../domain/periodDomain.js";
import { summarizeOperationalMetrics, computeMeasurableMetrics } from "../domain/operationalMetricsDomain.js";
import {
  detectCleaningTimeFailures,
  detectPreStayOptimizationFailures,
  detectVacantEnergyFailures,
  detectPostCheckoutFailures,
  detectPostCleaningFailures,
} from "../domain/metricDrilldownDomain.js";
import { buildMonthlyInsights, buildWeeklyInsights } from "../domain/insightDomain.js";
import { queryEvents, getLastKnownStatesFromDB, queryStateEventsForProperty } from "../infrastructure/eventRepository.js";
import { queryCleaningJobCounts, queryCleaningJobCountsByProperty, queryCleaningIssueItems } from "../infrastructure/cleaningJobRepository.js";
import { buildIssueItems, buildStateSegmentsFromEvents, groupIssueItemsByKstDate, toKstDateKey } from "../domain/monthlyCalendarDomain.js";

// content-guide.md 규칙 준수: 한 문장에 숫자 최대 2개, 내부 상태명 노출 금지

/**
 * SOFT 이벤트 요약 접미사. PAST 기간에서 noShowSuspected가 있을 때 덧붙임.
 * 별도 문장으로 추가하여 "숫자 2개" 규칙 준수.
 */
function softSuffix(stats) {
  const noShow = stats.noShowSuspected ?? 0;
  if (noShow > 0) return ` 노쇼 의심 ${noShow}건 확인이 필요해요.`;
  return "";
}

/**
 * 기간과 KPI 통계를 받아 운영자용 요약 문장을 생성한다.
 *
 * now 형태:   { occupied, preStayReady, vacant, cleaning, anomalyCount, total }
 * 나머지 형태: { checkIns, checkOuts, anomalies, energyWaste }
 *
 * @param {string} period
 * @param {object} stats
 * @returns {string}
 */
export function generateSummary(period, stats) {
  // 실시간 (now / today)
  if (period === "now" || period === "today") {
    if (stats.anomalyCount > 0) {
      return `현재 이상 징후 ${stats.anomalyCount}건이 확인됐어요. 바로 확인이 필요해요.`;
    }
    return `현재 ${stats.total}개 숙소 정상 운영 중이에요.`;
  }

  // 주 단위
  if (period === "this_week") {
    return summarizeOperationalMetrics(period, stats) ?? (
      stats.anomalies > 0
        ? `이번 주 이상감지 ${stats.anomalies}건이 있어요.`
        : `이번 주 체크인 ${stats.checkIns}건, 체크아웃 ${stats.checkOuts}건이에요.`
    );
  }
  if (period === "last_week") {
    const base = summarizeOperationalMetrics(period, stats) ?? (
      stats.anomalies > 0
        ? `지난주 체크인 ${stats.checkIns}건 완료, 이상감지 ${stats.anomalies}건이 있었어요.`
        : `지난주 체크인 ${stats.checkIns}건 완료, 이상 없었어요.`
    );
    return base + softSuffix(stats);
  }
  if (period === "next_week") {
    return stats.checkIns > 0 ? `다음 주 체크인 ${stats.checkIns}건 예정이에요.` : `다음 주 예약이 없어요.`;
  }

  // 월 단위
  if (period === "this_month") {
    return summarizeOperationalMetrics(period, stats) ?? (
      stats.anomalies > 0
        ? `이번 달 이상감지 ${stats.anomalies}건이 있어요.`
        : `이번 달 체크인 ${stats.checkIns}건, 체크아웃 ${stats.checkOuts}건이에요.`
    );
  }
  if (period === "last_month") {
    return summarizeOperationalMetrics(period, stats) ?? (
      stats.anomalies > 0
        ? `지난달 체크인 ${stats.checkIns}건 완료, 이상감지 ${stats.anomalies}건이 있었어요.`
        : `지난달 체크인 ${stats.checkIns}건 완료, 이상 없었어요.`
    );
  }
  if (period === "next_month") {
    return stats.checkIns > 0 ? `다음 달 체크인 ${stats.checkIns}건 예정이에요.` : `다음 달 예약이 없어요.`;
  }

  // 일 단위
  if (period === "yesterday") {
    const base = summarizeOperationalMetrics(period, stats) ?? (
      stats.anomalies > 0
        ? `어제 체크인 ${stats.checkIns}건, 이상감지 ${stats.anomalies}건이 있었어요.`
        : `어제 체크인 ${stats.checkIns}건 완료, 이상 없었어요.`
    );
    return base + softSuffix(stats);
  }
  if (period === "tomorrow") {
    return stats.checkIns > 0 ? `내일 체크인 ${stats.checkIns}건 예정이에요.` : `내일 예약된 체크인이 없어요.`;
  }

  // 시간 단위
  if (period === "last_hour") {
    const fallback = () => {
      const total = (stats.checkIns ?? 0) + (stats.checkOuts ?? 0) + (stats.anomalies ?? 0);
      return total > 0 ? `지난 1시간 이벤트 ${total}건이 있었어요.` : `지난 1시간 이벤트가 없어요.`;
    };
    return summarizeOperationalMetrics(period, stats) ?? fallback();
  }
  if (period === "next_hour") {
    return stats.checkIns > 0 ? `1시간 내 체크인 ${stats.checkIns}건 예정이에요.` : `1시간 내 예정된 이벤트가 없어요.`;
  }

  // 몇 주·며칠 뒤/전 (weeks_ahead_2, days_ago_3 …) — "2주 전 …", "3일 뒤 …"
  const d = describePeriod(period);
  if (d && (d.unit === "week" || d.unit === "day") && d.tense !== "active") {
    if (d.tense === "past") {
      const base = summarizeOperationalMetrics(period, stats) ?? (
        stats.anomalies > 0
          ? `${d.label} 체크인 ${stats.checkIns}건 완료, 이상감지 ${stats.anomalies}건이 있었어요.`
          : `${d.label} 체크인 ${stats.checkIns}건 완료, 이상 없었어요.`
      );
      return base + softSuffix(stats);
    }
    return stats.checkIns > 0 ? `${d.label} 체크인 ${stats.checkIns}건 예정이에요.` : `${d.label} 예약이 없어요.`;
  }

  return "";
}

/**
 * countPeriodEvents가 0으로 둔 청소 지표 6·7을 채운다 (report-architecture 지표 표).
 *   cleaningOnTime  = 청소 완료 - 3시간 초과 건 (드릴다운 실패 목록과 같은 기준. 시작 이벤트가 없는 완료는 감점하지 않음)
 *   cleaningCreated / cleaningAssigned = cleaning_jobs (체크아웃이 이미 지난 건만). 조회 실패 시 null → 화면 "해당 없음"
 */
async function injectCleaningMetrics(stats, { db, events, range, propertyIds, period, now }) {
  stats.cleaningOnTime = Math.max(0, stats.cleaningFinished - detectCleaningTimeFailures(events).length);

  if (describePeriod(period)?.tense === "future") return;

  const to = new Date(Math.min(range.to.getTime(), now.getTime()));
  try {
    const jobs = await queryCleaningJobCounts(db, { from: range.from, to }, propertyIds);
    stats.cleaningCreated  = jobs.created;
    stats.cleaningAssigned = jobs.assigned;
  } catch (err) {
    console.error("[reportingService] cleaning_jobs 집계 실패:", err?.message ?? err);
    stats.cleaningCreated  = null;
    stats.cleaningAssigned = null;
  }
}

// 미래 기간은 이벤트가 없어 청소 잡 집계(지표 7)가 의미 없음 — 예정 현황은 클라이언트(iCal)·/api/cleaning/stats가 담당

/**
 * 기간별 KPI를 조회한다.
 * now/today: 이벤트 기록으로 계산한 현재 상태 집계 (propertyIds 지정 시 그 숙소들만)
 * 나머지: DB 이벤트 기반 기간 집계
 *
 * @param {string} period
 * @param {{ db: object, propertyIds?: string[]|null, now?: Date }} deps  (kv 는 더 이상 쓰지 않음 — 호출부 호환용으로 넘겨도 무시)
 * @returns {Promise<{ period, stats, summary, range? }>}
 */
export async function getStatsForPeriod(period, { db, propertyIds = null, now = new Date() }) {
  // today = 오늘 실시간 상태 (now와 동일)
  if (period === "now" || period === "today") {
    // 현재 상태는 이벤트 기록(DB)에서 직접 계산한다. 임시 저장소(KV)는 5분이면 지워져 숙소가 통째로 빠지고,
    // 민원·에너지 낭비 같은 세부 상태도 담지 못했다. propertyIds 지정 시 그 숙소들만 (중복 ID는 1회), [] → 전부 0.
    const ids = Array.isArray(propertyIds) ? [...new Set(propertyIds)] : null;
    const states = await getLastKnownStatesFromDB(db, ids);
    const stats = countCurrentStats([...states.values()]);
    const summary = generateSummary(period, stats);
    return { period, stats, summary };
  }

  const range = getPeriodRange(period, now);
  const events = await queryEvents(db, range, propertyIds);
  const stats = countPeriodEvents(events);
  await injectCleaningMetrics(stats, { db, events, range, propertyIds, period, now });
  const summary = generateSummary(period, stats);
  return {
    period,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    stats,
    summary,
  };
}

// CONSECUTIVE가 보는 과거 기간 수(이번 기간 포함) — 연속 최소 2기간보다 여유 있게 잡아 3기간
// 연속까지도 잡아낼 수 있게 함. 이 상수만 늘리면 그만큼 더 도는 구조라 값 하나로 제어.
const INSIGHT_LOOKBACK_MONTHS = 4;
const INSIGHT_LOOKBACK_WEEKS  = 4;

/**
 * [from, to) 구간의 스코프 전체 합산 지표(measurable) + 그 구간 이벤트를 계산한다 — 월간·주간
 * 인사이트 오케스트레이션(getMonthlyInsights/getWeeklyInsights)이 공유하는 부분(D-029). 날짜
 * 범위를 구하는 방식(월 오프셋 vs 주 오프셋)만 호출부가 다르고, 그 뒤 집계 로직은 완전히 동일.
 */
async function computeAggregateMetricsForRange(db, { from, to }, propertyIds, logLabel) {
  // 이벤트 조회와 청소잡 집계는 서로 독립적(둘 다 {from,to,propertyIds}만 필요) — 동시에 실행.
  const [events, jobsResult] = await Promise.all([
    queryEvents(db, { from, to }, propertyIds),
    queryCleaningJobCounts(db, { from, to }, propertyIds)
      .then(jobs => ({ ok: true, jobs }))
      .catch(err => ({ ok: false, err })),
  ]);
  const stats = countPeriodEvents(events);
  stats.cleaningOnTime = Math.max(0, stats.cleaningFinished - detectCleaningTimeFailures(events).length);
  if (jobsResult.ok) {
    stats.cleaningCreated  = jobsResult.jobs.created;
    stats.cleaningAssigned = jobsResult.jobs.assigned;
  } else {
    console.error(`[reportingService] ${logLabel} cleaning_jobs 집계 실패:`, jobsResult.err?.message ?? jobsResult.err);
    stats.cleaningCreated  = null;
    stats.cleaningAssigned = null;
  }
  return { events, metrics: computeMeasurableMetrics(stats) };
}

/** reportPeriod 기준 monthOffset달 전의 집계 지표 + 이벤트. */
async function computeAggregateMonthMetrics(db, monthOffset, propertyIds, now) {
  const { from, to, monthKey } = monthsAgoRange(monthOffset, now.getTime());
  const { events, metrics } = await computeAggregateMetricsForRange(db, { from, to }, propertyIds, "getMonthlyInsights");
  return { period: monthKey, from, to, events, metrics };
}

/** reportPeriod 기준 weekOffset주 전(그 주 월요일 KST)의 집계 지표 + 이벤트. */
async function computeAggregateWeekMetrics(db, weekOffset, propertyIds, now) {
  const periodKey = periodForOffset("week", -weekOffset); // 0→this_week, 1→last_week, 2→weeks_ago_2 …
  const { from, to } = periodToDateRange(periodKey, now.getTime());
  const weekKey = toKstDateKey(from); // 그 주 월요일, KST
  const { events, metrics } = await computeAggregateMetricsForRange(db, { from, to }, propertyIds, "getWeeklyInsights");
  return { period: weekKey, from, to, events, metrics };
}

/**
 * 최근 여러 기간치(periodDataList, computeAggregateMonthMetrics/computeAggregateWeekMetrics의
 * 결과 배열)와 이번 기간 이벤트를 숙소별로 나눠 REPEAT/CONCENTRATION·MONTH_OVER_MONTH·
 * CONSECUTIVE detector 입력(propertyMetricRows/currentAgg/previousAgg/periodHistory)을 만든다.
 * 월간·주간 오케스트레이션이 공유(D-029) — 기간 단위와 무관하게 완전히 동일한 로직.
 */
async function buildInsightDetectorInputs(db, periodDataList, propertyIds, logLabel) {
  const [current, previous] = periodDataList;

  const toAggRow = (m) => ({ metricKey: m.key, metricLabel: m.label, numerator: m.numerator, denominator: m.denominator });
  const currentAgg  = current.metrics.map(toAggRow);
  const previousAgg = previous.metrics.map(toAggRow);
  const periodHistory = periodDataList.flatMap(({ period, metrics }) =>
    metrics.map(m => ({ period, metricKey: m.key, metricLabel: m.label, failCount: m.failCount }))
  );

  // 이번 기간 이벤트를 숙소별로 나눠서 REPEAT/CONCENTRATION용 rows 생성. 전체 숙소 스코프
  // (propertyIds=null)일 땐 별도 "전체 숙소 목록" 조회 없이, 이미 가져온 이벤트에 실제로
  // 등장한 property_id만 대상으로 한다(그 기간에 아무 기록도 없는 숙소는 REPEAT/CONCENTRATION
  // 어느 쪽으로도 뽑힐 수 없어 굳이 스코프에 넣을 이유가 없음).
  const events = current.events;
  const scopeIds = Array.isArray(propertyIds) && propertyIds.length > 0
    ? propertyIds
    : [...new Set(events.map(e => e.property_id))];

  const eventsByProperty = new Map(scopeIds.map(id => [id, []]));
  for (const e of events) {
    if (!eventsByProperty.has(e.property_id)) eventsByProperty.set(e.property_id, []);
    eventsByProperty.get(e.property_id).push(e);
  }

  let cleaningMap = new Map();
  if (scopeIds.length > 0) {
    try {
      const rows = await queryCleaningJobCountsByProperty(db, { from: current.from, to: current.to }, scopeIds);
      cleaningMap = new Map(rows.map(r => [r.property_id, r]));
    } catch (err) {
      console.error(`[reportingService] ${logLabel} 숙소별 cleaning_jobs 집계 실패:`, err?.message ?? err);
    }
  }

  // property_id = ListView 표시 이름 그 자체 (D-016) — 별도 이름 조회 불필요.
  const propertyMetricRows = [];
  for (const [propId, propEvents] of eventsByProperty) {
    const stats = countPeriodEvents(propEvents);
    stats.cleaningOnTime = Math.max(0, stats.cleaningFinished - detectCleaningTimeFailures(propEvents).length);
    const cj = cleaningMap.get(propId) ?? { created: 0, assigned: 0 };
    stats.cleaningCreated  = cj.created;
    stats.cleaningAssigned = cj.assigned;
    for (const m of computeMeasurableMetrics(stats)) {
      propertyMetricRows.push({ propertyId: propId, propertyName: propId, metricKey: m.key, metricLabel: m.label, failCount: m.failCount });
    }
  }

  return { propertyMetricRows, currentAgg, previousAgg, periodHistory };
}

/**
 * 월간 레포트 Summary 하위에 붙는 "발견된 패턴" 최대 3문장 (D-027).
 * this_month/last_month에서만 의미 있음 — 그 밖의 기간은 빈 배열.
 *
 * 반환하는 각 항목엔 문장(`sentence`)뿐 아니라 type/metricKey/propertyId/evidence 등도 함께 담겨
 * 있어 화면이 상세 팝업(D-028)을 그릴 수 있다.
 *
 * @param {string} period
 * @param {{ db: object, propertyIds?: string[]|null, now?: Date }} deps
 * @returns {Promise<object[]>}
 */
export async function getMonthlyInsights(period, { db, propertyIds = null, now = new Date() }) {
  if (period !== "this_month" && period !== "last_month") return [];

  const baseOffset = period === "last_month" ? 1 : 0;

  // 최근 몇 달치 스코프 합산 지표 — MONTH_OVER_MONTH(현재·직전)·CONSECUTIVE(전체 이력) 공용.
  // 달마다 서로 독립적인 조회라 Promise.all로 동시에 실행(순서는 그대로 보존됨).
  const monthDataList = await Promise.all(
    Array.from({ length: INSIGHT_LOOKBACK_MONTHS }, (_, i) => computeAggregateMonthMetrics(db, baseOffset + i, propertyIds, now))
  );
  const reportPeriod = monthDataList[0].period;

  const detectorInputs = await buildInsightDetectorInputs(db, monthDataList, propertyIds, "getMonthlyInsights");
  const insights = buildMonthlyInsights(detectorInputs, reportPeriod);
  // periodKey — 호출부가 준 원래 기간 키("this_month"/"last_month"). reportPeriod("YYYY-MM")는 문장·evidence
  // 표시용이고, 팝업이 /api/stats/drilldown을 다시 부를 땐 이 API가 아는 이름이 필요하다(D-028).
  return insights.map(insight => ({ ...insight, periodKey: period }));
}

/**
 * ListView(주간) 레포트 Summary 하위에 붙는 "발견된 패턴" 최대 3문장 (D-029, D-027의 주간 버전).
 * this_week/last_week에서만 의미 있음 — 그 밖의 기간(오늘/어제, weeks_ago_N 같은 일반화된
 * 오프셋 포함)은 빈 배열. 월간과 같은 이유로 범위를 현재+바로 전 기간으로만 한정.
 *
 * @param {string} period
 * @param {{ db: object, propertyIds?: string[]|null, now?: Date }} deps
 * @returns {Promise<object[]>}
 */
export async function getWeeklyInsights(period, { db, propertyIds = null, now = new Date() }) {
  if (period !== "this_week" && period !== "last_week") return [];

  const baseOffset = period === "last_week" ? 1 : 0;

  const weekDataList = await Promise.all(
    Array.from({ length: INSIGHT_LOOKBACK_WEEKS }, (_, i) => computeAggregateWeekMetrics(db, baseOffset + i, propertyIds, now))
  );
  const reportPeriod = weekDataList[0].period;

  const detectorInputs = await buildInsightDetectorInputs(db, weekDataList, propertyIds, "getWeeklyInsights");
  const insights = buildWeeklyInsights(detectorInputs, reportPeriod);
  return insights.map(insight => ({ ...insight, periodKey: period }));
}

/** 월간 캘린더의 날짜별 문제 이력과 단일 숙소 상태 구간. */
export async function getMonthlyCalendarData(period, { db, propertyIds = null, now = new Date() }) {
  const desc = describePeriod(period);
  if (desc?.unit !== 'month') throw new Error(`monthly period required: "${period}"`);

  const range = getPeriodRange(period, now);
  const events = await queryEvents(db, range, propertyIds);

  let cleaningIssues = [];
  try {
    cleaningIssues = await queryCleaningIssueItems(db, range, propertyIds, now);
  } catch (err) {
    console.error('[reportingService] 월간 cleaning_jobs 조회 실패:', err?.message ?? err);
  }

  const items = buildIssueItems(events, cleaningIssues);
  let stateSegments = [];
  if (Array.isArray(propertyIds) && propertyIds.length === 1) {
    const stateEvents = await queryStateEventsForProperty(db, range, propertyIds[0]);
    stateSegments = buildStateSegmentsFromEvents(stateEvents, range, now);
  }

  return {
    period,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    days: groupIssueItemsByKstDate(items),
    items,
    stateSegments: stateSegments.map(segment => ({
      ...segment,
      start: segment.start.toISOString(),
      end: segment.end.toISOString(),
    })),
  };
}

// metric key → 감지 함수 매핑
const METRIC_DETECTORS = {
  cleaning_time:          (events) => detectCleaningTimeFailures(events),
  // 아래 4개는 "얼마나 심했는지"를 화면이 숫자로 보여줄 수 있도록 앞뒤 이벤트(퇴실·청소 완료·꺼짐)를 짝지은 detail 을 담는다
  post_checkout_energy:   (events) => detectPostCheckoutFailures(events, "post_checkout_energy_waste_detected"),
  post_checkout_security: (events) => detectPostCheckoutFailures(events, "post_checkout_security_breach_detected"),
  vacant_energy:          (events) => detectVacantEnergyFailures(events),
  post_cleaning_security: (events) => detectPostCleaningFailures(events, "post_cleaning_security_breach_detected"),
  pre_stay_optimization:  (events) => detectPreStayOptimizationFailures(events),
};

/**
 * 특정 지표의 실패 건 목록을 반환한다.
 *
 * @param {string} metric  — METRIC_DETECTORS 키 중 하나
 * @param {string} period  — getPeriodRange가 처리할 수 있는 기간 키
 * @param {{ db: object }} deps
 * @returns {Promise<{ metric, period, failCount, items }>}
 */
export async function getDrilldownForMetric(metric, period, { db, propertyIds = null }) {
  const detect = METRIC_DETECTORS[metric];
  if (!detect) throw new Error(`unknown metric: "${metric}"`);

  const range  = getPeriodRange(period);
  const events = await queryEvents(db, range, propertyIds);
  // 공실 에너지 낭비는 "언제 꺼졌는지"까지 봐야 얼마나 켜져 있었는지 알 수 있다 —
  // 기간이 끝난 뒤에 꺼진 건도 "꺼짐 확인 안 됨"으로 잘못 보이지 않게 기간 끝~지금의 꺼짐 기록만 더 가져온다
  const late   = metric === "vacant_energy"
    ? await queryLateEvents(db, range, propertyIds, "vacant_energy_waste_resolved")
    : [];
  const items  = detect(late.length > 0 ? events.concat(late) : events);

  return { metric, period, failCount: items.length, items };
}

/** 기간 끝 ~ 지금 사이의 특정 타입 이벤트 (기간이 아직 안 끝났으면 없음) */
async function queryLateEvents(db, range, propertyIds, type) {
  const fromMs = new Date(range.to).getTime();
  const nowMs  = Date.now();
  if (!(fromMs < nowMs)) return [];
  const later = await queryEvents(db, { from: new Date(fromMs), to: new Date(nowMs) }, propertyIds);
  return later.filter(e => e.type === type);
}
