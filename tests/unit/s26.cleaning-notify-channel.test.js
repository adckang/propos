/**
 * ACT-08 단계 ⑥-7 — 실제 NotificationService 채널·실패 처리·완료 알림 계약.
 * Firebase SDK·SMS HTTP·Slack·DB I/O만 가짜로 바꾸고 생산 모듈을 실행한다.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { selectChannel } from '../../server/cleaning/_notify.js';
import { toE164 } from '../../server/cleaning/_sms.js';
import { actualCleaningModule, installDeliveryIO } from '../helpers/cleaningDeliveryFixture.js';

const ACTIVE = { id: 'cleaner-active', name: 'Active Worker', fcm_status: 'active',
  fcm_token: 'fixture-token', phone: '010-1234-5678' };
const PAYLOAD = { title: 'Fixture title', body: 'Fixture body', data: { jobId: 'fixture-job' }, smsText: 'Fixture SMS' };

function fakeDb(route = () => { throw new Error('Unexpected fixture DB query'); }) {
  const queries = [];
  return { queries, db: { async query(sql, params) {
    queries.push({ sql, params });
    const rows = await route(sql, params);
    return { rows: rows ?? [] };
  } } };
}

// notify() swallows its own UPDATE failures (`.catch`), so an assertion thrown
// inside a fake DB route would be swallowed too. Check recorded queries after the call.
const CHANNEL_SQL = /UPDATE cleaning_notifs SET channel=\$1 WHERE id=\$2/;
const stateSql = status => new RegExp(`UPDATE cleaners SET fcm_status='${status}' WHERE id=\\$1`);
const rejectWith = code => async () => { throw Object.assign(new Error('fixture rejection'), { code }); };
function assertQueries(queries, expected) {
  assert.equal(queries.length, expected.length, 'DB query count');
  expected.forEach(([pattern, params], i) => {
    assert.match(queries[i].sql, pattern);
    assert.deepEqual(queries[i].params, params);
  });
}

function installIo(t, options = {}) {
  const io = installDeliveryIO(options);
  t.after(() => {
    try {
      assert.deepEqual(io.blocked, [], 'no unexpected external I/O');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { io.restore(); }
  });
  return io;
}

describe('actual selectChannel — recipient state', () => {
  for (const [label, cleaner, expected] of [
    ['active token', ACTIVE, 'FCM'],
    ['uninstalled app', { ...ACTIVE, fcm_status: 'uninstalled', fcm_token: null }, 'SMS'],
    ['inactive app', { ...ACTIVE, fcm_status: 'inactive' }, 'SMS'],
    ['unregistered app', { ...ACTIVE, fcm_status: 'unregistered', fcm_token: null }, 'SMS'],
    ['invalid token state', { ...ACTIVE, fcm_status: 'invalid' }, 'SMS'],
    ['active without token', { ...ACTIVE, fcm_token: null }, 'SMS'],
    ['no reachable channel', { ...ACTIVE, fcm_status: 'uninstalled', fcm_token: null, phone: null }, 'NONE'],
  ]) test(`${label} selects ${expected}`, () => {
    assert.equal(selectChannel(cleaner), expected);
  });
});

describe('actual notify — delivery and channel recording', () => {
  test('FCM acceptance records FCM and does not send SMS or alter recipient state', async t => {
    const store = fakeDb(() => []);
    const io = installIo(t, { db: store.db });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');

    assert.deepEqual(await notify(store.db, ACTIVE, { ...PAYLOAD, notifId: 'notif-fcm' }), { ok: true, channel: 'FCM' });
    assert.equal(io.calls.push.length, 1);
    assert.equal(io.calls.push[0].token, ACTIVE.fcm_token);
    assert.deepEqual(io.calls.sms, []);
    assert.deepEqual(io.calls.slack, []);
    assertQueries(store.queries, [[CHANNEL_SQL, ['FCM', 'notif-fcm']]]);
  });

  test('inactive app uses the actual SMS gateway payload and records SMS', async t => {
    const store = fakeDb(() => []);
    const io = installIo(t, { db: store.db });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');
    const cleaner = { ...ACTIVE, fcm_status: 'inactive', fcm_token: 'stale-token' };

    assert.deepEqual(await notify(store.db, cleaner, { ...PAYLOAD, notifId: 'notif-sms' }), { ok: true, channel: 'SMS' });
    assert.deepEqual(io.calls.push, []);
    assert.deepEqual(io.calls.sms[0].body, { phoneNumbers: ['+821012345678'], message: PAYLOAD.smsText });
    assertQueries(store.queries, [[CHANNEL_SQL, ['SMS', 'notif-sms']]]);
  });

  for (const [sdkCode, status] of [
    ['messaging/registration-token-not-registered', 'unregistered'],
    ['messaging/invalid-argument', 'invalid'],
  ]) test(`${sdkCode} updates the actual FCM state, alerts Slack and records SMS_FALLBACK`, async t => {
    t.mock.method(console, 'error', () => {});
    const store = fakeDb(() => []);
    const io = installIo(t, { db: store.db, push: rejectWith(sdkCode) });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');

    assert.deepEqual(await notify(store.db, ACTIVE, { ...PAYLOAD, notifId: `notif-${status}` }),
      { ok: true, channel: 'SMS_FALLBACK' });
    assert.equal(io.calls.push.length, 1);
    assert.deepEqual(io.calls.sms.map(c => c.body.message), [PAYLOAD.smsText]);
    assert.equal(io.calls.slack.length, 1);
    assertQueries(store.queries, [[stateSql(status), [ACTIVE.id]], [CHANNEL_SQL, ['SMS_FALLBACK', `notif-${status}`]]]);
  });

  test('definite invalid token without a phone updates recipient state but returns NONE', async t => {
    t.mock.method(console, 'error', () => {});
    const store = fakeDb(() => []);
    const io = installIo(t, { db: store.db, push: rejectWith('messaging/invalid-argument') });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');

    assert.deepEqual(await notify(store.db, { ...ACTIVE, phone: null }, PAYLOAD), { ok: false, channel: 'NONE' });
    assert.equal(io.calls.slack.length, 1);
    assert.deepEqual(io.calls.sms, []);
    assertQueries(store.queries, [[stateSql('invalid'), [ACTIVE.id]]]);
  });

  test('definite FCM rejection without smsText updates recipient state but sends no SMS and records nothing', async t => {
    t.mock.method(console, 'error', () => {});
    const store = fakeDb(() => []);
    const io = installIo(t, { db: store.db, push: rejectWith('messaging/registration-token-not-registered') });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');
    const { smsText: _omitted, ...withoutSms } = PAYLOAD;

    assert.deepEqual(await notify(store.db, ACTIVE, { ...withoutSms, notifId: 'notif-no-sms-text' }),
      { ok: false, channel: 'NONE' });
    assert.equal(io.calls.push.length, 1);
    assert.deepEqual(io.calls.sms, []);
    assert.equal(io.calls.slack.length, 1);
    assertQueries(store.queries, [[stateSql('unregistered'), [ACTIVE.id]]]);
  });

  test('definite FCM rejection with the SMS gateway unconfigured returns NONE after the recipient update', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
    const store = fakeDb(() => []);
    const io = installIo(t, { db: store.db, push: rejectWith('messaging/invalid-argument') });
    delete process.env.PROPOS_SMS_GW_ID;
    delete process.env.PROPOS_SMS_GW_PWD;
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');

    assert.deepEqual(await notify(store.db, ACTIVE, { ...PAYLOAD, notifId: 'notif-fallback-off' }),
      { ok: false, channel: 'NONE' });
    assert.equal(io.calls.push.length, 1);
    assert.deepEqual(io.calls.sms, []);
    assert.equal(io.calls.slack.length, 1);
    assertQueries(store.queries, [[stateSql('invalid'), [ACTIVE.id]]]);
  });

  test('missing smsText prevents direct SMS and leaves the notification channel unrecorded', async t => {
    t.mock.method(console, 'warn', () => {});
    const store = fakeDb();
    const io = installIo(t, { db: store.db });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');

    assert.deepEqual(await notify(store.db, { ...ACTIVE, fcm_status: 'uninstalled', fcm_token: null },
      { title: PAYLOAD.title, body: PAYLOAD.body, notifId: 'notif-missing-text' }), { ok: false, channel: 'NONE' });
    assert.deepEqual(io.calls.sms, []);
    assert.deepEqual(store.queries, []);
  });

  for (const missing of ['PROPOS_SMS_GW_ID', 'PROPOS_SMS_GW_PWD']) {
    test(`missing ${missing} returns NONE before HTTP and does not record a channel`, async t => {
      t.mock.method(console, 'warn', () => {});
      const store = fakeDb();
      const io = installIo(t, { db: store.db });
      delete process.env[missing];
      const { notify } = await actualCleaningModule('server/cleaning/_notify.js');

      assert.deepEqual(await notify(store.db, { ...ACTIVE, fcm_status: 'uninstalled', fcm_token: null },
        { ...PAYLOAD, notifId: 'notif-no-config' }), { ok: false, channel: 'NONE' });
      assert.deepEqual(io.calls.sms, []);
      assert.deepEqual(store.queries, []);
    });
  }

  test('a successful send without notifId preserves delivery but performs no channel UPDATE', async t => {
    const store = fakeDb();
    const io = installIo(t, { db: store.db });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');

    assert.deepEqual(await notify(store.db, { ...ACTIVE, fcm_status: 'uninstalled', fcm_token: null }, PAYLOAD),
      { ok: true, channel: 'SMS' });
    assert.equal(io.calls.sms.length, 1);
    assert.deepEqual(store.queries, []);
  });

  test('a recipient without FCM or phone returns NONE without external or DB work', async t => {
    const store = fakeDb();
    const io = installIo(t, { db: store.db });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');

    assert.deepEqual(await notify(store.db, { ...ACTIVE, fcm_status: 'uninstalled', fcm_token: null, phone: null }, PAYLOAD),
      { ok: false, channel: 'NONE' });
    assert.deepEqual(io.calls.push, []);
    assert.deepEqual(io.calls.sms, []);
    assert.deepEqual(io.calls.slack, []);
    assert.deepEqual(store.queries, []);
  });
});

describe('actual sendCompletionSmsToRest — remaining recipients', () => {
  const job = { id: 'fixture-job', property_id: 'fixture-property', prop_name: 'Fixture Stay', data_origin: 'REAL',
    cleaning_start_at: '2026-11-30T16:00:00.000Z' };

  function completionDb(jobRows, recipients, extra = () => { throw new Error('Unexpected completion DB query'); }) {
    return fakeDb((sql, params) => {
      if (/FROM cleaning_jobs j/.test(sql)) {
        assert.deepEqual(params, [job.id]);
        return jobRows;
      }
      if (/FROM cleaning_notifs n/.test(sql)) {
        assert.match(sql, /n.cleaner_id != \$2 AND n.response IS NULL/);
        assert.deepEqual(params, [job.id, 'assigned-cleaner']);
        return recipients;
      }
      return extra(sql, params);
    });
  }

  test('FCM, direct SMS and unreachable recipients follow their actual channels and KST completion message', async t => {
    const recipients = [
      { cleaner_id: ACTIVE.id, fcm_status: 'active', fcm_token: ACTIVE.fcm_token, phone: ACTIVE.phone },
      { cleaner_id: 'cleaner-sms', fcm_status: 'uninstalled', fcm_token: null, phone: '010-2222-3333' },
      { cleaner_id: 'cleaner-none', fcm_status: 'inactive', fcm_token: null, phone: null },
    ];
    const store = completionDb([job], recipients);
    const io = installIo(t, { db: store.db });
    const { sendCompletionSmsToRest } = await actualCleaningModule('server/cleaning/_dispatch.js');

    await sendCompletionSmsToRest(store.db, job.id, 'assigned-cleaner');
    assert.equal(io.calls.push.length, 1);
    assert.deepEqual(io.calls.push[0].notification, {
      title: '[PROPOS] 청소 배정 완료',
      body: 'Fixture Stay 2026-12-01 건이 배정됐습니다. 감사합니다.',
    });
    assert.equal(io.calls.sms.length, 1);
    assert.deepEqual(io.calls.sms[0].body, {
      phoneNumbers: ['+821022223333'],
      message: '[PROPOS] Fixture Stay 2026-12-01 청소가 배정 완료됐습니다. 감사합니다.',
    });
    assert.deepEqual(io.calls.slack, []);
    assert.equal(store.queries.length, 2, 'completion notify has no notifId, so no channel UPDATE');
  });

  test('an invalid completion FCM token executes the real status update and SMS fallback', async t => {
    t.mock.method(console, 'error', () => {});
    const recipient = { cleaner_id: ACTIVE.id, fcm_status: 'active', fcm_token: ACTIVE.fcm_token, phone: ACTIVE.phone };
    const store = completionDb([job], [recipient], () => []);
    const io = installIo(t, { db: store.db, push: rejectWith('messaging/registration-token-not-registered') });
    const { sendCompletionSmsToRest } = await actualCleaningModule('server/cleaning/_dispatch.js');

    await sendCompletionSmsToRest(store.db, job.id, 'assigned-cleaner');
    assert.equal(io.calls.push.length, 1);
    assert.deepEqual(io.calls.sms.map(c => c.body.message),
      ['[PROPOS] Fixture Stay 2026-12-01 청소가 배정 완료됐습니다. 감사합니다.']);
    assert.equal(io.calls.slack.length, 1);
    assert.equal(store.queries.length, 3);
    assert.match(store.queries[2].sql, stateSql('unregistered'));
    assert.deepEqual(store.queries[2].params, [ACTIVE.id]);
  });

  for (const [label, rows] of [['missing job', []], ['SIMULATED job', [{ ...job, data_origin: 'SIMULATED' }]]]) {
    test(`${label} stops before recipient selection and delivery`, async t => {
      const store = completionDb(rows, []);
      const io = installIo(t, { db: store.db });
      const { sendCompletionSmsToRest } = await actualCleaningModule('server/cleaning/_dispatch.js');

      await sendCompletionSmsToRest(store.db, job.id, 'assigned-cleaner');
      assert.equal(store.queries.length, 1);
      assert.deepEqual(io.calls.push, []);
      assert.deepEqual(io.calls.sms, []);
      assert.deepEqual(io.calls.slack, []);
    });
  }
});

describe('actual toE164 — SMS destination conversion', () => {
  for (const [phone, expected] of [
    ['010-1234-5678', '+821012345678'],
    ['821012345678', '+821012345678'],
    ['010 1234 5678', '+821012345678'],
    ['01012345678', '+821012345678'],
  ]) test(`${phone} becomes ${expected}`, () => {
    assert.equal(toE164(phone), expected);
  });
});
