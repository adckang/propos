/**
 * GET /api/cron/tick — 매시간 정각 실행 (단일 크론)
 *
 * KST 시각을 보고 해당 시간대 작업만 실행:
 *   08:00 → daily-plan
 *   09:00 → worker-health-check
 *   22:00 → daily-result
 *   00:00 + 15일 → monthly-cleaning
 */

import slugHandler from "./[...slug].js";

const KST_OFFSET = 9 * 3600 * 1000;

function kstNow() {
  const d = new Date(Date.now() + KST_OFFSET);
  return { hour: d.getUTCHours(), day: d.getUTCDate() };
}

function fakeRes() {
  const r = { _code: 200, _body: null };
  r.status = (c) => { r._code = c; return r; };
  r.json   = (b) => { r._body = b; return r; };
  r.end    = ()  => r;
  return r;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).end();
  }

  const { hour, day } = kstNow();

  const tasks = [];
  if (hour === 8)               tasks.push("daily-plan");
  if (hour === 8)               tasks.push("worker-health-check");   // daily-plan과 동시 실행
  if (hour === 8 && day === 15) tasks.push("monthly-cleaning");      // 매월 15일 아침
  if (hour === 22)              tasks.push("daily-result");

  const results = {};
  for (const action of tasks) {
    const fakeReq = {
      method: "GET",
      headers: req.headers,
      query: { slug: action },
      url: `/api/cron/${action}`,
    };
    const fr = fakeRes();
    await slugHandler(fakeReq, fr);
    results[action] = fr._body;
  }

  return res.status(200).json({ ok: true, kstHour: hour, tasks, results });
}
