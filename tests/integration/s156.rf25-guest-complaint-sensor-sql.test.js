// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s156.rf25-guest-complaint-sensor-sql.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { saveReservationIdentity } from '../../server/cleaning/_reservationIdentity.js';
import {
  recordGuestComplaintEmail,
  reconcileGuestComplaintSensorSignal,
} from '../../server/guestComplaintAnomalies.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const PROPERTY = 'fixture-property';
const ROOM = '123456789';

const ensureEvents = pool => pool.query(`CREATE TABLE events (
  id UUID PRIMARY KEY, property_id TEXT NOT NULL, type TEXT NOT NULL, is_soft BOOLEAN DEFAULT false,
  device_time TIMESTAMPTZ NOT NULL, server_time TIMESTAMPTZ DEFAULT NOW(), data JSONB,
  status TEXT DEFAULT 'pending', notified_at TIMESTAMPTZ,
  UNIQUE(property_id,type,device_time)
)`);

test('RF-25 게스트 불만: Gmail 메시지와 이후 60분 내 온도 이상을 묶고 정상 안정화로 해결한다', {
  skip: !enabled, timeout: 120_000,
}, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  await ensureEvents(f.pool);
  const base = new Date((await f.pool.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const at = offset => new Date(base + offset).toISOString();
  await f.pool.query(`UPDATE property_cleaning_config SET ical_url=$2 WHERE property_id=$1`,
    [PROPERTY, `https://www.airbnb.com/calendar/ical/${ROOM}.ics?s=fixture`]);
  const reservation = await saveReservationIdentity(f.pool, {
    propertyId: PROPERTY, reservationUid: 'rf25-guest-message-first',
    checkIn: at(-60 * 60_000), checkOut: at(24 * 60 * 60_000), dataOrigin: 'REAL',
  });
  const policyId = randomUUID();
  await f.pool.query(`INSERT INTO automation_policy_versions(id,scope,property_id,effective_from)
    VALUES($1,'PROPERTY',$2,$3)`, [policyId, PROPERTY, at(-60_000)]);
  await f.pool.query(`INSERT INTO automation_policy_values(policy_version_id,anomaly_type,stabilization_minutes)
    VALUES($1,'guest_complaint_sensor',2)`, [policyId]);

  const message = await recordGuestComplaintEmail(f.pool, {
    gmailMessageId: 'gmail-message-first', airbnbRoomId: ROOM, airbnbThreadId: 'thread-1',
    occurredAt: at(0), topics: ['temperature'],
  }, { now: new Date(base) });
  assert.deepEqual(message, { propertyId: PROPERTY, recorded: 1, paired: 0, alerts: [] });

  const eventId = randomUUID();
  const opened = await reconcileGuestComplaintSensorSignal(f.pool, {
    eventId, propertyId: PROPERTY, type: 'environment_sensor_anomaly', occurredAt: at(10 * 60_000),
    data: { stayId: reservation.stayId, topics: ['temperature'], detectionMinutes: 3 },
  });
  assert.equal(opened.alertLabel,
    '게스트 온도 불만 + 온습도 이상 · 기준: 메시지 전후 60분 이내 · 정상 2분 유지 시 해결');
  const { rows: [anomaly] } = await f.pool.query(`SELECT * FROM automation_anomalies WHERE anomaly_type='guest_complaint_sensor'`);
  assert.equal(anomaly.stay_id, reservation.stayId);
  assert.equal(anomaly.target_ref, 'temperature');
  assert.equal(new Date(anomaly.occurred_at).toISOString(), at(10 * 60_000));

  const normalAt = at(11 * 60_000);
  const waiting = await reconcileGuestComplaintSensorSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'environment_sensor_normal', occurredAt: normalAt,
    data: { stayId: reservation.stayId, topics: ['temperature'], detectionMinutes: 3,
      detectedAtByTopic: { temperature: at(10 * 60_000) }, normalStartedAtByTopic: { temperature: normalAt }, restartTopics: [] },
  });
  assert.equal(waiting.results.temperature.eligibleAt, at(13 * 60_000));
  const resolved = await reconcileGuestComplaintSensorSignal(f.pool, {
    eventId: randomUUID(), propertyId: PROPERTY, type: 'environment_sensor_normal', occurredAt: at(13 * 60_000),
    data: { stayId: reservation.stayId, topics: ['temperature'], detectionMinutes: 3,
      detectedAtByTopic: { temperature: at(10 * 60_000) }, normalStartedAtByTopic: { temperature: normalAt }, restartTopics: [] },
  });
  assert.equal(resolved.results.temperature.resolved, true);
  const { rows: [terminal] } = await f.pool.query(`SELECT state FROM automation_anomaly_history
    WHERE anomaly_id=$1 ORDER BY occurred_at DESC,recorded_at DESC,id DESC LIMIT 1`, [anomaly.id]);
  assert.equal(terminal.state, 'RESOLVED');
});

test('RF-25 게스트 불만: 먼저 저장된 센서 이상도 뒤따른 Gmail 메시지와 묶고 원문은 저장하지 않는다', {
  skip: !enabled, timeout: 120_000,
}, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  await ensureEvents(f.pool);
  const base = new Date((await f.pool.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const at = offset => new Date(base + offset).toISOString();
  await f.pool.query(`UPDATE property_cleaning_config SET ical_url=$2 WHERE property_id=$1`,
    [PROPERTY, `https://www.airbnb.com/calendar/ical/${ROOM}.ics?s=fixture`]);
  const reservation = await saveReservationIdentity(f.pool, {
    propertyId: PROPERTY, reservationUid: 'rf25-guest-sensor-first',
    checkIn: at(-60 * 60_000), checkOut: at(24 * 60 * 60_000), dataOrigin: 'REAL',
  });
  const sensorId = randomUUID();
  await f.pool.query(`INSERT INTO events(id,property_id,type,is_soft,device_time,data,status)
    VALUES($1,$2,'environment_sensor_anomaly',false,$3,$4::jsonb,'pending')`,
    [sensorId, PROPERTY, at(0), JSON.stringify({ stayId: reservation.stayId, topics: ['humidity'], detectionMinutes: 3 })]);

  const recorded = await recordGuestComplaintEmail(f.pool, {
    gmailMessageId: 'gmail-sensor-first', airbnbRoomId: ROOM, airbnbThreadId: 'thread-2',
    occurredAt: at(30 * 60_000), topics: ['humidity'],
  }, { now: new Date(base + 30 * 60_000) });
  assert.equal(recorded.paired, 1);
  assert.match(recorded.alerts[0], /메시지 전후 60분 이내/);
  const duplicate = await recordGuestComplaintEmail(f.pool, {
    gmailMessageId: 'gmail-sensor-first', airbnbRoomId: ROOM, airbnbThreadId: 'thread-2',
    occurredAt: at(30 * 60_000), topics: ['humidity'],
  }, { now: new Date(base + 30 * 60_000) });
  assert.equal(duplicate.recorded, 1);
  const { rows: signals } = await f.pool.query(`SELECT * FROM guest_complaint_signals`);
  assert.equal(signals.length, 1);
  assert.deepEqual(Object.keys(signals[0]).sort(), [
    'airbnb_room_id', 'airbnb_thread_id', 'gmail_message_id', 'occurred_at',
    'property_id', 'recorded_at', 'stay_id', 'topic',
  ]);
});
