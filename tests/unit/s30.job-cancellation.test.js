/**
 * ACT-08 단계 ④ — 청소 일정 수동 취소의 실제 API 계약.
 * API·권한·블로커 생성은 실제 구현, DB·OAuth·발송·HTTP는 가짜 I/O.
 * ACT-08 단계 ⑥-2: 취소 외 기존 복사 테스트 24개도 실제 구현 시험으로 교체했다.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ACT-08 단계 ④: actual API; scripted rows and external adapters contain no cancellation policy.
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { actualCronModule, cronResponse, installCronIO } from '../helpers/cronHandlerFixture.js';
import { advanceJob } from '../../server/cleaning/_dispatch.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';
import { passwordFingerprint } from '../../server/auth/operatorAccounts.js';

const CANCEL_JOB = { id: '33333333-3333-4333-8333-333333333333', property_id: 'fixture-cancel-property',
  status: 'PENDING', data_origin: 'REAL', google_calendar_id: null, google_event_id: null,
  cleaning_start_at: '2026-11-20T02:00:00.000Z', checkout_hour: 11, cleaning_duration_hours: 2.5 };
const CANCEL_CALENDAR = 'fixture-calendar@group.calendar.google.com';
const CANCEL_NOTIF = { cleaner_id: '44444444-4444-4444-8444-444444444444', phone: '01000000000',
  fcm_token: 'fixture-fcm-token', fcm_status: 'active' };
const CANCEL_OPERATOR = { active: true, password_hash: 'fixture-password-hash', property_ids: [CANCEL_JOB.property_id] };
function cancellationCookie(role = 'admin') {
  return 'propos_session=' + createSessionToken(process.env, Date.now(), role === 'operator'
    ? { role, sub: 'fixture-operator', ph: passwordFingerprint(CANCEL_OPERATOR.password_hash) } : { role });
}
async function actualCancellation(t, { responses = [], google = [], expectedErrors = 0, calendar = {}, notify, ...options } = {}) {
  const pendingGoogle = [...google], unexpectedGoogle = [];
  const f = await cleaningDeclineFixture({ ...options, responses, notify: notify ?? (async () => ({ ok: true, channel: 'FCM' })),
    calendar: { ...calendar, methods: ['POST', 'DELETE'], async fetch(url, request) {
      if (!pendingGoogle.length) unexpectedGoogle.push({ url, request });
      assert.ok(pendingGoogle.length, 'unexpected fake Google call');
      const next = pendingGoogle.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(url, request) : next;
    } },
  });
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'all scripted DB results consumed');
      assert.deepEqual(f.unexpectedQueries, [], 'no hidden unexpected SQL');
      assert.equal(pendingGoogle.length, 0, 'all scripted Google responses consumed');
      assert.deepEqual(unexpectedGoogle, [], 'no hidden unexpected Google calls');
      assert.equal(f.errors.length, expectedErrors, 'only planned failures logged');
      assert.deepEqual(f.blocked, [], 'no unmocked external I/O');
      assert.deepEqual(f.advances, [], 'cancellation does not redispatch');
      assert.deepEqual(f.slackCalls, [], 'cancellation handler does not call assignment Slack');
      assert.deepEqual(f.completionCalls, [], 'cancellation does not send assignment completion');
      assert.deepEqual(f.kvCalls, [], 'OAuth boundary is fake');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  return { ...f, send({ method = 'PATCH', url = `/api/cleaning/jobs?id=${CANCEL_JOB.id}`,
    body = { status: 'CANCELLED' }, headers = {}, role = 'admin', ...request } = {}) {
    return f.invoke({ method, url, body, ...request,
      headers: { cookie: cancellationCookie(role), ...headers } });
  } };
}
function assertCancelReply(res, blocker = null) {
  assert.equal(res.code, 200); assert.equal(res.kind, 'json');
  assert.deepEqual(res.body, { ok: true, newBlockerEventId: blocker });
}
function assertCancelWrite(f, id = CANCEL_JOB.id) {
  const write = f.queries.find(q => /UPDATE cleaning_jobs SET status='CANCELLED'/.test(q.sql));
  assert.ok(write, 'actual CANCELLED update must execute');
  assert.match(write.sql, /updated_at=NOW\(\) WHERE id=\$1 RETURNING id/);
  assert.deepEqual(write.params, [id]);
  const recipients = f.queries.find(q => /SELECT n\.\*, c\.phone/.test(q.sql));
  assert.ok(recipients); assert.match(recipients.sql, /JOIN cleaners c ON c.id = n.cleaner_id/);
  assert.match(recipients.sql, /n.job_id = \$1 AND n.response IS NULL/);
  assert.deepEqual(recipients.params, [id]);
}
function assertBlockerPersistence(f, eventId = 'fixture-new-blocker') {
  const insert = f.queries.find(q => /INSERT INTO property_calendar_blockers/.test(q.sql));
  assert.ok(insert); assert.match(insert.sql, /ON CONFLICT \(property_id, block_date\) DO UPDATE SET event_id=\$3/);
  assert.deepEqual(insert.params, [CANCEL_JOB.property_id, '2026-11-20', eventId]);
  const update = f.queries.find(q => /SET google_blocker_event_id=\$1/.test(q.sql));
  assert.ok(update); assert.deepEqual(update.params, [eventId, CANCEL_JOB.id]);
}
const blockerReply = () => new Response(JSON.stringify({ id: 'fixture-new-blocker' }), { status: 200 });

async function actualAdminRoute(t, { responses = [], expectedErrors = 0, notify, ...options } = {}) {
  const f = await cleaningDeclineFixture({ ...options, responses, notify: notify ?? (async () => ({ ok: true })) });
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'all scripted DB results consumed');
      assert.deepEqual(f.unexpectedQueries, [], 'no hidden unexpected SQL');
      assert.equal(f.errors.length, expectedErrors, 'only planned failures logged');
      assert.deepEqual(f.blocked, [], 'no unmocked external I/O');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  return { ...f, send({ method = 'GET', url, body, headers = {}, ...request }) {
    return f.invoke({ method, url, body, ...request, headers: { cookie: cancellationCookie(), ...headers } });
  } };
}

async function actualFollowup(t, { dbQuery, behavior = {} } = {}) {
  const { default: handler } = await actualCronModule();
  const fixture = installCronIO({ behavior: { 'db.query': dbQuery, ...behavior } });
  t.after(() => fixture.restore());
  const res = cronResponse();
  await handler({ method: 'GET', url: '/api/cron/cleaning-followup', query: {},
    headers: { authorization: 'Bearer fixture-cron-secret' } }, res);
  return { fixture, res };
}

function followupDb({ bulkNotifs = [], bulkJobs = [], escalationRows = [] } = {}) {
  return async (sql) => {
    if (/status = 'PENDING' AND dispatch_after/.test(sql)) return { rows: [] };
    if (/SELECT DISTINCT j\.property_id, b\.block_date/.test(sql)) return { rows: [] };
    if (/FROM cleaning_notifs n[\s\S]*n\.reminded_at IS NULL/.test(sql)) return { rows: bulkNotifs };
    if (/SELECT j\.id, j\.property_id[\s\S]*JOIN LATERAL/.test(sql)) return { rows: bulkJobs };
    if (/UPDATE cleaning_jobs SET status='ESCALATED'/.test(sql)) return { rows: escalationRows };
    if (/^\s*UPDATE cleaning_(?:notifs|jobs)/.test(sql)) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected followup SQL: ${sql}`);
  };
}

describe('actual job cancellation — request and access contract', () => {
  test('login is required before querying the job', async t => {
    const f = await actualCancellation(t); const r = await f.send({ headers: { cookie: '' } });
    assert.equal(r.code, 401); assert.deepEqual(r.body, { error: '로그인이 필요해요', code: 'AUTH_REQUIRED' });
    assert.deepEqual(f.queries, []); assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []);
  });
  for (const method of ['POST', 'PUT', 'DELETE']) test(`${method} with job ID cannot cancel`, async t => {
    const f = await actualCancellation(t); const r = await f.send({ method });
    assert.equal(r.code, 404); assert.deepEqual(r.body, { error: 'Not found' });
    assert.deepEqual(f.queries, []); assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []);
  });
  for (const request of [{ url: '/api/cleaning/jobs' }, { body: {} }, { rawBody: '{bad json' }]) {
    test(`missing cancellation route/body does not write (${JSON.stringify(request)})`, async t => {
      const f = await actualCancellation(t); const r = await f.send(request);
      assert.equal(r.code, 404); assert.deepEqual(f.queries, []);
    });
  }
  test('DEMO blocks cancellation before login/DB/delivery/Google', async t => {
    const f = await actualCancellation(t, { profile: 'demo' }); const r = await f.send();
    assert.equal(r.code, 403); assert.deepEqual(r.body, { error: 'demo profile is read-only', dataProfile: 'demo' });
    assert.deepEqual(f.queries, []); assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []);
  });
  test('missing job returns 404 without update or external work', async t => {
    const f = await actualCancellation(t, { responses: [[]] }); const r = await f.send();
    assert.equal(r.code, 404); assert.deepEqual(r.body, { error: '일정 없음' });
    assert.deepEqual(f.queries[0].params, [CANCEL_JOB.id]);
    assert.match(f.queries[0].sql, /LEFT JOIN property_cleaning_config p ON p.property_id = j.property_id/);
  });
  test('SIMULATED job is rejected without external cancellation', async t => {
    const f = await actualCancellation(t, { responses: [[{ ...CANCEL_JOB, data_origin: 'SIMULATED', google_calendar_id: CANCEL_CALENDAR }]] });
    const r = await f.send(); assert.equal(r.code, 409);
    assert.deepEqual(r.body, { error: '시뮬레이션 일정은 외부 취소 처리를 하지 않습니다.', data_origin: 'SIMULATED' });
    assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []);
  });
  for (const [url, id] of [
    [`/api/cleaning/jobs/${CANCEL_JOB.id}`, CANCEL_JOB.id],
    [`/api/cleaning/jobs/55555555-5555-4555-8555-555555555555?id=${CANCEL_JOB.id}`, CANCEL_JOB.id],
  ]) test(`UUID path fallback and query precedence: ${url}`, async t => {
    const f = await actualCancellation(t, { responses: [[CANCEL_JOB], [{ id }], []] });
    assertCancelReply(await f.send({ url })); assertCancelWrite(f, id);
  });
  test('operator can cancel an assigned property', async t => {
    const f = await actualCancellation(t, { responses: [[CANCEL_OPERATOR], [CANCEL_JOB], [{ id: CANCEL_JOB.id }], []] });
    assertCancelReply(await f.send({ role: 'operator' })); assertCancelWrite(f);
    assert.deepEqual(f.queries[0].params, ['fixture-operator']);
    assert.match(f.queries[0].sql, /FROM operators o LEFT JOIN operator_properties/);
  });
  for (const property_ids of [[], ['fixture-other-property']]) test(`operator cannot cancel an out-of-scope property (${property_ids})`, async t => {
    const f = await actualCancellation(t, { responses: [[{ ...CANCEL_OPERATOR, property_ids }], [CANCEL_JOB]] });
    const r = await f.send({ role: 'operator' }); assert.equal(r.code, 404); assert.deepEqual(r.body, { error: '일정 없음' });
    assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []);
  });
  test('inactive operator is rejected before job lookup', async t => {
    const f = await actualCancellation(t, { responses: [[{ ...CANCEL_OPERATOR, active: false }]] });
    const r = await f.send({ role: 'operator' }); assert.equal(r.code, 401); assert.equal(r.body.code, 'AUTH_REQUIRED');
    assert.equal(f.queries.length, 1);
  });
});

describe('actual job cancellation — state and retry results', () => {
  for (const status of ['PENDING', 'NOTIFYING_VIP_1', 'NOTIFYING_VIP_2', 'NOTIFYING_VIP_3',
    'NOTIFYING_BULK', 'BULK_REMINDED', 'ESCALATED', 'ASSIGNED']) {
    test(`${status} persists CANCELLED, queries unanswered recipients, and returns success`, async t => {
      const f = await actualCancellation(t, { responses: [[{ ...CANCEL_JOB, status }], [{ id: CANCEL_JOB.id }], []] });
      assertCancelReply(await f.send()); assertCancelWrite(f);
      assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []); assert.deepEqual(f.calendarRequests, []);
    });
  }
  for (const status of ['COMPLETED', 'CANCELLED']) test(`${status} returns 409 without writes or external work`, async t => {
    const f = await actualCancellation(t, { responses: [[{ ...CANCEL_JOB, status }]] }); const r = await f.send();
    assert.equal(r.code, 409); assert.deepEqual(r.body, { error: `이미 ${status} 상태` });
    assert.equal(f.queries.length, 1); assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []);
  });
  test('zero-row UPDATE returns 409 before notifications and Google', async t => {
    const f = await actualCancellation(t, { responses: [[CANCEL_JOB], []] }); const r = await f.send();
    assert.equal(r.code, 409); assert.deepEqual(r.body, { error: '업데이트 실패' });
    assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []);
  });
  test('a sequential retry sees CANCELLED and does not notify or update again', async t => {
    const f = await actualCancellation(t, { responses: [[CANCEL_JOB], [{ id: CANCEL_JOB.id }], [], [{ ...CANCEL_JOB, status: 'CANCELLED' }]] });
    assertCancelReply(await f.send()); assert.equal((await f.send()).code, 409);
    assert.equal(f.queries.filter(q => /UPDATE cleaning_jobs/.test(q.sql)).length, 1);
    assertCancelWrite(f); assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []);
  });
});

describe('actual job cancellation — delivery boundary', () => {
  for (const config of [{ name: 'Fixture Property' }, null]) test(`notifies each unanswered recipient with ${config ? 'configured name' : 'property ID fallback'}`, async t => {
    const other = { ...CANCEL_NOTIF, cleaner_id: 'fixture-other-cleaner', fcm_token: null, fcm_status: 'uninstalled' };
    const f = await actualCancellation(t, { responses: [[CANCEL_JOB], [{ id: CANCEL_JOB.id }], [CANCEL_NOTIF, other], config ? [config] : []] });
    assertCancelReply(await f.send()); assertCancelWrite(f);
    assert.deepEqual(f.queries[3].params, [CANCEL_JOB.property_id]);
    assert.match(f.queries[3].sql, /FROM property_cleaning_config WHERE property_id\s*=\s*\$1/);
    const name = config?.name ?? CANCEL_JOB.property_id;
    assert.deepEqual(f.notifyCalls, [CANCEL_NOTIF, other].map(n => [f.db, {
      id: n.cleaner_id, phone: n.phone, fcm_token: n.fcm_token, fcm_status: n.fcm_status,
    }, {
      title: '[PROPOS] 청소 일정 취소', body: `${name} 2026-11-20 청소가 취소됐습니다`, data: {},
      smsText: `[PROPOS] ${name} 2026-11-20 청소 일정이 취소됐습니다.`,
    }]));
    assert.deepEqual(f.tokenCalls, []);
  });
  test('one notification rejection is logged and the next recipient is still attempted', async t => {
    const other = { ...CANCEL_NOTIF, cleaner_id: 'fixture-other-cleaner' };
    const f = await actualCancellation(t, { responses: [[CANCEL_JOB], [{ id: CANCEL_JOB.id }], [CANCEL_NOTIF, other], [{ name: 'Fixture Property' }]],
      expectedErrors: 1, notify: async (_db, recipient) => { if (recipient.id === CANCEL_NOTIF.cleaner_id) throw new Error('fixture notification unavailable'); } });
    assertCancelReply(await f.send()); assert.equal(f.notifyCalls.length, 2);
    assert.match(f.errors[0][0], /취소 알림 실패/); assert.equal(f.errors[0][1], 'fixture notification unavailable');
  });
});

describe('actual job cancellation — real blocker creation with fake Google', () => {
  test('ASSIGNED deletes the original event, creates a blocking event, and persists both links', async t => {
    const job = { ...CANCEL_JOB, status: 'ASSIGNED', google_calendar_id: CANCEL_CALENDAR, google_event_id: 'fixture-assigned-event' };
    const f = await actualCancellation(t, { responses: [[job], [{ id: job.id }], [], [], []],
      google: [new Response(null, { status: 204 }), blockerReply()] });
    assertCancelReply(await f.send(), 'fixture-new-blocker'); assertCancelWrite(f); assertBlockerPersistence(f);
    assert.deepEqual(f.tokenCalls, [[f.kv], [f.kv]]);
    assert.deepEqual(f.calendarRequests.map(r => r.options.method), ['DELETE', 'POST']);
    assert.equal(f.calendarRequests[0].url, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CANCEL_CALENDAR)}/events/fixture-assigned-event`);
    assert.deepEqual(f.calendarRequests[0].options.headers, { Authorization: 'Bearer fixture-google-token' });
    const create = f.calendarRequests[1];
    assert.equal(create.url, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CANCEL_CALENDAR)}/events`);
    assert.equal(create.options.headers.Authorization, 'Bearer fixture-google-token');
    assert.equal(create.options.headers['Content-Type'], 'application/json');
    const event = JSON.parse(create.options.body);
    assert.equal(event.summary, '청소 예약 차단');
    assert.deepEqual(event.start, { dateTime: '2026-11-20T11:00:00+09:00' });
    assert.deepEqual(event.end, { dateTime: '2026-11-20T13:30:00+09:00' });
    assert.equal(event.transparency, 'opaque'); assert.equal(event.visibility, 'private');
    assert.deepEqual(event.extendedProperties.private, { propos: 'blocker', property_id: job.property_id });
    assert.ok(event.extendedProperties.shared['goo.createdByAvailId']);
    assert.equal(event.extendedProperties.shared['goo.createdBySet'], 'default_cita');
  });
  for (const job of [
    { ...CANCEL_JOB, google_calendar_id: CANCEL_CALENDAR, google_event_id: 'fixture-old-event' },
    { ...CANCEL_JOB, status: 'ASSIGNED', google_calendar_id: CANCEL_CALENDAR },
  ]) test(`does not DELETE without both assigned state and event ID (${job.status}/${job.google_event_id})`, async t => {
    const f = await actualCancellation(t, { responses: [[job], [{ id: job.id }], [], [], []], google: [blockerReply()] });
    assertCancelReply(await f.send(), 'fixture-new-blocker'); assertBlockerPersistence(f);
    assert.deepEqual(f.calendarRequests.map(r => r.options.method), ['POST']); assert.equal(f.tokenCalls.length, 1);
  });
  test('UPDATE is accepted before delivery and Google operations', async t => {
    const order = [];
    const f = await actualCancellation(t, { responses: [[{ ...CANCEL_JOB, google_calendar_id: CANCEL_CALENDAR }],
      () => { order.push('cancel-update'); return { rows: [{ id: CANCEL_JOB.id }] }; }, [CANCEL_NOTIF], [{ name: 'Fixture Property' }], [], []],
      notify: async () => { order.push('notification'); }, google: [() => { order.push('google-create'); return blockerReply(); }] });
    assertCancelReply(await f.send(), 'fixture-new-blocker');
    assert.deepEqual(order, ['cancel-update', 'notification', 'google-create']); assertBlockerPersistence(f);
  });
  test('DELETE transport failure is logged but blocker recreation still runs', async t => {
    const f = await actualCancellation(t, { responses: [[{ ...CANCEL_JOB, status: 'ASSIGNED', google_calendar_id: CANCEL_CALENDAR, google_event_id: 'fixture-event' }],
      [{ id: CANCEL_JOB.id }], [], [], []], google: [new Error('fixture DELETE unavailable'), blockerReply()], expectedErrors: 1 });
    assertCancelReply(await f.send(), 'fixture-new-blocker'); assertBlockerPersistence(f);
    assert.match(f.errors[0][0], /캘린더 이벤트 삭제 실패/);
    assert.equal(f.errors[0][1], 'fixture DELETE unavailable');
  });
  test('known limitation: DELETE HTTP failure is currently ignored (no rollback or error receipt)', async t => {
    const f = await actualCancellation(t, { responses: [[{ ...CANCEL_JOB, status: 'ASSIGNED', google_calendar_id: CANCEL_CALENDAR, google_event_id: 'fixture-event' }],
      [{ id: CANCEL_JOB.id }], [], [], []], google: [new Response('fixture denied', { status: 403 }), blockerReply()] });
    assertCancelReply(await f.send(), 'fixture-new-blocker'); assertBlockerPersistence(f);
    assert.deepEqual(f.calendarRequests.map(r => r.options.method), ['DELETE', 'POST']);
    assert.deepEqual(f.errors, [], 'current code never checks DELETE response.ok; not evidence of a successful deletion');
  });
  test('blocker OAuth failure preserves current success/null response without Google or link writes', async t => {
    const f = await actualCancellation(t, { responses: [[{ ...CANCEL_JOB, google_calendar_id: CANCEL_CALENDAR }], [{ id: CANCEL_JOB.id }], []],
      expectedErrors: 1, calendar: { getToken: async () => { throw new Error('fixture OAuth unavailable'); } } });
    assertCancelReply(await f.send()); assertCancelWrite(f); assert.deepEqual(f.calendarRequests, []);
    assert.match(f.errors[0][0], /블로커 재생성 실패/);
  });
  for (const response of [new Error('fixture POST unavailable'), new Response('fixture rejected', { status: 403 })]) {
    test(`blocker creation failure preserves current success/null response (${response instanceof Error ? 'transport' : 'HTTP 403'})`, async t => {
      const f = await actualCancellation(t, { responses: [[{ ...CANCEL_JOB, google_calendar_id: CANCEL_CALENDAR }], [{ id: CANCEL_JOB.id }], []],
        google: [response], expectedErrors: 1 });
      assertCancelReply(await f.send()); assertCancelWrite(f); assert.match(f.errors[0][0], /블로커 재생성 실패/);
      assert.equal(f.queries.length, 3);
    });
  }
  for (const failedWrite of ['blocker-insert', 'job-link']) test(`current partial failure at ${failedWrite} is logged without pretending rollback`, async t => {
    const responses = [[{ ...CANCEL_JOB, google_calendar_id: CANCEL_CALENDAR }], [{ id: CANCEL_JOB.id }], [],
      ...(failedWrite === 'job-link' ? [[]] : []), new Error(`fixture ${failedWrite} unavailable`)];
    const f = await actualCancellation(t, { responses, google: [blockerReply()], expectedErrors: 1 });
    assertCancelReply(await f.send()); assertCancelWrite(f); assert.match(f.errors[0][0], /블로커 재생성 실패/);
    assert.equal(f.calendarRequests.length, 1);
    assert.equal(f.queries.filter(q => /SET google_blocker_event_id/.test(q.sql)).length, failedWrite === 'job-link' ? 1 : 0);
  });
});

describe('actual job cancellation — DB failures stop subsequent work', () => {
  for (const stage of ['job-read', 'cancel-update', 'recipient-read']) test(`500 at ${stage} preserves current API error`, async t => {
    const responses = stage === 'job-read' ? [] : [[CANCEL_JOB]];
    if (stage === 'recipient-read') responses.push([{ id: CANCEL_JOB.id }]);
    responses.push(new Error(`fixture ${stage} unavailable`));
    const f = await actualCancellation(t, { responses, expectedErrors: 1 }); const r = await f.send();
    assert.equal(r.code, 500); assert.deepEqual(r.body, { error: `fixture ${stage} unavailable` });
    assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []); assert.deepEqual(f.calendarRequests, []);
  });
  test('property config lookup failure returns 500 after cancellation was already accepted', async t => {
    const f = await actualCancellation(t, { responses: [[CANCEL_JOB], [{ id: CANCEL_JOB.id }], [CANCEL_NOTIF],
      new Error('fixture property lookup unavailable')], expectedErrors: 1 });
    const r = await f.send();
    assert.equal(r.code, 500); assert.deepEqual(r.body, { error: 'fixture property lookup unavailable' });
    assertCancelWrite(f); assert.deepEqual(f.notifyCalls, []); assert.deepEqual(f.tokenCalls, []);
  });
});

describe('actual dispatch — cancelled state boundary', () => {
  test('advanceJob returns without DB or delivery work for CANCELLED', async () => {
    const calls = [];
    const db = { query: async (...args) => { calls.push(args); throw new Error('must not query'); } };
    assert.equal(await advanceJob(db, { id: 'fixture-cancelled', status: 'CANCELLED', data_origin: 'REAL' }), undefined);
    assert.deepEqual(calls, []);
  });
});

describe('actual bootstrap handler — target month dates', () => {
  const property = { property_id: 'fixture-bootstrap', google_calendar_id: 'fixture-calendar',
    checkout_hour: 11, cleaning_duration_hours: 2.5, data_origin: 'REAL' };
  for (const [month, count, last] of [
    ['2026-09', 30, '2026-09-30'], ['2026-02', 28, '2026-02-28'],
    ['2024-02', 29, '2024-02-29'], ['2026-12', 31, '2026-12-31'],
  ]) test(`${month} passes its complete date set to the actual blocker policy`, async t => {
    const dates = Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
    const f = await actualAdminRoute(t, { responses: [[property], dates.map(day => ({ day }))], calendar: {} });
    const res = await f.send({ method: 'POST', url: '/api/cleaning/bootstrap',
      body: { property_id: property.property_id, month } });
    assert.equal(res.code, 200); assert.deepEqual(res.body, { ok: true, created: 0, skipped: count });
    assert.deepEqual(f.queries[1].params, [property.property_id, dates]);
    assert.equal(f.queries[1].params[1].at(-1), last);
    assert.deepEqual(f.calendarRequests, []);
  });

  test('an invalid month currently falls back to the current KST month', async t => {
    const realNow = Date.now;
    Date.now = () => Date.parse('2026-11-18T03:00:00.000Z');
    t.after(() => { Date.now = realNow; });
    const dates = Array.from({ length: 30 }, (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`);
    const f = await actualAdminRoute(t, { responses: [[property], dates.map(day => ({ day }))], calendar: {} });
    const res = await f.send({ method: 'POST', url: '/api/cleaning/bootstrap',
      body: { property_id: property.property_id, month: '2026-9' } });
    assert.equal(res.code, 200); assert.deepEqual(f.queries[1].params[1], dates);
  });
});

describe('actual Gmail Watch handler', () => {
  test('returns the current 500 response before OAuth when GOOGLE_PUBSUB_TOPIC is absent', async t => {
    const f = await actualAdminRoute(t, { environment: { GOOGLE_PUBSUB_TOPIC: '' } });
    const res = await f.send({ method: 'POST', url: '/api/cleaning/gmail-watch', body: {} });
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, { error: 'GOOGLE_PUBSUB_TOPIC 환경변수 없음' });
    assert.deepEqual(f.tokenCalls, []); assert.deepEqual(f.calendarRequests, []);
  });

  test('posts the real Watch payload and stores a seven-day expiration with one-hour TTL margin', async t => {
    const realNow = Date.now;
    const now = Date.parse('2026-11-18T03:00:00.000Z');
    Date.now = () => now;
    t.after(() => { Date.now = realNow; });
    const expiration = String(now + 7 * 24 * 60 * 60 * 1000);
    const topicName = 'projects/fixture/topics/gmail-watch';
    const f = await actualAdminRoute(t, { environment: { GOOGLE_PUBSUB_TOPIC: topicName },
      calendar: { methods: ['POST'], kv: { get: async () => null, set: async () => 'OK' },
        fetch: async () => new Response(JSON.stringify({ historyId: 'fixture-history', expiration }), { status: 200 }) } });
    const res = await f.send({ method: 'POST', url: '/api/cleaning/gmail-watch', body: {} });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { ok: true, historyId: 'fixture-history', expiration });
    assert.equal(f.calendarRequests.length, 1);
    assert.equal(f.calendarRequests[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/watch');
    assert.deepEqual(JSON.parse(f.calendarRequests[0].options.body), {
      topicName, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE',
    });
    assert.deepEqual(f.kvCalls.map(call => call.args), [
      ['gmail_watch_expiration', expiration, { ex: 7 * 24 * 60 * 60 + 3600 }],
      ['token_health:gmail_watch:last_renewed_at', now, { ex: 60 * 24 * 60 * 60 }],
      ['token_health:gmail_watch:failing_since'],
    ]);
  });

  test('a successful manual registration clears the previous Gmail Watch failure state', async t => {
    const deleted = [];
    const f = await actualAdminRoute(t, { environment: { GOOGLE_PUBSUB_TOPIC: 'projects/fixture/topics/gmail-watch' },
      calendar: { methods: ['POST'], kv: {
        get: async key => key === 'token_health:gmail_watch:failing_since' ? Date.now() - 60_000 : null,
        set: async () => 'OK',
        del: async key => { deleted.push(key); return 1; },
      }, fetch: async () => new Response(JSON.stringify({ historyId: 'fixture-history' }), { status: 200 }) } });
    const res = await f.send({ method: 'POST', url: '/api/cleaning/gmail-watch', body: {} });
    assert.equal(res.code, 200);
    assert.deepEqual(deleted, [
      'token_health:gmail_watch:failing_since',
      'token_health:gmail_watch:last_alert_at',
    ]);
  });
});

describe('actual property handler — iCal persistence contract', () => {
  const propertyId = 'fixture-property';
  const name = 'Fixture Property';
  const icalUrl = 'https://www.airbnb.com/calendar/ical/fixture.ics';

  async function saveProperty(t, body) {
    const saved = { property_id: propertyId, name, ...body };
    const f = await actualAdminRoute(t, { responses: [[], [], [saved]] });
    const res = await f.send({ method: 'POST', url: '/api/cleaning/properties',
      body: { property_id: propertyId, name, ...body } });
    return { f, res };
  }

  test('passes ical_url to the actual upsert parameter', async t => {
    const { f, res } = await saveProperty(t, { ical_url: icalUrl });
    assert.equal(res.code, 200); assert.equal(f.queries[2].params[7], icalUrl);
  });

  test('omitted ical_url is null and the actual conflict clause preserves the stored value', async t => {
    const { f } = await saveProperty(t, {});
    assert.equal(f.queries[2].params[7], null);
    assert.match(f.queries[2].sql, /ical_url=COALESCE\(\$8,property_cleaning_config\.ical_url\)/);
  });

  test('rejects a missing name before querying the database', async t => {
    const f = await actualAdminRoute(t);
    const res = await f.send({ method: 'POST', url: '/api/cleaning/properties', body: { property_id: propertyId } });
    assert.equal(res.code, 400); assert.deepEqual(res.body, { error: 'property_id, name 필수' });
    assert.deepEqual(f.queries, []);
  });

  test('omitted hours are passed as null instead of copied test defaults', async t => {
    const { f } = await saveProperty(t, {});
    assert.equal(f.queries[2].params[2], null);
    assert.equal(f.queries[2].params[3], null);
  });

  test('admin property listing returns the actual stored ical_url field', async t => {
    const row = { property_id: propertyId, name, ical_url: icalUrl, google_calendar_id: 'fixture-calendar' };
    const f = await actualAdminRoute(t, { responses: [[row]] });
    const res = await f.send({ url: '/api/cleaning/properties' });
    assert.equal(res.code, 200); assert.deepEqual(res.body, [row]);
    assert.match(f.queries[0].sql, /SELECT p\.\*/);
  });
});

