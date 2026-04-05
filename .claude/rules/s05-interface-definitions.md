# S05 모듈 인터페이스 정의

> 레이어별 함수 시그니처 + 입출력 타입 정의
> 프로젝트 환경: 순수 JS (Babel standalone) — TypeScript 없음 → JSDoc 스타일로 표기
> 작성일: 2026-04-04

---

## 공통 타입

```js
// S01~S04에서 재사용: Alert

/**
 * @typedef {Object} PlatformRevenue
 * @property {string} platform        - "airbnb" | "yanolja"
 * @property {number} gross           - 총 매출
 * @property {number} platformFee     - 플랫폼 수수료
 * @property {number} net             - 순수익 (gross - platformFee)
 */

/**
 * @typedef {Object} RevenueAggregate
 * @property {number} totalGross      - 전체 총 매출 합산
 * @property {number} totalFee        - 전체 플랫폼 수수료 합산
 * @property {number} totalNet        - 전체 순수익 합산
 * @property {Object} byPlatform      - { [platform]: PlatformRevenue }
 * @property {number} operatingCost   - 운영비 (청소비 + 유지보수비 등)
 * @property {number} operatingProfit - 영업이익 (totalNet - operatingCost)
 */

/**
 * @typedef {Object} TaxDeduction
 * @property {string} item            - 공제 항목명 (예: "플랫폼 수수료")
 * @property {number} amount          - 공제 금액
 */

/**
 * @typedef {Object} TaxReport
 * @property {number} vat             - 부가세 (operatingProfit × 10%)
 * @property {number} incomeTaxEstimate - 소득세 추정 (operatingProfit × 15%)
 * @property {TaxDeduction[]} deductions
 * @property {number} netAfterTax     - 실수령액 (operatingProfit - vat)
 */

/**
 * @typedef {Object} PropPricingData
 * @property {string} propId
 * @property {number} occupancy       - 0.0 ~ 1.0
 * @property {number} avgNightlyRate  - 현재 평균 1박 요금
 * @property {number} competitorAvg   - 경쟁사 평균 1박 요금
 */

/**
 * @typedef {Object} PricingRecommendation
 * @property {string} propId
 * @property {number} currentRate
 * @property {number} suggestedRate
 * @property {number} confidence      - 0.0 ~ 1.0
 * @property {string} reason          - 추천 이유 텍스트
 */

/**
 * @typedef {Object} PricingResult
 * @property {PricingRecommendation[]} recommendations
 * @property {string} projectedRevenueIncrease - 예: "+18%"
 * @property {number} totalProjected           - 예상 총 수익
 */

/**
 * @typedef {Object} S05Result
 * @property {"success"|"partial"|"failed"} status
 * @property {{ dataCollected: boolean, pricingOptimized: boolean, taxReported: boolean }} steps
 * @property {RevenueAggregate|null} revenueData
 * @property {PricingResult|null}    pricingData
 * @property {TaxReport|null}        taxData
 * @property {string|null}           error
 */
```

---

## Business Logic Layer

> 순수 함수. 외부 의존성 없음. 단위 테스트 대상.

