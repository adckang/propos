/**
 * POST /api/events
 * Pi watcher → Vercel 이벤트 수신 핸들러.
 *
 * @vercel/postgres, @vercel/kv는 api/ 폴더에서만 import (D-014).
 */

import { createPool } from "@vercel/postgres";
import { kv } from "@vercel/kv";
import { validateEvent } from "../src/domain/eventValidation.js";
import { processEvent } from "../src/application/eventService.js";
import { notifyEvent } from "../server/slackNotifier.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 1. 입력 검증
  const validation = validateEvent(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: "Invalid event",
      issues: validation.error.issues.map((i) => i.message),
    });
  }

  const db = createPool({ connectionString: process.env.POSTGRES_URL });

  try {
    const result = await processEvent(validation.data, {
      db,
      kv,
      notify: notifyEvent,
    });

    if (result.status === "duplicate") {
      return res.status(409).json({ status: "duplicate" });
    }

    return res.status(201).json({ status: result.status, id: result.id });
  } catch (err) {
    console.error("[api/events] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    await db.end();
  }
}
