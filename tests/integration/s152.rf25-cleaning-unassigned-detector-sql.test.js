// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s152.rf25-cleaning-unassigned-detector-sql.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { saveReservationIdentity } from '../../server/cleaning/_reservationIdentity.js';
import { assignFromCalendarEvents } from '../../server/cleaning/_calendarAssign.js';
import { reconcileCleaningUnassignedAnomalies } from '../../server/cleaning/_unassignedAnomalies.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const PROPERTY = 'fixture-property';

test('RF-25 첫 감지기: 체크인 12시간 이내 미배정 구간을 열고 배정 주체에 따라 자동·수동 해결을 기록한다', {
  skip: !enabled, timeout: 120_000,
}, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  const base = new Date((await f.pool.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const at = offset => new Date(base + offset).toISOString();

  const outgoing = await saveReservationIdentity(f.pool, {
    propertyId: PROPERTY,
    reservationUid: 'rf25-outgoing',
    checkIn: at(-48 * 60 * 60 * 1000),
    checkOut: at(60 * 60 * 1000),
    dataOrigin: 'REAL',
  });
  await saveReservationIdentity(f.pool, {
    propertyId: PROPERTY,
    reservationUid: 'rf25-next',
    checkIn: at(10 * 60 * 60 * 1000),
    checkOut: at(58 * 60 * 60 * 1000),
    dataOrigin: 'REAL',
  });
  await f.pool.query(`UPDATE cleaning_jobs
    SET cleaning_obligation_id=$1,checkout_at=$2,cleaning_start_at=$2,status='PENDING',assigned_cleaner_id=NULL
    WHERE id=$3`, [outgoing.cleaningObligationId, at(60 * 60 * 1000), f.jobId]);

  const alerts = [];
  const first = await reconcileCleaningUnassignedAnomalies(f.pool, {
    now: at(60 * 1000),
    sendAlert: async text => { alerts.push(text); },
  });
  assert.deepEqual(first, { opened: 1, resumed: 0, resolved: 0, ended: 0, alerted: 1 });
  assert.match(alerts[0], /기준: 체크인 12시간 이내 · 해결 확인: 즉시$/);
  let anomalies = (await f.pool.query(`SELECT * FROM automation_anomalies
    WHERE cleaning_obligation_id=$1 ORDER BY occurred_at,recorded_at,id`, [outgoing.cleaningObligationId])).rows;
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].source_type, 'cleaning_assignment_history');
  assert.equal(anomalies[0].stabilization_minutes, 0);

  const assignmentStart = at(60 * 60 * 1000);
  const assignmentEnd = at(2 * 60 * 60 * 1000);
  const assignmentDate = new Date(Date.parse(assignmentStart) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const event = { id: 'rf25-calendar-event', attendees: [{ email: 'fixture@example.invalid' }] };
  const deps = {
    calendarCleaningTimes: () => ({ date: assignmentDate, cleaning_start_at: assignmentStart, cleaning_end_at: assignmentEnd }),
    resolveCalendarCleaner: async () => ({
      attendeeEmail: 'fixture@example.invalid',
      cleaner: { id: f.cleanerId, name: 'Fixture Cleaner' },
    }),
    sendCompletionSmsToRest: async () => {},
    postAssignmentSlack: async () => {},
    alertUnregisteredCleaner: async () => {},
    goneAlertDeps: {},
  };
  const property = { property_id: PROPERTY };
  assert.equal((await assignFromCalendarEvents(f.pool, { property, events: [event] }, deps))[0].result, 'ASSIGNED');
  assert.equal((await assignFromCalendarEvents(f.pool, { property, events: [event] }, deps))[0].result, '이미 ASSIGNED');

  const automatic = await reconcileCleaningUnassignedAnomalies(f.pool, { now: at(2 * 60 * 1000) });
  assert.equal(automatic.resolved, 1);
  let history = (await f.pool.query(`SELECT history_type,state,actor_type FROM automation_anomaly_history
    WHERE anomaly_id=$1 ORDER BY occurred_at,recorded_at,id`, [anomalies[0].id])).rows;
  assert.deepEqual(history.map(row => [row.history_type, row.state]).sort(), [
    ['RESOLUTION', 'RESOLVED'],
    ['STATE_CHANGE', 'IN_PROGRESS'],
    ['STATE_CHANGE', 'STABILIZING'],
  ].sort());
  assert.equal(history.some(row => row.history_type === 'INTERVENTION'), false);

  await f.pool.query(`SELECT record_cleaning_assignment_history(
    $1,$2,$3,'UNASSIGNED',NULL,'ADMIN','JOB_CANCELLED','rf25-admin-cancel',$4,'{}'::jsonb)`,
  [PROPERTY, outgoing.cleaningObligationId, f.jobId, at(3 * 60 * 1000)]);
  assert.equal((await reconcileCleaningUnassignedAnomalies(f.pool, { now: at(4 * 60 * 1000) })).opened, 1);
  await f.pool.query(`SELECT record_cleaning_assignment_history(
    $1,$2,$3,'ASSIGNED',$4,'ADMIN','MANUAL_ASSIGNMENT','rf25-admin-assignment',$5,'{}'::jsonb)`,
  [PROPERTY, outgoing.cleaningObligationId, f.jobId, f.cleanerId, at(5 * 60 * 1000)]);
  assert.equal((await reconcileCleaningUnassignedAnomalies(f.pool, { now: at(6 * 60 * 1000) })).resolved, 1);

  anomalies = (await f.pool.query(`SELECT * FROM automation_anomalies
    WHERE cleaning_obligation_id=$1 ORDER BY occurred_at,recorded_at,id`, [outgoing.cleaningObligationId])).rows;
  assert.equal(anomalies.length, 2);
  assert.equal(anomalies[1].previous_anomaly_id, anomalies[0].id);
  history = (await f.pool.query(`SELECT history_type,actor_type FROM automation_anomaly_history
    WHERE anomaly_id=$1 ORDER BY occurred_at,recorded_at,id`, [anomalies[1].id])).rows;
  assert.deepEqual(history.filter(row => row.history_type === 'INTERVENTION').map(row => row.actor_type), ['ADMIN']);

  await f.pool.query(`SELECT record_cleaning_assignment_history(
    $1,$2,$3,'UNASSIGNED',NULL,'SYSTEM','TEST_REOPEN','rf25-before-checkin-unassigned',$4,'{}'::jsonb)`,
  [PROPERTY, outgoing.cleaningObligationId, f.jobId, at(7 * 60 * 1000)]);
  assert.equal((await reconcileCleaningUnassignedAnomalies(f.pool, { now: at(8 * 60 * 1000) })).opened, 1);
  await f.pool.query(`SELECT record_cleaning_assignment_history(
    $1,$2,$3,'ASSIGNED',$4,'ADMIN','MANUAL_ASSIGNMENT','rf25-after-checkin-assignment',$5,'{}'::jsonb)`,
  [PROPERTY, outgoing.cleaningObligationId, f.jobId, f.cleanerId, at(10 * 60 * 60 * 1000 + 60 * 1000)]);
  const late = await reconcileCleaningUnassignedAnomalies(f.pool, { now: at(10 * 60 * 60 * 1000 + 2 * 60 * 1000) });
  assert.equal(late.ended, 1);
  anomalies = (await f.pool.query(`SELECT * FROM automation_anomalies
    WHERE cleaning_obligation_id=$1 ORDER BY occurred_at,recorded_at,id`, [outgoing.cleaningObligationId])).rows;
  assert.equal(anomalies.length, 3);
  const { rows: [terminal] } = await f.pool.query(`SELECT state,occurred_at FROM automation_anomaly_history
    WHERE anomaly_id=$1 AND history_type='RESOLUTION'`, [anomalies[2].id]);
  assert.equal(terminal.state, 'UNRESOLVED_ENDED');
  assert.equal(new Date(terminal.occurred_at).toISOString(), at(10 * 60 * 60 * 1000));
});

