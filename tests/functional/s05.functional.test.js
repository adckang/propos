'use strict';

/**
 * S05 기능 테스트 — 수익 정산 오케스트레이션
 * node --test tests/functional/s05.functional.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  runMonthlySettlement,
  applyPricingRecommendations,
  fetchWithRetry,
} = require('../../src/application/settlementService.js');

// ============================================================
// 공통 픽스처
// ============================================================

const AIRBNB_DATA  = { gross: 12_400_000, platformFee: 744_000,  net: 11_656_000 };
const YANOLJA_DATA = { gross:  3_200_000, platformFee: 192_000,  net:  3_008_000 };

const PROP_DATA_LIST = [
  { propId: 'P-042', occupancy: 0.87, avgNightlyRate: 85_000, competitorAvg: 92_000 },
  { propId: 'P-043', occupancy: 0.75, avgNightlyRate: 70_000, competitorAvg: 75_000 },
];

const RECOMMENDATIONS = [
  { propId: 'P-042', currentRate: 85_000, suggestedRate: 101_200, confidence: 0.95, reason: '높은 점유율' },
  { propId: 'P-043', currentRate: 70_000, suggestedRate:  75_000, confidence: 0.75, reason: '경쟁사 대비 저평가' },
];

function makeParams(overrides = {}) {
  return { year: 2026, month: 3, propCount: 48, operatingCost: 2_100_000, marketTrend: 'spring_peak', ...overrides };
}

function makeDeps(overrides = {}) {
  const alerts    = [];
  const store     = { revenueData: null, pricingData: null, taxData: null };

  return {
    fetchAirbnb:     async () => ({ ...AIRBNB_DATA }),
    fetchYanolja:    async () => ({ ...YANOLJA_DATA }),
    getPropDataList: () => [...PROP_DATA_LIST],
    setRevenueData:  (d) => { store.revenueData = d; },
    setPricingData:  (d) => { store.pricingData = d; },
    setTaxData:      (d) => { store.taxData     = d; },
    addAlert:        (a) => { alerts.push(a); },
    _alerts:  alerts,
    _store:   store,
    ...overrides,
  };
}

// ============================================================
// TC-F-055 ~ 079
// ============================================================

// ── runMonthlySettlement 정상 흐름 ───────────────────────────

describe('TC-F-055: runMonthlySettlement 전체 성공', () => {
  test('status = success', async () => {
    const deps   = makeDeps();
    const result = await runMonthlySettlement(makeParams(), deps);
    assert.equal(result.status, 'success');
  });

  test('steps.dataCollected = true', async () => {
    const deps   = makeDeps();
    const result = await runMonthlySettlement(makeParams(), deps);
    assert.equal(result.steps.dataCollected, true);
  });

  test('steps.pricingOptimized = true', async () => {
    const deps   = makeDeps();
    const result = await runMonthlySettlement(makeParams(), deps);
    assert.equal(result.steps.pricingOptimized, true);
  });

  test('steps.taxReported = true', async () => {
    const deps   = makeDeps();
    const result = await runMonthlySettlement(makeParams(), deps);
    assert.equal(result.steps.taxReported, true);
  });

  test('revenueData 반환됨', async () => {
    const deps   = makeDeps();
    const result = await runMonthlySettlement(makeParams(), deps);
    assert.ok(result.revenueData);
    assert.equal(result.revenueData.totalGross, 12_400_000 + 3_200_000);
  });

  test('pricingData 반환됨', async () => {
    const deps   = makeDeps();
    const result = await runMonthlySettlement(makeParams(), deps);
    assert.ok(result.pricingData);
    assert.ok(result.pricingData.recommendations.length > 0);
  });

  test('taxData 반환됨', async () => {
    const deps   = makeDeps();
    const result = await runMonthlySettlement(makeParams(), deps);
    assert.ok(result.taxData);
    assert.ok(typeof result.taxData.vat === 'number');
  });

  test('error = null', async () => {
    const deps   = makeDeps();
    const result = await runMonthlySettlement(makeParams(), deps);
    assert.equal(result.error, null);
  });
});

describe('TC-F-056: runMonthlySettlement — 알림 순서 검증', () => {
  test('4개 이상의 알림 생성됨', async () => {
    const deps = makeDeps();
    await runMonthlySettlement(makeParams(), deps);
    // 정산 시작 + 수익 집계 + AI 최적화 + 세금 리포트 = 4개
    assert.ok(deps._alerts.length >= 4);
  });

  test('첫 번째 알림 = 정산 시작 (type: info)', async () => {
    const deps = makeDeps();
    await runMonthlySettlement(makeParams(), deps);
    assert.equal(deps._alerts[0].type, 'info');
    assert.ok(deps._alerts[0].msg.includes('정산 시작'));
  });

  test('수익 집계 완료 알림 포함', async () => {
    const deps = makeDeps();
    await runMonthlySettlement(makeParams(), deps);
    const found = deps._alerts.find(a => a.msg.includes('수익 데이터 수집 완료'));
    assert.ok(found, '수익 집계 완료 알림 없음');
  });

  test('AI 가격 최적화 완료 알림 포함', async () => {
    const deps = makeDeps();
    await runMonthlySettlement(makeParams(), deps);
    const found = deps._alerts.find(a => a.msg.includes('AI 가격 최적화 완료'));
    assert.ok(found, 'AI 최적화 완료 알림 없음');
  });

  test('세금 리포트 완료 알림 포함', async () => {
    const deps = makeDeps();
    await runMonthlySettlement(makeParams(), deps);
    const found = deps._alerts.find(a => a.msg.includes('세금 리포트 생성 완료'));
    assert.ok(found, '세금 리포트 완료 알림 없음');
  });
});

describe('TC-F-057: runMonthlySettlement — store 저장 검증', () => {
  test('setRevenueData 호출됨', async () => {
    const deps = makeDeps();
    await runMonthlySettlement(makeParams(), deps);
    assert.ok(deps._store.revenueData !== null);
  });

  test('setPricingData 호출됨', async () => {
    const deps = makeDeps();
    await runMonthlySettlement(makeParams(), deps);
    assert.ok(deps._store.pricingData !== null);
  });

  test('setTaxData 호출됨', async () => {
    const deps = makeDeps();
    await runMonthlySettlement(makeParams(), deps);
    assert.ok(deps._store.taxData !== null);
  });

  test('operatingCost 반영됨', async () => {
    const deps = makeDeps();
    await runMonthlySettlement(makeParams({ operatingCost: 2_100_000 }), deps);
    assert.equal(deps._store.revenueData.operatingCost, 2_100_000);
  });

  test('operatingProfit = totalNet - operatingCost', async () => {
    const deps = makeDeps();
    await runMonthlySettlement(makeParams({ operatingCost: 2_100_000 }), deps);
    const { totalNet, operatingCost, operatingProfit } = deps._store.revenueData;
    assert.equal(operatingProfit, totalNet - operatingCost);
  });
});

// ── runMonthlySettlement 에러 케이스 ────────────────────────

describe('TC-F-058: runMonthlySettlement — 에어비앤비 API 3회 실패', () => {
  test('status = failed (데이터 수집 못 하면)', async () => {
    const deps = makeDeps({
      fetchAirbnb: async () => { throw new Error('503 Service Unavailable'); },
    });
    const result = await runMonthlySettlement(makeParams(), deps);
    assert.equal(result.status, 'failed');
  });

  test('steps.dataCollected = false', async () => {
    const deps = makeDeps({
      fetchAirbnb: async () => { throw new Error('503'); },
    });
    const result = await runMonthlySettlement(makeParams(), deps);
    assert.equal(result.steps.dataCollected, false);
  });

  test('에러 알림 생성됨 (type: error)', async () => {
    const deps = makeDeps({
      fetchAirbnb: async () => { throw new Error('503'); },
    });
    await runMonthlySettlement(makeParams(), deps);
    const errAlert = deps._alerts.find(a => a.type === 'error');
    assert.ok(errAlert, 'error 알림 없음');
  });

  test('재시도 경고 알림 생성됨 (type: warn)', async () => {
    const deps = makeDeps({
      fetchAirbnb: async () => { throw new Error('503'); },
    });
    await runMonthlySettlement(makeParams(), deps);
    const warnAlerts = deps._alerts.filter(a => a.type === 'warn');
    assert.ok(warnAlerts.length >= 1, 'warn 알림 없음');
  });
});

describe('TC-F-059: runMonthlySettlement — params 누락', () => {
  test('params 없으면 throw', async () => {
    await assert.rejects(
      () => runMonthlySettlement(null, makeDeps()),
      /required/,
    );
  });

  test('deps 없으면 throw', async () => {
    await assert.rejects(
      () => runMonthlySettlement(makeParams(), null),
      /required/,
    );
  });
});

// ── fetchWithRetry ───────────────────────────────────────────

describe('TC-F-060: fetchWithRetry — 첫 번째 시도 성공', () => {
  test('데이터 반환됨', async () => {
    const result = await fetchWithRetry(
      async () => ({ value: 42 }),
      3,
      { platform: '에어비앤비', addAlert: () => {} },
    );
    assert.equal(result.value, 42);
  });

  test('알림 없음 (성공 시)', async () => {
    const alerts = [];
    await fetchWithRetry(
      async () => 'ok',
      3,
      { platform: '에어비앤비', addAlert: (a) => alerts.push(a) },
    );
    assert.equal(alerts.length, 0);
  });
});

describe('TC-F-061: fetchWithRetry — 1회 실패 후 성공', () => {
  test('최종적으로 데이터 반환됨', async () => {
    let attempts = 0;
    const result = await fetchWithRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error('일시 오류');
        return { ok: true };
      },
      3,
      { platform: '에어비앤비', addAlert: () => {} },
    );
    assert.equal(result.ok, true);
  });

  test('warn 알림 1개 생성됨', async () => {
    const alerts = [];
    let attempts = 0;
    await fetchWithRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error('오류');
        return 'ok';
      },
      3,
      { platform: '에어비앤비', addAlert: (a) => alerts.push(a) },
    );
    assert.equal(alerts.filter(a => a.type === 'warn').length, 1);
  });
});

describe('TC-F-062: fetchWithRetry — 3회 모두 실패', () => {
  test('throw 발생', async () => {
    await assert.rejects(
      () => fetchWithRetry(
        async () => { throw new Error('API 다운'); },
        3,
        { platform: '에어비앤비', addAlert: () => {} },
      ),
      /에어비앤비 API 실패/,
    );
  });

  test('error 알림 1개 생성됨', async () => {
    const alerts = [];
    try {
      await fetchWithRetry(
        async () => { throw new Error('API 다운'); },
        3,
        { platform: '에어비앤비', addAlert: (a) => alerts.push(a) },
      );
    } catch (_) {}
    assert.equal(alerts.filter(a => a.type === 'error').length, 1);
  });

  test('warn 알림 2개 생성됨 (attempt 1, 2)', async () => {
    const alerts = [];
    try {
      await fetchWithRetry(
        async () => { throw new Error('API 다운'); },
        3,
        { platform: '야놀자', addAlert: (a) => alerts.push(a) },
      );
    } catch (_) {}
    assert.equal(alerts.filter(a => a.type === 'warn').length, 2);
  });
});

// ── applyPricingRecommendations ──────────────────────────────

describe('TC-F-063: applyPricingRecommendations — 전체 적용 성공', () => {
  test('applied = 적용된 숙소 수', async () => {
    const deps = {
      updateAirbnbPricing:  async () => {},
      updateYanoljaPricing: async () => {},
      addAlert: () => {},
    };
    const result = await applyPricingRecommendations(
      ['P-042', 'P-043'],
      RECOMMENDATIONS,
      deps,
    );
    assert.equal(result.applied, 2);
    assert.equal(result.failed,  0);
  });

  test('알림 생성됨', async () => {
    const alerts = [];
    const deps = {
      updateAirbnbPricing:  async () => {},
      updateYanoljaPricing: async () => {},
      addAlert: (a) => alerts.push(a),
    };
    await applyPricingRecommendations(['P-042'], RECOMMENDATIONS, deps);
    assert.ok(alerts.some(a => a.msg.includes('가격') && a.msg.includes('완료')));
  });

  test('propIds에 없는 숙소는 제외됨', async () => {
    const applied_listings = [];
    const deps = {
      updateAirbnbPricing:  async (lst) => { applied_listings.push(...lst); },
      updateYanoljaPricing: async () => {},
      addAlert: () => {},
    };
    await applyPricingRecommendations(['P-042'], RECOMMENDATIONS, deps);
    assert.equal(applied_listings.length, 1);
    assert.equal(applied_listings[0].propId, 'P-042');
  });
});

describe('TC-F-064: applyPricingRecommendations — 가격 업데이트 실패', () => {
  test('에러 발생 시 error 알림 생성됨', async () => {
    const alerts = [];
    const deps = {
      updateAirbnbPricing:  async () => { throw new Error('API 오류'); },
      updateYanoljaPricing: async () => {},
      addAlert: (a) => alerts.push(a),
    };
    await applyPricingRecommendations(['P-042'], RECOMMENDATIONS, deps);
    assert.ok(alerts.some(a => a.type === 'error'));
  });

  test('failed 카운트 반환됨', async () => {
    const deps = {
      updateAirbnbPricing:  async () => { throw new Error('오류'); },
      updateYanoljaPricing: async () => {},
      addAlert: () => {},
    };
    const result = await applyPricingRecommendations(['P-042', 'P-043'], RECOMMENDATIONS, deps);
    assert.ok(result.failed > 0);
  });
});

describe('TC-F-065: applyPricingRecommendations — 에러 케이스', () => {
  test('propIds 없으면 에러', async () => {
    await assert.rejects(
      () => applyPricingRecommendations([], RECOMMENDATIONS, {}),
      /required/,
    );
  });

  test('recommendations 없으면 에러', async () => {
    await assert.rejects(
      () => applyPricingRecommendations(['P-042'], [], {}),
      /required/,
    );
  });
});
