/**
 * OccupancyWatcher — 서버 사이드 체류 모니터링
 *
 * 동작 방식:
 *   - startWatcher() 호출 → 30초 폴링 시작
 *   - HA Area 엔티티 조회 → 스냅샷 빌드 → OccupancyMonitor.process()
 *   - 상태 전환 발생 시 HA persistent_notification 발송 + 파일 퍼시스트
 *   - 브라우저 닫혀도 Node.js 프로세스가 살아있으면 계속 동작
 *
 * 실행 방법:
 *   개발: Vite 플러그인이 자동 시작 (vite.config.mjs)
 *   운영: pm2 start scripts/occupancy-watcher-standalone.mjs --name propos-watcher
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { callHaService, getHaStates, renderHaTemplate } from './haProxy.js';
import { OccupancyMonitor } from '../src/application/occupancyMonitor.js';
import { getNextRoomState, isValidTransition, INITIAL_STATE } from '../src/domain/room-state/roomStateDomain.js';

const __dir   = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '..', 'data');
const STATE_FILE  = join(DATA_DIR, 'monitoring-state.json');
const CONFIG_FILE = join(DATA_DIR, 'monitoring-config.json');

const POLL_MS = 30_000;

// ── 공유 상태 (모듈 싱글턴) ─────────────────────────────────────────────────
let roomState   = INITIAL_STATE;
let config      = null;  // { areaName, reservation: { checkOut: ISO string } }
const monitor   = new OccupancyMonitor();
const eventLog  = [];    // 최대 100건 보관
let watcherTimer = null;
let lastPollAt   = null;
let lastError    = null;

// ── 퍼시스트 ─────────────────────────────────────────────────────────────────
function ensureDataDir() {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ok */ }
}

function persistState() {
  ensureDataDir();
  const payload = { roomState, eventLog: eventLog.slice(-100), updatedAt: Date.now() };
  try { writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2)); } catch { /* ignore */ }
}

function loadPersistedState() {
  try {
    const raw = readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data.roomState ?? INITIAL_STATE;
  } catch { return INITIAL_STATE; }
}

