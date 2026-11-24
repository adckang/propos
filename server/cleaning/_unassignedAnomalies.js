/**
 * RF-25 첫 정본 감지기 — 다음 체크인 12시간 전부터 담당자가 없는 청소 의무.
 *
 * 배정 상태의 현재값을 표본 조회하지 않고 append-only 이력의 UNASSIGNED 구간을 재생한다.
 * 따라서 감지 작업 사이에 배정·취소가 모두 일어나도 발생과 해결을 각각 남길 수 있다.
 */
import {
  buildAnomalyIncidentKey,
  confirmAnomalyStabilized,
  endAnomaly,
  markAnomalyConditionCleared,
  openAnomaly,
  recordAnomalyIntervention,
} from '../anomalyRepository.js';

const TYPE = 'cleaning_unassigned';
const CHECKIN_WINDOW_MS = 12 * 60 * 60 * 1000;

function iso(value) {
  return new Date(value).toISOString();
}

function kstDateTime(value) {
  const shifted = new Date(Date.parse(value) + 9 * 60 * 60 * 1000).toISOString();
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 16)}`;
}

function targetContext(row) {
  return row.next_target_ref ? JSON.parse(row.next_target_ref) : null;
}

function incidentKey(row) {
  return buildAnomalyIncidentKey({
    type: TYPE,
    propertyId: row.property_id,
    cleaningObligationId: row.cleaning_obligation_id,
  });
}

export function formatCleaningUnassignedCriterion(stabilizationMinutes) {
  const minutes = Number(stabilizationMinutes);
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error('청소 미배정 해결 기준이 올바르지 않습니다');
  return minutes === 0
    ? '기준: 체크인 12시간 이내 · 해결 확인: 즉시'
    : `기준: 체크인 12시간 이내 · 정상 ${minutes}분 유지 시 해결`;
}

async function closeStaleOpenAnomalies(pool, nowIso) {
  const { rows } = await pool.query(
    `SELECT a.id,a.property_id,a.cleaning_obligation_id,a.incident_key,a.target_ref,a.occurred_at,
            o.status AS obligation_status,o.ended_at,
            n.check_in AS next_check_in,
            CASE WHEN n.stay_id IS NULL THEN NULL
                 ELSE jsonb_build_object('stayId',n.stay_id,'checkIn',n.check_in)::text END AS next_target_ref
       FROM automation_open_incidents oi
       JOIN automation_anomalies a ON a.id=oi.anomaly_id
       JOIN cleaning_obligations o ON o.id=a.cleaning_obligation_id
       LEFT JOIN LATERAL (
         SELECT r.stay_id,r.check_in
           FROM property_reservations r
          WHERE r.property_id=o.property_id AND r.data_origin='REAL' AND r.status='ACTIVE'
            AND r.check_in>=o.checkout_at
          ORDER BY r.check_in,r.id LIMIT 1
       ) n ON TRUE
      WHERE a.anomaly_type=$1`,
    [TYPE],
  );

  let ended = 0;
  for (const row of rows) {
    const oldTarget = row.target_ref ? JSON.parse(row.target_ref) : null;
    const checkInAt = oldTarget?.checkIn ? iso(oldTarget.checkIn) : null;
    const targetChanged = row.target_ref !== row.next_target_ref;
    const obligationEndedAt = row.ended_at ? iso(row.ended_at) : null;
    const checkInPassed = checkInAt && Date.parse(nowIso) >= Date.parse(checkInAt);
    if (row.obligation_status !== 'TARGET_REMOVED' && !targetChanged && !checkInPassed) continue;

    const targetRemovedAt = obligationEndedAt ?? nowIso;
    const unresolvedFirst = checkInAt && Date.parse(checkInAt) <= Date.parse(targetRemovedAt)
      && Date.parse(checkInAt) >= Date.parse(row.occurred_at);
    const state = unresolvedFirst ? 'UNRESOLVED_ENDED' : 'TARGET_REMOVED';
    const occurredAt = unresolvedFirst ? checkInAt : targetRemovedAt;
    const result = await endAnomaly(pool, {
      incidentKey: row.incident_key,
      state,
      sourceEventKey: `${state === 'TARGET_REMOVED' ? 'cleaning-target-removed' : 'cleaning-checkin-passed'}:${row.id}:${occurredAt}`,
      occurredAt,
      details: state === 'TARGET_REMOVED'
        ? { reason: row.obligation_status === 'TARGET_REMOVED' ? 'CLEANING_OBLIGATION_REMOVED' : 'NEXT_CHECKIN_REMOVED_OR_CHANGED' }
        : { reason: 'NEXT_CHECKIN_PASSED' },
    });
    if (result.ended) ended += 1;
  }
  return ended;
}

async function loadUnassignedIntervals(pool, nowIso) {
  const { rows } = await pool.query(
    `WITH history AS (
       SELECT h.*,
              LEAD(h.id) OVER w AS next_history_id,
              LEAD(h.assignment_state) OVER w AS next_assignment_state,
              LEAD(h.actor_type) OVER w AS next_actor_type,
              LEAD(h.occurred_at) OVER w AS next_occurred_at,
              MIN(h.occurred_at) FILTER (WHERE h.assignment_state='UNASSIGNED') OVER (
                PARTITION BY h.cleaning_obligation_id
                ORDER BY h.occurred_at,h.recorded_at,h.id
                ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
              ) AS following_unassigned_at
         FROM cleaning_assignment_history h
         WINDOW w AS (
           PARTITION BY h.cleaning_obligation_id
           ORDER BY h.occurred_at,h.recorded_at,h.id
         )
     )
     SELECT h.id AS history_id,h.occurred_at,h.next_history_id,h.next_assignment_state,
            h.next_actor_type,h.next_occurred_at,h.following_unassigned_at,
            o.id AS cleaning_obligation_id,o.property_id,p.name AS property_name,
            n.check_in AS next_check_in,
            jsonb_build_object('stayId',n.stay_id,'checkIn',n.check_in)::text AS next_target_ref
       FROM history h
       JOIN cleaning_obligations o ON o.id=h.cleaning_obligation_id
       JOIN property_cleaning_config p ON p.property_id=o.property_id
       JOIN LATERAL (
         SELECT r.stay_id,r.check_in
           FROM property_reservations r
          WHERE r.property_id=o.property_id AND r.data_origin='REAL' AND r.status='ACTIVE'
            AND r.check_in>=o.checkout_at
          ORDER BY r.check_in,r.id LIMIT 1
       ) n ON TRUE
      WHERE o.data_origin='REAL' AND h.assignment_state='UNASSIGNED'
        AND h.occurred_at<n.check_in
        AND GREATEST(h.occurred_at,n.check_in-INTERVAL '12 hours')<=$1::timestamptz
      ORDER BY h.occurred_at,h.recorded_at,h.id`,
    [nowIso],
  );
  return rows;
}

async function signalAnomaly(pool, sourceEventKey) {
  const { rows: [row] } = await pool.query(
    `SELECT a.*,oi.anomaly_id IS NOT NULL AS is_open
       FROM automation_anomaly_history h
       JOIN automation_anomalies a ON a.id=h.anomaly_id
       LEFT JOIN automation_open_incidents oi ON oi.anomaly_id=a.id
      WHERE h.history_type='STATE_CHANGE' AND h.source_event_key=$1
      ORDER BY h.recorded_at DESC,h.id DESC LIMIT 1`,
    [sourceEventKey],
  );
  return row ?? null;
}

async function settleAssignedInterval(pool, row, anomaly, nowIso) {
  const assignedAt = iso(row.next_occurred_at);
  if (row.next_actor_type === 'ADMIN' || row.next_actor_type === 'OPERATOR') {
    await recordAnomalyIntervention(pool, {
      anomalyId: anomaly.id,
      actorType: row.next_actor_type,
      sourceEventKey: `cleaning-assignment-intervention:${row.next_history_id}`,
      occurredAt: assignedAt,
      details: { assignmentHistoryId: row.next_history_id },
    });
  }
  const cleared = await markAnomalyConditionCleared(pool, {
    incidentKey: anomaly.incident_key,
    sourceEventKey: `cleaning-assigned:${row.next_history_id}`,
    occurredAt: assignedAt,
  });
  const observedAt = row.following_unassigned_at && Date.parse(row.following_unassigned_at) < Date.parse(nowIso)
    ? iso(row.following_unassigned_at)
    : nowIso;
  const confirmed = await confirmAnomalyStabilized(pool, {
    incidentKey: anomaly.incident_key,
    sourceEventKey: `cleaning-stabilized:${anomaly.id}:${assignedAt}`,
    observedAt,
  });
  return cleared.resolved || confirmed.resolved;
}

/**
 * @returns {Promise<{opened:number,resumed:number,resolved:number,ended:number,alerted:number}>}
 */
export async function reconcileCleaningUnassignedAnomalies(pool, { now = new Date(), sendAlert = null } = {}) {
  const nowIso = iso(now);
  const result = { opened: 0, resumed: 0, resolved: 0, ended: 0, alerted: 0 };
  result.ended += await closeStaleOpenAnomalies(pool, nowIso);

  for (const row of await loadUnassignedIntervals(pool, nowIso)) {
    const checkInAt = iso(row.next_check_in);
    const thresholdAt = new Date(Date.parse(checkInAt) - CHECKIN_WINDOW_MS).toISOString();
    const occurredAt = Date.parse(row.occurred_at) > Date.parse(thresholdAt) ? iso(row.occurred_at) : thresholdAt;
    const intervalEndAt = row.next_occurred_at ? iso(row.next_occurred_at) : null;
    if (Date.parse(occurredAt) >= Date.parse(checkInAt)) continue;
    if (intervalEndAt && Date.parse(intervalEndAt) <= Date.parse(occurredAt)) continue;

    const context = targetContext(row);
    // 같은 미배정 구간이어도 다음 숙박이 취소·변경되면 새 기준 시각의 별도 사건이다.
    const sourceEventKey = `cleaning-unassigned:${row.history_id}:target:${context.stayId}:${iso(context.checkIn)}`;
    const prior = await signalAnomaly(pool, sourceEventKey);
    if (prior && !prior.is_open) continue;
    const opened = prior ? { created: false, resumed: false, anomaly: prior } : await openAnomaly(pool, {
      propertyId: row.property_id,
      type: TYPE,
      cleaningObligationId: row.cleaning_obligation_id,
      targetRef: row.next_target_ref,
      sourceType: 'cleaning_assignment_history',
      sourceRef: row.history_id,
      sourceEventKey,
      occurredAt,
    });
    if (opened.created) result.opened += 1;
    if (opened.resumed) result.resumed += 1;

    if (intervalEndAt && Date.parse(intervalEndAt) >= Date.parse(checkInAt)) {
      const ended = await endAnomaly(pool, {
        incidentKey: incidentKey(row),
        state: 'UNRESOLVED_ENDED',
        sourceEventKey: `cleaning-checkin-passed:${opened.anomaly.id}:${checkInAt}`,
        occurredAt: checkInAt,
        details: { reason: 'NEXT_CHECKIN_PASSED' },
      });
      if (ended.ended) result.ended += 1;
      continue;
    }
    if (intervalEndAt && row.next_assignment_state === 'ASSIGNED') {
      if (await settleAssignedInterval(pool, row, opened.anomaly, nowIso)) result.resolved += 1;
      continue;
    }
    if (intervalEndAt && row.next_assignment_state === 'TARGET_REMOVED') {
      const ended = await endAnomaly(pool, {
        incidentKey: incidentKey(row),
        state: 'TARGET_REMOVED',
        sourceEventKey: `cleaning-target-removed:${row.next_history_id}`,
        occurredAt: intervalEndAt,
        details: { assignmentHistoryId: row.next_history_id },
      });
      if (ended.ended) result.ended += 1;
      continue;
    }
    if (Date.parse(nowIso) >= Date.parse(checkInAt)) {
      const ended = await endAnomaly(pool, {
        incidentKey: incidentKey(row),
        state: 'UNRESOLVED_ENDED',
        sourceEventKey: `cleaning-checkin-passed:${opened.anomaly.id}:${checkInAt}`,
        occurredAt: checkInAt,
        details: { reason: 'NEXT_CHECKIN_PASSED' },
      });
      if (ended.ended) result.ended += 1;
      continue;
    }
    if ((opened.created || opened.resumed) && sendAlert) {
      const criterion = formatCleaningUnassignedCriterion(opened.anomaly.stabilization_minutes);
      try {
        await sendAlert(`[PROPOS] ⚠️ ${row.property_name} 청소 미배정 — 다음 체크인 ${kstDateTime(context.checkIn)} 전 담당자를 배정해 주세요. ${criterion}`);
        result.alerted += 1;
      } catch (error) {
        console.error(`[cleaning-unassigned] 알림 실패 (${row.property_id}):`, error?.message ?? error);
      }
    }
  }
  return result;
}
