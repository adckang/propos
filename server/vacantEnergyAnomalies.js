/** RF-25 세 번째 정본 감지기 — 공실 중 매핑 장치 30분 연속 가동. */
import { formatAnomalyTimingCriterion } from '../src/domain/anomalyPolicyDomain.js';
import {
  buildAnomalyIncidentKey,
  confirmAnomalyStabilized,
  endAnomaly,
  markAnomalyConditionCleared,
  openAnomaly,
} from './anomalyRepository.js';

export const VACANT_ENERGY_DETECTION_MINUTES = 30;
const DETECTION_MS = VACANT_ENERGY_DETECTION_MINUTES * 60_000;

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
  if (Number(data?.detectionMinutes) !== VACANT_ENERGY_DETECTION_MINUTES) {
    throw new Error('빈방 에너지 감지 기준이 올바르지 않습니다');
  }
}

export function formatVacantEnergyCriterion(stabilizationMinutes) {
  return formatAnomalyTimingCriterion({
    detectionMinutes: VACANT_ENERGY_DETECTION_MINUTES,
    stabilizationMinutes: Number(stabilizationMinutes),
  });
}

function incidentKey(propertyId, targetRef) {
  return buildAnomalyIncidentKey({ type: 'vacant_energy_waste', propertyId, targetRef });
}

async function findVacancyAnchor(db, propertyId, conditionStartedAt) {
  const { rows: [anchor] } = await db.query(
    `SELECT id,device_time FROM events
      WHERE property_id=$1
        AND type=ANY($2::text[])
        AND device_time<=$3
      ORDER BY device_time DESC,server_time DESC,id DESC LIMIT 1`,
    [propertyId, ['cleaning_finished', 'scheduled_cleaning_finished'], conditionStartedAt],
  );
  return anchor ?? null;
}

async function findTerminalResolution(db, incidentKey) {
  const { rows: [row] } = await db.query(
    `SELECT h.state,h.occurred_at
       FROM automation_anomalies a
       JOIN automation_anomaly_history h ON h.anomaly_id=a.id
      WHERE a.incident_key=$1 AND h.history_type='RESOLUTION'
      ORDER BY h.occurred_at DESC,h.recorded_at DESC,h.id DESC LIMIT 1`,
    [incidentKey],
  );
  return row ?? null;
}

