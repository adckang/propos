/**
 * GET /api/stats/drilldown?period=last_week&metric=cleaning_time
 * 특정 지표의 실패 건 목록 반환.
 *
 * metric 값:
 *   cleaning_time          — 청소 3시간 초과 건
 *   post_checkout_energy   — 퇴실후 절전 위반 건
 *   post_checkout_security — 퇴실후 보안 위반 건
 *   vacant_energy          — 공실 에너지낭비 건
 *   post_cleaning_security — 청소후 보안 위반 건
 *   pre_stay_optimization  — 입실전 최적화 미완료 건
 */

import { Pool } from "pg";
import { getDrilldownForMetric } from "../../src/application/reportingService.js";

const VALID_PERIODS = [
  "yesterday", "last_hour", "last_week", "last_month",
];

const VALID_METRICS = [
  "cleaning_time",
  "post_checkout_energy",
  "post_checkout_security",
  "vacant_energy",
  "post_cleaning_security",
  "pre_stay_optimization",
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { period, metric } = req.query;

  if (!period) return res.status(400).json({ error: "period is required" });
  if (!metric) return res.status(400).json({ error: "metric is required" });
  if (!VALID_PERIODS.includes(period)) return res.status(400).json({ error: `invalid period: ${period}` });
  if (!VALID_METRICS.includes(metric)) return res.status(400).json({ error: `invalid metric: ${metric}` });

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    const result = await getDrilldownForMetric(metric, period, { db });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/stats/drilldown] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    await db.end();
  }
}
