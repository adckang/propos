import { getPeriodRange, countCurrentStats, countPeriodEvents } from "../domain/reportingDomain.js";
import { describePeriod } from "../domain/periodDomain.js";
import {
  detectCleaningTimeFailures,
  detectEventTypeFailures,
  detectPreStayOptimizationFailures,
} from "../domain/metricDrilldownDomain.js";
import { queryEvents, getLastKnownStatesFromDB } from "../infrastructure/eventRepository.js";
import { queryCleaningJobCounts } from "../infrastructure/cleaningJobRepository.js";

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
    if (stats.anomalies > 0) return `이번 주 이상감지 ${stats.anomalies}건이 있어요.`;
    return `이번 주 체크인 ${stats.checkIns}건, 체크아웃 ${stats.checkOuts}건이에요.`;
  }
  if (period === "last_week") {
    const base = stats.anomalies > 0
      ? `지난주 체크인 ${stats.checkIns}건 완료, 이상감지 ${stats.anomalies}건이 있었어요.`
      : `지난주 체크인 ${stats.checkIns}건 완료, 이상 없었어요.`;
    return base + softSuffix(stats);
  }
  if (period === "next_week") {
    return stats.checkIns > 0 ? `다음 주 체크인 ${stats.checkIns}건 예정이에요.` : `다음 주 예약이 없어요.`;
  }

  // 월 단위
  if (period === "this_month") {
    if (stats.anomalies > 0) return `이번 달 이상감지 ${stats.anomalies}건이 있어요.`;
    return `이번 달 체크인 ${stats.checkIns}건, 체크아웃 ${stats.checkOuts}건이에요.`;
  }
  if (period === "last_month") {
    if (stats.anomalies > 0) return `지난달 체크인 ${stats.checkIns}건 완료, 이상감지 ${stats.anomalies}건이 있었어요.`;
    return `지난달 체크인 ${stats.checkIns}건 완료, 이상 없었어요.`;
  }
  if (period === "next_month") {
    return stats.checkIns > 0 ? `다음 달 체크인 ${stats.checkIns}건 예정이에요.` : `다음 달 예약이 없어요.`;
  }

  // 일 단위
  if (period === "yesterday") {
    const base = stats.anomalies > 0
      ? `어제 체크인 ${stats.checkIns}건, 이상감지 ${stats.anomalies}건이 있었어요.`
      : `어제 체크인 ${stats.checkIns}건 완료, 이상 없었어요.`;
    return base + softSuffix(stats);
  }
  if (period === "tomorrow") {
    return stats.checkIns > 0 ? `내일 체크인 ${stats.checkIns}건 예정이에요.` : `내일 예약된 체크인이 없어요.`;
  }

  // 시간 단위
  if (period === "last_hour") {
    const total = (stats.checkIns ?? 0) + (stats.checkOuts ?? 0) + (stats.anomalies ?? 0);
    return total > 0 ? `지난 1시간 이벤트 ${total}건이 있었어요.` : `지난 1시간 이벤트가 없어요.`;
  }
  if (period === "next_hour") {
    return stats.checkIns > 0 ? `1시간 내 체크인 ${stats.checkIns}건 예정이에요.` : `1시간 내 예정된 이벤트가 없어요.`;
  }

  // 몇 주·며칠 뒤/전 (weeks_ahead_2, days_ago_3 …) — "2주 전 …", "3일 뒤 …"
  const d = describePeriod(period);
  if (d && (d.unit === "week" || d.unit === "day") && d.tense !== "active") {
    if (d.tense === "past") {
      const base = stats.anomalies > 0
        ? `${d.label} 체크인 ${stats.checkIns}건 완료, 이상감지 ${stats.anomalies}건이 있었어요.`
        : `${d.label} 체크인 ${stats.checkIns}건 완료, 이상 없었어요.`;
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

  const range = getPeriodRange(period);
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

// metric key → 감지 함수 매핑
const METRIC_DETECTORS = {
  cleaning_time:          (events) => detectCleaningTimeFailures(events),
  post_checkout_energy:   (events) => detectEventTypeFailures(events, "post_checkout_energy_waste_detected"),
  post_checkout_security: (events) => detectEventTypeFailures(events, "post_checkout_security_breach_detected"),
  vacant_energy:          (events) => detectEventTypeFailures(events, "vacant_energy_waste_detected"),
  post_cleaning_security: (events) => detectEventTypeFailures(events, "post_cleaning_security_breach_detected"),
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
export async function getDrilldownForMetric(metric, period, { db }) {
  const detect = METRIC_DETECTORS[metric];
  if (!detect) throw new Error(`unknown metric: "${metric}"`);

  const range  = getPeriodRange(period);
  const events = await queryEvents(db, range);
  const items  = detect(events);

  return { metric, period, failCount: items.length, items };
}
