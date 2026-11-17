/**
 * ACT-08 단계 ④ — 청소 일정 수동 취소의 실제 API 계약.
 * API·권한·블로커 생성은 실제 구현, DB·OAuth·발송·HTTP는 가짜 I/O.
 * 하단의 취소 외 기존 복사 테스트 24개는 ACT-08 단계 ⑥ 후속 대상이다.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ACT-08 단계 ④: actual API; scripted rows and external adapters contain no cancellation policy.
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
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

// Legacy copied checks outside cancellation; kept for ACT-08 step 6, not implementation evidence.
// ============================================================
// 취소 후 상태 머신 불변식 검증
// ============================================================

describe("CANCELLED 상태 — 상태 머신 불변식", () => {
  const VALID_STATUSES = [
    "PENDING", "NOTIFYING_VIP_1", "NOTIFYING_VIP_2", "NOTIFYING_VIP_3",
    "NOTIFYING_BULK", "BULK_REMINDED", "ESCALATED", "ASSIGNED", "COMPLETED", "CANCELLED"
  ];

  test("CANCELLED가 유효 상태 목록에 포함됨", () => {
    assert.ok(VALID_STATUSES.includes("CANCELLED"));
  });

  test("advanceJob 대상 아님 (CANCELLED → nextStatus 없음)", () => {
    const nextStatus = {
      PENDING: "NOTIFYING_VIP_1",
      NOTIFYING_VIP_1: "NOTIFYING_VIP_2",
      NOTIFYING_VIP_2: "NOTIFYING_VIP_3",
      NOTIFYING_VIP_3: "NOTIFYING_BULK",
    };
    assert.equal(nextStatus["CANCELLED"], undefined);
  });

  test("followup 크론 — CANCELLED job은 처리 대상 아님", () => {
    // followup 크론은 PENDING / NOTIFYING_VIP_* / NOTIFYING_BULK / BULK_REMINDED만 처리
    const followupStatuses = new Set([
      "PENDING", "NOTIFYING_VIP_1", "NOTIFYING_VIP_2", "NOTIFYING_VIP_3",
      "NOTIFYING_BULK", "BULK_REMINDED"
    ]);
    assert.ok(!followupStatuses.has("CANCELLED"));
  });
});

// ============================================================
// bootstrap 블로커 — 날짜 목록 생성 검증
// ============================================================

describe("Bootstrap 블로커 — 날짜 목록 생성", () => {
  function getMonthDates(yearMonth) {
    const [y, m] = yearMonth.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    return Array.from({ length: days }, (_, i) => `${yearMonth}-${pad(i + 1)}`);
  }

  test("2026-09 → 30개 날짜", () => {
    const dates = getMonthDates("2026-09");
    assert.equal(dates.length, 30);
    assert.equal(dates[0], "2026-09-01");
    assert.equal(dates[29], "2026-09-30");
  });

  test("2026-02 → 28개 날짜", () => {
    assert.equal(getMonthDates("2026-02").length, 28);
  });

  test("2024-02 → 29개 날짜 (윤년)", () => {
    assert.equal(getMonthDates("2024-02").length, 29);
  });

  test("2026-12 → 31개 날짜", () => {
    assert.equal(getMonthDates("2026-12").length, 31);
  });

  test("잘못된 YYYY-MM 형식 → 검증 실패 케이스 확인", () => {
    assert.ok(/^\d{4}-\d{2}$/.test("2026-09"), "유효 형식");
    assert.ok(!/^\d{4}-\d{2}$/.test("2026-9"), "월 한 자리 → 무효");
    assert.ok(!/^\d{4}-\d{2}$/.test("26-09"), "연도 두 자리 → 무효");
  });
});

// ============================================================
// Gmail Watch 등록 — 필수 환경변수 검증
// ============================================================

describe("Gmail Watch 등록 — 설정 검증", () => {
  test("GOOGLE_PUBSUB_TOPIC 없으면 500 반환 조건", () => {
    const topicName = process.env.GOOGLE_PUBSUB_TOPIC ?? null;
    // 테스트 환경에서 env 미설정 → 실제 서버에서 500 반환 경로
    if (!topicName) {
      assert.equal(topicName, null);
    } else {
      assert.ok(topicName.startsWith("projects/"), "topic 형식: projects/{id}/topics/{name}");
    }
  });

  test("Watch expiration → 7일 이내 (604800000ms)", () => {
    // Google Gmail Watch는 최대 7일 유효. 주기적 재등록 필요.
    const MAX_WATCH_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
    assert.equal(MAX_WATCH_DURATION_MS, 604_800_000);
  });
});

// ============================================================
// upsertProperty — ical_url 포함 필드 검증
// ============================================================

describe("upsertProperty — ical_url 처리 로직", () => {
  function buildUpsertPayload(input) {
    const { property_id, name, checkout_hour, cleaning_duration_hours,
            google_calendar_id, google_calendar_booking_url, host_phone, ical_url } = input;
    if (!property_id || !name) return { error: "property_id, name 필수" };
    return {
      property_id, name,
      checkout_hour: checkout_hour ?? 11,
      cleaning_duration_hours: cleaning_duration_hours ?? 2.5,
      google_calendar_id: google_calendar_id ?? null,
      google_calendar_booking_url: google_calendar_booking_url ?? null,
      host_phone: host_phone ?? null,
      ical_url: ical_url ?? null,
    };
  }

  test("ical_url 포함 저장 정상", () => {
    const p = buildUpsertPayload({
      property_id: "paju201", name: "파주201",
      ical_url: "https://www.airbnb.com/calendar/ical/abc123.ics",
    });
    assert.equal(p.ical_url, "https://www.airbnb.com/calendar/ical/abc123.ics");
  });

  test("ical_url 없으면 null → COALESCE로 기존 값 유지", () => {
    const p = buildUpsertPayload({ property_id: "paju201", name: "파주201" });
    assert.equal(p.ical_url, null);
    // SQL: COALESCE($8, property_cleaning_config.ical_url) → null이면 기존 값 유지
  });

  test("필수 필드 누락 → error 반환", () => {
    const p = buildUpsertPayload({ property_id: "paju201" });
    assert.ok("error" in p);
  });

  test("기본값: checkout_hour=11, duration=2.5", () => {
    const p = buildUpsertPayload({ property_id: "paju201", name: "파주201" });
    assert.equal(p.checkout_hour, 11);
    assert.equal(p.cleaning_duration_hours, 2.5);
  });

  test("ical_url은 listProperties 응답에 포함 (서버 전용)", () => {
    // SELECT * FROM property_cleaning_config → ical_url 컬럼 포함됨
    // 브라우저로 직접 노출되지만 Admin 전용 화면에서만 사용
    const responseShape = ["property_id", "name", "checkout_hour", "ical_url", "google_calendar_id"];
    assert.ok(responseShape.includes("ical_url"));
  });
});

// ============================================================
// cleaning-followup 크론 — 타이밍 로직 검증
// ============================================================

describe("followup 크론 — BULK 리마인드 타이밍 (1시간)", () => {
  // SQL: n.sent_at < NOW() - INTERVAL '1 hour'
  function shouldSendRemind(sentAt, nowMs = Date.now()) {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    return nowMs - new Date(sentAt).getTime() > ONE_HOUR_MS;
  }

  test("1시간 이상 경과 → 리마인드 발송", () => {
    const sentAt = new Date(Date.now() - 70 * 60 * 1000).toISOString(); // 70분 전
    assert.ok(shouldSendRemind(sentAt));
  });

  test("1시간 미만 경과 → 리마인드 미발송", () => {
    const sentAt = new Date(Date.now() - 50 * 60 * 1000).toISOString(); // 50분 전
    assert.ok(!shouldSendRemind(sentAt));
  });

  test("정확히 1시간 → 리마인드 발송 기준 초과 안함 (경계값)", () => {
    const nowMs = Date.now();
    const sentAt = new Date(nowMs - 60 * 60 * 1000).toISOString(); // 정확히 1시간
    // DB: INTERVAL '1 hour' → sent_at < NOW() - 1h (미만)
    // 정확히 1h는 경계라서 DB 쿼리에서는 미발송에 가까움
    assert.ok(!shouldSendRemind(sentAt, nowMs)); // <= 1h는 아직 미발송
  });

  test("이미 reminded_at 있는 notif → 조건 쿼리에서 제외", () => {
    // SQL: n.reminded_at IS NULL 조건으로 중복 발송 방지
    const notif = { reminded_at: new Date().toISOString() };
    assert.ok(notif.reminded_at !== null, "reminded_at 있으면 재발송 불필요");
  });
});

describe("followup 크론 — 에스컬레이션 타이밍 (3시간)", () => {
  // SQL: first_sent < NOW() - INTERVAL '3 hours'
  function shouldEscalate(firstSentAt, nowMs = Date.now()) {
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
    return nowMs - new Date(firstSentAt).getTime() > THREE_HOURS_MS;
  }

  test("3시간 이상 경과 → 에스컬레이션", () => {
    const firstSent = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(); // 4시간 전
    assert.ok(shouldEscalate(firstSent));
  });

  test("2시간 경과 → 에스컬레이션 아직 아님", () => {
    const firstSent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    assert.ok(!shouldEscalate(firstSent));
  });

  test("에스컬레이션 대상 상태: NOTIFYING_BULK, BULK_REMINDED", () => {
    const escalatableStatuses = new Set(["NOTIFYING_BULK", "BULK_REMINDED"]);
    assert.ok(escalatableStatuses.has("NOTIFYING_BULK"));
    assert.ok(escalatableStatuses.has("BULK_REMINDED"));
    assert.ok(!escalatableStatuses.has("ASSIGNED"));
    assert.ok(!escalatableStatuses.has("ESCALATED"));
    assert.ok(!escalatableStatuses.has("CANCELLED"));
  });

  test("에스컬레이션 SQL — 조건부 UPDATE로 중복 방지", () => {
    // UPDATE ... WHERE status IN ('NOTIFYING_BULK','BULK_REMINDED') RETURNING id
    // rows.length === 0 → 이미 다른 배정/취소 → 스킵
    const sql = `UPDATE cleaning_jobs SET status='ESCALATED' WHERE id=$1 AND status IN ('NOTIFYING_BULK','BULK_REMINDED') RETURNING id`;
    assert.ok(sql.includes("RETURNING id"));
    assert.ok(sql.includes("AND status IN"));
  });

  test("3시간 후 Slack 알림 발송", () => {
    const msg = `[PROPOS] 🚨 파주201 2026-09-15 청소 배정 실패. 수동 처리 필요.`;
    assert.ok(msg.includes("수동 처리 필요"));
    assert.ok(msg.startsWith("[PROPOS]"));
  });
});
