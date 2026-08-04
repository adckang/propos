/**
 * GET /api/events/:id
 * 단일 이벤트 상세 조회 — Slack 알림 링크 목적지.
 */

import { createPool } from "@vercel/postgres";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { id } = req.query;

  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "invalid event id" });
  }

  const db = createPool({ connectionString: process.env.POSTGRES_URL });
  try {
    const result = await db.query("SELECT * FROM events WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("[api/events/:id] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    await db.end();
  }
}
