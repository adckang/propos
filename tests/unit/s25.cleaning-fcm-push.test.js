/**
 * ACT-08 단계 ⑤ — 실제 FCM 발송·수신자 처리·메시지 생성 계약.
 * SDK·HTTP·DB만 대역으로 교체한다. 실제 발송·운영 DB 연결은 하지 않는다.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ACT-08 step 5: all decisions and message producers below execute production modules.
import { actualCleaningModule, installDeliveryIO } from '../helpers/cleaningDeliveryFixture.js';

const PUSH_APP = { name: 'fixture-firebase-app' }, PUSH_CREDENTIAL = { fixture: 'credential' };
const PUSH_PAYLOAD = { title: 'Fixture title', body: 'Fixture body' };
const PUSH_CLEANER = { id: 'fixture-cleaner', name: 'Fixture Worker', tier: 'VIP_1', active: true,
  phone: '01000000000', fcm_status: 'active', fcm_token: 'fixture-fcm-token' };
const PUSH_JOB = { id: 'fixture-job', property_id: 'fixture-property', data_origin: 'REAL', status: 'PENDING',
  checkout_at: '2026-12-01T02:00:00.000Z', cleaning_start_at: '2026-12-01T02:00:00.000Z' };
const PUSH_PROPERTY = { property_id: PUSH_JOB.property_id, name: 'Fixture Stay', data_origin: 'REAL',
  google_calendar_booking_url: 'https://fixture.invalid/book', host_phone: '000000000' };

// Scripted persistence responses, never an implementation of SQL or dispatch policy.
function pushDb(responses) {
  const pending = [...responses], queries = [], unexpected = [], releases = [];
  let ends = 0, connects = 0;
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (!pending.length) { unexpected.push({ sql, params }); throw new Error('Unexpected fixture DB query'); }
      const next = pending.shift();
      if (next instanceof Error) throw next;
      return { rows: typeof next === 'function' ? next(sql, params) : next };
    },
    async connect() { connects++; return { query: db.query, release: error => releases.push(error) }; },
    async end() { ends++; },
  };
  return { db, queries, unexpected, releases, get pending() { return pending.length; },
    get ends() { return ends; }, get connects() { return connects; } };
}
async function actualPush(t, { responses = [], apps = [PUSH_APP], account, sdk = {}, push, sms, expectedErrors = 0 } = {}) {
  const env = { PROPOS_DATA_PROFILE: 'hybrid', PROPOS_BASE_URL: 'https://fixture.invalid',
    CRON_SECRET: 'fixture-cron-secret', FIREBASE_SERVICE_ACCOUNT_JSON: account === undefined ? undefined
      : typeof account === 'string' ? account : JSON.stringify(account) };
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const store = pushDb(responses), sdkCalls = { apps: [], cert: [], init: [], messaging: [] }, errors = [];
  const firebase = {
    getApps() { sdkCalls.apps.push([]); return sdk.getApps ? sdk.getApps() : apps; },
    cert(value) { sdkCalls.cert.push(value); return sdk.cert ? sdk.cert(value) : PUSH_CREDENTIAL; },
    initializeApp(value) { sdkCalls.init.push(value); return sdk.initializeApp ? sdk.initializeApp(value) : PUSH_APP; },
    getMessaging(app) { sdkCalls.messaging.push(app); return sdk.getMessaging ? sdk.getMessaging(app)
      : { send: message => globalThis.__cleaningDeliveryIO.push(message) }; },
  };
  const io = installDeliveryIO({ push, sms, firebase, db: store.db });
  const previousError = console.error;
  console.error = (...args) => errors.push(args);
  t.after(() => {
    try {
      assert.equal(store.pending, 0, 'all planned DB results consumed');
      assert.deepEqual(store.unexpected, [], 'no unexpected SQL hidden by production error handling');
      assert.deepEqual(io.blocked, [], 'no unexpected external I/O');
      assert.equal(errors.length, expectedErrors, 'only planned error logs');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally {
      console.error = previousError; io.restore();
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
  const { sendPush } = await actualCleaningModule('server/cleaning/_push.js');
  return { ...io, store, sdkCalls, errors, sendPush };
}
function assertNoPushSdk(f) {
  assert.deepEqual(f.sdkCalls, { apps: [], cert: [], init: [], messaging: [] });
  assert.deepEqual(f.calls.push, []); assert.deepEqual(f.calls.sms, []); assert.deepEqual(f.calls.slack, []);
}
function assertPushMessage(f, notification, data = {}, index = 0) {
  assert.deepEqual(f.calls.push[index], { token: PUSH_CLEANER.fcm_token, notification, data,
    android: { priority: 'high', notification: { sound: 'default' } } });
}

describe('actual FCM sender — input, payload and provider receipt', () => {
  for (const token of [null, undefined, '']) for (const detailed of [false, true]) {
    test(`missing token ${String(token)} / detailed=${detailed} stops before Firebase`, async t => {
      const f = await actualPush(t);
      assert.deepEqual(await f.sendPush(token, PUSH_PAYLOAD, { detailed }), { success: false, errorCode: 'NO_TOKEN',
        ...(detailed ? { outcome: 'FAILED', provider: 'FCM' } : {}) });
      assertNoPushSdk(f);
    });
  }
  test('legacy success preserves payload, Android delivery options and stringifies data without mutation', async t => {
    const f = await actualPush(t);
    const data = { count: 123, flag: false, enabled: true, nil: null, absent: undefined, text: 'ABC', empty: '', object: { a: 1 }, list: [1, 2] };
    const before = structuredClone(data);
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, { ...PUSH_PAYLOAD, data }), { success: true });
    assertPushMessage(f, PUSH_PAYLOAD, { count: '123', flag: 'false', enabled: 'true', nil: '', absent: '', text: 'ABC', empty: '', object: '[object Object]', list: '1,2' });
    assert.deepEqual(data, before); assert.equal(f.calls.push.length, 1);
  });
  test('omitted data defaults to an empty object and FCM needs no SMS configuration', async t => {
    const f = await actualPush(t); delete process.env.PROPOS_SMS_GW_ID; delete process.env.PROPOS_SMS_GW_PWD;
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD), { success: true });
    assertPushMessage(f, PUSH_PAYLOAD); assert.deepEqual(f.calls.sms, []);
  });
  test('detailed success records provider acceptance and the exact provider message ID', async t => {
    const f = await actualPush(t, { push: async () => 'projects/fixture/messages/receipt-123' });
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD, { detailed: true }),
      { success: true, outcome: 'ACCEPTED', provider: 'FCM', providerMessageId: 'projects/fixture/messages/receipt-123' });
    assertPushMessage(f, PUSH_PAYLOAD); assert.equal(f.calls.push.length, 1);
  });
  for (const receipt of [undefined, null, '', 123, {}]) test(`missing or malformed receipt remains UNKNOWN (${JSON.stringify(receipt)})`, async t => {
    const f = await actualPush(t, { push: async () => receipt });
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD, { detailed: true }),
      { success: false, outcome: 'UNKNOWN', provider: 'FCM', errorCode: 'FCM_RECEIPT_MISSING' });
    assert.equal(f.calls.push.length, 1); assert.deepEqual(f.calls.sms, []);
  });
  test('legacy caller retains its existing success shape without receipt validation', async t => {
    const f = await actualPush(t, { push: async () => undefined });
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD), { success: true });
  });
});

describe('actual FCM sender — Firebase initialization boundary', () => {
  test('an existing app is reused even with malformed service account JSON', async t => {
    const f = await actualPush(t, { account: '{invalid fixture JSON' });
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD), { success: true });
    assert.deepEqual(f.sdkCalls.cert, []); assert.deepEqual(f.sdkCalls.init, []);
    assert.deepEqual(f.sdkCalls.messaging, [PUSH_APP]);
  });
  test('a fresh app parses the fixture service account and supplies its credential to initializeApp', async t => {
    const account = { project_id: 'fixture-project', client_email: 'fixture@example.invalid', private_key: 'fixture-key-not-a-real-key' };
    const f = await actualPush(t, { apps: [], account });
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD), { success: true });
    assert.deepEqual(f.sdkCalls.cert, [account]); assert.deepEqual(f.sdkCalls.init, [{ credential: PUSH_CREDENTIAL }]);
    assert.deepEqual(f.sdkCalls.messaging, [PUSH_APP]);
  });
  for (const [label, options] of [
    ['missing account', { apps: [] }], ['invalid JSON', { apps: [], account: '{invalid' }],
    ['credential failure', { apps: [], account: {}, sdk: { cert() { throw new Error('fixture cert failure'); } } }],
    ['app initialization failure', { apps: [], account: {}, sdk: { initializeApp() { throw new Error('fixture init failure'); } } }],
    ['messaging initialization failure', { sdk: { getMessaging() { throw new Error('fixture messaging failure'); } } }],
  ]) test(`${label} is a definite pre-send failure`, async t => {
    const f = await actualPush(t, options);
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD, { detailed: true }),
      { success: false, errorCode: 'UNKNOWN', provider: 'FCM', outcome: 'FAILED' });
    assert.deepEqual(f.calls.push, []); assert.deepEqual(f.calls.sms, []);
  });
});

const PUSH_ERRORS = [
  ['messaging/registration-token-not-registered', 'UNREGISTERED', 'FAILED'],
  ['messaging/invalid-argument', 'INVALID_ARGUMENT', 'FAILED'],
  ['messaging/invalid-registration-token', 'INVALID_ARGUMENT', 'FAILED'],
  ['messaging/quota-exceeded', 'messaging/quota-exceeded', 'RETRYABLE'],
  ['app/network-error', 'app/network-error', 'UNKNOWN'], ['', '', 'UNKNOWN'],
];
describe('actual FCM sender — SDK errors and result certainty', () => {
  for (const [code, errorCode, outcome] of PUSH_ERRORS) for (const detailed of [false, true]) {
    test(`${JSON.stringify(code)} / detailed=${detailed} uses actual error normalization`, async t => {
      const f = await actualPush(t, { expectedErrors: detailed ? 0 : 1,
        push: async () => { throw Object.assign(new Error('fixture SDK error'), { code }); } });
      assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD, { detailed }),
        { success: false, errorCode, ...(detailed ? { provider: 'FCM', outcome } : {}) });
      assert.equal(f.calls.push.length, 1); assert.deepEqual(f.calls.sms, []);
      if (!detailed) { assert.equal(f.errors[0][0], '[push] FCM 발송 실패:'); assert.equal(f.errors[0][1].code, code); }
    });
  }
  test('Firebase errorInfo.code takes precedence over outer code', async t => {
    const f = await actualPush(t, { push: async () => { throw { code: 'messaging/quota-exceeded', errorInfo: { code: 'messaging/invalid-argument' } }; } });
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD, { detailed: true }),
      { success: false, errorCode: 'INVALID_ARGUMENT', provider: 'FCM', outcome: 'FAILED' });
  });
  test('an error without a code after send starts remains UNKNOWN', async t => {
    const f = await actualPush(t, { push: async () => { throw new Error('fixture network result lost'); } });
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD, { detailed: true }),
      { success: false, errorCode: 'UNKNOWN', provider: 'FCM', outcome: 'UNKNOWN' });
  });
  test('a synchronous SDK send throw is also an unknown send result', async t => {
    const f = await actualPush(t, { sdk: { getMessaging: () => ({ send() { throw new Error('fixture send throw'); } }) } });
    assert.deepEqual(await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD, { detailed: true }),
      { success: false, errorCode: 'UNKNOWN', provider: 'FCM', outcome: 'UNKNOWN' });
  });
});

describe('actual FCM sender — timeout and cleanup', () => {
  for (const timeoutMs of [undefined, 25]) test(`detailed timeout ${timeoutMs ?? 'default 10000'} does not retry or claim failure`, async t => {
    let accept;
    const sending = new Promise(resolve => { accept = resolve; });
    const f = await actualPush(t, { push: () => sending });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let settled = false;
    const result = f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD, { detailed: true, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    result.then(() => { settled = true; });
    t.mock.timers.tick((timeoutMs ?? 10000) - 1); await Promise.resolve(); assert.equal(settled, false);
    t.mock.timers.tick(1);
    assert.deepEqual(await result, { success: false, errorCode: 'FCM_RESPONSE_TIMEOUT', provider: 'FCM', outcome: 'UNKNOWN' });
    accept('projects/fixture/messages/late'); await Promise.resolve();
    assert.equal(f.calls.push.length, 1); assert.deepEqual(f.calls.sms, []);
  });
  test('success clears the detailed timeout instead of leaving a delayed failure', async t => {
    const f = await actualPush(t); t.mock.timers.enable({ apis: ['setTimeout'] });
    const clear = t.mock.method(globalThis, 'clearTimeout');
    assert.equal((await f.sendPush(PUSH_CLEANER.fcm_token, PUSH_PAYLOAD, { detailed: true })).outcome, 'ACCEPTED');
    assert.equal(clear.mock.callCount(), 1);
    t.mock.timers.tick(10000); assert.equal(f.calls.push.length, 1);
  });
});

describe('actual FCM notification — recipient state and channel boundaries', () => {
  test('initial Firebase configuration failure is FAILED without invalidating the recipient or falling back to SMS', async t => {
    const f = await actualPush(t, { apps: [] });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');
    const result = await notify(f.store.db, PUSH_CLEANER, { ...PUSH_PAYLOAD, smsText: 'Fixture SMS', deliveryId: 'fixture-delivery' });
    assert.equal(result.outcome, 'FAILED'); assert.equal(result.channel, 'NONE'); assert.equal(result.ok, false);
    assert.deepEqual(f.calls.push, []); assert.deepEqual(f.calls.sms, []); assert.deepEqual(f.calls.slack, []);
    assert.deepEqual(f.store.queries, []);
  });
  for (const [code, status] of [['messaging/registration-token-not-registered', 'unregistered'], ['messaging/invalid-argument', 'invalid']]) {
    test(`${code} updates the real recipient status and uses the existing fake SMS fallback`, async t => {
      const f = await actualPush(t, { responses: [[], []], expectedErrors: 1,
        push: async () => { throw Object.assign(new Error('fixture rejected'), { code }); } });
      const { notify } = await actualCleaningModule('server/cleaning/_notify.js');
      assert.deepEqual(await notify(f.store.db, PUSH_CLEANER, { ...PUSH_PAYLOAD, smsText: 'Fixture SMS', notifId: 'fixture-notif' }),
        { ok: true, channel: 'SMS_FALLBACK' });
      assert.deepEqual(f.store.queries[0].params, [PUSH_CLEANER.id]);
      assert.ok(f.store.queries[0].sql.includes(`SET fcm_status='${status}'`));
      assert.match(f.store.queries[0].sql, /WHERE id=\$1/);
      assert.deepEqual(f.store.queries[1].params, ['SMS_FALLBACK', 'fixture-notif']);
      assert.equal(f.calls.slack.length, 1); assert.equal(f.calls.sms.length, 1); assert.equal(f.calls.push.length, 1);
    });
  }
  for (const [code, outcome] of [['messaging/quota-exceeded', 'RETRYABLE'], ['app/network-error', 'UNKNOWN']]) test(`initial ${code} neither invalidates the recipient nor falls back to SMS`, async t => {
    const f = await actualPush(t, { push: async () => { throw Object.assign(new Error('fixture'), { code }); } });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');
    const result = await notify(f.store.db, PUSH_CLEANER, { ...PUSH_PAYLOAD, smsText: 'Fixture SMS', deliveryId: 'fixture-delivery' });
    assert.equal(result.outcome, outcome);
    assert.equal(result.ok, false); assert.equal(result.channel, 'NONE');
    assert.deepEqual(f.store.queries, []); assert.deepEqual(f.calls.sms, []); assert.deepEqual(f.calls.slack, []);
  });
  test('legacy success records the actual FCM channel without changing recipient status', async t => {
    const f = await actualPush(t, { responses: [[]] });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');
    assert.deepEqual(await notify(f.store.db, PUSH_CLEANER, { ...PUSH_PAYLOAD, smsText: 'Fixture SMS', notifId: 'fixture-notif' }), { ok: true, channel: 'FCM' });
    assert.match(f.store.queries[0].sql, /UPDATE cleaning_notifs SET channel=\$1 WHERE id=\$2/);
    assert.deepEqual(f.store.queries[0].params, ['FCM', 'fixture-notif']);
    assert.deepEqual(f.calls.slack, []); assert.deepEqual(f.calls.sms, []);
  });
  for (const code of ['messaging/quota-exceeded', 'UNKNOWN']) test(`legacy ${code} preserves its SMS fallback without invalidating the recipient`, async t => {
    const f = await actualPush(t, { responses: [[]], expectedErrors: 2,
      push: async () => { throw Object.assign(new Error('fixture legacy error'), { code }); } });
    const { notify } = await actualCleaningModule('server/cleaning/_notify.js');
    assert.deepEqual(await notify(f.store.db, PUSH_CLEANER, { ...PUSH_PAYLOAD, smsText: 'Fixture SMS', notifId: 'fixture-notif' }),
      { ok: true, channel: 'SMS_FALLBACK' });
    assert.equal(f.store.queries.length, 1);
    assert.match(f.store.queries[0].sql, /UPDATE cleaning_notifs SET channel=\$1/);
    assert.deepEqual(f.store.queries[0].params, ['SMS_FALLBACK', 'fixture-notif']);
    assert.equal(f.calls.sms.length, 1); assert.deepEqual(f.calls.slack, []);
  });
});

// These scripted RETURNING rows echo data actually supplied to the DB by production code.
// They do not calculate message text, state transitions, retry policy, or token values.
function vipPushResponses(property) {
  let saved;
  const current = { ...PUSH_JOB, property_data_origin: 'REAL', property_name: property.name,
    booking_url: property.google_calendar_booking_url, host_phone: property.host_phone };
  return [[property], [], [{ gone: false }], [PUSH_CLEANER], [], [], [current], [], [PUSH_CLEANER], [], [],
    (sql, params) => { assert.match(sql, /INSERT INTO cleaning_notifs/); saved = { id: 'fixture-notif', token: params[3],
      initial_delivery_state: 'READY', initial_delivery_data: JSON.parse(params[5]) }; return [saved]; },
    (sql, params) => { assert.match(sql, /SET initial_delivery_state='SENDING'/); saved = { ...saved,
      initial_delivery_state: 'SENDING', initial_delivery_data: JSON.parse(params[1]) }; return [saved]; },
    [], [{ id: 'fixture-notif' }],
    (sql, params) => { assert.match(sql, /initial_accepted_at=\$5/); assert.equal(params[2], 'ACCEPTED');
      assert.equal(params[5], 'FCM');
      assert.equal(JSON.parse(params[3]).result.providerMessageId, 'projects/fixture/messages/message-id');
      return [{ ...saved, initial_delivery_state: 'ACCEPTED' }]; },
    [{ id: PUSH_JOB.id }]];
}

describe('actual FCM producers — VIP, BULK, reminder and completion', () => {
  for (const property of [PUSH_PROPERTY, { ...PUSH_PROPERTY, google_calendar_booking_url: null, host_phone: null }]) {
    test(`VIP request uses the actual durable dispatch payload (${property.google_calendar_booking_url ? 'configured URL' : 'fallback URL'})`, async t => {
      const f = await actualPush(t, { responses: vipPushResponses(property) });
      const { advanceJob } = await actualCleaningModule('server/cleaning/_dispatch.js');
      assert.deepEqual(await advanceJob(f.store.db, PUSH_JOB), { ok: true, state: 'ACCEPTED', jobAdvanced: true });
      assert.equal(f.calls.push.length, 1); assert.deepEqual(f.calls.sms, []);
      const token = f.calls.push[0].data.token; assert.match(token, /^[A-Z0-9]{6}$/);
      const persisted = f.store.queries.find(q => /INSERT INTO cleaning_notifs/.test(q.sql));
      assert.equal(token, persisted.params[3], 'the message token must match the token saved for this request');
      assertPushMessage(f, { title: '[PROPOS] 청소 요청', body: 'Fixture Stay 2026-12-01 11:00' },
        { jobId: PUSH_JOB.id, token, calendarUrl: property.google_calendar_booking_url ?? 'https://fixture.invalid/c/fixture-property', hostPhone: property.host_phone ?? '' });
      assert.equal(f.store.connects, 1); assert.deepEqual(f.store.releases, [undefined]);
    });
  }
  test('BULK dispatch produces its real message and records the notification channel', async t => {
    const cleaner = { ...PUSH_CLEANER, tier: 'BULK' };
    const f = await actualPush(t, { responses: [[PUSH_PROPERTY], [{ gone: false }], [cleaner], [{ id: 'fixture-notif', token: 'ABC123' }], [], [{ id: PUSH_JOB.id }]] });
    const { advanceJob } = await actualCleaningModule('server/cleaning/_dispatch.js');
    assert.deepEqual(await advanceJob(f.store.db, { ...PUSH_JOB, status: 'NOTIFYING_VIP_3' }), { ok: true });
    assertPushMessage(f, { title: '[PROPOS] 청소 아르바이트 안내', body: 'Fixture Stay 2026-12-01 11:00 선착순' },
      { jobId: PUSH_JOB.id, token: 'ABC123', calendarUrl: PUSH_PROPERTY.google_calendar_booking_url, hostPhone: PUSH_PROPERTY.host_phone });
    assert.deepEqual(f.store.queries[4].params, ['FCM', 'fixture-notif']); assert.deepEqual(f.calls.sms, []);
  });
  for (const [job, body] of [[{ ...PUSH_JOB, prop_name: 'Fixture Stay' }, 'Fixture Stay 2026-12-01 건이 배정됐습니다. 감사합니다.'],
    [{ ...PUSH_JOB, cleaning_start_at: '2026-11-30T16:00:00.000Z' }, 'fixture-property 2026-12-01 건이 배정됐습니다. 감사합니다.']]) {
    test(`completion uses the actual property name fallback and KST date (${body})`, async t => {
      const f = await actualPush(t, { responses: [[job], [{ cleaner_id: PUSH_CLEANER.id, ...PUSH_CLEANER }]] });
      const { sendCompletionSmsToRest } = await actualCleaningModule('server/cleaning/_dispatch.js');
      await sendCompletionSmsToRest(f.store.db, PUSH_JOB.id, 'fixture-assigned-cleaner');
      assertPushMessage(f, { title: '[PROPOS] 청소 배정 완료', body });
      assert.match(f.store.queries[1].sql, /n.cleaner_id != \$2 AND n.response IS NULL/);
      assert.deepEqual(f.store.queries[1].params, [PUSH_JOB.id, 'fixture-assigned-cleaner']); assert.deepEqual(f.calls.sms, []);
    });
  }
  for (const rows of [[], [{ ...PUSH_JOB, data_origin: 'SIMULATED' }]]) test(`completion skips missing/SIMULATED jobs (${rows.length})`, async t => {
    const f = await actualPush(t, { responses: [rows] });
    const { sendCompletionSmsToRest } = await actualCleaningModule('server/cleaning/_dispatch.js');
    await sendCompletionSmsToRest(f.store.db, PUSH_JOB.id, 'fixture-assigned-cleaner'); assertNoPushSdk(f);
  });
  test('SIMULATED dispatch never selects a recipient or sends a real notification', async t => {
    const f = await actualPush(t);
    const { advanceJob } = await actualCleaningModule('server/cleaning/_dispatch.js');
    assert.deepEqual(await advanceJob(f.store.db, { ...PUSH_JOB, data_origin: 'SIMULATED' }), { simulated: true, skippedExternalSideEffects: true });
    assertNoPushSdk(f); assert.deepEqual(f.store.queries, []);
  });
  test('reminder executes the entire actual cron handler and sends the current production message', async t => {
    const reminder = { id: 'fixture-notif', cleaner_id: PUSH_CLEANER.id, job_id: PUSH_JOB.id, property_id: PUSH_JOB.property_id,
      token: 'ABC123', cleaning_start_at: PUSH_JOB.cleaning_start_at, job_checkout_at: PUSH_JOB.checkout_at,
      phone: PUSH_CLEANER.phone, fcm_token: PUSH_CLEANER.fcm_token, fcm_status: 'active' };
    // 첫 [] = 청소 시작 시 담당자 없음 확인(RF-32, 후속 처리 맨 앞) — 대상 없음
    const f = await actualPush(t, { responses: [[], [], [], [], [], [reminder], [{ gone: false }], [PUSH_PROPERTY], [], [], [], []] });
    const { default: handler } = await actualCleaningModule('api/cron/[...slug].js');
    const res = { code: null, body: undefined, status(n) { this.code = n; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
    await handler({ method: 'GET', url: '/api/cron/cleaning-followup', query: {}, headers: { authorization: 'Bearer fixture-cron-secret' } }, res);
    assert.equal(res.code, 200); assert.deepEqual(res.body, { ok: true, advanced: 0, reminded: 1, escalated: 0 });
    assertPushMessage(f, { title: '[PROPOS] 청소 재안내', body: 'Fixture Stay 청소 일정 아직 미확정입니다' },
      { jobId: PUSH_JOB.id, token: 'ABC123', calendarUrl: PUSH_PROPERTY.google_calendar_booking_url, hostPhone: PUSH_PROPERTY.host_phone });
    assert.equal(f.store.ends, 1); assert.deepEqual(f.calls.sms, []);
  });
});
