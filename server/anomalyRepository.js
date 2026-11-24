/**
 * RF-25 이상 본체·이력 저장소.
 *
 * 감지기는 이 저장소에 정본 5가지의 발생/정상 신호만 전달한다. 정책 선택, 열린 사건
 * 중복 방지, 안정화 판정, 종료와 열린 매핑 해제는 같은 DB 트랜잭션에서 처리한다.
 */
import { resolveAnomalyPolicy } from '../src/domain/anomalyPolicyDomain.js';

const TERMINAL_STATES = new Set(['UNRESOLVED_ENDED', 'TARGET_REMOVED']);
const INTERVENTION_ACTORS = new Set(['ADMIN', 'OPERATOR']);
const OPEN_RETRY = Symbol('OPEN_RETRY');

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}이 필요합니다`);
  return value.trim();
}

function asIso(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} 시각이 올바르지 않습니다`);
  return date.toISOString();
}

function component(value) {
  return encodeURIComponent(required(value, '사건 열쇠 값'));
}

export function buildAnomalyIncidentKey({ type, propertyId, stayId, cleaningObligationId, targetRef }) {
  const prefix = `${component(type)}:${component(propertyId)}`;
  if (type === 'noise') return `${prefix}:stay:${component(stayId)}`;
  if (type === 'guest_complaint_sensor') {
    return `${prefix}:stay:${component(stayId)}:topic:${component(targetRef)}`;
  }
  if (type === 'cleaning_unassigned') return `${prefix}:obligation:${component(cleaningObligationId)}`;
  if (type === 'vacant_energy_waste' || type === 'device_offline') {
    return `${prefix}:target:${component(targetRef)}`;
  }
  throw new Error(`알 수 없는 이상 유형: ${type}`);
}

