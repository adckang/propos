/**
 * /api/events/* — 이벤트 전체 API
 *
 * POST /api/events           Pi watcher → 이벤트 수신 (구 index.js)
 * POST /api/events/write     Pi watcher → 상태전환 이벤트 저장 (구 write.js)
 * GET  /api/events/history   기간별 이벤트 조회
 * GET  /api/events/:uuid     단일 이벤트 상세
 */

import { Pool } from "pg";
import { kv } from "@vercel/kv";
import { randomUUID } from "node:crypto";
import { getPeriodRange } from "../../src/domain/reportingDomain.js";
import { queryEvents, insertEvent } from "../../src/infrastructure/eventRepository.js";
import { validateEvent } from "../../src/domain/eventValidation.js";
import { processEvent } from "../../src/application/eventService.js";
import { notifyEvent } from "../../server/slackNotifier.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_PERIODS = ["now","this_week","last_week","next_week","this_month","last_month","next_month"];

function sendJson(res, status, body) {
  res.status(status).json(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}

async function ensureTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS events (
      id            UUID PRIMARY KEY,
      property_id   TEXT NOT NULL,
      type          TEXT NOT NULL,
      is_soft       BOOLEAN DEFAULT false,
      device_time   TIMESTAMPTZ NOT NULL,
      server_time   TIMESTAMPTZ DEFAULT NOW(),
      data          JSONB,
      status        TEXT DEFAULT 'pending',
      notified_at   TIMESTAMPTZ,
      UNIQUE (property_id, type, device_time)
    )
  `);
}

export default async function handler(req, res) {
  const action = (req.query?.slug
    ? (Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug)
    : (req.url || "").split("?")[0].split("/").filter(Boolean)[2]) || "";

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });

  try {
    // POST /api/events — Pi watcher 이벤트 수신 (구 index.js)
    if (!action && req.method === "POST") {
      const body = await readBody(req);
      const validation = validateEvent(body);
      if (!validation.success) {
        return sendJson(res, 400, {
          error: "Invalid event",
          issues: validation.error.issues.map((i) => i.message),
        });
      }
      const result = await processEvent(validation.data, { db, kv, notify: notifyEvent });
      if (result.status === "duplicate") return sendJson(res, 409, { status: "duplicate" });
      return sendJson(res, 201, { status: result.status, id: result.id });
    }

    // POST /api/events/write — 상태전환 이벤트 저장 (구 write.js)
    if (action === "write" && req.method === "POST") {
      const secret = req.headers["x-pi-secret"];
      if (!process.env.PROPOS_PI_SECRET || secret !== process.env.PROPOS_PI_SECRET) {
        return sendJson(res, 401, { error: "Unauthorized" });
      }
      const body = await readBody(req);
      const { type, is_soft, device_time, property_id, data } = body;
      if (!type || !property_id || !device_time) {
        return sendJson(res, 400, { error: "Missing required fields: type, property_id, device_time" });
      }
      await ensureTable(db);
      const event = {
        id:          randomUUID(),
        property_id,
        type,
        is_soft:     is_soft ?? false,
        device_time: new Date(device_time),
        data:        data ?? null,
      };
      const result = await insertEvent(db, event, is_soft ?? false);
      return sendJson(res, 200, result);
    }

    // GET only beyond this point
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method Not Allowed" });

    // GET /api/events/history
    if (action === "history") {
      const { period = "this_week", property_id, limit = "50" } = req.query;
      if (!VALID_PERIODS.includes(period)) return sendJson(res, 400, { error: `invalid period: ${period}` });
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
      return sendJson(res, 200, { events: events.slice(0, limitNum), total: events.length });
    }

    // GET /api/events/:uuid
    if (UUID_RE.test(action)) {
      const result = await db.query("SELECT * FROM events WHERE id = $1", [action]);
      if (result.rows.length === 0) return sendJson(res, 404, { error: "Event not found" });
      return sendJson(res, 200, result.rows[0]);
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[api/events] error:", err);
    return sendJson(res, 500, { error: "Internal server error" });
  } finally {
    await db.end();
  }
}
