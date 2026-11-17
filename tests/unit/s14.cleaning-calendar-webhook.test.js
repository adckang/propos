/**
 * ACT-08 단계 ③ — 실제 Calendar Webhook API 계약.
 * 라우터·조회·매칭·공용 배정은 실제 코드, DB·OAuth·발송은 가짜 I/O다.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// ACT-08 단계 ③: 전체 API·공용 배정·담당자 매칭을 실제 코드로 실행한다.
import { readFileSync } from 'node:fs';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';

const CALENDAR_ID = 'prop001@group.calendar.google.com';
const GOOGLE_HEADERS = { 'x-goog-channel-token': 'fixture-webhook-secret', 'x-goog-resource-state': 'exists',
  'x-goog-channel-id': 'cleaning-prop001-1234567890',
  'x-goog-resource-uri': 'https://www.googleapis.com/calendar/v3/calendars/prop001%40group.calendar.google.com/events' };
const CAL_PROPERTY = { property_id: 'fixture-calendar-property', name: 'Fixture Property', google_calendar_id: CALENDAR_ID, data_origin: 'REAL' };
const CAL_CLEANER = { id: '11111111-1111-4111-8111-111111111111', email: 'worker@example.invalid', name: 'Fixture Worker' };
const CAL_JOB = { id: '22222222-2222-4222-8222-222222222222', property_id: CAL_PROPERTY.property_id,
  status: 'PENDING', data_origin: 'REAL', checkout_at: '2026-11-20T02:00:00.000Z',
  cleaning_start_at: '2026-11-20T02:00:00.000Z', cleaning_end_at: '2026-11-20T05:00:00.000Z',
  assigned_cleaner_id: null, google_event_id: null, reservation_uid: 'fixture-reservation' };
const CAL_EVENT = { id: 'fixture-calendar-event', status: 'confirmed', organizer: { email: 'host@example.invalid' },
  attendees: [{ email: 'host@example.invalid' }, { email: '  WORKER@Example.INVALID  ' }],
  start: { dateTime: '2026-11-20T12:00:00+09:00' }, end: { dateTime: '2026-11-20T15:00:00+09:00' } };
const googlePage = body => new Response(JSON.stringify(body), { status: 200 });
// These are scripted DB results, not an in-test implementation of SQL/assignment.
const assignmentRows = (job = CAL_JOB) => [[CAL_PROPERTY], [CAL_CLEANER], [job], [{ id: job.id }], [{ gone: false }]];

async function actualWebhook(t, { responses = [], pages = [], expectedErrors = 0, calendar = {}, ...options } = {}) {
  const pendingPages = [...pages];
  const unexpectedPageRequests = [];
  const f = await cleaningDeclineFixture({ ...options, responses, calendar: { ...calendar,
    async fetch(url, request) {
      if (!pendingPages.length) unexpectedPageRequests.push(String(url));
      assert.ok(pendingPages.length, 'Unexpected fake Google request');
      const next = pendingPages.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(url, request) : next;
    },
  } });
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'all planned DB results must be consumed');
      assert.deepEqual(f.unexpectedQueries, [], 'no unexpected DB calls hidden by an error handler');
      assert.deepEqual(unexpectedPageRequests, [], 'no unexpected Google calls hidden by an error handler');
      assert.equal(pendingPages.length, 0, 'all planned Google pages must be consumed');
      assert.equal(f.errors.length, expectedErrors, 'no unexpected or swallowed errors');
      assert.deepEqual(f.blocked, [], 'no real external I/O');
      assert.deepEqual(f.advances, [], 'webhook never runs decline dispatch');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  return { ...f, send({ method = 'POST', headers = {}, ...request } = {}) {
    return f.invoke({ method, url: '/api/cleaning/calendar-webhook', ...request, headers: { ...GOOGLE_HEADERS, ...headers } });
  } };
}
function assertWebhookEmpty(res, code = 200) {
  assert.equal(res.code, code); assert.equal(res.kind, 'empty'); assert.equal(res.body, undefined);
}
function assertCalendarAssignment(f, priorStatus) {
  const update = f.queries.find(q => /UPDATE cleaning_jobs SET status='ASSIGNED'/.test(q.sql));
  assert.ok(update, 'actual assignment UPDATE must run');
  assert.deepEqual(update.params, [CAL_CLEANER.id, CAL_EVENT.id, CAL_JOB.id, '2026-11-20T03:00:00.000Z', '2026-11-20T06:00:00.000Z', priorStatus]);
  assert.match(update.sql, /data_origin='REAL' AND status=\$6/);
  assert.match(update.sql, /checkout_at <= \$4::timestamptz/);
  assert.match(update.sql, /IS DISTINCT FROM/);
  assert.doesNotMatch(update.sql, /\b(?:checkout_at|google_blocker_event_id)\s*=/);
}

describe('actual calendar webhook — request envelope', () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) test(`${method} is rejected before token/DB/Google`, async t => {
    const f = await actualWebhook(t);
    assertWebhookEmpty(await f.send({ method }), 405);
    assert.deepEqual(f.tokenCalls, []); assert.deepEqual(f.queries, []); assert.deepEqual(f.calendarRequests, []);
  });
  for (const value of [undefined, 'wrong-fixture-secret']) test(`wrong/missing configured channel token is acknowledged without processing (${String(value)})`, async t => {
    const f = await actualWebhook(t);
    assertWebhookEmpty(await f.send({ headers: { 'x-goog-channel-token': value } }));
    assert.deepEqual(f.tokenCalls, []); assert.deepEqual(f.queries, []);
  });
  test('sync registration ping is acknowledged without token/DB calls', async t => {
    const f = await actualWebhook(t);
    assertWebhookEmpty(await f.send({ headers: { 'x-goog-resource-state': 'sync' } }));
    assert.deepEqual(f.tokenCalls, []); assert.deepEqual(f.queries, []);
  });
  for (const state of ['exists', 'not_exists', '', undefined]) test(`current resource state ${String(state)} reaches the property lookup`, async t => {
    const f = await actualWebhook(t, { responses: [[]] });
    assertWebhookEmpty(await f.send({ headers: { 'x-goog-resource-state': state } }));
    assert.equal(f.tokenCalls.length, 1); assert.equal(f.queries.length, 1);
  });
  for (const uri of [undefined, '', 'https://example.invalid/', 'https://www.googleapis.com/calendar/v3/calendars/']) test(`missing calendar ID returns 400 (${String(uri)})`, async t => {
    const f = await actualWebhook(t);
    const r = await f.send({ headers: { 'x-goog-resource-uri': uri } });
    assert.equal(r.code, 400); assert.deepEqual(r.body, { error: 'calendarId 없음' });
    assert.deepEqual(f.tokenCalls, []); assert.deepEqual(f.queries, []);
  });
  for (const [encoded, expected] of [
    ['abc123%40group.calendar.google.com', 'abc123@group.calendar.google.com'],
    ['prop001%40group.calendar.google.com', CALENDAR_ID],
    ['xyz.abc-123%40group.calendar.google.com', 'xyz.abc-123@group.calendar.google.com'],
  ]) test(`resource URI determines calendar ${encoded}, not the channel ID`, async t => {
    const f = await actualWebhook(t, { responses: [[]] });
    assertWebhookEmpty(await f.send({ headers: { 'x-goog-resource-uri': `https://www.googleapis.com/calendar/v3/calendars/${encoded}/events?x=1` } }));
    assert.match(f.queries[0].sql, /WHERE google_calendar_id=\$1 AND data_origin='REAL'/);
    assert.deepEqual(f.queries[0].params, [expected]);
  });
  test('current unset-secret behavior remains unchanged', async t => {
    const f = await actualWebhook(t, { responses: [[]], calendar: { secret: '' } });
    assertWebhookEmpty(await f.send({ headers: { 'x-goog-channel-token': undefined } }));
    assert.equal(f.tokenCalls.length, 1); assert.equal(f.queries.length, 1);
  });
  test('OAuth adapter failure stops before DB and Google event lookup', async t => {
    const f = await actualWebhook(t, { expectedErrors: 1, calendar: { getToken: async () => { throw new Error('fixture token unavailable'); } } });
    assertWebhookEmpty(await f.send(), 500);
    assert.equal(f.tokenCalls.length, 1); assert.deepEqual(f.queries, []); assert.deepEqual(f.calendarRequests, []);
  });
  test('DEMO refuses the webhook before every I/O boundary', async t => {
    const f = await actualWebhook(t, { profile: 'demo' });
    const r = await f.send();
    assert.equal(r.code, 403); assert.deepEqual(r.body, { error: 'demo profile is read-only', dataProfile: 'demo' });
    assert.deepEqual(f.tokenCalls, []); assert.deepEqual(f.queries, []);
  });
  test('Vercel webhook rewrite reaches the real public handler with no login', async t => {
    const rules = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')).rewrites;
    const rule = rules.find(r => r.source === '/api/calendar/webhook'); assert.ok(rule);
    const f = await actualWebhook(t, { responses: [[]] });
    assertWebhookEmpty(await f.send({ url: rule.destination }));
    assert.equal(f.queries.length, 1); assert.deepEqual(f.queries[0].params, [CALENDAR_ID]);
  });
});

describe('actual calendar webhook — complete Google event lookup', () => {
  test('list request uses the real 30-minute cutoff, paging options and fake access token', async t => {
    t.mock.method(Date, 'now', () => Date.parse('2026-11-17T08:00:00Z'));
    const f = await actualWebhook(t, { responses: [[CAL_PROPERTY]], pages: [googlePage({ items: [] })] });
    assertWebhookEmpty(await f.send());
    assert.equal(f.tokenCalls.length, 1); assert.equal(f.tokenCalls[0][0], f.kv);
    assert.equal(f.calendarRequests.length, 1);
    const request = f.calendarRequests[0], u = new URL(request.url);
    assert.equal(u.origin, 'https://www.googleapis.com');
    assert.equal(u.pathname, '/calendar/v3/calendars/prop001%40group.calendar.google.com/events');
    assert.deepEqual(Object.fromEntries(u.searchParams), { singleEvents: 'true', showDeleted: 'false', maxResults: '250', updatedMin: '2026-11-17T07:30:00.000Z', orderBy: 'updated' });
    assert.deepEqual(request.options.headers, { Authorization: 'Bearer fixture-google-token' });
    assert.equal(f.queries.length, 1);
  });
  test('later pages are loaded before any assignment is processed', async t => {
    let f;
    f = await actualWebhook(t, { responses: assignmentRows(), pages: [
      () => { assert.equal(f.queries.length, 1); return googlePage({ items: [{ ...CAL_EVENT, extendedProperties: { private: { propos: 'blocker' } } }], nextPageToken: 'fixture-page-2' }); },
      () => { assert.equal(f.queries.length, 1); return googlePage({ items: [CAL_EVENT] }); },
    ] });
    assertWebhookEmpty(await f.send());
    assert.equal(f.calendarRequests.length, 2);
    assert.equal(new URL(f.calendarRequests[1].url).searchParams.get('pageToken'), 'fixture-page-2');
    assertCalendarAssignment(f, 'PENDING'); assert.equal(f.completionCalls.length, 1);
  });
  for (const [label, response] of [
    ['HTTP failure', () => new Response('fixture backendError', { status: 503 })],
    ['network failure', () => new Error('fixture network unavailable')],
    ['invalid JSON', () => new Response('{broken', { status: 200 })],
  ]) test(`${label} acknowledges without assigning partially read events`, async t => {
    const f = await actualWebhook(t, { responses: [[CAL_PROPERTY]], expectedErrors: 1,
      pages: [googlePage({ items: [CAL_EVENT], nextPageToken: 'more' }), response()] });
    assertWebhookEmpty(await f.send());
    assert.equal(f.queries.length, 1); assert.deepEqual(f.completionCalls, []); assert.deepEqual(f.slackCalls, []);
  });
  test('page overflow acknowledges but never applies the first pages', async t => {
    const f = await actualWebhook(t, { responses: [[CAL_PROPERTY]], expectedErrors: 1,
      pages: Array.from({ length: 10 }, () => googlePage({ items: [CAL_EVENT], nextPageToken: 'more' })) });
    assertWebhookEmpty(await f.send());
    assert.equal(f.calendarRequests.length, 10); assert.equal(f.queries.length, 1); assert.deepEqual(f.completionCalls, []);
  });
});

describe('actual calendar webhook — assignment and notifications', () => {
  for (const status of ['PENDING', 'NOTIFYING_VIP_1', 'NOTIFYING_VIP_2', 'NOTIFYING_VIP_3', 'NOTIFYING_BULK', 'BULK_REMINDED', 'ESCALATED']) test(`${status}: actual matching persists assignee, Google event and booked times`, async t => {
    const f = await actualWebhook(t, { responses: assignmentRows({ ...CAL_JOB, status }), pages: [googlePage({ items: [CAL_EVENT] })] });
    assertWebhookEmpty(await f.send());
    assert.deepEqual(f.queries[1].params, [['worker@example.invalid']]);
    assert.match(f.queries[1].sql, /lower\(trim\(email\)\) = ANY\(\$1::text\[\]\)/);
    assert.deepEqual(f.queries[2].params, [CAL_PROPERTY.property_id, '2026-11-20', CAL_EVENT.id]);
    assert.ok(f.queries[2].sql.includes(`'${status}'`));
    assertCalendarAssignment(f, status);
    assert.equal(f.completionCalls.length, 1);
    assert.deepEqual(f.completionCalls[0], [f.db, CAL_JOB.id, CAL_CLEANER.id]);
    assert.equal(f.slackCalls.length, 1); assert.ok(f.slackCalls[0][0].includes('Fixture Worker'));
    assert.ok(f.slackCalls[0][0].includes('2026-11-20')); assert.match(f.slackCalls[0][0], /배정 완료/);
  });
  test('matching skips the organizer and unregistered candidates to find a registered cleaner', async t => {
    const event = { ...CAL_EVENT, attendees: [{ email: 'host@example.invalid' }, { email: 'unknown@example.invalid' }, { email: ' WORKER@Example.INVALID ' }] };
    const f = await actualWebhook(t, { responses: assignmentRows(), pages: [googlePage({ items: [event] })] });
    assertWebhookEmpty(await f.send());
    assert.deepEqual(f.queries[1].params, [['unknown@example.invalid', 'worker@example.invalid']]);
    assertCalendarAssignment(f, 'PENDING');
  });
  test('a missing assignee on ASSIGNED is repaired and completion notices run once', async t => {
    const f = await actualWebhook(t, { responses: assignmentRows({ ...CAL_JOB, status: 'ASSIGNED' }), pages: [googlePage({ items: [CAL_EVENT] })] });
    assertWebhookEmpty(await f.send()); assertCalendarAssignment(f, 'ASSIGNED');
    assert.equal(f.completionCalls.length, 1); assert.equal(f.slackCalls.length, 1);
  });
  test('same assignee/event time correction is silent', async t => {
    const job = { ...CAL_JOB, status: 'ASSIGNED', assigned_cleaner_id: CAL_CLEANER.id, google_event_id: CAL_EVENT.id };
    const f = await actualWebhook(t, { responses: [[CAL_PROPERTY], [CAL_CLEANER], [job], [{ id: job.id }]], pages: [googlePage({ items: [CAL_EVENT] })] });
    assertWebhookEmpty(await f.send()); assertCalendarAssignment(f, 'ASSIGNED');
    assert.deepEqual(f.completionCalls, []); assert.deepEqual(f.slackCalls, []);
  });
  test('an existing linked assignment is never switched to another matched cleaner', async t => {
    const job = { ...CAL_JOB, status: 'ASSIGNED', assigned_cleaner_id: '33333333-3333-4333-8333-333333333333', google_event_id: CAL_EVENT.id };
    const f = await actualWebhook(t, { responses: [[CAL_PROPERTY], [CAL_CLEANER], [job]], pages: [googlePage({ items: [CAL_EVENT] })] });
    assertWebhookEmpty(await f.send()); assert.equal(f.queries.length, 3);
    assert.deepEqual(f.completionCalls, []); assert.deepEqual(f.slackCalls, []);
  });
  test('a lost conditional UPDATE does not send assignment notices', async t => {
    const f = await actualWebhook(t, { responses: [[CAL_PROPERTY], [CAL_CLEANER], [CAL_JOB], []], pages: [googlePage({ items: [CAL_EVENT] })] });
    assertWebhookEmpty(await f.send()); assertCalendarAssignment(f, 'PENDING');
    assert.deepEqual(f.completionCalls, []); assert.deepEqual(f.slackCalls, []);
  });
  test('COMPLETED/CANCELLED jobs are excluded by the SELECT contract', async t => {
    const f = await actualWebhook(t, { responses: [[CAL_PROPERTY], [CAL_CLEANER], []], pages: [googlePage({ items: [CAL_EVENT] })] });
    assertWebhookEmpty(await f.send()); assert.equal(f.queries.length, 3);
    assert.doesNotMatch(f.queries[2].sql, /'(?:COMPLETED|CANCELLED)'/);
    assert.match(f.queries[2].sql, /data_origin='REAL'/);
    assert.deepEqual(f.completionCalls, []); assert.deepEqual(f.slackCalls, []);
  });
  test('completion-delivery failure preserves the saved assignment and still posts operator notice', async t => {
    const f = await actualWebhook(t, { responses: assignmentRows(), pages: [googlePage({ items: [CAL_EVENT] })], expectedErrors: 1,
      calendar: { complete: async () => { throw new Error('fixture completion delivery failed'); } } });
    assertWebhookEmpty(await f.send()); assertCalendarAssignment(f, 'PENDING');
    assert.equal(f.completionCalls.length, 1); assert.equal(f.slackCalls.length, 1);
  });
});

describe('actual calendar webhook — ignored events and unknown cleaner', () => {
  for (const [label, change] of [
    ['blocker', { extendedProperties: { private: { propos: 'blocker' } } }],
    ['no attendees', { attendees: [] }], ['organizer only', { attendees: [{ email: 'host@example.invalid' }] }],
    ['cancelled event', { status: 'cancelled' }],
    ['all-day event', { start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }],
    ['missing timezone', { start: { dateTime: '2026-11-20T12:00:00' } }],
  ]) test(`${label} is not assigned`, async t => {
    const f = await actualWebhook(t, { responses: [[CAL_PROPERTY]], pages: [googlePage({ items: [{ ...CAL_EVENT, ...change }] })] });
    assertWebhookEmpty(await f.send()); assert.equal(f.queries.length, 1);
    assert.deepEqual(f.completionCalls, []); assert.deepEqual(f.slackCalls, []);
  });
  test('booking before checkout is rejected after locating the job', async t => {
    const event = { ...CAL_EVENT, start: { dateTime: '2026-11-20T10:00:00+09:00' } };
    const f = await actualWebhook(t, { responses: [[CAL_PROPERTY], [CAL_CLEANER], [CAL_JOB]], pages: [googlePage({ items: [event] })] });
    assertWebhookEmpty(await f.send()); assert.equal(f.queries.length, 3);
    assert.deepEqual(f.completionCalls, []); assert.deepEqual(f.slackCalls, []);
  });
  test('unregistered attendee never becomes ASSIGNED and the actual warning is suppressed after success', async t => {
    const values = new Map();
    const kv = { async get(key) { return values.get(key) ?? null; },
      async set(key, value, options = {}) { if (options.nx && values.has(key)) return null; values.set(key, value); return 'OK'; } };
    const event = { ...CAL_EVENT, attendees: [{ email: 'UNKNOWN@Example.INVALID' }] };
    const f = await actualWebhook(t, { responses: [[CAL_PROPERTY], [], [CAL_JOB], [CAL_PROPERTY], [], [CAL_JOB]],
      pages: [googlePage({ items: [event] }), googlePage({ items: [event] })], calendar: { kv } });
    assertWebhookEmpty(await f.send()); assertWebhookEmpty(await f.send());
    assert.equal(f.queries.length, 6); assert.equal(f.queries.filter(q => /UPDATE/.test(q.sql)).length, 0);
    assert.deepEqual(f.completionCalls, []); assert.equal(f.slackCalls.length, 1);
    assert.ok(f.slackCalls[0][0].includes('unknown@example.invalid'));
    assert.ok(f.kvCalls.some(c => c.method === 'set' && c.args[0] === 'cleaning:unregistered-cleaner-alert:fixture-calendar-event' && c.args[2]?.ex === 86400));
  });
});
