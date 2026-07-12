/**
 * Vercel 서버리스 — 모니터링 설정 전달
 * POST /api/monitoring/config → Pi 워처로 relay
 */

const WATCHER_URL = process.env.PROPOS_WATCHER_URL;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

export default async function handler(req, res) {
  if (!WATCHER_URL) { sendJson(res, 503, { error: 'PROPOS_WATCHER_URL not configured' }); return; }
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }

  try {
    const body = await readBody(req);
    const upstream = `${WATCHER_URL.replace(/\/$/, '')}/api/monitoring/config`;
    const r = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await r.json().catch(() => ({}));
    sendJson(res, r.status, result);
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}
