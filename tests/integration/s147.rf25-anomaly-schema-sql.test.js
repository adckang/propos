// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s147.rf25-anomaly-schema-sql.test.js
// RF-25 확장 마이그레이션을 실제 PostgreSQL 호환 엔진에서 실행한다. 운영 DB·외부 요청 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const enabled = !!process.env.PGLITE_TEST_ROOT;
const schema = () => readFile(new URL('../../data/schema-cleaning.sql', import.meta.url), 'utf8');
const migration = () => readFile(new URL('../../data/migrate-automation-anomalies.sql', import.meta.url), 'utf8');

async function database(t) {
  const entry = resolve(process.env.PGLITE_TEST_ROOT, 'node_modules/@electric-sql/pglite/dist/index.js');
  const { PGlite } = await import(pathToFileURL(entry));
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(await schema());
  return db;
}

test('RF-25 SQL: 정책·내부 신원 백필과 중복 방지 제약이 재실행에도 유지된다', { skip: !enabled }, async t => {
  const db = await database(t);
  await db.query(`INSERT INTO property_cleaning_config(property_id,name,data_origin)
                  VALUES('P1','P1','REAL')`);
  await db.query(`INSERT INTO property_reservations
      (property_id,reservation_uid,check_in,check_out,status,source_system,data_origin)
    VALUES
      ('P1','old-same','2026-12-01T06:00Z','2026-12-03T02:00Z','CANCELLED','AIRBNB_ICAL','REAL'),
      ('P1','new-same','2026-12-01T06:00Z','2026-12-03T02:00Z','ACTIVE','AIRBNB_ICAL','REAL'),
      ('P1','moved','2026-12-10T06:00Z','2026-12-13T02:00Z','ACTIVE','AIRBNB_ICAL','REAL')`);
  await db.query(`INSERT INTO cleaning_jobs
      (property_id,reservation_uid,checkout_at,cleaning_start_at,source,data_origin)
    VALUES
      ('P1','new-same','2026-12-03T02:00Z','2026-12-03T02:00Z','MONTHLY_BATCH','REAL'),
      ('P1','moved','2026-12-12T02:00Z','2026-12-12T02:00Z','MONTHLY_BATCH','REAL'),
      ('P1','moved','2026-12-13T02:00Z','2026-12-13T02:00Z','MONTHLY_BATCH','REAL'),
      ('P1',NULL,'2026-12-20T02:00Z','2026-12-20T02:00Z','MONTHLY_BATCH','REAL')`);

  const sql = await migration();
  await db.exec(sql);
  await db.exec(sql);

  const master = await db.query(`SELECT anomaly_type,stabilization_minutes
      FROM automation_policy_values ORDER BY anomaly_type`);
  assert.deepEqual(master.rows, [
    { anomaly_type: 'cleaning_unassigned', stabilization_minutes: 0 },
    { anomaly_type: 'device_offline', stabilization_minutes: 5 },
    { anomaly_type: 'guest_complaint_sensor', stabilization_minutes: 10 },
    { anomaly_type: 'noise', stabilization_minutes: 5 },
    { anomaly_type: 'vacant_energy_waste', stabilization_minutes: 5 },
  ]);

  const aliases = await db.query(`SELECT reservation_uid,stay_id FROM property_reservations ORDER BY reservation_uid`);
  const byUid = Object.fromEntries(aliases.rows.map(row => [row.reservation_uid, row.stay_id]));
  assert.ok(byUid['old-same']);
  assert.equal(byUid['old-same'], byUid['new-same'], '정확히 같은 숙박의 새 UID는 내부 숙박 하나');
  assert.notEqual(byUid.moved, byUid['new-same']);

  const obligations = await db.query(`SELECT stay_id,checkout_at,status,end_reason
      FROM cleaning_obligations ORDER BY checkout_at`);
  assert.equal(obligations.rows.length, 3);
  assert.deepEqual(obligations.rows.map(row => row.status), ['ACTIVE', 'TARGET_REMOVED', 'ACTIVE']);
  assert.equal(obligations.rows[1].end_reason, 'CHECKOUT_CHANGED');

  const jobs = await db.query(`SELECT reservation_uid,checkout_at,cleaning_obligation_id
      FROM cleaning_jobs ORDER BY checkout_at`);
  assert.ok(jobs.rows.slice(0, 3).every(row => row.cleaning_obligation_id), '근거 있는 기존 작업은 의무에 연결');
  assert.equal(jobs.rows[3].cleaning_obligation_id, null, '근거 없는 레거시 작업은 임의 숙박을 만들지 않음');

  const stayId = byUid['new-same'];
  await assert.rejects(
    db.query(`INSERT INTO cleaning_obligations(property_id,stay_id,checkout_at,status,data_origin)
              VALUES('P1',$1,'2026-12-04T02:00Z','ACTIVE','REAL')`, [stayId]),
    error => error.code === '23505',
  );

  const anomalyA = (await db.query(`INSERT INTO automation_anomalies
      (property_id,anomaly_type,incident_key,stay_id,source_type,source_ref,
       master_policy_version_id,stabilization_minutes,occurred_at)
    VALUES('P1','noise','noise:P1:'||$1::text,$1::uuid,'EVENT','event-a',
      '25000000-0000-4000-8000-000000000001',5,'2026-12-01T07:00Z') RETURNING id`, [stayId])).rows[0].id;
  const anomalyB = (await db.query(`INSERT INTO automation_anomalies
      (property_id,anomaly_type,incident_key,stay_id,source_type,source_ref,
       master_policy_version_id,stabilization_minutes,occurred_at)
    VALUES('P1','noise','noise:P1:'||$1::text,$1::uuid,'EVENT','event-b',
      '25000000-0000-4000-8000-000000000001',5,'2026-12-01T08:00Z') RETURNING id`, [stayId])).rows[0].id;
  await db.query(`INSERT INTO automation_open_incidents(incident_key,anomaly_id)
                  VALUES('noise:P1:'||$1::text,$2::uuid)`, [stayId, anomalyA]);
  await assert.rejects(
    db.query(`INSERT INTO automation_open_incidents(incident_key,anomaly_id)
              VALUES('noise:P1:'||$1::text,$2::uuid)`, [stayId, anomalyB]),
    error => error.code === '23505',
  );

  await db.query(`INSERT INTO automation_anomaly_history
      (anomaly_id,history_type,state,actor_type,source_event_key,occurred_at)
    VALUES($1,'STATE_CHANGE','IN_PROGRESS','SYSTEM','event-a','2026-12-01T07:00Z')`, [anomalyA]);
  await assert.rejects(
    db.query(`INSERT INTO automation_anomaly_history
      (anomaly_id,history_type,state,actor_type,source_event_key,occurred_at)
      VALUES($1,'STATE_CHANGE','IN_PROGRESS','SYSTEM','event-a','2026-12-01T07:01Z')`, [anomalyA]),
    error => error.code === '23505',
  );
});
