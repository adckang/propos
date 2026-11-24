// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s153.rf25-noise-detector-sql.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { saveReservationIdentity } from '../../server/cleaning/_reservationIdentity.js';
import { reconcileNoiseSignal } from '../../server/noiseAnomalies.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const PROPERTY = 'fixture-property';

test('RF-25 소음 감지기: 3분 지속 발생과 숙소별 안정화 해결을 내부 숙박 사건으로 기록한다', {
  skip: !enabled, timeout: 120_000,
}, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  const base = new Date((await f.pool.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const at = offset => new Date(base + offset).toISOString();
  const reservation = await saveReservationIdentity(f.pool, {
    propertyId: PROPERTY,
    reservationUid: 'rf25-noise-stay',
    checkIn: at(-60 * 60_000),
    checkOut: at(24 * 60 * 60_000),
    dataOrigin: 'REAL',
  });
  const propertyVersionId = randomUUID();
  await f.pool.query(`INSERT INTO automation_policy_versions(id,scope,property_id,effective_from)
    VALUES($1,'PROPERTY',$2,$3)`, [propertyVersionId, PROPERTY, at(-60_000)]);
  await f.pool.query(`INSERT INTO automation_policy_values(policy_version_id,anomaly_type,stabilization_minutes)
    VALUES($1,'noise',2)`, [propertyVersionId]);

  const sustainedId = randomUUID();
  const opened = await reconcileNoiseSignal(f.pool, {
    eventId: sustainedId,
    propertyId: PROPERTY,
    type: 'noise_threshold_sustained',
    occurredAt: at(3 * 60_000),
    data: {
      stayId: reservation.stayId,
      thresholdDb: 65,
      detectionMinutes: 3,
      thresholdStartedAt: at(0),
      maxDb: 78,
    },
  });
  assert.equal(opened.opened, true);
  assert.equal(opened.resumed, false);
  assert.equal(opened.alertLabel, '소음 이상 — 65dB 초과 · 기준: 3분 이상 · 정상 2분 유지 시 해결');
  const { rows: [anomaly] } = await f.pool.query(`SELECT * FROM automation_anomalies WHERE id=$1`, [opened.anomalyId]);
  assert.equal(anomaly.stay_id, reservation.stayId);
  assert.equal(anomaly.source_ref, sustainedId);
  assert.equal(anomaly.stabilization_minutes, 2);
  assert.equal(anomaly.property_policy_version_id, propertyVersionId);
  assert.equal(new Date(anomaly.occurred_at).toISOString(), at(3 * 60_000));

  const normalStartedAt = at(4 * 60_000);
  const waiting = await reconcileNoiseSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'noise_threshold_normal', occurredAt: normalStartedAt,
    data: { stayId: reservation.stayId, thresholdDb: 65, detectionMinutes: 3, normalStartedAt, observedDb: 60 },
  });
  assert.deepEqual(waiting, { complete: false, resolved: false, eligibleAt: at(6 * 60_000) });
  const restartedAt = at(5 * 60_000);
  const restarted = await reconcileNoiseSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'noise_threshold_normal', occurredAt: restartedAt,
    data: { stayId: reservation.stayId, thresholdDb: 65, detectionMinutes: 3,
      normalStartedAt: restartedAt, observedDb: 60, restartStabilization: true },
  });
  assert.deepEqual(restarted, { complete: false, resolved: false, eligibleAt: at(7 * 60_000) });
  const tooSoon = await reconcileNoiseSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'noise_threshold_normal', occurredAt: at(6 * 60_000),
    data: { stayId: reservation.stayId, thresholdDb: 65, detectionMinutes: 3, normalStartedAt: restartedAt, observedDb: 60 },
  });
  assert.deepEqual(tooSoon, { complete: false, resolved: false, eligibleAt: at(7 * 60_000) });
  const resolved = await reconcileNoiseSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'noise_threshold_normal', occurredAt: at(7 * 60_000),
    data: { stayId: reservation.stayId, thresholdDb: 65, detectionMinutes: 3, normalStartedAt: restartedAt, observedDb: 60 },
  });
  assert.deepEqual(resolved, { complete: true, resolved: true });
  const { rows: history } = await f.pool.query(`SELECT history_type,state,occurred_at FROM automation_anomaly_history
    WHERE anomaly_id=$1 ORDER BY occurred_at,recorded_at,id`, [anomaly.id]);
  assert.deepEqual(history.map(row => [row.history_type, row.state]), [
    ['STATE_CHANGE', 'IN_PROGRESS'],
    ['STATE_CHANGE', 'STABILIZING'],
    ['STATE_CHANGE', 'STABILIZING'],
    ['RESOLUTION', 'RESOLVED'],
  ]);
  assert.equal(new Date(history[3].occurred_at).toISOString(), at(7 * 60_000));
});

test('RF-25 소음 감지기: 해결 뒤 재발은 새 사건이고 숙박 종료 시 미해결 종료한다', {
  skip: !enabled, timeout: 120_000,
}, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  const base = new Date((await f.pool.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const at = offset => new Date(base + offset).toISOString();
  const reservation = await saveReservationIdentity(f.pool, {
    propertyId: PROPERTY,
    reservationUid: 'rf25-noise-recurrence',
    checkIn: at(-60 * 60_000),
    checkOut: at(24 * 60 * 60_000),
    dataOrigin: 'REAL',
  });
  const signal = (eventId, type, occurredAt, data = {}) => reconcileNoiseSignal(f.pool, {
    eventId, propertyId: PROPERTY, type, occurredAt,
    data: { stayId: reservation.stayId, thresholdDb: 65, detectionMinutes: 3, ...data },
  });

  const first = await signal(randomUUID(), 'noise_threshold_sustained', at(3 * 60_000), { thresholdStartedAt: at(0) });
  const normalAt = at(4 * 60_000);
  await signal(randomUUID(), 'noise_threshold_normal', normalAt, { normalStartedAt: normalAt });
  await signal(randomUUID(), 'noise_threshold_normal', at(9 * 60_000), { normalStartedAt: normalAt });
  const second = await signal(randomUUID(), 'noise_threshold_sustained', at(13 * 60_000), { thresholdStartedAt: at(10 * 60_000) });
  assert.notEqual(second.anomalyId, first.anomalyId);
  const ended = await signal(randomUUID(), 'noise_tracking_ended', at(14 * 60_000));
  assert.deepEqual(ended, { complete: true, ended: true, resolved: false });
  const { rows: anomalies } = await f.pool.query(`SELECT id,previous_anomaly_id FROM automation_anomalies
    WHERE anomaly_type='noise' ORDER BY occurred_at,recorded_at,id`);
  assert.equal(anomalies.length, 2);
  assert.equal(anomalies[1].previous_anomaly_id, anomalies[0].id);
  const { rows: [terminal] } = await f.pool.query(`SELECT state FROM automation_anomaly_history
    WHERE anomaly_id=$1 ORDER BY occurred_at DESC,recorded_at DESC,id DESC LIMIT 1`, [second.anomalyId]);
  assert.equal(terminal.state, 'UNRESOLVED_ENDED');
});
