// PGLITE_TEST_ROOT=/private/tmp/propos-act11-sql node --test tests/integration/s109.cleaning-initial-delivery.test.js
// Or CLEANING_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:PORT/propos_delivery_test
// All tables/mutations are in memory or a disposable local schema. No service DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { randomUUID } from 'node:crypto';
import { createCleaningSqlFixture, actualCleaningModule, installDeliveryIO } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const dispatch = await actualCleaningModule('server/cleaning/_dispatch.js');
async function run(options, fn) {
  const io = installDeliveryIO(options?.io);
  let f;
  try { f = await createCleaningSqlFixture(options); await fn(f, io, job => dispatch.advanceJob(f.pool, job)); }
  finally { try { await f?.close(); } finally { io.restore(); } }
}

test('SQL: normal initial request records acceptance, channel, provider ID and job state', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  await advance(await f.currentJob());
  const [n] = await f.notifications();
  assert.equal((await f.currentJob()).status, 'NOTIFYING_VIP_1'); assert.equal(io.calls.sms.length, 1);
  assert.equal(n.initial_delivery_state, 'ACCEPTED'); assert.ok(n.initial_accepted_at);
  assert.equal(n.initial_delivery_data.result.providerMessageId, 'fixture-provider-id'); assert.equal(n.channel, 'SMS');
}));

test('SQL: FCM initial requests do not require configured SMS credentials', { skip: !enabled }, () => run({ fcm: true }, async (f, io, advance) => {
  delete process.env.PROPOS_SMS_GW_ID;
  delete process.env.PROPOS_SMS_GW_PWD;
  const result = await advance(await f.currentJob());
  const [notification] = await f.notifications();
  assert.equal(result.ok, true); assert.equal(notification.channel, 'FCM');
  assert.equal(notification.initial_delivery_state, 'ACCEPTED'); assert.ok(notification.initial_accepted_at);
  assert.equal(notification.initial_delivery_data.result.providerMessageId, 'projects/fixture/messages/message-id');
  assert.equal((await f.currentJob()).status, 'NOTIFYING_VIP_1');
  assert.equal(io.calls.push.length, 1); assert.equal(io.calls.sms.length, 0);
}));

test('SQL: failed SMS leaves the job pending and records a failed request', { skip: !enabled }, () => run({ io: { sms: async () => ({ ok: false, status: 400, text: async () => 'Fixture' }) } }, async (f, io, advance) => {
  await advance(await f.currentJob());
  assert.equal((await f.currentJob()).status, 'PENDING'); assert.equal((await f.notifications())[0].initial_delivery_state, 'FAILED');
  assert.equal(io.calls.sms.length, 1);
}));

test('SQL: an uninstalled app and missing SMS configuration cannot start the response clock', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  delete process.env.PROPOS_SMS_GW_ID;
  delete process.env.PROPOS_SMS_GW_PWD;
  const result = await advance(await f.currentJob());
  const [notification] = await f.notifications();
  assert.equal(result.ok, false); assert.equal(result.state, 'FAILED');
  assert.equal(result.errorCode, 'SMS_CONFIG_MISSING');
  assert.equal(notification.initial_delivery_data.result.errorCode, 'SMS_CONFIG_MISSING');
  assert.equal(notification.initial_accepted_at, null); assert.equal(notification.channel, null);
  assert.equal((await f.currentJob()).status, 'PENDING');
  assert.equal((await dispatch.getVipFollowupJobs(f.pool)).rows.length, 0);
  await dispatch.recoverInitialDeliveries(f.pool);
  await advance(await f.currentJob());
  assert.equal((await f.notifications()).length, 1);
  assert.equal(io.calls.push.length, 0); assert.equal(io.calls.sms.length, 0);
}));

test('SQL: concurrent calls deliver once and share one notification row', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  const job = await f.currentJob(); await Promise.all([advance(job), advance(job)]);
  assert.equal(io.calls.sms.length, 1); assert.equal((await f.notifications()).length, 1);
}));

test('SQL: accepted record repairs failed job projection without repeating delivery', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  const original = f.pool.query.bind(f.pool); let failed = false;
  f.pool.query = async (sql, params) => {
    if (!failed && /UPDATE cleaning_jobs SET status=/.test(sql)) { failed = true; throw new Error('Fixture projection failure'); }
    return original(sql, params);
  };
  const job = await f.currentJob(); await assert.rejects(() => advance(job));
  assert.equal((await f.notifications())[0].initial_delivery_state, 'ACCEPTED');
  await advance(job); assert.equal(io.calls.sms.length, 1); assert.equal((await f.currentJob()).status, 'NOTIFYING_VIP_1');
}));

