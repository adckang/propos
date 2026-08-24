// GET /api/cron/daily-plan        — 오전 8시 KST 브리핑
// GET /api/cron/daily-result      — 저녁 10시 KST 결산
// GET /api/cron/monthly-cleaning  — 매월 15일 KST 09:00 청소 배치 (cron: 0 0 15 * *)
// GET /api/cron/cleaning-followup — 30분마다 리마인드·에스컬레이션 (cron: 30min)

import { Pool } from "pg";
import { kv } from "@vercel/kv";
import {
  advanceJob,
  buildSmsRemind,
  calcCleaningTimes,
  postSlack,
  getPropertyConfig,
} from "../cleaning/_dispatch.js";
import { notify } from "../cleaning/_notify.js";
import {
  getGoogleToken,
  createBlockerEvent,
  deleteBlockerEvent,
  getNextMonthDates,
  parseCheckoutsFromIcal,
} from "../cleaning/_calendar.js";
import { getStatsForPeriod } from "../../src/application/reportingService.js";
import { countPeriodEvents } from "../../src/domain/reportingDomain.js";
import { queryEvents } from "../../src/infrastructure/eventRepository.js";

const DASHBOARD_URL =
  process.env.PROPOS_BASE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : null) ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function kstDateString() {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  return {
    date: kst.toISOString().slice(0, 10),
    weekday: WEEKDAYS[kst.getUTCDay()],
  };
}

function getKSTTodayRangeUTC() {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  const from = new Date(Date.UTC(y, m, d)     - KST_OFFSET_MS);
  const to   = new Date(Date.UTC(y, m, d + 1) - KST_OFFSET_MS - 1);
  return { from, to };
}

async function handleDailyPlan(db, res) {
  const [nowResult, weekResult] = await Promise.all([
    getStatsForPeriod("now",       { db, kv }),
    getStatsForPeriod("this_week", { db, kv }),
  ]);

  const { date, weekday } = kstDateString();
  const s = nowResult.stats;
  const w = weekResult.stats;

  const anomalyAlert = s.anomalyCount > 0 ? ` ⚠ 이상 ${s.anomalyCount}건` : "";
  const weekAnomaly  = w.anomalies  > 0 ? ` · 이상감지 ${w.anomalies}건` : "";

  const text = [
    `🌅 *PROPOS 일일 브리핑 — ${date} (${weekday})*`,
    `입실 중 *${s.occupied}* | 입실 준비 *${s.preStayReady}* | 공실 *${s.vacant}* | 청소 중 *${s.cleaning}*${anomalyAlert}`,
    `이번 주 체크인 ${w.checkIns}건 · 체크아웃 ${w.checkOuts}건${weekAnomaly}`,
    `→ ${DASHBOARD_URL}`,
  ].join("\n");

  await postSlack(text);
  return res.status(200).json({ ok: true, date });
}

async function handleDailyResult(db, res) {
  const todayRange = getKSTTodayRangeUTC();
  const [todayEvents, nowResult] = await Promise.all([
    queryEvents(db, todayRange, null),
    getStatsForPeriod("now", { db, kv }),
  ]);

  const t = countPeriodEvents(todayEvents);
  const s = nowResult.stats;
  const { date, weekday } = kstDateString();

  const anomalyLine = t.anomalies > 0
    ? `⚠ 이상감지 *${t.anomalies}건* (에너지 낭비 ${t.energyWaste}건 포함)`
    : "이상 없음 ✓";
  const anomalyNow = s.anomalyCount > 0 ? ` · 미해결 이상 *${s.anomalyCount}건*` : "";

  const text = [
    `🌙 *PROPOS 일일 결산 — ${date} (${weekday})*`,
    `체크인 *${t.checkIns}건* · 체크아웃 *${t.checkOuts}건*`,
    anomalyLine,
    `현재: 입실 중 ${s.occupied} · 공실 ${s.vacant} · 청소 중 ${s.cleaning}${anomalyNow}`,
    `→ ${DASHBOARD_URL}`,
  ].join("\n");

  await postSlack(text);
  return res.status(200).json({ ok: true, date, stats: t });
}

// ── 월간 청소 배치 ─────────────────────────────────────────

