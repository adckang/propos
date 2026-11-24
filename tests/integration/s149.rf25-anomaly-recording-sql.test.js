// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s149.rf25-anomaly-recording-sql.test.js
// RF-25 이상 본체·이력의 정책 스냅샷, 생명주기, 중복 방지를 실제 PostgreSQL 호환 엔진에서 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCleaningSqlFixture, actualCleaningModule } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const store = enabled ? await actualCleaningModule('server/anomalyRepository.js') : null;
const identity = enabled ? await actualCleaningModule('server/cleaning/_reservationIdentity.js') : null;
const PROPERTY = 'fixture-property';

async function harness(t) {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  return f;
}

const offlineInput = (sourceEventKey, occurredAt, targetRef = 'sensor.front-door') => ({
  propertyId: PROPERTY,
  type: 'device_offline',
  targetRef,
  sourceType: 'event',
  sourceRef: sourceEventKey,
  sourceEventKey,
  occurredAt,
});

test('RF-25 기록: 발생 시점의 마스터·숙소 정책과 실제 적용값을 보존하고 같은 열린 사건은 하나다', { skip: !enabled }, async t => {
  const f = await harness(t);
  const propertyVersionId = randomUUID();
  await f.pool.query(`INSERT INTO automation_policy_versions(id,scope,property_id,effective_from)
    VALUES($1,'PROPERTY',$2,'2026-12-01T00:00:00Z')`, [propertyVersionId, PROPERTY]);
  await f.pool.query(`INSERT INTO automation_policy_values(policy_version_id,anomaly_type,stabilization_minutes)
    VALUES($1,'device_offline',2)`, [propertyVersionId]);

  const input = offlineInput('offline:first', '2026-12-02T00:00:00Z');
  const [first, duplicate] = await Promise.all([
    store.openAnomaly(f.pool, input),
    store.openAnomaly(f.pool, { ...input, sourceRef: 'offline:second', sourceEventKey: 'offline:second' }),
  ]);

  assert.equal(first.anomaly.id, duplicate.anomaly.id);
  assert.equal([first.created, duplicate.created].filter(Boolean).length, 1);
  assert.equal(first.anomaly.stabilization_minutes, 2);
  assert.equal(first.anomaly.property_policy_version_id, propertyVersionId);
  assert.ok(first.anomaly.master_policy_version_id);
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS n FROM automation_anomalies')).rows[0].n, 1);
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS n FROM automation_open_incidents')).rows[0].n, 1);
  assert.deepEqual((await f.pool.query(`SELECT state FROM automation_anomaly_history
    ORDER BY occurred_at,recorded_at,id`)).rows, [{ state: 'IN_PROGRESS' }]);
});

test('RF-25 기록: 안정화 중 재발은 같은 이상으로 돌아가고, 해결 뒤 재발은 새 이상으로 잇는다', { skip: !enabled }, async t => {
  const f = await harness(t);
  const propertyVersionId = randomUUID();
  await f.pool.query(`INSERT INTO automation_policy_versions(id,scope,property_id,effective_from)
    VALUES($1,'PROPERTY',$2,'2026-12-01T00:00:00Z')`, [propertyVersionId, PROPERTY]);
  await f.pool.query(`INSERT INTO automation_policy_values(policy_version_id,anomaly_type,stabilization_minutes)
    VALUES($1,'device_offline',2)`, [propertyVersionId]);

  const opened = await store.openAnomaly(f.pool, offlineInput('offline:1', '2026-12-02T00:00:00Z'));
  await store.markAnomalyConditionCleared(f.pool, {
    incidentKey: opened.anomaly.incident_key, sourceEventKey: 'online:1', occurredAt: '2026-12-02T00:10:00Z',
  });
  const tooSoon = await store.confirmAnomalyStabilized(f.pool, {
    incidentKey: opened.anomaly.incident_key, sourceEventKey: 'normal-check:1', observedAt: '2026-12-02T00:11:59Z',
  });
  assert.equal(tooSoon.resolved, false);

  const recurred = await store.openAnomaly(f.pool, offlineInput('offline:2', '2026-12-02T00:11:30Z'));
  assert.equal(recurred.anomaly.id, opened.anomaly.id);
  await store.markAnomalyConditionCleared(f.pool, {
    incidentKey: opened.anomaly.incident_key, sourceEventKey: 'online:2', occurredAt: '2026-12-02T00:12:00Z',
  });
  const resolved = await store.confirmAnomalyStabilized(f.pool, {
    incidentKey: opened.anomaly.incident_key, sourceEventKey: 'normal-check:2', observedAt: '2026-12-02T00:15:00Z',
  });
  assert.equal(resolved.resolved, true);
  assert.equal(new Date(resolved.occurredAt).toISOString(), '2026-12-02T00:14:00.000Z');
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS n FROM automation_open_incidents')).rows[0].n, 0);

  const reopened = await store.openAnomaly(f.pool, offlineInput('offline:3', '2026-12-02T00:16:00Z'));
  assert.notEqual(reopened.anomaly.id, opened.anomaly.id);
  assert.equal(reopened.anomaly.previous_anomaly_id, opened.anomaly.id);
  assert.deepEqual((await f.pool.query(`SELECT state FROM automation_anomaly_history
    WHERE anomaly_id=$1 ORDER BY occurred_at,recorded_at,id`, [opened.anomaly.id])).rows.map(row => row.state),
  ['IN_PROGRESS', 'STABILIZING', 'IN_PROGRESS', 'STABILIZING', 'RESOLVED']);
});

