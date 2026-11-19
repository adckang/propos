/**
 * s127 — 청소 API의 데모 응답이 운영과 같은 규칙을 따른다 (ACT-08 QA-06, 2026-11-19)
 *
 * 화면(레포트 [예정]·대시보드 캘린더)은 운영·데모 응답을 같은 코드로 읽는다. 그래서 데모는 운영과 같은 검사를 먼저 거쳐야
 * 한다 — 레포트 API(/api/stats)에서 이미 지키는 원칙(s92)을 청소 통계(/api/cleaning/stats)에도.
 * 발견(QA-06): 기간을 빼고 부르면 운영은 400인데 데모만 "다음 주"로 간주해 200이었다(API 핸들러의 데모 분기와 로컬 Vite
 * 데모 중계 두 곳). 화면은 항상 기간을 붙여 부르므로 실제로 드러난 적은 없다 → 작은 수정 규칙으로 데모도 400.
 * 응답 칸의 모양 대조는 격리 DB 시험 tests/integration/s127.cleaning-demo-contract-sql.test.js(PGlite, CI 밖).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import makeConfig from '../../vite.config.mjs';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';

async function api(t, profile, url, responses = []) {
  const f = await cleaningDeclineFixture({ profile, responses });
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'all scripted DB results consumed');
      assert.deepEqual(f.unexpectedQueries, [], 'no hidden unexpected SQL');
      assert.deepEqual(f.blocked, [], 'no unmocked external I/O');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  const cookie = 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' });
  const res = await f.invoke({ method: 'GET', url, headers: { cookie } });
  return { code: res.code, body: res.body, queries: f.queries.length };
}

async function viteDemo(url) {
  const before = process.env.PROPOS_DATA_PROFILE;
  process.env.PROPOS_DATA_PROFILE = 'demo';
  try {
    let middleware;
    makeConfig({ mode: 'development' }).plugins.find(p => p.name === 'api-proxy-middleware')
      .configureServer({ middlewares: { use: fn => { middleware = fn; } } });
    const res = { statusCode: 200, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
    await middleware({ url, method: 'GET' }, res, () => { throw new Error('fell through to the network'); });
    return { code: res.statusCode, body: res.body };
  } finally {
    if (before === undefined) delete process.env.PROPOS_DATA_PROFILE; else process.env.PROPOS_DATA_PROFILE = before;
  }
}

describe('cleaning stats: DEMO checks the period exactly like production', () => {
  for (const [label, url] of [['no period', '/api/cleaning/stats?items=true'], ['an unknown period', '/api/cleaning/stats?period=bogus']]) {
    test(`${label}: production, the DEMO API and the local DEMO server all answer 400 with the same message, before any DB read`, async t => {
      const prod = await api(t, 'hybrid', url);
      const demo = await api(t, 'demo', url);
      const local = await viteDemo(url);
      assert.equal(prod.code, 400); assert.equal(prod.queries, 0);
      for (const other of [demo, local]) {
        assert.equal(other.code, 400);
        assert.equal(other.body.error, prod.body.error);
        assert.equal(other.body.dataProfile, 'demo');
      }
    });
  }

  test('a valid period still answers 200 in all three', async t => {
    const row = { total: '0', assigned: '0', requesting: '0', failed: '0', needs_request: '0' };
    const prod = await api(t, 'hybrid', '/api/cleaning/stats?period=next_week', [[row]]);
    const demo = await api(t, 'demo', '/api/cleaning/stats?period=next_week');
    const local = await viteDemo('/api/cleaning/stats?period=next_week');
    assert.deepEqual([prod.code, demo.code, local.code], [200, 200, 200]);
    assert.deepEqual(local.body, demo.body, 'the local DEMO server gives the same answer as the DEMO API');
  });
});

describe('로컬 Vite 데모 중계는 청소·숙소 API의 데모 응답을 직접 만들지 않고 실제 핸들러를 부른다', () => {
  // 예전엔 Vite 설정이 같은 데모 응답을 따로 다시 만들어, 한쪽만 바뀌면 어긋났다(RF-37: 기간 없는 요청이 데모만 200).
  for (const url of ['/api/cleaning/properties', '/api/cleaning/stats?period=this_month&items=true&property_ids=P001,P003',
    '/api/cleaning/jobs', '/api/cleaning/cleaners']) {
    test(`${url}: 로컬 데모 서버와 데모 API 핸들러의 답이 같다`, async t => {
      t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); // 데모 데이터는 "지금" 기준 시각을 쓴다 — 같은 순간에 비교
      const demo = await api(t, 'demo', url);
      const local = await viteDemo(url);
      assert.equal(local.code, demo.code);
      assert.deepEqual(local.body, demo.body);
    });
  }

  test('/api/properties: 로컬 데모 서버가 실제 숙소 메타데이터 핸들러의 데모 분기와 같은 목록을 준다', async () => {
    const before = process.env.PROPOS_DATA_PROFILE;
    process.env.PROPOS_DATA_PROFILE = 'demo';
    try {
      const { default: handler } = await import('../../api/properties.js');
      const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
      await handler({ method: 'GET', url: '/api/properties', query: {}, headers: {} }, res);
      const local = await viteDemo('/api/properties');
      assert.equal(res.statusCode, 200);
      assert.deepEqual(local, { code: 200, body: res.body });
    } finally {
      if (before === undefined) delete process.env.PROPOS_DATA_PROFILE; else process.env.PROPOS_DATA_PROFILE = before;
    }
  });

  test('Vite 설정에는 데모 응답을 만드는 코드가 없다 — 실제 핸들러 두 개를 부를 뿐', () => {
    const vite = readFileSync(new URL('../../vite.config.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(vite, /getDemoCleaningStats|getDemoPropertyConfigs|demoReportingService/);
    assert.match(vite, /runDemoApiHandler\(req, res, "\.\/api\/cleaning\/\[\.\.\.slug\]\.js"\)/);
    assert.match(vite, /runDemoApiHandler\(req, res, "\.\/api\/properties\.js"\)/);
  });
});
