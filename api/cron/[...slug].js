// GET /api/cron/daily-plan        — 오전 8시 KST 브리핑
// GET /api/cron/daily-result      — 저녁 10시 KST 결산
// GET /api/cron/monthly-cleaning  — 매월 15일 KST 09:00 청소 배치 (cron: 0 0 15 * *)
// GET /api/cron/cleaning-followup — 30분마다 리마인드·에스컬레이션 (cron: 30min)

import { Pool } from "pg";
import { kv } from "@vercel/kv";
import {
  advanceJob,
  getVipFollowupJobs,
  recoverInitialDeliveries,
  buildSmsRemind,
  calcCleaningTimes,
  planJobDispatch,
  toKstDateKey,
  postSlack,
  getPropertyConfig,
} from "../../server/cleaning/_dispatch.js";
import { notify } from "../../server/cleaning/_notify.js";
import { syncAllPropertiesIcal } from "../../server/cleaning/_icalSync.js";
import { isCheckoutCancelled } from "../../server/cleaning/_reservationSync.js";
import { DATA_PROFILE, resolveServerDataProfile } from "../../src/config/dataProfile.js";
import {
  getGoogleToken,
  getGmailToken,
  createBlockerEvent,
  getNextMonthDates,
  openCleaningSlot,
  parseCheckoutsFromIcal,
  requestedCleaningDays,
} from "../../server/cleaning/_calendar.js";
import { getStatsForPeriod } from "../../src/application/reportingService.js";
import { countPeriodEvents } from "../../src/domain/reportingDomain.js";
import { queryEvents } from "../../src/infrastructure/eventRepository.js";
import { reportTokenFailure, markRenewed, checkStaleness, isRenewalDue } from "../../server/cleaning/_tokenHealth.js";

const WATCH_STALE_MS = 6 * 24 * 60 * 60 * 1000; // 7일 만료 전 1일 여유를 두고 경고

const DASHBOARD_URL =
  process.env.PROPOS_BASE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : null) ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 첫 요청과 함께 그날 칸을 연다(DEC-07) — 구글에서 지워졌을 때만 기록을 지워, 실패하면 아래 "다시 열기"가 재시도한다