test('RF-25 기록: 0분 청소 미배정은 정상 신호에서 즉시 해결되고 대상 사라짐은 분리 종료한다', { skip: !enabled }, async t => {
  const f = await harness(t);
  const saved = await identity.saveReservationIdentity(f.pool, {
    propertyId: PROPERTY,
    reservationUid: 'cleaning-anomaly',
    checkIn: '2026-12-03T06:00:00Z',
    checkOut: '2026-12-05T02:00:00Z',
    dataOrigin: 'REAL',
  });
  const opened = await store.openAnomaly(f.pool, {
    propertyId: PROPERTY,
    type: 'cleaning_unassigned',
    cleaningObligationId: saved.cleaningObligationId,
    sourceType: 'cleaning_obligation',
    sourceRef: saved.cleaningObligationId,
    sourceEventKey: 'unassigned:first',
    occurredAt: '2026-12-02T18:00:00Z',
  });
  const resolved = await store.markAnomalyConditionCleared(f.pool, {
    incidentKey: opened.anomaly.incident_key,
    sourceEventKey: 'assignment:request-1',
    occurredAt: '2026-12-02T18:01:00Z',
  });
  assert.equal(resolved.resolved, true);
  assert.equal(new Date(resolved.occurredAt).toISOString(), '2026-12-02T18:01:00.000Z');

  const offline = await store.openAnomaly(f.pool, offlineInput('offline:target', '2026-12-02T19:00:00Z', 'sensor.removed'));
  const ended = await store.endAnomaly(f.pool, {
    incidentKey: offline.anomaly.incident_key,
    state: 'TARGET_REMOVED',
    sourceEventKey: 'device-removed:1',
    occurredAt: '2026-12-02T19:05:00Z',
  });
  assert.equal(ended.ended, true);
  assert.equal((await f.pool.query(`SELECT state FROM automation_anomaly_history
    WHERE anomaly_id=$1 ORDER BY occurred_at DESC LIMIT 1`, [offline.anomaly.id])).rows[0].state, 'TARGET_REMOVED');
});

test('RF-25 기록: 관리자·운영자 개입만 같은 요청 키로 한 번 기록한다', { skip: !enabled }, async t => {
  const f = await harness(t);
  const opened = await store.openAnomaly(f.pool, offlineInput('offline:intervention', '2026-12-02T20:00:00Z'));
  const request = {
    anomalyId: opened.anomaly.id,
    actorType: 'ADMIN',
    sourceEventKey: 'operator-request:1',
    occurredAt: '2026-12-02T20:01:00Z',
    details: { action: 'REMOTE_RESTART' },
  };
  assert.equal((await store.recordAnomalyIntervention(f.pool, request)).inserted, true);
  assert.equal((await store.recordAnomalyIntervention(f.pool, request)).inserted, false);
  await assert.rejects(
    store.recordAnomalyIntervention(f.pool, { ...request, sourceEventKey: 'view:1', actorType: 'SYSTEM' }),
    /관리자 또는 운영자/,
  );
  assert.equal((await f.pool.query(`SELECT COUNT(*)::int AS n FROM automation_anomaly_history
    WHERE anomaly_id=$1 AND history_type='INTERVENTION'`, [opened.anomaly.id])).rows[0].n, 1);
});
