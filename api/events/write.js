/**
 * POST /api/events/write
 * Pi 워처에서 상태 전환 이벤트를 Postgres에 저장.
 *
 * 인증: x-pi-secret 헤더 (Vercel 환경변수 PROPOS_PI_SECRET과 일치해야 함)
 * Body: { type, is_soft, device_time, property_id, data? }
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { insertEvent } from '../../src/infrastructure/eventRepository.js';

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

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const secret = req.headers['x-pi-secret'];
  if (!process.env.PROPOS_PI_SECRET || secret !== process.env.PROPOS_PI_SECRET) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const body = await readBody(req);
  const { type, is_soft, device_time, property_id, data } = body;

  if (!type || !property_id || !device_time) {
    sendJson(res, 400, { error: 'Missing required fields: type, property_id, device_time' });
    return;
  }

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    await ensureTable(db); // 첫 배포 후 테이블 생성되면 이 줄 제거 가능

    const event = {
      id:          randomUUID(),
      property_id,
      type,
      is_soft:     is_soft ?? false,
      device_time: new Date(device_time),
      data:        data ?? null,
    };

    const result = await insertEvent(db, event, is_soft ?? false);
    sendJson(res, 200, result);
  } catch (err) {
    console.error('[api/events/write]', err.message);
    sendJson(res, 500, { error: err.message });
  } finally {
    await db.end();
  }
}