function makeCronBlockerDeleter(db) {
  return async (job) => {
    await openCleaningSlot(db, { propertyId: job.property_id, date: toKstDateKey(job.checkout_at), kv }); // 칸 날짜는 한국 날짜
  };
}

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
  // Google OAuth 실패해도 iCal 파트(cleaning_jobs 생성)는 계속 진행한다.
  // 실패 시 알림은 getGoogleToken(kv) 내부(_tokenHealth.js)가 Slack으로 일괄 처리한다.
  const batchNow = Date.now(); // 이번 배치의 요청 시각 계산 기준([3]·[4]가 같은 "지금"을 쓴다)
  let gToken = null;
  try { gToken = await getGoogleToken(kv); }
  catch (e) { console.error("[monthly-clean] Google OAuth 실패:", e.message); }

  const nextMonthDates = getNextMonthDates();
  const targetYM = nextMonthDates[0].slice(0, 7); // "YYYY-MM"

  const { rows: properties } = await db.query(
    `SELECT * FROM property_cleaning_config WHERE data_origin = 'REAL'`
  );

  let blockersCreated = 0, blockersSkipped = 0, jobsCreated = 0, jobsSkipped = 0, jobsFailed = 0;

  for (const prop of properties) {
    // [1] 다음 달 전체 날짜 블로커 생성 (google_calendar_id 있을 때만) — 퇴실 날도 막는다. 칸은 요청을 보내는 날 연다(DEC-07):
    // 매일 요청 작업이 첫 요청과 함께 그날 블로커를 지운다. 단 이미 요청이 나갔거나 배정된 날은 막지 않는다
    // (막으면 요청 받은 담당자가 예약할 수 없다)
    if (gToken && prop.google_calendar_id) {
      const keepOpen = await requestedCleaningDays(db, prop.property_id, nextMonthDates);
      for (const date of nextMonthDates) {
        if (keepOpen.has(date)) { blockersSkipped++; continue; }
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

      // [3] checkout_at마다 cleaning_job 생성 — 칸(블로커)은 여기서 열지 않는다. 요청을 보내는 날 첫 요청과 함께 연다(DEC-07,
      // 설계 문서 핵심 정책 "dispatch_after 도달 시 블로커 삭제 + 알림 발송"). 예전엔 15일에 바로 열어, 요청이 2주 전으로 바뀐 뒤
      // 몇 주 동안 칸이 열려 있었다(요청 순서와 상관없이 링크를 아는 담당자가 먼저 잡을 수 있음)
      for (const { date, uid } of checkouts) {
        const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes(
          date, prop.checkout_hour, prop.cleaning_duration_hours
        );
        // 요청 시각은 만들 때부터 저장한다(시나리오 S01: 청소 2주 전) — 아래 [4]가 실패해도 DB 기본값(지금)으로 바로 나가지 않게
        const { source, dispatchAfter } = planJobDispatch(cleaning_start_at, batchNow);
        try {
          const { rowCount } = await db.query(
            `INSERT INTO cleaning_jobs
               (property_id,reservation_uid,checkout_at,cleaning_start_at,cleaning_end_at,source,dispatch_after)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (property_id,checkout_at) DO NOTHING`,
            [
              prop.property_id,
              uid ?? null,
              cleaning_start_at.toISOString(),
              cleaning_start_at.toISOString(),
              cleaning_end_at.toISOString(),
              source,
              dispatchAfter.toISOString(),
            ]
          );
          if (rowCount > 0) jobsCreated++; else jobsSkipped++;
        } catch (e) {
          // 예: 예약 목록에 아직 없는 새 예약은(청소 일정은 실제 예약에 연결돼야 한다) 저장이 거절된다 — 이 날짜만 건너뛰고
          // (다음 예약 동기화가 일정을 만든다) 나머지 날짜는 계속한다. 아침 작업은 이 단계 전에 예약을 먼저 가져오므로(RF-20) 드물다.
          // 실패 건수는 아래 Slack 요약에 따로 보여 조용히 묻히지 않게 한다
          jobsFailed++;
          console.error(`[monthly-clean] 청소 일정 생성 실패 (${prop.property_id}/${date}):`, e.code ?? e.message);
        }
      }
    }
  }

  // [4] 다음 달 PENDING job → dispatch_after 설정 — 시나리오 S01(cleaning-scenario-matrix.md): 청소 2주 전, 같은 날 여러 건은 10분 간격.
  // (예전엔 "지금"으로 덮어써 다음 달 요청이 15일에 한꺼번에 나갔다 — 10/15 배치가 11월 요청을 한 달 일찍 보냄, RF-19)
  const KST_MS = 9 * 3_600_000;
  const kstNow = new Date(batchNow + KST_MS);
  // 다음 달 범위는 한국 시간 자정 기준(날짜 묶음도 한국 날짜라 같은 달력으로)
  const nextMonthStart = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 1, 1) - KST_MS);
  const nextMonthEnd   = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 2, 1) - KST_MS);

  const { rows: pendingJobs } = await db.query(
    `SELECT * FROM cleaning_jobs
     WHERE data_origin = 'REAL'
       AND status = 'PENDING'
       AND cleaning_start_at >= $1
       AND cleaning_start_at < $2
     ORDER BY cleaning_start_at ASC`,
    [nextMonthStart.toISOString(), nextMonthEnd.toISOString()]
  );

  const dateCount = {};
  let scheduled = 0;
  for (const job of pendingJobs) {
    const dateKey = toKstDateKey(job.cleaning_start_at);
    const seq = dateCount[dateKey] ?? 0;
    dateCount[dateKey] = seq + 1;
    const { dispatchAfter } = planJobDispatch(job.cleaning_start_at, batchNow);
    const { rowCount } = await db.query(
      `UPDATE cleaning_jobs SET dispatch_after=$1 WHERE id=$2 AND status='PENDING'`,
      [new Date(dispatchAfter.getTime() + seq * 10 * 60_000).toISOString(), job.id]
    );
    scheduled += rowCount ?? 0;
  }

  await postSlack(
    `[PROPOS] 🗓 월간 청소 배치 완료 — 블로커 ${blockersCreated}건 생성 · 일정 ${jobsCreated}건 생성 · 발송 스케줄링 ${scheduled}건`
    + (jobsFailed ? ` · ⚠️ 일정 생성 실패 ${jobsFailed}건(로그 확인 — 다음 예약 동기화 때 다시 만들어짐)` : "")
  );
  return res.status(200).json({ ok: true, blockersCreated, jobsCreated, jobsFailed, scheduled });
}