test('SQL: cancellation before delivery prevents sending', { skip: !enabled }, () => run({}, async (f, io) => {
  const job = await f.currentJob();
  await dispatch.advanceJob(f.pool, job, { deleteBlocker: async () => f.pool.query("UPDATE cleaning_jobs SET status='CANCELLED' WHERE id=$1", [f.jobId]) });
  assert.equal(io.calls.sms.length, 0); assert.equal((await f.currentJob()).status, 'CANCELLED');
}));

test('SQL: cancellation during delivery cannot be overwritten by late acceptance', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  globalThis.fetch = async () => {
    io.calls.sms.push({}); await f.pool.query("UPDATE cleaning_jobs SET status='CANCELLED' WHERE id=$1", [f.jobId]);
    return { ok: true, status: 200, json: async () => ({ id: 'fixture-provider-id' }) };
  };
  await advance(await f.currentJob());
  assert.equal((await f.currentJob()).status, 'CANCELLED'); assert.equal((await f.notifications())[0].initial_delivery_state, 'ACCEPTED');
}));

test('SQL: current simulated property blocks a stale real job', { skip: !enabled }, () => run({ propertyOrigin: 'SIMULATED' }, async (f, io, advance) => {
  await advance(await f.currentJob()); assert.equal(io.calls.sms.length, 0); assert.equal((await f.notifications()).length, 0);
}));

test('SQL: legacy notification with unknown channel is not re-sent', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  await f.pool.query("INSERT INTO cleaning_notifs(job_id,cleaner_id,tier,token) VALUES($1,$2,'VIP_1','OLD001')", [f.jobId, f.cleanerId]);
  await advance(await f.currentJob()); assert.equal(io.calls.sms.length, 0); assert.equal((await f.notifications())[0].initial_delivery_state, null);
}));

test('SQL: lost response is recorded as unknown and repeated calls cannot resend', { skip: !enabled }, () => run({ io: { sms: async () => { throw new Error('Fixture response lost'); } } }, async (f, io, advance) => {
  const job = await f.currentJob(); await advance(job); await advance(job);
  assert.equal(io.calls.sms.length, 1); assert.equal((await f.currentJob()).status, 'PENDING');
  assert.equal((await f.notifications())[0].initial_delivery_state, 'UNKNOWN');
}));

test('SQL: receipt storage failure leaves a durable claim and cannot trigger another external call', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  const query = f.pool.query.bind(f.pool);
  f.pool.query = async (sql, params) => {
    if (sql.startsWith('UPDATE cleaning_notifs SET initial_delivery_state=$3')) throw new Error('Fixture receipt unavailable');
    return query(sql, params);
  };
  const job = await f.currentJob(); await assert.rejects(() => advance(job));
  assert.equal((await f.notifications())[0].initial_delivery_state, 'SENDING');
  f.pool.query = query; await advance(job); assert.equal(io.calls.sms.length, 1);
  await f.pool.query(`UPDATE cleaning_notifs SET initial_delivery_data=jsonb_set(initial_delivery_data,'{attemptedAt}','"2000-01-01T00:00:00Z"')`);
  await dispatch.recoverInitialDeliveries(f.pool);
  assert.equal((await f.notifications())[0].initial_delivery_state, 'UNKNOWN'); assert.equal(io.calls.sms.length, 1);
}));

test('SQL: a failed claim rolls back its notification intent and releases the DB client', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  const connect = f.pool.connect.bind(f.pool); let released = false;
  f.pool.connect = async () => {
    const client = await connect();
    return { query: (sql, params) => sql.startsWith("UPDATE cleaning_notifs SET initial_delivery_state='SENDING'")
      ? Promise.reject(new Error('Fixture claim failure')) : client.query(sql, params), release() { released = true; client.release(); } };
  };
  const job = await f.currentJob();
  await assert.rejects(() => advance(job), /Fixture claim failure/);
  assert.equal(released, true); assert.equal((await f.notifications()).length, 0); assert.equal(io.calls.sms.length, 0);
}));

