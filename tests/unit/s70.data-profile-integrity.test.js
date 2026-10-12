/**
 * s70 — demo/real 데이터 프로필 경계와 공통 데모 데이터 무결성.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import statsHandler from '../../api/stats.js';
import icalHandler from '../../api/ical.js';
import {
  DEMO_PROPERTY_IDS,
  getDemoCleaningStats,
  getDemoDrilldown,
  getDemoMonthlyCalendar,
  getDemoPropertyConfigs,
  getDemoStats,
} from '../../src/application/demoReportingService.js';
import {
  DATA_PROFILE,
  normalizeDataProfile,
  resolveBuildDataProfile,
  resolveServerDataProfile,
} from '../../src/config/dataProfile.js';
import { getMonthlyInsights, getWeeklyInsights } from '../../src/application/reportingService.js';
import { periodToDateRange } from '../../src/domain/periodDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => readFileSync(path.join(ROOT, relativePath), 'utf8');
const NOW = new Date('2026-09-24T03:00:00Z');

function jsonResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    end(body = '') { this.body = body ? JSON.parse(body) : null; },
  };
}

describe('데이터 프로필 결정 — 로컬과 운영은 같은 hybrid, 명시값 오타는 실패', () => {
  test('서버와 빌드가 같은 기본 규칙을 쓴다', () => {
    assert.equal(resolveServerDataProfile({ VERCEL_ENV: 'production' }), DATA_PROFILE.HYBRID);
    assert.equal(resolveBuildDataProfile('production', { VERCEL_ENV: 'production' }), DATA_PROFILE.HYBRID);
    assert.equal(resolveServerDataProfile({ VERCEL_ENV: 'preview' }), DATA_PROFILE.HYBRID);
    assert.equal(resolveBuildDataProfile('production', { VERCEL_ENV: 'preview' }), DATA_PROFILE.HYBRID);
    assert.equal(resolveServerDataProfile({}), DATA_PROFILE.HYBRID);
    assert.equal(resolveBuildDataProfile('development', {}), DATA_PROFILE.HYBRID);
  });

  test('명시적 프로필은 환경 기본값보다 우선한다', () => {
    assert.equal(resolveServerDataProfile({ VERCEL_ENV: 'production', PROPOS_DATA_PROFILE: 'demo' }), DATA_PROFILE.DEMO);
    assert.equal(resolveBuildDataProfile('development', { PROPOS_DATA_PROFILE: 'real' }), DATA_PROFILE.REAL);
    assert.equal(normalizeDataProfile(undefined), DATA_PROFILE.HYBRID);
  });

  test('명시값 오타를 real로 조용히 바꾸지 않고 배포를 실패시킨다', () => {
    assert.throws(() => resolveServerDataProfile({ PROPOS_DATA_PROFILE: 'dmeo' }), /invalid PROPOS_DATA_PROFILE/);
    assert.throws(() => resolveBuildDataProfile('production', { PROPOS_DATA_PROFILE: 'raell' }), /invalid PROPOS_DATA_PROFILE/);
  });
});

describe('공통 demo 데이터 — 항목, 합계, 필터, 출처가 일치한다', () => {
  test('숙소 ID는 유일하고 설정 행도 같은 20개 DEMO 숙소다', () => {
    assert.equal(DEMO_PROPERTY_IDS.length, 20);
    assert.equal(new Set(DEMO_PROPERTY_IDS).size, DEMO_PROPERTY_IDS.length);
    const configs = getDemoPropertyConfigs();
    assert.deepEqual(configs.map(row => row.property_id), [...DEMO_PROPERTY_IDS]);
    assert.ok(configs.every(row => row.data_origin === 'DEMO' && row.ical_url === null));
  });

  test('청소 통계 합계는 항목에서 재계산한 값과 정확히 같다', () => {
    const result = getDemoCleaningStats('next_month', { withItems: true, now: NOW });
    const count = status => result.items.filter(item => item.status === status).length;
    assert.equal(result.assigned, count('ASSIGNED'));
    assert.equal(result.requesting, count('PENDING'));
    assert.equal(result.failed, count('ESCALATED'));
    assert.equal(result.needsRequest, count('CANCELLED'));
    assert.equal(result.total, result.assigned + result.requesting + result.failed);
    assert.equal(result.items.length, result.total + result.needsRequest);
    assert.equal(result.failedItems.length, result.failed);
    assert.equal(result.needsRequestItems.length, result.needsRequest);
    assert.ok(result.items.every(item => item.data_origin === 'DEMO'));
    const jobKeys = result.items.map(item => `${item.property_id}|${item.checkout_at}`);
    assert.equal(new Set(jobKeys).size, jobKeys.length, '같은 숙소·체크아웃의 청소 잡이 중복됨');
  });

  test('숙소 필터 밖의 항목·인사이트는 응답에 섞이지 않는다', () => {
    const selected = ['P003'];
    const cleaning = getDemoCleaningStats('next_month', { propertyIds: selected, withItems: true, now: NOW });
    const stats = getDemoStats('this_month', { propertyIds: selected, now: NOW });
    assert.ok(cleaning.items.every(item => selected.includes(item.property_id)));
    assert.ok((stats.insights ?? []).every(insight => !insight.propertyId || selected.includes(insight.propertyId)));
  });

  test('이번 달 캘린더는 미래 사건을 완료 이력처럼 만들지 않고 일별 합계가 항목 수와 같다', () => {
    const calendar = getDemoMonthlyCalendar('this_month', { now: NOW });
    const dayTotal = Object.values(calendar.days).reduce((sum, day) => sum + day.total, 0);
    assert.equal(dayTotal, calendar.items.length);
    assert.ok(calendar.items.every(item => new Date(item.occurred_at) <= NOW));
    assert.ok(calendar.items.every(item => item.data_origin === 'DEMO'));
  });

  test('주·월 요약의 실패 수와 상세 항목 수가 같은 원본에서 계산된다', () => {
    for (const period of ['this_week', 'last_week', 'this_month', 'last_month']) {
      const { stats } = getDemoStats(period, { now: NOW });
      const cleaning = getDemoDrilldown('cleaning_time', period, { now: NOW });
      const checkoutEnergy = getDemoDrilldown('post_checkout_energy', period, { now: NOW });
      const checkoutSecurity = getDemoDrilldown('post_checkout_security', period, { now: NOW });
      const vacantEnergy = getDemoDrilldown('vacant_energy', period, { now: NOW });
      const postCleaningSecurity = getDemoDrilldown('post_cleaning_security', period, { now: NOW });
      const preStay = getDemoDrilldown('pre_stay_optimization', period, { now: NOW });
      assert.equal(stats.cleaningFinished - stats.cleaningOnTime, cleaning.failCount, `${period}: cleaning_time`);
      assert.equal(stats.postCheckoutEnergyWaste, checkoutEnergy.failCount, `${period}: post_checkout_energy`);
      assert.equal(stats.postCheckoutSecurityBreach, checkoutSecurity.failCount, `${period}: post_checkout_security`);
      assert.equal(stats.vacantEnergyWaste, vacantEnergy.failCount, `${period}: vacant_energy`);
      assert.equal(stats.postCleaningSecurityBreach, postCleaningSecurity.failCount, `${period}: post_cleaning_security`);
      assert.equal(stats.preStayAttempts - stats.preStayOptimized, preStay.failCount, `${period}: pre_stay_optimization`);
    }
  });
});

describe('API 경계 — demo는 공통 서비스만 읽고 실제 캘린더는 차단한다', () => {
  test('/api/stats demo 응답은 필터된 공통 데이터와 동일하다', async () => {
    const previous = process.env.PROPOS_DATA_PROFILE;
    process.env.PROPOS_DATA_PROFILE = 'demo';
    try {
      const req = { method: 'GET', query: { period: 'now', property_ids: 'P001' }, url: '/api/stats?period=now&property_ids=P001' };
      const res = jsonResponse();
      await statsHandler(req, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, getDemoStats('now', { propertyIds: ['P001'] }));
      assert.equal(res.body.dataProfile, 'demo');
    } finally {
      if (previous === undefined) delete process.env.PROPOS_DATA_PROFILE;
      else process.env.PROPOS_DATA_PROFILE = previous;
    }
  });

  test('/api/ical은 demo에서 실제 Airbnb·Google 원본을 읽지 않는다', async () => {
    const previous = process.env.PROPOS_DATA_PROFILE;
    process.env.PROPOS_DATA_PROFILE = 'demo';
    try {
      const res = jsonResponse();
      await icalHandler({ method: 'GET', query: {} }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.dataProfile, 'demo');
    } finally {
      if (previous === undefined) delete process.env.PROPOS_DATA_PROFILE;
      else process.env.PROPOS_DATA_PROFILE = previous;
    }
  });

  test('화면과 Vite는 hybrid에서 DB 혼합 데이터를 사용한다', () => {
    const app = read('src/components/v2/RoomStateApp.jsx');
    const vite = read('vite.config.mjs');
    assert.match(app, /dbPropertyRows/);
    assert.match(app, /cloudRowToLiveProperty/);
    assert.match(vite, /if \(dataProfile !== DATA_PROFILE\.DEMO\) startWatcher\(\)/);
    assert.match(vite, /req\.url\?\.startsWith\("\/api\/ical"\)/);
  });

  test('운영의 테스트 초기화는 별도 환경변수 없이는 403이다', () => {
    const cleaningApi = read('api/cleaning/[...slug].js');
    assert.match(cleaningApi, /if \(process\.env\.PROPOS_ENABLE_TEST_MUTATIONS !== "true"\) \{\s*return sendJson\(res, 403/);
  });
});

describe('현재 주·월 인사이트 — 미래 checkout을 실패 이력에 포함하지 않는다', () => {
  function makeDb(calls) {
    return {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (/FROM events/.test(sql)) return { rows: [] };
        return { rows: [{ created: '0', assigned: '0' }] };
      },
    };
  }

  async function assertCurrentRangeCapped(period, run) {
    const calls = [];
    await run(makeDb(calls));
    const fromMs = periodToDateRange(period, NOW.getTime()).from.getTime();
    const currentCalls = calls.filter(call => new Date(call.params?.[0]).getTime() === fromMs);
    assert.ok(currentCalls.length >= 2, `${period} 현재 구간의 이벤트·청소 조회를 찾지 못함`);
    assert.ok(currentCalls.every(call => new Date(call.params[1]).getTime() === NOW.getTime()));
  }

  test('this_month의 조회 끝은 월말이 아니라 now', async () => {
    await assertCurrentRangeCapped('this_month', db => getMonthlyInsights('this_month', { db, now: NOW }));
  });

  test('this_week의 조회 끝은 주말이 아니라 now', async () => {
    await assertCurrentRangeCapped('this_week', db => getWeeklyInsights('this_week', { db, now: NOW }));
  });
});
