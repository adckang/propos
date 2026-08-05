/**
 * GET /api/events/history?period=this_week&property_id=paju201&limit=50
 * 기간 내 이벤트 목록 반환.
 */

import { Pool } from "pg";
import { getPeriodRange } from "../../src/domain/reportingDomain.js";
import { queryEvents } from "../../src/infrastructure/eventRepository.js";

const VALID_PERIODS = [
  "now",
  "this_week", "last_week", "next_week",
  "this_month", "last_month", "next_month",
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { period = "this_week", property_id, limit = "50" } = req.query;

  if (!VALID_PERIODS.includes(period)) {
    return res.status(400).json({ error: `invalid period: ${period}` });
  }

  const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    let range;
    if (period === "now") {
      // 'now'는 오늘 하루로 처리
      const today = new Date();
      range = {
        from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())),
        to: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999)),
      };
    } else {
      range = getPeriodRange(period);
    }

    const events = await queryEvents(db, range, property_id || null);
    return res.status(200).json({
      events: events.slice(0, limitNum),
      total: events.length,
    });
  } catch (err) {
    console.error("[api/events/history] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    await db.end();
  }
}
