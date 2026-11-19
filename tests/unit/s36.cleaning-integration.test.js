/**
 * ACT-08 단계 ⑥-9 — 옛 통합 s36의 복사본 대신 실제 구현을 실행한다.
 * 실제 시험이 없던 것만 여기서 다룬다: Gmail 새 메일 알림 수신, 정기 후속 작업의 요청 대기·VIP 시간 초과 처리,
 * 아침 정기 작업의 Gmail 구독 갱신, 문자 게이트웨이 요청 헤더. 채널 기록·거절 페이지·미등록 담당자·캘린더 조회·
 * 푸시 내용은 s25·s26·s13·s14가 이미 실제 구현으로 시험한다. DB·Google·Slack·SMS 경계만 가짜다.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { actualCronModule, cronResponse, installCronIO } from '../helpers/cronHandlerFixture.js';
import { installDeliveryIO } from '../helpers/cleaningDeliveryFixture.js';
import { sendSms } from '../../server/cleaning/_sms.js';

const SECRET = 'fixture-webhook-secret';
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');

// ── Gmail 새 메일 알림 (공개 경로 gmail-webhook) ─────────────────────────────
// RF-39: Gmail 알림은 "메일함이 바뀌었다 + 지금 기록 번호"만 준다. 새 메일은 그 번호 "까지"에 들어 있으므로
// 마지막으로 처리한 번호(KV)부터 읽어야 한다 — 예전엔 알림의 번호부터 읽어 새 메일을 늘 놓쳤다.

const LAST = 'gmail_last_history_id';
const LOCK = 'gmail_history_lock';
const RESERVATION_SLACK = '[PROPOS] 📬 에어비앤비 신규 예약 이메일 감지. iCal 재폴링 트리거.';

/** 가짜 Gmail. pages: history.list 응답을 차례로(시작 번호·쪽 표시는 실제 요청 주소로 확인한다) */
function gmailApi({ pages = [{ history: [], historyId: '0' }], subjects = {}, status = 200, fail = false, watch, current = '0' } = {}) {
  let page = 0;
  return async (url, options = {}) => {
    if (fail) throw new Error('fixture gmail outage');
    const u = new URL(url);
    if (u.pathname === '/gmail/v1/users/me/watch' && (options.method ?? 'GET') === 'POST') return { ok: true, status: 200, json: async () => watch };
    if (u.pathname === '/gmail/v1/users/me/profile') return { ok: true, status: 200, json: async () => ({ historyId: current }) };
    if (u.pathname === '/gmail/v1/users/me/history') {
      if (status !== 200) return { ok: false, status, json: async () => ({ error: { code: status } }) };
      return { ok: true, status: 200, json: async () => pages[Math.min(page++, pages.length - 1)] };
    }
    const id = u.pathname.split('/').pop();
    return { ok: true, status: 200, json: async () => ({ payload: { headers: [{ name: 'Subject', value: subjects[id] ?? '' }] } }) };
  };
}

/** KV 한 곳(값·NX·만료 옵션 기록) */
function memoryKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  return {
    store, writes,
    get: async key => (store.has(key) ? store.get(key) : null),
    set: async (key, value, options = {}) => {
      writes.push([key, String(value), options]);
      if (options.nx && store.has(key)) return null;
      store.set(key, String(value)); return 'OK';
    },
    del: async key => { const had = store.delete(key); return had ? 1 : 0; },
  };
}

async function gmailWebhook(t, { api = gmailApi(), kv = memoryKv(), expectErrors = false, methods = ['GET'] } = {}) {
  const f = await cleaningDeclineFixture({ icalSync: async () => ({}), calendar: { fetch: api, methods, kv } });
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'all scripted DB results consumed');
      assert.deepEqual(f.unexpectedQueries, [], 'no hidden unexpected SQL');
      assert.deepEqual(f.blocked, [], 'no unmocked external I/O');
      if (!expectErrors) assert.deepEqual(f.errors, [], 'no hidden handler errors');
      assert.ok(!kv.store.has(LOCK), 'the processing lock is always released');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  const send = ({ method = 'POST', url = `/api/cleaning/gmail-webhook?secret=${SECRET}`, data, rawBody } = {}) =>
    f.invoke({ method, url, headers: {}, rawBody: rawBody ?? JSON.stringify({ message: data === undefined ? {} : { data } }) });
  return { ...f, send, kv };
}
const historyUrls = f => f.calendarRequests.map(r => r.url).filter(u => u.includes('/users/me/history'));

