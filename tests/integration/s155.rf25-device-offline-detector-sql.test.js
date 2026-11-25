// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s155.rf25-device-offline-detector-sql.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { reconcileDeviceOfflineSignal } from '../../server/deviceOfflineAnomalies.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const PROPERTY = 'fixture-property';
const ENTITY = 'light.fixture_living';

test('RF-25 기기 오프라인: 30분 지속 발생과 숙소별 안정화 해결을 기기 사건으로 기록한다', {
  skip: !enabled, timeout: 120_000,
}, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  const base = new Date((await f.pool.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const at = offset => new Date(base + offset).toISOString();
  const propertyVersionId = randomUUID();
  await f.pool.query(`INSERT INTO automation_policy_versions(id,scope,property_id,effective_from)
    VALUES($1,'PROPERTY',$2,$3)`, [propertyVersionId, PROPERTY, at(-60_000)]);
  await f.pool.query(`INSERT INTO automation_policy_values(policy_version_id,anomaly_type,stabilization_minutes)
    VALUES($1,'device_offline',2)`, [propertyVersionId]);

  const detectedId = randomUUID();
  const opened = await reconcileDeviceOfflineSignal(f.pool, {
    eventId: detectedId,
    propertyId: PROPERTY,
    type: 'device_offline_detected',
    occurredAt: at(30 * 60_000),
    data: {
      entityId: ENTITY,
      deviceName: '거실 조명',
      detectionMinutes: 30,
      offlineStartedAt: at(0),
    },
  });
  assert.equal(opened.opened, true);
  assert.equal(opened.alertLabel, '기기 오프라인 — 거실 조명 · 기준: 30분 이상 · 정상 2분 유지 시 해결');
  const { rows: [anomaly] } = await f.pool.query('SELECT * FROM automation_anomalies WHERE id=$1', [opened.anomalyId]);
  assert.equal(anomaly.target_ref, ENTITY);
  assert.equal(anomaly.source_ref, detectedId);
  assert.equal(anomaly.stabilization_minutes, 2);
  assert.equal(anomaly.property_policy_version_id, propertyVersionId);
  assert.equal(new Date(anomaly.occurred_at).toISOString(), at(30 * 60_000));

  const normalStartedAt = at(31 * 60_000);
  const waiting = await reconcileDeviceOfflineSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'device_online_normal', occurredAt: normalStartedAt,
    data: { entityId: ENTITY, deviceName: '거실 조명', detectionMinutes: 30, normalStartedAt },
  });
  assert.deepEqual(waiting, { complete: false, resolved: false, entityId: ENTITY, eligibleAt: at(33 * 60_000) });
  const recurred = await reconcileDeviceOfflineSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'device_offline_recurred', occurredAt: at(32 * 60_000),
    data: { entityId: ENTITY, deviceName: '거실 조명', detectionMinutes: 30 },
  });
  assert.equal(recurred.resumed, true);
  const restartedNormalAt = at(34 * 60_000);
  await reconcileDeviceOfflineSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'device_online_normal', occurredAt: restartedNormalAt,
    data: { entityId: ENTITY, deviceName: '거실 조명', detectionMinutes: 30, normalStartedAt: restartedNormalAt },
  });
  const resolved = await reconcileDeviceOfflineSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'device_online_normal', occurredAt: at(36 * 60_000),
    data: { entityId: ENTITY, deviceName: '거실 조명', detectionMinutes: 30, normalStartedAt: restartedNormalAt },
  });
  assert.deepEqual(resolved, { complete: true, resolved: true, entityId: ENTITY });
});
test('RF-25 기기 오프라인: 매핑에서 빠진 활성 기기는 대상 사라짐으로 끝낸다', {
  skip: !enabled, timeout: 120_000,
}, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  const base = new Date((await f.pool.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const at = offset => new Date(base + offset).toISOString();
  const signal = (type, occurredAt, data = {}) => reconcileDeviceOfflineSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type, occurredAt,
    data: { entityId: ENTITY, deviceName: '거실 조명', ...data },
  });
  const opened = await signal('device_offline_detected', at(30 * 60_000), {
    detectionMinutes: 30, offlineStartedAt: at(0),
  });
  const removed = await signal('device_offline_tracking_removed', at(31 * 60_000));
  assert.deepEqual(removed, { complete: true, entityId: ENTITY, ended: true, resolved: false });
  const { rows: [terminal] } = await f.pool.query(`SELECT state FROM automation_anomaly_history
    WHERE anomaly_id=$1 ORDER BY occurred_at DESC,recorded_at DESC,id DESC LIMIT 1`, [opened.anomalyId]);
  assert.equal(terminal.state, 'TARGET_REMOVED');
  const { rows: open } = await f.pool.query('SELECT * FROM automation_open_incidents WHERE anomaly_id=$1', [opened.anomalyId]);
  assert.equal(open.length, 0);
});
