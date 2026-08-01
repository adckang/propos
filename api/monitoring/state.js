/**
 * Vercel 서버리스 함수 — 모니터링 상태 중계
 * GET  → Pi 워처에서 roomState 읽어옴
 * POST → 브라우저 설정을 Pi 워처로 전달 (reservation, areaName 등)
 * PUT  → roomState 수동 덮어쓰기
 *
 * 환경변수:
 *   PROPOS_WATCHER_URLS   JSON 맵: {"watcher1":"https://...","watcher2":"https://..."}
 *   PROPOS_WATCHER_URL    단일 URL 폴백 (기존 설정 하위 호환)
 *
 * ?watcherId=watcher1 쿼리 파라미터로 Pi 선택.
 * watcherId 미지정 시 PROPOS_WATCHER_URL 폴백.
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
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

export default async function handler(req, res) {
  const watcherId = req.query?.watcherId ?? null;
  const WATCHER_URL = resolveWatcherUrl(watcherId);

  if (!WATCHER_URL) {
    sendJson(res, 503, { error: 'PROPOS_WATCHER_URL not configured' });
    return;
  }

  try {
    const upstream = `${WATCHER_URL.replace(/\/$/, '')}/api/monitoring/state`;
    const options = { method: req.method, headers: { 'Content-Type': 'application/json' } };

    if (req.method === 'POST' || req.method === 'PUT') {
      options.body = JSON.stringify(await readBody(req));
    }

    const r = await fetch(upstream, options);
    const body = await r.json().catch(() => ({}));
    sendJson(res, r.status, body);
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}
