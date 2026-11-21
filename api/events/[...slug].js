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
import { periodCapabilities } from "../../src/domain/periodDomain.js";
import { queryEvents, insertEvent } from "../../src/infrastructure/eventRepository.js";
import { validateEvent, validateWriteEvent } from "../../src/domain/eventValidation.js";
import { processEvent } from "../../src/application/eventService.js";
import { notifyEvent } from "../../server/slackNotifier.js";
import { hasWatcherSecret } from "../../server/watcherAuth.js";
import { DATA_PROFILE, resolveServerDataProfile } from "../../src/config/dataProfile.js";
import { OPERATOR_ALERT_EVENT_TYPES } from "../../src/config/eventTypes.js";

import { requireScope } from "../../server/auth/operatorAuth.js";
import { canAccessProperty, scopeQueryIds } from "../../server/auth/operatorAccounts.js";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    return sendJson(res, 403, { error: "demo profile is read-only", dataProfile: "demo" });
  }

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });

  try {
    // Both machine-ingestion branches use the same credential; GET keeps its
    // existing operator/session scope below. Do not expose a new root route.
    if (req.method === "POST" && (!action || action === "write")) {
      // 워처와 같은 확인(RF-21) — 서버 값이 비면 거절, 비교 시간으로 키가 새지 않게 해시 비교
      if (!hasWatcherSecret(req.headers, process.env)) {
        return sendJson(res, 401, { error: "Unauthorized" });
      }
    }

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
      const body = await readBody(req);
      if (!body?.type || !body?.property_id || !body?.device_time) {
        return sendJson(res, 400, { error: "Missing required fields: type, property_id, device_time" });
      }
      const validation = validateWriteEvent(body);
      if (!validation.success) {
        return sendJson(res, 400, { error: "Invalid event", issues: validation.error.issues.map(i => i.message) });
      }
      const { type, is_soft, device_time, property_id, data, source_system, source_ref } = validation.data;
      await ensureTable(db);
      const event = {
        id:          randomUUID(),
        property_id,
        type,
        is_soft:     is_soft ?? false,
        device_time: new Date(device_time),
        data:        data ?? null,
        source_system,
        source_ref,
      };
      const result = await insertEvent(db, event, is_soft ?? false);
      // RF-28: 운영자 알림이 필요한 문제는 처음 저장될 때 한 번 Slack 링크 — 재전송은 DB 중복(inserted=false)이라 다시 보내지 않는다
      // 한 번만 시도한다(재전송은 중복이라 다시 오지 않는다) — 실패는 로그로 남긴다. 5초 제한: Pi의 요청 제한(10초) 안에 응답한다
      if (result.inserted && OPERATOR_ALERT_EVENT_TYPES.has(type)) {
        try {
          const { sent } = await notifyEvent(result.id, property_id, type, { signal: AbortSignal.timeout(5_000) });
          if (!sent) console.error("[events/write] 운영자 Slack 알림이 전달되지 않음:", type, result.id);
        } catch (err) { console.error("[events/write] 운영자 Slack 알림 실패:", type, result.id, err?.message ?? err); }
      }
      return sendJson(res, 200, result);
    }

    // GET only beyond this point
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method Not Allowed" });

    // D-033/D-034: 조회(GET)는 로그인한 사람만, 그리고 그 사람 몫의 숙소만.
    // (POST 수신·write 는 Pi 워처 같은 기계 호출이라 위에서 이미 처리 — 기존 PROPOS_PI_SECRET 방식 유지)
    const scope = await requireScope(req, res, db);
    if (!scope) return;

    // GET /api/events/history
    if (action === "history") {
      const { period = "this_week", property_id, limit = "50" } = req.query;
      // 기간 허용·범위는 레포트(/api/stats)와 같은 규칙 — 허용은 periodCapabilities 표, 범위는 KST 달력의 getPeriodRange.
      // "now"는 레포트처럼 오늘(KST) 하루다(예전엔 UTC 하루라 한국 오전 9시 전에는 어제 날짜를 줬다).
      if (typeof period !== "string" || !periodCapabilities(period).stats) {
        return sendJson(res, 400, { error: `invalid period: ${period}` });
      }
      const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
      const range = getPeriodRange(period === "now" ? "today" : period);
      const events = await queryEvents(db, range, scopeQueryIds(scope, property_id ? [property_id] : null));
      return sendJson(res, 200, { events: events.slice(0, limitNum), total: events.length });
    }

    // GET /api/events/:uuid
    if (UUID_RE.test(action)) {
      const result = await db.query("SELECT * FROM events WHERE id = $1", [action]);
      // 허용 밖 숙소의 이벤트는 "없는 것"과 똑같이 404 (존재 여부도 알려주지 않는다)
      if (result.rows.length === 0 || !canAccessProperty(scope, result.rows[0].property_id)) return sendJson(res, 404, { error: "Event not found" });
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
