/**
 * ACT-08 단계 ② — 실제 청소 API의 거절 링크 요청·응답 계약.
 * DB 결과와 발송 경계만 격리하고, 핸들러·예약 취소 가드는 실제 구현을 호출한다.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// ACT-08 단계 ②: 실제 /api/cleaning 핸들러를 요청하고 I/O 결과만 주입한다.
import { readFileSync } from 'node:fs';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';

const DECLINE_NOTIF = { id: '11111111-1111-4111-8111-111111111111', job_id: '22222222-2222-4222-8222-222222222222',
  cleaner_id: '33333333-3333-4333-8333-333333333333', token: 'ABC123', response: null,
  job_status: 'PENDING', data_origin: 'REAL', property_id: 'fixture-decline-property',
  cleaning_start_at: '2026-11-20T03:00:00.000Z', checkout_at: '2026-11-20T02:00:00.000Z', reservation_uid: 'fixture-reservation' };
async function actualDecline(t, { expectedErrors = 0, ...options } = {}) {
  const f = await cleaningDeclineFixture(options);
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'every planned DB result must be consumed');
      assert.deepEqual(f.blocked, [], 'no external I/O attempts');
      assert.equal(f.errors.length, expectedErrors, 'no unexpected or swallowed handler errors');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  return f;
}
function expectDeclineJson(res, code, message, ok = true) {
  assert.equal(res.code, code); assert.equal(res.kind, 'json');
  assert.deepEqual(res.body, { ok, message });
}
function assertDeclineWrite(call, response) {
  assert.match(call.sql, /UPDATE cleaning_notifs SET response='/i);
  assert.ok(call.sql.includes(`response='${response}'`));
  assert.match(call.sql, /response_at=NOW\(\) WHERE token=\$1/i);
  assert.deepEqual(call.params, ['ABC123']);
}

// No token validator, status transition function, aggregate calculation or
// response formatter is reimplemented in these tests.
describe('actual decline handler — request and token', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) test(`${method} returns 405 without reading the DB`, async t => {
    const f = await actualDecline(t);
    const r = await f.invoke({ method });
    assert.equal(r.code, 405); assert.equal(r.kind, 'empty');
    assert.deepEqual(f.queries, []); assert.deepEqual(f.advances, []); assert.deepEqual(f.slackCalls, []);
  });
  for (const token of ['ABC12', 'ABC1234', 'ABC-23', 'ABC 23']) test(`invalid token ${JSON.stringify(token)} returns 404 before DB`, async t => {
    const f = await actualDecline(t);
    expectDeclineJson(await f.invoke({ query: { slug: 'd', token, format: 'api' } }), 404, '유효하지 않은 링크입니다.', false);
    assert.deepEqual(f.queries, []);
  });
  for (const [token, expectedToken] of [['ABC123', 'ABC123'], ['ZZZZZZ', 'ZZZZZZ'], ['000000', '000000'], ['A1B2C3', 'A1B2C3'], ['abc123', 'ABC123']]) test(`token ${token} is uppercased in the actual lookup`, async t => {
    const f = await actualDecline(t, { responses: [[]] });
    expectDeclineJson(await f.invoke({ query: { slug: ['d'], token, format: 'api' } }), 404, '링크를 찾을 수 없습니다.', false);
    assert.equal(f.queries.length, 1);
    assert.match(f.queries[0].sql, /FROM cleaning_notifs n JOIN cleaning_jobs j ON j.id=n.job_id WHERE n.token=\$1/);
    assert.deepEqual(f.queries[0].params, [expectedToken]);
  });
  for (const query of [{ slug: 'd' }, { slug: 'd', token: '', format: 'api' }]) test('missing/empty token is rejected by the actual router', async t => {
    const f = await actualDecline(t);
    const r = await f.invoke({ query });
    assert.equal(r.code, 404); assert.deepEqual(r.body, { error: 'Not found' });
    assert.deepEqual(f.queries, []);
  });
  test('DEMO blocks the public link before DB or followup', async t => {
    const f = await actualDecline(t, { profile: 'demo' });
    const r = await f.invoke();
    assert.equal(r.code, 403); assert.deepEqual(r.body, { error: 'demo profile is read-only', dataProfile: 'demo' });
    assert.deepEqual(f.queries, []); assert.deepEqual(f.advances, []); assert.deepEqual(f.slackCalls, []);
  });
  test('a SIMULATED job cannot be declined or dispatched through the public link', async t => {
    const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, data_origin: 'SIMULATED' }]] });
    expectDeclineJson(await f.invoke(), 409, '시뮬레이션 일정은 외부 배정 처리를 하지 않습니다.', false);
    assert.equal(f.queries.length, 1); assert.deepEqual(f.advances, []); assert.deepEqual(f.slackCalls, []);
  });
});

describe('actual decline handler — existing response and job states', () => {
  for (const response of ['DECLINED', 'DECLINED_AFTER_ASSIGNED', 'ACCEPTED']) test(`already recorded ${response} does not write or dispatch again`, async t => {
    const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, response }]] });
    expectDeclineJson(await f.invoke(), 200, '이미 처리된 링크입니다.');
    assert.equal(f.queries.length, 1); assert.deepEqual(f.advances, []); assert.deepEqual(f.slackCalls, []);
  });
  test('CANCELLED returns its existing message without recording a rejection', async t => {
    const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, job_status: 'CANCELLED' }]] });
    expectDeclineJson(await f.invoke(), 200, '해당 청소 일정은 이미 취소됐습니다. 감사합니다.');
    assert.equal(f.queries.length, 1); assert.deepEqual(f.advances, []); assert.deepEqual(f.slackCalls, []);
  });
  for (const job_status of ['ASSIGNED', 'COMPLETED']) test(`${job_status} records DECLINED_AFTER_ASSIGNED without advancing`, async t => {
    const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, job_status }], []] });
    expectDeclineJson(await f.invoke(), 200, '이미 배정 완료된 건입니다. 감사합니다.');
    assert.equal(f.queries.length, 2); assertDeclineWrite(f.queries[1], 'DECLINED_AFTER_ASSIGNED');
    assert.deepEqual(f.advances, []); assert.deepEqual(f.slackCalls, []);
  });
  for (const job_status of ['PENDING', 'ESCALATED']) test(`${job_status} records DECLINED and keeps the current job stage`, async t => {
    const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, job_status }], []] });
    expectDeclineJson(await f.invoke(), 200, '거절 처리됐습니다. 감사합니다.');
    assert.equal(f.queries.length, 2); assertDeclineWrite(f.queries[1], 'DECLINED');
    assert.deepEqual(f.advances, []); assert.deepEqual(f.slackCalls, []);
  });
});

describe('actual decline handler — followup boundaries', () => {
  for (const job_status of ['NOTIFYING_VIP_1', 'NOTIFYING_VIP_2', 'NOTIFYING_VIP_3']) test(`${job_status} records the decline before calling advanceJob once with the fetched job`, async t => {
    const job = { id: DECLINE_NOTIF.job_id, status: job_status, property_id: DECLINE_NOTIF.property_id, data_origin: 'REAL' };
    const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, job_status }], [], [job]] });
    expectDeclineJson(await f.invoke(), 200, '거절 처리됐습니다. 감사합니다.');
    assertDeclineWrite(f.queries[1], 'DECLINED');
    assert.match(f.queries[2].sql, /SELECT \* FROM cleaning_jobs WHERE id=\$1/);
    assert.deepEqual(f.queries[2].params, [DECLINE_NOTIF.job_id]);
    assert.equal(f.advances.length, 1); assert.equal(f.advances[0][0], f.db); assert.deepEqual(f.advances[0][1], job);
    assert.deepEqual(f.slackCalls, []);
  });
  test('failed advanceJob returns the existing 500 after the decline write', async t => {
    const job = { id: DECLINE_NOTIF.job_id, status: 'NOTIFYING_VIP_1' };
    const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, job_status: job.status }], [], [job]],
      expectedErrors: 1, advance: async () => { throw new Error('fixture followup unavailable'); } });
    const res = await f.invoke();
    assert.equal(res.code, 500); assert.deepEqual(res.body, { error: 'fixture followup unavailable' });
    assertDeclineWrite(f.queries[1], 'DECLINED');
    assert.equal(f.advances.length, 1); assert.equal(f.queries.length, 3);
  });
  for (const job_status of ['NOTIFYING_BULK', 'BULK_REMINDED']) {
    test(`${job_status}: outstanding replies keep the job waiting`, async t => {
      const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, job_status }], [], [{ total: '3', declined: '2' }]] });
      expectDeclineJson(await f.invoke(), 200, '거절 처리됐습니다. 감사합니다.');
      assertDeclineWrite(f.queries[1], 'DECLINED');
      assert.match(f.queries[2].sql, /COUNT\(\*\) AS total, COUNT\(CASE WHEN response='DECLINED' THEN 1 END\) AS declined/);
      assert.deepEqual(f.queries[2].params, [DECLINE_NOTIF.job_id]);
      assert.equal(f.queries.length, 3); assert.deepEqual(f.advances, []); assert.deepEqual(f.slackCalls, []);
    });
    test(`${job_status}: all declined escalates once after checking the actual reservation guard`, async t => {
      const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, job_status }], [], [{ total: '3', declined: '3' }], [{ gone: false }], []] });
      expectDeclineJson(await f.invoke(), 200, '거절 처리됐습니다. 감사합니다.');
      assert.match(f.queries[3].sql, /FROM property_reservations/);
      assert.deepEqual(f.queries[3].params, [DECLINE_NOTIF.property_id, DECLINE_NOTIF.checkout_at, DECLINE_NOTIF.reservation_uid]);
      assert.match(f.queries[4].sql, /UPDATE cleaning_jobs SET status='ESCALATED',\s*updated_at=NOW\(\) WHERE id=\$1/);
      assert.deepEqual(f.queries[4].params, [DECLINE_NOTIF.job_id]);
      assert.deepEqual(f.advances, []); assert.equal(f.slackCalls.length, 1);
      assert.ok(f.slackCalls[0][0].includes(DECLINE_NOTIF.property_id));
      assert.ok(f.slackCalls[0][0].includes('2026-11-20')); assert.match(f.slackCalls[0][0], /전원 거절/);
    });
    test(`${job_status}: cancelled checkout blocks escalation and Slack`, async t => {
      const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, job_status }], [], [{ total: '2', declined: '2' }], [{ gone: true }]] });
      expectDeclineJson(await f.invoke(), 200, '거절 처리됐습니다. 감사합니다.');
      assert.equal(f.queries.length, 4); assert.deepEqual(f.advances, []); assert.deepEqual(f.slackCalls, []);
    });
  }
  test('a sequential retry sees the recorded response and does not call followup twice', async t => {
    const notif = { ...DECLINE_NOTIF, job_status: 'NOTIFYING_VIP_1' };
    const job = { id: DECLINE_NOTIF.job_id, status: notif.job_status };
    const f = await actualDecline(t, { responses: [[notif], [], [job], [{ ...notif, response: 'DECLINED' }]] });
    expectDeclineJson(await f.invoke(), 200, '거절 처리됐습니다. 감사합니다.');
    expectDeclineJson(await f.invoke(), 200, '이미 처리된 링크입니다.');
    assert.equal(f.queries.length, 4); assert.equal(f.advances.length, 1);
    assert.equal(f.queries.filter(q => /UPDATE cleaning_notifs/.test(q.sql)).length, 1);
  });
});

describe('actual decline handler — response formats and routing', () => {
  for (const format of [undefined, 'html']) test(`format=${String(format)} returns the actual HTML page`, async t => {
    const f = await actualDecline(t, { responses: [[DECLINE_NOTIF], []] });
    const r = await f.invoke({ query: { slug: 'd', token: 'ABC123', ...(format ? { format } : {}) } });
    assert.equal(r.code, 200); assert.equal(r.kind, 'html'); assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(r.body, /<!doctype html>/); assert.match(r.body, /<h2>거절 처리 완료<\/h2>/);
    assert.ok(r.body.includes('거절 처리됐습니다. 감사합니다.'));
  });
  test('invalid HTML link gets the actual 404 page', async t => {
    const f = await actualDecline(t);
    const r = await f.invoke({ query: { slug: 'd', token: 'bad' } });
    assert.equal(r.code, 404); assert.equal(r.kind, 'html'); assert.match(r.body, /링크 오류/); assert.match(r.body, /유효하지 않은 링크/);
  });
  for (const source of ['/d/:token', '/api/d/:token']) test(`${source} rewrite destination reaches the current handler`, async t => {
    const rewrites = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')).rewrites;
    const rule = rewrites.find(r => r.source === source); assert.ok(rule);
    const f = await actualDecline(t, { responses: [[{ ...DECLINE_NOTIF, response: 'DECLINED' }]] });
    const url = rule.destination.replaceAll(':token', 'ABC123') + '&format=api';
    expectDeclineJson(await f.invoke({ url }), 200, '이미 처리된 링크입니다.');
    assert.deepEqual(f.queries[0].params, ['ABC123']);
  });
  test('query id remains the supported token fallback', async t => {
    const f = await actualDecline(t, { responses: [[]] });
    expectDeclineJson(await f.invoke({ query: { slug: 'd', id: 'ABC123', format: 'api' } }), 404, '링크를 찾을 수 없습니다.', false);
    assert.deepEqual(f.queries[0].params, ['ABC123']);
  });
});
