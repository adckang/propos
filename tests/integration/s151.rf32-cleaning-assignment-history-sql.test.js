// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s151.rf32-cleaning-assignment-history-sql.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const PROPERTY = 'fixture-property';

test('RF-32 배정 이력: 기존 행은 적용 시점 기준선만, 이후 실제 상태 변경은 시각·주체와 함께 추가한다', { skip: !enabled }, async t => {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  const { rows: [stay] } = await f.pool.query(`INSERT INTO property_stays
    (property_id,initial_check_in,initial_check_out,data_origin)
    VALUES($1,'2027-01-10T06:00:00Z','2027-01-12T02:00:00Z','REAL') RETURNING id`, [PROPERTY]);
  const { rows: [obligation] } = await f.pool.query(`INSERT INTO cleaning_obligations
    (property_id,stay_id,checkout_at,status,data_origin)
    VALUES($1,$2,'2027-01-12T02:00:00Z','ACTIVE','REAL') RETURNING id`, [PROPERTY, stay.id]);
  await f.pool.query(`UPDATE cleaning_jobs SET cleaning_obligation_id=$1,status='ASSIGNED',assigned_cleaner_id=$2
    WHERE id=$3`, [obligation.id, f.cleanerId, f.jobId]);

  const migration = await readFile(new URL('../../data/migrate-automation-anomalies.sql', import.meta.url), 'utf8');
  await f.engine.exec(migration);
  await f.engine.exec(migration);
  let rows = (await f.pool.query(`SELECT assignment_state,assigned_cleaner_id,actor_type,change_reason,details
    FROM cleaning_assignment_history WHERE cleaning_obligation_id=$1 ORDER BY occurred_at,recorded_at,id`, [obligation.id])).rows;
  assert.equal(rows.length, 1, '재실행해도 기준선 하나');
  assert.equal(rows[0].assignment_state, 'ASSIGNED');
  assert.equal(rows[0].assigned_cleaner_id, f.cleanerId);
  assert.equal(rows[0].actor_type, 'SYSTEM');
  assert.equal(rows[0].change_reason, 'MIGRATION_BASELINE');
  assert.equal(rows[0].details.baseline, true);

  const cancelledAt = '2027-01-09T04:00:00Z';
  assert.equal((await f.pool.query(`SELECT record_cleaning_assignment_history(
    $1,$2,$3,'UNASSIGNED',NULL,'ADMIN','JOB_CANCELLED','admin-cancel:1',$4,'{}'::jsonb) AS inserted`,
  [PROPERTY, obligation.id, f.jobId, cancelledAt])).rows[0].inserted, true);
  assert.equal((await f.pool.query(`SELECT record_cleaning_assignment_history(
    $1,$2,$3,'UNASSIGNED',NULL,'ADMIN','JOB_CANCELLED','admin-cancel:retry',$4,'{}'::jsonb) AS inserted`,
  [PROPERTY, obligation.id, f.jobId, cancelledAt])).rows[0].inserted, false, '같은 상태 반복은 이력 아님');

  const assignedAt = '2027-01-09T05:00:00Z';
  assert.equal((await f.pool.query(`SELECT record_cleaning_assignment_history(
    $1,$2,$3,'ASSIGNED',$4,'CLEANER','CALENDAR_ASSIGNMENT','calendar:event-1',$5,'{}'::jsonb) AS inserted`,
  [PROPERTY, obligation.id, f.jobId, f.cleanerId, assignedAt])).rows[0].inserted, true);

  rows = (await f.pool.query(`SELECT assignment_state,actor_type,change_reason,occurred_at
    FROM cleaning_assignment_history WHERE cleaning_obligation_id=$1 ORDER BY occurred_at,recorded_at,id`, [obligation.id])).rows;
  assert.deepEqual(rows.map(row => [row.assignment_state, row.actor_type, row.change_reason]), [
    ['ASSIGNED', 'SYSTEM', 'MIGRATION_BASELINE'],
    ['UNASSIGNED', 'ADMIN', 'JOB_CANCELLED'],
    ['ASSIGNED', 'CLEANER', 'CALENDAR_ASSIGNMENT'],
  ]);
  assert.equal(new Date(rows[1].occurred_at).toISOString(), cancelledAt.replace('Z', '.000Z'));
  assert.equal(new Date(rows[2].occurred_at).toISOString(), assignedAt.replace('Z', '.000Z'));
});
