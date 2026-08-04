/**
 * GET /api/cron/daily-plan
 * 오전 8시 KST (UTC 23:00 전날) — 당일 운영 계획 브리핑.
 * Vercel Cron이 호출. CRON_SECRET으로 외부 호출 차단.
 *
 * Slack 메시지 구성:
 *   현재 숙소 상태 요약 (KV) + 이번 주 누적 KPI (DB)
 */

import { createPool } from "@vercel/postgres";
import { kv } from "@vercel/kv";
import { getStatsForPeriod } from "../../src/application/reportingService.js";

const WEBHOOK_URL = process.env.PROPOS_SLACK_WEBHOOK;
const DASHBOARD_URL = process.env.PROPOS_BASE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function kstDateString() {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  return {
    date: kst.toISOString().slice(0, 10),
    weekday: WEEKDAYS[kst.getUTCDay()],
  };
}

async function postSlack(text) {
  if (!WEBHOOK_URL) return;
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // Vercel Cron 보안 검증 (CRON_SECRET은 Vercel이 자동 생성)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).end();
  }

  const db = createPool({ connectionString: process.env.POSTGRES_URL });
  try {
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
  } catch (err) {
    console.error("[cron/daily-plan] error:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    await db.end();
  }
}