// ── 후속 처리 크론 (30분마다) ─────────────────────────────

async function handleCleaningFollowup(db, res) {
  let advanced = await recoverInitialDeliveries(db);
  let reminded = 0;
  let escalated = 0;

  // dispatch_after 도래한 PENDING job 즉시 발동 — 청소 시작이 이미 지난 작업에는 첫 요청을 보내지 않는다(RF-12: 작업은 앞으로의
  // 퇴실에만 만들지만, 어떤 경로로든 지난 작업이 "요청 전"으로 남아 있으면 지난 청소 요청이 담당자에게 나가지 않게. 운영자 수동 발송은
  // 그대로 가능. 이미 진행 중인 요청(VIP 다음 단계·단체 재안내)을 시작 시각에 멈출지는 별도 판단이라 바꾸지 않았다)
  const { rows: readyJobs } = await db.query(
    `SELECT * FROM cleaning_jobs
     WHERE data_origin = 'REAL'
       AND status = 'PENDING' AND dispatch_after <= NOW()
       AND cleaning_start_at > NOW()
     ORDER BY dispatch_after ASC`
  );
  for (const job of readyJobs) {
    try {
      const result = await advanceJob(db, job, { deleteBlocker: makeCronBlockerDeleter(db) });
      if (result?.ok !== false) advanced++;
    }
    catch (e) { console.error(`[followup] PENDING advance 실패 (${job.id}):`, e.message); }
  }

  // 요청은 나갔는데 그날 칸이 아직 막혀 있으면 다시 연다 — 칸은 요청 날 첫 요청과 함께 여는데(DEC-07) 그때 구글 연결이 실패했을 수
  // 있다(실패하면 막힌 기록을 남겨 두므로 여기서 다시 시도). 칸이 막혀 있으면 요청 받은 담당자가 예약할 수 없다
  const { rows: stillBlocked } = await db.query(
    `SELECT DISTINCT j.property_id, b.block_date::text AS day FROM cleaning_jobs j
       JOIN property_calendar_blockers b
         ON b.property_id = j.property_id AND b.block_date = (j.checkout_at AT TIME ZONE 'Asia/Seoul')::date
      WHERE j.data_origin = 'REAL' AND j.checkout_at > NOW()
        AND j.status IN ('NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3','NOTIFYING_BULK','BULK_REMINDED','ESCALATED','ASSIGNED')`
  );
  for (const { property_id, day } of stillBlocked) {
    await openCleaningSlot(db, { propertyId: property_id, date: day, kv })
      .catch(e => console.error(`[followup] 칸 다시 열기 실패 (${property_id}/${day}):`, e.message));
  }

  // VIP 타임아웃 체크 (1시간 창)
  const { rows: vipJobs } = await getVipFollowupJobs(db);

  for (const job of vipJobs) {
    try {
      const result = await advanceJob(db, job);
      if (result?.ok !== false) advanced++;
    } catch (e) {
      console.error(`[followup] VIP advance 실패 (${job.id}):`, e.message);
    }
  }

  // BULK 리마인드 (1시간 경과 + reminded_at IS NULL)
  const { rows: bulkNotifs } = await db.query(
    `SELECT n.*, j.property_id, j.cleaning_start_at, j.id AS job_id,
            j.checkout_at AS job_checkout_at, j.reservation_uid AS job_reservation_uid,
            c.phone, c.fcm_token, c.fcm_status, c.name AS cleaner_name
     FROM cleaning_notifs n
     JOIN cleaning_jobs j ON j.id = n.job_id
     JOIN cleaners c ON c.id = n.cleaner_id
     WHERE j.data_origin = 'REAL'
       AND j.status = 'NOTIFYING_BULK'
       AND n.reminded_at IS NULL
       AND n.response IS NULL
       AND n.sent_at < NOW() - INTERVAL '1 hour'`
  );

  for (const notif of bulkNotifs) {
    // RF-16: 그날 퇴실이 없어졌으면(예약 취소·같은 예약의 날짜 변경) 재안내를 보내지 않는다 — 운영자 알림은 동기화가 보낸다
    if (await isCheckoutCancelled(db, { property_id: notif.property_id, checkout_at: notif.job_checkout_at, reservation_uid: notif.job_reservation_uid })) continue;
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
    `SELECT j.id, j.property_id, j.cleaning_start_at, j.checkout_at, j.reservation_uid
     FROM cleaning_jobs j
     JOIN LATERAL (
       SELECT MIN(sent_at) AS first_sent FROM cleaning_notifs WHERE job_id = j.id AND tier = 'BULK'
     ) n ON true
     WHERE j.data_origin = 'REAL'
       AND j.status IN ('NOTIFYING_BULK','BULK_REMINDED')
       AND n.first_sent < NOW() - INTERVAL '3 hours'`
  );

  for (const job of bulkJobs) {
    // RF-16: 그날 퇴실이 없어졌으면 "배정 실패 — 수동 처리" 로 넘기지 않는다(없는 퇴실에 사람을 구하지 않게). 운영자 알림은 동기화가 보낸다
    if (await isCheckoutCancelled(db, job)) continue;
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

  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    return res.status(403).json({ error: "demo profile is read-only", dataProfile: "demo" });
  }

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
      const kstNow = new Date(Date.now() + 9 * 3600000);
      const kstDay = kstNow.getUTCDate();
      const nullRes = { status: () => ({ json: () => {} }), json: () => {} };
      const ran = [];

      // 각 단계를 개별 try/catch로 격리한다 — 하나가 실패해도 나머지(특히 아래 매일
      // 돌아가야 하는 staleness 사전경고)가 계속 실행되게 하기 위함. 예전엔 여기서 하나가
      // throw하면 전체가 바깥 catch로 빠져서 그날 staleness 점검 자체가 아예 안 돌았다.
      // RF-20: 다른 일보다 먼저 Airbnb 예약을 가져온다 — 화면을 열지 않아도 새 예약·취소·날짜 변경이 반영되고, 아래 브리핑·요청
      // 작업·15일 월간 작업이 최신 예약으로 돈다. 실패해도 나머지는 그대로 돈다(예전 예약 기준)
      try { await syncAllPropertiesIcal(db, { kv }); ran.push("ical-sync"); }
      catch (e) { console.error("[morning] ical-sync 실패:", e.message); }

      try { await handleDailyPlan(db, nullRes); ran.push("daily-plan"); }
      catch (e) { console.error("[morning] daily-plan 실패:", e.message); }

      try { await handleWorkerHealthCheck(db, nullRes); ran.push("worker-health-check"); }
      catch (e) { console.error("[morning] worker-health-check 실패:", e.message); }

      // 15일엔 월간 작업(다음 달 칸 막기·일정 만들기)을 요청 작업보다 먼저 — 요청 시각이 된 일정은 바로 뒤 요청 작업이 칸을 열며 보낸다
      if (kstDay === 15) {
        try { await handleMonthlyClean(db, nullRes); ran.push("monthly-cleaning"); }
        catch (e) { console.error("[morning] monthly-cleaning 실패:", e.message); }
      }

      try { await handleCleaningFollowup(db, nullRes); ran.push("cleaning-followup"); }
      catch (e) { console.error("[morning] cleaning-followup 실패:", e.message); }

      // Gmail Watch 7일 만료 → 마지막 성공 갱신으로부터 WATCH_STALE_MS 이상 지났으면 매일 재시도.
      // (예전엔 "매주 월요일에만" 시도했는데, 그 월요일 시도가 하필 OAuth 리프레시 토큰 장애와
      //  겹쳐 실패하면 다음 시도가 꼬박 일주일 뒤라 그 사이 채널이 완전히 만료되고도 아무도
      //  자동으로 재시도하지 않았다 — 실제로 겪은 사고. 요일 대신 "경과 시간"으로 판단하면
      //  평소엔 주 1회꼴로 돌지만, 한 번 실패해도 다음 날부터 매일 재시도해 토큰이 복구되는
      //  즉시 스스로 다시 구독된다 — 수동 재등록이 더는 필요 없다.)
      if (await isRenewalDue(kv, "gmail_watch", WATCH_STALE_MS)) {
        try {
          const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
          const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
          if (topicName) {
            const gToken = await getGmailToken(kv);
            const r = await fetch(`${GMAIL_API}/users/me/watch`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${gToken}` },
              body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" }),
            });
            if (!r.ok) throw new Error(`Gmail watch API ${r.status}`);
            const w = await r.json();
            if (w.expiration) {
              const ttlSec = Math.floor((Number(w.expiration) - Date.now()) / 1000) + 3600;
              await kv.set("gmail_watch_expiration", w.expiration, { ex: ttlSec }).catch(() => {});
            }
            // 갱신 자체(API 응답 ok)는 성공했으므로, 이후 메시지 포맷팅이 실패해도 markRenewed는 지킨다.
            await markRenewed(kv, "gmail_watch");
            const expLabel = w.expiration ? new Date(Number(w.expiration)).toISOString().slice(0, 10) : "알 수 없음";
            await postSlack(`[PROPOS] 📬 Gmail Watch 자동 갱신 완료 (만료: ${expLabel})`);
            ran.push("gmail-watch-renewed");
          }
        } catch (e) {
          console.error("[morning] Gmail Watch 갱신 실패:", e.message);
          await reportTokenFailure(kv, "gmail_watch", "Gmail Watch 갱신", e);
        }
      }

      // Calendar Watch — 같은 이유로 동일하게 경과 시간 기준 재시도 (GAP-001 fix, 요일 의존 제거)
      if (await isRenewalDue(kv, "calendar_watch", WATCH_STALE_MS)) {
        try {
          const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
          const { rows: calProps } = await db.query(
            `SELECT DISTINCT google_calendar_id FROM property_cleaning_config WHERE google_calendar_id IS NOT NULL`
          );
          if (calProps.length) {
            const calToken = await getGoogleToken(kv);
            const webhookUrl = `${DASHBOARD_URL}/api/cleaning/calendar-webhook`;
            const calSecret = process.env.GOOGLE_WEBHOOK_SECRET ?? "";
            let calWatchCount = 0;
            for (const { google_calendar_id: calId } of calProps) {
              const channelId = `propos-cal-${calId.replace(/[^a-z0-9]/gi, "-")}-${Date.now()}`;
              const r = await fetch(
                `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calId)}/events/watch`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${calToken}` },
                  body: JSON.stringify({
                    id: channelId, type: "web_hook", address: webhookUrl,
                    token: calSecret, params: { ttl: "604800" },
                  }),
                }
              );
              if (r.ok) calWatchCount++;
            }
            // 전부 성공해야만 markRenewed 하면, 숙소가 늘어 캘린더가 여러 개일 때 하나만 계속
            // 깨져있어도 markRenewed가 영원히 안 돼서 staleness 경고가 매일 영구 오탐으로 남는다.
            // 여기선 "갱신 메커니즘(토큰·API) 자체가 살아있었는지"만 추적하고, 캘린더별 성공률은
            // 바로 아래 Slack 메시지(비율 표시)로 이미 드러난다.
            await markRenewed(kv, "calendar_watch");
            await postSlack(`[PROPOS] 📅 Calendar Watch 자동 갱신 완료 (${calWatchCount}/${calProps.length}개 캘린더)`);
            ran.push("calendar-watch-renewed");
          }
        } catch (e) {
          console.error("[morning] Calendar Watch 갱신 실패:", e.message);
          await reportTokenFailure(kv, "calendar_watch", "Calendar Watch 갱신", e);
        }
      }

      // 매일: Watch 갱신이 몇 주 전부터 조용히 계속 실패해도 7일 만료 전에 미리 알리기
      // (위 블록은 월요일에만 시도하므로, 그 시도 자체가 매번 조용히 실패하는 경우를 여기서 잡는다)
      await checkStaleness(kv, "gmail_watch", "Gmail Watch", WATCH_STALE_MS);
      await checkStaleness(kv, "calendar_watch", "Calendar Watch", WATCH_STALE_MS);

      return res.status(200).json({ ok: true, ran });
    }

    // Vercel Hobby 크론: /api/cron/evening (UTC 13:00 = KST 22:00)
    if (action === "evening") {
      const nullRes = { status: () => ({ json: () => {} }), json: () => {} };
      // RF-20: 밤 요청 작업 전에도 예약을 가져온다 — 취소는 "두 번 연속 안 보여야" 확정이라 하루 두 번 돌아야 반나절~하루 안에 반영된다
      try { await syncAllPropertiesIcal(db, { kv }); }
      catch (e) { console.error("[evening] ical-sync 실패:", e.message); }
      await handleCleaningFollowup(db, nullRes);
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
