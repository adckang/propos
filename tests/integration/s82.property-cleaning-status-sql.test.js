// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s82.property-cleaning-status-sql.test.js
//
// s82 SQL — 숙소 목록 API(GET /api/cleaning/properties)가 디테일뷰에 주는 예약별 청소 상태
// (reservations[].cleaningStatus)를 실제 SQL로 확인한다. 실제 청소 API 핸들러를 그대로 실행하고,
// 그 핸들러가 보내는 SQL만 격리 DB(PGlite 또는 격리 로컬 DB)로 넘긴다. 운영 DB·외부 요청 없음.
//
// RF-33: 예약 퇴실과 청소 일정은 한국 날짜로 맞춘다(캘린더 배정·예약 동기화·iCal 동기화와 같은 규칙).
// 숙소 체크아웃 시각을 바꾸면 예약 퇴실은 다음 동기화 때 새 시각이 되지만 이미 만든 청소 일정은 그대로라,
// 두 시각이 같은 한국 날짜인데 UTC 날짜가 다를 수 있다 — 그때도 디테일뷰가 캘린더와 같은 일정을 찾아야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const PROPERTY = 'fixture-property';

async function listProperties(t, setup) {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  await sql.pool.query('DELETE FROM cleaning_jobs WHERE id=$1', [sql.jobId]); // 도구가 만든 기본 일정은 이 시나리오와 무관
  await setup(sql);
  const api = await cleaningDeclineFixture({ responses: [(text, params) => sql.pool.query(text, params)] });
  t.after(() => api.restore());
  const cookie = 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' });
  const res = await api.invoke({ method: 'GET', url: '/api/cleaning/properties', headers: { cookie } });
  assert.equal(res.code, 200);
  assert.deepEqual(api.blocked, []);
  const property = res.body.find(p => p.property_id === PROPERTY);
  return property.reservations;
}

const reservation = (pool, uid, checkIn, checkOut) => pool.query(
  `INSERT INTO property_reservations(property_id,reservation_uid,check_in,check_out,source_system,data_origin)
   VALUES($1,$2,$3,$4,'AIRBNB_ICAL','REAL')`, [PROPERTY, uid, checkIn, checkOut]);
const job = (pool, { checkoutAt, status = 'ASSIGNED', cleanerId = null, updatedAt = '2026-11-18T00:00:00Z', property = PROPERTY }) => pool.query(
  `INSERT INTO cleaning_jobs(property_id,checkout_at,cleaning_start_at,status,assigned_cleaner_id,source,data_origin,updated_at)
   VALUES($1,$2,$2,$3,$4,'MONTHLY_BATCH','REAL',$5)`, [property, checkoutAt, status, cleanerId, updatedAt]);

test('SQL: same KST day, different UTC day (checkout hour changed 11:00 → 08:00) still finds the job', { skip: !enabled }, async t => {
  const rows = await listProperties(t, async ({ pool, cleanerId }) => {
    // 예약: 새 체크아웃 시각 한국 12/06 08:00 = UTC 12/05 23:00 / 일정: 이전에 만든 한국 12/06 11:00 = UTC 12/06 02:00
    await reservation(pool, 'res-early', '2026-12-03T06:00:00Z', '2026-12-05T23:00:00Z');
    await job(pool, { checkoutAt: '2026-12-06T02:00:00Z', cleanerId });
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cleaningStatus, 'ASSIGNED');
  assert.equal(rows[0].cleanerName, 'Fixture Cleaner');
});

test('SQL: duplicate reservation rows with different uids both show the one job (original s82 incident)', { skip: !enabled }, async t => {
  const rows = await listProperties(t, async ({ pool, cleanerId }) => {
    await reservation(pool, 'res-old-uid', '2026-11-03T06:00:00Z', '2026-11-06T02:00:00Z');
    await reservation(pool, 'res-new-uid', '2026-11-03T06:00:00Z', '2026-11-06T02:00:00Z');
    await job(pool, { checkoutAt: '2026-11-06T02:00:00Z', cleanerId });
  });
  // 두 예약은 입실 시각이 같아 응답 순서가 정해져 있지 않다 — 순서와 무관하게 비교
  assert.deepEqual(rows.map(r => [r.uid, r.cleaningStatus]).sort(), [['res-new-uid', 'ASSIGNED'], ['res-old-uid', 'ASSIGNED']]);
});

test('SQL: a job on another KST day or another property is not attached', { skip: !enabled }, async t => {
  const rows = await listProperties(t, async ({ pool }) => {
    await pool.query(`INSERT INTO property_cleaning_config(property_id,name,data_origin) VALUES('other-property','Other Property','REAL')`);
    await reservation(pool, 'res-lonely', '2026-12-10T06:00:00Z', '2026-12-12T02:00:00Z');
    await job(pool, { checkoutAt: '2026-12-12T16:00:00Z' }); // 한국 12/13 01:00 — 다음 한국 날짜
    await job(pool, { checkoutAt: '2026-12-12T02:00:00Z', property: 'other-property' });
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cleaningStatus, null);
});

test('SQL: when two jobs share the KST day, the most recently updated one is shown', { skip: !enabled }, async t => {
  const rows = await listProperties(t, async ({ pool }) => {
    await reservation(pool, 'res-two-jobs', '2026-12-18T06:00:00Z', '2026-12-20T02:00:00Z');
    await job(pool, { checkoutAt: '2026-12-20T02:00:00Z', status: 'CANCELLED', updatedAt: '2026-11-10T00:00:00Z' });
    await job(pool, { checkoutAt: '2026-12-20T05:00:00Z', status: 'PENDING', updatedAt: '2026-11-17T00:00:00Z' });
  });
  assert.equal(rows[0].cleaningStatus, 'PENDING');
});