describe('actual cleaning-followup handler — reminder and escalation', () => {
  test('uses strict one-hour reminder eligibility and excludes answered or already-reminded rows', async t => {
    const { fixture, res } = await actualFollowup(t, { dbQuery: followupDb() });
    assert.deepEqual(res.body, { ok: true, advanced: 0, reminded: 0, escalated: 0 });
    const sql = fixture.calls.find(call => call.name === 'db.query'
      && /FROM cleaning_notifs n/.test(call.args[0]))?.args[0];
    assert.match(sql, /n\.reminded_at IS NULL/);
    assert.match(sql, /n\.response IS NULL/);
    assert.match(sql, /n\.sent_at < NOW\(\) - INTERVAL '1 hour'/);
  });

  test('sends an eligible reminder and persists both reminder and job state', async t => {
    const notif = { id: 'fixture-notif', job_id: 'fixture-job', cleaner_id: 'fixture-cleaner',
      property_id: 'fixture-property', cleaning_start_at: '2026-11-20T02:00:00.000Z',
      job_checkout_at: '2026-11-20T02:00:00.000Z', job_reservation_uid: 'fixture-reservation',
      token: 'fixture-token', phone: '01000000000', fcm_token: null, fcm_status: 'uninstalled' };
    const { fixture, res } = await actualFollowup(t, { dbQuery: followupDb({ bulkNotifs: [notif] }) });
    assert.deepEqual(res.body, { ok: true, advanced: 0, reminded: 1, escalated: 0 });
    const notify = fixture.calls.find(call => call.name === 'notify');
    assert.deepEqual(notify.args[2], {
      title: '[PROPOS] 청소 재안내', body: 'fixture-property 청소 일정 아직 미확정입니다',
      data: {
        jobId: 'fixture-job', token: 'fixture-token',
        calendarUrl: 'http://localhost:5173/c/fixture-property', hostPhone: '',
      },
      smsText: 'fixture reminder',
      notifId: 'fixture-notif',
    });
    const sql = fixture.calls.filter(call => call.name === 'db.query').map(call => call.args[0]);
    assert.ok(sql.some(text => /UPDATE cleaning_notifs SET reminded_at=NOW\(\)/.test(text)));
    assert.ok(sql.some(text => /SET status='BULK_REMINDED'/.test(text)));
  });

  test('escalates only the actual three-hour BULK candidates and sends the production Slack text', async t => {
    const job = { id: 'fixture-job', property_id: 'fixture-property',
      cleaning_start_at: '2026-11-20T02:00:00.000Z', checkout_at: '2026-11-20T02:00:00.000Z',
      reservation_uid: 'fixture-reservation' };
    const { fixture, res } = await actualFollowup(t, {
      dbQuery: followupDb({ bulkJobs: [job], escalationRows: [{ id: job.id }] }),
    });
    assert.deepEqual(res.body, { ok: true, advanced: 0, reminded: 0, escalated: 1 });
    const sql = fixture.calls.filter(call => call.name === 'db.query').map(call => call.args[0]);
    assert.ok(sql.some(text => /status IN \('NOTIFYING_BULK','BULK_REMINDED'\)[\s\S]*first_sent < NOW\(\) - INTERVAL '3 hours'/.test(text)));
    assert.ok(sql.some(text => /WHERE id=\$1 AND status IN \('NOTIFYING_BULK','BULK_REMINDED'\)[\s\S]*RETURNING id/.test(text)));
    const slack = fixture.calls.find(call => call.name === 'postSlack');
    assert.deepEqual(slack.args, ['[PROPOS] 🚨 fixture-property 2026-11-20 청소 배정 실패. 수동 처리 필요.']);
  });

  test('does not announce escalation when the conditional update loses a race', async t => {
    const job = { id: 'fixture-job', property_id: 'fixture-property',
      cleaning_start_at: '2026-11-20T02:00:00.000Z', checkout_at: '2026-11-20T02:00:00.000Z' };
    const { fixture, res } = await actualFollowup(t, { dbQuery: followupDb({ bulkJobs: [job] }) });
    assert.equal(res.body.escalated, 0);
    assert.ok(!fixture.names().includes('postSlack'));
  });

  test('skips escalation when the reservation cancellation guard fires', async t => {
    const job = { id: 'fixture-job', property_id: 'fixture-property',
      cleaning_start_at: '2026-11-20T02:00:00.000Z', checkout_at: '2026-11-20T02:00:00.000Z' };
    const { fixture, res } = await actualFollowup(t, { dbQuery: followupDb({ bulkJobs: [job] }),
      behavior: { isCheckoutCancelled: async () => true } });
    assert.equal(res.body.escalated, 0);
    assert.ok(!fixture.names().includes('postSlack'));
    assert.equal(fixture.calls.filter(call => call.name === 'db.query'
      && /UPDATE cleaning_jobs SET status='ESCALATED'/.test(call.args[0])).length, 0);
  });
});