test('RF-25 첫 감지기: 다음 체크인 예약이 교체되면 계속된 미배정을 새 기준의 사건으로 연다', {
  skip: !enabled, timeout: 120_000,
}, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  const base = new Date((await f.pool.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const at = offset => new Date(base + offset).toISOString();

  const outgoing = await saveReservationIdentity(f.pool, {
    propertyId: PROPERTY,
    reservationUid: 'rf25-target-change-outgoing',
    checkIn: at(-48 * 60 * 60 * 1000),
    checkOut: at(60 * 60 * 1000),
    dataOrigin: 'REAL',
  });
  const firstTarget = await saveReservationIdentity(f.pool, {
    propertyId: PROPERTY,
    reservationUid: 'rf25-target-change-first',
    checkIn: at(10 * 60 * 60 * 1000),
    checkOut: at(34 * 60 * 60 * 1000),
    dataOrigin: 'REAL',
  });

  assert.equal((await reconcileCleaningUnassignedAnomalies(f.pool, { now: at(60 * 1000) })).opened, 1);
  await f.pool.query(`UPDATE property_reservations SET status='CANCELLED',updated_at=$2 WHERE stay_id=$1`,
    [firstTarget.stayId, at(2 * 60 * 1000)]);
  const replacement = await saveReservationIdentity(f.pool, {
    propertyId: PROPERTY,
    reservationUid: 'rf25-target-change-replacement',
    checkIn: at(11 * 60 * 60 * 1000),
    checkOut: at(35 * 60 * 60 * 1000),
    dataOrigin: 'REAL',
  });

  const changed = await reconcileCleaningUnassignedAnomalies(f.pool, { now: at(3 * 60 * 1000) });
  assert.equal(changed.ended, 1);
  assert.equal(changed.opened, 1);
  const { rows: anomalies } = await f.pool.query(`SELECT previous_anomaly_id,target_ref
    FROM automation_anomalies WHERE cleaning_obligation_id=$1 ORDER BY recorded_at,id`,
  [outgoing.cleaningObligationId]);
  assert.equal(anomalies.length, 2);
  assert.equal(anomalies[1].previous_anomaly_id != null, true);
  assert.equal(JSON.parse(anomalies[0].target_ref).stayId, firstTarget.stayId);
  assert.equal(JSON.parse(anomalies[1].target_ref).stayId, replacement.stayId);
});
