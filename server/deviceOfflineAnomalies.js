/** RF-25 네 번째 정본 감지기 — 매핑 기기 unavailable 30분 지속. */
import { formatAnomalyTimingCriterion } from '../src/domain/anomalyPolicyDomain.js';
import {
  buildAnomalyIncidentKey,
  confirmAnomalyStabilized,
  endAnomaly,
  markAnomalyConditionCleared,
  openAnomaly,
} from './anomalyRepository.js';

export const DEVICE_OFFLINE_DETECTION_MINUTES = 30;
const DETECTION_MS = DEVICE_OFFLINE_DETECTION_MINUTES * 60_000;

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
  if (Number(data?.detectionMinutes) !== DEVICE_OFFLINE_DETECTION_MINUTES) {
    throw new Error('기기 오프라인 감지 기준이 올바르지 않습니다');
  }
}

export function formatDeviceOfflineCriterion(stabilizationMinutes) {
  return formatAnomalyTimingCriterion({
    detectionMinutes: DEVICE_OFFLINE_DETECTION_MINUTES,
    stabilizationMinutes: Number(stabilizationMinutes),
  });
}

function incidentKey(propertyId, entityId) {
  return buildAnomalyIncidentKey({ type: 'device_offline', propertyId, targetRef: entityId });
}

/** events 표에 저장된 Pi 신호를 기기별 이상 생명주기에 반영한다. */
export async function reconcileDeviceOfflineSignal(pool, input) {
  const eventId = required(input?.eventId, '이벤트');
  const propertyId = required(input?.propertyId, '숙소');
  const type = required(input?.type, '이벤트 유형');
  const observedAt = iso(input?.occurredAt, '관측');
  const data = input?.data ?? {};
  const entityId = required(data.entityId, '기기 식별자');
  const deviceName = required(data.deviceName ?? entityId, '기기 이름');
  const key = incidentKey(propertyId, entityId);

  if (type === 'device_offline_detected') {
    validateCriterion(data);
    const startedAt = iso(data.offlineStartedAt, '연결 끊김 시작');
    const detectedAt = new Date(Date.parse(startedAt) + DETECTION_MS).toISOString();
    if (Date.parse(detectedAt) > Date.parse(observedAt)) throw new Error('기기 연결 끊김 관측 시간이 감지 기준보다 짧습니다');
    const opened = await openAnomaly(pool, {
      propertyId,
      type: 'device_offline',
      targetRef: entityId,
      sourceType: 'event',
      sourceRef: eventId,
      sourceEventKey: `device-offline:${eventId}`,
      occurredAt: detectedAt,
    });
    return {
      complete: false,
      opened: opened.created,
      resumed: opened.resumed,
      anomalyId: opened.anomaly.id,
      entityId,
      alertLabel: opened.created || opened.resumed
        ? `기기 오프라인 — ${deviceName} · ${formatDeviceOfflineCriterion(opened.anomaly.stabilization_minutes)}`
        : null,
    };
  }

  if (type === 'device_offline_recurred') {
    validateCriterion(data);
    const opened = await openAnomaly(pool, {
      propertyId,
      type: 'device_offline',
      targetRef: entityId,
      sourceType: 'event',
      sourceRef: eventId,
      sourceEventKey: `device-offline-recurred:${eventId}`,
      occurredAt: observedAt,
    });
    return {
      complete: false,
      opened: opened.created,
      resumed: opened.resumed,
      anomalyId: opened.anomaly.id,
      entityId,
      alertLabel: opened.created || opened.resumed
        ? `기기 오프라인 — ${deviceName} · ${formatDeviceOfflineCriterion(opened.anomaly.stabilization_minutes)}`
        : null,
    };
  }

  if (type === 'device_online_normal') {
    validateCriterion(data);
    const normalStartedAt = iso(data.normalStartedAt, '정상 시작');
    if (Date.parse(normalStartedAt) > Date.parse(observedAt)) throw new Error('정상 시작이 관측 시각보다 늦습니다');
    const cleared = await markAnomalyConditionCleared(pool, {
      incidentKey: key,
      sourceEventKey: `device-online-start:${eventId}`,
      occurredAt: normalStartedAt,
      restartStabilization: data.restartStabilization === true,
    });
    if (!cleared.found || cleared.ignored === 'OUT_OF_ORDER') {
      return { complete: true, resolved: false, entityId, ignored: cleared.ignored };
    }
    if (cleared.resolved) return { complete: true, resolved: true, entityId };
    const confirmed = await confirmAnomalyStabilized(pool, {
      incidentKey: key,
      sourceEventKey: `device-online-observed:${eventId}`,
      observedAt,
    });
    if (confirmed.resolved) return { complete: true, resolved: true, entityId };
    if (confirmed.state && confirmed.state !== 'STABILIZING') {
      return { complete: true, resolved: false, entityId, ignored: confirmed.state };
    }
    return {
      complete: false,
      resolved: false,
      entityId,
      eligibleAt: confirmed.eligibleAt
        ?? new Date(Date.parse(normalStartedAt) + Number(cleared.stabilizationMinutes ?? 0) * 60_000).toISOString(),
    };
  }

  if (type === 'device_offline_tracking_removed') {
    const ended = await endAnomaly(pool, {
      incidentKey: key,
      state: 'TARGET_REMOVED',
      sourceEventKey: `device-removed:${eventId}`,
      occurredAt: observedAt,
      details: { reason: 'DEVICE_MAPPING_REMOVED', deviceName },
    });
    return { complete: true, entityId, ended: ended.ended === true, resolved: false };
  }

  throw new Error(`알 수 없는 기기 오프라인 이상 신호: ${type}`);
}