async function handleMonthlyClean(db, res) {
  // Google OAuth (실패해도 iCal 파트는 계속 시도)
  let gToken = null;
  try { gToken = await getGoogleToken(); }
  catch (e) { console.error("[monthly-clean] Google OAuth 실패:", e.message); }

  const nextMonthDates = getNextMonthDates();
  const targetYM = nextMonthDates[0].slice(0, 7); // "YYYY-MM"

  const { rows: properties } = await db.query(
    `SELECT * FROM property_cleaning_config`
  );

  let blockersCreated = 0, blockersSkipped = 0, jobsCreated = 0, jobsSkipped = 0;

  for (const prop of properties) {
    // [1] 다음 달 전체 날짜 블로커 생성 (google_calendar_id 있을 때만)
    if (gToken && prop.google_calendar_id) {
      for (const date of nextMonthDates) {
        const { rows: existing } = await db.query(
          `SELECT 1 FROM property_calendar_blockers WHERE property_id=$1 AND block_date=$2`,
          [prop.property_id, date]
        );
        if (existing.length) { blockersSkipped++; continue; }
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
          blockersCreated++;
        } catch (e) {
          console.error(`[monthly-clean] 블로커 생성 실패 (${prop.property_id}/${date}):`, e.message);
          blockersSkipped++;
        }
      }
    }

    // [2] iCal 폴링 → 예약된 체크아웃 날짜 추출 (ical_url 있을 때만)
    if (prop.ical_url) {
      let icalText;
      try {
        const r = await fetch(prop.ical_url);
        if (!r.ok) throw new Error(`iCal HTTP ${r.status}`);
        icalText = await r.text();
      } catch (e) {
        console.error(`[monthly-clean] iCal 폴링 실패 (${prop.property_id}):`, e.message);
        continue;
      }

      const checkouts = parseCheckoutsFromIcal(icalText, targetYM);

      // [3] checkout_at마다 cleaning_job 생성 + 블로커 삭제
      for (const { date, uid } of checkouts) {
        const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes(
          date, prop.checkout_hour, prop.cleaning_duration_hours
        );
        const { rowCount } = await db.query(
          `INSERT INTO cleaning_jobs
             (property_id,reservation_uid,checkout_at,cleaning_start_at,cleaning_end_at,source)
           VALUES ($1,$2,$3,$4,$5,'MONTHLY_BATCH')
           ON CONFLICT (property_id,checkout_at) DO NOTHING`,
          [
            prop.property_id,
            uid ?? null,
            cleaning_start_at.toISOString(),
            cleaning_start_at.toISOString(),
            cleaning_end_at.toISOString(),
          ]
        );
        if (rowCount > 0) jobsCreated++; else jobsSkipped++;

        // 해당 날짜 블로커 삭제 → 예약 가능 슬롯 오픈
        const { rows: blocker } = await db.query(
          `DELETE FROM property_calendar_blockers WHERE property_id=$1 AND block_date=$2 RETURNING event_id`,
          [prop.property_id, date]
        );
        if (blocker.length && gToken && prop.google_calendar_id) {
          await deleteBlockerEvent(prop.google_calendar_id, blocker[0].event_id, gToken).catch((e) =>
            console.error(`[monthly-clean] 블로커 삭제 실패 (${prop.property_id}/${date}):`, e.message)
          );
        }
      }
    }
  }

  // [4] 다음 달 PENDING job → dispatch_after 설정 (같은 날 여러 건: 10분 간격)
  const kstNow = new Date(Date.now() + 9 * 3_600_000);
  const nextMonthStart = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 1, 1));
  const nextMonthEnd   = new Date(Date.UTC(nextMonthStart.getUTCFullYear(), nextMonthStart.getUTCMonth() + 1, 1));

  const { rows: pendingJobs } = await db.query(
    `SELECT * FROM cleaning_jobs
     WHERE status = 'PENDING'
       AND cleaning_start_at >= $1
       AND cleaning_start_at < $2
     ORDER BY cleaning_start_at ASC`,
    [nextMonthStart.toISOString(), nextMonthEnd.toISOString()]
  );

  const dateCount = {};
  for (const job of pendingJobs) {
    const dateKey = new Date(job.cleaning_start_at).toISOString().slice(0, 10);
    const seq = dateCount[dateKey] ?? 0;
    dateCount[dateKey] = seq + 1;
    await db.query(
      `UPDATE cleaning_jobs SET dispatch_after=$1 WHERE id=$2`,
      [new Date(Date.now() + seq * 10 * 60_000).toISOString(), job.id]
    );
  }

  await postSlack(
    `[PROPOS] 🗓 월간 청소 배치 완료 — 블로커 ${blockersCreated}건 생성 · 일정 ${jobsCreated}건 생성 · 발송 스케줄링 ${pendingJobs.length}건`
  );
  return res.status(200).json({ ok: true, blockersCreated, jobsCreated, scheduled: pendingJobs.length });
}

