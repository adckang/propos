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

import { guardOperator } from '../server/auth/operatorAuth.js';
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
  if (!guardOperator(req, res)) return; // D-033: 숙소 목록·워처 설정

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
    sendJson(res, r.status, body);
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}
