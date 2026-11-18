/**
 * ACT-08 단계 ⑥-8 — 실제 청소 API 라우터(`api/cleaning/[...slug].js` default handler).
 * 화면·문자 링크가 실제로 쓰는 주소를 직접 경로와 vercel.json rewrite 목적지 두 형태로 넣고,
 * 어떤 처리 함수에 어떤 id가 도착하는지를 그 함수가 보낸 SQL로 확인한다. DB·외부 I/O만 가짜다.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';

const JOB = '11111111-1111-4111-8111-111111111111';
const CLEANER = '22222222-2222-4222-8222-222222222222';
const REWRITES = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')).rewrites;

// Apply one vercel.json rewrite rule the way the platform does: the path parameter lands in the destination query.
function rewritten(source, value) {
  const rule = REWRITES.find(r => r.source === source);
  assert.ok(rule, `vercel.json rewrite ${source}`);
  return rule.destination.replaceAll(':id', encodeURIComponent(value));
}

async function router(t, responses = []) {
  const f = await cleaningDeclineFixture({ responses });
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'all scripted DB results consumed');
      assert.deepEqual(f.unexpectedQueries, [], 'no hidden unexpected SQL');
      assert.deepEqual(f.blocked, [], 'no unmocked external I/O');
      assert.deepEqual(f.errors, [], 'no hidden handler errors');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  const admin = () => ({ cookie: 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' }) });
  return { ...f, call: (method, url, { body, headers } = {}) => f.invoke({ method, url, body, headers: headers ?? admin() }) };
}

describe('actual router — paths the dashboard calls', () => {
  for (const [label, url] of [
    ['direct path', `/api/cleaning/jobs/${JOB}`],
    ['vercel.json rewrite', rewritten('/api/cleaning/jobs/:id', JOB)],
  ]) test(`GET job detail (${label}) reaches getJob with the job id`, async t => {
    const f = await router(t, [[]]);
    const res = await f.call('GET', url);
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: '일정 없음' });
    assert.equal(f.queries.length, 1);
    assert.match(f.queries[0].sql, /FROM cleaning_jobs j[\s\S]*WHERE j\.id=\$1/);
    assert.deepEqual(f.queries[0].params, [JOB]);
  });

  for (const [label, url, body] of [
    ['body job_id (CleaningManager · CleaningProcessCheck)', '/api/cleaning/dispatch', { job_id: JOB }],
    ['direct path', `/api/cleaning/dispatch/${JOB}`, undefined],
    ['vercel.json rewrite', rewritten('/api/cleaning/dispatch/:id', JOB), undefined],
  ]) test(`POST dispatch via ${label} reaches dispatchJob with the job id`, async t => {
    const f = await router(t, [[]]);
    const res = await f.call('POST', url, { body });
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: '일정 없음' });
    assert.deepEqual(f.queries.map(q => [q.sql, q.params]), [['SELECT * FROM cleaning_jobs WHERE id=$1', [JOB]]]);
  });

  test('GET on dispatch (e.g. a link prefetch) never reaches dispatchJob', async t => {
    const f = await router(t);
    const res = await f.call('GET', rewritten('/api/cleaning/dispatch/:id', JOB));
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
    assert.deepEqual(f.queries, []);
    assert.deepEqual(f.advances, []);
  });

  test('POST dispatch without an id or body job_id is not routed and touches no DB', async t => {
    const f = await router(t);
    const res = await f.call('POST', '/api/cleaning/dispatch', { body: {} });
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
    assert.deepEqual(f.queries, []);
  });

  for (const [label, url] of [
    ['direct path', `/api/cleaning/cleaners/${CLEANER}`],
    ['vercel.json rewrite', rewritten('/api/cleaning/cleaners/:id', CLEANER)],
  ]) test(`DELETE cleaner (${label}) reaches deleteCleaner with the cleaner id`, async t => {
    const f = await router(t, [[]]);
    const res = await f.call('DELETE', url);
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: '청소자 없음' });
    assert.deepEqual(f.queries.map(q => [q.sql, q.params]), [['UPDATE cleaners SET active=false WHERE id=$1 RETURNING id', [CLEANER]]]);
  });

  test('a query id takes precedence over a different id in the path', async t => {
    const f = await router(t, [[]]);
    await f.call('DELETE', `/api/cleaning/cleaners/${JOB}?id=${CLEANER}`);
    assert.deepEqual(f.queries.map(q => q.params), [[CLEANER]]);
  });

  test('a non-UUID second path segment is not treated as an id, so DELETE does not reach deleteCleaner', async t => {
    const f = await router(t);
    const res = await f.call('DELETE', '/api/cleaning/cleaners/not-a-uuid');
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
    assert.deepEqual(f.queries, []);
  });

  for (const [label, method, url] of [
    ['unknown resource', 'GET', '/api/cleaning/no-such-resource'],
    ['unsupported method on a known resource', 'DELETE', '/api/cleaning/jobs'],
    ['URL without the cleaning segment', 'GET', '/api/other/thing'],
  ]) test(`${label} returns the router's 404 without any DB work`, async t => {
    const f = await router(t);
    const res = await f.call(method, url);
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
    assert.deepEqual(f.queries, []);
  });
});

describe('actual router — public booking link /c/:id (cleaner SMS · push)', () => {
  const PROPERTY = '파주 201';
  const BOOKING = 'https://calendar.app.google/fixture-booking';

  for (const source of ['/c/:id', '/api/c/:id']) {
    test(`${source} rewrite redirects to the property booking page without a login`, async t => {
      const f = await router(t, [[{ google_calendar_booking_url: BOOKING }]]);
      const res = await f.call('GET', rewritten(source, PROPERTY), { headers: {} });
      assert.equal(res.code, 302);
      assert.equal(res.kind, 'redirect');
      assert.equal(res.headers.location, BOOKING);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.deepEqual(f.queries.map(q => [q.sql, q.params]),
        [['SELECT google_calendar_booking_url FROM property_cleaning_config WHERE property_id=$1', [PROPERTY]]]);
    });
  }

  test('a property without a booking page returns the HTML link-error page', async t => {
    const f = await router(t, [[]]);
    const res = await f.call('GET', rewritten('/c/:id', PROPERTY), { headers: {} });
    assert.equal(res.code, 404);
    assert.equal(res.kind, 'html');
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(res.body, /<title>링크 오류<\/title>/);
    assert.match(res.body, /해당 숙소의 예약 캘린더가 설정되지 않았습니다\./);
    assert.equal(res.headers.location, undefined);
  });

  test('non-GET on the booking link is 405 before any DB work', async t => {
    const f = await router(t);
    const res = await f.call('POST', rewritten('/c/:id', PROPERTY), { headers: {} });
    assert.equal(res.code, 405);
    assert.deepEqual(f.queries, []);
  });

  test('the booking link without a property id falls through to the router 404', async t => {
    const f = await router(t);
    const res = await f.call('GET', '/api/cleaning/c', { headers: {} });
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
    assert.deepEqual(f.queries, []);
  });
});
