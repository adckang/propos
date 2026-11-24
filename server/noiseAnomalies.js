/** RF-25 두 번째 정본 감지기 — 체류 중 소음 임계값 초과 3분 지속. */
import { formatAnomalyTimingCriterion } from '../src/domain/anomalyPolicyDomain.js';
import {
  buildAnomalyIncidentKey,
  confirmAnomalyStabilized,
  endAnomaly,
  markAnomalyConditionCleared,
  openAnomaly,
} from './anomalyRepository.js';

export const NOISE_THRESHOLD_DB = 65;
export const NOISE_DETECTION_MINUTES = 3;
const DETECTION_MS = NOISE_DETECTION_MINUTES * 60_000;

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}이 필요합니다`);
  return value.trim();
}

function iso(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} 시각이 올바르지 않습니다`);
  return new Date(time).toISOString();
}

function validateCriterion(data) {
  if (Number(data?.thresholdDb) !== NOISE_THRESHOLD_DB
    || Number(data?.detectionMinutes) !== NOISE_DETECTION_MINUTES) {
    throw new Error('소음 감지 기준이 올바르지 않습니다');
  }
}

export function formatNoiseCriterion(stabilizationMinutes) {
  return `${NOISE_THRESHOLD_DB}dB 초과 · ${formatAnomalyTimingCriterion({
    detectionMinutes: NOISE_DETECTION_MINUTES,
    stabilizationMinutes: Number(stabilizationMinutes),
  })}`;
}

function incidentKey(propertyId, stayId) {
  return buildAnomalyIncidentKey({ type: 'noise', propertyId, stayId });
}

/**
 * events 표에 저장된 Pi 신호를 이상 생명주기에 반영한다. 같은 eventId 재처리는
 * 이력의 sourceEventKey 중복 방지로 안전하다.
 */
export async function reconcileNoiseSignal(pool, input) {
  const eventId = required(input?.eventId, '이벤트');
  const propertyId = required(input?.propertyId, '숙소');
  const type = required(input?.type, '이벤트 유형');
  const observedAt = iso(input?.occurredAt, '관측');
  const data = input?.data ?? {};
  const stayId = required(data.stayId, '내부 숙박');
  const key = incidentKey(propertyId, stayId);

  if (type === 'noise_threshold_sustained') {
    validateCriterion(data);
    const startedAt = iso(data.thresholdStartedAt, '임계값 초과 시작');
    const detectedAt = new Date(Date.parse(startedAt) + DETECTION_MS).toISOString();
    if (Date.parse(detectedAt) > Date.parse(observedAt)) throw new Error('소음 지속 관측 시간이 감지 기준보다 짧습니다');
    const opened = await openAnomaly(pool, {
      propertyId,
      type: 'noise',
      stayId,
      sourceType: 'event',
      sourceRef: eventId,
      sourceEventKey: `noise-sustained:${eventId}`,
      occurredAt: detectedAt,
    });
    return {
      complete: false,
      opened: opened.created,
      resumed: opened.resumed,
      anomalyId: opened.anomaly.id,
      alertLabel: opened.created || opened.resumed
        ? `소음 이상 — ${formatNoiseCriterion(opened.anomaly.stabilization_minutes)}`
        : null,
    };
  }

  if (type === 'noise_threshold_normal') {
    validateCriterion(data);
    const normalStartedAt = iso(data.normalStartedAt, '정상 시작');
    if (Date.parse(normalStartedAt) > Date.parse(observedAt)) throw new Error('정상 시작이 관측 시각보다 늦습니다');
    const cleared = await markAnomalyConditionCleared(pool, {
      incidentKey: key,
      sourceEventKey: `noise-normal-start:${eventId}`,
      occurredAt: normalStartedAt,
      restartStabilization: data.restartStabilization === true,
    });
    if (!cleared.found) return { complete: true, resolved: false };
    if (cleared.ignored === 'OUT_OF_ORDER') return { complete: true, resolved: false, ignored: 'OUT_OF_ORDER' };
    if (cleared.resolved) return { complete: true, resolved: true };
    const confirmed = await confirmAnomalyStabilized(pool, {
      incidentKey: key,
      sourceEventKey: `noise-normal-observed:${eventId}`,
      observedAt,
    });
    if (confirmed.resolved) return { complete: true, resolved: true };
    if (confirmed.state && confirmed.state !== 'STABILIZING') {
      return { complete: true, resolved: false, ignored: confirmed.state };
    }
    return {
      complete: false,
      resolved: false,
      eligibleAt: confirmed.eligibleAt
        ?? new Date(Date.parse(normalStartedAt) + Number(cleared.stabilizationMinutes ?? 0) * 60_000).toISOString(),
    };
  }

  if (type === 'noise_tracking_ended') {
    const ended = await endAnomaly(pool, {
      incidentKey: key,
      state: 'UNRESOLVED_ENDED',
      sourceEventKey: `noise-stay-ended:${eventId}`,
      occurredAt: observedAt,
      details: { reason: 'STAY_ENDED' },
    });
    return { complete: true, ended: ended.ended === true, resolved: false };
  }

  throw new Error(`알 수 없는 소음 이상 신호: ${type}`);
}
