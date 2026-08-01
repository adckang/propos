/**
 * Vercel 서버리스 함수 — CCTV 스냅샷 이미지 중계
 * GET /api/camera/snapshot?path=/local/snapshots/entry_XXX.jpg&watcherId=watcher1
 *
 * 환경변수:
 *   PROPOS_WATCHER_URLS  JSON 맵: {"watcher1":"https://...","watcher2":"https://..."}
 *   PROPOS_WATCHER_URL   단일 URL 폴백 (기존 설정 하위 호환)
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

export default async function handler(req, res) {
  const watcherId = req.query?.watcherId ?? null;
  const WATCHER_URL = resolveWatcherUrl(watcherId);

  if (!WATCHER_URL) {
    res.statusCode = 503;
    res.end();
    return;
  }

  const path = req.query?.path ?? '';
  if (!path.startsWith('/local/snapshots/') || path.includes('..')) {
    res.statusCode = 400;
    res.end();
    return;
  }

  try {
    const upstream = `${WATCHER_URL.replace(/\/$/, '')}/api/camera/snapshot?path=${encodeURIComponent(path)}`;
    const r = await fetch(upstream);
    if (!r.ok) { res.statusCode = r.status; res.end(); return; }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.statusCode = 200;
    res.end(buf);
  } catch {
    res.statusCode = 502;
    res.end();
  }
}
