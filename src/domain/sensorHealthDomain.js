/**
 * 감지 필수 센서 오프라인 (RF-28, DEC-08)
 *
 * 입실·퇴실 감지(SensorEventGenerator)는 숙소 구역의 문(door)·움직임(motion) 센서만 읽는다. 둘 중 하나라도
 * 꺼지면 감지가 멈추는데 알림이 없었다(파주201 현관 움직임 센서 10-30부터). 그래서 이 두 종류를 감지 필수
 * 센서로 보고, 30분 넘게 꺼져 있으면 문제 이벤트를 한 번 내고 돌아오면 해소 이벤트를 낸다. 객실 상태는 바꾸지 않는다.
 *
 * - 꺼짐 = HA 상태 unavailable(기기에 닿지 못함). unknown은 넣지 않는다 — 값이 바뀔 때만 보고하는 센서는 HA 재시작 뒤
 *   한동안 unknown이지만 고장이 아니라서, 빈방에서 30분을 넘겨 거짓 알림이 난다(assessDeviceReadiness는 unknown도 넣지만 화면에 쓰이지 않는다).
 *   한 번 꺼진 뒤 unknown을 거쳐도 이어진 끊김으로 본다(다시 값이 들어와야 복구).
 * - 30분 안에 돌아오면 기록하지 않는다 — 정기 재시작·펌웨어 업데이트는 이상이 아니다(report-architecture 6-1-1).
 * - 발생 시각 = 꺼진 시각 + 30분(기준을 넘은 시각). 같은 끊김은 언제 다시 판정해도 같은 시각이라,
 *   DB의 (숙소, 종류, 발생 시각) 중복 방지가 재전송을 막는다.
 * - 한 숙소의 두 센서가 같은 순간 넘거나 돌아오면 DB가 둘째를 중복으로 버린다. 그래서 센서마다 고정된 0~999ms를
 *   더하고(다시 처리할 때 판정이 나뉘어도 겹치지 않게), 같은 판정 안에서 그래도 겹치면 1ms씩 민다. 고정값이라 재전송 중복 방지는 그대로다.
 * - 알림은 보고(reportedAt)와 따로 기록한다(alertedAt) — 놓친 기록을 다시 처리하는 중엔 알림을 미루고,
 *   그사이 워처가 재시작해도 "보고했지만 아직 안 알림"이 남아 다음 정상 주기에 보낸다.
 */

export const DETECTION_SENSOR_CLASSES = Object.freeze({ door: '문 센서', motion: '움직임 센서' });
export const SENSOR_OFFLINE_THRESHOLD_MS = 30 * 60_000;
const OFFLINE_STATE = 'unavailable';
const STILL_OFFLINE_STATES = new Set(['unavailable', 'unknown']); // 추적 중인 끊김을 이어 가는 상태

