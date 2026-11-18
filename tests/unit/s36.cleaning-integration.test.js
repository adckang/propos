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

function gmailApi({ history = [], subjects = {}, fail = false } = {}) {
  return async url => {
    if (fail) throw new Error('fixture gmail outage');
    const u = new URL(url);
    if (u.pathname === '/gmail/v1/users/me/history') return { ok: true, json: async () => ({ history }) };
    const id = u.pathname.split('/').pop();
    return { ok: true, json: async () => ({ payload: { headers: [{ name: 'Subject', value: subjects[id] ?? '' }] } }) };
  };
}

async function gmailWebhook(t, { api = gmailApi(), expectErrors = false } = {}) {
  const f = await cleaningDeclineFixture({ icalSync: async () => ({}), calendar: { fetch: api, methods: ['GET'] } });
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'all scripted DB results consumed');
      assert.deepEqual(f.unexpectedQueries, [], 'no hidden unexpected SQL');
      assert.deepEqual(f.blocked, [], 'no unmocked external I/O');
      if (!expectErrors) assert.deepEqual(f.errors, [], 'no hidden handler errors');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  const send = ({ method = 'POST', url = `/api/cleaning/gmail-webhook?secret=${SECRET}`, data, rawBody } = {}) =>
    f.invoke({ method, url, headers: {}, rawBody: rawBody ?? JSON.stringify({ message: data === undefined ? {} : { data } }) });
  return { ...f, send };
}

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
  ]) test(`${label} is acknowledged with 200 without reading Gmail`, async t => {
    const f = await gmailWebhook(t);
    const res = await f.send({ data });
    assert.equal(res.code, 200);
    assertNothingHappened(f);
  });

  test('a reservation email triggers one Slack notice and one iCal re-sync, stopping at the first match', async t => {
    const f = await gmailWebhook(t, { api: gmailApi({
      history: [{ messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm2' } }, { message: { id: 'm3' } }] }],
      subjects: { m1: 'Weekly digest', m2: 'Reservation confirmed - Fixture Stay', m3: 'Reservation confirmed - Other' },
    }) });
    const res = await f.send({ data: b64({ historyId: '2694059', emailAddress: 'fixture@example.invalid' }) });
    assert.equal(res.code, 200);
    assert.deepEqual(f.calendarRequests.map(r => r.url), [
      'https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=2694059&historyTypes=messageAdded',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=metadata&metadataHeaders=Subject',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m2?format=metadata&metadataHeaders=Subject',
    ]);
    assert.ok(f.calendarRequests.every(r => r.options.headers.Authorization === 'Bearer fixture-gmail-token'));
    assert.deepEqual(f.slackCalls, [['[PROPOS] 📬 에어비앤비 신규 예약 이메일 감지. iCal 재폴링 트리거.']]);
    assert.equal(f.icalSyncCalls.length, 1);
    assert.equal(f.icalSyncCalls[0][0], f.db);
    assert.ok('kv' in f.icalSyncCalls[0][1]);
  });

  for (const [subject, triggers] of [
    ['[Airbnb] 예약 확정 안내', true],
    ['BOOKING CONFIRMED: Fixture Stay', true],
    ['Reservation request from a guest', false],
  ]) test(`subject "${subject}" ${triggers ? 'triggers' : 'does not trigger'} the re-sync`, async t => {
    const f = await gmailWebhook(t, { api: gmailApi({ history: [{ messagesAdded: [{ message: { id: 'm1' } }] }], subjects: { m1: subject } }) });
    const res = await f.send({ data: b64({ historyId: '7' }) });
    assert.equal(res.code, 200);
    assert.equal(f.icalSyncCalls.length, triggers ? 1 : 0);
    assert.equal(f.slackCalls.length, triggers ? 1 : 0);
  });

  test('a Gmail API failure is logged and still acknowledged with 200', async t => {
    const f = await gmailWebhook(t, { api: gmailApi({ fail: true }), expectErrors: true });
    const res = await f.send({ data: b64({ historyId: '7' }) });
    assert.equal(res.code, 200);
    assert.deepEqual(f.slackCalls, []);
    assert.deepEqual(f.icalSyncCalls, []);
    assert.ok(f.errors.some(args => args[0] === '[gmail-webhook]'));
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
    assert.deepEqual(named('kv.set').map(a => [a[0], a[1], a[2]]), [['gmail_watch_expiration', expiration, { ex: 7 * 24 * 3600 + 3600 }]]);
    assert.deepEqual(named('markRenewed').map(a => a[1]), ['gmail_watch']);
    assert.ok(named('postSlack').some(a => a[0] === '[PROPOS] 📬 Gmail Watch 자동 갱신 완료 (만료: 2026-11-23)'));
    assert.equal(res.body.ran.at(-1), 'gmail-watch-renewed');
    assert.deepEqual(named('reportTokenFailure'), []);
  });

  test('a KST Monday does not renew on its own when the last renewal is recent', async t => {
    const { res, requests, named } = await morning(t, { now: MONDAY_0800_KST, due: false });
    assert.equal(res.code, 200);
    assert.deepEqual(requests, []);
    assert.deepEqual(named('markRenewed'), []);
    assert.ok(!res.body.ran.includes('gmail-watch-renewed'));
  });

  test('without a Pub/Sub topic nothing is requested, marked or reported', async t => {
    const { res, requests, named } = await morning(t, { topic: null });
    assert.deepEqual(requests, []);
    assert.deepEqual(named('getGmailToken'), []);
    assert.deepEqual(named('markRenewed'), []);
    assert.deepEqual(named('reportTokenFailure'), []);
    assert.ok(!res.body.ran.includes('gmail-watch-renewed'));
  });

  test('a rejected renewal reports a token failure, does not mark renewal, and the morning still finishes', async t => {
    const { res, requests, named } = await morning(t, { reply: () => ({ ok: false, status: 500, json: async () => ({}) }) });
    assert.equal(res.code, 200);
    assert.equal(requests.length, 1);
    assert.deepEqual(named('markRenewed'), []);
    assert.deepEqual(named('kv.set'), []);
    const [failure] = named('reportTokenFailure');
    assert.deepEqual(failure.slice(1, 3), ['gmail_watch', 'Gmail Watch 갱신']);
    assert.equal(failure[3].message, 'Gmail watch API 500');
    assert.ok(!res.body.ran.includes('gmail-watch-renewed'));
    assert.ok(named('checkStaleness').some(a => a[1] === 'gmail_watch'));
  });

  test('a renewal reply without expiration still marks renewal and reports an unknown expiry', async t => {
    const { res, named } = await morning(t, { reply: () => ({ ok: true, json: async () => ({ historyId: '1' }) }) });
    assert.deepEqual(named('kv.set'), []);
    assert.deepEqual(named('markRenewed').map(a => a[1]), ['gmail_watch']);
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
