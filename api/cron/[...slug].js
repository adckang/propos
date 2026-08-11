// GET /api/cron/daily-plan        — 오전 8시 KST 브리핑
// GET /api/cron/daily-result      — 저녁 10시 KST 결산
// GET /api/cron/monthly-cleaning  — 매월 15일 KST 09:00 청소 배치 (cron: 0 0 15 * *)
// GET /api/cron/cleaning-followup — 30분마다 리마인드·에스컬레이션 (cron: 30min)

import { Pool } from "pg";
import { kv } from "@vercel/kv";
import {
  advanceJob,
  buildSmsRemind,
  sendSms,
  postSlack,
  getPropertyConfig,
} from "../cleaning/_dispatch.js";
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
  const kstNow = new Date(Date.now() + 9 * 3_600_000);
  const nextMonth = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 1, 1));
  const nextMonthEnd = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 1));

  // 다음 달 PENDING job 전체 조회 (날짜 오름차순)
  const { rows: pendingJobs } = await db.query(
    `SELECT * FROM cleaning_jobs
     WHERE status = 'PENDING'
       AND cleaning_start_at >= $1
       AND cleaning_start_at < $2
     ORDER BY cleaning_start_at ASC`,
    [nextMonth.toISOString(), nextMonthEnd.toISOString()]
  );

  // 같은 날 여러 건: dispatch_after를 10분 간격으로 설정 (Vercel timeout 방지)
  // 실제 발송은 followup 크론이 dispatch_after 도래 시 처리
  const dateCount = {};
  for (const job of pendingJobs) {
    const dateKey = new Date(job.cleaning_start_at).toISOString().slice(0, 10);
    const seq = dateCount[dateKey] ?? 0;
    dateCount[dateKey] = seq + 1;

    const dispatchAfterMs = Date.now() + seq * 10 * 60_000;
    await db.query(
      `UPDATE cleaning_jobs SET dispatch_after=$1 WHERE id=$2`,
      [new Date(dispatchAfterMs).toISOString(), job.id]
    );
  }

  await postSlack(
    `[PROPOS] 🗓 월간 청소 배치 스케줄링 완료 — ${pendingJobs.length}건 (dispatch_after 설정)`
  );
  return res.status(200).json({ ok: true, scheduled: pendingJobs.length });
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
            c.phone, c.name AS cleaner_name
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
    const msg = buildSmsRemind(
      { property_id: notif.property_id, cleaning_start_at: notif.cleaning_start_at },
      propName,
      notif.token
    );
    await sendSms(notif.phone, msg).catch((e) =>
      console.error(`[followup] 리마인드 SMS 실패 (${notif.phone}):`, e.message)
    );
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
    if (action === "daily-plan")        return await handleDailyPlan(db, res);
    if (action === "daily-result")      return await handleDailyResult(db, res);
    if (action === "monthly-cleaning")  return await handleMonthlyClean(db, res);
    if (action === "cleaning-followup") return await handleCleaningFollowup(db, res);
    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error(`[cron/${action}] error:`, err);
    return res.status(500).json({ error: err.message });
  } finally {
    await db.end();
  }
}
