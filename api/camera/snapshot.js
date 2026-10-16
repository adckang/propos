/**
 * Vercel 서버리스 함수 — CCTV 스냅샷 이미지 중계
 * GET /api/camera/snapshot?path=/local/snapshots/entry_XXX.jpg&watcherId=watcher1
 *
 * 환경변수:
 *   PROPOS_WATCHER_URLS  JSON 맵: {"watcher1":"https://...","watcher2":"https://..."}
 *   PROPOS_WATCHER_URL   단일 URL 폴백 (기존 설정 하위 호환)
 */

import { DATA_PROFILE, resolveServerDataProfile } from '../../src/config/dataProfile.js';

import { requireScope } from '../../server/auth/operatorAuth.js';
import { isAdminScope } from '../../server/auth/operatorAccounts.js';
import { createWatcherPropertyLookup, operatorMayUseWatcher, resolveWatcherUrl } from '../../server/auth/watcherScope.js';
import { _setAuthDbForTest, getAuthDb } from '../../server/auth/authDb.js';

let watcherLookup = createWatcherPropertyLookup();
/** 테스트 전용 주입 */
export function _setForTest({ db: fakeDb, lookup } = {}) { _setAuthDbForTest(fakeDb); watcherLookup = lookup ?? createWatcherPropertyLookup(); }

export default async function handler(req, res) {
  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    res.statusCode = 403;
    res.end();
    return;
  }
  // D-033/D-035: 관리자는 제한 없음. 운영자는 "자기 숙소에 연결된 워처"의 스냅샷만(워처 id 를 명시해야 한다).
  let scope;
  try { scope = await requireScope(req, res, getAuthDb); }
  catch (err) { console.error('[camera] 신원 확인 실패:', err.message); res.statusCode = 503; res.end(); return; }
  if (!scope) return;
  const watcherId = req.query?.watcherId ?? null;
  if (!isAdminScope(scope)) {
    // 이름표(watcherId)만이 아니라, 우리가 실제로 호출할 주소가 "그 숙소를 보고한 워처"와 같아야 한다
    // 값싼 형식 검사를 먼저 — 워처 id 가 없는 요청이 DB·워처 조회까지 가지 않게
    if (typeof watcherId !== 'string' || !watcherId || !operatorMayUseWatcher(scope, await watcherLookup(), watcherId, resolveWatcherUrl)) { res.statusCode = 403; res.end(); return; }
  }
  const WATCHER_URL = resolveWatcherUrl(watcherId);

  if (!WATCHER_URL) {
    res.statusCode = 503;
    res.end();
    return;
  }

  const path = typeof req.query?.path === 'string' ? req.query.path : ''; // 같은 파라미터를 두 번 보내면 배열이 된다
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
    // 로그인한 사람에게만 주는 CCTV 이미지라 공용 캐시에 남기지 않는다(로그아웃·계정 정지·숙소 배정 해제 뒤에도 24시간 남던 문제)
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Vary', 'Cookie');
    res.statusCode = 200;
    res.end(buf);
  } catch {
    res.statusCode = 502;
    res.end();
  }
}