const timeOf = value => {
  const ms = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
};
const isoOf = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** 센서마다 고정된 0~999ms (FNV-1a) — 같은 순간의 두 센서 이벤트가 DB 중복 방지에 걸리지 않게 */
export function sensorEventOffsetMs(entityId) {
  let hash = 2166136261;
  for (const ch of String(entityId)) { hash ^= ch.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % 1000;
}

/** 저장된 추적 상태 중 쓸 수 있는 항목만 — 깨진 항목 하나가 감시 주기를 멈추지 않게 */
export function sanitizeSensorTracking(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean = {};
  for (const [entityId, entry] of Object.entries(raw)) {
    if (!entry || !Number.isFinite(entry.offlineSince)) continue;
    if (entry.reportedAt != null && !Number.isFinite(entry.reportedAt)) continue;
    clean[entityId] = {
      offlineSince: entry.offlineSince, reportedAt: entry.reportedAt ?? null,
      alertedAt: Number.isFinite(entry.alertedAt) ? entry.alertedAt : null,
      role: entry.role ?? null, name: entry.name ?? entityId,
    };
  }
  return clean;
}

/** 숙소 구역 상태 중 감지 필수 센서만 — { entityId, role, roleLabel, name, state, changedAt } */
export function detectionSensors(stateMap = {}) {
  const sensors = [];
  for (const [entityId, state] of Object.entries(stateMap ?? {})) {
    if (!state || entityId.split('.')[0] !== 'binary_sensor') continue;
    const role = state.attributes?.device_class;
    if (!Object.hasOwn(DETECTION_SENSOR_CLASSES, role)) continue;
    sensors.push({
      entityId,
      role,
      roleLabel: DETECTION_SENSOR_CLASSES[role],
      name: state.attributes?.friendly_name || entityId,
      state: state.state,
      changedAt: timeOf(state.last_changed) ?? timeOf(state.last_updated),
    });
  }
  return sensors.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
}

/**
 * @param {object} p
 * @param {object} p.stateMap  — { entityId: HA state } (숙소 구역)
 * @param {object} p.tracked   — 지난 판정의 추적 상태 { entityId: { offlineSince, reportedAt, alertedAt, role, name } }
 * @param {number} p.now
 * @param {string|null} [p.mainStatus] — 판정할 때의 객실 상태(문제 목록의 구분에 쓴다. 늦게 판정하면 꺼진 순간의 상태와 다를 수 있다)
 * @param {Iterable<string>|null} [p.knownEntityIds] — 지금 숙소 구역의 기기 목록. 주어지고 비어 있지 않으면 구역에서 빠진 센서의 추적을 지운다
 * @returns {{ events: object[], tracked: object, changed: boolean, dropped: string[] }} dropped = 구역에서 빠져 추적을 지운 센서
 */
export function evaluateSensorOffline({ stateMap, tracked = {}, now, mainStatus = null, knownEntityIds = null, thresholdMs = SENSOR_OFFLINE_THRESHOLD_MS }) {
  const next = sanitizeSensorTracking(tracked);
  let changed = Object.keys(next).length !== Object.keys(tracked ?? {}).length;
  const events = [];
  const usedDetectedTimes = new Set(Object.values(next).map(entry => entry.reportedAt).filter(Number.isFinite));
  const usedResolvedTimes = new Set();
  const unique = (used, at) => { let t = at; while (used.has(t)) t += 1; used.add(t); return t; };

  for (const sensor of detectionSensors(stateMap)) {
    const entry = next[sensor.entityId];
    const offline = entry ? STILL_OFFLINE_STATES.has(sensor.state) : sensor.state === OFFLINE_STATE;
    if (offline) {
      // 이미 추적 중이면 처음 꺼진 시각을 유지한다(unavailable↔unknown 전환·HA 재시작으로 시각이 바뀌어도 같은 끊김)
      const offlineSince = entry?.offlineSince ?? sensor.changedAt ?? now;
      if (!entry) { next[sensor.entityId] = { offlineSince, reportedAt: null, alertedAt: null, role: sensor.role, name: sensor.name }; changed = true; }
      const current = next[sensor.entityId];
      if (current.reportedAt == null && now - offlineSince >= thresholdMs) {
        const reportedAt = unique(usedDetectedTimes, offlineSince + thresholdMs + sensorEventOffsetMs(sensor.entityId));
        next[sensor.entityId] = { ...current, reportedAt };
        changed = true;
        events.push({
          type: 'sensor_offline_detected',
          reason: `${sensor.roleLabel}(${sensor.name}) 연결이 ${Math.round(thresholdMs / 60_000)}분 넘게 끊김 — 입실·퇴실 감지가 정확하지 않을 수 있음`,
          timestamp: reportedAt,
          data: {
            entityId: sensor.entityId, role: sensor.role, name: sensor.name,
            offlineSince: isoOf(offlineSince),
            thresholdMinutes: Math.round(thresholdMs / 60_000), mainStatus,
          },
        });
      }
    } else if (entry) {
      delete next[sensor.entityId];
      changed = true;
      if (entry.reportedAt != null) {
        const back = Math.max(sensor.changedAt ?? now, entry.reportedAt + 1);
        events.push({
          type: 'sensor_offline_resolved',
          reason: `${sensor.roleLabel}(${sensor.name}) 연결 복구`,
          timestamp: unique(usedResolvedTimes, back + sensorEventOffsetMs(sensor.entityId)),
          data: {
            entityId: sensor.entityId, role: sensor.role, name: sensor.name,
            offlineSince: isoOf(entry.offlineSince),
            detectedAt: isoOf(entry.reportedAt), mainStatus,
          },
        });
      }
    }
  }
  // 구역 상태에 안 보이는 센서는 그대로 둔다(상태를 잠깐 못 읽음) — 다시 보일 때 판정한다.
  // 구역 기기 목록에서 빠졌으면(교체·이동) 추적만 지운다. 복구를 본 게 아니므로 해소 이벤트는 내지 않는다.
  const known = knownEntityIds ? new Set(knownEntityIds) : null;
  const dropped = [];
  if (known?.size) {
    for (const entityId of Object.keys(next)) {
      if (!known.has(entityId)) { delete next[entityId]; dropped.push(entityId); changed = true; }
    }
  }
  return { events, tracked: next, changed, dropped };
}

/** 보고했지만 아직 운영자에게 알리지 않은 끊김 — 알림 문구에 쓰는 이벤트 모양으로 */
export function pendingOperatorAlerts(tracked = {}, thresholdMs = SENSOR_OFFLINE_THRESHOLD_MS) {
  return Object.entries(tracked ?? {})
    .filter(([, entry]) => entry?.reportedAt != null && entry.alertedAt == null)
    .map(([entityId, entry]) => ({
      entityId,
      data: { entityId, role: entry.role, name: entry.name, offlineSince: isoOf(entry.offlineSince), thresholdMinutes: Math.round(thresholdMs / 60_000) },
    }));
}

const KST_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
// 한국 시각 "10/30 14:12"
function kstLabel(ms) {
  const part = Object.fromEntries(KST_PARTS.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return `${part.month}/${part.day} ${part.hour}:${part.minute}`;
}

/** 운영자 알림 문구 — 숙소·센서·꺼진 시각·영향 */
export function sensorOfflineAlertMessage(propertyId, event) {
  const { data } = event;
  const role = DETECTION_SENSOR_CLASSES[data.role] ?? '감지 센서';
  const since = kstLabel(Date.parse(data.offlineSince));
  return {
    title: `PROPOS ${propertyId ?? ''} 감지 센서 연결 끊김`.trim(),
    message: `${role} "${data.name}" 연결이 ${since}부터 ${data.thresholdMinutes}분 넘게 끊겼습니다. 복구될 때까지 입실·퇴실 자동 감지가 정확하지 않을 수 있어요. 센서 배터리·연결을 확인해 주세요.`,
  };
}
