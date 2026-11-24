/**
 * RF-25 빈방 에너지 낭비 신호 추적기.
 *
 * 공실 중 숙소에 매핑된 에너지 사용 장치가 30분 연속 켜져 있을 때만 기존
 * vacant_energy_waste_detected 이벤트를 만든다. 해결 안정화 시간은 서버가
 * 사건에 스냅샷한 DB 정책으로 판정한다.
 */

const MIN = 60_000;

export const VACANT_ENERGY_DETECTION_MINUTES = 30;
const DETECTION_MS = VACANT_ENERGY_DETECTION_MINUTES * MIN;

function validTime(value) {
  return Number.isFinite(value) && value >= 0;
}

function validRef(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSources(value) {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error('빈방 장치 관측값이 올바르지 않습니다');
  return [...new Set(value.filter(validRef).map(item => item.trim()))].sort();
}

function restoredState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const state = {
    activeStartedAt: validTime(raw.activeStartedAt) ? raw.activeStartedAt : null,
    detected: raw.detected === true,
    targetRef: validRef(raw.targetRef) ? raw.targetRef.trim() : null,
    normalStartedAt: validTime(raw.normalStartedAt) ? raw.normalStartedAt : null,
    awaitingNormalAck: raw.awaitingNormalAck === true,
    nextNormalObservationAt: validTime(raw.nextNormalObservationAt) ? raw.nextNormalObservationAt : null,
    normalRestartRequired: raw.normalRestartRequired === true,
    endedAt: validTime(raw.endedAt) ? raw.endedAt : null,
    resolutionPending: raw.resolutionPending && typeof raw.resolutionPending === 'object'
      && validTime(raw.resolutionPending.resolvedAt)
      ? {
          resolvedAt: raw.resolutionPending.resolvedAt,
          confirmedAt: validTime(raw.resolutionPending.confirmedAt)
            ? raw.resolutionPending.confirmedAt
            : raw.resolutionPending.resolvedAt,
          stabilizationMinutes: Number.isFinite(raw.resolutionPending.stabilizationMinutes)
            ? Math.max(0, raw.resolutionPending.stabilizationMinutes)
            : 0,
        }
      : null,
  };
  if (!state.detected && state.activeStartedAt == null) return null;
  return state;
}

function newTracking(now) {
  return {
    activeStartedAt: now,
    detected: false,
    targetRef: null,
    normalStartedAt: null,
    awaitingNormalAck: false,
    nextNormalObservationAt: null,
    normalRestartRequired: false,
    endedAt: null,
    resolutionPending: null,
  };
}

export class VacantEnergyAnomalyDetector {
  _state = null;
  _persistenceDirty = false;

  snapshot() {
    return this._state
      ? {
          ...this._state,
          resolutionPending: this._state.resolutionPending
            ? { ...this._state.resolutionPending }
            : null,
        }
      : null;
  }

  restore(raw) {
    this._state = restoredState(raw);
    this._persistenceDirty = false;
  }

  markPersisted() {
    this._persistenceDirty = false;
  }

  get hasPendingTracking() {
    return Boolean(this._persistenceDirty || this._state);
  }

  get needsPersistence() {
    return this._persistenceDirty;
  }

  acknowledgeDetected({ targetRef }) {
    const state = this._state;
    if (!state?.detected || !validRef(targetRef)) return false;
    state.targetRef = targetRef.trim();
    this._persistenceDirty = true;
    return true;
  }

