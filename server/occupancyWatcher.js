/**
 * OccupancyWatcher v2 — HA WebSocket 이벤트 구독
 *
 * 시작:  REST로 초기 상태 구성 → WebSocket 연결 + state_changed 구독
 * 평상시: HA push → entityStateMap 업데이트 → debounce 500ms → 상태 머신 처리
 * 끊김:  재연결 → REST 갱신 → 히스토리 재처리 → WebSocket 재구독
 * 입실 준비: 30초마다 예약·센서·장치 확인 → 센서 목표 유지 시에만 완료
 *
 * 실행:
 *   숙소별 Pi: pm2 start scripts/occupancy-watcher-standalone.mjs --name propos-watcher
 *   로컬·운영 웹 화면은 운영 API를 통해 같은 Pi에 연결하며 워처를 기동하지 않는다.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  callHaService,
  getHaStates,
  renderHaTemplate,
  getHaHistoryFull,
  getHaWsUrl,
  getHaToken,
} from './haProxy.js';
import { executeStateActions } from './deviceActionExecutor.js';
import { PreStayOptimizationController } from '../src/application/preStayOptimizationController.js';
import { PREPARATION_POLICY } from '../src/domain/preStayOptimizationDomain.js';
import { getPreparationWeather, alertPreparationFailure, checkOperatorChannel, getPreparationAreaEntities } from './preparationAdapters.js';
import { OccupancyMonitor } from '../src/application/occupancyMonitor.js';
import {
  getNextRoomState,
  isValidTransition,
  INITIAL_STATE,
} from '../src/domain/room-state/roomStateDomain.js';
import { planMonitoringReservationUpdate } from '../src/domain/monitoringReservationDomain.js';
import {
  DEVICE_OFFLINE_ANOMALY_EVENT_TYPES,
  NOISE_ANOMALY_EVENT_TYPES,
  VACANT_ENERGY_SIGNAL_EVENT_TYPES,
} from '../src/config/eventTypes.js';
import { duePrechecks, handoffAlertMessage, latestPresenceEvidence, offDetectionSensors, offEntryDetectionSensors,
  precheckAlertMessage, precheckEventTime, upcomingTimes } from '../src/domain/sensorHealthDomain.js';
import { buildDeviceAvailability } from '../src/domain/deviceMaintenanceDomain.js';

const __dir    = dirname(fileURLToPath(import.meta.url));
// 테스트는 PROPOS_DATA_DIR 로 임시 폴더를 지정해 실제 운영 기록(data/)을 덮어쓰지 않는다
const DATA_DIR = process.env.PROPOS_DATA_DIR || join(__dir, '..', 'data');
const STATE_FILE        = join(DATA_DIR, 'monitoring-state.json');
const CONFIG_FILE       = join(DATA_DIR, 'monitoring-config.json');
const SNAPSHOT_LOG_FILE = join(DATA_DIR, 'snapshotLog.json');

// Vercel 이벤트 리포트 설정
const VERCEL_URL              = 'https://proposonline.com';
const PI_SECRET               = process.env.PROPOS_PI_SECRET ?? null;

// 스냅샷 파일 보관 기간 (10일)
const HA_SNAPSHOT_DIR         = '/config/www/snapshots';
const SNAPSHOT_RETENTION_MS   = 10 * 24 * 60 * 60 * 1000;
const SNAPSHOT_LOG_MAX        = 200;

// ── 공유 상태 ─────────────────────────────────────────────────────────────────
let roomState = INITIAL_STATE;
let config    = null;
const monitor  = new OccupancyMonitor();
const eventLog     = [];
const softEventLog = [];  // 상태를 바꾸지 않는 기록: soft 이벤트(checkout_confirmation_needed / early_checkin_suspected / sensor_precheck_failed) + 문제 이벤트(퇴실 지연·입실 미감지·확인 불가)
const snapshotLog  = [];  // { path, ts, roomState } — CCTV 출입 스냅샷
let preparationOutbox = [];
let eventDeliveryRejected = [];
let flushingPreparationOutbox = false;
let statePersistenceFailed = false;
let lastWaitPersistAt = 0;
const WAIT_PERSIST_MS = 2 * 60_000;
let sensorPrechecks = {}; // DEC-12: 이미 한 감지 센서 사전 점검 { '단계|시각|몇 시간 전': 그 시각 } — 재시작해도 같은 점검을 두 번 하지 않게 저장한다
let lastError   = null;
let lastEventAt = Date.now(); // 마지막 정상 이벤트 시각 (히스토리 재처리 기준점)
let snapshotCleanupTimer = null;

// HA input_text 헬퍼 엔티티 ID — propos.public.json entities.cctvSnapshotInput에서 읽음
function loadSnapshotEntity() {
  try {
    const raw = readFileSync(join(__dir, '..', 'src', 'config', 'propos.public.json'), 'utf8');
    return JSON.parse(raw).entities?.cctvSnapshotInput ?? null;
  } catch { return null; }
}
const SNAPSHOT_INPUT_ENTITY = loadSnapshotEntity();

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
let pendingConfig  = null;
const pendingManualEvents = [];
let preparationShuttingDown = false;

// ── 캘린더 타이머 ─────────────────────────────────────────────────────────────
let calendarTimer = null;
let watcherStopped = true;
let watcherGeneration = 0;

const preparation = new PreStayOptimizationController({
  getStates: ids => getHaStates(ids, { signal: AbortSignal.timeout(PREPARATION_POLICY.requestTimeoutMs) }),
  callService: (domain, service, data) => callHaService(domain, service, data, { signal: AbortSignal.timeout(PREPARATION_POLICY.requestTimeoutMs) }),
  getWeather: getPreparationWeather,
  createId: randomUUID,
  now: () => Date.now(),
  save: () => persistState(),
  alert: alertPreparationFailure,
  checkOperatorChannel,
  getAllowedEntities: getPreparationAreaEntities,
  afterPreflight: (cfg, allowed) => {
    if (!cfg.devices || !Array.isArray(allowed)) return;
    const devices = Object.fromEntries(Object.entries(cfg.devices).map(([role, value]) => [role,
      (Array.isArray(value) ? value : [value]).filter(entity => allowed.includes(entity))]));
    return executeStateActions('PRE_STAY_READY', devices, { skipRoles: ['AC_MAIN'] });
  },
  emit: async (type, data) => {
    const event = { type, data, reason: data.reason ?? '센서 기반 입실 준비' };
    if ((!data.propertyId || data.propertyId === config?.areaName) && isValidTransition(roomState, type)) await applyTransition(event);
    else {
      eventLog.push({ ...event, prevState: { ...roomState }, newState: { ...roomState }, ts: Date.now() });
      if (eventLog.length > 100) eventLog.shift();
      reportEventToVercel(type, false, data).catch(() => {});
      persistState();
    }
  },
});

// ── 퍼시스트 ─────────────────────────────────────────────────────────────────
function ensureDataDir() {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ok */ }
}

