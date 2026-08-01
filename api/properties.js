/**
 * GET /api/properties  — 저장된 숙소 목록 반환
 * PUT /api/properties  — 숙소 목록 저장
 *
 * Vercel에서는 PROPOS_WATCHER_URL(Pi 포트 3001)로 프록시.
 * 환경변수 미설정 시 503 반환.
 */

const WATCHER_URLS = (() => {
  try { return JSON.parse(process.env.PROPOS_WATCHER_URLS ?? '{}'); }
  catch { return {}; }
})();
const DEFAULT_WATCHER_URL = process.env.PROPOS_WATCHER_URL;

function resolveWatcherUrl(watcherId) {
  if (watcherId && WATCHER_URLS[watcherId]) return WATCHER_URLS[watcherId];
  return DEFAULT_WATCHER_URL ?? null;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return [];
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return []; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const watcherId = req.query?.watcherId ?? null;
  const WATCHER_URL = resolveWatcherUrl(watcherId);

  if (!WATCHER_URL) {
    sendJson(res, 503, { error: 'PROPOS_WATCHER_URL not configured' });
    return;
  }

  try {
    const upstream = `${WATCHER_URL.replace(/\/$/, '')}/api/properties`;
    const options = { method: req.method, headers: { 'Content-Type': 'application/json' } };
    if (req.method === 'PUT') {
      options.body = JSON.stringify(await readBody(req));
    }
    const r = await fetch(upstream, options);
    const body = await r.json().catch(() => ({}));
    sendJson(res, r.status, body);
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}
