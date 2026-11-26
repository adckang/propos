/**
 * /api/workers/* — Worker App 전용 엔드포인트
 *
 * POST /api/workers/register  { phone, email, fcm_token }
 * POST /api/workers/heartbeat { fcm_token }
 * POST /api/workers/token     { fcm_token, new_token }
 * GET  /api/workers/token     Authorization: Bearer <current token> (owner confirmation)
 */

import { Pool } from "pg";
import { postSlack } from "../../server/cleaning/_dispatch.js";
import { probeToken } from "../../server/cleaning/_push.js";
import { listWorkerRequests } from "../../server/cleaning/_workerRequests.js";
import { DATA_PROFILE, resolveServerDataProfile } from "../../src/config/dataProfile.js";

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

function bearerToken(req) {
  const authorization = req.headers?.authorization ?? req.headers?.Authorization;
  return typeof authorization === 'string' ? authorization.match(/^Bearer (\S+)$/i)?.[1] : null;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) ?? {}; } // 본문이 JSON null 이어도 빈 요청으로
  catch { return {}; }
}

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "").replace(/^82/, "0");
  const m = digits.match(/^(\d{3})(\d{4})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

/**
 * POST /api/workers/register
 * 앱 최초 설치 시 관리자가 저장한 전화번호·이메일을 확인하고 FCM 토큰 연결
 *
 * 관리자가 미리 만든 담당자의 전화번호와 이메일이 모두 일치해야 한다. 앱 등록으로 담당자를 새로 만들거나
 * 이메일·승인·등급을 바꾸지 않는다. 별도 문자·메일 인증은 사용하지 않는다.
 *  - 토큰은 그 담당자에게 쓸 수 있는 토큰이 없을 때만 받는다 — 토큰 없음(관리자가 만든 담당자의 첫 설치), 알림 서버가
 *    그 토큰을 "등록 안 됨"으로 알려 옴(unregistered — 발송 실패 표시는 그 토큰일 때만 남는다), 같은 토큰(앱의 재시도 — 상태는 그대로).
 *    invalid는 발송 내용 오류에서도 생길 수 있어 근거로 쓰지 않고 아래 시험 발송으로 다시 묻는다.
 *  - 살아 있어 보이는 토큰이 있으면 그 자리에서 알림 서버에 시험 발송으로 묻는다(기기에는 아무것도 안 감). 없어진 토큰이면
 *    평소 발송 실패 때처럼 unregistered로 표시하고 같은 규칙으로 한 번 더 — 앱을 지우고 다시 설치한 담당자는 바로 복구된다(DEC-09).
 *    살아 있거나 확인할 수 없으면 409이고 아무것도 바꾸지 않는다.
 *  - 이메일은 비교만 하고 바꾸지 않는다 — 캘린더 배정이 이메일로 담당자를 찾는다. 이메일 변경은 관리자 화면에서.
 *    응답에도 저장된 이메일을 싣지 않는다.
 *  - 번호는 휴대폰 형식(010-0000-0000)만 받는다 — 같은 번호가 다른 표기로 두 담당자가 되지 않게(DEC-08 "전화번호는 유일").
 *  - 이 기기 토큰이 이미 다른 번호의 담당자에게 있으면 409 — 한 토큰이 두 담당자에게 붙으면 토큰 갱신이 막힌다.
 */
async function handleRegister(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

  const { phone, email, fcm_token } = await readBody(req);

  if (!phone || !email || !fcm_token) {
    return sendJson(res, 400, { error: "phone, email, fcm_token 필수" });
  }

  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = email.toLowerCase().trim();
  if (!/^\d{3}-\d{4}-\d{4}$/.test(normalizedPhone)) {
    return sendJson(res, 400, { error: "전화번호 형식이 올바르지 않습니다" });
  }

  const { rows: registered } = await db.query(
    `SELECT id FROM cleaners WHERE phone = $1 AND lower(trim(email)) = $2 LIMIT 1`,
    [normalizedPhone, normalizedEmail]);
  if (!registered.length) {
    return sendJson(res, 404, { error: "등록된 담당자 정보와 전화번호 또는 이메일이 일치하지 않습니다. 호스트에게 확인해 주세요" });
  }

  const { rows: holders } = await db.query(
    `SELECT id FROM cleaners WHERE fcm_token = $1 AND phone <> $2 LIMIT 1`, [fcm_token, normalizedPhone]);
  if (holders.length) return sendJson(res, 409, { error: "이 기기는 다른 번호로 이미 등록돼 있습니다" });

  const attach = async () => (await db.query(
    `UPDATE cleaners SET
       fcm_token      = $3,
       fcm_token_at   = CASE WHEN fcm_token = $3 THEN fcm_token_at ELSE NOW() END,
       app_installed_at = COALESCE(app_installed_at, NOW()),
       last_seen_at   = NOW(),
       -- 같은 토큰의 재시도는 상태를 되살리지 않는다(알림 서버가 죽었다고 한 토큰이 다시 active가 되지 않게)
       fcm_status     = CASE WHEN fcm_token = $3 THEN fcm_status ELSE 'active' END
     WHERE phone = $1
       AND lower(trim(email)) = $2
       AND (fcm_token IS NULL OR fcm_token = $3 OR fcm_status = 'unregistered')
     RETURNING id, name, phone, tier, active, fcm_status, app_installed_at`,
    [normalizedPhone, normalizedEmail, fcm_token]
  )).rows[0];

  let worker;
  worker = await attach();
  if (!worker) {
    // 살아 있어 보이는 토큰 — 정말 쓰이는지 알림 서버에 묻는다. 없어졌으면 평소 발송 실패와 같은 표시 후 한 번 더
    const { rows: [current] } = await db.query(
      `SELECT id, fcm_token FROM cleaners WHERE phone = $1 AND lower(trim(email)) = $2`,
      [normalizedPhone, normalizedEmail]);
    if (current?.fcm_token && await probeToken(current.fcm_token) === "dead") {
      await db.query(`UPDATE cleaners SET fcm_status = 'unregistered' WHERE id = $1 AND fcm_token = $2`, [current.id, current.fcm_token]);
      worker = await attach();
    }
  }
  if (!worker) {
    console.warn("[workers/register] 이미 다른 기기가 쓰는 번호로 등록 시도 — 바꾸지 않음");
    return sendJson(res, 409, { error: "이미 다른 기기에 등록된 번호입니다. 호스트에게 문의해 주세요" });
  }
  const isNew = worker.app_installed_at && new Date(worker.app_installed_at) > new Date(Date.now() - 5000);

  // RF-57(사용자 결정): 관리자가 이름·등급을 이미 저장했으므로 이름만 알린다 — 전화번호·이메일은 Slack에 싣지 않는다
  if (isNew) {
    await postSlack(`[PROPOS] 📱 ${worker.name?.trim() || "이름 없음"} 담당자 앱 연결됨`).catch(() => {});
  }

  return sendJson(res, 200, {
    ok: true,
    worker: { id: worker.id, phone: worker.phone, tier: worker.tier, active: worker.active, fcm_status: worker.fcm_status },
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
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, no-store');
    const token = bearerToken(req);
    if (!token) return sendJson(res, 401, { error: 'token required' });
    let rows;
    try { ({ rows } = await db.query('SELECT id FROM cleaners WHERE fcm_token=$1 LIMIT 2', [token])); }
    catch (error) { throw Object.assign(new Error('FCM_TOKEN_STORAGE_FAILED'), { code: error.code }); }
    if (rows.length > 1) return sendJson(res, 409, { error: 'token owner ambiguous' });
    if (!rows.length) return sendJson(res, 404, { error: '등록되지 않은 토큰' });
    return sendJson(res, 200, { ok: true, worker_id: rows[0].id });
  }
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

  const { fcm_token, new_token, worker_id } = await readBody(req);
  if (typeof fcm_token !== 'string' || !fcm_token.trim() || typeof new_token !== 'string' || !new_token.trim()) {
    return sendJson(res, 400, { error: "fcm_token, new_token 필수" });
  }
  if (worker_id !== undefined && (typeof worker_id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(worker_id))) {
    return sendJson(res, 400, { error: 'worker_id invalid' });
  }
  const workerId = worker_id?.toLowerCase();

  let client, discardConnection;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL statement_timeout='5s'");
    // Serialize token API claims to the same destination without a new table.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`worker-fcm:${new_token}`]);
    const { rows } = await client.query(`SELECT id,fcm_token FROM cleaners
      WHERE fcm_token=ANY($1::text[]) OR id=$2::uuid ORDER BY id FOR UPDATE`, [[fcm_token, new_token], workerId ?? null]);
    const oldOwners = rows.filter(row => row.fcm_token === fcm_token);
    const newOwners = rows.filter(row => row.fcm_token === new_token);
    const worker = workerId ? rows.find(row => row.id === workerId) : oldOwners[0];
    let status = 200, body = { ok: true };
    if (oldOwners.length > 1 || newOwners.length > 1) {
      status = 409; body = { error: 'token owner ambiguous' };
    } else if (!worker || (oldOwners.length && oldOwners[0].id !== worker.id) ||
        ![fcm_token, new_token].includes(worker.fcm_token)) {
      status = 404; body = { error: '기존 토큰을 찾을 수 없음' };
    } else if (newOwners.length && newOwners[0].id !== worker.id) {
      status = 409; body = { error: 'token already belongs to another worker' };
    } else if (!(workerId && worker.fcm_token === new_token)) {
      await client.query(`UPDATE cleaners SET fcm_token=$2,fcm_token_at=NOW(),fcm_status='active',last_seen_at=NOW()
        WHERE id=$1 AND fcm_token=$3`, [worker.id, new_token, fcm_token]);
    }
    // Lost-ACK retries with the confirmed ID are read-only confirmations; they
    // cannot reactivate inactive/invalid tokens or change lifecycle timestamps.
    await client.query('COMMIT');
    return sendJson(res, status, body);
  } catch (error) {
    // ROLLBACK 까지 실패한 연결은 트랜잭션이 남아 있을 수 있어 풀에 돌려주지 않고 폐기한다
    try { await client?.query('ROLLBACK'); } catch (rollbackError) { discardConnection = rollbackError; }
    throw Object.assign(new Error('FCM_TOKEN_STORAGE_FAILED'), { code: error.code });
  } finally { client?.release(discardConnection); }
}

/**
 * GET  /api/workers/profile?fcm_token=...
 * PATCH /api/workers/profile  { fcm_token, name }
 *
 * ACT-11 ②(사용자 결정, 2026-11-26): 앱에서는 이름만 바꾼다. 번호·이메일은 관리자 화면에서만 — 이메일은 캘린더 배정이 담당자를
 * 찾는 열쇠이고, 앱 연결도 관리자가 저장한 번호·이메일로 확인한다(4ea6801). 저장된 값과 다른 번호·이메일이 오면 아무것도 바꾸지 않고 403.
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
    const { fcm_token, name, email, phone } = await readBody(req);
    if (!fcm_token) return sendJson(res, 400, { error: "fcm_token 필수" });
    const { rows: [current] } = await db.query(
      `SELECT id, phone, email FROM cleaners WHERE fcm_token = $1`, [fcm_token]);
    if (!current) return sendJson(res, 404, { error: "등록되지 않은 토큰" });
    const changesPhone = typeof phone === "string" && phone.trim() !== "" && normalizePhone(phone) !== current.phone;
    const changesEmail = typeof email === "string" && email.trim() !== ""
      && email.toLowerCase().trim() !== String(current.email ?? "").toLowerCase().trim();
    if (changesPhone || changesEmail) {
      return sendJson(res, 403, { error: "전화번호·이메일은 관리자가 바꿉니다. 호스트에게 요청해 주세요" });
    }
    const { rows } = await db.query(
      `UPDATE cleaners
       SET name = COALESCE($2, name)
       WHERE id = $1 AND fcm_token = $3
       RETURNING id, name, phone, email, tier, active`,
      [current.id, name ?? null, fcm_token]
    );
    if (!rows.length) return sendJson(res, 404, { error: "등록되지 않은 토큰" });
    return sendJson(res, 200, { ok: true, worker: rows[0] });
  }
  return sendJson(res, 405, { error: "GET or PATCH only" });
}

async function handleRequests(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET only' });
  const token = bearerToken(req);
  if (!token) return sendJson(res, 401, { error: 'token required' });
  try {
    const { status, requests, error } = await listWorkerRequests(db, token);
    return sendJson(res, status, status === 200 ? { ok: true, requests } : { error });
  } catch (err) {
    console.error('[workers/requests] 조회 실패:', err?.code ?? err?.name);
    return sendJson(res, 500, { error: '청소 요청 조회 실패' });
  }
}

export default async function handler(req, res) {
  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    return sendJson(res, 403, { error: "demo profile is read-only", dataProfile: "demo" });
  }
  const slug = parseSlug(req);
  const [resource] = slug;

  try {
    if (resource === "register")  return await handleRegister(req, res);
    if (resource === "heartbeat") return await handleHeartbeat(req, res);
    if (resource === "token")     return await handleTokenUpdate(req, res);
    if (resource === "profile")   return await handleProfile(req, res);
    if (resource === "requests")  return await handleRequests(req, res);

    return sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(`[workers/${slug.join("/")}]`, err);
    return sendJson(res, 500, { error: err.message });
  }
}
