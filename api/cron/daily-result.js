/**
 * GET /api/cron/daily-result
 * 저녁 10시 KST (UTC 13:00) — 당일 운영 결과 정산.
 * Vercel Cron이 호출. CRON_SECRET으로 외부 호출 차단.
 *
 * Slack 메시지 구성:
 *   오늘 하루 발생 이벤트 집계 (DB) + 현재 숙소 상태 (KV)
 */

import { createPool } from "@vercel/postgres";
import { kv } from "@vercel/kv";
import { countPeriodEvents } from "../../src/domain/reportingDomain.js";
import { queryEvents } from "../../src/infrastructure/eventRepository.js";
import { getStatsForPeriod } from "../../src/application/reportingService.js";

const WEBHOOK_URL = process.env.PROPOS_SLACK_WEBHOOK;
const DASHBOARD_URL = "https://proposonline.com";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function kstDateString() {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  return {
    date: kst.toISOString().slice(0, 10),
    weekday: WEEKDAYS[kst.getUTCDay()],
  };
}

// KST 기준 오늘 하루를 UTC 범위로 변환
function getKSTTodayRangeUTC() {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  // KST 자정 → UTC: 9시간 빼기
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

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).end();
  }

  const db = createPool({ connectionString: process.env.POSTGRES_URL });
  try {
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
  } catch (err) {
    console.error("[cron/daily-result] error:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    await db.end();
  }
}
