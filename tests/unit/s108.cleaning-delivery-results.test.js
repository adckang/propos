import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actualCleaningModule, installDeliveryIO } from '../helpers/cleaningDeliveryFixture.js';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';

test('Initial SMS: a lost response remains unknown and is never blindly retransmitted', async () => {
  const io = installDeliveryIO({ sms: async () => { throw new Error('fixture response lost'); } });
  try {
    const { sendSms } = await actualCleaningModule('server/cleaning/_sms.js');
    const result = await sendSms('01000000000', 'Fixture', { detailed: true });
    assert.equal(io.calls.sms.length, 1);
    assert.equal(result.outcome, 'UNKNOWN');
    assert.ok(io.calls.sms[0].signal);
  } finally { io.restore(); }
});

test('Initial SMS: definite invalid input is not retried', async () => {
  const io = installDeliveryIO({ sms: async () => ({ ok: false, status: 400, text: async () => 'Fixture' }) });
  try {
    const { sendSms } = await actualCleaningModule('server/cleaning/_sms.js');
    const result = await sendSms('01000000000', 'Fixture', { detailed: true });
    assert.equal(io.calls.sms.length, 1); assert.equal(result.outcome, 'FAILED');
  } finally { io.restore(); }
});

test('Initial SMS: accepted provider reference is preserved; legacy caller still receives boolean', async () => {
  const io = installDeliveryIO();
  try {
    const { sendSms } = await actualCleaningModule('server/cleaning/_sms.js');
    const result = await sendSms('01000000000', 'Fixture', { detailed: true });
    assert.equal(result.outcome, 'ACCEPTED'); assert.equal(result.providerMessageId, 'fixture-provider-id');
    assert.equal(await sendSms('01000000000', 'Fixture'), true);
  } finally { io.restore(); }
});

test('Initial FCM: accepted message ID is preserved; legacy response remains compatible', async () => {
  const io = installDeliveryIO();
  try {
    const { sendPush } = await actualCleaningModule('server/cleaning/_push.js');
    const result = await sendPush('fixture-token', { title: 'Fixture', body: 'Fixture' }, { detailed: true });
    assert.equal(result.providerMessageId, 'projects/fixture/messages/message-id'); assert.equal(result.outcome, 'ACCEPTED');
    assert.deepEqual(await sendPush('fixture-token', { title: 'Fixture', body: 'Fixture' }), { success: true });
  } finally { io.restore(); }
});

test('Initial notify: FCM network uncertainty does not send SMS as fallback', async () => {
  const io = installDeliveryIO({ push: async () => { throw Object.assign(new Error('fixture'), { code: 'app/network-error' }); } });
  try {
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');
    const result = await notify({ query: async () => ({ rows: [] }) }, { id: 'fixture', phone: '01000000000', fcm_status: 'active', fcm_token: 'fixture' },
      { title: 'Fixture', body: 'Fixture', smsText: 'Fixture', deliveryId: 'fixture' });
    assert.equal(io.calls.sms.length, 0); assert.equal(result.outcome, 'UNKNOWN'); assert.equal(result.ok, false);
  } finally { io.restore(); }
});

test('createNotif: job/cleaner conflict refetches the existing row instead of regenerating tokens', async () => {
  const { createNotif } = await actualCleaningModule('server/cleaning/_dispatch.js');
  let selects = 0, inserts = 0;
  const db = { query: async sql => {
    if (sql.includes('INSERT INTO')) { inserts++; throw Object.assign(new Error('fixture unique'), { code: '23505', constraint: 'cleaning_notifs_job_id_cleaner_id_key' }); }
    selects++; return { rows: selects === 1 ? [] : [{ id: 'existing', token: 'FAKE01' }] };
  } };
  assert.deepEqual(await createNotif(db, { jobId: 'job', cleanerId: 'cleaner', tier: 'VIP_1' }), { id: 'existing', token: 'FAKE01' });
  assert.equal(inserts, 1); assert.equal(selects, 2);
});

test('Dispatch API: an unaccepted delivery does not report success', async () => {
  const source = readFileSync(new URL('../../api/cleaning/[...slug].js', import.meta.url), 'utf8');
  const node = parse(source, { sourceType: 'module' }).program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'dispatchJob');
  const deps = { db: { query: async () => ({ rows: [{ id: 'job', property_id: 'property', data_origin: 'REAL', status: 'PENDING' }] }) },
    canAccessProperty: () => true, advanceJob: async () => ({ ok: false, state: 'FAILED', errorCode: 'DELIVERY_FAILED' }), makeBlockerDeleter: () => undefined,
    sendJson: (res, code, body) => Object.assign(res, { code, body }) };
  const dispatchJob = new Function(...Object.keys(deps), `return (${source.slice(node.start, node.end)});`)(...Object.values(deps));
  const res = {}; await dispatchJob(res, 'job', {});
  assert.ok(res.code >= 400); assert.equal(res.body.ok, false);
});