```js
// --- revenueDomain ---

/**
 * 플랫폼별 수익 합산 + 운영비 차감
 * @param {{ [platform: string]: PlatformRevenue }} platforms
 * @param {number} [operatingCost=0]
 * @returns {RevenueAggregate}
 * @throws {Error} platforms 없거나 빈 객체이면 에러
 *
 * 계산 규칙:
 *   totalGross = sum(platform.gross)
 *   totalFee   = sum(platform.platformFee)
 *   totalNet   = sum(platform.net)
 *   operatingProfit = totalNet - operatingCost
 */
function aggregateRevenue(platforms, operatingCost) {}

/**
 * 세금 계산 (부가세 + 소득세 추정 + 공제 항목)
 * @param {RevenueAggregate} revenueData
 * @returns {TaxReport}
 * @throws {Error} revenueData 없으면 에러
 *
 * 계산 규칙:
 *   vat                = operatingProfit × 0.10
 *   incomeTaxEstimate  = operatingProfit × 0.15
 *   deductions         = [플랫폼 수수료, 청소비(totalGross×3%), 유지보수비(totalGross×2%)]
 *   netAfterTax        = operatingProfit - vat
 */
function calcTax(revenueData) {}

/**
 * AI 가격 최적화 추천 생성 (점유율 + 경쟁사 + 성수기 기반)
 * @param {PropPricingData[]} propDataList
 * @param {string} [marketTrend="normal"]  - "spring_peak"|"summer_peak"|"off_season"|"normal"
 * @returns {PricingResult}
 * @throws {Error} propDataList 없거나 빈 배열이면 에러
 *
 * 추천 규칙:
 *   trendMultiplier: spring_peak=1.10, summer_peak=1.15, off_season=0.90, normal=1.00
 *   suggestedRate:
 *     occupancy > 0.85 → competitorAvg * trendMultiplier (수요 높음, 가격 올릴 여지)
 *     occupancy > 0.70 → max(avgNightlyRate, competitorAvg) * trendMultiplier
 *     else             → avgNightlyRate * trendMultiplier (성수기 보정만)
 *   confidence:
 *     0.60 기본
 *     + 0.15 (occupancy > 0.85)
 *     + 0.10 (avgNightlyRate < competitorAvg, 저평가 신호)
 *     + 0.10 (marketTrend !== "normal")
 *   projectedRevenueIncrease: 전체 suggestedRate/currentRate 평균 증가율 → "+N%"
 */
function getPricingRecommendations(propDataList, marketTrend) {}

/**
 * 정산 시작 알림 텍스트 (순수 문자열 반환)
 * @param {string} period   - 예: "3월" | "2026-03"
 * @param {number} propCount
 * @returns {string}  예: "3월 수익 정산 시작 (48개 숙소)"
 */
function buildSettlementStartAlert(period, propCount) {}

/**
 * 수익 집계 완료 알림 텍스트 (순수 문자열 반환)
 * @param {number} totalGross
 * @param {number} propCount
 * @returns {string}
 * 예: "수익 데이터 수집 완료\n총 수익: 15,600,000원 (48개 숙소)"
 */
function buildRevenueCollectedAlert(totalGross, propCount) {}

/**
 * AI 가격 최적화 완료 알림 텍스트 (순수 문자열 반환)
 * @param {string} projectedIncrease - "+18%"
 * @param {number} totalProjected
 * @returns {string}
 * 예: "AI 가격 최적화 완료\n예상 수익 향상: +18% (18,408,000원)"
 */
function buildPricingOptimizedAlert(projectedIncrease, totalProjected) {}

/**
 * 세금 리포트 완료 알림 텍스트 (순수 문자열 반환)
 * @param {number} vat
 * @param {number} incomeTaxEstimate
 * @returns {string}
 * 예: "세금 리포트 생성 완료\n(VAT: 1,256,400원 / 소득세 추정: 1,884,600원)"
 */
function buildTaxReportAlert(vat, incomeTaxEstimate) {}

/**
 * 플랫폼 API 재시도 알림 텍스트 (순수 문자열 반환)
 * @param {string} platform   - "에어비앤비" | "야놀자"
 * @param {number} attempt    - 현재 시도 횟수 (1-based)
 * @param {number} maxRetries - 최대 재시도 횟수
 * @returns {string}
 * 예: "에어비앤비 API 응답 없음\n5분 후 재시도 예정 (1/3)"
 */
function buildPlatformRetryAlert(platform, attempt, maxRetries) {}
```

---

## Application Layer

