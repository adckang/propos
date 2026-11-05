/**
 * GET /api/stats?period=now&property_id=paju201
 * 기간별 KPI 수치 + 요약 문장 반환.
 */

import { Pool } from "pg";
import {
  getDrilldownForMetric,
  getMonthlyCalendarData,
  getPeriodInsights,
  getStatsForPeriod,
} from "../src/application/reportingService.js";
import { parsePropertyIds } from "../src/application/statsQueryParser.js";
import { periodCapabilities } from "../src/domain/periodDomain.js";
import { getDemoDrilldown, getDemoMonthlyCalendar, getDemoStats } from "../src/application/demoReportingService.js";
import { DATA_PROFILE, resolveServerDataProfile } from "../src/config/dataProfile.js";

import { requireScope } from "../server/auth/operatorAuth.js";
import { scopeQueryIds } from "../server/auth/operatorAccounts.js";
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

/**
 * 기간·경로별 요청 검증 — 운영·데모 경로가 같은 판정을 쓰도록 한 곳에서.
 * 기간마다 무엇이 열리는지는 periodDomain.periodCapabilities 표 하나가 정한다.
 * @returns {{ status: number, error: string } | null}  null = 통과
 */
function validateRequest(route, query) {
  if (route === "calendar") {
    const period = query.period ?? "this_month";
    return periodCapabilities(period).calendar ? null : { status: 400, error: `invalid period: ${period}` };
  }
  if (route === "drilldown") {
    const { period, metric } = query;
    if (!period) return { status: 400, error: "period is required" };
    if (!metric) return { status: 400, error: "metric is required" };
    if (!periodCapabilities(period).drilldown) return { status: 400, error: `invalid period: ${period}` };
    if (!VALID_DRILLDOWN_METRICS.includes(metric)) return { status: 400, error: `invalid metric: ${metric}` };
    return null;
  }
  if (route === "root") {
    const period = query.period ?? "now";
    return periodCapabilities(period).stats ? null : { status: 400, error: `invalid period: ${period}` };
  }
  return { status: 404, error: "Not Found" };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const route = statsRoute(req);
  let propertyIds = parsePropertyIds(req.query);
  const dataProfile = resolveServerDataProfile(process.env);

  const invalid = validateRequest(route, req.query ?? {});
  if (invalid) return res.status(invalid.status).json({ error: invalid.error });

  // demo는 DB를 열지 않는다. 로컬/preview/명시적 demo 배포가 모두 같은 순수 데이터 서비스를 쓴다.
  if (dataProfile === DATA_PROFILE.DEMO) {
    if (route === "calendar") return res.status(200).json(getDemoMonthlyCalendar(req.query.period ?? "this_month", { propertyIds }));
    if (route === "drilldown") return res.status(200).json(getDemoDrilldown(req.query.metric, req.query.period, { propertyIds }));
    return res.status(200).json(getDemoStats(req.query.period ?? "now", { propertyIds }));
  }

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });

  try {
    // D-033/D-034: 먼저 누구인지 확인하고, 볼 수 있는 숙소만 조회한다 (요청한 property_ids 와의 교집합)
    const scope = await requireScope(req, res, db);
    if (!scope) return;
    propertyIds = scopeQueryIds(scope, propertyIds);

    if (route === "calendar") {
      const period = req.query.period ?? "this_month";
      const result = await getMonthlyCalendarData(period, { db, propertyIds });
      return res.status(200).json({ ...result, dataProfile });
    }

    if (route === "drilldown") {
      const { period, metric } = req.query;
      const result = await getDrilldownForMetric(metric, period, { db, propertyIds });
      return res.status(200).json({ ...result, dataProfile });
    }

    const { period = "now" } = req.query;
    const result = await getStatsForPeriod(period, {
      db,
      propertyIds,
    });
    // "발견된 패턴" — 월간(D-027)·주간(D-029) 둘 다 이 부가 분석이 실패해도 이미 계산된
    // stats/summary는 살아있어야 하므로 자체 try/catch로 감싼다(코드 리뷰로 발견한 버그, D-027 참고).
    // "발견된 패턴" — 열리는 기간만, 실패해도 통계 응답은 살린다 (getPeriodInsights 가 처리)
    const insights = await getPeriodInsights(period, { db, propertyIds });
    if (insights) result.insights = insights;
    return res.status(200).json({ ...result, dataProfile });
  } catch (err) {
    console.error(`[api/stats${route === "root" ? "" : `/${route}`}] error:`, err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    await db.end();
  }
}
