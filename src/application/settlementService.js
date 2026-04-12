import {
  aggregateRevenue,
  calcTax,
  getPricingRecommendations,
  buildSettlementStartAlert,
  buildRevenueCollectedAlert,
  buildPricingOptimizedAlert,
  buildTaxReportAlert,
  buildPlatformRetryAlert,
} from "../domain/revenueDomain.js";

/**
 * 월말 정산 전체 흐름 오케스트레이션
 *
 * 오케스트레이션 순서:
 *   1.  buildSettlementStartAlert()   → addAlert (정산 시작)
 *   2.  fetchWithRetry(fetchAirbnb)   → airbnbData
 *   3.  fetchWithRetry(fetchYanolja)  → yanoljaData
 *   4.  aggregateRevenue()            → revenueData
 *   5.  setRevenueData(revenueData)
 *   6.  buildRevenueCollectedAlert()  → addAlert
 *   7.  getPricingRecommendations()   → pricingData
 *   8.  setPricingData(pricingData)
 *   9.  buildPricingOptimizedAlert()  → addAlert
 *  10.  calcTax(revenueData)          → taxData
 *  11.  setTaxData(taxData)
 *  12.  buildTaxReportAlert()         → addAlert
 *  → S05Result 반환
 *
 * @param {{ year: number, month: number, propCount: number, operatingCost?: number, marketTrend?: string }} params
 * @param {Object}   deps
 * @param {Function} deps.fetchAirbnb     - async (period: string) => PlatformRevenue
 * @param {Function} deps.fetchYanolja    - async (period: string) => PlatformRevenue
 * @param {Function} deps.getPropDataList - () => PropPricingData[]
 * @param {Function} deps.setRevenueData  - (data) => void
 * @param {Function} deps.setPricingData  - (data) => void
 * @param {Function} deps.setTaxData      - (data) => void
 * @param {Function} deps.addAlert        - (alert) => void
 * @returns {Promise<{ status, steps, revenueData, pricingData, taxData, error }>}
 */
export async function runMonthlySettlement(params, deps) {
  if (!params) throw new Error('params is required');
  if (!deps)   throw new Error('deps is required');

  const { year, month, propCount = 0, operatingCost = 0, marketTrend = 'normal' } = params;
  const period = `${month}월`;

  const steps = { dataCollected: false, pricingOptimized: false, taxReported: false };
  let revenueData = null;
  let pricingData = null;
  let taxData     = null;

  // Step 1: 정산 시작 알림
  const startMsg = buildSettlementStartAlert(period, propCount);
  deps.addAlert({ type: 'info', prop: 'SYSTEM', msg: startMsg, time: _nowHHMM() });

  try {
    // Step 2~3: 플랫폼 데이터 수집
    const [airbnbData, yanoljaData] = await Promise.all([
      fetchWithRetry(deps.fetchAirbnb,  3, { platform: '에어비앤비', addAlert: deps.addAlert }),
      fetchWithRetry(deps.fetchYanolja, 3, { platform: '야놀자',     addAlert: deps.addAlert }),
    ]);

    // Step 4: 수익 집계
    revenueData = aggregateRevenue(
      { airbnb: airbnbData, yanolja: yanoljaData },
      operatingCost,
    );

    // Step 5~6
    deps.setRevenueData(revenueData);
    steps.dataCollected = true;
    const revenueMsg = buildRevenueCollectedAlert(revenueData.totalGross, propCount);
    deps.addAlert({ type: 'info', prop: 'SYSTEM', msg: revenueMsg, time: _nowHHMM() });

    // Step 7~9: AI 가격 최적화
    const propDataList = deps.getPropDataList();
    pricingData = getPricingRecommendations(propDataList, marketTrend);
    deps.setPricingData(pricingData);
    steps.pricingOptimized = true;
    const pricingMsg = buildPricingOptimizedAlert(
      pricingData.projectedRevenueIncrease,
      pricingData.totalProjected,
    );
    deps.addAlert({ type: 'info', prop: 'SYSTEM', msg: pricingMsg, time: _nowHHMM() });

    // Step 10~12: 세금 리포트
    taxData = calcTax(revenueData);
    deps.setTaxData(taxData);
    steps.taxReported = true;
    const taxMsg = buildTaxReportAlert(taxData.vat, taxData.incomeTaxEstimate);
    deps.addAlert({ type: 'info', prop: 'SYSTEM', msg: taxMsg, time: _nowHHMM() });

    return { status: 'success', steps, revenueData, pricingData, taxData, error: null };

  } catch (err) {
    deps.addAlert({
      type: 'error',
      prop: 'SYSTEM',
      msg:  `정산 오류: ${err.message}`,
      time: _nowHHMM(),
    });

    const allDone = steps.dataCollected && steps.pricingOptimized && steps.taxReported;
    const noneDone = !steps.dataCollected && !steps.pricingOptimized && !steps.taxReported;

    return {
      status: noneDone ? 'failed' : 'partial',
      steps,
      revenueData,
      pricingData,
      taxData,
      error: err.message,
    };
  }
}