function assertNothingHappened(f) {
  assert.deepEqual(f.tokenCalls, []);
  assert.deepEqual(f.calendarRequests, []);
  assert.deepEqual(f.slackCalls, []);
  assert.deepEqual(f.icalSyncCalls, []);
  assert.deepEqual(f.queries, []);
}

describe('actual gmail-webhook — Pub/Sub new-mail notice', () => {
  test('only POST is accepted', async t => {
    const f = await gmailWebhook(t);
    const res = await f.send({ method: 'GET' });
    assert.equal(res.code, 405);
    assertNothingHappened(f);
  });

  test('a wrong secret is acknowledged with 200 and ignored', async t => {
    const f = await gmailWebhook(t);
    const res = await f.send({ url: '/api/cleaning/gmail-webhook?secret=wrong', data: b64({ historyId: '1' }) });
    assert.equal(res.code, 200);
    assertNothingHappened(f);
  });

  test('a non-JSON body is 400', async t => {
    const f = await gmailWebhook(t);
    const res = await f.send({ rawBody: 'not json' });
    assert.equal(res.code, 400);
    assertNothingHappened(f);
  });

  for (const [label, data] of [
    ['missing message.data', undefined],
    ['message.data that is not base64 JSON', b64('!!! not json')],
    ['a payload without historyId', b64({ emailAddress: 'fixture@example.invalid' })],
    ['a historyId that is not a number', b64({ historyId: '12abc' })],
  ]) test(`${label} is acknowledged with 200 without reading Gmail`, async t => {
    const f = await gmailWebhook(t);
    const res = await f.send({ data });
    assert.equal(res.code, 200);
    assertNothingHappened(f);
    assert.deepEqual(f.kv.writes, []);
  });

  test('RF-39: a reservation email is found by reading from the last handled number, not from the notice number', async t => {
    const kv = memoryKv({ [LAST]: '100' });
    const f = await gmailWebhook(t, { kv, api: gmailApi({
      pages: [{ historyId: '106', history: [{ messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm2' } }, { message: { id: 'm3' } }] }] }],
      subjects: { m1: 'Weekly digest', m2: 'Reservation confirmed - Fixture Stay', m3: 'Reservation confirmed - Other' },
    }) });
    const res = await f.send({ data: b64({ historyId: '105', emailAddress: 'fixture@example.invalid' }) });
    assert.equal(res.code, 200);
    assert.deepEqual(f.calendarRequests.map(r => r.url), [
      'https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=100&historyTypes=messageAdded',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=metadata&metadataHeaders=Subject',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m2?format=metadata&metadataHeaders=Subject',
    ]);
    assert.ok(f.calendarRequests.every(r => r.options.headers.Authorization === 'Bearer fixture-gmail-token'));
    assert.deepEqual(f.slackCalls, [[RESERVATION_SLACK]]);
    assert.equal(f.icalSyncCalls.length, 1);
    assert.equal(f.icalSyncCalls[0][0], f.db);
    assert.ok('kv' in f.icalSyncCalls[0][1]);
    assert.equal(kv.store.get(LAST), '106', 'moves to the newest number Gmail reported');
  });

  test('every page of the mailbox history is read, from the same start number', async t => {
    const kv = memoryKv({ [LAST]: '100' });
    const f = await gmailWebhook(t, { kv, api: gmailApi({
      pages: [{ historyId: '110', nextPageToken: 'p2', history: [{ messagesAdded: [{ message: { id: 'm1' } }] }] },
        { historyId: '110', history: [{ messagesAdded: [{ message: { id: 'm2' } }] }] }],
      subjects: { m1: 'Newsletter', m2: '[Airbnb] 예약 확정 안내' },
    }) });
    await f.send({ data: b64({ historyId: '110' }) });
    assert.deepEqual(historyUrls(f), [
      'https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=100&historyTypes=messageAdded',
      'https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=100&historyTypes=messageAdded&pageToken=p2',
    ]);
    assert.equal(f.icalSyncCalls.length, 1);
    assert.equal(kv.store.get(LAST), '110');
  });

  test('no reservation email: nothing is sent, but the number still moves forward', async t => {
    const kv = memoryKv({ [LAST]: '100' });
    const f = await gmailWebhook(t, { kv, api: gmailApi({ pages: [{ historyId: '104', history: [{ messagesAdded: [{ message: { id: 'm1' } }] }] }], subjects: { m1: 'Reservation request from a guest' } }) });
    await f.send({ data: b64({ historyId: '103' }) });
    assert.deepEqual(f.slackCalls, []); assert.deepEqual(f.icalSyncCalls, []);
    assert.equal(kv.store.get(LAST), '104', 'Gmail\'s newest number');
  });

  test('a forged huge notice number cannot push the start point past Gmail\'s real number (real notices keep working)', async t => {
    const kv = memoryKv({ [LAST]: '100' });
    const f = await gmailWebhook(t, { kv, api: gmailApi({ pages: [{ historyId: '130', history: [] }, { historyId: '131', history: [{ messagesAdded: [{ message: { id: 'm9' } }] }] }], subjects: { m9: 'Reservation confirmed - Real' } }) });
    await f.send({ data: b64({ historyId: '99999999999999999999' }) });
    assert.equal(kv.store.get(LAST), '130', 'only the number Gmail itself reported is kept');
    await f.send({ data: b64({ historyId: '131' }) });
    assert.equal(f.icalSyncCalls.length, 1, 'the next real notice is still processed');
    assert.equal(kv.store.get(LAST), '131');
  });

  for (const [subject, triggers] of [
    ['[Airbnb] 예약 확정 안내', true],
    ['BOOKING CONFIRMED: Fixture Stay', true],
    ['Reservation request from a guest', false],
  ]) test(`subject "${subject}" ${triggers ? 'triggers' : 'does not trigger'} the re-sync`, async t => {
    const f = await gmailWebhook(t, { kv: memoryKv({ [LAST]: '6' }), api: gmailApi({ pages: [{ historyId: '7', history: [{ messagesAdded: [{ message: { id: 'm1' } }] }] }], subjects: { m1: subject } }) });
    const res = await f.send({ data: b64({ historyId: '7' }) });
    assert.equal(res.code, 200);
    assert.equal(f.icalSyncCalls.length, triggers ? 1 : 0);
    assert.equal(f.slackCalls.length, triggers ? 1 : 0);
  });

  test('the first notice (no number remembered yet) starts from Gmail\'s own current number and runs one catch-up sync without Slack', async t => {
    const kv = memoryKv();
    const f = await gmailWebhook(t, { kv, api: gmailApi({ current: '480' }) });
    const res = await f.send({ data: b64({ historyId: '500' }) });
    assert.equal(res.code, 200);
    assert.deepEqual(historyUrls(f), [], 'nothing to compare against yet');
    assert.equal(kv.store.get(LAST), '480', 'the start point comes from Gmail, never from the notice');
    assert.equal(f.icalSyncCalls.length, 1, 'cannot tell what was missed, so re-sync once');
    assert.deepEqual(f.slackCalls, []);
  });

  test('if Gmail will not give its current number, nothing is stored or synced (no sync loop on every mailbox change)', async t => {
    const kv = memoryKv();
    const f = await gmailWebhook(t, { kv, api: gmailApi({ current: null }), expectErrors: true });
    const res = await f.send({ data: b64({ historyId: '500' }) });
    assert.equal(res.code, 200);
    assert.equal(kv.store.get(LAST), undefined);
    assert.deepEqual(f.icalSyncCalls, []); assert.deepEqual(f.slackCalls, []);
    assert.ok(f.errors.some(args => args[0] === '[gmail-webhook]'));
  });

  for (const notice of ['150', '200']) test(`a notice not newer than the remembered number (${notice} ≤ 200) is acknowledged without reading Gmail`, async t => {
    const kv = memoryKv({ [LAST]: '200' });
    const f = await gmailWebhook(t, { kv });
    const res = await f.send({ data: b64({ historyId: notice }) });
    assert.equal(res.code, 200);
    assert.deepEqual(historyUrls(f), []); assert.deepEqual(f.icalSyncCalls, []);
    assert.equal(kv.store.get(LAST), '200');
  });

  test('if Gmail no longer has the remembered number (404), it re-syncs once and starts again from the notice', async t => {
    const kv = memoryKv({ [LAST]: '100' });
    const f = await gmailWebhook(t, { kv, api: gmailApi({ status: 404, current: '880' }) });
    const res = await f.send({ data: b64({ historyId: '900' }) });
    assert.equal(res.code, 200);
    assert.equal(historyUrls(f).length, 1);
    assert.equal(f.icalSyncCalls.length, 1); assert.deepEqual(f.slackCalls, []);
    assert.equal(kv.store.get(LAST), '880', 'restarts from Gmail\'s current number');
  });

  for (const [label, api] of [['a Gmail outage', gmailApi({ fail: true })], ['a Gmail 500', gmailApi({ status: 500 })]]) {
    test(`${label} keeps the remembered number so the next notice reads the same range again`, async t => {
      const kv = memoryKv({ [LAST]: '100' });
      const f = await gmailWebhook(t, { kv, api, expectErrors: true });
      const res = await f.send({ data: b64({ historyId: '120' }) });
      assert.equal(res.code, 200);
      assert.deepEqual(f.slackCalls, []); assert.deepEqual(f.icalSyncCalls, []);
      assert.equal(kv.store.get(LAST), '100');
      assert.ok(f.errors.some(args => args[0] === '[gmail-webhook]'));
    });
  }

  test('while another notice is being handled, the new one asks Pub/Sub to deliver it again later (503)', async t => {
    const kv = memoryKv({ [LAST]: '100', [LOCK]: '1' });
    const f = await gmailWebhook(t, { kv });
    const res = await f.send({ data: b64({ historyId: '120' }) });
    assert.equal(res.code, 503);
    assert.deepEqual(historyUrls(f), []);
    assert.equal(kv.store.get(LAST), '100');
    kv.store.delete(LOCK); // 다른 요청이 잡고 있던 잠금 — 이 시험이 푼 게 아님을 분명히
  });

  test('the lock expires on its own (1 minute) so a crashed handler cannot block notices forever', async t => {
    const kv = memoryKv({ [LAST]: '100' });
    const f = await gmailWebhook(t, { kv, api: gmailApi({ pages: [{ historyId: '101', history: [] }] }) });
    await f.send({ data: b64({ historyId: '101' }) });
    assert.deepEqual(kv.writes.find(([key]) => key === LOCK)?.[2], { nx: true, ex: 60 });
  });

  test('the /api/gmail/webhook vercel.json rewrite reaches the same handler', async t => {
    const rule = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')).rewrites
      .find(r => r.source === '/api/gmail/webhook');
    assert.ok(rule);
    const f = await gmailWebhook(t);
    const res = await f.send({ url: `${rule.destination}&secret=${SECRET}`, rawBody: 'not json' });
    assert.equal(res.code, 400);
  });
});

describe('actual gmail-watch registration — remembers where to start reading', () => {
  async function register(t, kv) {
    const before = process.env.GOOGLE_PUBSUB_TOPIC;
    process.env.GOOGLE_PUBSUB_TOPIC = 'projects/fixture/topics/gmail';
    t.after(() => { if (before === undefined) delete process.env.GOOGLE_PUBSUB_TOPIC; else process.env.GOOGLE_PUBSUB_TOPIC = before; });
    const f = await gmailWebhook(t, { kv, methods: ['GET', 'POST'], api: gmailApi({ watch: { historyId: '777', expiration: String(Date.now() + 7 * 86_400_000) } }) });
    const { createSessionToken } = await import('../../server/auth/operatorAuth.js');
    const cookie = 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' });
    return f.invoke({ method: 'POST', url: '/api/cleaning/gmail-watch', headers: { cookie } });
  }
  test('with no number remembered, the watch reply becomes the starting point', async t => {
    const kv = memoryKv();
    const res = await register(t, kv);
    assert.equal(res.code, 200);
    assert.equal(kv.store.get(LAST), '777');
  });
  test('an already remembered number is kept, so mail between the two is not skipped', async t => {
    const kv = memoryKv({ [LAST]: '500' });
    const res = await register(t, kv);
    assert.equal(res.code, 200);
    assert.equal(kv.store.get(LAST), '500');
  });
});

// ── 정기 후속 작업 — 요청 대기·VIP 시간 초과 일정 넘기기 ───────────────────────

const READY_SQL = /status = 'PENDING' AND dispatch_after <= NOW\(\)/;

async function followup(t, { ready = [], vip = [], recovered = 0, advance = async () => ({ ok: true }) } = {}) {
  const { default: handler } = await actualCronModule();
  const fixture = installCronIO({ behavior: {
    'db.query': async sql => ({ rows: READY_SQL.test(sql) ? ready : [] }),
    getVipFollowupJobs: async () => ({ rows: vip }),
    recoverInitialDeliveries: async () => recovered,
    advanceJob: advance,
  } });
  t.after(() => fixture.restore());
  const res = cronResponse();
  await handler({ method: 'GET', url: '/api/cron/cleaning-followup', query: {},
    headers: { authorization: 'Bearer fixture-cron-secret' } }, res);
  const advances = fixture.calls.filter(c => c.name === 'advanceJob').map(c => c.args);
  return { fixture, res, advances };
}

describe('actual cleaning-followup — pending and VIP timeout jobs', () => {
  test('due REAL pending jobs are advanced in order with a slot-opening deleter', async t => {
    const jobs = [{ id: 'j1', property_id: 'p1', checkout_at: '2026-12-01T02:00:00.000Z' }, { id: 'j2', property_id: 'p2', checkout_at: '2026-12-02T02:00:00.000Z' }];
    const { fixture, res, advances } = await followup(t, { ready: jobs });
    assert.deepEqual(res.body, { ok: true, advanced: 2, reminded: 0, escalated: 0 });
    assert.deepEqual(advances.map(a => a[1].id), ['j1', 'j2']);
    assert.ok(advances.every(a => typeof a[2]?.deleteBlocker === 'function'));
    const readySql = fixture.calls.find(c => c.name === 'db.query' && READY_SQL.test(c.args[0])).args[0];
    assert.match(readySql, /data_origin = 'REAL'/);
    assert.match(readySql, /cleaning_start_at > NOW\(\)/);
    assert.match(readySql, /ORDER BY dispatch_after ASC/);

    await advances[0][2].deleteBlocker(jobs[0]);
    const slot = fixture.calls.find(c => c.name === 'openCleaningSlot');
    assert.equal(slot.args[1].propertyId, 'p1');
    assert.ok(fixture.calls.some(c => c.name === 'toKstDateKey' && c.args[0] === jobs[0].checkout_at));
  });

  test('one failing pending job does not stop the next one', async t => {
    const { res, advances } = await followup(t, {
      ready: [{ id: 'j1' }, { id: 'j2' }],
      advance: async (_db, job) => { if (job.id === 'j1') throw new Error('fixture advance failure'); return { ok: true }; },
    });
    assert.deepEqual(advances.map(a => a[1].id), ['j1', 'j2']);
    assert.equal(res.body.advanced, 1);
  });

  test('an advance that reports ok:false is attempted but not counted', async t => {
    const { res, advances } = await followup(t, { ready: [{ id: 'j1' }], advance: async () => ({ ok: false, state: 'SENDING' }) });
    assert.equal(advances.length, 1);
    assert.equal(res.body.advanced, 0);
  });

  test('VIP timeout jobs are advanced after pending jobs and counted with recovered deliveries', async t => {
    const { res, advances, fixture } = await followup(t, { ready: [{ id: 'j1' }], vip: [{ id: 'v1' }, { id: 'v2' }], recovered: 3 });
    assert.deepEqual(advances.map(a => a[1].id), ['j1', 'v1', 'v2']);
    assert.equal(advances[1].length, 2, 'VIP advance gets no deleter option');
    assert.equal(res.body.advanced, 3 + 3);
    assert.ok(fixture.names().indexOf('recoverInitialDeliveries') < fixture.names().indexOf('getVipFollowupJobs'));
  });

  test('a failing VIP advance is isolated from the next VIP job', async t => {
    const { res, advances } = await followup(t, {
      vip: [{ id: 'v1' }, { id: 'v2' }],
      advance: async (_db, job) => { if (job.id === 'v1') throw new Error('fixture VIP failure'); return { ok: true }; },
    });
    assert.deepEqual(advances.map(a => a[1].id), ['v1', 'v2']);
    assert.equal(res.body.advanced, 1);
  });
});

// ── 아침 정기 작업 — Gmail 구독 갱신(요일이 아니라 마지막 갱신 뒤 경과 시간) ───────

const TUESDAY_0800_KST = '2026-11-16T23:00:00.000Z';
const MONDAY_0800_KST = '2026-11-22T23:00:00.000Z';
const WEEK = 7 * 24 * 3600 * 1000;

async function morning(t, { now = TUESDAY_0800_KST, due = true, topic = 'projects/fixture/topics/gmail', reply } = {}) {
  const realNow = Date.now, realFetch = globalThis.fetch, realTopic = process.env.GOOGLE_PUBSUB_TOPIC;
  Date.now = () => Date.parse(now);
  if (topic) process.env.GOOGLE_PUBSUB_TOPIC = topic; else delete process.env.GOOGLE_PUBSUB_TOPIC;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://gmail.googleapis.com/gmail/v1/users/me/watch') throw new Error(`Unexpected fetch ${url}`);
    requests.push({ url: String(url), options });
    return reply ? reply() : { ok: true, json: async () => ({ historyId: '1', expiration: String(Date.parse(now) + WEEK) }) };
  };
  const { default: handler } = await actualCronModule();
  const fixture = installCronIO({ behavior: {
    isRenewalDue: async (_kv, name) => due && name === 'gmail_watch',
    getGmailToken: async () => 'fixture-gmail-token',
  } });
  t.after(() => {
    fixture.restore(); Date.now = realNow; globalThis.fetch = realFetch;
    if (realTopic === undefined) delete process.env.GOOGLE_PUBSUB_TOPIC; else process.env.GOOGLE_PUBSUB_TOPIC = realTopic;
  });
  const res = cronResponse();
  await handler({ method: 'GET', url: '/api/cron/morning', query: {}, headers: { authorization: 'Bearer fixture-cron-secret' } }, res);
  const named = name => fixture.calls.filter(c => c.name === name).map(c => c.args);
  return { res, requests, named };
}

describe('actual morning cron — Gmail Watch renewal by elapsed time', () => {
  test('when due, renews the watch, stores the expiration, marks it renewed and reports it', async t => {
    const { res, requests, named } = await morning(t);
    assert.equal(res.code, 200);
    assert.deepEqual(named('isRenewalDue').find(a => a[1] === 'gmail_watch').slice(1), ['gmail_watch', 6 * 24 * 3600 * 1000]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method, 'POST');
    assert.deepEqual(requests[0].options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-gmail-token' });
    assert.deepEqual(JSON.parse(requests[0].options.body),
      { topicName: 'projects/fixture/topics/gmail', labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' });
    const expiration = String(Date.parse(TUESDAY_0800_KST) + WEEK);
    assert.deepEqual(named('kv.set').map(a => [a[0], a[1], a[2]]), [['gmail_watch_expiration', expiration, { ex: 7 * 24 * 3600 + 3600 }],
      ['gmail_last_history_id', '1', { nx: true }]], 'RF-39: the renewal number becomes the start point only if none is remembered');
    assert.deepEqual(named('markRenewed').map(a => a[1]), ['gmail_watch']);
    assert.deepEqual(named('reportTokenSuccess').map(a => a.slice(1, 3)), [['gmail_watch', 'Gmail Watch 갱신']]);
    assert.ok(named('postSlack').some(a => a[0] === '[PROPOS] 📬 Gmail Watch 자동 갱신 완료 (만료: 2026-11-23)'));
    assert.equal(res.body.ran.at(-1), 'gmail-watch-renewed');
    assert.deepEqual(named('reportTokenFailure'), []);
  });

  test('a KST Monday does not renew on its own when the last renewal is recent', async t => {
    const { res, requests, named } = await morning(t, { now: MONDAY_0800_KST, due: false });
    assert.equal(res.code, 200);
    assert.deepEqual(requests, []);
    assert.deepEqual(named('markRenewed'), []);
    assert.deepEqual(named('reportTokenSuccess'), []);
    assert.ok(!res.body.ran.includes('gmail-watch-renewed'));
  });

  test('without a Pub/Sub topic nothing is requested, marked or reported', async t => {
    const { res, requests, named } = await morning(t, { topic: null });
    assert.deepEqual(requests, []);
    assert.deepEqual(named('getGmailToken'), []);
    assert.deepEqual(named('markRenewed'), []);
    assert.deepEqual(named('reportTokenSuccess'), []);
    assert.deepEqual(named('reportTokenFailure'), []);
    assert.ok(!res.body.ran.includes('gmail-watch-renewed'));
  });

  test('a rejected renewal reports a token failure, does not mark renewal, and the morning still finishes', async t => {
    const { res, requests, named } = await morning(t, { reply: () => ({ ok: false, status: 500, json: async () => ({}) }) });
    assert.equal(res.code, 200);
    assert.equal(requests.length, 1);
    assert.deepEqual(named('markRenewed'), []);
    assert.deepEqual(named('reportTokenSuccess'), []);
    assert.deepEqual(named('kv.set'), []);
    const [failure] = named('reportTokenFailure');
    assert.deepEqual(failure.slice(1, 3), ['gmail_watch', 'Gmail Watch 갱신']);
    assert.equal(failure[3].message, 'Gmail watch API 500');
    assert.ok(!res.body.ran.includes('gmail-watch-renewed'));
    assert.ok(named('checkStaleness').some(a => a[1] === 'gmail_watch'));
  });

  test('a renewal reply without expiration still marks renewal and reports an unknown expiry', async t => {
    const { res, named } = await morning(t, { reply: () => ({ ok: true, json: async () => ({ historyId: '1' }) }) });
    assert.deepEqual(named('kv.set').map(a => a[0]), ['gmail_last_history_id']);
    assert.deepEqual(named('markRenewed').map(a => a[1]), ['gmail_watch']);
    assert.deepEqual(named('reportTokenSuccess').map(a => a.slice(1, 3)), [['gmail_watch', 'Gmail Watch 갱신']]);
    assert.ok(named('postSlack').some(a => a[0] === '[PROPOS] 📬 Gmail Watch 자동 갱신 완료 (만료: 알 수 없음)'));
    assert.equal(res.body.ran.at(-1), 'gmail-watch-renewed');
  });
});

// ── 문자 게이트웨이 요청 헤더 ────────────────────────────────────────────────

describe('actual sendSms — gateway request headers', () => {
  const AUTH = `Basic ${Buffer.from('fixture-id:fixture-pwd').toString('base64')}`;
  for (const [label, options] of [['legacy path', undefined], ['initial-request (detailed) path', { detailed: true }]]) {
    test(`${label} posts JSON with Basic auth built from the gateway id and password`, async t => {
      t.mock.method(console, 'warn', () => {});
      const io = installDeliveryIO();
      t.after(() => io.restore());
      // distinct values so a swapped id/password order is visible (restore() puts the previous values back)
      process.env.PROPOS_SMS_GW_ID = 'fixture-id';
      process.env.PROPOS_SMS_GW_PWD = 'fixture-pwd';
      const result = await sendSms('010-1234-5678', 'Fixture SMS', options);
      assert.equal(io.calls.sms.length, 1);
      assert.equal(io.calls.sms[0].method, 'POST');
      assert.equal(io.calls.sms[0].headers['Content-Type'], 'application/json');
      assert.equal(io.calls.sms[0].headers.Authorization, AUTH);
      assert.deepEqual(io.calls.sms[0].body, { phoneNumbers: ['+821012345678'], message: 'Fixture SMS' });
      if (options?.detailed) assert.deepEqual(result, { outcome: 'ACCEPTED', provider: 'SMS', providerMessageId: 'fixture-provider-id' });
      else assert.equal(result, true);
      assert.deepEqual(io.blocked, []);
    });
  }
});
