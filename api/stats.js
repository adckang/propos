/**
 * GET /api/stats?period=now&property_id=paju201
 * 기간별 KPI 수치 + 요약 문장 반환.
 */

import { Pool } from "pg";
import { getStatsForPeriod } from "../src/application/reportingService.js";
import { parsePropertyIds } from "../src/application/statsQueryParser.js";
import { parseOffsetPeriod } from "../src/domain/periodDomain.js";

const VALID_PERIODS = [
  "now",
  "yesterday", "today", "tomorrow",
  "last_hour", "next_hour",
  "this_week", "last_week", "next_week",
  "this_month", "last_month", "next_month",
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { period = "now" } = req.query;

  // 표준 기간 이름 + 몇 주/며칠 뒤·전 (weeks_ahead_2, days_ago_3 …)
  if (!VALID_PERIODS.includes(period) && !parseOffsetPeriod(period)) {
    return res.status(400).json({ error: `invalid period: ${period}` });
  }

  const propertyIds = parsePropertyIds(req.query);

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    const result = await getStatsForPeriod(period, {
      db,
      propertyIds,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/stats] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    await db.end();
  }
}