/** events 표에 저장된 Pi 신호를 이상 생명주기에 반영한다. */
export async function reconcileVacantEnergySignal(pool, input) {
  const eventId = required(input?.eventId, '이벤트');
  const propertyId = required(input?.propertyId, '숙소');
  const type = required(input?.type, '이벤트 유형');
  const observedAt = iso(input?.occurredAt, '관측');
  const data = input?.data ?? {};

  if (type === 'vacant_energy_waste_detected') {
    validateCriterion(data);
    const conditionStartedAt = iso(data.conditionStartedAt, '장치 가동 시작');
    const detectedAt = new Date(Date.parse(conditionStartedAt) + DETECTION_MS).toISOString();
    if (Date.parse(detectedAt) > Date.parse(observedAt)) throw new Error('빈방 장치 가동 시간이 감지 기준보다 짧습니다');
    const anchor = await findVacancyAnchor(pool, propertyId, conditionStartedAt);
    if (!anchor) throw new Error('빈방 구간을 시작한 청소 완료 기록을 찾을 수 없습니다');
    const targetRef = required(anchor.id, '빈방 구간');
    const opened = await openAnomaly(pool, {
      propertyId,
      type: 'vacant_energy_waste',
      targetRef,
      sourceType: 'event',
      sourceRef: eventId,
      sourceEventKey: `vacant-energy-detected:${eventId}`,
      occurredAt: detectedAt,
    });
    return {
      complete: false,
      opened: opened.created,
      resumed: opened.resumed,
      anomalyId: opened.anomaly.id,
      targetRef,
      alertLabel: opened.created || opened.resumed
        ? `빈방 에너지 낭비 — ${formatVacantEnergyCriterion(opened.anomaly.stabilization_minutes)}`
        : null,
    };
  }

  const targetRef = required(data.targetRef, '빈방 구간');
  const key = incidentKey(propertyId, targetRef);

  if (type === 'vacant_energy_waste_recurred') {
    validateCriterion(data);
    const opened = await openAnomaly(pool, {
      propertyId,
      type: 'vacant_energy_waste',
      targetRef,
      sourceType: 'event',
      sourceRef: eventId,
      sourceEventKey: `vacant-energy-recurred:${eventId}`,
      occurredAt: observedAt,
    });
    return {
      complete: false,
      opened: opened.created,
      resumed: opened.resumed,
      anomalyId: opened.anomaly.id,
      targetRef,
      alertLabel: opened.created || opened.resumed
        ? `빈방 에너지 낭비 — ${formatVacantEnergyCriterion(opened.anomaly.stabilization_minutes)}`
        : null,
    };
  }

  if (type === 'vacant_energy_waste_normal') {
    validateCriterion(data);
    const normalStartedAt = iso(data.normalStartedAt, '정상 시작');
    if (Date.parse(normalStartedAt) > Date.parse(observedAt)) throw new Error('정상 시작이 관측 시각보다 늦습니다');
    const cleared = await markAnomalyConditionCleared(pool, {
      incidentKey: key,
      sourceEventKey: `vacant-energy-normal-start:${eventId}`,
      occurredAt: normalStartedAt,
      restartStabilization: data.restartStabilization === true,
    });
    if (!cleared.found) {
      const terminal = await findTerminalResolution(pool, key);
      if (terminal?.state === 'RESOLVED') {
        return {
          complete: true,
          resolved: true,
          targetRef,
          resolvedAt: new Date(terminal.occurred_at).toISOString(),
        };
      }
      return { complete: true, resolved: false, targetRef, abandon: true };
    }
    if (cleared.ignored === 'OUT_OF_ORDER') {
      return { complete: true, resolved: false, targetRef, abandon: true, ignored: 'OUT_OF_ORDER' };
    }
    if (cleared.resolved) {
      return { complete: true, resolved: true, targetRef, resolvedAt: cleared.occurredAt };
    }
    const confirmed = await confirmAnomalyStabilized(pool, {
      incidentKey: key,
      sourceEventKey: `vacant-energy-normal-observed:${eventId}`,
      observedAt,
    });
    if (confirmed.resolved) {
      return { complete: true, resolved: true, targetRef, resolvedAt: confirmed.occurredAt };
    }
    if (confirmed.state && confirmed.state !== 'STABILIZING') {
      return { complete: true, resolved: false, targetRef, abandon: true, ignored: confirmed.state };
    }
    return {
      complete: false,
      resolved: false,
      targetRef,
      eligibleAt: confirmed.eligibleAt
        ?? new Date(Date.parse(normalStartedAt) + Number(cleared.stabilizationMinutes ?? 0) * 60_000).toISOString(),
    };
  }

  if (type === 'vacant_energy_tracking_ended') {
    const ended = await endAnomaly(pool, {
      incidentKey: key,
      state: 'UNRESOLVED_ENDED',
      sourceEventKey: `vacant-energy-vacancy-ended:${eventId}`,
      occurredAt: observedAt,
      details: { reason: 'NEXT_STAY_STARTED' },
    });
    return { complete: true, targetRef, ended: ended.ended === true, resolved: false };
  }

  if (type === 'vacant_energy_waste_resolved') {
    validateCriterion(data);
    const confirmedAt = iso(data.confirmedAt, '정상 확인');
    const confirmed = await confirmAnomalyStabilized(pool, {
      incidentKey: key,
      sourceEventKey: `vacant-energy-resolved:${eventId}`,
      observedAt: confirmedAt,
    });
    return {
      complete: true,
      targetRef,
      resolved: confirmed.resolved === true,
      resolvedAt: confirmed.occurredAt ?? observedAt,
    };
  }

  throw new Error(`알 수 없는 빈방 에너지 이상 신호: ${type}`);
}
