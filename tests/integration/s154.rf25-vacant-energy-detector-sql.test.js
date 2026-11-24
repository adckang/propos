// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s154.rf25-vacant-energy-detector-sql.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { reconcileVacantEnergySignal } from '../../server/vacantEnergyAnomalies.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const PROPERTY = 'fixture-property';

async function ensureEvents(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY,
    property_id TEXT NOT NULL,
    type TEXT NOT NULL,
    is_soft BOOLEAN DEFAULT false,
    device_time TIMESTAMPTZ NOT NULL,
    server_time TIMESTAMPTZ DEFAULT NOW(),
    data JSONB,
    status TEXT DEFAULT 'pending',
    UNIQUE(property_id,type,device_time)
  )`);
}

test('RF-25 빈방 에너지: 청소 완료로 시작한 공실의 30분 가동과 숙소별 안정화 해결을 기록한다', {
  skip: !enabled, timeout: 120_000,
}, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  await ensureEvents(f.pool);
  const base = new Date((await f.pool.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const at = offset => new Date(base + offset).toISOString();
  const anchorId = randomUUID();
  await f.pool.query(`INSERT INTO events(id,property_id,type,is_soft,device_time,data,status)
    VALUES($1,$2,'scheduled_cleaning_finished',false,$3,'{}'::jsonb,'processed')`,
  [anchorId, PROPERTY, at(-60_000)]);
  const propertyVersionId = randomUUID();
  await f.pool.query(`INSERT INTO automation_policy_versions(id,scope,property_id,effective_from)
    VALUES($1,'PROPERTY',$2,$3)`, [propertyVersionId, PROPERTY, at(-2 * 60_000)]);
  await f.pool.query(`INSERT INTO automation_policy_values(policy_version_id,anomaly_type,stabilization_minutes)
    VALUES($1,'vacant_energy_waste',2)`, [propertyVersionId]);

  const detectedId = randomUUID();
  const opened = await reconcileVacantEnergySignal(f.pool, {
    eventId: detectedId,
    propertyId: PROPERTY,
    type: 'vacant_energy_waste_detected',
    occurredAt: at(30 * 60_000),
    data: {
      detectionMinutes: 30,
      conditionStartedAt: at(0),
      activeSources: ['에어컨'],
    },
  });
  assert.equal(opened.opened, true);
  assert.equal(opened.targetRef, anchorId);
  assert.equal(opened.alertLabel, '빈방 에너지 낭비 — 기준: 30분 이상 · 정상 2분 유지 시 해결');
  const { rows: [anomaly] } = await f.pool.query('SELECT * FROM automation_anomalies WHERE id=$1', [opened.anomalyId]);
  assert.equal(anomaly.target_ref, anchorId);
  assert.equal(anomaly.source_ref, detectedId);
  assert.equal(anomaly.stabilization_minutes, 2);
  assert.equal(anomaly.property_policy_version_id, propertyVersionId);
  assert.equal(new Date(anomaly.occurred_at).toISOString(), at(30 * 60_000));

  const normalStartedAt = at(31 * 60_000);
  const waiting = await reconcileVacantEnergySignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'vacant_energy_waste_normal', occurredAt: normalStartedAt,
    data: { targetRef: anchorId, detectionMinutes: 30, normalStartedAt },
  });
  assert.deepEqual(waiting, {
    complete: false, resolved: false, targetRef: anchorId, eligibleAt: at(33 * 60_000),
  });
  const resolved = await reconcileVacantEnergySignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'vacant_energy_waste_normal', occurredAt: at(33 * 60_000),
    data: { targetRef: anchorId, detectionMinutes: 30, normalStartedAt },
  });
  assert.deepEqual(resolved, {
    complete: true, resolved: true, targetRef: anchorId, resolvedAt: at(33 * 60_000),
  });
  const retryAfterLostResponse = await reconcileVacantEnergySignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'vacant_energy_waste_normal', occurredAt: at(34 * 60_000),
    data: { targetRef: anchorId, detectionMinutes: 30, normalStartedAt },
  });
  assert.deepEqual(retryAfterLostResponse, {
    complete: true, resolved: true, targetRef: anchorId, resolvedAt: at(33 * 60_000),
  });
  const canonicalResolved = await reconcileVacantEnergySignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'vacant_energy_waste_resolved', occurredAt: at(33 * 60_000),
    data: { targetRef: anchorId, detectionMinutes: 30, confirmedAt: at(33 * 60_000) },
  });
  assert.equal(canonicalResolved.complete, true);
  const { rows: history } = await f.pool.query(`SELECT history_type,state,occurred_at FROM automation_anomaly_history
    WHERE anomaly_id=$1 ORDER BY occurred_at,recorded_at,id`, [anomaly.id]);
  assert.deepEqual(history.map(row => [row.history_type, row.state]), [
    ['STATE_CHANGE', 'IN_PROGRESS'],
    ['STATE_CHANGE', 'STABILIZING'],
    ['RESOLUTION', 'RESOLVED'],
  ]);
  assert.equal(new Date(history[2].occurred_at).toISOString(), at(33 * 60_000));
});

test('RF-25 빈방 에너지: 해결 뒤 같은 공실의 재발은 새 사건이고 다음 입실에 미해결 종료한다', {
  skip: !enabled, timeout: 120_000,
}, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  await ensureEvents(f.pool);
  const base = new Date((await f.pool.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const at = offset => new Date(base + offset).toISOString();
  const anchorId = randomUUID();
  await f.pool.query(`INSERT INTO events(id,property_id,type,is_soft,device_time,data,status)
    VALUES($1,$2,'cleaning_finished',false,$3,'{}'::jsonb,'processed')`,
  [anchorId, PROPERTY, at(-60_000)]);
  const signal = (type, occurredAt, data = {}) => reconcileVacantEnergySignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type, occurredAt,
    data: { targetRef: anchorId, detectionMinutes: 30, ...data },
  });

  const first = await reconcileVacantEnergySignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'vacant_energy_waste_detected', occurredAt: at(30 * 60_000),
    data: { detectionMinutes: 30, conditionStartedAt: at(0), activeSources: ['조명'] },
  });
  const normalAt = at(31 * 60_000);
  await signal('vacant_energy_waste_normal', normalAt, { normalStartedAt: normalAt });
  await signal('vacant_energy_waste_normal', at(36 * 60_000), { normalStartedAt: normalAt });
  const second = await reconcileVacantEnergySignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'vacant_energy_waste_detected', occurredAt: at(67 * 60_000),
    data: { detectionMinutes: 30, conditionStartedAt: at(37 * 60_000), activeSources: ['조명'] },
  });
  assert.notEqual(second.anomalyId, first.anomalyId);
  const ended = await signal('vacant_energy_tracking_ended', at(68 * 60_000));
  assert.deepEqual(ended, { complete: true, targetRef: anchorId, ended: true, resolved: false });
  const { rows: anomalies } = await f.pool.query(`SELECT id,previous_anomaly_id FROM automation_anomalies
    WHERE anomaly_type='vacant_energy_waste' ORDER BY occurred_at,recorded_at,id`);
  assert.equal(anomalies.length, 2);
  assert.equal(anomalies[1].previous_anomaly_id, anomalies[0].id);
  const { rows: [terminal] } = await f.pool.query(`SELECT state FROM automation_anomaly_history
    WHERE anomaly_id=$1 ORDER BY occurred_at DESC,recorded_at DESC,id DESC LIMIT 1`, [second.anomalyId]);
  assert.equal(terminal.state, 'UNRESOLVED_ENDED');
});