  acknowledgeNormal({ targetRef, normalStartedAt, complete, eligibleAt, resolvedAt, confirmedAt, abandon }) {
    const state = this._state;
    if (!state || state.targetRef !== targetRef || state.normalStartedAt !== normalStartedAt) return false;
    if (abandon === true) {
      this._state = null;
      this._persistenceDirty = true;
      return true;
    }
    if (complete === true) {
      const resolved = Date.parse(resolvedAt ?? eligibleAt);
      if (!Number.isFinite(resolved)) return false;
      state.awaitingNormalAck = false;
      state.nextNormalObservationAt = null;
      state.resolutionPending = {
        resolvedAt: resolved,
        confirmedAt: Number.isFinite(confirmedAt) ? confirmedAt : resolved,
        stabilizationMinutes: Math.max(0, Math.round((resolved - normalStartedAt) / MIN)),
      };
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

  evaluate({ activeSources, eligible, targetEnded, now }) {
    if (!Number.isFinite(now)) throw new Error('빈방 장치 관측 시각이 올바르지 않습니다');
    const sources = normalizeSources(activeSources);
    const state = this._state;

    if (state?.resolutionPending) return this._emitResolvedAndRestart(state, sources, eligible, now);

    if (targetEnded) {
      if (!state) return [];
      if (!state.detected) {
        this._state = null;
        this._persistenceDirty = true;
        return [];
      }
      state.endedAt ??= now;
      if (!state.targetRef) {
        this._persistenceDirty = true;
        return [];
      }
      const event = this._ended(state, state.endedAt);
      this._state = null;
      this._persistenceDirty = true;
      return [event];
    }

    // 입실 준비·정비·청소 중에는 새 빈방 이상을 만들거나 기존 정상 시간을
    // 추정하지 않는다. 다음 실제 공실 관측 또는 입실까지 기존 추적만 보존한다.
    if (!eligible) return [];

    if (sources === null) {
      if (!state) return [];
      if (!state.detected) {
        this._state = null;
      } else if (state.normalStartedAt != null) {
        state.normalStartedAt = null;
        state.awaitingNormalAck = false;
        state.nextNormalObservationAt = null;
        state.normalRestartRequired = true;
      }
      this._persistenceDirty = true;
      return [];
    }

    if (sources.length) return this._active(sources, now);
    return this._normal(now);
  }

  _active(sources, now) {
    if (!this._state) {
      this._state = newTracking(now);
      this._persistenceDirty = true;
      return [];
    }
    const state = this._state;
    if (!state.detected) {
      if (now - state.activeStartedAt < DETECTION_MS) return [];
      const occurredAt = state.activeStartedAt + DETECTION_MS;
      state.detected = true;
      this._persistenceDirty = true;
      return [{
        type: 'vacant_energy_waste_detected',
        reason: `빈방 장치 ${VACANT_ENERGY_DETECTION_MINUTES}분 이상 가동`,
        timestamp: occurredAt,
        data: {
          detectionMinutes: VACANT_ENERGY_DETECTION_MINUTES,
          conditionStartedAt: new Date(state.activeStartedAt).toISOString(),
          activeSources: sources,
        },
      }];
    }

    if (state.normalStartedAt == null) return [];
    state.normalStartedAt = null;
    state.awaitingNormalAck = false;
    state.nextNormalObservationAt = null;
    state.normalRestartRequired = false;
    this._persistenceDirty = true;
    if (!state.targetRef) return [];
    return [{
      type: 'vacant_energy_waste_recurred',
      reason: '빈방 장치 가동 재확인',
      timestamp: now,
      data: {
        targetRef: state.targetRef,
        detectionMinutes: VACANT_ENERGY_DETECTION_MINUTES,
        activeSources: sources,
      },
    }];
  }

  _normal(now) {
    const state = this._state;
    if (!state) return [];
    if (!state.detected) {
      this._state = null;
      this._persistenceDirty = true;
      return [];
    }
    if (state.normalStartedAt == null) state.normalStartedAt = now;
    if (!state.targetRef || state.awaitingNormalAck) return [];
    if (state.nextNormalObservationAt != null && now < state.nextNormalObservationAt) return [];
    state.awaitingNormalAck = true;
    state.nextNormalObservationAt = null;
    const restartStabilization = state.normalRestartRequired;
    state.normalRestartRequired = false;
    this._persistenceDirty = true;
    return [{
      type: 'vacant_energy_waste_normal',
      reason: '빈방 장치 꺼짐 확인',
      timestamp: now,
      data: {
        targetRef: state.targetRef,
        detectionMinutes: VACANT_ENERGY_DETECTION_MINUTES,
        normalStartedAt: new Date(state.normalStartedAt).toISOString(),
        ...(restartStabilization ? { restartStabilization: true } : {}),
      },
    }];
  }

  _emitResolvedAndRestart(state, sources, eligible, now) {
    const pending = state.resolutionPending;
    const event = {
      type: 'vacant_energy_waste_resolved',
      reason: pending.stabilizationMinutes === 0
        ? '빈방 장치 꺼짐 — 즉시 해결 확인'
        : `빈방 장치 꺼짐 — 정상 ${pending.stabilizationMinutes}분 유지 후 해결`,
      timestamp: pending.resolvedAt,
      data: {
        targetRef: state.targetRef,
        detectionMinutes: VACANT_ENERGY_DETECTION_MINUTES,
        stabilizationMinutes: pending.stabilizationMinutes,
        confirmedAt: new Date(pending.confirmedAt).toISOString(),
      },
    };
    this._state = eligible && Array.isArray(sources) && sources.length ? newTracking(now) : null;
    this._persistenceDirty = true;
    return [event];
  }

  _ended(state, now) {
    return {
      type: 'vacant_energy_tracking_ended',
      reason: '빈방 에너지 이상 추적 대상 공실 종료',
      timestamp: now,
      data: { targetRef: state.targetRef },
    };
  }
}
