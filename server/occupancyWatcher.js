/**
 * OccupancyWatcher v2 — HA WebSocket 이벤트 구독
 *
 * 시작:  REST로 초기 상태 구성 → WebSocket 연결 + state_changed 구독
 * 평상시: HA push → entityStateMap 업데이트 → debounce 500ms → 상태 머신 처리
 * 끊김:  재연결 → REST 갱신 → 히스토리 재처리 → WebSocket 재구독
 * 캘린더: 1분마다 체크인 시각 비교 → checkin_prep / optimization_finished 발동
 *
 * 실행:
 *   개발: Vite 플러그인 자동 기동 (vite.config.mjs)
 *   운영: pm2 start scripts/occupancy-watcher-standalone.mjs --name propos-watcher
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  callHaService,
  getHaStates,
  renderHaTemplate,
  getHaHistoryFull,
  getHaWsUrl,
  getHaToken,
} from './haProxy.js';
import { executeStateActions } from './deviceActionExecutor.js';
import { OccupancyMonitor } from '../src/application/occupancyMonitor.js';
import {
  getNextRoomState,
  isValidTransition,
  INITIAL_STATE,
} from '../src/domain/room-state/roomStateDomain.js';

const __dir    = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '..', 'data');
const STATE_FILE  = join(DATA_DIR, 'monitoring-state.json');
const CONFIG_FILE = join(DATA_DIR, 'monitoring-config.json');

// ── 공유 상태 ─────────────────────────────────────────────────────────────────
let roomState = INITIAL_STATE;
let config    = null;
const monitor  = new OccupancyMonitor();
const eventLog     = [];
const softEventLog = [];  // checkout_confirmation_needed / early_checkin_suspected / no_show_suspected
let lastError   = null;
let lastEventAt = Date.now(); // 마지막 정상 이벤트 시각 (히스토리 재처리 기준점)

// ── WebSocket 상태 ────────────────────────────────────────────────────────────
let ws             = null;
let reconnectTimer = null;
let reconnectDelay = 1_000; // 재연결 backoff: 1s → 2s → ... → 60s
let msgId          = 0;     // HA WebSocket 메시지 ID (요청마다 증가)

// ── 엔티티 맵 ─────────────────────────────────────────────────────────────────
// entityStateMap: { entityId → HA state 객체 }  (이 숙소 엔티티만)
let entityStateMap = {};
let areaEntityIds  = new Set();

// ── 처리 동기화 ───────────────────────────────────────────────────────────────
let debounceTimer  = null;
let isProcessing   = false;
let pendingProcess = false; // isProcessing 중 새 요청이 왔을 때 플래그
let isReplaying    = false;
let wsEventBuffer  = [];    // 히스토리 재처리 중 WebSocket 이벤트 버퍼

// ── 캘린더 타이머 ─────────────────────────────────────────────────────────────
let calendarTimer = null;

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
    const raw  = readFileSync(STATE_FILE, 'utf8');
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

// ── 스냅샷 빌드 ───────────────────────────────────────────────────────────────
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

function buildSnapshotFromStates(stateMap) {
  const snap = {
    acMode: null, acPower: null, acTemp: null, acHumidity: null,
    smokeDetected: false,
    outdoorTemp: null, outdoorHumidity: null,
    indoorTemps: [], indoorHumidities: [],
    doorOpen: false, motionDetected: false,
    noiseLevel: null,
  };

  for (const [entityId, state] of Object.entries(stateMap)) {
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
        if (OUTDOOR_RE.test(friendly)) snap.outdoorTemp = t;
        else snap.indoorTemps.push({ val: t, label: roomLabel(friendly) });
      }
      continue;
    }
    if (domain === 'sensor' && dc === 'humidity') {
      const h = parseNum(val);
      if (h !== null) {
        if (OUTDOOR_RE.test(friendly)) snap.outdoorHumidity = h;
        else snap.indoorHumidities.push({ val: h, label: roomLabel(friendly) });
      }
      continue;
    }
    if (domain === 'binary_sensor' && dc === 'smoke')        { if (val === 'on') snap.smokeDetected  = true; continue; }
    if (domain === 'binary_sensor' && dc === 'door')         { if (val === 'on') snap.doorOpen       = true; continue; }
    if (domain === 'binary_sensor' && dc === 'motion')       { if (val === 'on') snap.motionDetected = true; continue; }
    if (domain === 'sensor'        && dc === 'sound_pressure') {
      const n = parseNum(val);
      if (n !== null) snap.noiseLevel = snap.noiseLevel === null ? n : Math.max(snap.noiseLevel, n);
      continue;
    }
  }
  return snap;
}

// ── 예약 헬퍼 ─────────────────────────────────────────────────────────────────
function buildReservation() {
  if (!config?.reservation) return null;
  return {
    checkOut: new Date(config.reservation.checkOut),
    ...(config.reservation.checkIn ? { checkIn: new Date(config.reservation.checkIn) } : {}),
  };
}

// ── 알림 ─────────────────────────────────────────────────────────────────────
const SEVERITY_EMOJI = { CRITICAL: '🔴', HIGH: '🟠', WARN: '🟡', default: 'ℹ️' };

async function sendHaNotification(event, newState) {
  const emoji = SEVERITY_EMOJI[event.severity] ?? SEVERITY_EMOJI.default;
  const title = `PROPOS — ${config?.areaName ?? '숙소'} 상태 변경`;
  const msg   = [`${emoji} ${newState.mainStatus} / ${newState.subStatus}`, event.reason].join('\n');
  try {
    await callHaService('persistent_notification', 'create', {
      title, message: msg,
      notification_id: `propos_monitor_${Date.now()}`,
    });
  } catch { /* 알림 실패 무시 */ }
}

