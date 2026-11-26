import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { workerFcmFixture } from '../helpers/workerFcmFixture.js';

const enabled = !!(process.env.CLEANING_TEST_DATABASE_URL || process.env.PGLITE_TEST_ROOT);

async function declineFromHistory(pool, token) {
  const { default: handler, _setDbForTest } = await import('../../api/cleaning/[...slug].js');
  _setDbForTest(pool);
  const req = { method: 'GET', query: { slug: ['d'], token, format: 'api', source: 'history' } };
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; }, setHeader() {} };
  await handler(req, res);
  return res;
}

test('Worker history shows only app requests sent to the connected worker, regardless of booking', { skip: !enabled }, async t => {
  const db = await createCleaningSqlFixture({ fcm: true });
  t.after(() => db.close());
  const app = await workerFcmFixture({ db: db.pool });
  t.after(() => app.restore());
  const otherId = randomUUID();
  await db.pool.query(`INSERT INTO cleaners(id,name,phone,email,tier,active,fcm_token)
    VALUES($1,'Other Worker','01000000001','other@example.invalid','VIP_1',true,'other-token')`, [otherId]);
  await db.pool.query(`UPDATE property_cleaning_config SET host_phone='01000000002'`);
  const futureDay = '2099-11-29T02:25:00Z';
  const addJob = async (time, origin = 'REAL') => {
    const id = randomUUID();
    await db.pool.query(`INSERT INTO cleaning_jobs(id,property_id,checkout_at,cleaning_start_at,source,status,data_origin)
      VALUES($1,'fixture-property',$2,$2,'SHORT_NOTICE','NOTIFYING_VIP_1',$3)`, [id, time, origin]);
    return id;
  };
  const insert = async (jobId, workerId, token, channel, origin = 'REAL') => {
    const id = randomUUID();
    await db.pool.query(`INSERT INTO cleaning_notifs(id,job_id,cleaner_id,tier,token,channel,data_origin)
      VALUES($1,$2,$3,'VIP_1',$4,$5,$6)`, [id, jobId, workerId, token, channel, origin]);
    return id;
  };
  const openJob = await addJob(futureDay);
  const openRequest = await insert(openJob, db.cleanerId, 'OPEN01', 'FCM');
  const pastRequest = await insert(db.jobId, db.cleanerId, 'PAST01', 'FCM');
  await insert(openJob, otherId, 'OTHR01', 'FCM');
  await insert(await addJob('2099-11-30T02:00:00Z'), db.cleanerId, 'FAIL01', null);
  await insert(await addJob('2099-12-01T02:00:00Z'), db.cleanerId, 'SMS001', 'SMS');
  await insert(await addJob('2099-12-02T02:00:00Z', 'SIMULATED'), db.cleanerId, 'DEMO01', 'FCM', 'SIMULATED');
  await db.pool.query(`UPDATE cleaning_notifs SET sent_at='2026-11-02T00:00:00Z' WHERE id=$1`, [pastRequest]);
  await db.pool.query(`UPDATE cleaning_notifs n SET initial_delivery_state='ACCEPTED', initial_accepted_at=NOW(),
    initial_delivery_data=jsonb_build_object('kind','INITIAL_REQUEST','payload','{}'::jsonb,
      'cleaner',jsonb_build_object('id',n.cleaner_id),'attempts',1,'expectedStatus','PENDING',
      'nextStatus','NOTIFYING_VIP_1','propertyId',j.property_id,'checkoutAt',j.checkout_at,'cleaningStartAt',j.cleaning_start_at)
    FROM cleaning_jobs j WHERE j.id=n.job_id AND n.id=$1`, [openRequest]);

  const get = (token, query) => app.invoke('GET', undefined, token ? { authorization: `Bearer ${token}` } : {}, {
    resource: 'requests', query: { slug: ['requests'], ...query },
  });
  assert.equal((await get(undefined, { fcm_token: 'fixture-token' })).code, 401);
  assert.equal((await get('missing-token')).code, 404);

  const res = await get('fixture-token', { worker_id: otherId });
  assert.equal(res.code, 200);
  assert.match(res.headers['Cache-Control'], /no-store/);
  const expected = [
    { id: openRequest, propertyName: 'Fixture Property', cleaningAt: '2099-11-29 11:25', calendarPath: '/c/fixture-property', declineToken: 'OPEN01' },
    { id: pastRequest, propertyName: 'Fixture Property', cleaningAt: '2026-11-10 11:00', calendarPath: '/c/fixture-property', declineToken: null },
  ];
  assert.deepEqual(res.body, { ok: true, requests: expected });

  await db.pool.query(`UPDATE cleaning_jobs SET assigned_cleaner_id=$2,status='ASSIGNED' WHERE id=$1`, [openJob, otherId]);
  assert.deepEqual((await get('fixture-token')).body, { ok: true, requests: [{ ...expected[0], declineToken: null }, expected[1]] });
  const stale = await declineFromHistory(db.pool, 'OPEN01');
  assert.equal(stale.code, 409);
  assert.doesNotMatch(stale.body.message, /배정|선점/);
  assert.equal((await db.pool.query('SELECT response FROM cleaning_notifs WHERE id=$1', [openRequest])).rows[0].response, null);

  await db.pool.query(`UPDATE cleaning_jobs SET assigned_cleaner_id=NULL,status='NOTIFYING_BULK' WHERE id=$1`, [openJob]);
  await db.pool.query(`UPDATE cleaning_notifs SET tier='BULK' WHERE job_id=$1`, [openJob]);
  assert.equal((await declineFromHistory(db.pool, 'OPEN01')).code, 200);
  assert.equal((await declineFromHistory(db.pool, 'OPEN01')).code, 409);
  assert.equal((await db.pool.query('SELECT response FROM cleaning_notifs WHERE id=$1', [openRequest])).rows[0].response, 'DECLINED');
  assert.equal((await get('other-token')).body.requests.length, 1);
  await db.pool.query(`UPDATE cleaners SET active=false WHERE id=$1`, [otherId]);
  assert.equal((await get('other-token')).code, 403);
  await db.pool.query(`UPDATE cleaners SET fcm_token='fixture-token' WHERE id=$1`, [otherId]);
  assert.equal((await get('fixture-token')).code, 409);
  assert.equal(app.probeCalls.length + app.slackCalls.length, 0);
});
