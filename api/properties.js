/**
 * GET /api/properties  — Pi 워처 메타데이터 반환
 * PUT /api/properties  — Pi 워처 메타데이터 저장
 *
 * 예약·iCal·청소 일정은 Postgres의 /api/cleaning/*가 정본이다.
 * Vercel에서는 PROPOS_WATCHER_URL(Pi 포트 3001)로 워처 메타데이터만 프록시한다.
 * 환경변수 미설정 시 빈 메타데이터 목록을 반환한다. 예약·청소 정본은 Postgres이므로
 * Pi가 잠시 오프라인이어도 운영 화면의 데이터 조회를 실패시키지 않는다.
 */

import { getDemoPropertyConfigs } from '../src/application/demoReportingService.js';
import { DATA_PROFILE, resolveServerDataProfile } from '../src/config/dataProfile.js';

import { guardAdmin, requireScope } from '../server/auth/operatorAuth.js';
import { canAccessProperty, isAdminScope } from '../server/auth/operatorAccounts.js';

import { _setAuthDbForTest, getAuthDb } from '../server/auth/authDb.js';
export { _setAuthDbForTest };
import { resolveWatcherUrl } from '../server/auth/watcherScope.js';

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

  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    if (req.method === 'GET') {
      const properties = getDemoPropertyConfigs().map(property => ({
        id: property.property_id,
        name: property.name,
        checkOutHour: property.checkout_hour,
        cleaningDurationHours: property.cleaning_duration_hours,
        dataOrigin: 'DEMO',
      }));
      return sendJson(res, 200, properties);
    }
    return sendJson(res, 403, { error: 'demo profile is read-only', dataProfile: 'demo' });
  }
  // D-033/D-035: 저장(PUT)은 관리자만. 조회(GET)는 운영자에게도 열되 자기 숙소의 메타데이터(watcherId·기기 목록)만.
  let scope = null;
  if (req.method === 'PUT') {
    if (!guardAdmin(req, res)) return;
  } else {
    try { scope = await requireScope(req, res, getAuthDb); }
    catch (err) { console.error('[properties] 신원 확인 실패:', err.message); return sendJson(res, 503, { error: '잠시 후 다시 시도해주세요' }); }
    if (!scope) return;
  }

  const watcherId = req.query?.watcherId ?? null;
  const WATCHER_URL = resolveWatcherUrl(watcherId);

  if (!WATCHER_URL) {
    if (req.method === 'GET') return sendJson(res, 200, []);
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
    if (req.method === 'GET' && scope && !isAdminScope(scope)) {
      // 운영자에게는 워처의 오류 메시지·다른 숙소 정보를 내려주지 않는다: 자기 숙소 항목만, 배열이 아니면 빈 목록
      const mine = r.ok && Array.isArray(body) ? body.filter((p) => p && canAccessProperty(scope, p.id)) : [];
      return sendJson(res, 200, mine);
    }
    sendJson(res, r.status, body);
  } catch (err) {
    // 운영자에게는 워처 주소가 담길 수 있는 오류 메시지를 내려주지 않는다
    sendJson(res, 502, { error: scope && !isAdminScope(scope) ? '워처에 연결할 수 없어요' : err.message });
  }
}
