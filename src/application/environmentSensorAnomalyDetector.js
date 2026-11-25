/** RF-25 게스트 온습도 불만과 교차 확인할 센서 이상 구간 추적기. */
import { THRESHOLDS as CFG } from '../config/monitoringThresholds.js';

const MIN = 60_000;
const MATCH_WINDOW_MS = 60 * MIN;
const UNMATCHED_NORMAL_RECHECK_MS = 10 * MIN;
export const ENVIRONMENT_SENSOR_DETECTION_MINUTES = CFG.ENERGY_DETECT_MIN;
const DETECTION_MS = ENVIRONMENT_SENSOR_DETECTION_MINUTES * MIN;
const TOPICS = new Set(['temperature', 'humidity']);

function validTime(value) { return Number.isFinite(value) && value >= 0; }
function validStayId(value) { return typeof value === 'string' && value.trim().length > 0; }

function restoreTopic(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const state = {
    issueStartedAt: validTime(raw.issueStartedAt) ? raw.issueStartedAt : null,
    detectedAt: validTime(raw.detectedAt) ? raw.detectedAt : null,
    normalStartedAt: validTime(raw.normalStartedAt) ? raw.normalStartedAt : null,
    awaitingNormalAck: raw.awaitingNormalAck === true,
    nextNormalObservationAt: validTime(raw.nextNormalObservationAt) ? raw.nextNormalObservationAt : null,
    retainUntil: validTime(raw.retainUntil) ? raw.retainUntil : null,
    normalRestartRequired: raw.normalRestartRequired === true,
  };
  return state.issueStartedAt != null || state.detectedAt != null ? state : null;
}

function newTopic(now) {
  return { issueStartedAt: now, detectedAt: null, normalStartedAt: null,
    awaitingNormalAck: false, nextNormalObservationAt: null, retainUntil: null,
    normalRestartRequired: false };
}

export class EnvironmentSensorAnomalyDetector {
  _stayId = null;
  _topics = new Map();
  _persistenceDirty = false;

  snapshot() {
    if (!this._stayId || !this._topics.size) return null;
    return { stayId: this._stayId, topics: Object.fromEntries([...this._topics].map(([topic, state]) => [topic, { ...state }])) };
  }

  restore(raw) {
    this._stayId = validStayId(raw?.stayId) ? raw.stayId.trim() : null;
    this._topics = new Map();
    if (this._stayId && raw?.topics && typeof raw.topics === 'object' && !Array.isArray(raw.topics)) {
      for (const [topic, value] of Object.entries(raw.topics)) {
        const state = TOPICS.has(topic) ? restoreTopic(value) : null;
        if (state) this._topics.set(topic, state);
      }
    }
    if (!this._topics.size) this._stayId = null;
    this._persistenceDirty = false;
  }

  markPersisted() { this._persistenceDirty = false; }
  get hasPendingTracking() { return this._persistenceDirty || this._topics.size > 0; }
  get needsPersistence() { return this._persistenceDirty; }

  acknowledgeNormal({ stayId, normalStartedAtByTopic, results }) {
    if (stayId !== this._stayId || !results || typeof results !== 'object') return false;
    let changed = false;
    for (const [topic, result] of Object.entries(results)) {
      const state = this._topics.get(topic);
      const expected = Date.parse(normalStartedAtByTopic?.[topic]);
      if (!state || state.normalStartedAt !== expected) continue;
      state.awaitingNormalAck = false;
      if (result?.complete === true) {
        this._topics.delete(topic);
      } else {
        const eligibleAt = Date.parse(result?.eligibleAt);
        const fallback = Date.now() + UNMATCHED_NORMAL_RECHECK_MS;
        state.nextNormalObservationAt = Number.isFinite(eligibleAt) ? eligibleAt : fallback;
        if (Number.isFinite(eligibleAt)) state.retainUntil = Math.max(state.retainUntil ?? 0, eligibleAt);
      }
      changed = true;
    }
    if (!this._topics.size) this._stayId = null;
    if (changed) this._persistenceDirty = true;
    return changed;
  }

  evaluate({ issueTopics, stayId, eligible, observed, now }) {
    if (!Number.isFinite(now)) throw new Error('온습도 관측 시각이 올바르지 않습니다');
    const currentStay = validStayId(stayId) ? stayId.trim() : null;
    if (!eligible || (this._stayId && currentStay && this._stayId !== currentStay)) {
      const ended = this._end(now);
      if (!eligible || !currentStay) return ended;
    }
    if (!currentStay) return [];
    if (!this._stayId) this._stayId = currentStay;
    if (!observed) return this._gap();
    const issues = new Set(Array.isArray(issueTopics) ? issueTopics.filter(topic => TOPICS.has(topic)) : []);
    const active = [];
    const normal = [];
    for (const topic of TOPICS) {
      if (issues.has(topic)) this._issue(topic, now, active);
      else this._normal(topic, now, normal);
    }
    this._prune(now);
    const events = [];
    if (active.length) events.push(this._activeEvent(active, now));
    if (normal.length) events.push(this._normalEvent(normal, now));
    return events;
  }

