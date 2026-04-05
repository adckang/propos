# S05 모듈 경계 정의 (Boundary Document)

> 시나리오: 수익 정산 (월말 자동화) — 멀티플랫폼 통합 · AI 가격 최적화 · 세금 리포트
> 작성일: 2026-04-03

---

## UI Layer
> 표시 전용. 정산 결과와 가격 추천을 렌더링하고, 관리자 입력(가격 적용 승인)을 Application에 전달한다.

| 책임 | 모듈 |
|------|------|
| 정산 진행 단계 표시 (수집→AI분석→세금) | `S05RevenuePanel` > SettlementProgress |
| 플랫폼별 수익 요약 카드 (에어비앤비, 야놀자) | `S05RevenuePanel` > PlatformRevenueCard |
| 전체 수익 요약 (총매출, 수수료, 운영비, 영업이익) | `S05RevenuePanel` > RevenueSummaryCard |
| AI 가격 최적화 추천 목록 | `S05RevenuePanel` > PricingRecommendationList |
| 가격 적용 승인 버튼 이벤트 | `S05RevenuePanel` > ApplyPricingButton |
| 세금 리포트 요약 (VAT, 소득세, 공제 항목) | `S05RevenuePanel` > TaxReportCard |
| 알림 피드 (정산 진행 상황) | `S05RevenuePanel` > AlertFeed |
| API 재시도 상태 표시 | `S05RevenuePanel` > RetryStatusBadge |

**규칙:** 비즈니스 판단 없음. `revenueData`, `pricingData`, `taxData`, `alerts` 상태를 받아 렌더링만 한다.

---

## Application Layer
> 정산 오케스트레이션. 플랫폼 데이터 수집 → 수익 집계 → AI 가격 최적화 → 세금 리포트 순서 조율.

| 책임 | 모듈 |
|------|------|
| 월말 정산 전체 흐름 오케스트레이션 | `settlementService.runMonthlySettlement(params, deps)` |
| 가격 추천 선택 적용 (멀티플랫폼 업데이트) | `settlementService.applyPricingRecommendations(propIds, recommendations, deps)` |
| 플랫폼 API 재시도 래퍼 (최대 3회) | `settlementService.fetchWithRetry(fetchFn, maxRetries, deps)` |

**규칙:** 플랫폼 API 실패 시 최대 3회 재시도. 3회 후에도 실패 시 error 알림 후 부분 완료(partial) 반환.

---

## Business Logic Layer
> 도메인 규칙. 순수 함수. 외부 의존성 없음 → 단위 테스트 가능.

| 책임 | 모듈 | 핵심 규칙 |
|------|------|----------|
| 플랫폼별 수익 합산 | `revenueDomain.aggregateRevenue(platforms, operatingCost)` | gross/fee/net 합산, 운영비 차감, 영업이익 계산 |
| 세금 계산 | `revenueDomain.calcTax(revenueData)` | VAT=영업이익×10%, 소득세=영업이익×15%, 공제항목 반영 |
| AI 가격 최적화 추천 | `revenueDomain.getPricingRecommendations(propDataList, marketTrend)` | 점유율+경쟁사+성수기 패턴 기반 추천 |
| 정산 시작 알림 텍스트 | `revenueDomain.buildSettlementStartAlert(period, propCount)` | 순수 문자열 반환 |
| 수익 집계 완료 알림 텍스트 | `revenueDomain.buildRevenueCollectedAlert(totalGross, propCount)` | 순수 문자열 반환 |
| 가격 최적화 완료 알림 텍스트 | `revenueDomain.buildPricingOptimizedAlert(projectedIncrease, totalProjected)` | 순수 문자열 반환 |
| 세금 리포트 완료 알림 텍스트 | `revenueDomain.buildTaxReportAlert(vat, incomeTaxEstimate)` | 순수 문자열 반환 |
| 플랫폼 API 재시도 알림 텍스트 | `revenueDomain.buildPlatformRetryAlert(platform, attempt, maxRetries)` | 순수 문자열 반환 |

**규칙:** side effect 없음. 입력 → 출력만.

---

## Infrastructure Layer
> 외부 시스템 연동. 실패 시 throw — 재시도 판단은 Application이 담당.