```js
/**
 * 월말 정산 전체 흐름 오케스트레이션
 *
 * 오케스트레이션 순서:
 *   1. buildSettlementStartAlert() → addAlert
 *   2. fetchWithRetry(fetchAirbnb)  → airbnbData
 *   3. fetchWithRetry(fetchYanolja) → yanoljaData
 *   4. aggregateRevenue()           → revenueData
 *   5. setRevenueData(revenueData)
 *   6. buildRevenueCollectedAlert() → addAlert
 *   7. getPricingRecommendations()  → pricingData
 *   8. setPricingData(pricingData)
 *   9. buildPricingOptimizedAlert() → addAlert
 *  10. calcTax(revenueData)         → taxData
 *  11. setTaxData(taxData)
 *  12. buildTaxReportAlert()        → addAlert
 *  → S05Result 반환
 *
 * @param {{ year: number, month: number, propCount: number, operatingCost?: number, marketTrend?: string }} params
 * @param {Object}   deps
 * @param {Function} deps.fetchAirbnb       - async (period) => PlatformRevenue
 * @param {Function} deps.fetchYanolja      - async (period) => PlatformRevenue
 * @param {Function} deps.getPropDataList   - () => PropPricingData[]
 * @param {Function} deps.setRevenueData    - (RevenueAggregate) => void
 * @param {Function} deps.setPricingData    - (PricingResult) => void
 * @param {Function} deps.setTaxData        - (TaxReport) => void
 * @param {Function} deps.addAlert          - (Alert) => void
 * @returns {Promise<S05Result>}
 */
async function runMonthlySettlement(params, deps) {}

/**
 * 가격 추천 적용 (선택된 숙소에 한해 플랫폼 가격 업데이트)
 *
 * @param {string[]}               propIds        - 적용 대상 숙소 ID 목록
 * @param {PricingRecommendation[]} recommendations
 * @param {Object}   deps
 * @param {Function} deps.updateAirbnbPricing  - async (listings) => void
 * @param {Function} deps.updateYanoljaPricing - async (properties) => void
 * @param {Function} deps.addAlert             - (Alert) => void
 * @returns {Promise<{ applied: number, failed: number }>}
 */
async function applyPricingRecommendations(propIds, recommendations, deps) {}

/**
 * 플랫폼 API 재시도 래퍼
 *
 * @param {Function} fetchFn     - async () => data
 * @param {number}   maxRetries  - 최대 재시도 횟수 (기본 3)
 * @param {Object}   deps
 * @param {string}   deps.platform  - "에어비앤비" | "야놀자" (알림용)
 * @param {Function} deps.addAlert  - (Alert) => void
 * @returns {Promise<data>}
 * @throws {Error} maxRetries 초과 시
 */
async function fetchWithRetry(fetchFn, maxRetries, deps) {}
```

---

## Infrastructure Layer

```js
// --- platformClient ---

/**
 * 에어비앤비 예약 데이터 조회 (목업)
 * @param {string} period  - "2026-03"
 * @returns {Promise<PlatformRevenue>}
 * @throws {Error} API 오류 시
 */
async function fetchAirbnb(period) {}

/**
 * 야놀자 정산 데이터 조회 (목업)
 * @param {string} period  - "2026-03"
 * @returns {Promise<PlatformRevenue>}
 * @throws {Error} API 오류 시
 */
async function fetchYanolja(period) {}

/**
 * 에어비앤비 가격 업데이트 (목업)
 * @param {{ propId: string, suggestedRate: number }[]} listings
 * @returns {Promise<void>}
 */
async function updateAirbnbPricing(listings) {}

/**
 * 야놀자 가격 업데이트 (목업)
 * @param {{ propId: string, suggestedRate: number }[]} properties
 * @returns {Promise<void>}
 */
async function updateYanoljaPricing(properties) {}


// --- revenueStore ---

/** @param {RevenueAggregate} data */
function setRevenueData(data) {}

/** @param {PricingResult} data */
function setPricingData(data) {}

/** @param {TaxReport} data */
function setTaxData(data) {}


// --- alertStore (S01~S04와 동일) ---
// add(alert): void
```