test('Initial FCM: a definite unregistered token keeps the existing SMS fallback', async () => {
  const io = installDeliveryIO({ push: async () => { throw Object.assign(new Error('fixture'), { code: 'messaging/registration-token-not-registered' }); } });
  try {
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');
    const result = await notify({ query: async () => ({ rows: [] }) }, { id: 'fixture', phone: '01000000000', fcm_status: 'active', fcm_token: 'fixture' },
      { title: 'Fixture', body: 'Fixture', smsText: 'Fixture', deliveryId: 'fixture' });
    assert.equal(result.ok, true); assert.equal(result.channel, 'SMS_FALLBACK'); assert.equal(io.calls.sms.length, 1);
  } finally { io.restore(); }
});

test('Initial FCM: timeout or missing receipt stays unknown without SMS', async () => {
  const io = installDeliveryIO({ push: () => new Promise(() => {}) });
  try {
    const { sendPush } = await actualCleaningModule('server/cleaning/_push.js');
    const result = await sendPush('fixture', { title: 'Fixture', body: 'Fixture' }, { detailed: true, timeoutMs: 5 });
    assert.equal(result.outcome, 'UNKNOWN'); assert.equal(io.calls.sms.length, 0);
    globalThis.__cleaningDeliveryIO.push = async () => undefined;
    assert.equal((await sendPush('fixture', { title: 'Fixture', body: 'Fixture' }, { detailed: true })).outcome, 'UNKNOWN');
  } finally { io.restore(); }
});

test('Initial SMS: rate limiting preserves Retry-After and is not retried by the adapter', async () => {
  const io = installDeliveryIO({ sms: async () => ({ ok: false, status: 429, headers: { get: () => '600' } }) });
  try {
    const { sendSms } = await actualCleaningModule('server/cleaning/_sms.js');
    const result = await sendSms('01000000000', 'Fixture', { detailed: true });
    assert.equal(result.outcome, 'RETRYABLE'); assert.ok(result.retryAfterMs >= 599000); assert.equal(io.calls.sms.length, 1);
  } finally { io.restore(); }
});

test('Initial SMS: missing configuration is a definite failure without network activity', async () => {
  const io = installDeliveryIO();
  try {
    delete process.env.PROPOS_SMS_GW_ID;
    const { sendSms } = await actualCleaningModule('server/cleaning/_sms.js');
    assert.equal((await sendSms('01000000000', 'Fixture', { detailed: true })).outcome, 'FAILED');
    assert.equal(io.calls.sms.length, 0);
  } finally { io.restore(); }
});

test('Both actual followup handlers use the shared receipt clock and recovery implementation', async () => {
  for (const [file, name] of [['../../api/cleaning/[...slug].js', 'runFollowupChecks'], ['../../api/cron/[...slug].js', 'handleCleaningFollowup']]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const node = parse(source, { sourceType: 'module' }).program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
    let clocks = 0, recoveries = 0;
    const db = { query: async () => ({ rows: [] }) };
    const deps = { db, getVipFollowupJobs: async received => { assert.equal(received, db); clocks++; return { rows: [] }; },
      recoverInitialDeliveries: async received => { assert.equal(received, db); recoveries++; return 0; } };
    const actual = new Function(...Object.keys(deps), `return (${source.slice(node.start, node.end)});`)(...Object.values(deps));
    const res = { status() { return this; }, json() {} };
    await actual(db, res); assert.equal(clocks, 1); assert.equal(recoveries, 1);
  }
});

for (const rollbackFails of [false, true]) {
  test(`Initial delivery transaction ${rollbackFails ? 'discards a connection after failed rollback' : 'reuses a connection after successful rollback'}`, async () => {
    const { prepareInitialDelivery } = await actualCleaningModule('server/cleaning/_initialDelivery.js');
    const released = [];
    const rollbackError = new Error('fixture rollback failure');
    const client = {
      async query(sql) {
        if (sql === 'ROLLBACK') {
          if (rollbackFails) throw rollbackError;
          return { rows: [] };
        }
        if (sql === 'BEGIN') return { rows: [] };
        throw Object.assign(new Error('fixture private database detail'), { severity: 'ERROR', code: 'XX000' });
      },
      release(error) { released.push(error); },
    };
    await assert.rejects(prepareInitialDelivery({ connect: async () => client },
      { job: { id: 'fixture-job' }, cleaner: { id: 'fixture-cleaner' }, nextStatus: 'NOTIFYING_VIP_1', payload: {} }),
    error => error.message === 'INITIAL_DELIVERY_STORAGE_FAILED' && error.code === 'XX000');
    assert.deepEqual(released, [rollbackFails ? rollbackError : undefined]);
  });
}