| 책임 | 모듈 | 외부 시스템 |
|------|------|------------|
| 에어비앤비 예약 데이터 조회 | `platformClient.fetchAirbnb(period)` | Airbnb Host API (목업) |
| 야놀자 정산 데이터 조회 | `platformClient.fetchYanolja(period)` | Yanolja Partner API (목업) |
| 에어비앤비 가격 업데이트 | `platformClient.updateAirbnbPricing(listings)` | Airbnb Host API (목업) |
| 야놀자 가격 업데이트 | `platformClient.updateYanoljaPricing(properties)` | Yanolja Partner API (목업) |
| 수익 데이터 저장 | `revenueStore.setRevenueData(data)` | 인메모리 상태 (`useState`) |
| 가격 추천 데이터 저장 | `revenueStore.setPricingData(data)` | 인메모리 상태 (`useState`) |
| 세금 리포트 데이터 저장 | `revenueStore.setTaxData(data)` | 인메모리 상태 (`useState`) |
| 알림 피드 추가 | `alertStore.add(alert)` | 인메모리 상태 (`useState`) |

**규칙:** 플랫폼 API 호출 실패 시 throw. 재시도 최대 3회 (Application 담당).

---

## 의존 방향

```
UI (S05RevenuePanel)
 ↓ (props/callback만)
Application (settlementService)
 ↓                    ↓
Business Logic        Infrastructure
(revenueDomain)       (platformClient / revenueStore /
                       alertStore)
```

---

## 이벤트 흐름 요약

```
[월말 정산 자동화]
매월 1일 00:00 (cron 트리거) → UI
  → settlementService.runMonthlySettlement()
    → buildSettlementStartAlert()             [Business Logic]
    → alertStore.add("정산 시작")             [Infrastructure]
    → fetchWithRetry(fetchAirbnb)             [Application → Infrastructure]
    → fetchWithRetry(fetchYanolja)            [Application → Infrastructure]
    → revenueDomain.aggregateRevenue()        [Business Logic]
    → revenueStore.setRevenueData()           [Infrastructure]
    → buildRevenueCollectedAlert()            [Business Logic]
    → alertStore.add("수익 집계 완료")        [Infrastructure]
    → revenueDomain.getPricingRecommendations() [Business Logic]
    → revenueStore.setPricingData()           [Infrastructure]
    → buildPricingOptimizedAlert()            [Business Logic]
    → alertStore.add("AI 최적화 완료")       [Infrastructure]
    → revenueDomain.calcTax()                 [Business Logic]
    → revenueStore.setTaxData()               [Infrastructure]
    → buildTaxReportAlert()                   [Business Logic]
    → alertStore.add("세금 리포트 완료")      [Infrastructure]
  → S05Result

[가격 적용 승인]
  → settlementService.applyPricingRecommendations()
    → platformClient.updateAirbnbPricing()   [Infrastructure]
    → platformClient.updateYanoljaPricing()  [Infrastructure]
    → alertStore.add("가격 적용 완료")        [Infrastructure]

[플랫폼 API 오류]
  → fetchWithRetry()
    → 최대 3회 재시도 (5분 간격 시뮬)
    → buildPlatformRetryAlert()              [Business Logic]
    → alertStore.add(type:"warn")            [Infrastructure]
    → 3회 실패 시 alertStore.add(type:"error") [Infrastructure]
```

---

## S01~S04와 공유되는 인터페이스

| 인터페이스 | 공유 여부 |
|-----------|---------|
| `Alert` 타입 | ✅ 동일 |
| `alertStore.add()` | ✅ 동일 |
| `platformClient.fetchAirbnb()` | 🆕 S05 신규 |
| `platformClient.fetchYanolja()` | 🆕 S05 신규 |
| `PlatformRevenue` 타입 | 🆕 S05 신규 |
| `RevenueAggregate` 타입 | 🆕 S05 신규 |
| `PricingRecommendation` 타입 | 🆕 S05 신규 |
| `TaxReport` 타입 | 🆕 S05 신규 |

---

## 다음 단계
- [x] 인터페이스 정의 (s05-interface-definitions.md)
- [x] Business Logic 단위 테스트 작성 (`node:test`)
- [x] Infrastructure mock 구현
- [x] Application 통합 테스트
- [x] UI 컴포넌트 (S05RevenuePanel.jsx)
