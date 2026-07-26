/**
 * Vercel 서버리스 함수 — CCTV 스냅샷 이미지 중계
 * GET /api/camera/snapshot?path=/local/snapshots/entry_XXX.jpg
 *
 * Pi 워처(PROPOS_WATCHER_URL:3001)가 HA에서 이미지를 가져와 반환.
 * 브라우저가 HA나 Pi에 직접 접근할 필요 없이 이 엔드포인트만 사용.
 */

const WATCHER_URL = process.env.PROPOS_WATCHER_URL;

export default async function handler(req, res) {
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
