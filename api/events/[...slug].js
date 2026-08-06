/**
 * GET /api/events/history?period=this_week&property_id=paju201&limit=50
 * GET /api/events/:id   — 단일 이벤트 상세 조회
 *
 * slug[0] = "history" | <uuid>
 */

import { Pool } from "pg";
import { getPeriodRange } from "../../src/domain/reportingDomain.js";
import { queryEvents } from "../../src/infrastructure/eventRepository.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_PERIODS = [
  "now",
  "this_week", "last_week", "next_week",
  "this_month", "last_month", "next_month",
];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const slug = req.query.slug;
  const action = Array.isArray(slug) ? slug[0] : slug;

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    if (action === "history") {
      const { period = "this_week", property_id, limit = "50" } = req.query;

      if (!VALID_PERIODS.includes(period)) {
        return res.status(400).json({ error: `invalid period: ${period}` });
      }

      const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);

      let range;
      if (period === "now") {
        const today = new Date();
        range = {
          from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())),
          to:   new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999)),
        };
      } else {
        range = getPeriodRange(period);
      }

      const events = await queryEvents(db, range, property_id || null);
      return res.status(200).json({ events: events.slice(0, limitNum), total: events.length });
    }

    if (UUID_RE.test(action)) {
      const result = await db.query("SELECT * FROM events WHERE id = $1", [action]);
      if (result.rows.length === 0) return res.status(404).json({ error: "Event not found" });
      return res.status(200).json(result.rows[0]);
    }

    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error("[api/events/slug] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    await db.end();
  }
}