// ── 후속 처리 크론 (30분마다) ─────────────────────────────

async function handleCleaningFollowup(db, res) {
  let advanced = 0;
  let reminded = 0;
  let escalated = 0;

  // dispatch_after 도래한 PENDING job 즉시 발동
  const { rows: readyJobs } = await db.query(
    `SELECT * FROM cleaning_jobs
     WHERE status = 'PENDING' AND dispatch_after <= NOW()
     ORDER BY dispatch_after ASC`
  );
  for (const job of readyJobs) {
    try { await advanceJob(db, job); advanced++; }
    catch (e) { console.error(`[followup] PENDING advance 실패 (${job.id}):`, e.message); }
  }

  // VIP 타임아웃 체크 (1시간 창)
  const { rows: vipJobs } = await db.query(
    `SELECT j.*, n.sent_at AS notif_sent_at
     FROM cleaning_jobs j
     JOIN LATERAL (
       SELECT sent_at FROM cleaning_notifs
       WHERE job_id = j.id ORDER BY sent_at DESC LIMIT 1
     ) n ON true
     WHERE j.status IN ('NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3')
       AND n.sent_at < NOW() - INTERVAL '1 hour'`
  );

  for (const job of vipJobs) {
    try {
      await advanceJob(db, job);
      advanced++;
    } catch (e) {
      console.error(`[followup] VIP advance 실패 (${job.id}):`, e.message);
    }
  }

  // BULK 리마인드 (1시간 경과 + reminded_at IS NULL)
  const { rows: bulkNotifs } = await db.query(
    `SELECT n.*, j.property_id, j.cleaning_start_at, j.id AS job_id,
            c.phone, c.fcm_token, c.fcm_status, c.name AS cleaner_name
     FROM cleaning_notifs n
     JOIN cleaning_jobs j ON j.id = n.job_id
     JOIN cleaners c ON c.id = n.cleaner_id
     WHERE j.status = 'NOTIFYING_BULK'
       AND n.reminded_at IS NULL
       AND n.response IS NULL
       AND n.sent_at < NOW() - INTERVAL '1 hour'`
  );

  for (const notif of bulkNotifs) {
    const cfg = await getPropertyConfig(db, notif.property_id);
    const propName = cfg?.name ?? notif.property_id;
    const smsText = buildSmsRemind(
      { property_id: notif.property_id, cleaning_start_at: notif.cleaning_start_at },
      propName,
      notif.token
    );
    const cleaner = { id: notif.cleaner_id, fcm_token: notif.fcm_token, fcm_status: notif.fcm_status, phone: notif.phone, name: notif.cleaner_name };
    const calendarUrl = cfg?.google_calendar_booking_url ?? `${DASHBOARD_URL}/c/${notif.property_id}`;
    await notify(db, cleaner, {
      title: "[PROPOS] 청소 재안내",
      body: `${propName} 청소 일정 아직 미확정입니다`,
      data: { jobId: String(notif.job_id), token: notif.token, calendarUrl, hostPhone: cfg?.host_phone ?? "" },
      smsText,
      notifId: notif.id,
    }).catch((e) => console.error(`[followup] 리마인드 발송 실패 (${notif.cleaner_id}):`, e.message));
    await db.query(
      `UPDATE cleaning_notifs SET reminded_at=NOW() WHERE id=$1`,
      [notif.id]
    );
    // job 상태 → BULK_REMINDED
    await db.query(
      `UPDATE cleaning_jobs SET status='BULK_REMINDED', updated_at=NOW()
       WHERE id=$1 AND status='NOTIFYING_BULK'`,
      [notif.job_id]
    );
    reminded++;
  }

  // 에스컬레이션: BULK 발송 3시간 경과
  const { rows: bulkJobs } = await db.query(
    `SELECT j.id, j.property_id, j.cleaning_start_at
     FROM cleaning_jobs j
     JOIN LATERAL (
       SELECT MIN(sent_at) AS first_sent FROM cleaning_notifs WHERE job_id = j.id
     ) n ON true
     WHERE j.status IN ('NOTIFYING_BULK','BULK_REMINDED')
       AND n.first_sent < NOW() - INTERVAL '3 hours'`
  );

  for (const job of bulkJobs) {
    const { rows } = await db.query(
      `UPDATE cleaning_jobs SET status='ESCALATED', updated_at=NOW()
       WHERE id=$1 AND status IN ('NOTIFYING_BULK','BULK_REMINDED')
       RETURNING id`,
      [job.id]
    );
    if (!rows.length) continue;

    const cfg = await getPropertyConfig(db, job.property_id);
    const propName = cfg?.name ?? job.property_id;
    const date = new Date(job.cleaning_start_at).toISOString().slice(0, 10);
    await postSlack(
      `[PROPOS] 🚨 ${propName} ${date} 청소 배정 실패. 수동 처리 필요.`
    );
    escalated++;
  }

  return res.status(200).json({ ok: true, advanced, reminded, escalated });
}

