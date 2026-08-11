/**
 * /api/cleaning/* — 청소 관련 관리자 API
 *
 * GET    /api/cleaning/cleaners           청소자 목록
 * POST   /api/cleaning/cleaners           청소자 등록
 * PATCH  /api/cleaning/cleaners/:id       청소자 수정
 * DELETE /api/cleaning/cleaners/:id       청소자 비활성화
 *
 * GET    /api/cleaning/properties         숙소 청소 설정 목록
 * POST   /api/cleaning/properties         숙소 청소 설정 등록/수정
 *
 * GET    /api/cleaning/jobs               청소 일정 목록 (?status=&limit=)
 * GET    /api/cleaning/jobs/:id           청소 일정 상세 (notifs 포함)
 *
 * POST   /api/cleaning/dispatch/:jobId    수동 발송 시작 (PENDING job 전용)
 */

import { Pool } from "pg";
import {
  advanceJob,
  getPropertyConfig,
  calcCleaningTimes,
} from "./_dispatch.js";

const db = new Pool({ connectionString: process.env.POSTGRES_URL });

function parseSlug(req) {
  const raw = req.query?.slug;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "").replace(/^82/, "0");
  const m = digits.match(/^(\d{3})(\d{4})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

// ── cleaners ──────────────────────────────────────────────

async function listCleaners(res) {
  const { rows } = await db.query(
    `SELECT * FROM cleaners ORDER BY
       CASE tier WHEN 'VIP_1' THEN 1 WHEN 'VIP_2' THEN 2 WHEN 'VIP_3' THEN 3 ELSE 4 END,
       name`
  );
  return sendJson(res, 200, rows);
}

async function createCleaner(req, res) {
  const b = await readBody(req);
  const { name, phone, email, tier, notes } = b;
  if (!name || !phone || !email || !tier) {
    return sendJson(res, 400, { error: "name, phone, email, tier 필수" });
  }
  const validTiers = ["VIP_1", "VIP_2", "VIP_3", "BULK"];
  if (!validTiers.includes(tier)) {
    return sendJson(res, 400, { error: `tier는 ${validTiers.join("/")} 중 하나` });
  }
  const normalizedPhone = normalizePhone(phone);
  try {
    const { rows } = await db.query(
      `INSERT INTO cleaners (name, phone, email, tier, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, normalizedPhone, email.toLowerCase().trim(), tier, notes ?? null]
    );
    return sendJson(res, 201, rows[0]);
  } catch (e) {
    if (e.code === "23505") return sendJson(res, 409, { error: "전화번호 또는 이메일 중복" });
    throw e;
  }
}

async function updateCleaner(req, res, id) {
  const b = await readBody(req);
  const fields = [];
  const vals = [];
  let i = 1;
  for (const k of ["name", "email", "tier", "notes", "active"]) {
    if (k in b) {
      fields.push(`${k}=$${i++}`);
      vals.push(k === "email" ? b[k].toLowerCase().trim() : b[k]);
    }
  }
  if ("phone" in b) {
    fields.push(`phone=$${i++}`);
    vals.push(normalizePhone(b.phone));
  }
  if (!fields.length) return sendJson(res, 400, { error: "수정할 필드 없음" });
  vals.push(id);
  const { rows } = await db.query(
    `UPDATE cleaners SET ${fields.join(",")} WHERE id=$${i} RETURNING *`,
    vals
  );
  if (!rows.length) return sendJson(res, 404, { error: "청소자 없음" });
  return sendJson(res, 200, rows[0]);
}

async function deleteCleaner(res, id) {
  const { rows } = await db.query(
    `UPDATE cleaners SET active=false WHERE id=$1 RETURNING id`,
    [id]
  );
  if (!rows.length) return sendJson(res, 404, { error: "청소자 없음" });
  return sendJson(res, 200, { ok: true });
}

// ── property_cleaning_config ───────────────────────────────

async function listProperties(res) {
  const { rows } = await db.query(
    `SELECT * FROM property_cleaning_config ORDER BY name`
  );
  return sendJson(res, 200, rows);
}

async function upsertProperty(req, res) {
  const b = await readBody(req);
  const { property_id, name, checkout_hour, cleaning_duration_hours,
          google_calendar_id, google_calendar_booking_url } = b;
  if (!property_id || !name) {
    return sendJson(res, 400, { error: "property_id, name 필수" });
  }
  const { rows } = await db.query(
    `INSERT INTO property_cleaning_config
       (property_id, name, checkout_hour, cleaning_duration_hours,
        google_calendar_id, google_calendar_booking_url, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (property_id) DO UPDATE SET
       name=$2, checkout_hour=$3, cleaning_duration_hours=$4,
       google_calendar_id=$5, google_calendar_booking_url=$6, updated_at=NOW()
     RETURNING *`,
    [
      property_id, name,
      checkout_hour ?? 11,
      cleaning_duration_hours ?? 2.5,
      google_calendar_id ?? null,
      google_calendar_booking_url ?? null,
    ]
  );
  return sendJson(res, 200, rows[0]);
}

// ── cleaning_jobs ──────────────────────────────────────────

async function listJobs(req, res) {
  const status = req.query?.status ?? null;
  const limit  = Math.min(parseInt(req.query?.limit) || 50, 200);
  const vals = [];
  let where = "";
  if (status) { where = "WHERE j.status=$1"; vals.push(status); }
  const { rows } = await db.query(
    `SELECT j.*, p.name AS property_name, c.name AS cleaner_name
     FROM cleaning_jobs j
     LEFT JOIN property_cleaning_config p ON p.property_id = j.property_id
     LEFT JOIN cleaners c ON c.id = j.assigned_cleaner_id
     ${where}
     ORDER BY j.cleaning_start_at DESC
     LIMIT ${limit}`,
    vals
  );
  return sendJson(res, 200, rows);
}

async function getJob(res, id) {
  const { rows: [job] } = await db.query(
    `SELECT j.*, p.name AS property_name, c.name AS cleaner_name
     FROM cleaning_jobs j
     LEFT JOIN property_cleaning_config p ON p.property_id = j.property_id
     LEFT JOIN cleaners c ON c.id = j.assigned_cleaner_id
     WHERE j.id=$1`,
    [id]
  );
  if (!job) return sendJson(res, 404, { error: "일정 없음" });

  const { rows: notifs } = await db.query(
    `SELECT n.*, cl.name AS cleaner_name, cl.phone
     FROM cleaning_notifs n
     JOIN cleaners cl ON cl.id = n.cleaner_id
     WHERE n.job_id=$1 ORDER BY n.sent_at`,
    [id]
  );
  return sendJson(res, 200, { ...job, notifs });
}

// ── iCal → cleaning_jobs 동기화 ───────────────────────────
// POST /api/cleaning/jobs/sync
// Body: { property_id, checkouts: [{date:"YYYY-MM-DD", uid?:string}] }
// 이미 등록된 (property_id, checkout_at) UNIQUE 충돌은 DO NOTHING으로 멱등 처리.

async function syncJobs(req, res) {
  const b = await readBody(req);
  const { property_id, checkouts } = b;
  if (!property_id || !Array.isArray(checkouts) || !checkouts.length) {
    return sendJson(res, 400, { error: "property_id와 checkouts[] 필수" });
  }

  const cfg = await getPropertyConfig(db, property_id);
  if (!cfg) {
    return sendJson(res, 404, {
      error: `숙소 설정 없음: ${property_id}. 먼저 숙소 탭에서 청소 설정을 등록하세요.`,
    });
  }

  const now = Date.now();
  let created = 0;
  let skipped = 0;

  for (const { date, uid } of checkouts) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
    const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes(
      date, cfg.checkout_hour, cfg.cleaning_duration_hours
    );
    const diffDays = (cleaning_start_at.getTime() - now) / (1000 * 60 * 60 * 24);
    const source = diffDays <= 14 ? "SHORT_NOTICE" : "MONTHLY_BATCH";
    const checkoutAt = cleaning_start_at.toISOString();

    const { rowCount } = await db.query(
      `INSERT INTO cleaning_jobs
         (property_id, reservation_uid, checkout_at,
          cleaning_start_at, cleaning_end_at, source)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (property_id, checkout_at) DO NOTHING`,
      [
        property_id, uid ?? null, checkoutAt,
        checkoutAt, cleaning_end_at.toISOString(), source,
      ]
    );
    if (rowCount > 0) created++;
    else skipped++;
  }

  return sendJson(res, 200, { ok: true, created, skipped });
}

// ── 수동 dispatch ──────────────────────────────────────────

async function dispatchJob(res, jobId) {
  const { rows: [job] } = await db.query(
    `SELECT * FROM cleaning_jobs WHERE id=$1`,
    [jobId]
  );
  if (!job) return sendJson(res, 404, { error: "일정 없음" });
  if (job.status !== "PENDING") {
    return sendJson(res, 409, { error: `PENDING 상태가 아님 (현재: ${job.status})` });
  }
  await advanceJob(db, job);
  return sendJson(res, 200, { ok: true });
}

// ── 라우터 ─────────────────────────────────────────────────

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}

export default async function handler(req, res) {
  const slug = parseSlug(req);
  const [resource, id] = slug;

  try {
    // /api/cleaning/cleaners
    if (resource === "cleaners") {
      if (!id) {
        if (req.method === "GET")  return await listCleaners(res);
        if (req.method === "POST") return await createCleaner(req, res);
      } else {
        if (req.method === "PATCH")  return await updateCleaner(req, res, id);
        if (req.method === "DELETE") return await deleteCleaner(res, id);
      }
    }

    // /api/cleaning/properties
    if (resource === "properties") {
      if (req.method === "GET")  return await listProperties(res);
      if (req.method === "POST") return await upsertProperty(req, res);
    }

    // /api/cleaning/jobs
    if (resource === "jobs") {
      if (!id) {
        if (req.method === "GET")  return await listJobs(req, res);
        if (req.method === "POST") return await syncJobs(req, res);
      } else {
        if (req.method === "GET") return await getJob(res, id);
      }
    }

    // /api/cleaning/dispatch/:jobId
    if (resource === "dispatch" && id) {
      if (req.method === "POST") return await dispatchJob(res, id);
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(`[cleaning/${slug.join("/")}]`, err);
    return sendJson(res, 500, { error: err.message });
  }
}
