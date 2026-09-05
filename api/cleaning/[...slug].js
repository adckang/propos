/**
 * /api/cleaning/* — 청소 전체 API (관리 + 웹훅 + 단축링크)
 */

import { Pool } from "pg";
import { kv } from "@vercel/kv";
import {
  advanceJob,
  getPropertyConfig,
  calcCleaningTimes,
  sendCompletionSmsToRest,
  postSlack,
} from "./_dispatch.js";
import {
  getGoogleToken,
  getGmailToken,
  createBlockerEvent,
  deleteBlockerEvent,
  getNextMonthDates,
  parseAllFutureCheckouts,
} from "./_calendar.js";

const db = new Pool({ connectionString: process.env.POSTGRES_URL });

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GMAIL_API    = "https://gmail.googleapis.com/gmail/v1";
const BASE_URL     =
  process.env.PROPOS_BASE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : null) ||
  "https://www.proposonline.com";

function parseSlug(req) {
  const raw = req.query?.slug;
  if (raw) return Array.isArray(raw) ? raw : [raw];
  // URL 파싱 폴백 (Vercel 런타임에서 query slug 미주입 시)
  const path = (req.url || "").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const idx = parts.indexOf("cleaning");
  return idx >= 0 ? parts.slice(idx + 1) : [];
}
function sendJson(res, status, body) { res.status(status).json(body); }
function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "").replace(/^82/, "0");
  const m = digits.match(/^(\d{3})(\d{4})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}
function htmlPage(title, body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}.box{background:#fff;border-radius:12px;padding:40px 32px;max-width:360px;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,.1)}h2{margin:0 0 12px;font-size:1.2rem;color:#111}p{margin:0;color:#555;font-size:.95rem;line-height:1.6}</style></head><body><div class="box"><h2>${title}</h2><p>${body}</p></div></body></html>`;
}

async function listCleaners(res) {
  const { rows } = await db.query(
    `SELECT * FROM cleaners ORDER BY CASE tier WHEN 'VIP_1' THEN 1 WHEN 'VIP_2' THEN 2 WHEN 'VIP_3' THEN 3 ELSE 4 END, name`
  );
  return sendJson(res, 200, rows);
}