  _issue(topic, now, active) {
    let state = this._topics.get(topic);
    if (!state) {
      state = newTopic(now);
      this._topics.set(topic, state);
      this._persistenceDirty = true;
      return;
    }
    if (state.detectedAt != null && state.normalStartedAt != null) {
      state.issueStartedAt = now;
      state.detectedAt = now;
      state.normalStartedAt = null;
      state.awaitingNormalAck = false;
      state.nextNormalObservationAt = null;
      state.retainUntil = now + MATCH_WINDOW_MS;
      state.normalRestartRequired = false;
      active.push({ topic, issueStartedAt: now, detectedAt: now, recurred: true });
      this._persistenceDirty = true;
      return;
    }
    if (state.detectedAt != null || now - state.issueStartedAt < DETECTION_MS) return;
    state.detectedAt = state.issueStartedAt + DETECTION_MS;
    state.retainUntil = state.detectedAt + MATCH_WINDOW_MS;
    active.push({ topic, issueStartedAt: state.issueStartedAt, detectedAt: state.detectedAt, recurred: false });
    this._persistenceDirty = true;
  }

  _normal(topic, now, normal) {
    const state = this._topics.get(topic);
    if (!state) return;
    state.issueStartedAt = null;
    if (state.detectedAt == null) {
      this._topics.delete(topic);
      this._persistenceDirty = true;
      return;
    }
    if (state.normalStartedAt == null) state.normalStartedAt = now;
    const due = state.nextNormalObservationAt == null || now >= state.nextNormalObservationAt;
    if (state.awaitingNormalAck || !due) return;
    state.awaitingNormalAck = true;
    state.nextNormalObservationAt = null;
    normal.push({ topic, normalStartedAt: state.normalStartedAt, detectedAt: state.detectedAt,
      restartStabilization: state.normalRestartRequired });
    state.normalRestartRequired = false;
    this._persistenceDirty = true;
  }

  _gap() {
    let changed = false;
    for (const [topic, state] of this._topics) {
      if (state.detectedAt == null) { this._topics.delete(topic); changed = true; }
      else if (state.normalStartedAt != null) {
        state.normalStartedAt = null;
        state.awaitingNormalAck = false;
        state.nextNormalObservationAt = null;
        state.normalRestartRequired = true;
        changed = true;
      }
    }
    if (!this._topics.size) this._stayId = null;
    if (changed) this._persistenceDirty = true;
    return [];
  }

  _prune(now) {
    for (const [topic, state] of this._topics) {
      if (state.normalStartedAt != null && !state.awaitingNormalAck && state.retainUntil != null && now > state.retainUntil) {
        this._topics.delete(topic);
        this._persistenceDirty = true;
      }
    }
    if (!this._topics.size) this._stayId = null;
  }

  _end(now) {
    if (!this._stayId || !this._topics.size) {
      this._stayId = null; this._topics.clear(); return [];
    }
    const stayId = this._stayId;
    const topics = [...this._topics].filter(([, state]) => state.detectedAt != null).map(([topic]) => topic);
    this._stayId = null; this._topics.clear(); this._persistenceDirty = true;
    return topics.length ? [{ type: 'environment_sensor_tracking_ended', reason: '온습도 이상 추적 대상 숙박 종료',
      timestamp: now, data: { stayId, topics } }] : [];
  }

  _activeEvent(items, now) {
    return { type: 'environment_sensor_anomaly', reason: `온습도 센서 이상: ${items.map(item => item.topic).join(', ')}`,
      timestamp: Math.min(...items.map(item => item.detectedAt)), data: {
        stayId: this._stayId, topics: items.map(item => item.topic),
        detectionMinutes: ENVIRONMENT_SENSOR_DETECTION_MINUTES,
        issueStartedAtByTopic: Object.fromEntries(items.map(item => [item.topic, new Date(item.issueStartedAt).toISOString()])),
        recurredTopics: items.filter(item => item.recurred).map(item => item.topic),
      } };
  }

  _normalEvent(items, now) {
    return { type: 'environment_sensor_normal', reason: `온습도 정상 확인: ${items.map(item => item.topic).join(', ')}`,
      timestamp: now, data: {
        stayId: this._stayId, topics: items.map(item => item.topic),
        detectionMinutes: ENVIRONMENT_SENSOR_DETECTION_MINUTES,
        detectedAtByTopic: Object.fromEntries(items.map(item => [item.topic, new Date(item.detectedAt).toISOString()])),
        normalStartedAtByTopic: Object.fromEntries(items.map(item => [item.topic, new Date(item.normalStartedAt).toISOString()])),
        restartTopics: items.filter(item => item.restartStabilization).map(item => item.topic),
      } };
  }
}
