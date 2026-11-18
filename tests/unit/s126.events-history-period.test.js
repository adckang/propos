/**
 * ACT-08 수정 제안 2 — 이벤트 조회(GET /api/events/history)의 기간을 레포트와 같은 규칙으로.
 * 허용 기간은 레포트 API와 같은 periodCapabilities(period).stats, 범위는 같은 getPeriodRange(KST 달력).
 * "now"는 레포트처럼 오늘(KST) 하루. 실제 핸들러 전체를 묶고 DB·KV·Slack 만 가짜로 바꾼다.
 */

import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { createSessionToken } from '../../server/auth/operatorAuth.js';

const root = new URL('../../', import.meta.url).pathname;
// KST 2026-11-18(수) 08:30 = UTC 2026-11-17 23:30 — UTC 날짜와 KST 날짜가 다른 시각
const NOW = Date.parse('2026-11-17T23:30:00.000Z');

let handler;
before(async () => {
  const stubs = {
    pg: 'export class Pool { constructor() { return globalThis.__eventsHistoryIO.db; } } export default { Pool };',
    '@vercel/kv': "export const kv = new Proxy({}, { get: () => () => { throw new Error('Unexpected KV'); } });",
    '../../server/slackNotifier.js': "export const notifyEvent = () => { throw new Error('Unexpected Slack'); };",
  };
  const bundle = await build({ entryPoints: [resolve(root, 'api/events/[...slug].js')], bundle: true, write: false,
    platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'events-history-io', setup(b) {
      b.onResolve({ filter: /.*/ }, a => Object.hasOwn(stubs, a.path) ? { path: a.path, namespace: 'events-io' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'events-io' }, a => ({ contents: stubs[a.path], loader: 'js' }));
    } }] });
  ({ default: handler } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')));
});

async function history(t, query, { rows = [] } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const env = { PROPOS_DATA_PROFILE: 'hybrid', PROPOS_AUTH_MODE: 'enforce',
    PROPOS_ADMIN_PASSWORD: 'fixture-admin-password', PROPOS_SESSION_SECRET: 'fixture-session-secret-not-a-real-key' };
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const queries = [];
  globalThis.__eventsHistoryIO = { db: {
    async query(sql, params) { queries.push({ sql, params }); return { rows }; },
    async end() {},
  } };
  t.after(() => {
    delete globalThis.__eventsHistoryIO;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
  });
  const cookie = 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' });
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: 'GET', url: '/api/events/history', query: { slug: 'history', ...query }, headers: { cookie } }, res);
  const range = queries[0] ? { from: queries[0].params.at(-2).toISOString(), to: queries[0].params.at(-1).toISOString() } : null;
  return { res, queries, range };
}

const KST_DAY = (from, to) => ({ from, to });

describe('actual GET /api/events/history — report period rules (KST)', () => {
  test('"now" is today in KST like the report, not the UTC day', async t => {
    const { res, range } = await history(t, { period: 'now' });
    assert.equal(res.code, 200);
    assert.deepEqual(range, KST_DAY('2026-11-17T15:00:00.000Z', '2026-11-18T14:59:59.999Z'));
  });

  for (const [period, from, to] of [
    ['today', '2026-11-17T15:00:00.000Z', '2026-11-18T14:59:59.999Z'],
    ['yesterday', '2026-11-16T15:00:00.000Z', '2026-11-17T14:59:59.999Z'],
    ['days_ago_3', '2026-11-14T15:00:00.000Z', '2026-11-15T14:59:59.999Z'],
    ['this_week', '2026-11-15T15:00:00.000Z', '2026-11-22T14:59:59.999Z'],
    ['weeks_ago_2', '2026-11-01T15:00:00.000Z', '2026-11-08T14:59:59.999Z'],
    ['last_month', '2026-09-30T15:00:00.000Z', '2026-10-31T14:59:59.999Z'],
    ['last_hour', '2026-11-17T22:30:00.000Z', '2026-11-17T23:29:59.999Z'],
  ]) test(`${period} uses the report's KST range`, async t => {
    const { res, range } = await history(t, { period });
    assert.equal(res.code, 200);
    assert.deepEqual(range, { from, to });
  });

  test('no period defaults to this week (KST Monday 00:00 boundaries)', async t => {
    const { res, range } = await history(t, {});
    assert.equal(res.code, 200);
    assert.deepEqual(range, KST_DAY('2026-11-15T15:00:00.000Z', '2026-11-22T14:59:59.999Z'));
  });

  for (const period of ['months_ago_2', 'weeks_ago_9999', 'days_ago_0', 'not_a_period', '']) {
    test(`"${period}" is rejected like the report API, before any event query`, async t => {
      const { res, queries } = await history(t, { period });
      assert.equal(res.code, 400);
      assert.deepEqual(res.body, { error: `invalid period: ${period}` });
      assert.deepEqual(queries, []);
    });
  }

  test('a repeated period parameter (array) is rejected instead of being coerced', async t => {
    const { res, queries } = await history(t, { period: ['this_week'] });
    assert.equal(res.code, 400);
    assert.deepEqual(queries, []);
  });

  test('property filter, limit and total keep their existing contract', async t => {
    const rows = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];
    const { res, queries } = await history(t, { period: 'today', property_id: 'Fixture Stay', limit: '2' }, { rows });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { events: [{ id: 'e1' }, { id: 'e2' }], total: 3 });
    assert.deepEqual(queries[0].params[0], ['Fixture Stay']);
    assert.match(queries[0].sql, /property_id = ANY\(\$1::text\[\]\)[\s\S]*device_time >= \$2[\s\S]*device_time <= \$3/);
  });
});