function loadPersistedConfig() {
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

function persistConfig(cfg) {
  ensureDataDir();
  try { writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch { /* ignore */ }
}

// ── HA 스냅샷 빌드 ────────────────────────────────────────────────────────────
function parseNum(s) {
  if (s == null || s === 'unavailable' || s === 'unknown' || s === '') return null;
  const n = Number.parseFloat(String(s));
  return Number.isNaN(n) ? null : n;
}

function roomLabel(friendly) {
  return friendly
    .replace(/\s*T\s*&\s*H.*/i, '')
    .replace(/\s*온습도.*/i, '')
    .replace(/\s*(Temperature|Humidity|Power).*$/i, '')
    .trim();
}

const OUTDOOR_RE = /현재|실외|외부|outdoor/i;

function buildSnapshotFromStates(states) {
  const snap = {
    acMode: null, acPower: null, acTemp: null, acHumidity: null,
    smokeDetected: false,
    outdoorTemp: null, outdoorHumidity: null,
    indoorTemps: [], indoorHumidities: [],
    doorOpen: false, motionDetected: false,
    noiseLevel: null,
  };

  for (const [entityId, state] of Object.entries(states)) {
    if (!state) continue;
    const domain   = entityId.split('.')[0];
    const dc       = state.attributes?.device_class ?? '';
    const friendly = state.attributes?.friendly_name || entityId;
    const val      = state.state;

    if (domain === 'climate') {
      snap.acMode     = val;
      snap.acTemp     = parseNum(state.attributes?.current_temperature);
      snap.acHumidity = parseNum(state.attributes?.current_humidity);
      continue;
    }

    if (domain === 'sensor' && dc === 'power') {
      const p = parseNum(val);
      if (p !== null) snap.acPower = (snap.acPower ?? 0) + p;
      continue;
    }

    if (domain === 'sensor' && dc === 'temperature') {
      const t = parseNum(val);
      if (t !== null) {
        if (OUTDOOR_RE.test(friendly)) { snap.outdoorTemp = t; }
        else snap.indoorTemps.push({ val: t, label: roomLabel(friendly) });
      }
      continue;
    }

    if (domain === 'sensor' && dc === 'humidity') {
      const h = parseNum(val);
      if (h !== null) {
        if (OUTDOOR_RE.test(friendly)) { snap.outdoorHumidity = h; }
        else snap.indoorHumidities.push({ val: h, label: roomLabel(friendly) });
      }
      continue;
    }

    if (domain === 'binary_sensor' && dc === 'smoke')  { if (val === 'on') snap.smokeDetected  = true; continue; }
    if (domain === 'binary_sensor' && dc === 'door')   { if (val === 'on') snap.doorOpen       = true; continue; }
    if (domain === 'binary_sensor' && dc === 'motion') { if (val === 'on') snap.motionDetected = true; continue; }

    if (domain === 'sensor' && dc === 'sound_pressure') {
      const n = parseNum(val);
      if (n !== null) snap.noiseLevel = snap.noiseLevel === null ? n : Math.max(snap.noiseLevel, n);
      continue;
    }
  }

  return snap;
}

async function fetchSnapshot(areaName) {
  const raw = await renderHaTemplate(`{{ area_entities('${areaName}') | list | tojson }}`);
  let entityIds;
  try { entityIds = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(entityIds) || !entityIds.length) return null;

  const states = await getHaStates(entityIds);
  return buildSnapshotFromStates(states);
}

// ── 알림 ────────────────────────────────────────────────────────────────────
const SEVERITY_EMOJI = { CRITICAL: '🔴', HIGH: '🟠', WARN: '🟡', default: 'ℹ️' };

async function sendHaNotification(event, newState) {
  const emoji = SEVERITY_EMOJI[event.severity] ?? SEVERITY_EMOJI.default;
  const title = `PROPOS — ${config?.areaName ?? '숙소'} 상태 변경`;
  const msg = [
    `${emoji} ${newState.mainStatus} / ${newState.subStatus}`,
    event.reason,
  ].join('\n');

  try {
    await callHaService('persistent_notification', 'create', {
      title,
      message: msg,
      notification_id: `propos_monitor_${Date.now()}`,
    });
  } catch { /* 알림 실패는 무시 */ }
}

// ── 폴링 사이클 ─────────────────────────────────────────────────────────────
async function pollCycle() {
  if (!config?.areaName) return;

  try {
    const snap = await fetchSnapshot(config.areaName);
    if (!snap) return;

    const reservation = config.reservation
      ? { checkOut: new Date(config.reservation.checkOut) }
      : null;
    const now    = Date.now();
    const events = monitor.process({ snap, roomState, reservation, now });

    let changed = false;
    for (const event of events) {
      if (isValidTransition(roomState, event.type)) {
        const nextState = getNextRoomState(roomState, event.type);
        eventLog.push({ ...event, prevState: roomState, newState: nextState });
        if (eventLog.length > 100) eventLog.shift();
        roomState = nextState;
        changed   = true;
        await sendHaNotification(event, nextState);
      }
    }

    if (changed) persistState();
    lastPollAt = now;
    lastError  = null;
  } catch (err) {
    lastError = err.message;
    console.error('[OccupancyWatcher] poll error:', err.message);
  }
}

// ── 공개 API ─────────────────────────────────────────────────────────────────
export function getMonitoringState() {
  return {
    roomState,
    eventLog: eventLog.slice(-20),
    config: config ? { areaName: config.areaName } : null,
    lastPollAt,
    lastError,
  };
}

export function setMonitoringConfig(cfg) {
  config = cfg;
  persistConfig(cfg);
}

export function setRoomState(newState) {
  roomState = newState;
  persistState();
}

export function startWatcher() {
  if (watcherTimer) return;
  roomState = loadPersistedState();
  config    = loadPersistedConfig();
  console.log('[OccupancyWatcher] started — polling every 30s');
  pollCycle();
  watcherTimer = setInterval(pollCycle, POLL_MS);
}

export function stopWatcher() {
  clearInterval(watcherTimer);
  watcherTimer = null;
  console.log('[OccupancyWatcher] stopped');
}