async function transaction(pool, work) {
  if (typeof pool?.connect !== 'function') throw new Error('이상 기록에는 트랜잭션 연결이 필요합니다');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function versionFromRows(rows) {
  if (!rows.length) return null;
  return {
    versionId: rows[0].version_id,
    effectiveFrom: new Date(rows[0].effective_from).toISOString(),
    values: Object.fromEntries(rows.map(row => [row.anomaly_type, Number(row.stabilization_minutes)])),
  };
}

async function loadVersion(db, { scope, propertyId, occurredAt }) {
  const propertyClause = scope === 'MASTER' ? 'v.property_id IS NULL' : 'v.property_id=$3';
  const params = scope === 'MASTER' ? [scope, occurredAt] : [scope, occurredAt, propertyId];
  const { rows } = await db.query(
    `SELECT v.id AS version_id,v.effective_from,p.anomaly_type,p.stabilization_minutes
       FROM automation_policy_versions v
       JOIN automation_policy_values p ON p.policy_version_id=v.id
      WHERE v.id=(
        SELECT id FROM automation_policy_versions
         WHERE scope=$1 AND effective_from<=$2 AND ${propertyClause.replaceAll('v.', '')}
         ORDER BY effective_from DESC,id DESC LIMIT 1
      )
      ORDER BY p.anomaly_type`,
    params,
  );
  return versionFromRows(rows);
}

export async function loadEffectiveAnomalyPolicy(db, { propertyId, type, occurredAt }) {
  const at = asIso(occurredAt, '이상 발생');
  const master = await loadVersion(db, { scope: 'MASTER', propertyId, occurredAt: at });
  const property = await loadVersion(db, { scope: 'PROPERTY', propertyId, occurredAt: at });
  return resolveAnomalyPolicy({ type, master, property });
}

async function findOpen(db, incidentKey) {
  const { rows: [row] } = await db.query(
    `SELECT a.* FROM automation_open_incidents oi
       JOIN automation_anomalies a ON a.id=oi.anomaly_id
      WHERE oi.incident_key=$1
      FOR UPDATE OF oi`,
    [incidentKey],
  );
  return row ?? null;
}

async function latestState(db, anomalyId) {
  const { rows: [row] } = await db.query(
    `SELECT state,occurred_at,recorded_at FROM automation_anomaly_history
      WHERE anomaly_id=$1 AND state IS NOT NULL
      ORDER BY occurred_at DESC,recorded_at DESC,id DESC LIMIT 1`,
    [anomalyId],
  );
  return row ?? null;
}

async function appendHistory(db, {
  anomalyId, historyType, state = null, actorType = null, sourceEventKey, occurredAt, details = {},
}) {
  const { rows } = await db.query(
    `INSERT INTO automation_anomaly_history
       (anomaly_id,history_type,state,actor_type,source_event_key,occurred_at,details)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (anomaly_id,history_type,source_event_key) DO NOTHING
     RETURNING *`,
    [anomalyId, historyType, state, actorType, sourceEventKey, occurredAt, JSON.stringify(details ?? {})],
  );
  return { inserted: rows.length > 0, history: rows[0] ?? null };
}

async function resumeIfNeeded(db, anomaly, { sourceEventKey, occurredAt }) {
  const current = await latestState(db, anomaly.id);
  if (!current) throw new Error(`이상 상태 이력이 없습니다 (${anomaly.id})`);
  if (Date.parse(occurredAt) < new Date(current.occurred_at).getTime()) {
    return { resumed: false, ignored: 'OUT_OF_ORDER' };
  }
  if (current.state !== 'STABILIZING') return { resumed: false };
  const saved = await appendHistory(db, {
    anomalyId: anomaly.id,
    historyType: 'STATE_CHANGE',
    state: 'IN_PROGRESS',
    actorType: 'SYSTEM',
    sourceEventKey,
    occurredAt,
    details: { reason: 'CONDITION_RECURRED' },
  });
  return { resumed: saved.inserted };
}

async function openOnce(pool, input) {
  const propertyId = required(input?.propertyId, '숙소');
  const type = required(input?.type, '이상 유형');
  const sourceType = required(input?.sourceType, '원본 유형');
  const sourceRef = required(input?.sourceRef, '원본 참조');
  const sourceEventKey = required(input?.sourceEventKey, '원본 이벤트 열쇠');
  const occurredAt = asIso(input?.occurredAt, '이상 발생');
  const incidentKey = buildAnomalyIncidentKey({
    type, propertyId, stayId: input?.stayId,
    cleaningObligationId: input?.cleaningObligationId, targetRef: input?.targetRef,
  });

  return transaction(pool, async db => {
    let anomaly = await findOpen(db, incidentKey);
    if (anomaly) {
      const transition = await resumeIfNeeded(db, anomaly, { sourceEventKey, occurredAt });
      return { created: false, anomaly, ...transition };
    }

    const policy = await loadEffectiveAnomalyPolicy(db, { propertyId, type, occurredAt });
    const { rows: [previous] } = await db.query(
      `SELECT id FROM automation_anomalies WHERE incident_key=$1
        ORDER BY occurred_at DESC,recorded_at DESC,id DESC LIMIT 1`,
      [incidentKey],
    );
    const { rows: [candidate] } = await db.query(
      `INSERT INTO automation_anomalies
         (property_id,anomaly_type,incident_key,previous_anomaly_id,stay_id,cleaning_obligation_id,
          target_ref,source_type,source_ref,master_policy_version_id,property_policy_version_id,
          stabilization_minutes,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [propertyId, type, incidentKey, previous?.id ?? null, input?.stayId ?? null,
       input?.cleaningObligationId ?? null, input?.targetRef ?? null, sourceType, sourceRef,
       policy.masterPolicyVersionId, policy.propertyPolicyVersionId,
       policy.stabilizationMinutes, occurredAt],
    );
    const { rows: claimed } = await db.query(
      `INSERT INTO automation_open_incidents(incident_key,anomaly_id)
       VALUES($1,$2) ON CONFLICT (incident_key) DO NOTHING RETURNING anomaly_id`,
      [incidentKey, candidate.id],
    );
    if (!claimed.length) {
      await db.query('DELETE FROM automation_anomalies WHERE id=$1', [candidate.id]);
      anomaly = await findOpen(db, incidentKey);
      if (!anomaly) throw OPEN_RETRY;
      const transition = await resumeIfNeeded(db, anomaly, { sourceEventKey, occurredAt });
      return { created: false, anomaly, ...transition };
    }
    await appendHistory(db, {
      anomalyId: candidate.id,
      historyType: 'STATE_CHANGE',
      state: 'IN_PROGRESS',
      actorType: 'SYSTEM',
      sourceEventKey,
      occurredAt,
      details: { sourceType, sourceRef },
    });
    return { created: true, anomaly: candidate, resumed: false };
  });
}

export async function openAnomaly(pool, input) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await openOnce(pool, input);
    } catch (error) {
      if (error !== OPEN_RETRY || attempt === 2) throw error;
    }
  }
  throw new Error('이상 사건을 열지 못했습니다');
}

async function finish(db, anomaly, { state, sourceEventKey, occurredAt, details }) {
  const saved = await appendHistory(db, {
    anomalyId: anomaly.id,
    historyType: 'RESOLUTION',
    state,
    actorType: 'SYSTEM',
    sourceEventKey,
    occurredAt,
    details,
  });
  await db.query(
    'DELETE FROM automation_open_incidents WHERE incident_key=$1 AND anomaly_id=$2',
    [anomaly.incident_key, anomaly.id],
  );
  return { ended: true, resolved: state === 'RESOLVED', inserted: saved.inserted, occurredAt };
}

export async function markAnomalyConditionCleared(pool, input) {
  const incidentKey = required(input?.incidentKey, '사건 열쇠');
  const sourceEventKey = required(input?.sourceEventKey, '원본 이벤트 열쇠');
  const occurredAt = asIso(input?.occurredAt, '조건 해소');
  return transaction(pool, async db => {
    const anomaly = await findOpen(db, incidentKey);
    if (!anomaly) return { found: false, resolved: false };
    const current = await latestState(db, anomaly.id);
    if (!current) throw new Error(`이상 상태 이력이 없습니다 (${anomaly.id})`);
    if (Date.parse(occurredAt) < new Date(current.occurred_at).getTime()) {
      return { found: true, resolved: false, ignored: 'OUT_OF_ORDER' };
    }
    if (current.state === 'STABILIZING') {
      if (input?.restartStabilization !== true) {
        return { found: true, resolved: false, alreadyStabilizing: true,
          stabilizationMinutes: Number(anomaly.stabilization_minutes) };
      }
      const saved = await appendHistory(db, {
        anomalyId: anomaly.id,
        historyType: 'STATE_CHANGE',
        state: 'STABILIZING',
        actorType: 'SYSTEM',
        sourceEventKey,
        occurredAt,
        details: { conditionClearedAt: occurredAt, reason: 'NORMAL_OBSERVATION_RESTARTED' },
      });
      return { found: true, resolved: false, stabilizationRestarted: saved.inserted,
        stabilizationMinutes: Number(anomaly.stabilization_minutes) };
    }
    if (current.state !== 'IN_PROGRESS') throw new Error(`열린 이상의 현재 상태가 올바르지 않습니다 (${current.state})`);
    await appendHistory(db, {
      anomalyId: anomaly.id,
      historyType: 'STATE_CHANGE',
      state: 'STABILIZING',
      actorType: 'SYSTEM',
      sourceEventKey,
      occurredAt,
      details: { conditionClearedAt: occurredAt },
    });
    if (Number(anomaly.stabilization_minutes) !== 0) {
      return { found: true, resolved: false, stabilizationMinutes: Number(anomaly.stabilization_minutes) };
    }
    return finish(db, anomaly, {
      state: 'RESOLVED', sourceEventKey, occurredAt,
      details: { conditionClearedAt: occurredAt, confirmedAt: occurredAt },
    });
  });
}

export async function confirmAnomalyStabilized(pool, input) {
  const incidentKey = required(input?.incidentKey, '사건 열쇠');
  const sourceEventKey = required(input?.sourceEventKey, '원본 이벤트 열쇠');
  const observedAt = asIso(input?.observedAt, '정상 확인');
  return transaction(pool, async db => {
    const anomaly = await findOpen(db, incidentKey);
    if (!anomaly) return { found: false, resolved: false };
    const current = await latestState(db, anomaly.id);
    if (!current) throw new Error(`이상 상태 이력이 없습니다 (${anomaly.id})`);
    if (current.state !== 'STABILIZING') return { found: true, resolved: false, state: current.state };
    const clearedAt = new Date(current.occurred_at);
    const resolutionAt = new Date(clearedAt.getTime() + Number(anomaly.stabilization_minutes) * 60_000);
    if (Date.parse(observedAt) < resolutionAt.getTime()) {
      return { found: true, resolved: false, eligibleAt: resolutionAt.toISOString() };
    }
    return finish(db, anomaly, {
      state: 'RESOLVED', sourceEventKey, occurredAt: resolutionAt.toISOString(),
      details: { conditionClearedAt: clearedAt.toISOString(), confirmedAt: observedAt },
    });
  });
}

export async function endAnomaly(pool, input) {
  const incidentKey = required(input?.incidentKey, '사건 열쇠');
  const state = required(input?.state, '종료 상태');
  if (!TERMINAL_STATES.has(state)) throw new Error(`종료 상태가 올바르지 않습니다: ${state}`);
  const sourceEventKey = required(input?.sourceEventKey, '원본 이벤트 열쇠');
  const occurredAt = asIso(input?.occurredAt, '종료');
  return transaction(pool, async db => {
    const anomaly = await findOpen(db, incidentKey);
    if (!anomaly) return { found: false, ended: false, resolved: false };
    const current = await latestState(db, anomaly.id);
    if (!current) throw new Error(`이상 상태 이력이 없습니다 (${anomaly.id})`);
    if (Date.parse(occurredAt) < new Date(current.occurred_at).getTime()) {
      return { found: true, ended: false, resolved: false, ignored: 'OUT_OF_ORDER' };
    }
    return finish(db, anomaly, {
      state, sourceEventKey, occurredAt, details: input?.details ?? {},
    });
  });
}

export async function recordAnomalyIntervention(db, input) {
  const anomalyId = required(input?.anomalyId, '이상 번호');
  const actorType = required(input?.actorType, '개입 주체');
  if (!INTERVENTION_ACTORS.has(actorType)) throw new Error('개입 주체는 관리자 또는 운영자여야 합니다');
  return appendHistory(db, {
    anomalyId,
    historyType: 'INTERVENTION',
    actorType,
    sourceEventKey: required(input?.sourceEventKey, '요청 열쇠'),
    occurredAt: asIso(input?.occurredAt, '개입'),
    details: input?.details ?? {},
  });
}
