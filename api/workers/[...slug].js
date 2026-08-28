/**
 * /api/workers/* — Worker App 전용 엔드포인트
 *
 * POST /api/workers/register  { phone, email, fcm_token }
 * POST /api/workers/heartbeat { fcm_token }
 * POST /api/workers/token     { fcm_token, new_token }
 */

import { Pool } from "pg";
import { postSlack } from "../cleaning/_dispatch.js";

const db = new Pool({ connectionString: process.env.POSTGRES_URL });

function parseSlug(req) {
  const raw = req.query?.slug;
  if (raw) return Array.isArray(raw) ? raw : [raw];
  const path = (req.url || "").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const idx = parts.indexOf("workers");
  return idx >= 0 ? parts.slice(idx + 1) : [];
}

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

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "").replace(/^82/, "0");
  const m = digits.match(/^(\d{3})(\d{4})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

/**
 * POST /api/workers/register
 * 앱 최초 설치 시 전화번호 + 이메일 + FCM 토큰 등록
 */
async function handleRegister(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

  const { phone, email, fcm_token } = await readBody(req);

  if (!phone || !email || !fcm_token) {
    return sendJson(res, 400, { error: "phone, email, fcm_token 필수" });
  }

  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = email.toLowerCase().trim();

  const { rows } = await db.query(
    `INSERT INTO cleaners (phone, email, tier, active, fcm_token, fcm_token_at, app_installed_at, last_seen_at, fcm_status)
     VALUES ($1, $2, 'BULK', false, $3, NOW(), NOW(), NOW(), 'active')
     ON CONFLICT (phone) DO UPDATE SET
       email          = EXCLUDED.email,
       fcm_token      = EXCLUDED.fcm_token,
       fcm_token_at   = NOW(),
       last_seen_at   = NOW(),
       fcm_status     = 'active'
     RETURNING id, phone, email, tier, active, fcm_status, app_installed_at`,
    [normalizedPhone, normalizedEmail, fcm_token]
  );

  const worker = rows[0];
  const isNew = worker.app_installed_at && new Date(worker.app_installed_at) > new Date(Date.now() - 5000);

  if (isNew) {
    await postSlack(
      `[PROPOS] 📱 신규 직원 앱 설치\n전화: ${normalizedPhone} | 이메일: ${normalizedEmail}\n대시보드에서 이름·등급 지정 필요`
    ).catch(() => {});
  }

  return sendJson(res, 200, {
    ok: true,
    worker: { id: worker.id, phone: worker.phone, email: worker.email, tier: worker.tier, active: worker.active, fcm_status: worker.fcm_status },
    message: worker.active ? "등록 완료" : "등록 완료. 호스트 승인 대기 중",
  });
}

/**
 * POST /api/workers/heartbeat
 * 앱 실행마다 호출 — last_seen_at 갱신, inactive이면 active로 복구
 */
async function handleHeartbeat(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

  const { fcm_token } = await readBody(req);
  if (!fcm_token) return sendJson(res, 400, { error: "fcm_token 필수" });

  const { rows } = await db.query(
    `UPDATE cleaners
     SET last_seen_at = NOW(),
         fcm_status   = CASE WHEN fcm_status = 'inactive' THEN 'active' ELSE fcm_status END
     WHERE fcm_token = $1
     RETURNING id, fcm_status`,
    [fcm_token]
  );

  if (!rows.length) return sendJson(res, 404, { error: "등록되지 않은 토큰" });

  return sendJson(res, 200, { ok: true, fcm_status: rows[0].fcm_status });
}

/**
 * POST /api/workers/token
 * FCM 토큰 갱신 (앱 재설치 또는 토큰 로테이션 시)
 */
async function handleTokenUpdate(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

  const { fcm_token, new_token } = await readBody(req);
  if (!fcm_token || !new_token) return sendJson(res, 400, { error: "fcm_token, new_token 필수" });

  const { rows } = await db.query(
    `UPDATE cleaners
     SET fcm_token    = $2,
         fcm_token_at = NOW(),
         fcm_status   = 'active',
         last_seen_at = NOW()
     WHERE fcm_token = $1
     RETURNING id`,
    [fcm_token, new_token]
  );

  if (!rows.length) return sendJson(res, 404, { error: "기존 토큰을 찾을 수 없음" });

  return sendJson(res, 200, { ok: true });
}

/**
 * GET  /api/workers/profile?fcm_token=...
 * PATCH /api/workers/profile  { fcm_token, name, email }
 */
async function handleProfile(req, res) {
  if (req.method === "GET") {
    const fcm_token = req.query?.fcm_token;
    if (!fcm_token) return sendJson(res, 400, { error: "fcm_token 필수" });
    const { rows } = await db.query(
      `SELECT id, name, phone, email, tier, active, fcm_status FROM cleaners WHERE fcm_token=$1`,
      [fcm_token]
    );
    if (!rows.length) return sendJson(res, 404, { error: "등록되지 않은 토큰" });
    return sendJson(res, 200, rows[0]);
  }
  if (req.method === "PATCH") {
    const { fcm_token, name, email } = await readBody(req);
    if (!fcm_token) return sendJson(res, 400, { error: "fcm_token 필수" });
    const { rows } = await db.query(
      `UPDATE cleaners
       SET name  = COALESCE($2, name),
           email = COALESCE($3, email)
       WHERE fcm_token = $1
       RETURNING id, name, phone, email, tier, active`,
      [fcm_token, name ?? null, email ? email.toLowerCase().trim() : null]
    );
    if (!rows.length) return sendJson(res, 404, { error: "등록되지 않은 토큰" });
    return sendJson(res, 200, { ok: true, worker: rows[0] });
  }
  return sendJson(res, 405, { error: "GET or PATCH only" });
}

export default async function handler(req, res) {
  const slug = parseSlug(req);
  const [resource] = slug;

  try {
    if (resource === "register")  return await handleRegister(req, res);
    if (resource === "heartbeat") return await handleHeartbeat(req, res);
    if (resource === "token")     return await handleTokenUpdate(req, res);
    if (resource === "profile")   return await handleProfile(req, res);

    return sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(`[workers/${slug.join("/")}]`, err);
    return sendJson(res, 500, { error: err.message });
  }
}