// ── Soft 이벤트 (상태 전환 없음, ConfirmationManager 라우팅) ────────────────────
const SOFT_EVENTS = new Set([
  'checkout_confirmation_needed',
  'early_checkin_suspected',
  'no_show_suspected',
]);

async function handleSoftEvent(event) {
  const entry = {
    type:       event.type,
    subType:    event.subType ?? null,
    reason:     event.reason,
    recipients: event.recipients ?? [],
    ts:         Date.now(),
    roomState:  { ...roomState },
  };
  softEventLog.push(entry);
  if (softEventLog.length > 50) softEventLog.shift();
  console.log(`[SoftEvent] ${event.type}/${entry.subType ?? '-'} → [${entry.recipients.join(', ')}] "${event.reason}"`);
}

// ── 상태 전환 적용 ────────────────────────────────────────────────────────────
async function applyTransition(event) {
  if (!isValidTransition(roomState, event.type)) {
    console.log(`[Watcher] 전환 불가 무시: ${event.type} (현재: ${roomState.mainStatus}/${roomState.subStatus})`);
    return;
  }
  const nextState = getNextRoomState(roomState, event.type);
  eventLog.push({ ...event, prevState: roomState, newState: nextState, ts: Date.now() });
  if (eventLog.length > 100) eventLog.shift();
  roomState = nextState;

  console.log(`[Watcher] 상태 전환: ${nextState.mainStatus}/${nextState.subStatus} ← ${event.type}`);

  await sendHaNotification(event, nextState);

  if (config?.devices) {
    const result = await executeStateActions(nextState.mainStatus, config.devices);
    if (result.executed.length)
      console.log(`[Watcher] 기기 제어:`, result.executed.map(e => e.role).join(', '));
    if (result.skipped.length)
      console.warn(`[Watcher] 기기 건너뜀:`, result.skipped.map(s => `${s.role}(${s.reason})`).join(', '));
  }

  persistState();
}

// ── 핵심 처리 ─────────────────────────────────────────────────────────────────
async function processNow(now = Date.now()) {
  if (isProcessing) {
    pendingProcess = true;
    return;
  }
  isProcessing = true;
  try {
    const snap        = buildSnapshotFromStates(entityStateMap);
    const reservation = buildReservation();
    const events      = monitor.process({ snap, roomState, reservation, now });

    for (const event of events) {
      if (SOFT_EVENTS.has(event.type)) {
        await handleSoftEvent(event);
      } else {
        await applyTransition(event);
      }
    }

    lastEventAt = now;
    lastError   = null;
  } catch (err) {
    lastError = err.message;
    console.error('[Watcher] 처리 오류:', err.message);
  } finally {
    isProcessing = false;
    if (pendingProcess) {
      pendingProcess = false;
      setImmediate(() => processNow());
    }
  }
}

// WebSocket 이벤트로 호출 — 500ms debounce 후 processNow
function triggerDebounce() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => processNow(), 500);
}

// ── WebSocket 이벤트 핸들러 ────────────────────────────────────────────────────
function handleStateChanged(entityId, newState) {
  if (!areaEntityIds.has(entityId)) return; // 이 숙소 엔티티가 아니면 무시

  if (isReplaying) {
    // 히스토리 재처리 중: 버퍼에 쌓아두고 나중에 적용
    wsEventBuffer.push({ entityId, newState });
    return;
  }

  entityStateMap[entityId] = newState;
  triggerDebounce();
}

