'use strict';

/**
 * S05 도메인 단위 테스트 — 수익 정산
 * node --test tests/unit/s05.domain.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  aggregateRevenue,
  calcTax,
  getPricingRecommendations,
  buildSettlementStartAlert,
  buildRevenueCollectedAlert,
  buildPricingOptimizedAlert,
  buildTaxReportAlert,
  buildPlatformRetryAlert,
} = require('../../src/domain/revenueDomain.js');

// ============================================================
// 공통 픽스처
// ============================================================

function makePlatforms(overrides = {}) {
  return {
    airbnb:  { gross: 12_400_000, platformFee: 744_000,  net: 11_656_000, ...overrides.airbnb  },
    yanolja: { gross:  3_200_000, platformFee: 192_000,  net:  3_008_000, ...overrides.yanolja },
  };
}

function makePropDataList(overrides = []) {
  return [
    { propId: 'P-042', occupancy: 0.87, avgNightlyRate: 85_000, competitorAvg:  92_000 },
    { propId: 'P-043', occupancy: 0.75, avgNightlyRate: 70_000, competitorAvg:  75_000 },
    { propId: 'P-044', occupancy: 0.55, avgNightlyRate: 60_000, competitorAvg:  68_000 },
    ...overrides,
  ];
}

// ============================================================
// aggregateRevenue
// ============================================================
describe('revenueDomain.aggregateRevenue — 정상', () => {
  test('totalGross = 에어비앤비 + 야놀자 gross 합산', () => {
    const result = aggregateRevenue(makePlatforms());
    assert.equal(result.totalGross, 12_400_000 + 3_200_000);
  });

  test('totalFee = 플랫폼 수수료 합산', () => {
    const result = aggregateRevenue(makePlatforms());
    assert.equal(result.totalFee, 744_000 + 192_000);
  });

  test('totalNet = net 합산', () => {
    const result = aggregateRevenue(makePlatforms());
    assert.equal(result.totalNet, 11_656_000 + 3_008_000);
  });

  test('operatingCost 기본값 0', () => {
    const result = aggregateRevenue(makePlatforms());
    assert.equal(result.operatingCost, 0);
  });

  test('operatingProfit = totalNet - operatingCost', () => {
    const result = aggregateRevenue(makePlatforms(), 2_100_000);
    assert.equal(result.operatingProfit, (11_656_000 + 3_008_000) - 2_100_000);
  });

  test('byPlatform에 각 플랫폼 데이터 포함', () => {
    const result = aggregateRevenue(makePlatforms());
    assert.ok('airbnb'  in result.byPlatform);
    assert.ok('yanolja' in result.byPlatform);
    assert.equal(result.byPlatform.airbnb.gross,  12_400_000);
    assert.equal(result.byPlatform.yanolja.gross,  3_200_000);
  });

  test('단일 플랫폼도 정상 처리', () => {
    const result = aggregateRevenue({ airbnb: { gross: 5_000_000, platformFee: 300_000, net: 4_700_000 } });
    assert.equal(result.totalGross, 5_000_000);
    assert.equal(result.operatingProfit, 4_700_000);
  });

  test('운영비가 totalNet보다 크면 operatingProfit 음수 허용', () => {
    const result = aggregateRevenue(makePlatforms(), 99_999_999);
    assert.ok(result.operatingProfit < 0);
  });
});

describe('revenueDomain.aggregateRevenue — 에러', () => {
  test('platforms 없으면 에러', () => {
    assert.throws(() => aggregateRevenue(null), /required/);
  });

  test('platforms 빈 객체이면 에러', () => {
    assert.throws(() => aggregateRevenue({}), /required/);
  });

  test('operatingCost 음수이면 에러', () => {
    assert.throws(() => aggregateRevenue(makePlatforms(), -1), /non-negative/);
  });

  test('플랫폼 gross가 숫자 아니면 에러', () => {
    assert.throws(
      () => aggregateRevenue({ airbnb: { gross: '많음', platformFee: 0, net: 0 } }),
      /gross must be a number/,
    );
  });
});

// ============================================================
// calcTax
// ============================================================
describe('revenueDomain.calcTax — 정상', () => {
  function makeRevenue() {
    return { totalGross: 15_600_000, totalFee: 936_000, totalNet: 14_664_000, operatingProfit: 12_564_000 };
  }

  test('vat = operatingProfit × 10%', () => {
    const result = calcTax(makeRevenue());
    assert.equal(result.vat, Math.round(12_564_000 * 0.10));
  });

  test('incomeTaxEstimate = operatingProfit × 15%', () => {
    const result = calcTax(makeRevenue());
    assert.equal(result.incomeTaxEstimate, Math.round(12_564_000 * 0.15));
  });

  test('netAfterTax = operatingProfit - vat', () => {
    const result = calcTax(makeRevenue());
    const vat = Math.round(12_564_000 * 0.10);
    assert.equal(result.netAfterTax, 12_564_000 - vat);
  });

  test('deductions에 플랫폼 수수료 포함', () => {
    const result = calcTax(makeRevenue());
    const fee = result.deductions.find(d => d.item === '플랫폼 수수료');
    assert.ok(fee, '플랫폼 수수료 항목 없음');
    assert.equal(fee.amount, 936_000);
  });

  test('deductions에 청소비 포함 (totalGross × 3%)', () => {
    const result = calcTax(makeRevenue());
    const cleaning = result.deductions.find(d => d.item === '청소비');
    assert.ok(cleaning, '청소비 항목 없음');
    assert.equal(cleaning.amount, Math.round(15_600_000 * 0.03));
  });

  test('deductions에 유지보수비 포함 (totalGross × 2%)', () => {
    const result = calcTax(makeRevenue());
    const maintenance = result.deductions.find(d => d.item === '유지보수비');
    assert.ok(maintenance, '유지보수비 항목 없음');
    assert.equal(maintenance.amount, Math.round(15_600_000 * 0.02));
  });

  test('deductions 3개 항목', () => {
    const result = calcTax(makeRevenue());
    assert.equal(result.deductions.length, 3);
  });

  test('operatingProfit=0이면 vat=0, incomeTaxEstimate=0', () => {
    const result = calcTax({ totalGross: 0, totalFee: 0, totalNet: 0, operatingProfit: 0 });
    assert.equal(result.vat, 0);
    assert.equal(result.incomeTaxEstimate, 0);
  });
});

describe('revenueDomain.calcTax — 에러', () => {
  test('revenueData 없으면 에러', () => {
    assert.throws(() => calcTax(null), /required/);
  });

  test('operatingProfit 없으면 에러', () => {
    assert.throws(() => calcTax({ totalGross: 0, totalFee: 0, totalNet: 0 }), /operatingProfit must be a number/);
  });
});

// ============================================================
// getPricingRecommendations
// ============================================================
describe('revenueDomain.getPricingRecommendations — 정상', () => {
  test('각 숙소별 recommendation 반환', () => {
    const result = getPricingRecommendations(makePropDataList());
    assert.equal(result.recommendations.length, 3);
  });

  test('각 recommendation에 propId, currentRate, suggestedRate, confidence, reason 포함', () => {
    const result = getPricingRecommendations(makePropDataList());
    for (const r of result.recommendations) {
      assert.ok('propId'       in r);
      assert.ok('currentRate'  in r);
      assert.ok('suggestedRate' in r);
      assert.ok('confidence'   in r);
      assert.ok('reason'       in r);
    }
  });

  test('점유율 > 0.85 → suggestedRate = competitorAvg × trendMultiplier (normal=1)', () => {
    const result = getPricingRecommendations([
      { propId: 'P-042', occupancy: 0.87, avgNightlyRate: 85_000, competitorAvg: 92_000 },
    ], 'normal');
    const rec = result.recommendations[0];
    assert.equal(rec.suggestedRate, Math.round(92_000 * 1.0));
  });

  test('spring_peak trendMultiplier=1.10 적용', () => {
    const result = getPricingRecommendations([
      { propId: 'P-042', occupancy: 0.87, avgNightlyRate: 85_000, competitorAvg: 92_000 },
    ], 'spring_peak');
    const rec = result.recommendations[0];
    assert.equal(rec.suggestedRate, Math.round(92_000 * 1.10));
  });

  test('off_season trendMultiplier=0.90 적용', () => {
    const result = getPricingRecommendations([
      { propId: 'P-099', occupancy: 0.50, avgNightlyRate: 60_000, competitorAvg: 70_000 },
    ], 'off_season');
    const rec = result.recommendations[0];
    assert.equal(rec.suggestedRate, Math.round(60_000 * 0.90));
  });

  test('점유율 > 0.70 (but ≤ 0.85) → max(avgNightlyRate, competitorAvg) × multiplier', () => {
    const result = getPricingRecommendations([
      { propId: 'P-043', occupancy: 0.75, avgNightlyRate: 70_000, competitorAvg: 75_000 },
    ], 'normal');
    const rec = result.recommendations[0];
    assert.equal(rec.suggestedRate, Math.round(Math.max(70_000, 75_000) * 1.0));
  });

  test('confidence 0.0~0.95 범위', () => {
    const result = getPricingRecommendations(makePropDataList(), 'spring_peak');
    for (const r of result.recommendations) {
      assert.ok(r.confidence >= 0.0 && r.confidence <= 0.95, `confidence 범위 초과: ${r.confidence}`);
    }
  });

  test('점유율 0.85 초과 + 저평가 + 성수기 → confidence 최대치(0.95)', () => {
    const result = getPricingRecommendations([
      { propId: 'P-042', occupancy: 0.87, avgNightlyRate: 85_000, competitorAvg: 92_000 },
    ], 'spring_peak');
    // 0.60 + 0.15 + 0.10 + 0.10 = 0.95
    assert.equal(result.recommendations[0].confidence, 0.95);
  });

  test('projectedRevenueIncrease 형식 "+N%"', () => {
    const result = getPricingRecommendations(makePropDataList(), 'spring_peak');
    assert.ok(/^\+\d+%$/.test(result.projectedRevenueIncrease), `형식 불일치: ${result.projectedRevenueIncrease}`);
  });

  test('totalProjected 숫자 반환', () => {
    const result = getPricingRecommendations(makePropDataList());
    assert.equal(typeof result.totalProjected, 'number');
    assert.ok(result.totalProjected > 0);
  });

  test('reason 문자열 반환', () => {
    const result = getPricingRecommendations(makePropDataList());
    for (const r of result.recommendations) {
      assert.equal(typeof r.reason, 'string');
      assert.ok(r.reason.length > 0);
    }
  });
});

describe('revenueDomain.getPricingRecommendations — 에러', () => {
  test('propDataList 없으면 에러', () => {
    assert.throws(() => getPricingRecommendations(null), /required/);
  });

  test('propDataList 빈 배열이면 에러', () => {
    assert.throws(() => getPricingRecommendations([]), /required/);
  });

  test('propId 없으면 에러', () => {
    assert.throws(
      () => getPricingRecommendations([{ propId: '', occupancy: 0.9, avgNightlyRate: 80_000, competitorAvg: 90_000 }]),
      /required/,
    );
  });

  test('occupancy 숫자 아니면 에러', () => {
    assert.throws(
      () => getPricingRecommendations([{ propId: 'P-001', occupancy: '높음', avgNightlyRate: 80_000, competitorAvg: 90_000 }]),
      /occupancy must be a number/,
    );
  });
});

// ============================================================
// buildSettlementStartAlert
// ============================================================
describe('revenueDomain.buildSettlementStartAlert', () => {
  test('period + propCount 포함', () => {
    const msg = buildSettlementStartAlert('3월', 48);
    assert.ok(msg.includes('3월'));
    assert.ok(msg.includes('48'));
  });

  test('문자열 반환', () => {
    assert.equal(typeof buildSettlementStartAlert('3월', 48), 'string');
  });

  test('period 없으면 에러', () => {
    assert.throws(() => buildSettlementStartAlert('', 48), /required/);
  });

  test('propCount 없으면 에러', () => {
    assert.throws(() => buildSettlementStartAlert('3월', null), /required/);
  });

  test('propCount 음수이면 에러', () => {
    assert.throws(() => buildSettlementStartAlert('3월', -1), /non-negative/);
  });
});

// ============================================================
// buildRevenueCollectedAlert
// ============================================================
describe('revenueDomain.buildRevenueCollectedAlert', () => {
  test('totalGross + propCount 포함', () => {
    const msg = buildRevenueCollectedAlert(15_600_000, 48);
    assert.ok(msg.includes('48'));
    assert.ok(msg.includes('원'));
  });

  test('문자열 반환', () => {
    assert.equal(typeof buildRevenueCollectedAlert(15_600_000, 48), 'string');
  });

  test('totalGross 없으면 에러', () => {
    assert.throws(() => buildRevenueCollectedAlert(null, 48), /required/);
  });

  test('totalGross 숫자 아니면 에러', () => {
    assert.throws(() => buildRevenueCollectedAlert('많음', 48), /must be a number/);
  });
});

// ============================================================
// buildPricingOptimizedAlert
// ============================================================
describe('revenueDomain.buildPricingOptimizedAlert', () => {
  test('projectedIncrease + totalProjected 포함', () => {
    const msg = buildPricingOptimizedAlert('+18%', 18_408_000);
    assert.ok(msg.includes('+18%'));
    assert.ok(msg.includes('원'));
  });

  test('문자열 반환', () => {
    assert.equal(typeof buildPricingOptimizedAlert('+18%', 18_408_000), 'string');
  });

  test('projectedIncrease 없으면 에러', () => {
    assert.throws(() => buildPricingOptimizedAlert('', 18_408_000), /required/);
  });

  test('totalProjected 숫자 아니면 에러', () => {
    assert.throws(() => buildPricingOptimizedAlert('+18%', '많음'), /must be a number/);
  });
});

// ============================================================
// buildTaxReportAlert
// ============================================================
describe('revenueDomain.buildTaxReportAlert', () => {
  test('VAT + 소득세 포함', () => {
    const msg = buildTaxReportAlert(1_256_400, 1_884_600);
    assert.ok(msg.includes('VAT'));
    assert.ok(msg.includes('소득세'));
    assert.ok(msg.includes('원'));
  });

  test('문자열 반환', () => {
    assert.equal(typeof buildTaxReportAlert(1_256_400, 1_884_600), 'string');
  });

  test('vat 없으면 에러', () => {
    assert.throws(() => buildTaxReportAlert(null, 1_884_600), /required/);
  });

  test('incomeTaxEstimate 없으면 에러', () => {
    assert.throws(() => buildTaxReportAlert(1_256_400, null), /required/);
  });
});

// ============================================================
// buildPlatformRetryAlert
// ============================================================
describe('revenueDomain.buildPlatformRetryAlert', () => {
  test('platform + attempt/maxRetries 포함', () => {
    const msg = buildPlatformRetryAlert('에어비앤비', 1, 3);
    assert.ok(msg.includes('에어비앤비'));
    assert.ok(msg.includes('1/3'));
  });

  test('문자열 반환', () => {
    assert.equal(typeof buildPlatformRetryAlert('에어비앤비', 1, 3), 'string');
  });

  test('platform 없으면 에러', () => {
    assert.throws(() => buildPlatformRetryAlert('', 1, 3), /required/);
  });

  test('attempt 없으면 에러', () => {
    assert.throws(() => buildPlatformRetryAlert('에어비앤비', null, 3), /required/);
  });

  test('attempt 0 이하이면 에러', () => {
    assert.throws(() => buildPlatformRetryAlert('에어비앤비', 0, 3), /positive/);
  });

  test('maxRetries 없으면 에러', () => {
    assert.throws(() => buildPlatformRetryAlert('에어비앤비', 1, null), /required/);
  });

  test('야놀자 플랫폼 명시', () => {
    const msg = buildPlatformRetryAlert('야놀자', 2, 3);
    assert.ok(msg.includes('야놀자'));
    assert.ok(msg.includes('2/3'));
  });
});