function persistState() {
  ensureDataDir();
  const payload = { roomState, eventLog: eventLog.slice(-100), preparation: preparation.snapshot(), preparationOutbox, eventDeliveryRejected,
    sensorPrechecks, monitor: monitor.snapshot(), updatedAt: Date.now() };
  try {
    writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(payload, null, 2));
    renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
    monitor.markPersisted();
    statePersistenceFailed = false;
    return true;
  } catch { statePersistenceFailed = true; return false; }
}

function loadPersistedState() {
  try {
    const raw  = readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    preparationOutbox = Array.isArray(data.preparationOutbox) ? data.preparationOutbox : [];
    eventDeliveryRejected = Array.isArray(data.eventDeliveryRejected) ? data.eventDeliveryRejected : [];
    sensorPrechecks = data.sensorPrechecks && typeof data.sensorPrechecks === 'object' && !Array.isArray(data.sensorPrechecks) ? data.sensorPrechecks : {};
    monitor.restore(data.monitor);
    preparation.restore(data.preparation);
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

function persistSnapshotLog() {
  ensureDataDir();
  try { writeFileSync(SNAPSHOT_LOG_FILE, JSON.stringify(snapshotLog, null, 2)); } catch { /* ignore */ }
}

function loadSnapshotLog() {
  try {
    const raw = readFileSync(SNAPSHOT_LOG_FILE, 'utf8');
    const saved = JSON.parse(raw);
    if (Array.isArray(saved)) snapshotLog.push(...saved.slice(-SNAPSHOT_LOG_MAX));
  } catch { /* 파일 없으면 빈 배열 유지 */ }
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

function buildSnapshotFromStates(stateMap, now = Date.now()) {
  const snap = {
    acMode: null, acPower: null, acTemp: null, acHumidity: null,
    smokeDetected: false,
    outdoorTemp: null, outdoorHumidity: null,
    indoorTemps: [], indoorHumidities: [],
    doorOpen: false, motionDetected: false,
    presenceEvidence: null,
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
  snap.presenceEvidence = latestPresenceEvidence(stateMap, now);
  return snap;
}

// 공실 절전 액션의 대상과 같은 매핑만 본다. 전체 전력에는 냉장고 같은 상시
// 부하가 섞일 수 있으므로 임의의 W 기준으로 빈방 낭비를 만들지 않는다.
function buildVacantEnergySources(stateMap, deviceMap) {
  if (!deviceMap || typeof deviceMap !== 'object') return null;
  const mapped = Object.entries(deviceMap)
    .filter(([role]) => role !== 'LOCK_ENTRANCE')
    .flatMap(([role, value]) => (Array.isArray(value) ? value : [value])
      .filter(entityId => typeof entityId === 'string' && entityId.trim())
      .map(entityId => ({ role, entityId })));
  if (!mapped.length) return null;

  const active = [];
  let unknown = false;
  for (const { role, entityId } of mapped) {
    const state = stateMap[entityId];
    const value = state?.state;
    if (!state || value == null || ['unavailable', 'unknown'].includes(value)) {
      unknown = true;
      continue;
    }
    if (!['off', 'standby'].includes(value)) {
      active.push(state.attributes?.friendly_name || role);
    }
  }
  if (active.length) return [...new Set(active)].sort();
  return unknown ? null : [];
}

// ── 예약 헬퍼 ─────────────────────────────────────────────────────────────────
function buildReservation() {
  if (!config?.reservation) return null;
  return {
    uid: config.reservation.uid ?? null,
    ...(config.reservation.stayId ? { stayId: config.reservation.stayId } : {}),
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
    }, { signal: AbortSignal.timeout(PREPARATION_POLICY.requestTimeoutMs) });
  } catch { /* 알림 실패 무시 */ }
}

// 운영자 알림 (DEC-11·16) — HA 알림창 + 숙소에 설정된 운영자 휴대폰 알림(notify.*, 입실 준비 알림과 같은 설정).
// Slack은 Vercel이 이 기록을 처음 저장할 때 보낸다(Pi에는 Slack 주소가 없다). 놓친 기록을 다시 처리하는 중엔 보내지 않는다 —
// 그 기록의 Slack은 서버가 처음 저장할 때 한 번 간다. 실패해도 감시를 멈추지 않는다.
const haOptions = () => ({ signal: AbortSignal.timeout(PREPARATION_POLICY.requestTimeoutMs) });
async function sendOperatorAlert({ title, message, notificationId }) {
  if (isReplaying) return;
  const service = config?.optimization?.operatorNotifyService;
  await Promise.allSettled([
    callHaService('persistent_notification', 'create', { title, message, notification_id: notificationId }, haOptions()),
    /^notify\.[a-z0-9_]+$/.test(service ?? '')
      ? callHaService('notify', service.slice('notify.'.length), { title, message }, haOptions())
      : Promise.resolve(),
  ]);
}

// ── Soft 이벤트 (상태 전환 없음, ConfirmationManager 라우팅) ────────────────────
const SOFT_EVENTS = new Set([
  'checkout_confirmation_needed',
  'early_checkin_suspected',
]);
// 스케줄 안에서 기대한 일이 확인되지 않음 — 상태는 그대로, 운영자에게 넘긴다(DEC-10·11)
const PROBLEM_EVENTS = new Set(['late_checkout_detected', 'checkin_not_detected', 'detection_unconfirmable', 'cleaning_not_detected']);
// 전환 뒤 확인 — 그 순간의 기기 제어만 한다(상태 전환 없음, 서버 기록 없음)
const CONFIRMATION_EVENTS = new Set(['checkout_confirmed', 'checkin_confirmed', 'cleaning_vacant_confirmed']);
// 실제 청소 시작·끝 — 상태를 바꾸지 않고 기록만(청소시간 준수 지표, DEC-17)
const OBSERVATION_EVENTS = new Set(['cleaning_activity_started', 'cleaning_activity_finished']);

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

  reportEventToVercel(event.type, true, {
    ...event.data,
    subType: event.subType ?? null,
    reason: event.reason ?? null,
  }, event.timestamp).catch(() => {});

  console.log(`[SoftEvent] ${event.type}/${entry.subType ?? '-'} → [${entry.recipients.join(', ')}] "${event.reason}"`);
}

// 운영 문제 기록 — 객실 상태는 바꾸지 않는다(DEC-08). 전송 대기열에 넣는 것까지는 즉시 끝나므로
// 다른 이벤트처럼 전송 완료를 기다리지 않는다(느린 네트워크가 같은 주기의 상태 전환을 늦추지 않게).
// 전환 기록(eventLog)이 아니라 상태를 바꾸지 않는 기록(softEventLog)에 남긴다 — 화면은 eventLog 마지막 줄을 "마지막 전환"으로 보여준다.
function handleProblemEvent(event) {
  softEventLog.push({ type: event.type, subType: null, reason: event.reason, recipients: [], ts: Date.now(), roomState: { ...roomState } });
  if (softEventLog.length > 50) softEventLog.shift();
  reportEventToVercel(event.type, false, { ...event.data, reason: event.reason ?? null }, event.timestamp).catch(() => {});
  console.warn(`[ProblemEvent] ${event.type} — ${event.reason}`);
  const alert = handoffAlertMessage(config?.areaName, event);
  if (alert) sendOperatorAlert({ ...alert, notificationId: `propos_${event.type}_${event.data?.phase ?? ''}_${event.timestamp}` }).catch(() => {});
}

// 실제 청소 시각 기록 — 상태는 그대로, 서버에 보낸다(전환 기록이 아니라 상태를 바꾸지 않는 기록에 남긴다)
function handleObservation(event) {
  softEventLog.push({ type: event.type, subType: null, reason: event.reason, recipients: [], ts: Date.now(), roomState: { ...roomState } });
  if (softEventLog.length > 50) softEventLog.shift();
  reportEventToVercel(event.type, false, { ...event.data, reason: event.reason ?? null }, event.timestamp).catch(() => {});
  console.log(`[Observation] ${event.type} — ${event.reason}`);
}

// RF-25 정본 이상 신호 — 객실 상태는 바꾸지 않고 서버의 이상 생명주기에만 전달한다.
function handleAnomalySignal(event) {
  softEventLog.push({ type: event.type, subType: null, reason: event.reason, recipients: [], ts: Date.now(), roomState: { ...roomState } });
  if (softEventLog.length > 50) softEventLog.shift();
  reportEventToVercel(event.type, false, { ...event.data, reason: event.reason ?? null }, event.timestamp).catch(() => {});
  console.log(`[AnomalySignal] ${event.type} — ${event.reason}`);
}

async function runStateActions(mainStatus) {
  if (!config?.devices) return;
  // Environmental preparation has one owner. Arriving guests never get the legacy fixed cooling command.
  const skipRoles = ['PRE_STAY_READY', 'OCCUPIED'].includes(mainStatus) ? ['AC_MAIN'] : [];
  const result = await executeStateActions(mainStatus, config.devices, { skipRoles });
  if (result.executed.length)
    console.log(`[Watcher] 기기 제어:`, result.executed.map(e => e.role).join(', '));
  if (result.skipped.length)
    console.warn(`[Watcher] 기기 건너뜀:`, result.skipped.map(s => `${s.role}(${s.reason})`).join(', '));
}

// 전환 뒤에 퇴실·입실이 확인되면 그때 기기 제어를 자동으로 한다(DEC-11). 그사이 상태가 바뀌었으면(청소 시작·퇴실 등) 하지 않는다.
async function applyConfirmation(event) {
  if (event.type === 'checkout_confirmed') {
    if (roomState.mainStatus !== 'CLEANING' || roomState.subStatus !== 'CLEANING_PENDING') return;
    await runStateActions('CLEANING');
  } else if (event.type === 'checkin_confirmed') {
    if (roomState.mainStatus !== 'OCCUPIED') return;
    await preparation.onLifecycleEvent('check_in_detected', { config, now: Date.now() });
    await runStateActions('OCCUPIED');
  } else if (event.type === 'cleaning_vacant_confirmed') {
    if (roomState.mainStatus !== 'VACANT' || roomState.subStatus !== 'CLEANING_FINISHED') return;
    await runStateActions('VACANT');
  }
  eventLog.push({ ...event, prevState: { ...roomState }, newState: { ...roomState }, ts: Date.now() });
  if (eventLog.length > 100) eventLog.shift();
  console.log(`[Watcher] ${event.reason}`);
  persistState();
}

// RF-29: 체류 중 퇴실 전환 전에 도착해 대기시킨 예약(null = 예약 없음)을 전환이 끝난 뒤 쓴다.
function promotePendingReservation() {
  if (!config || !Object.hasOwn(config, 'pendingReservation') || roomState.mainStatus === 'OCCUPIED') return;
  const { pendingReservation, ...rest } = config;
  config = { ...rest, reservation: pendingReservation };
  persistConfig(config);
}

// DEC-12: 퇴실·입실 하루 전·2시간 전에 감지 센서를 미리 점검한다 — 꺼져 있으면 운영자에게 알린다(Slack + HA 앱).
// 문제가 아니라 미리 알림이라 상태도 문제 건수도 바꾸지 않는다. 같은 점검은 한 번만(저장한다).
function runSensorPrechecks(now) {
  if (isReplaying || Object.keys(entityStateMap).length === 0) return;
  const times = upcomingTimes([config?.reservation, config?.pendingReservation], now);
  const { due, done } = duePrechecks({ times, done: sensorPrechecks, now });
  const changed = JSON.stringify(done) !== JSON.stringify(sensorPrechecks);
  sensorPrechecks = done;
  if (changed) persistState();
  if (!due.length) return;
  for (const check of due) {
    const off = check.phase === 'checkin'
      ? offEntryDetectionSensors(entityStateMap)
      : offDetectionSensors(entityStateMap);
    if (!off.length) continue;
    const reason = `${check.phase === 'checkout' ? '퇴실' : '입실'} ${check.offsetLabel} 감지 센서 점검 — 꺼짐: ${off.map(s => s.name).join(', ')}`;
    const data = { phase: check.phase, at: new Date(check.at).toISOString(), offset: check.key.split('|').pop(),
      sensors: off.map(s => ({ entityId: s.entityId, roleLabel: s.roleLabel, name: s.name })) };
    softEventLog.push({ type: 'sensor_precheck_failed', subType: null, reason, recipients: [], ts: now, roomState: { ...roomState } });
    if (softEventLog.length > 50) softEventLog.shift();
    reportEventToVercel('sensor_precheck_failed', true, { ...data, reason }, precheckEventTime(check)).catch(() => {});
    console.warn(`[SensorPrecheck] ${reason}`);
    sendOperatorAlert({ ...precheckAlertMessage(config?.areaName, check, off), notificationId: `propos_sensor_precheck_${check.key}` }).catch(() => {});
  }
}

// ── 상태 전환 적용 ────────────────────────────────────────────────────────────
async function applyTransition(event) {
  if (!isValidTransition(roomState, event.type)) {
    console.log(`[Watcher] 전환 불가 무시: ${event.type} (현재: ${roomState.mainStatus}/${roomState.subStatus})`);
    return;
  }
  const nextState = getNextRoomState(roomState, event.type);
  await preparation.onLifecycleEvent(event.type, { config, now: Date.now() });
  const entry = { ...event, prevState: roomState, newState: nextState, ts: Date.now() };
  eventLog.push(entry);
  if (eventLog.length > 100) eventLog.shift();
  roomState = nextState;

  reportEventToVercel(event.type, false, {
    ...event.data,
    prevState: entry.prevState,
    newState:  nextState,
    reason:    event.reason ?? null,
  }, event.timestamp).catch(() => {});

  console.log(`[Watcher] 상태 전환: ${nextState.mainStatus}/${nextState.subStatus} ← ${event.type}`);

  await sendHaNotification(event, nextState);

  // 예정 시각 전환은 퇴실·입실이 확인됐을 때만 그 기기 제어를 한다 — 확인되지 않으면 확인될 때(applyConfirmation)까지
  // 기다리고, 끝내 확인되지 않으면 문제와 함께 운영자에게 넘긴다(DEC-11)
  // 청소 일정 시작은 기기 제어를 하지 않는다(청소 모드는 퇴실 때 정한다). 끝은 담당자가 나간 것을 봤을 때만 공실 기기 제어(잠금 포함)
  const unconfirmedSchedule = (event.type === 'scheduled_checkout_reached' && !event.data?.exitConfirmed)
    || (event.type === 'scheduled_checkin_reached' && !event.data?.entryConfirmed)
    || event.type === 'scheduled_cleaning_started'
    || (event.type === 'scheduled_cleaning_finished' && !event.data?.vacantConfirmed);
  if (event.type === 'scheduled_checkin_reached' && event.data?.entryConfirmed) {
    await preparation.onLifecycleEvent('check_in_detected', { config, now: Date.now() });
  }
  if (nextState.mainStatus !== 'PRE_STAY_READY' && event.type !== 'optimization_cancelled' && !unconfirmedSchedule) {
    await runStateActions(nextState.mainStatus);
  }

  persistState();
  promotePendingReservation();
}

// ── 핵심 처리 ─────────────────────────────────────────────────────────────────
async function processNow(now = Date.now()) {
  if (preparationShuttingDown) return;
  if (isProcessing) {
    pendingProcess = true;
    return;
  }
  isProcessing = true;
  const completedManualEvents = [];
  try {
    for (const request of pendingManualEvents.splice(0)) {
      try {
        if (request.propertyId !== config?.areaName) throw Object.assign(new Error('Watcher property does not match'), { status: 409 });
        if (!isValidTransition(roomState, request.type)) throw Object.assign(new Error('Room state changed; refresh and retry'), { status: 409 });
        const next = getNextRoomState(roomState, request.type);
        if (next.mainStatus === roomState.mainStatus && next.subStatus === roomState.subStatus) {
          throw Object.assign(new Error('Monitoring event already applied'), { status: 409 });
        }
        await applyTransition({ type: request.type, reason: '운영자 수동 처리' });
        monitor.noteManualCleaning(request.type); // 운영자가 누른 청소 시작·완료는 실제 청소 기록으로 본다
        completedManualEvents.push(request);
      } catch (error) { request.reject(error); }
    }
    const snap        = buildSnapshotFromStates(entityStateMap, now);
    const vacantEnergySources = buildVacantEnergySources(entityStateMap, config?.devices);
    const deviceAvailability = buildDeviceAvailability(
      entityStateMap, config?.devices, config?.deviceMaintenanceUntil, now,
    );
    const reservation = buildReservation();
    const sensorsOff  = offDetectionSensors(entityStateMap);
    const entrySensorsOff = offEntryDetectionSensors(entityStateMap);
    const events      = monitor.process({
      snap, roomState, reservation, now, sensorsOff, entrySensorsOff,
      cleaning: config?.cleaning ?? null,
      vacantEnergySources,
      deviceAvailability,
    });

    for (const event of events) {
      if (SOFT_EVENTS.has(event.type)) {
        await handleSoftEvent(event);
      } else if (PROBLEM_EVENTS.has(event.type)) {
        handleProblemEvent(event);
      } else if (CONFIRMATION_EVENTS.has(event.type)) {
        await applyConfirmation(event);
      } else if (OBSERVATION_EVENTS.has(event.type)) {
        handleObservation(event);
      } else if (NOISE_ANOMALY_EVENT_TYPES.has(event.type)) {
        handleAnomalySignal(event);
      } else if (VACANT_ENERGY_SIGNAL_EVENT_TYPES.has(event.type)) {
        handleAnomalySignal(event);
      } else if (DEVICE_OFFLINE_ANOMALY_EVENT_TYPES.has(event.type)) {
        handleAnomalySignal(event);
      } else if (event.type === 'vacant_energy_waste_resolved' && !isValidTransition(roomState, event.type)) {
        // 입실 준비 등으로 객실 상태가 먼저 바뀌었어도 서버의 해결 기록은 잃지 않는다.
        handleAnomalySignal(event);
      } else {
        await applyTransition(event);
      }
    }
    // 퇴실·입실 확인 대기가 바뀌었을 수 있다 — 재시작해도 이어지게 저장한다. 기다리는 동안엔 2분마다도 저장해
    // 다시 켜졌을 때 "마지막으로 본 시각"이 실제로 꺼져 있던 시간을 가리키게 한다(10분 넘게 못 봤으면 판정하지 않는다)
    if (events.length || monitor.needsPersistence || (monitor.hasOpenWait && now - lastWaitPersistAt >= WAIT_PERSIST_MS)) {
      persistState();
      lastWaitPersistAt = now;
    }

    // DEC-12: 감지 센서 사전 점검. 여기서 오류가 나도 같은 주기의 입실 준비·이벤트 전송은 계속한다.
    try { runSensorPrechecks(now); } catch (err) { console.error('[Watcher] 감지 센서 점검 오류:', err.message); }

    // 체류(스케줄)인데 손님을 기다리는 중일 때만 입실 준비를 시작할 수 있다 — 센서가 꺼져 확인할 수 없는 체류에선
    // 안에 사람이 있을 수 있어 조명을 끄는 준비 제어를 하지 않는다(DEC-11)
    if (!isReplaying && !preparationShuttingDown) await preparation.tick({ config, roomState, now, arrivalPending: roomState.mainStatus === 'OCCUPIED' && monitor.awaitingArrival });
    flushPreparationOutbox().catch(() => {});

    lastEventAt = now;
    lastError   = null;
    for (const request of completedManualEvents) request.resolve({ ok: true, roomState: { ...roomState } });
  } catch (err) {
    for (const request of completedManualEvents) request.reject(err);
    lastError = err.message;
    console.error('[Watcher] 처리 오류:', err.message);
  } finally {
    isProcessing = false;
    if (pendingConfig) {
      const next = pendingConfig; pendingConfig = null;
      setMonitoringConfig(next);
    }
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

// ── CCTV 스냅샷 기록 ──────────────────────────────────────────────────────────
function recordSnapshot(path) {
  snapshotLog.push({ path, ts: Date.now(), roomState: { ...roomState } });
  if (snapshotLog.length > SNAPSHOT_LOG_MAX) snapshotLog.shift();
  persistSnapshotLog();
  console.log(`[Watcher] 스냅샷 기록: ${path}`);
}

// ── Vercel 이벤트 전송 ──────────────────────────────────────────────────────
// Keep the persisted queue name for existing Pi state files. All event types
// now share its durable, single-sender delivery path; API side effects stay unchanged.
async function flushPreparationOutbox() {
  if (!PI_SECRET || flushingPreparationOutbox || !preparationOutbox.length) return;
  flushingPreparationOutbox = true;
  try {
    while (preparationOutbox.length) {
      if (!persistState()) return; // never transmit an occurrence not yet durable
      const payload = preparationOutbox[0];
      const response = await fetch(`${VERCEL_URL}/api/events/write`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pi-secret': PI_SECRET },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(PREPARATION_POLICY.requestTimeoutMs),
      });
      if (!response.ok) {
        if (![400, 422].includes(response.status)) return;
        // Preserve invalid payloads for inspection without blocking later events.
        // Auth/configuration/rate/server failures remain in the retry queue.
        eventDeliveryRejected.push({ payload, httpStatus: response.status });
        preparationOutbox.shift();
        if (!persistState()) {
          preparationOutbox.unshift(payload); eventDeliveryRejected.pop(); return;
        }
        continue;
      }
      const acknowledgement = await response.json();
      if (typeof acknowledgement?.inserted !== 'boolean') return;
      if (payload.type === 'noise_threshold_normal') {
        const anomaly = acknowledgement.anomaly;
        if (typeof anomaly?.complete !== 'boolean') return;
        if (!anomaly.complete && !Number.isFinite(Date.parse(anomaly.eligibleAt))) return;
        monitor.acknowledgeNoiseNormal({
          stayId: payload.data?.stayId,
          normalStartedAt: Date.parse(payload.data?.normalStartedAt),
          complete: anomaly.complete,
          eligibleAt: anomaly.eligibleAt,
        });
      } else if (payload.type === 'vacant_energy_waste_detected') {
        const anomaly = acknowledgement.anomaly;
        if (typeof anomaly?.targetRef !== 'string' || !anomaly.targetRef) return;
        monitor.acknowledgeVacantEnergyDetected({ targetRef: anomaly.targetRef });
      } else if (payload.type === 'vacant_energy_waste_normal') {
        const anomaly = acknowledgement.anomaly;
        if (typeof anomaly?.complete !== 'boolean' || typeof anomaly?.targetRef !== 'string') return;
        if (!anomaly.complete && !Number.isFinite(Date.parse(anomaly.eligibleAt))) return;
        monitor.acknowledgeVacantEnergyNormal({
          targetRef: anomaly.targetRef,
          normalStartedAt: Date.parse(payload.data?.normalStartedAt),
          complete: anomaly.complete,
          eligibleAt: anomaly.eligibleAt,
          resolvedAt: anomaly.resolvedAt,
          confirmedAt: typeof payload.device_time === 'number'
            ? payload.device_time
            : Date.parse(payload.device_time),
          abandon: anomaly.abandon === true,
        });
      } else if (payload.type === 'device_online_normal') {
        const anomaly = acknowledgement.anomaly;
        if (typeof anomaly?.complete !== 'boolean' || typeof anomaly?.entityId !== 'string') return;
        if (!anomaly.complete && !Number.isFinite(Date.parse(anomaly.eligibleAt))) return;
        monitor.acknowledgeDeviceOnline({
          entityId: anomaly.entityId,
          normalStartedAt: Date.parse(payload.data?.normalStartedAt),
          complete: anomaly.complete,
          eligibleAt: anomaly.eligibleAt,
        });
      }
      // Retrying the original occurrence timestamp preserves the existing DB
      // UNIQUE(property_id,type,device_time) duplicate protection after a crash.
      preparationOutbox.shift();
      if (!persistState()) { preparationOutbox.unshift(payload); return; }
    }
  } catch { /* retain original payloads on network/timeout/invalid response */ }
  finally { flushingPreparationOutbox = false; }
}

async function reportEventToVercel(type, isSoft, data = null, occurredAt = Date.now()) {
  const isPreparation = data?.preparationPolicy === 'sensor-v1' && data.optimizationRunId;
  const propertyId = isPreparation ? data.propertyId ?? config?.areaName : config?.areaName;
  if (!propertyId) return;
  const sourceRef = isPreparation ? `optimization:${data.optimizationRunId}:${type}` : `watcher:event:${randomUUID()}`;
  if (!preparationOutbox.some(event => event.source_ref === sourceRef)) {
    const deviceTime = Number.isFinite(occurredAt) ? occurredAt : Date.now();
    preparationOutbox.push({ type, is_soft: isSoft, device_time: deviceTime, property_id: propertyId,
      data: structuredClone(data), source_system: 'HA_WATCHER', source_ref: sourceRef });
    if (!persistState()) return;
  }
  await flushPreparationOutbox();
}

// ── 스냅샷 파일 정리 (10일 초과 삭제) ───────────────────────────────────────
function cleanupOldSnapshots() {
  const now    = Date.now();
  const cutoff = now - SNAPSHOT_RETENTION_MS;

  // 파일 삭제
  try {
    const files = readdirSync(HA_SNAPSHOT_DIR);
    let deleted = 0;
    for (const file of files) {
      if (!file.endsWith('.jpg') && !file.endsWith('.jpeg') && !file.endsWith('.png')) continue;
      const fullPath = join(HA_SNAPSHOT_DIR, file);
      try {
        if (statSync(fullPath).mtimeMs < cutoff) { unlinkSync(fullPath); deleted++; }
      } catch { /* skip */ }
    }
    if (deleted > 0) console.log(`[Watcher] 스냅샷 정리: ${deleted}개 삭제 (10일 초과)`);
  } catch { /* 디렉토리 없으면 무시 */ }

  // snapshotLog에서 오래된 항목 제거
  const before = snapshotLog.length;
  snapshotLog.splice(0, snapshotLog.length, ...snapshotLog.filter(s => s.ts >= cutoff));
  if (snapshotLog.length !== before) persistSnapshotLog();
}

// ── WebSocket 이벤트 핸들러 ────────────────────────────────────────────────────
function handleStateChanged(entityId, newState) {
  // 스냅샷 신호 — area 필터 밖에서도 항상 수신
  if (SNAPSHOT_INPUT_ENTITY && entityId === SNAPSHOT_INPUT_ENTITY) {
    const path = newState?.state;
    if (path && path !== 'unknown' && path !== '' && path.startsWith('/local/')) {
      recordSnapshot(path);
    }
    return;
  }

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
      areaEntityIds = new Set(); entityStateMap = {};
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

// ── 예약·안전 감시 (30초 인터벌) ───────────────────────────────────────────────
async function checkCalendarEvents() {
  // The timer only triggers a fresh observation. Elapsed time cannot finish a
  // preparation. Share processNow's lock with sensor and lifecycle processing.
  if (isProcessing) { pendingProcess = true; return; }
  await processNow(Date.now());
}

// ── WebSocket 연결 ────────────────────────────────────────────────────────────
function connectWebSocket() {
  if (watcherStopped) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  const url = getHaWsUrl();
  console.log(`[Watcher] WebSocket 연결: ${url}`);

  const connection = new WebSocket(url);
  ws = connection;

  ws.addEventListener('message', (event) => {
    if (watcherStopped || ws !== connection) return;
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
    if (watcherStopped || ws !== connection) return;
    console.log('[Watcher] WebSocket 연결됨');
  });

  ws.addEventListener('close', (event) => {
    if (watcherStopped || ws !== connection) return;
    ws = null;
    console.warn(`[Watcher] WebSocket 끊김 (code: ${event.code}). ${reconnectDelay / 1000}초 후 재연결`);
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    if (watcherStopped || ws !== connection) return;
    lastError = 'WebSocket 연결 오류';
    console.error('[Watcher] WebSocket 오류 발생');
  });
}

// ── 재연결 (backoff) ──────────────────────────────────────────────────────────
function scheduleReconnect() {
  if (watcherStopped || reconnectTimer) return;
  const generation = watcherGeneration;

  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 60_000);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (watcherStopped || generation !== watcherGeneration) return;
    const disconnectedAt = lastEventAt;

    // 초기 상태 재갱신
    await initEntityMap();
    if (watcherStopped || generation !== watcherGeneration) return;

    // 끊긴 동안 놓친 이벤트 재처리
    await replayHistory(disconnectedAt);
    if (watcherStopped || generation !== watcherGeneration) return;

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
    snapshotLog:   snapshotLog.slice(-20),
    config:      config ? { areaName: config.areaName } : null,
    wsConnected: ws?.readyState === WebSocket.OPEN,
    isReplaying,
    lastPollAt:  lastEventAt, // 하위 호환 유지
    lastEventAt,
    lastError,
    preparation: preparation.snapshot(),
    preparationDeliveryPending: preparationOutbox.filter(event => event.data?.preparationPolicy === 'sensor-v1').length,
    eventDeliveryPending: preparationOutbox.length,
    eventDeliveryRejectedCount: eventDeliveryRejected.length,
    statePersistenceFailed,
  };
}

export function setMonitoringConfig(cfg) {
  if (isProcessing) { pendingConfig = { ...pendingConfig, ...cfg }; return; }
  const prevCheckIn = config?.reservation?.checkIn ?? null;
  // Browser reservation refreshes must preserve hardware/sensor mappings.
  const nextConfig = { ...config, ...cfg };
  if (Object.hasOwn(cfg, 'reservation')) {
    const planned = planMonitoringReservationUpdate(config?.reservation ?? null, cfg.reservation, roomState, new Date());
    nextConfig.reservation = planned.reservation;
    if (planned.deferred) nextConfig.pendingReservation = planned.pendingReservation; // null도 "예약 없음"으로 대기
    else if (!planned.keepPending) delete nextConfig.pendingReservation;
  }
  config = nextConfig;
  persistConfig(config);

  // 예약 취소 감지: 이전에 checkIn이 있었는데 이제 없어진 경우
  const newCheckIn = config?.reservation?.checkIn ?? null;
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
  // areaName이 바뀔 수 있으므로 엔티티 맵 재초기화
  initEntityMap()
    .then(() => processNow(Date.now()))
    .catch(err => console.error('[Watcher] config 업데이트 후 초기화 오류:', err.message));
}

export function setRoomState(newState) {
  roomState = newState;
  persistState();
  promotePendingReservation(); // 운영자가 체류 중 멈춤을 손으로 풀었을 때도 대기 중인 다음 예약을 쓴다
}

// Browser requests express an operation, never a predicted room state. Keep
// them in the same serialized cycle as sensor events and preparation control.
export function dispatchMonitoringEvent({ type, propertyId } = {}) {
  if (!['cleaning_started', 'cleaning_finished', 'maintenance_started', 'maintenance_finished'].includes(type)
    || typeof propertyId !== 'string' || !propertyId.trim()) {
    return Promise.reject(Object.assign(new Error('Invalid monitoring event'), { status: 400 }));
  }
  if (preparationShuttingDown || isReplaying) return Promise.reject(Object.assign(new Error('Watcher is not ready'), { status: 503 }));
  return new Promise((resolve, reject) => {
    pendingManualEvents.push({ type, propertyId, resolve, reject });
    processNow().catch(reject);
  });
}

export function startWatcher() {
  // calendarTimer 가 동기적으로 즉시 설정되므로 중복 호출 방지의 핵심 가드다.
  // ws / reconnectTimer 는 비동기 초기화 이후에 설정되므로 재시작 감지용 보조 조건.
  if (ws || reconnectTimer || calendarTimer) return;
  watcherStopped = false;
  const generation = ++watcherGeneration;
  preparationShuttingDown = false;

  roomState = loadPersistedState();
  config    = loadPersistedConfig();
  loadSnapshotLog();
  console.log('[Watcher] 시작');

  // 스냅샷 정리: 시작 즉시 + 매 시간
  cleanupOldSnapshots();
  snapshotCleanupTimer = setInterval(cleanupOldSnapshots, 60 * 60 * 1000);

  // 비동기 초기화 (fire-and-forget)
  (async () => {
    await initEntityMap();
    if (watcherStopped || generation !== watcherGeneration) return;
    await processNow(Date.now()); // 초기 스냅샷으로 한 번 처리
    if (watcherStopped || generation !== watcherGeneration) return;
    connectWebSocket();
  })().catch(err => {
    if (watcherStopped || generation !== watcherGeneration) return;
    console.error('[Watcher] 초기화 오류:', err.message);
    lastError = err.message;
    scheduleReconnect(); // 실패 시 재시도
  });

  // Watchdog observations continue even when sensor values do not change.
  calendarTimer = setInterval(() => checkCalendarEvents().catch(() => {}), PREPARATION_POLICY.pollMs);
}

export function stopWatcher() {
  watcherStopped = true;
  watcherGeneration++;
  ws?.close();
  ws = null;
  if (reconnectTimer)       { clearTimeout(reconnectTimer);         reconnectTimer       = null; }
  if (calendarTimer)        { clearInterval(calendarTimer);          calendarTimer        = null; }
  if (debounceTimer)        { clearTimeout(debounceTimer);           debounceTimer        = null; }
  if (snapshotCleanupTimer) { clearInterval(snapshotCleanupTimer);   snapshotCleanupTimer = null; }
  console.log('[Watcher] 중지');
}

export async function shutdownPreparation() {
  preparationShuttingDown = true;
  for (const request of pendingManualEvents.splice(0)) request.reject(Object.assign(new Error('Watcher is stopping'), { status: 503 }));
  await preparation.shutdown();
}