/**
 * 가격 추천 적용 (선택된 숙소에 한해 플랫폼 가격 업데이트)
 *
 * @param {string[]}               propIds         - 적용 대상 숙소 ID 목록
 * @param {PricingRecommendation[]} recommendations
 * @param {Object}   deps
 * @param {Function} deps.updateAirbnbPricing   - async (listings) => void
 * @param {Function} deps.updateYanoljaPricing  - async (properties) => void
 * @param {Function} deps.addAlert              - (alert) => void
 * @returns {Promise<{ applied: number, failed: number }>}
 */
export async function applyPricingRecommendations(propIds, recommendations, deps) {
  if (!propIds || propIds.length === 0) throw new Error('propIds is required');
  if (!recommendations || recommendations.length === 0) throw new Error('recommendations is required');

  // 적용 대상 필터링
  const targets = recommendations.filter(r => propIds.includes(r.propId));
  const listings = targets.map(r => ({ propId: r.propId, suggestedRate: r.suggestedRate }));

  let applied = 0;
  let failed  = 0;

  try {
    await deps.updateAirbnbPricing(listings);
    await deps.updateYanoljaPricing(listings);
    applied = targets.length;
    deps.addAlert({
      type: 'info',
      prop: 'SYSTEM',
      msg:  `AI 가격 최적화 적용 완료 (${applied}개 숙소)`,
      time: _nowHHMM(),
    });
  } catch (err) {
    failed = targets.length;
    deps.addAlert({
      type: 'error',
      prop: 'SYSTEM',
      msg:  `가격 업데이트 오류: ${err.message}`,
      time: _nowHHMM(),
    });
  }

  return { applied, failed };
}

/**
 * 플랫폼 API 재시도 래퍼 (최대 maxRetries회)
 *
 * @param {Function} fetchFn     - async () => data
 * @param {number}   maxRetries  - 최대 재시도 횟수 (기본 3)
 * @param {Object}   deps
 * @param {string}   deps.platform  - 플랫폼 이름 (알림용)
 * @param {Function} deps.addAlert  - (alert) => void
 * @returns {Promise<data>}
 * @throws {Error} maxRetries 초과 시
 */
export async function fetchWithRetry(fetchFn, maxRetries = 3, deps) {
  if (!fetchFn)   throw new Error('fetchFn is required');
  if (!deps)      throw new Error('deps is required');
  if (!deps.platform) throw new Error('deps.platform is required');

  let lastErr;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFn();
    } catch (err) {
      lastErr = err;

      if (attempt < maxRetries) {
        // 재시도 경고 알림
        const retryMsg = buildPlatformRetryAlert(deps.platform, attempt, maxRetries);
        deps.addAlert({ type: 'warn', prop: 'SYSTEM', msg: retryMsg, time: _nowHHMM() });
      } else {
        // 최대 재시도 초과 → 에러 알림
        deps.addAlert({
          type: 'error',
          prop: 'SYSTEM',
          msg:  `${deps.platform} API ${maxRetries}회 시도 실패 — 수동 처리 필요`,
          time: _nowHHMM(),
        });
      }
    }
  }

  throw new Error(`${deps.platform} API 실패 (${maxRetries}회 시도): ${lastErr?.message}`);
}

function _nowHHMM() {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' +
         d.getMinutes().toString().padStart(2, '0');
}

export default { runMonthlySettlement, applyPricingRecommendations, fetchWithRetry };