test('SQL: deferred retry uses the original body and obeys its next-attempt time', { skip: !enabled }, () => run({ io: { sms: async count => count === 1
  ? { ok: false, status: 429 } : { ok: true, status: 200, json: async () => ({ id: 'fixture-provider-id' }) } } }, async (f, io, advance) => {
  const job = await f.currentJob(); await advance(job); await advance(job);
  assert.equal(io.calls.sms.length, 1); assert.equal((await f.notifications())[0].initial_delivery_state, 'RETRYABLE');
  await f.pool.query("UPDATE property_cleaning_config SET name='Changed Name'");
  await f.pool.query(`UPDATE cleaning_notifs SET initial_delivery_data=jsonb_set(initial_delivery_data,'{nextAttemptAt}','"2000-01-01T00:00:00Z"')`);
  await dispatch.recoverInitialDeliveries(f.pool);
  assert.equal(io.calls.sms.length, 2); assert.deepEqual(io.calls.sms[1].body, io.calls.sms[0].body);
  assert.equal((await f.currentJob()).status, 'NOTIFYING_VIP_1');
}));

test('SQL: an unknown request cannot be retargeted by changing cleaner order', { skip: !enabled }, () => run({ io: { sms: async () => { throw new Error('Fixture response lost'); } } }, async (f, io, advance) => {
  const job = await f.currentJob(); await advance(job);
  await f.pool.query(`INSERT INTO cleaners(id,name,phone,email,tier,created_at) VALUES($1,'Other','01000000001','other@example.invalid','VIP_1','2000-01-01')`, [randomUUID()]);
  await advance(job); assert.equal(io.calls.sms.length, 1); assert.equal((await f.notifications()).length, 1);
}));

test('SQL: an accepted receipt is projected even if the cleaner is later deactivated', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  const query = f.pool.query.bind(f.pool); let fail = true;
  f.pool.query = async (sql, params) => { if (fail && sql.startsWith('UPDATE cleaning_jobs SET status=')) { fail = false; throw new Error('Fixture projection'); } return query(sql, params); };
  const job = await f.currentJob(); await assert.rejects(() => advance(job));
  await f.pool.query('UPDATE cleaners SET active=false');
  await dispatch.recoverInitialDeliveries(f.pool);
  assert.equal(io.calls.sms.length, 1); assert.equal((await f.currentJob()).status, 'NOTIFYING_VIP_1');
}));

test('SQL: changing a saved recipient blocks a safe retry instead of sending to either number', { skip: !enabled }, () => run({ io: { sms: async () => ({ ok: false, status: 429 }) } }, async (f, io, advance) => {
  const job = await f.currentJob(); await advance(job);
  await f.pool.query("UPDATE cleaners SET phone='01000000002'");
  await f.pool.query(`UPDATE cleaning_notifs SET initial_delivery_data=jsonb_set(initial_delivery_data,'{nextAttemptAt}','"2000-01-01T00:00:00Z"')`);
  await advance(job); assert.equal(io.calls.sms.length, 1); assert.equal((await f.notifications())[0].initial_delivery_state, 'FAILED');
}));

test('SQL: migration is repeatable, preserves legacy rows and rejects incomplete execution records', { skip: !enabled }, () => run({}, async f => {
  await f.pool.query("INSERT INTO cleaning_notifs(job_id,cleaner_id,tier,token) VALUES($1,$2,'VIP_1','OLD001')", [f.jobId, f.cleanerId]);
  const before = await f.notifications();
  const definition = async () => (await f.pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='cleaning_notifs'::regclass AND conname='cleaning_notifs_initial_delivery_check'")).rows[0].definition;
  const freshDefinition = await definition();
  // Exercise migration from the real legacy shape, rather than only its
  // IF NOT EXISTS branch on an already-upgraded fresh schema.
  await f.engine.exec(`ALTER TABLE cleaning_notifs DROP CONSTRAINT cleaning_notifs_initial_delivery_check,
    DROP COLUMN initial_delivery_state, DROP COLUMN initial_delivery_data, DROP COLUMN initial_accepted_at`);
  const migration = await readFile(new URL('../../data/migrate-cleaning-initial-delivery.sql', import.meta.url), 'utf8');
  await f.engine.exec(migration); await f.engine.exec(migration); assert.deepEqual(await f.notifications(), before);
  assert.equal(await definition(), freshDefinition);
  await assert.rejects(() => f.pool.query("UPDATE cleaning_notifs SET initial_delivery_state='READY',initial_delivery_data='{}'::jsonb"), e => e.code === '23514');
}));

test('SQL: fresh token collisions retry inside a transaction without aborting it', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  const other = randomUUID();
  await f.pool.query("INSERT INTO cleaners(id,name,phone,email,tier) VALUES($1,'Other','01000000003','other@example.invalid','BULK')", [other]);
  await f.pool.query("INSERT INTO cleaning_notifs(job_id,cleaner_id,tier,token) VALUES($1,$2,'BULK','AAAAAA')", [f.jobId, other]);
  const random = Math.random; let count = 0; Math.random = () => ++count <= 6 ? 0 : 1.5 / 36;
  try { await advance(await f.currentJob()); } finally { Math.random = random; }
  const saved = (await f.notifications()).find(n => n.cleaner_id === f.cleanerId);
  assert.equal(saved.token, 'BBBBBB'); assert.ok(io.calls.sms[0].body.message.includes('/d/BBBBBB'));
  assert.equal(saved.initial_delivery_state, 'ACCEPTED');
}));