async function createCleaner(req, res) {
  const b = await readBody(req);
  const { name, phone, email, tier, notes } = b;
  if (!name || !phone || !email || !tier) return sendJson(res, 400, { error: "name, phone, email, tier 필수" });
  const validTiers = ["VIP_1", "VIP_2", "VIP_3", "BULK"];
  if (!validTiers.includes(tier)) return sendJson(res, 400, { error: `tier는 ${validTiers.join("/")} 중 하나` });
  const normPhone = normalizePhone(phone);
  const normEmail = email.toLowerCase().trim();
  try {
    const { rows } = await db.query(
      `INSERT INTO cleaners (name, phone, email, tier, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, normPhone, normEmail, tier, notes ?? null]
    );
    return sendJson(res, 201, rows[0]);
  } catch (e) {
    if (e.code !== "23505") throw e;
    // 비활성 레코드와 충돌 → 재활성화 후 반환
    const { rows: existing } = await db.query(
      `SELECT id, active FROM cleaners WHERE phone=$1 OR email=$2 LIMIT 1`,
      [normPhone, normEmail]
    );
    if (existing.length && !existing[0].active) {
      const { rows: reactivated } = await db.query(
        `UPDATE cleaners SET name=$1,phone=$2,email=$3,tier=$4,notes=$5,active=true WHERE id=$6 RETURNING *`,
        [name, normPhone, normEmail, tier, notes ?? null, existing[0].id]
      );
      return sendJson(res, 200, reactivated[0]);
    }
    return sendJson(res, 409, { error: "전화번호 또는 이메일이 이미 활성 청소자와 중복됩니다" });
  }
}

async function updateCleaner(req, res, id) {
  const b = await readBody(req);
  const fields = [], vals = [];
  let i = 1;
  for (const k of ["name", "email", "tier", "notes", "active"]) {
    if (k in b) { fields.push(`${k}=$${i++}`); vals.push(k === "email" ? b[k].toLowerCase().trim() : b[k]); }
  }
  if ("phone" in b) { fields.push(`phone=$${i++}`); vals.push(normalizePhone(b.phone)); }
  if (!fields.length) return sendJson(res, 400, { error: "수정할 필드 없음" });
  vals.push(id);
  const { rows } = await db.query(`UPDATE cleaners SET ${fields.join(",")} WHERE id=$${i} RETURNING *`, vals);
  if (!rows.length) return sendJson(res, 404, { error: "청소자 없음" });
  return sendJson(res, 200, rows[0]);
}

async function deleteCleaner(res, id) {
  const { rows } = await db.query(`UPDATE cleaners SET active=false WHERE id=$1 RETURNING id`, [id]);
  if (!rows.length) return sendJson(res, 404, { error: "청소자 없음" });
  return sendJson(res, 200, { ok: true });
}

async function listProperties(res) {
  const { rows } = await db.query(`SELECT * FROM property_cleaning_config ORDER BY name`);
  return sendJson(res, 200, rows);
}

async function upsertProperty(req, res) {
  const b = await readBody(req);
  const { property_id, name, checkout_hour, cleaning_duration_hours, google_calendar_id, google_calendar_booking_url, host_phone, ical_url } = b;
  if (!property_id || !name) return sendJson(res, 400, { error: "property_id, name 필수" });
  const { rows } = await db.query(
    `INSERT INTO property_cleaning_config (property_id,name,checkout_hour,cleaning_duration_hours,google_calendar_id,google_calendar_booking_url,host_phone,ical_url,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (property_id) DO UPDATE SET
       name=COALESCE($2,property_cleaning_config.name),
       checkout_hour=COALESCE($3,property_cleaning_config.checkout_hour),
       cleaning_duration_hours=COALESCE($4,property_cleaning_config.cleaning_duration_hours),
       google_calendar_id=COALESCE($5,property_cleaning_config.google_calendar_id),
       google_calendar_booking_url=COALESCE($6,property_cleaning_config.google_calendar_booking_url),
       host_phone=COALESCE($7,property_cleaning_config.host_phone),
       ical_url=COALESCE($8,property_cleaning_config.ical_url),
       updated_at=NOW()
     RETURNING *`,
    [property_id, name ?? null, checkout_hour ?? null, cleaning_duration_hours ?? null, google_calendar_id ?? null, google_calendar_booking_url ?? null, host_phone ?? null, ical_url ?? null]
  );
  return sendJson(res, 200, rows[0]);
}

async function runFollowupChecks() {
  // VIP 1시간 창 만료 → 다음 단계로
  const { rows: vipJobs } = await db.query(
    `SELECT j.* FROM cleaning_jobs j
     JOIN LATERAL (
       SELECT sent_at FROM cleaning_notifs WHERE job_id=j.id ORDER BY sent_at DESC LIMIT 1
     ) n ON true
     WHERE j.status IN ('NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3')
       AND n.sent_at < NOW() - INTERVAL '1 hour'`
  );
  for (const job of vipJobs) {
    await advanceJob(db, job).catch(e => console.error("[followup] VIP advance 실패:", e.message));
  }

  // BULK 3시간 경과 → ESCALATED + Slack
  const { rows: bulkJobs } = await db.query(
    `SELECT j.id, j.property_id, j.cleaning_start_at FROM cleaning_jobs j
     JOIN LATERAL (
       SELECT MIN(sent_at) AS first_sent FROM cleaning_notifs WHERE job_id=j.id
     ) n ON true
     WHERE j.status IN ('NOTIFYING_BULK','BULK_REMINDED')
       AND n.first_sent < NOW() - INTERVAL '3 hours'`
  );
  for (const job of bulkJobs) {
    const { rows } = await db.query(
      `UPDATE cleaning_jobs SET status='ESCALATED', updated_at=NOW()
       WHERE id=$1 AND status IN ('NOTIFYING_BULK','BULK_REMINDED') RETURNING id`,
      [job.id]
    );
    if (!rows.length) continue;
    const cfg = await getPropertyConfig(db, job.property_id).catch(() => null);
    const date = new Date(job.cleaning_start_at).toISOString().slice(0, 10);
    await postSlack(
      `[PROPOS] 🚨 ${cfg?.name ?? job.property_id} ${date} 청소 배정 실패. 수동 처리 필요.`
    ).catch(() => {});
  }
}

async function listJobs(req, res) {
  // jobs 조회 시 타임아웃 체크 편승 실행 (외부 크론 불필요)
  runFollowupChecks().catch(e => console.error("[listJobs] followup:", e.message));

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
     ${where} ORDER BY j.cleaning_start_at DESC LIMIT ${limit}`,
    vals
  );
  return sendJson(res, 200, rows);
}

async function getJob(res, id) {
  const { rows: [job] } = await db.query(
    `SELECT j.*, p.name AS property_name, c.name AS cleaner_name
     FROM cleaning_jobs j
     LEFT JOIN property_cleaning_config p ON p.property_id = j.property_id
     LEFT JOIN cleaners c ON c.id = j.assigned_cleaner_id WHERE j.id=$1`,
    [id]
  );
  if (!job) return sendJson(res, 404, { error: "일정 없음" });
  const { rows: notifs } = await db.query(
    `SELECT n.*, cl.name AS cleaner_name, cl.phone FROM cleaning_notifs n
     JOIN cleaners cl ON cl.id = n.cleaner_id WHERE n.job_id=$1 ORDER BY n.sent_at`,
    [id]
  );
  return sendJson(res, 200, { ...job, notifs });
}

async function syncJobs(req, res) {
  const b = await readBody(req);
  const { property_id, checkouts } = b;
  if (!property_id || !Array.isArray(checkouts) || !checkouts.length)
    return sendJson(res, 400, { error: "property_id와 checkouts[] 필수" });
  const cfg = await getPropertyConfig(db, property_id);
  if (!cfg) return sendJson(res, 404, { error: `숙소 설정 없음: ${property_id}` });
  const now = Date.now();
  let created = 0, skipped = 0;
  for (const { date, uid } of checkouts) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
    const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes(date, cfg.checkout_hour, cfg.cleaning_duration_hours);
    const diffDays = (cleaning_start_at.getTime() - now) / (1000 * 60 * 60 * 24);
    const source = diffDays <= 14 ? "SHORT_NOTICE" : "MONTHLY_BATCH";
    const checkoutAt = cleaning_start_at.toISOString();
    const { rowCount } = await db.query(
      `INSERT INTO cleaning_jobs (property_id,reservation_uid,checkout_at,cleaning_start_at,cleaning_end_at,source)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (property_id,checkout_at) DO NOTHING`,
      [property_id, uid ?? null, checkoutAt, checkoutAt, cleaning_end_at.toISOString(), source]
    );
    if (rowCount > 0) {
      created++;
      // 해당 날짜 블로커 삭제 (예약 확정 → 슬롯 오픈)
      const { rows: blocker } = await db.query(
        `DELETE FROM property_calendar_blockers WHERE property_id=$1 AND block_date=$2 RETURNING event_id`,
        [property_id, date]
      );
      if (blocker.length && cfg.google_calendar_id) {
        try {
          const gTok = await getGoogleToken();
          await deleteBlockerEvent(cfg.google_calendar_id, blocker[0].event_id, gTok);
        } catch (e) {
          console.error(`[syncJobs] 블로커 삭제 실패 (${property_id}/${date}):`, e.message);
        }
      }
    } else {
      skipped++;
    }
  }
  return sendJson(res, 200, { ok: true, created, skipped });
}

async function dispatchJob(res, jobId) {
  const { rows: [job] } = await db.query(`SELECT * FROM cleaning_jobs WHERE id=$1`, [jobId]);
  if (!job) return sendJson(res, 404, { error: "일정 없음" });
  if (job.status !== "PENDING") return sendJson(res, 409, { error: `PENDING 상태가 아님 (현재: ${job.status})` });
  await advanceJob(db, job, { deleteBlocker: makeBlockerDeleter() });
  return sendJson(res, 200, { ok: true });
}

function makeBlockerDeleter() {
  return async (job) => {
    const date = new Date(job.checkout_at).toISOString().slice(0, 10);
    const { rows: [cfg] } = await db.query(
      `SELECT google_calendar_id FROM property_cleaning_config WHERE property_id=$1`,
      [job.property_id]
    );
    const { rows: blocker } = await db.query(
      `DELETE FROM property_calendar_blockers WHERE property_id=$1 AND block_date=$2 RETURNING event_id`,
      [job.property_id, date]
    );
    if (blocker.length && cfg?.google_calendar_id) {
      const gTok = await getGoogleToken();
      await deleteBlockerEvent(cfg.google_calendar_id, blocker[0].event_id, gTok);
    }
  };
}

async function handleConfirmRedirect(req, res, propertyId) {
  if (req.method !== "GET") return res.status(405).end();
  const { rows: [cfg] } = await db.query(
    `SELECT google_calendar_booking_url FROM property_cleaning_config WHERE property_id=$1`, [propertyId]
  );
  if (!cfg?.google_calendar_booking_url) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(404).send(htmlPage("링크 오류", "해당 숙소의 예약 캘린더가 설정되지 않았습니다."));
  }
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, cfg.google_calendar_booking_url);
}

