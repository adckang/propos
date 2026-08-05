/**
 * GET /api/stats?period=now&property_id=paju201
 * 기간별 KPI 수치 + 요약 문장 반환.
 */

import { Pool } from "pg";
import { kv } from "@vercel/kv";
import { getStatsForPeriod } from "../src/application/reportingService.js";

const VALID_PERIODS = [
  "now",
  "this_week", "last_week", "next_week",
  "this_month", "last_month", "next_month",
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { period = "now", property_id } = req.query;

  if (!VALID_PERIODS.includes(period)) {
    return res.status(400).json({ error: `invalid period: ${period}` });
  }

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    const result = await getStatsForPeriod(period, {
      db,
      kv,
      propertyId: property_id || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/stats] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    await db.end();
  }
}