// ── Worker 앱 헬스체크 크론 ─────────────────────────────────

async function handleWorkerHealthCheck(db, res) {
  // 30일 미접속 active → inactive 전환
  const { rowCount: deactivated } = await db.query(`
    UPDATE cleaners
    SET fcm_status = 'inactive'
    WHERE fcm_status = 'active'
      AND last_seen_at < NOW() - INTERVAL '30 days'
  `);

  // 7일 초과 active → Slack 경고 목록
  const { rows: stale } = await db.query(`
    SELECT name, phone, last_seen_at
    FROM cleaners
    WHERE fcm_status = 'active'
      AND last_seen_at < NOW() - INTERVAL '7 days'
    ORDER BY last_seen_at ASC
  `);

  if (stale.length > 0) {
    const lines = stale.map((w) => {
      const days = Math.floor((Date.now() - new Date(w.last_seen_at)) / 86_400_000);
      return `  • ${w.name ?? w.phone} — ${days}일 미접속`;
    });
    await postSlack(
      `[PROPOS] 🟡 Worker 앱 장기 미접속 (${stale.length}명)\n${lines.join("\n")}`
    );
  }

  if (deactivated > 0) {
    await postSlack(
      `[PROPOS] 🟠 Worker 앱 비활성 전환 — ${deactivated}명 (30일 미접속)`
    );
  }

  return res.status(200).json({ ok: true, deactivated, stale: stale.length });
}

// ── 라우터 ──────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).end();
  }

  const action = (req.query?.slug
    ? (Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug)
    : (req.url || "").split("?")[0].split("/").filter(Boolean)[2]) || "";

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    if (action === "daily-plan")          return await handleDailyPlan(db, res);
    if (action === "daily-result")        return await handleDailyResult(db, res);
    if (action === "monthly-cleaning")    return await handleMonthlyClean(db, res);
    if (action === "cleaning-followup")   return await handleCleaningFollowup(db, res);
    if (action === "worker-health-check") return await handleWorkerHealthCheck(db, res);

    // Vercel Hobby 크론: /api/cron/morning (UTC 23:00 = KST 08:00)
    if (action === "morning") {
      const kstDay = new Date(Date.now() + 9 * 3600000).getUTCDate();
      await handleDailyPlan(db, { status: () => ({ json: () => {} }), json: () => {} });
      await handleWorkerHealthCheck(db, { status: () => ({ json: () => {} }), json: () => {} });
      if (kstDay === 15) {
        await handleMonthlyClean(db, { status: () => ({ json: () => {} }), json: () => {} });
      }
      return res.status(200).json({ ok: true, ran: ["daily-plan", "worker-health-check", ...(kstDay === 15 ? ["monthly-cleaning"] : [])] });
    }

    // Vercel Hobby 크론: /api/cron/evening (UTC 13:00 = KST 22:00)
    if (action === "evening") {
      return await handleDailyResult(db, res);
    }

    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error(`[cron/${action}] error:`, err);
    return res.status(500).json({ error: err.message });
  } finally {
    await db.end();
  }
}