test('SQL: no VIP recipients retains the existing bulk fallback and opens its slot once', { skip: !enabled }, () => run({}, async (f, io) => {
  await f.pool.query('DELETE FROM cleaners'); let opened = 0;
  await dispatch.advanceJob(f.pool, await f.currentJob(), { deleteBlocker: async () => { opened++; } });
  assert.equal(opened, 1); assert.equal((await f.currentJob()).status, 'NOTIFYING_BULK'); assert.equal(io.calls.sms.length, 0);
}));

test('SQL: response clock uses acceptance for tracked requests and sent_at only for legacy', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  await advance(await f.currentJob()); const [row] = await f.notifications();
  await f.pool.query("UPDATE cleaning_notifs SET sent_at=NOW()-INTERVAL '2 hours'");
  assert.equal((await dispatch.getVipFollowupJobs(f.pool)).rows.length, 0);
  await f.pool.query("UPDATE cleaning_notifs SET initial_accepted_at=NOW()-INTERVAL '2 hours'");
  assert.equal((await dispatch.getVipFollowupJobs(f.pool)).rows.length, 1);
  await f.pool.query("UPDATE cleaning_notifs SET initial_delivery_state='UNKNOWN',initial_accepted_at=NULL WHERE id=$1", [row.id]);
  assert.equal((await dispatch.getVipFollowupJobs(f.pool)).rows.length, 0);
  await f.pool.query('UPDATE cleaning_notifs SET initial_delivery_state=NULL,initial_delivery_data=NULL');
  assert.equal((await dispatch.getVipFollowupJobs(f.pool)).rows.length, 1);
}));

test('SQL: an explicitly simulated job never creates delivery records or contacts a provider', { skip: !enabled }, () => run({ jobOrigin: 'SIMULATED' }, async (f, io, advance) => {
  await advance(await f.currentJob()); assert.equal(io.calls.sms.length, 0); assert.equal((await f.notifications()).length, 0);
}));

test('SQL: repeated rate limiting stops after three controlled attempts', { skip: !enabled }, () => run({ io: { sms: async () => ({ ok: false, status: 429 }) } }, async (f, io, advance) => {
  const job = await f.currentJob(); await advance(job);
  for (let i = 0; i < 4; i++) {
    await f.pool.query(`UPDATE cleaning_notifs SET initial_delivery_data=jsonb_set(initial_delivery_data,'{nextAttemptAt}','"2000-01-01T00:00:00Z"')`);
    await dispatch.recoverInitialDeliveries(f.pool);
  }
  await advance(job); assert.equal(io.calls.sms.length, 3); assert.equal((await f.notifications())[0].initial_delivery_state, 'FAILED');
}));

