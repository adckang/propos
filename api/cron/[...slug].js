/**
 * GET /api/cron/daily-plan   — 오전 8시 KST (UTC 23:00 전날) 브리핑
 * GET /api/cron/daily-result — 저녁 10시 KST (UTC 13:00) 결산
 *
 * slug[0] = "daily-plan" | "daily-result"
 */

import { Pool } from "pg";
import { kv } from "@vercel/kv";
import { getStatsForPeriod } from "../../src/application/reportingService.js";
import { countPeriodEvents } from "../../src/domain/reportingDomain.js";
import { queryEvents } from "../../src/infrastructure/eventRepository.js";

const WEBHOOK_URL = process.env.PROPOS_SLACK_WEBHOOK;
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

async function postSlack(text) {
  if (!WEBHOOK_URL) return;
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
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

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).end();
  }

  const slug = req.query.slug;
  const action = Array.isArray(slug) ? slug[0] : slug;

  const db = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    if (action === "daily-plan")   return await handleDailyPlan(db, res);
    if (action === "daily-result") return await handleDailyResult(db, res);
    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error(`[cron/${action}] error:`, err);
    return res.status(500).json({ error: err.message });
  } finally {
    await db.end();
  }
}