// ── 히스토리 재처리 ───────────────────────────────────────────────────────────
// 끊긴 동안 놓친 이벤트를 HA history API로 가져와 시간 순서대로 재처리
async function replayHistory(sinceMs) {
  if (!areaEntityIds.size) return;

  const sinceIso = new Date(sinceMs).toISOString();
  console.log(`[Watcher] 히스토리 재처리 시작 (since: ${sinceIso})`);

  isReplaying   = true;
  wsEventBuffer = [];

  try {
    const entityIds = [...areaEntityIds];

    // 모든 엔티티의 히스토리를 병렬로 가져옴 (속성 포함)
    const histories = await Promise.all(
      entityIds.map(id => getHaHistoryFull(id, sinceIso).catch(() => []))
    );

    // 시간 순으로 정렬한 단일 스트림으로 합침
    const allEvents = [];
    entityIds.forEach((id, i) => {
      histories[i].forEach(state => {
        const ts = new Date(state.last_changed ?? state.last_updated).getTime();
        allEvents.push({ entityId: id, state, ts });
      });
    });
    allEvents.sort((a, b) => a.ts - b.ts);

    console.log(`[Watcher] 재처리 이벤트: ${allEvents.length}건`);

    // 순서대로 하나씩 처리 (await로 직렬 보장)
    for (const { entityId, state, ts } of allEvents) {
      entityStateMap[entityId] = state;
      await processNow(ts);
    }
  } catch (err) {
    console.error('[Watcher] 히스토리 재처리 오류:', err.message);
  } finally {
    isReplaying = false;

    // 재처리 중 쌓인 WebSocket 이벤트를 entityStateMap에 반영
    for (const { entityId, newState } of wsEventBuffer) {
      entityStateMap[entityId] = newState;
    }
    wsEventBuffer = [];

    // 현재 시점으로 최종 처리
    await processNow(Date.now());
    console.log('[Watcher] 히스토리 재처리 완료');
  }
}

// ── 초기 엔티티 맵 구성 ───────────────────────────────────────────────────────
// initVersion: 빠른 중복 호출 시 가장 최신 결과만 반영 (이전 결과 버림)
let initVersion = 0;

async function initEntityMap() {
  if (!config?.areaName) return;
  const myVersion = ++initVersion;
  try {
    const raw = await renderHaTemplate(`{{ area_entities('${config.areaName}') | list | tojson }}`);
    const ids = JSON.parse(raw);
    if (myVersion !== initVersion) return; // 더 새로운 초기화가 시작됐으면 버림

    if (!Array.isArray(ids) || !ids.length) {
      console.warn(`[Watcher] area '${config.areaName}' 엔티티 없음`);
      return;
    }

    const states = await getHaStates(ids);
    if (myVersion !== initVersion) return; // 상태 fetch 중 또 새 초기화가 시작됐으면 버림

    areaEntityIds  = new Set(ids);
    entityStateMap = {};
    for (const [id, state] of Object.entries(states)) {
      if (state) entityStateMap[id] = state;
    }
    console.log(`[Watcher] 엔티티 맵 초기화: ${Object.keys(entityStateMap).length}개`);
  } catch (err) {
    console.error('[Watcher] 엔티티 맵 초기화 오류:', err.message);
    lastError = err.message;
  }
}

// ── 캘린더 이벤트 (1분 인터벌) ───────────────────────────────────────────────
async function checkCalendarEvents() {
  if (isProcessing) return; // processNow 실행 중이면 다음 인터벌에 재시도

  const checkIn = config?.reservation?.checkIn
    ? new Date(config.reservation.checkIn).getTime()
    : null;

  if (!checkIn || checkIn <= Date.now()) return; // 없거나 이미 지난 체크인은 무시

  const msUntil = checkIn - Date.now();

  // 체크인 1시간 전 → PRE_STAY_READY/OPTIMIZING 진입
  if (msUntil <= 3_600_000 && isValidTransition(roomState, 'checkin_prep_time_reached')) {
    console.log('[Watcher] 캘린더: checkin_prep_time_reached');
    await applyTransition({ type: 'checkin_prep_time_reached', reason: '체크인 1시간 전' });
  }

  // 체크인 30분 전 → PRE_STAY_READY/OPTIMIZED 진입
  if (msUntil <= 1_800_000 && isValidTransition(roomState, 'optimization_finished')) {
    console.log('[Watcher] 캘린더: optimization_finished');
    await applyTransition({ type: 'optimization_finished', reason: '체크인 30분 전' });
  }
}

