/**
 * revenueDomain — 수익 정산 순수 도메인 함수
 * 외부 의존성 없음. 입력 → 출력만.
 */

/**
 * 플랫폼별 수익 합산 + 운영비 차감
 * @param {{ [platform: string]: { gross: number, platformFee: number, net: number } }} platforms
 * @param {number} [operatingCost=0]
 * @returns {{ totalGross, totalFee, totalNet, byPlatform, operatingCost, operatingProfit }}
 */
export function aggregateRevenue(platforms, operatingCost = 0) {
  if (!platforms || typeof platforms !== 'object' || Object.keys(platforms).length === 0) {
    throw new Error('platforms is required and must be non-empty');
  }
  if (typeof operatingCost !== 'number' || operatingCost < 0) {
    throw new Error('operatingCost must be a non-negative number');
  }

  let totalGross = 0;
  let totalFee   = 0;
  let totalNet   = 0;
  const byPlatform = {};

  for (const [platform, data] of Object.entries(platforms)) {
    if (typeof data.gross       !== 'number') throw new Error(`platforms.${platform}.gross must be a number`);
    if (typeof data.platformFee !== 'number') throw new Error(`platforms.${platform}.platformFee must be a number`);
    if (typeof data.net         !== 'number') throw new Error(`platforms.${platform}.net must be a number`);

    totalGross += data.gross;
    totalFee   += data.platformFee;
    totalNet   += data.net;
    byPlatform[platform] = { ...data };
  }

  const operatingProfit = totalNet - operatingCost;

  return { totalGross, totalFee, totalNet, byPlatform, operatingCost, operatingProfit };
}

/**
 * 세금 계산 (부가세 + 소득세 추정 + 공제 항목)
 * @param {{ totalGross: number, totalFee: number, operatingProfit: number }} revenueData
 * @returns {{ vat, incomeTaxEstimate, deductions, netAfterTax }}
 *
 * vat               = operatingProfit × 0.10
 * incomeTaxEstimate = operatingProfit × 0.15
 * deductions:
 *   - 플랫폼 수수료 = totalFee
 *   - 청소비        = totalGross × 3%
 *   - 유지보수비    = totalGross × 2%
 * netAfterTax = operatingProfit - vat
 */
export function calcTax(revenueData) {
  if (!revenueData) throw new Error('revenueData is required');
  if (typeof revenueData.operatingProfit !== 'number') throw new Error('revenueData.operatingProfit must be a number');
  if (typeof revenueData.totalGross      !== 'number') throw new Error('revenueData.totalGross must be a number');
  if (typeof revenueData.totalFee        !== 'number') throw new Error('revenueData.totalFee must be a number');

  const { operatingProfit, totalGross, totalFee } = revenueData;

  const vat               = Math.round(operatingProfit * 0.10);
  const incomeTaxEstimate = Math.round(operatingProfit * 0.15);
  const netAfterTax       = operatingProfit - vat;

  const cleaningCost     = Math.round(totalGross * 0.03);
  const maintenanceCost  = Math.round(totalGross * 0.02);

  const deductions = [
    { item: '플랫폼 수수료', amount: totalFee       },
    { item: '청소비',        amount: cleaningCost   },
    { item: '유지보수비',    amount: maintenanceCost },
  ];

  return { vat, incomeTaxEstimate, deductions, netAfterTax };
}

// ─── 성수기 배율 ────────────────────────────────────────────
const _TREND_MULTIPLIER = {
  spring_peak:  1.10,
  summer_peak:  1.15,
  off_season:   0.90,
  normal:       1.00,
};

/**
 * AI 가격 최적화 추천 생성
 * @param {Array<{ propId: string, occupancy: number, avgNightlyRate: number, competitorAvg: number }>} propDataList
 * @param {string} [marketTrend='normal']
 * @returns {{ recommendations, projectedRevenueIncrease, totalProjected }}
 */