async function handleDecline(req, res, token) {
  if (req.method !== "GET") return res.status(405).end();
  const isApi = req.query?.format === "api";
  const respond = (status, title, message) => {
    if (isApi) return res.status(status).json({ ok: status < 400, message });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(status).send(htmlPage(title, message));
  };

  const t = (token ?? "").toUpperCase();
  if (!t || !/^[A-Z0-9]{6}$/.test(t)) return respond(404, "링크 오류", "유효하지 않은 링크입니다.");
  const { rows: [notif] } = await db.query(
    `SELECT n.id, n.job_id, n.cleaner_id, n.token, n.response,
            j.status AS job_status, j.property_id, j.cleaning_start_at
     FROM cleaning_notifs n JOIN cleaning_jobs j ON j.id=n.job_id WHERE n.token=$1`,
    [t]
  );
  if (!notif) return respond(404, "링크 오류", "링크를 찾을 수 없습니다.");
  if (notif.response) return respond(200, "이미 처리됨", "이미 처리된 링크입니다.");
  if (notif.job_status === "CANCELLED")
    return respond(200, "취소된 일정", "해당 청소 일정은 이미 취소됐습니다. 감사합니다.");
  if (["ASSIGNED", "COMPLETED"].includes(notif.job_status)) {
    await db.query(`UPDATE cleaning_notifs SET response='DECLINED_AFTER_ASSIGNED',response_at=NOW() WHERE token=$1`, [t]);
    return respond(200, "배정 완료", "이미 배정 완료된 건입니다. 감사합니다.");
  }
  await db.query(`UPDATE cleaning_notifs SET response='DECLINED',response_at=NOW() WHERE token=$1`, [t]);
  if (["NOTIFYING_VIP_1","NOTIFYING_VIP_2","NOTIFYING_VIP_3"].includes(notif.job_status)) {
    const { rows: [job] } = await db.query(`SELECT * FROM cleaning_jobs WHERE id=$1`, [notif.job_id]);
    if (job) await advanceJob(db, job);
  } else if (["NOTIFYING_BULK","BULK_REMINDED"].includes(notif.job_status)) {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS total, COUNT(CASE WHEN response='DECLINED' THEN 1 END) AS declined FROM cleaning_notifs WHERE job_id=$1`,
      [notif.job_id]
    );
    const { total, declined } = rows[0];
    if (parseInt(total) === parseInt(declined)) {
      await db.query(`UPDATE cleaning_jobs SET status='ESCALATED',updated_at=NOW() WHERE id=$1`, [notif.job_id]);
      const date = new Date(notif.cleaning_start_at).toISOString().slice(0, 10);
      await postSlack(`[PROPOS] 🚨 ${notif.property_id} ${date} 청소 배정 실패 (전원 거절). 수동 처리 필요.`);
    }
  }
  return respond(200, "거절 처리 완료", "거절 처리됐습니다. 감사합니다.");
}

async function handleCalendarWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const webhookSecret = process.env.GOOGLE_WEBHOOK_SECRET;
  if (webhookSecret && req.headers["x-goog-channel-token"] !== webhookSecret) return res.status(200).end();
  if (req.headers["x-goog-resource-state"] === "sync") return res.status(200).end();
  const resourceUri = req.headers["x-goog-resource-uri"] ?? "";
  const uriMatch = resourceUri.match(/\/calendars\/([^/?]+)\//);
  const calendarId = uriMatch ? decodeURIComponent(uriMatch[1]) : "";
  if (!calendarId) return res.status(400).json({ error: "calendarId 없음" });
  let token;
  try { token = await getGoogleToken(); }
  catch (e) { console.error("[calendar-webhook] OAuth:", e.message); return res.status(500).end(); }
  const { rows: [propCfg] } = await db.query(
    `SELECT * FROM property_cleaning_config WHERE google_calendar_id=$1`, [calendarId]
  );
  if (!propCfg) return res.status(200).end();
  // updatedMin: 최근 30분 이내에 생성/수정된 이벤트만 — 신규 예약 감지용
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const timeMin = new Date().toISOString(); // 과거 완료 건 제외
  const evtRes = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?updatedMin=${since}&timeMin=${timeMin}&singleEvents=true&orderBy=updated&showDeleted=false&maxResults=10`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const events = (await evtRes.json()).items ?? [];
  for (const evt of events) {
    // propos=blocker 속성이 있으면 PROPOS 블로커 이벤트 → 건너뜀
    if (evt.extendedProperties?.private?.propos === "blocker") continue;
    const attendeeEmail = evt.attendees?.[0]?.email?.toLowerCase();
    if (!attendeeEmail) continue;
    // 예약 이벤트의 날짜로 해당 날짜 cleaning_job만 매칭
    const eventDate = (evt.start?.dateTime ?? evt.start?.date ?? "").slice(0, 10);
    if (!eventDate) continue;
    const { rows: [cleaner] } = await db.query(`SELECT * FROM cleaners WHERE email=$1`, [attendeeEmail]);
    const { rows: [job] } = await db.query(
      `SELECT * FROM cleaning_jobs WHERE property_id=$1
       AND to_char(checkout_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $2
       AND status IN ('PENDING','NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3','NOTIFYING_BULK','BULK_REMINDED','ESCALATED')
       LIMIT 1`,
      [propCfg.property_id, eventDate]
    );
    if (!job) continue;
    const { rows: updated } = await db.query(
      `UPDATE cleaning_jobs SET status='ASSIGNED',assigned_cleaner_id=$1,google_event_id=$2,updated_at=NOW()
       WHERE id=$3 AND status!='ASSIGNED' RETURNING id`,
      [cleaner?.id ?? null, evt.id, job.id]
    );
    if (!updated.length) continue;
    const date = new Date(job.cleaning_start_at).toISOString().slice(0, 10);
    if (cleaner) await sendCompletionSmsToRest(db, job.id, cleaner.id).catch(() => {});
    await postSlack(`[PROPOS] ✅ ${propCfg.name} ${date} 청소 배정 완료 (${cleaner?.name ?? attendeeEmail})`);
    if (!cleaner) await postSlack(`[PROPOS] ⚠️ 미등록 이메일: ${attendeeEmail} — 수동 확인 필요`);
  }
  return res.status(200).end();
}

const RESERVATION_SUBJECTS = ["reservation confirmed", "예약 확정", "booking confirmed"];

async function handleGmailWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const webhookSecret = process.env.GOOGLE_WEBHOOK_SECRET;
  if (webhookSecret) {
    const qs = new URL(req.url, "http://localhost").searchParams;
    if (qs.get("secret") !== webhookSecret) return res.status(200).end();
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return res.status(400).end(); }
  const b64 = body?.message?.data;
  if (!b64) return res.status(200).end();
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8")); }
  catch { return res.status(200).end(); }
  const { historyId } = payload;
  if (!historyId) return res.status(200).end();
  try {
    const token = await getGmailToken();
    const histRes = await fetch(
      `${GMAIL_API}/users/me/history?startHistoryId=${historyId}&historyTypes=messageAdded`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    for (const h of (await histRes.json()).history ?? []) {
      for (const added of (h.messagesAdded ?? [])) {
        const msgRes = await fetch(
          `${GMAIL_API}/users/me/messages/${added.message.id}?format=metadata&metadataHeaders=Subject`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const msg = await msgRes.json();
        const subject = (msg.payload?.headers ?? []).find((hdr) => hdr.name === "Subject")?.value ?? "";
        if (RESERVATION_SUBJECTS.some((s) => subject.toLowerCase().includes(s))) {
          await postSlack("[PROPOS] 📬 에어비앤비 신규 예약 이메일 감지. iCal 재폴링 트리거.");
          await syncAllPropertiesIcal(db).catch((e) =>
            console.error("[gmail-webhook] iCal 재폴링 실패:", e.message)
          );
          return res.status(200).end();
        }
      }
    }
  } catch (e) { console.error("[gmail-webhook]", e.message); }
  return res.status(200).end();
}

// ── 공통: 전체 숙소 iCal 재폴링 + 신규 예약 처리 ──────────────

async function syncAllPropertiesIcal(db, filterPropertyId = null) {
  const { rows: properties } = await db.query(
    filterPropertyId
      ? `SELECT * FROM property_cleaning_config WHERE ical_url IS NOT NULL AND property_id=$1`
      : `SELECT * FROM property_cleaning_config WHERE ical_url IS NOT NULL`,
    filterPropertyId ? [filterPropertyId] : []
  );
  if (!properties.length) return;

  const now = Date.now();
  let gToken = null;
  try { gToken = await getGoogleToken(); } catch { /* OAuth 실패 → 블로커 삭제 스킵 */ }

  for (const prop of properties) {
    let icalText;
    try {
      const r = await fetch(prop.ical_url);
      if (!r.ok) throw new Error(`iCal HTTP ${r.status}`);
      icalText = await r.text();
    } catch (e) {
      console.error(`[syncAllIcal] iCal 폴링 실패 (${prop.property_id}):`, e.message);
      continue;
    }

    const checkouts = parseAllFutureCheckouts(icalText, now);

    for (const { date, uid } of checkouts) {
      const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes(
        date, prop.checkout_hour, prop.cleaning_duration_hours
      );
      const diffDays = (cleaning_start_at.getTime() - now) / 86_400_000;
      const source = diffDays <= 14 ? "SHORT_NOTICE" : "MONTHLY_BATCH";

      // MONTHLY_BATCH: dispatch_after = cleaning_start_at - 14 days (2주 전 발동)
      // SHORT_NOTICE: dispatch_after = NOW() (default) → 즉시 advanceJob
      const dispatchAfter = source === "MONTHLY_BATCH"
        ? new Date(cleaning_start_at.getTime() - 14 * 86_400_000).toISOString()
        : new Date(now).toISOString();

      const { rowCount } = await db.query(
        `INSERT INTO cleaning_jobs
           (property_id,reservation_uid,checkout_at,cleaning_start_at,cleaning_end_at,source,dispatch_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (property_id,checkout_at) DO NOTHING`,
        [prop.property_id, uid ?? null, cleaning_start_at.toISOString(),
         cleaning_start_at.toISOString(), cleaning_end_at.toISOString(), source, dispatchAfter]
      );

      // 체크아웃 날짜 = 항상 블로커 삭제 (job 신규 여부·source 무관)
      const { rows: blocker } = await db.query(
        `DELETE FROM property_calendar_blockers WHERE property_id=$1 AND block_date=$2 RETURNING event_id`,
        [prop.property_id, date]
      );
      if (blocker.length && gToken && prop.google_calendar_id) {
        await deleteBlockerEvent(prop.google_calendar_id, blocker[0].event_id, gToken).catch(
          (e) => console.error(`[syncAllIcal] 블로커 삭제 실패 (${prop.property_id}/${date}):`, e.message)
        );
      }

      if (rowCount > 0 && source === "SHORT_NOTICE") {
        // 즉시 발동 (followup 크론 대기 없이)
        const { rows: [newJob] } = await db.query(
          `SELECT * FROM cleaning_jobs WHERE property_id=$1 AND checkout_at=$2`,
          [prop.property_id, cleaning_start_at.toISOString()]
        );
        if (newJob) {
          await advanceJob(db, newJob).catch(
            (e) => console.error(`[syncAllIcal] advanceJob 실패 (${prop.property_id}/${date}):`, e.message)
          );
        }
        await postSlack(
          `[PROPOS] 🚀 SHORT_NOTICE 신규 예약: ${prop.name ?? prop.property_id} ${date} → 즉시 알림 발송`
        );
      }
    }
  }
}

// ── iCal 수동 동기화 트리거 ───────────────────────────────────────

async function handleIcalSync(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const b = await readBody(req);
  const { property_id } = b;

  if (property_id) {
    const { rows: [prop] } = await db.query(
      `SELECT * FROM property_cleaning_config WHERE property_id=$1`, [property_id]
    );
    if (!prop) return sendJson(res, 404, { error: "숙소 없음" });
    if (!prop.ical_url) return sendJson(res, 400, { error: "ical_url 미설정 — 설정 저장 후 다시 시도하세요" });
  }

  // syncAllPropertiesIcal이 ical_url IS NOT NULL인 숙소만 처리
  let created = 0;
  const origQuery = db.query.bind(db);
  const countingDb = {
    ...db,
    query: async (sql, params) => {
      const result = await origQuery(sql, params);
      if (sql.includes("INSERT INTO cleaning_jobs") && result.rowCount > 0) created += result.rowCount;
      return result;
    },
  };

  await syncAllPropertiesIcal(countingDb, property_id ?? null);
  return sendJson(res, 200, { ok: true, property_id: property_id ?? "all", created });
}

// ── 부트스트랩: 현재 달(또는 지정 월) 블로커 일괄 생성 ────────────

async function bootstrapBlockers(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const b = await readBody(req);
  const { property_id, month, force } = b; // month: "YYYY-MM" (없으면 현재 달)

  const query = property_id
    ? `SELECT * FROM property_cleaning_config WHERE property_id=$1 AND google_calendar_id IS NOT NULL`
    : `SELECT * FROM property_cleaning_config WHERE google_calendar_id IS NOT NULL`;
  const { rows: properties } = await db.query(query, property_id ? [property_id] : []);
  if (!properties.length)
    return sendJson(res, 404, { error: "숙소 없음 또는 google_calendar_id 미설정" });

  let targetDates;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    targetDates = Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`);
  } else {
    const kst = new Date(Date.now() + 9 * 3_600_000);
    const y = kst.getUTCFullYear();
    const m = kst.getUTCMonth() + 1;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    targetDates = Array.from({ length: days }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`);
  }

  let gToken;
  try { gToken = await getGoogleToken(); }
  catch (e) { return sendJson(res, 500, { error: `Google OAuth 실패: ${e.message}` }); }

  // force: Google Calendar 이벤트 삭제 → DB 레코드 삭제 → 재생성
  if (force && property_id) {
    const monthPrefix = targetDates[0].slice(0, 7);
    const { rows: oldBlockers } = await db.query(
      `SELECT event_id, property_id FROM property_calendar_blockers
       WHERE property_id=$1 AND block_date::text LIKE $2 AND event_id IS NOT NULL`,
      [property_id, `${monthPrefix}%`]
    );
    for (const prop of properties) {
      for (const b of oldBlockers) {
        await deleteBlockerEvent(prop.google_calendar_id, b.event_id, gToken).catch(() => {});
      }
    }
    await db.query(
      `DELETE FROM property_calendar_blockers WHERE property_id=$1 AND block_date::text LIKE $2`,
      [property_id, `${monthPrefix}%`]
    );
  }

  let created = 0, skipped = 0;
  const errors = [];
  for (const prop of properties) {
    for (const date of targetDates) {
      const { rows: existing } = await db.query(
        `SELECT 1 FROM property_calendar_blockers WHERE property_id=$1 AND block_date=$2`,
        [prop.property_id, date]
      );
      if (existing.length) { skipped++; continue; }
      try {
        const eventId = await createBlockerEvent(
          prop.google_calendar_id, date,
          prop.checkout_hour, prop.cleaning_duration_hours,
          prop.property_id, gToken
        );
        await db.query(
          `INSERT INTO property_calendar_blockers (property_id, block_date, event_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [prop.property_id, date, eventId]
        );
        created++;
      } catch (e) {
        console.error(`[bootstrap] 블로커 생성 실패 (${prop.property_id}/${date}):`, e.message);
        if (!errors.length) errors.push(e.message); // 첫 번째 에러만 응답에 포함
        skipped++;
      }
    }
  }
  return sendJson(res, 200, { ok: !errors.length, created, skipped, ...(errors.length ? { firstError: errors[0] } : {}) });
}

// ── 예약 취소: 상태 CANCELLED + 블로커 재생성 ────────────────────

async function cancelJob(req, res, jobId) {
  if (req.method !== "PATCH") return res.status(405).end();
  const { rows: [job] } = await db.query(
    `SELECT j.*, p.google_calendar_id, p.checkout_hour, p.cleaning_duration_hours
     FROM cleaning_jobs j
     LEFT JOIN property_cleaning_config p ON p.property_id = j.property_id
     WHERE j.id=$1`,
    [jobId]
  );
  if (!job) return sendJson(res, 404, { error: "일정 없음" });
  if (["COMPLETED", "CANCELLED"].includes(job.status))
    return sendJson(res, 409, { error: `이미 ${job.status} 상태` });

  const { rows: updated } = await db.query(
    `UPDATE cleaning_jobs SET status='CANCELLED', updated_at=NOW() WHERE id=$1 RETURNING id`,
    [jobId]
  );
  if (!updated.length) return sendJson(res, 409, { error: "업데이트 실패" });

  // 블로커 재생성 → 슬롯 다시 잠금
  let newBlockerEventId = null;
  if (job.google_calendar_id) {
    try {
      const gTok = await getGoogleToken();
      const date = new Date(job.cleaning_start_at).toISOString().slice(0, 10);
      const eventId = await createBlockerEvent(
        job.google_calendar_id, date,
        job.checkout_hour, job.cleaning_duration_hours,
        job.property_id, gTok
      );
      await db.query(
        `INSERT INTO property_calendar_blockers (property_id, block_date, event_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (property_id, block_date) DO UPDATE SET event_id=$3, created_at=NOW()`,
        [job.property_id, date, eventId]
      );
      await db.query(
        `UPDATE cleaning_jobs SET google_blocker_event_id=$1 WHERE id=$2`,
        [eventId, jobId]
      );
      newBlockerEventId = eventId;
    } catch (e) {
      console.error(`[cancelJob] 블로커 재생성 실패 (${jobId}):`, e.message);
    }
  }
  return sendJson(res, 200, { ok: true, newBlockerEventId });
}

// ── Calendar Watch 등록 ─────────────────────────────────────

async function registerCalendarWatch(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const body = await readBody(req);
  const calendarId = body.calendar_id;
  if (!calendarId) return sendJson(res, 400, { error: "calendar_id 필수" });
  let token;
  try { token = await getGoogleToken(); }
  catch (e) { return sendJson(res, 500, { error: `Google OAuth 실패: ${e.message}` }); }
  const webhookUrl = `${BASE_URL}/api/cleaning/calendar-webhook`;
  const channelId = `propos-cal-${calendarId.replace(/[^a-z0-9]/gi, "-")}-${Date.now()}`;
  const secret = process.env.GOOGLE_WEBHOOK_SECRET ?? "";
  const r = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        token: secret,
        params: { ttl: "604800" }, // 7일
      }),
    }
  );
  const result = await r.json();
  if (!r.ok) return sendJson(res, 502, { error: "Calendar Watch 등록 실패", detail: result });
  return sendJson(res, 200, { ok: true, channelId: result.id, expiration: result.expiration, webhookUrl });
}

// ── 고아 블로커 이벤트 정리 ──────────────────────────────────────
// DB에 없는 Google Calendar 블로커 이벤트(propos=blocker) 삭제.
// force bootstrap 이전에 생성된 이벤트가 남아있을 때 사용.

async function handleBlockerCleanup(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { calendar_id, month } = await readBody(req);
  if (!calendar_id) return sendJson(res, 400, { error: "calendar_id 필수" });
  let gToken;
  try { gToken = await getGoogleToken(); }
  catch (e) { return sendJson(res, 500, { error: `Google OAuth 실패: ${e.message}` }); }

  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
  const timeMin = ym ? `${ym}-01T00:00:00+09:00` : null;
  const [y, m] = ym ? ym.split("-").map(Number) : [null, null];
  const lastDay = ym ? new Date(Date.UTC(y, m, 0)).getUTCDate() : null;
  const timeMax = ym ? `${ym}-${String(lastDay).padStart(2, "0")}T23:59:59+09:00` : null;

  const params = new URLSearchParams({
    privateExtendedProperty: "propos=blocker",
    maxResults: "250",
    singleEvents: "true",
    ...(timeMin && { timeMin, timeMax }),
  });

  const r = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendar_id)}/events?${params}`,
    { headers: { Authorization: `Bearer ${gToken}` } }
  );
  if (!r.ok) return sendJson(res, 502, { error: "이벤트 목록 조회 실패", detail: await r.text() });
  const { items = [] } = await r.json();

  // DB에 있는 event_id 목록 조회
  const { rows: dbBlockers } = await db.query(
    `SELECT event_id FROM property_calendar_blockers WHERE event_id IS NOT NULL`
  );
  const dbIds = new Set(dbBlockers.map((b) => b.event_id));

  // DB에 없는 것 = 고아 이벤트 → 삭제
  const orphans = items.filter((ev) => !dbIds.has(ev.id));
  let deleted = 0;
  for (const ev of orphans) {
    await deleteBlockerEvent(calendar_id, ev.id, gToken).catch(() => {});
    deleted++;
  }
  return sendJson(res, 200, { ok: true, scanned: items.length, deleted, dbTracked: items.length - orphans.length });
}

// ── 캘린더 수동 스캔 (웹훅 미수신 시 복구용) ──────────────────────────
// GET: 이벤트 목록만 반환 (디버그). POST: 매칭해서 ASSIGNED 업데이트.

async function handleCalendarScan(req, res) {
  const { calendar_id, date, hours = 72 } = req.method === "POST"
    ? await readBody(req) : req.query ?? {};
  if (!calendar_id) return sendJson(res, 400, { error: "calendar_id 필수" });
  let gToken;
  try { gToken = await getGoogleToken(); }
  catch (e) { return sendJson(res, 500, { error: `Google OAuth 실패: ${e.message}` }); }

  // date 지정 시 해당 날짜 범위로 조회 (maxResults 제한 우회)
  const params = date
    ? new URLSearchParams({
        timeMin: `${date}T00:00:00+09:00`,
        timeMax: `${date}T23:59:59+09:00`,
        singleEvents: "true", showDeleted: "false", maxResults: "50",
      })
    : new URLSearchParams({
        updatedMin: new Date(Date.now() - Number(hours) * 3_600_000).toISOString(),
        singleEvents: "true", orderBy: "updated", showDeleted: "false", maxResults: "50",
      });
  const r = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendar_id)}/events?${params}`,
    { headers: { Authorization: `Bearer ${gToken}` } }
  );
  if (!r.ok) return sendJson(res, 502, { error: "캘린더 조회 실패", detail: await r.text() });
  const { items = [] } = await r.json();

  const filtered = items.filter(
    (ev) => ev.extendedProperties?.private?.propos !== "blocker" && ev.attendees?.length
  );

  if (req.method !== "POST") {
    return sendJson(res, 200, { total: items.length, bookings: filtered.map((ev) => ({
      id: ev.id, summary: ev.summary,
      start: ev.start?.dateTime ?? ev.start?.date,
      attendees: ev.attendees?.map((a) => a.email),
      extPrivate: ev.extendedProperties?.private,
    })) });
  }

  // POST: ASSIGNED 업데이트
  const { rows: [propCfg] } = await db.query(
    `SELECT * FROM property_cleaning_config WHERE google_calendar_id=$1`, [calendar_id]
  );
  if (!propCfg) return sendJson(res, 404, { error: "숙소 미등록" });

  const results = [];
  for (const evt of filtered) {
    const attendeeEmail = evt.attendees[0].email.toLowerCase();
    const eventDate = (evt.start?.dateTime ?? evt.start?.date ?? "").slice(0, 10);
    if (date && eventDate !== date) continue;
    const { rows: [cleaner] } = await db.query(`SELECT * FROM cleaners WHERE email=$1`, [attendeeEmail]);
    const { rows: [job] } = await db.query(
      `SELECT * FROM cleaning_jobs WHERE property_id=$1
       AND to_char(checkout_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $2
       AND status IN ('PENDING','NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3','NOTIFYING_BULK','BULK_REMINDED','ESCALATED')
       LIMIT 1`,
      [propCfg.property_id, eventDate]
    );
    if (!job) { results.push({ eventDate, attendeeEmail, result: "job 없음" }); continue; }
    const { rows: updated } = await db.query(
      `UPDATE cleaning_jobs SET status='ASSIGNED',assigned_cleaner_id=$1,google_event_id=$2,updated_at=NOW()
       WHERE id=$3 AND status!='ASSIGNED' RETURNING id`,
      [cleaner?.id ?? null, evt.id, job.id]
    );
    if (updated.length) {
      results.push({ eventDate, attendeeEmail, cleaner: cleaner?.name ?? "미등록", result: "ASSIGNED" });
      if (!cleaner) await postSlack(`[PROPOS] ⚠️ 미등록 청소담당자: ${attendeeEmail}`);
      else await postSlack(`[PROPOS] ✅ ${propCfg.name} ${eventDate} 청소 배정 (${cleaner.name})`);
    } else {
      results.push({ eventDate, attendeeEmail, result: "이미 ASSIGNED" });
    }
  }
  return sendJson(res, 200, { ok: true, results });
}

// ── Gmail Watch 등록 ─────────────────────────────────────────

async function registerGmailWatch(req, res) {
  // GET: 저장된 만료일 반환
  if (req.method === "GET") {
    try {
      const exp = await kv.get("gmail_watch_expiration");
      if (!exp) return sendJson(res, 200, { ok: true, status: "unknown" });
      const expired = Date.now() > Number(exp);
      return sendJson(res, 200, { ok: true, status: expired ? "expired" : "active", expiration: exp });
    } catch (e) {
      return sendJson(res, 200, { ok: true, status: "unknown" });
    }
  }
  if (req.method !== "POST") return res.status(405).end();
  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topicName) return sendJson(res, 500, { error: "GOOGLE_PUBSUB_TOPIC 환경변수 없음" });
  let token;
  try { token = await getGmailToken(); }
  catch (e) { return sendJson(res, 500, { error: `Google OAuth 실패: ${e.message}` }); }
  const r = await fetch(`${GMAIL_API}/users/me/watch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" }),
  });
  const result = await r.json();
  if (!r.ok) return sendJson(res, 502, { error: "Gmail Watch 등록 실패", detail: result });
  // 만료일 KV에 저장 (7일 + 1시간 여유로 TTL 설정)
  if (result.expiration) {
    const ttlSec = Math.floor((Number(result.expiration) - Date.now()) / 1000) + 3600;
    await kv.set("gmail_watch_expiration", result.expiration, { ex: ttlSec }).catch(() => {});
  }
  return sendJson(res, 200, { ok: true, historyId: result.historyId, expiration: result.expiration });
}

export default async function handler(req, res) {
  const slug = parseSlug(req);
  const [resource] = slug;
  // id/token은 쿼리 파라미터 우선. 없으면 slug[1]이 UUID 형식일 때 폴백 (UI 경로 파라미터 호환)
  const slugId = slug.length > 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug[1])
    ? slug[1] : null;
  const id    = req.query?.id    ?? slugId ?? null;
  const token = req.query?.token ?? null;
  try {
    if (resource === "cleaners") {
      if (!id) {
        if (req.method === "GET")  return await listCleaners(res);
        if (req.method === "POST") return await createCleaner(req, res);
      } else {
        if (req.method === "PATCH")  return await updateCleaner(req, res, id);
        if (req.method === "DELETE") return await deleteCleaner(res, id);
      }
    }
    if (resource === "properties") {
      if (req.method === "GET")  return await listProperties(res);
      if (req.method === "POST") return await upsertProperty(req, res);
    }
    if (resource === "jobs") {
      if (!id) {
        if (req.method === "GET")  return await listJobs(req, res);
        if (req.method === "POST") return await syncJobs(req, res);
      } else {
        if (req.method === "GET") return await getJob(res, id);
      }
    }
    if (resource === "dispatch") {
      const jobId = id ?? (await readBody(req)).job_id;
      if (req.method === "POST" && jobId) return await dispatchJob(res, jobId);
    }
    if (resource === "jobs" && id && req.method === "PATCH") {
      const b = await readBody(req);
      if (b.status === "CANCELLED") return await cancelJob(req, res, id);
      if (b.status === "ASSIGNED") {
        const { rows } = await db.query(
          `UPDATE cleaning_jobs SET status='ASSIGNED', assigned_cleaner_id=$1, google_event_id=$2, updated_at=NOW()
           WHERE id=$3 AND status!='ASSIGNED' RETURNING id, status`,
          [b.assigned_cleaner_id ?? null, b.google_event_id ?? null, id]
        );
        if (!rows.length) return sendJson(res, 409, { error: "이미 ASSIGNED 상태" });
        return sendJson(res, 200, { ok: true, job: rows[0] });
      }
      if (b.status === "PENDING" && b._test_reset) {
        // 테스트 전용: 잡을 PENDING으로 초기화 + 발송 내역 삭제
        await db.query(`DELETE FROM cleaning_notifs WHERE job_id=$1`, [id]);
        const { rows } = await db.query(
          `UPDATE cleaning_jobs
           SET status='PENDING', assigned_cleaner_id=NULL,
               dispatch_after=NOW(), updated_at=NOW()
           WHERE id=$1 RETURNING id, status`,
          [id]
        );
        if (!rows.length) return sendJson(res, 404, { error: "잡 없음" });
        return sendJson(res, 200, { ok: true, job: rows[0] });
      }
    }
    if (resource === "bootstrap") return await bootstrapBlockers(req, res);
    if (resource === "ical-sync")    return await handleIcalSync(req, res);
    if (resource === "gmail-watch")      return await registerGmailWatch(req, res);
    if (resource === "calendar-watch")   return await registerCalendarWatch(req, res);
    if (resource === "blocker-cleanup")  return await handleBlockerCleanup(req, res);
    if (resource === "calendar-scan")    return await handleCalendarScan(req, res);
    if (resource === "c") {
      const propId = id ?? req.query?.property_id;
      if (propId) return await handleConfirmRedirect(req, res, propId);
    }
    if (resource === "d") {
      const tok = token ?? id;
      if (tok) return await handleDecline(req, res, tok);
    }
    if (resource === "calendar-webhook") return await handleCalendarWebhook(req, res);
    if (resource === "gmail-webhook")    return await handleGmailWebhook(req, res);
    return sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(`[cleaning/${slug.join("/")}]`, err);
    return sendJson(res, 500, { error: err.message });
  }
}
