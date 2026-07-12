#!/usr/bin/env node
/**
 * occupancy-watcher-standalone.mjs
 * Pi 운영용 독립 프로세스. Vite 없이 단독으로 돌린다.
 *
 * 시작:
 *   node scripts/occupancy-watcher-standalone.mjs
 *   pm2 start scripts/occupancy-watcher-standalone.mjs --name propos-watcher
 *
 * HTTP 포트 3001 에서 상태 서빙:
 *   GET  /api/monitoring/state   → 현재 roomState + 이벤트 로그
 *   POST /api/monitoring/config  → 모니터링 설정 업데이트 (브라우저에서 호출)
 *   PUT  /api/monitoring/state   → roomState 수동 덮어쓰기
 */

import http from 'node:http';
import { startWatcher, stopWatcher, getMonitoringState, setMonitoringConfig, setRoomState } from '../server/occupancyWatcher.js';
import { loadProperties, saveProperties } from '../server/propertiesStore.js';

const PORT = Number(process.env.PROPOS_WATCHER_PORT ?? 3001);

// ── HTTP 서버 ─────────────────────────────────────────────────────────────────
function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { sendJson(res, 204, {}); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/api/monitoring/state') {
    sendJson(res, 200, getMonitoringState());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/monitoring/config') {
    const body = await readBody(req);
    setMonitoringConfig(body);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/monitoring/state') {
    const body = await readBody(req);
    if (body.roomState) { setRoomState(body.roomState); }
    sendJson(res, 200, { ok: true });
    return;
  }

  // ── 숙소 설정 (Pi 파일 영구 저장) ─────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/properties') {
    sendJson(res, 200, loadProperties());
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/properties') {
    const body = await readBody(req);
    const list = Array.isArray(body) ? body : [];
    saveProperties(list);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[PROPOS Watcher] HTTP :${PORT}`);
  startWatcher();
});

process.on('SIGTERM', () => { stopWatcher(); server.close(); });
process.on('SIGINT',  () => { stopWatcher(); server.close(); process.exit(0); });