export function getPricingRecommendations(propDataList, marketTrend = 'normal') {
  if (!propDataList || propDataList.length === 0) {
    throw new Error('propDataList is required and must be non-empty');
  }

  const multiplier = _TREND_MULTIPLIER[marketTrend] ?? 1.00;

  let totalCurrentRevenue   = 0;
  let totalProjectedRevenue = 0;

  const recommendations = propDataList.map(prop => {
    const { propId, occupancy, avgNightlyRate, competitorAvg } = prop;

    if (!propId)                         throw new Error('propId is required');
    if (typeof occupancy      !== 'number') throw new Error(`occupancy must be a number (${propId})`);
    if (typeof avgNightlyRate !== 'number') throw new Error(`avgNightlyRate must be a number (${propId})`);
    if (typeof competitorAvg  !== 'number') throw new Error(`competitorAvg must be a number (${propId})`);

    // 추천 요금 계산
    let suggestedRate;
    if (occupancy > 0.85) {
      suggestedRate = Math.round(competitorAvg * multiplier);
    } else if (occupancy > 0.70) {
      suggestedRate = Math.round(Math.max(avgNightlyRate, competitorAvg) * multiplier);
    } else {
      suggestedRate = Math.round(avgNightlyRate * multiplier);
    }

    // 신뢰도 계산
    let confidence = 0.60;
    if (occupancy > 0.85)                    confidence += 0.15;
    if (avgNightlyRate < competitorAvg)      confidence += 0.10;
    if (marketTrend !== 'normal')            confidence += 0.10;
    confidence = Math.min(confidence, 0.95); // 최대 0.95

    // 추천 이유
    const reasonParts = [];
    if (occupancy > 0.85)               reasonParts.push('높은 점유율');
    if (avgNightlyRate < competitorAvg) reasonParts.push('경쟁사 대비 저평가');
    if (marketTrend !== 'normal')       reasonParts.push(_trendLabel(marketTrend));
    const reason = reasonParts.length > 0 ? reasonParts.join(' + ') : '성수기 보정';

    totalCurrentRevenue   += avgNightlyRate;
    totalProjectedRevenue += suggestedRate;

    return { propId, currentRate: avgNightlyRate, suggestedRate, confidence, reason };
  });

  // 전체 예상 수익 증가율
  const increaseRatio = totalCurrentRevenue > 0
    ? (totalProjectedRevenue - totalCurrentRevenue) / totalCurrentRevenue
    : 0;
  const increasePercent = Math.round(increaseRatio * 100);
  const projectedRevenueIncrease = `+${increasePercent}%`;

  // totalProjected: 현재 총 수익에 증가율 적용 (목업 — 실제로는 예약 건수 × 제안가)
  const totalProjected = Math.round(totalProjectedRevenue);

  return { recommendations, projectedRevenueIncrease, totalProjected };
}

function _trendLabel(trend) {
  const map = { spring_peak: '봄 성수기', summer_peak: '여름 성수기', off_season: '비수기' };
  return map[trend] || trend;
}

// ─── 알림 텍스트 조립 함수들 ──────────────────────────────

/**
 * 정산 시작 알림 텍스트
 * @param {string} period    - 예: "3월"
 * @param {number} propCount
 * @returns {string}
 */
export function buildSettlementStartAlert(period, propCount) {
  if (!period)                         throw new Error('period is required');
  if (propCount == null)               throw new Error('propCount is required');
  if (typeof propCount !== 'number' || propCount < 0) throw new Error('propCount must be a non-negative number');

  return `${period} 수익 정산 시작 (${propCount}개 숙소)`;
}

/**
 * 수익 집계 완료 알림 텍스트
 * @param {number} totalGross
 * @param {number} propCount
 * @returns {string}
 */
export function buildRevenueCollectedAlert(totalGross, propCount) {
  if (totalGross == null)              throw new Error('totalGross is required');
  if (typeof totalGross !== 'number')  throw new Error('totalGross must be a number');
  if (propCount == null)               throw new Error('propCount is required');
  if (typeof propCount !== 'number' || propCount < 0) throw new Error('propCount must be a non-negative number');

  return `수익 데이터 수집 완료\n총 수익: ${_won(totalGross)} (${propCount}개 숙소)`;
}

/**
 * AI 가격 최적화 완료 알림 텍스트
 * @param {string} projectedIncrease - "+18%"
 * @param {number} totalProjected
 * @returns {string}
 */
export function buildPricingOptimizedAlert(projectedIncrease, totalProjected) {
  if (!projectedIncrease)              throw new Error('projectedIncrease is required');
  if (totalProjected == null)          throw new Error('totalProjected is required');
  if (typeof totalProjected !== 'number') throw new Error('totalProjected must be a number');

  return `AI 가격 최적화 완료\n예상 수익 향상: ${projectedIncrease} (${_won(totalProjected)})`;
}

/**
 * 세금 리포트 완료 알림 텍스트
 * @param {number} vat
 * @param {number} incomeTaxEstimate
 * @returns {string}
 */
export function buildTaxReportAlert(vat, incomeTaxEstimate) {
  if (vat == null)                     throw new Error('vat is required');
  if (typeof vat !== 'number')         throw new Error('vat must be a number');
  if (incomeTaxEstimate == null)       throw new Error('incomeTaxEstimate is required');
  if (typeof incomeTaxEstimate !== 'number') throw new Error('incomeTaxEstimate must be a number');

  return `세금 리포트 생성 완료\n(VAT: ${_won(vat)} / 소득세 추정: ${_won(incomeTaxEstimate)})`;
}

/**
 * 플랫폼 API 재시도 알림 텍스트
 * @param {string} platform
 * @param {number} attempt
 * @param {number} maxRetries
 * @returns {string}
 */
export function buildPlatformRetryAlert(platform, attempt, maxRetries) {
  if (!platform)                       throw new Error('platform is required');
  if (attempt == null)                 throw new Error('attempt is required');
  if (typeof attempt !== 'number' || attempt < 1) throw new Error('attempt must be a positive number');
  if (maxRetries == null)              throw new Error('maxRetries is required');
  if (typeof maxRetries !== 'number' || maxRetries < 1) throw new Error('maxRetries must be a positive number');

  return `${platform} API 응답 없음\n5분 후 재시도 예정 (${attempt}/${maxRetries})`;
}

// ─── 내부 헬퍼 ──────────────────────────────────────────────

function _won(n) {
  return n.toLocaleString('ko-KR') + '원';
}
