/** RF-25 네 번째 정본 감지기 — 매핑된 IoT 기기의 unavailable 30분 지속. */

const MIN = 60_000;

export const DEVICE_OFFLINE_DETECTION_MINUTES = 30;
const DETECTION_MS = DEVICE_OFFLINE_DETECTION_MINUTES * MIN;
const OBSERVATION = new Set(['online', 'offline', 'unknown', 'excluded']);

function validTime(value) {
  return Number.isFinite(value) && value >= 0;
}

function validRef(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeDevices(value) {
  if (!Array.isArray(value)) throw new Error('기기 연결 관측값이 올바르지 않습니다');
  const devices = new Map();
  for (const raw of value) {
    const entityId = validRef(raw?.entityId) ? raw.entityId.trim() : null;
    if (!entityId || !OBSERVATION.has(raw?.status)) throw new Error('기기 연결 관측값이 올바르지 않습니다');
    devices.set(entityId, {
      entityId,
      name: validRef(raw.name) ? raw.name.trim() : entityId,
      status: raw.status,
    });
  }
  return devices;
}

function restoredState(raw, entityId) {
  if (!raw || typeof raw !== 'object') return null;
  const state = {
    entityId,
    name: validRef(raw.name) ? raw.name.trim() : entityId,
    offlineStartedAt: validTime(raw.offlineStartedAt) ? raw.offlineStartedAt : null,
    detected: raw.detected === true,
    normalStartedAt: validTime(raw.normalStartedAt) ? raw.normalStartedAt : null,
    awaitingNormalAck: raw.awaitingNormalAck === true,
    nextNormalObservationAt: validTime(raw.nextNormalObservationAt) ? raw.nextNormalObservationAt : null,
    normalRestartRequired: raw.normalRestartRequired === true,
  };
  if (!state.detected && state.offlineStartedAt == null) return null;
  if (!state.detected) {
    state.normalStartedAt = null;
    state.awaitingNormalAck = false;
    state.nextNormalObservationAt = null;
    state.normalRestartRequired = false;
  }
  return state;
}

function newTracking(device, now) {
  return {
    entityId: device.entityId,
    name: device.name,
    offlineStartedAt: now,
    detected: false,
    normalStartedAt: null,
    awaitingNormalAck: false,
    nextNormalObservationAt: null,
    normalRestartRequired: false,
  };
}

export class DeviceOfflineAnomalyDetector {
  _states = new Map();
  _persistenceDirty = false;

  snapshot() {
    return Object.fromEntries([...this._states.entries()].map(([id, state]) => [id, { ...state }]));
  }

  restore(raw) {
    this._states = new Map();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [rawId, value] of Object.entries(raw)) {
        const id = validRef(rawId) ? rawId.trim() : null;
        const state = id ? restoredState(value, id) : null;
        if (state) this._states.set(id, state);
      }
    }
    this._persistenceDirty = false;
  }

  markPersisted() {
    this._persistenceDirty = false;
  }

  get hasPendingTracking() {
    return Boolean(this._persistenceDirty || this._states.size);
  }

  get needsPersistence() {
    return this._persistenceDirty;
  }

  acknowledgeNormal({ entityId, normalStartedAt, complete, eligibleAt }) {
    const state = this._states.get(entityId);
    if (!state || state.normalStartedAt !== normalStartedAt) return false;
    if (complete === true) {
      this._states.delete(entityId);
      this._persistenceDirty = true;
      return true;
    }
    const next = Date.parse(eligibleAt);
    if (!Number.isFinite(next)) return false;
    state.awaitingNormalAck = false;
    state.nextNormalObservationAt = next;
    this._persistenceDirty = true;
    return true;
  }

  evaluate({ devices, now }) {
    if (!Number.isFinite(now)) throw new Error('기기 연결 관측 시각이 올바르지 않습니다');
    const observed = normalizeDevices(devices);
    const events = [];
    // events 표의 기존 중복 키(property,type,device_time)에 같은 순간 여러 기기가
    // 겹치지 않도록, 현재·추적 대상을 정렬한 순서만큼 ms를 안정적으로 벌린다.
    // 이상 본체의 실제 occurred_at은 서버가 시작 시각+30분으로 다시 계산한다.
    const eventOffsets = new Map(
      [...new Set([...this._states.keys(), ...observed.keys()])].sort().map((id, index) => [id, index]),
    );

    for (const [entityId, state] of [...this._states]) {
      if (observed.has(entityId)) continue;
      this._states.delete(entityId);
      this._persistenceDirty = true;
      if (state.detected) events.push(this._removed(state, now + eventOffsets.get(entityId)));
    }

    for (const device of observed.values()) {
      const state = this._states.get(device.entityId);
      if (state) state.name = device.name;
      const eventNow = now + eventOffsets.get(device.entityId);
      if (device.status === 'offline') events.push(...this._offline(device, now, eventNow));
      else if (device.status === 'online') events.push(...this._online(device, now, eventNow));
      else this._unobserved(device);
    }
    return events;
  }

  _offline(device, now, eventNow) {
    let state = this._states.get(device.entityId);
    if (!state) {
      state = newTracking(device, now);
      this._states.set(device.entityId, state);
      this._persistenceDirty = true;
      return [];
    }
    if (state.detected && state.normalStartedAt != null) {
      state.normalStartedAt = null;
      state.awaitingNormalAck = false;
      state.nextNormalObservationAt = null;
      state.normalRestartRequired = false;
      this._persistenceDirty = true;
      return [{
        type: 'device_offline_recurred',
        reason: `${state.name} 연결 끊김 재확인`,
        timestamp: eventNow,
        data: {
          entityId: state.entityId,
          deviceName: state.name,
          detectionMinutes: DEVICE_OFFLINE_DETECTION_MINUTES,
        },
      }];
    }
    if (state.detected || now - state.offlineStartedAt < DETECTION_MS) return [];
    const occurredAt = state.offlineStartedAt + DETECTION_MS;
    state.detected = true;
    this._persistenceDirty = true;
    return [{
      type: 'device_offline_detected',
      reason: `${state.name} 연결 끊김 ${DEVICE_OFFLINE_DETECTION_MINUTES}분 지속`,
      timestamp: occurredAt + (eventNow - now),
      data: {
        entityId: state.entityId,
        deviceName: state.name,
        detectionMinutes: DEVICE_OFFLINE_DETECTION_MINUTES,
        offlineStartedAt: new Date(state.offlineStartedAt).toISOString(),
      },
    }];
  }

  _online(device, now, eventNow) {
    const state = this._states.get(device.entityId);
    if (!state) return [];
    if (!state.detected) {
      this._states.delete(device.entityId);
      this._persistenceDirty = true;
      return [];
    }
    if (state.normalStartedAt == null) state.normalStartedAt = now;
    const due = state.nextNormalObservationAt == null || now >= state.nextNormalObservationAt;
    if (state.awaitingNormalAck || !due) return [];
    state.awaitingNormalAck = true;
    state.nextNormalObservationAt = null;
    const restartStabilization = state.normalRestartRequired;
    state.normalRestartRequired = false;
    this._persistenceDirty = true;
    return [{
      type: 'device_online_normal',
      reason: `${state.name} 연결 정상 확인`,
      timestamp: eventNow,
      data: {
        entityId: state.entityId,
        deviceName: state.name,
        detectionMinutes: DEVICE_OFFLINE_DETECTION_MINUTES,
        normalStartedAt: new Date(state.normalStartedAt).toISOString(),
        ...(restartStabilization ? { restartStabilization: true } : {}),
      },
    }];
  }

  _unobserved(device) {
    const state = this._states.get(device.entityId);
    if (!state) return;
    if (!state.detected) {
      this._states.delete(device.entityId);
    } else if (state.normalStartedAt != null) {
      state.normalStartedAt = null;
      state.awaitingNormalAck = false;
      state.nextNormalObservationAt = null;
      state.normalRestartRequired = true;
    } else {
      return;
    }
    this._persistenceDirty = true;
  }

  _removed(state, now) {
    return {
      type: 'device_offline_tracking_removed',
      reason: `${state.name} 기기 매핑 제거`,
      timestamp: now,
      data: { entityId: state.entityId, deviceName: state.name },
    };
  }
}