// ── WebSocket 연결 ────────────────────────────────────────────────────────────
function connectWebSocket() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  const url = getHaWsUrl();
  console.log(`[Watcher] WebSocket 연결: ${url}`);

  ws = new WebSocket(url);

  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    // 인증 요청 → 토큰 전송
    if (msg.type === 'auth_required') {
      ws.send(JSON.stringify({ type: 'auth', access_token: getHaToken() }));
      return;
    }

    // 인증 성공 → state_changed 구독
    if (msg.type === 'auth_ok') {
      console.log('[Watcher] HA 인증 완료. state_changed 구독 시작');
      reconnectDelay = 1_000; // 성공 시 backoff 리셋
      ws.send(JSON.stringify({ id: ++msgId, type: 'subscribe_events', event_type: 'state_changed' }));
      return;
    }

    // 인증 실패
    if (msg.type === 'auth_invalid') {
      console.error('[Watcher] HA 토큰 인증 실패. 토큰을 확인하세요.');
      lastError = 'HA 토큰 인증 실패';
      return;
    }

    // 센서 상태 변경 이벤트
    if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const { entity_id, new_state } = msg.event.data ?? {};
      if (entity_id && new_state) handleStateChanged(entity_id, new_state);
    }
  });

  ws.addEventListener('open', () => {
    console.log('[Watcher] WebSocket 연결됨');
  });

  ws.addEventListener('close', (event) => {
    ws = null;
    console.warn(`[Watcher] WebSocket 끊김 (code: ${event.code}). ${reconnectDelay / 1000}초 후 재연결`);
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    lastError = 'WebSocket 연결 오류';
    console.error('[Watcher] WebSocket 오류 발생');
  });
}

// ── 재연결 (backoff) ──────────────────────────────────────────────────────────
function scheduleReconnect() {
  if (reconnectTimer) return;

  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 60_000);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    const disconnectedAt = lastEventAt;

    // 초기 상태 재갱신
    await initEntityMap();

    // 끊긴 동안 놓친 이벤트 재처리
    await replayHistory(disconnectedAt);

    // WebSocket 재연결
    connectWebSocket();
  }, delay);
}

// ── 공개 API ─────────────────────────────────────────────────────────────────
export function getMonitoringState() {
  return {
    roomState,
    eventLog:      eventLog.slice(-20),
    softEventLog:  softEventLog.slice(-20),
    config:      config ? { areaName: config.areaName } : null,
    wsConnected: ws?.readyState === WebSocket.OPEN,
    isReplaying,
    lastPollAt:  lastEventAt, // 하위 호환 유지
    lastEventAt,
    lastError,
  };
}

export function setMonitoringConfig(cfg) {
  const prevCheckIn = config?.reservation?.checkIn ?? null;
  config = cfg;
  persistConfig(cfg);

  // 예약 취소 감지: 이전에 checkIn이 있었는데 이제 없어진 경우
  const newCheckIn = cfg?.reservation?.checkIn ?? null;
  if (prevCheckIn !== null && newCheckIn === null) {
    if (roomState.mainStatus === 'PRE_STAY_READY') {
      // RSM 설계: PRE_STAY_READY에서 예약 취소 → 비즈니스 레이어가 INITIAL_STATE 직접 복귀
      console.log('[Watcher] 예약 취소 → PRE_STAY_READY에서 INITIAL_STATE 직접 복귀');
      roomState = INITIAL_STATE;
      persistState();
    } else if (isValidTransition(roomState, 'reservation_cancelled')) {
      // VACANT/CLEANING_FINISHED 자기전환 (상태 유지, 이벤트 로그 기록)
      applyTransition({ type: 'reservation_cancelled', reason: '캘린더 예약 취소 감지' })
        .catch(() => {});
    }
  }

  // 새 config에 checkIn이 있을 수 있으므로 즉시 캘린더 체크
  checkCalendarEvents().catch(() => {});
  // areaName이 바뀔 수 있으므로 엔티티 맵 재초기화
  initEntityMap()
    .then(() => processNow(Date.now()))
    .catch(err => console.error('[Watcher] config 업데이트 후 초기화 오류:', err.message));
}

export function setRoomState(newState) {
  roomState = newState;
  persistState();
}

export function startWatcher() {
  // calendarTimer 가 동기적으로 즉시 설정되므로 중복 호출 방지의 핵심 가드다.
  // ws / reconnectTimer 는 비동기 초기화 이후에 설정되므로 재시작 감지용 보조 조건.
  if (ws || reconnectTimer || calendarTimer) return;

  roomState = loadPersistedState();
  config    = loadPersistedConfig();
  console.log('[Watcher] 시작');

  // 비동기 초기화 (fire-and-forget)
  (async () => {
    await initEntityMap();
    await processNow(Date.now()); // 초기 스냅샷으로 한 번 처리
    connectWebSocket();
  })().catch(err => {
    console.error('[Watcher] 초기화 오류:', err.message);
    lastError = err.message;
    scheduleReconnect(); // 실패 시 재시도
  });

  // 캘린더 이벤트: 시작 즉시 + 1분마다
  checkCalendarEvents().catch(() => {});
  calendarTimer = setInterval(() => checkCalendarEvents().catch(() => {}), 60_000);
}

export function stopWatcher() {
  ws?.close();
  ws = null;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (calendarTimer)  { clearInterval(calendarTimer);  calendarTimer  = null; }
  if (debounceTimer)  { clearTimeout(debounceTimer);   debounceTimer  = null; }
  console.log('[Watcher] 중지');
}
