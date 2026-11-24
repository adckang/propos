/**
 * RF-25 소음 이상 신호 추적기.
 *
 * 기존 10분 누적 민원 판정과 별개로, 체류 중 65dB 초과가 3분 이어진 경우만
 * 정본 이상 신호를 만든다. 해결 안정화 시간은 여기서 정하지 않고 서버가 해당
 * 사건에 스냅샷한 DB 정책의 다음 정상 확인 시각을 응답한다.
 */

const MIN = 60_000;

export const NOISE_ANOMALY_THRESHOLD_DB = 65;
export const NOISE_ANOMALY_DETECTION_MINUTES = 3;
const DETECTION_MS = NOISE_ANOMALY_DETECTION_MINUTES * MIN;

function validTime(value) {
  return Number.isFinite(value) && value >= 0;
}

function validStayId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function restoredState(raw) {
  if (!raw || typeof raw !== 'object' || !validStayId(raw.stayId)) return null;
  const state = {
    stayId: raw.stayId.trim(),
    aboveStartedAt: validTime(raw.aboveStartedAt) ? raw.aboveStartedAt : null,
    aboveSignaled: raw.aboveSignaled === true,
    maxDb: Number.isFinite(raw.maxDb) ? raw.maxDb : null,
    active: raw.active === true,
    normalStartedAt: validTime(raw.normalStartedAt) ? raw.normalStartedAt : null,
    awaitingNormalAck: raw.awaitingNormalAck === true,
    nextNormalObservationAt: validTime(raw.nextNormalObservationAt) ? raw.nextNormalObservationAt : null,
    normalRestartRequired: raw.normalRestartRequired === true,
  };
  if (!state.active && state.normalStartedAt != null) return null;
  return state;
}

export class NoiseAnomalyDetector {
  _state = null;
  _persistenceDirty = false;

  snapshot() {
    return this._state ? { ...this._state } : null;
  }

  restore(raw) {
    this._state = restoredState(raw);
    this._persistenceDirty = false;
  }

  markPersisted() {
    this._persistenceDirty = false;
  }

  get hasPendingTracking() {
    return Boolean(this._persistenceDirty || this._state?.active || this._state?.aboveStartedAt != null);
  }

  get needsPersistence() {
    return this._persistenceDirty;
  }

  /**
   * 서버가 normal 신호를 처리한 결과를 반영한다. 응답이 유실되면 outbox의 같은
   * 신호가 재전송되므로, 일치하는 정상 구간의 응답만 받아 다음 확인을 예약한다.
   */
  acknowledgeNormal({ stayId, normalStartedAt, complete, eligibleAt }) {
    const state = this._state;
    if (!state || state.stayId !== stayId || state.normalStartedAt !== normalStartedAt) return false;
    if (complete === true) {
      this._state = null;
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

  evaluate({ noiseLevel, stayId, eligible, now }) {
    if (!Number.isFinite(now)) throw new Error('소음 관측 시각이 올바르지 않습니다');
    const prior = this._state;
    const currentStayId = validStayId(stayId) ? stayId.trim() : null;

    if (!eligible) {
      if (!prior) return [];
      this._state = null;
      this._persistenceDirty = true;
      return prior.active ? [this._ended(prior, now)] : [];
    }

    // 내부 숙박 ID를 잠시 받지 못한 것은 숙박 종료가 아니다.
    if (!currentStayId) return [];

    if (prior && prior.stayId !== currentStayId) {
      this._state = null;
      this._persistenceDirty = true;
      return prior.active ? [this._ended(prior, now)] : [];
    }

    if (!this._state) {
      if (!Number.isFinite(noiseLevel) || noiseLevel <= NOISE_ANOMALY_THRESHOLD_DB) return [];
      this._state = {
        stayId: currentStayId,
        aboveStartedAt: null,
        aboveSignaled: false,
        maxDb: null,
        active: false,
        normalStartedAt: null,
        awaitingNormalAck: false,
        nextNormalObservationAt: null,
        normalRestartRequired: false,
      };
      this._persistenceDirty = true;
    }

    const state = this._state;
    if (!Number.isFinite(noiseLevel)) {
      state.aboveStartedAt = null;
      state.aboveSignaled = false;
      state.maxDb = null;
      if (state.normalStartedAt != null) {
        state.normalStartedAt = null;
        state.awaitingNormalAck = false;
        state.nextNormalObservationAt = null;
        state.normalRestartRequired = true;
      }
      if (!state.active) this._state = null;
      this._persistenceDirty = true;
      return [];
    }
    if (noiseLevel > NOISE_ANOMALY_THRESHOLD_DB) return this._above(state, noiseLevel, now);
    return this._normal(state, noiseLevel, now);
  }

  _above(state, noiseLevel, now) {
    if (state.aboveStartedAt == null) {
      state.aboveStartedAt = now;
      state.aboveSignaled = false;
      state.maxDb = noiseLevel;
      this._persistenceDirty = true;
    } else {
      state.maxDb = Math.max(state.maxDb ?? noiseLevel, noiseLevel);
    }
    if (now - state.aboveStartedAt < DETECTION_MS || state.aboveSignaled) return [];

    const occurredAt = state.aboveStartedAt + DETECTION_MS;
    state.aboveSignaled = true;
    state.active = true;
    state.normalStartedAt = null;
    state.awaitingNormalAck = false;
    state.nextNormalObservationAt = null;
    state.normalRestartRequired = false;
    this._persistenceDirty = true;
    return [{
      type: 'noise_threshold_sustained',
      reason: `소음 ${NOISE_ANOMALY_THRESHOLD_DB}dB 초과 ${NOISE_ANOMALY_DETECTION_MINUTES}분 지속`,
      timestamp: occurredAt,
      data: {
        stayId: state.stayId,
        thresholdDb: NOISE_ANOMALY_THRESHOLD_DB,
        detectionMinutes: NOISE_ANOMALY_DETECTION_MINUTES,
        thresholdStartedAt: new Date(occurredAt - DETECTION_MS).toISOString(),
        maxDb: state.maxDb,
      },
    }];
  }

  _normal(state, noiseLevel, now) {
    state.aboveStartedAt = null;
    state.aboveSignaled = false;
    state.maxDb = null;
    if (!state.active) {
      this._state = null;
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
      type: 'noise_threshold_normal',
      reason: `소음 ${NOISE_ANOMALY_THRESHOLD_DB}dB 이하 정상 확인`,
      timestamp: now,
      data: {
        stayId: state.stayId,
        thresholdDb: NOISE_ANOMALY_THRESHOLD_DB,
        detectionMinutes: NOISE_ANOMALY_DETECTION_MINUTES,
        normalStartedAt: new Date(state.normalStartedAt).toISOString(),
        observedDb: noiseLevel,
        ...(restartStabilization ? { restartStabilization: true } : {}),
      },
    }];
  }

  _ended(state, now) {
    return {
      type: 'noise_tracking_ended',
      reason: '소음 이상 추적 대상 숙박 종료',
      timestamp: now,
      data: { stayId: state.stayId },
    };
  }
}
