/**
 * GET /api/stats?period=now&property_id=paju201
 * 기간별 KPI 수치 + 요약 문장 반환.
 */

import { Pool } from "pg";
import {
  getDrilldownForMetric,
  getMonthlyCalendarData,
  getMonthlyInsights,
  getWeeklyInsights,
  getStatsForPeriod,
} from "../src/application/reportingService.js";
import { parsePropertyIds } from "../src/application/statsQueryParser.js";
import { describePeriod, parseOffsetPeriod } from "../src/domain/periodDomain.js";

const VALID_STATS_PERIODS = [
  "now",
  "yesterday", "today", "tomorrow",
  "last_hour", "next_hour",
  "this_week", "last_week", "next_week",
  "this_month", "last_month", "next_month",
];

const VALID_CALENDAR_PERIODS = new Set(["last_month", "this_month", "next_month"]);

const VALID_DRILLDOWN_PERIODS = [
  "yesterday", "last_hour", "this_week", "last_week", "this_month", "last_month",
];

const VALID_DRILLDOWN_METRICS = [
  "cleaning_time",
  "post_checkout_energy",
  "post_checkout_security",
  "vacant_energy",
  "post_cleaning_security",
  "pre_stay_optimization",
];

function statsRoute(req) {
  const slug = Array.isArray(req.query?.slug) ? req.query.slug[0] : req.query?.slug;
  if (slug) return slug;
  const pathname = (req.url || "").split("?")[0].replace(/\/+$/, "");
  if (pathname.endsWith("/calendar")) return "calendar";
  if (pathname.endsWith("/drilldown")) return "drilldown";
  return "root";
}

function isValidDrilldownPeriod(period) {
  if (VALID_DRILLDOWN_PERIODS.includes(period)) return true;
  const descriptor = describePeriod(period);
  return Boolean(
    descriptor && descriptor.tense === "past" &&
    (descriptor.unit === "week" || descriptor.unit === "day")
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const route = statsRoute(req);
  const propertyIds = parsePropertyIds(req.query);
  const db = new Pool({ connectionString: process.env.POSTGRES_URL });

  try {
    if (route === "calendar") {
      const period = req.query.period ?? "this_month";
      if (!VALID_CALENDAR_PERIODS.has(period)) {
        return res.status(400).json({ error: `invalid period: ${period}` });
      }
      const result = await getMonthlyCalendarData(period, { db, propertyIds });
      return res.status(200).json(result);
    }

    if (route === "drilldown") {
      const { period, metric } = req.query;
      if (!period) return res.status(400).json({ error: "period is required" });
      if (!metric) return res.status(400).json({ error: "metric is required" });
      if (!isValidDrilldownPeriod(period)) {
        return res.status(400).json({ error: `invalid period: ${period}` });
      }
      if (!VALID_DRILLDOWN_METRICS.includes(metric)) {
        return res.status(400).json({ error: `invalid metric: ${metric}` });
      }
      const result = await getDrilldownForMetric(metric, period, { db, propertyIds });
      return res.status(200).json(result);
    }

    if (route !== "root") {
      return res.status(404).json({ error: "Not Found" });
    }

    const { period = "now" } = req.query;
    // 표준 기간 이름 + 몇 주/며칠 뒤·전 (weeks_ahead_2, days_ago_3 …)
    if (!VALID_STATS_PERIODS.includes(period) && !parseOffsetPeriod(period)) {
      return res.status(400).json({ error: `invalid period: ${period}` });
    }
    const result = await getStatsForPeriod(period, {
      db,
      propertyIds,
    });
    // "발견된 패턴" — 월간(D-027)·주간(D-029) 둘 다 이 부가 분석이 실패해도 이미 계산된
    // stats/summary는 살아있어야 하므로 자체 try/catch로 감싼다(코드 리뷰로 발견한 버그, D-027 참고).
    if (period === "this_month" || period === "last_month") {
      try {
        result.insights = await getMonthlyInsights(period, { db, propertyIds });
      } catch (err) {
        console.error("[api/stats] getMonthlyInsights 실패 — insights 없이 응답:", err?.message ?? err);
        result.insights = [];
      }
    } else if (period === "this_week" || period === "last_week") {
      try {
        result.insights = await getWeeklyInsights(period, { db, propertyIds });
      } catch (err) {
        console.error("[api/stats] getWeeklyInsights 실패 — insights 없이 응답:", err?.message ?? err);
        result.insights = [];
      }
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error(`[api/stats${route === "root" ? "" : `/${route}`}] error:`, err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    await db.end();
  }
}