test('SQL: response clock has an exact one-hour boundary', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  await advance(await f.currentJob()); const client = await f.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE cleaning_notifs SET initial_accepted_at=NOW()-INTERVAL '1 hour'");
    assert.equal((await dispatch.getVipFollowupJobs(client)).rows.length, 0);
    await client.query("UPDATE cleaning_notifs SET initial_accepted_at=NOW()-INTERVAL '1 hour 1 millisecond'");
    assert.equal((await dispatch.getVipFollowupJobs(client)).rows.length, 1);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

test('SQL: public job detail preserves legacy fields without exposing private delivery snapshots', { skip: !enabled }, () => run({ fcm: true }, async (f, io, advance) => {
  await advance(await f.currentJob());
  const source = await readFile(new URL('../../api/cleaning/[...slug].js', import.meta.url), 'utf8');
  const node = parse(source, { sourceType: 'module' }).program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'getJob');
  for (const admin of [true, false]) {
    const deps = { db: f.pool, canAccessProperty: () => true, isAdminScope: () => admin,
      sendJson: (res, code, body) => Object.assign(res, { code, body }) };
    const actual = new Function(...Object.keys(deps), `return (${source.slice(node.start, node.end)});`)(...Object.values(deps));
    const res = {}; await actual(res, f.jobId, {}); assert.equal(res.code, 200);
    assert.equal(Object.hasOwn(res.body.notifs[0], 'token'), admin);
    assert.equal(Object.hasOwn(res.body.notifs[0], 'initial_delivery_data'), false);
    assert.equal(JSON.stringify(res.body).includes('fixture-token'), false);
  }
}));

test('SQL: retry and projection recovery also work for the next VIP request', { skip: !enabled }, () => run({ io: { sms: async count => count === 2
  ? { ok: false, status: 429 } : { ok: true, status: 200, json: async () => ({ id: 'fixture-provider-id' }) } } }, async (f, io, advance) => {
  await advance(await f.currentJob());
  await f.pool.query("INSERT INTO cleaners(id,name,phone,email,tier) VALUES($1,'Second','01000000004','second@example.invalid','VIP_2')", [randomUUID()]);
  await advance(await f.currentJob());
  assert.equal((await f.currentJob()).status, 'NOTIFYING_VIP_1');
  await f.pool.query(`UPDATE cleaning_notifs SET initial_delivery_data=jsonb_set(initial_delivery_data,'{nextAttemptAt}','"2000-01-01T00:00:00Z"') WHERE initial_delivery_state='RETRYABLE'`);
  await dispatch.recoverInitialDeliveries(f.pool);
  assert.equal((await f.currentJob()).status, 'NOTIFYING_VIP_2'); assert.equal(io.calls.sms.length, 3);
}));

test('SQL: an invalid FCM token with rate-limited SMS resumes SMS only and keeps both receipts', { skip: !enabled }, () => run({ fcm: true, io: {
  push: async () => { throw Object.assign(new Error('Fixture invalid token'), { code: 'messaging/registration-token-not-registered' }); },
  sms: async count => count === 1 ? { ok: false, status: 429 } : { ok: true, status: 200, json: async () => ({ id: 'fixture-provider-id' }) },
} }, async (f, io, advance) => {
  await advance(await f.currentJob());
  await f.pool.query(`UPDATE cleaning_notifs SET initial_delivery_data=jsonb_set(initial_delivery_data,'{nextAttemptAt}','"2000-01-01T00:00:00Z"')`);
  await dispatch.recoverInitialDeliveries(f.pool);
  assert.equal(io.calls.push.length, 1); assert.equal(io.calls.sms.length, 2);
  const [n] = await f.notifications(); assert.equal(n.channel, 'SMS_FALLBACK');
  assert.deepEqual(n.initial_delivery_data.results.map(x => x.outcome), ['RETRYABLE', 'ACCEPTED']);
}));

test('SQL: concurrent jobs on the same date cannot both claim one VIP cleaner', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  const other = randomUUID();
  await f.pool.query(`INSERT INTO cleaning_jobs(id,property_id,checkout_at,cleaning_start_at,source,data_origin)
    VALUES($1,'fixture-property','2026-11-10T03:00:00Z','2026-11-10T03:00:00Z','SHORT_NOTICE','REAL')`, [other]);
  const jobs = (await f.pool.query('SELECT * FROM cleaning_jobs ORDER BY checkout_at')).rows;
  await Promise.all(jobs.map(advance)); assert.equal(io.calls.sms.length, 1);
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM cleaning_notifs')).rows[0].count, 1);
}));

test('SQL: PostgreSQL errors do not expose private request snapshots', { skip: !enabled }, () => run({ fcm: true }, async f => {
  const store = await actualCleaningModule('server/cleaning/_initialDelivery.js');
  const cleaner = (await f.pool.query('SELECT * FROM cleaners')).rows[0];
  const job = await f.currentJob();
  await assert.rejects(() => store.prepareInitialDelivery(f.pool, { job, cleaner, nextStatus: 'NOTIFYING_VIP_1', payload: null }),
    error => error.code === '23514' && !error.detail && !JSON.stringify(error).includes('fixture-token'));
  assert.equal((await f.notifications()).length, 0);
}));

test('SQL: changing the property origin during delivery cannot trigger a later resend', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  globalThis.fetch = async () => {
    io.calls.sms.push({}); await f.pool.query("UPDATE property_cleaning_config SET data_origin='SIMULATED'");
    return { ok: true, status: 200, json: async () => ({ id: 'fixture-provider-id' }) };
  };
  const job = await f.currentJob(); await advance(job); await advance(job);
  assert.equal(io.calls.sms.length, 1); assert.equal((await f.currentJob()).status, 'PENDING');
  assert.equal((await f.notifications())[0].initial_delivery_state, 'ACCEPTED');
}));

test('SQL: malformed retry deadlines cannot poison the recovery scan', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  await advance(await f.currentJob());
  await assert.rejects(() => f.pool.query(`UPDATE cleaning_notifs SET initial_delivery_state='RETRYABLE',initial_accepted_at=NULL,
    initial_delivery_data=jsonb_set(initial_delivery_data,'{nextAttemptAt}','"not-a-date"')`), error => error.code === '22007');
  await assert.rejects(() => f.pool.query(`UPDATE cleaning_notifs SET initial_delivery_data=jsonb_set(initial_delivery_data,'{cleaner,id}','null')`),
    error => error.code === '23514');
  assert.equal((await f.notifications())[0].initial_delivery_state, 'ACCEPTED');
}));

test('SQL: legacy bulk fallback also preserves a cancellation that arrives during delivery', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  await f.pool.query("UPDATE cleaners SET tier='BULK'");
  globalThis.fetch = async () => {
    io.calls.sms.push({}); await f.pool.query("UPDATE cleaning_jobs SET status='CANCELLED' WHERE id=$1", [f.jobId]);
    return { ok: true, status: 200, json: async () => ({ id: 'fixture-provider-id' }) };
  };
  await advance(await f.currentJob()); assert.equal((await f.currentJob()).status, 'CANCELLED');
}));

test('SQL: initial request snapshots the current locked schedule rather than a stale caller object', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  const stale = await f.currentJob();
  await f.pool.query("UPDATE cleaning_jobs SET cleaning_start_at='2026-11-10T03:00:00Z'");
  await advance(stale); assert.ok(io.calls.sms[0].body.message.includes('2026-11-10 12:00'));
}));

test('SQL: a changed schedule blocks retry of the previous request body', { skip: !enabled }, () => run({ io: { sms: async () => ({ ok: false, status: 429 }) } }, async (f, io, advance) => {
  await advance(await f.currentJob());
  await f.pool.query("UPDATE cleaning_jobs SET cleaning_start_at='2026-11-10T03:00:00Z'");
  await f.pool.query(`UPDATE cleaning_notifs SET initial_delivery_data=jsonb_set(initial_delivery_data,'{nextAttemptAt}','"2000-01-01T00:00:00Z"')`);
  await dispatch.recoverInitialDeliveries(f.pool); assert.equal(io.calls.sms.length, 1);
  assert.equal((await f.notifications())[0].initial_delivery_state, 'FAILED');
}));

test('SQL: schedule changes immediately before the wire prevent delivery', { skip: !enabled }, () => run({}, async (f, io) => {
  await dispatch.advanceJob(f.pool, await f.currentJob(), { deleteBlocker: async () => f.pool.query("UPDATE cleaning_jobs SET cleaning_start_at='2026-11-10T03:00:00Z'") });
  assert.equal(io.calls.sms.length, 0); assert.equal((await f.currentJob()).status, 'PENDING');
}));

test('SQL: acceptance of an old schedule cannot mark a changed schedule as notified', { skip: !enabled }, () => run({}, async (f, io, advance) => {
  globalThis.fetch = async () => {
    io.calls.sms.push({}); await f.pool.query("UPDATE cleaning_jobs SET cleaning_start_at='2026-11-10T03:00:00Z'");
    return { ok: true, status: 200, json: async () => ({ id: 'fixture-provider-id' }) };
  };
  await advance(await f.currentJob()); assert.equal((await f.currentJob()).status, 'PENDING');
  assert.equal((await f.notifications())[0].initial_delivery_state, 'ACCEPTED');
}));
