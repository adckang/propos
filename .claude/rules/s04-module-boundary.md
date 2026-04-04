# S04 모듈 경계 정의 (Boundary Document)

> 시나리오: 체크아웃 & 청소 (퇴실 감지) — PIN 만료 · 청소팀 자동 배정 · 체크리스트 생성
> 작성일: 2026-04-03

---

## UI Layer
> 표시 전용. 이벤트 수신 결과를 렌더링하고, 관리자 입력(청소 완료 확인)을 Application에 전달한다.

| 책임 | 모듈 |
|------|------|
| 체크아웃 이벤트 시뮬레이터 (테스트용) | `S04CheckoutPanel` > 헤더 컨트롤 |
| 숙소 상태 뱃지 ("청소중" 노란색) | `S04CheckoutPanel` > PropStatusBadge |
| PIN 만료 타이머 표시 (5초 카운트다운) | `S04CheckoutPanel` > PinExpireCountdown |
| 청소팀 배정 카드 (담당자 + 예상 도착시각) | `S04CheckoutPanel` > CleanerAssignCard |
| 청소 체크리스트 (항목별 완료 체크) | `S04CheckoutPanel` > CleaningChecklist |
| 알림 피드 (체크아웃 완료, PIN 만료, 청소 배정) | `S04CheckoutPanel` > AlertFeed |
| Mock/HA 모드 전환 토글 | `S04CheckoutPanel` > 헤더 컨트롤 |

**규칙:** 비즈니스 판단 없음. `propStatus`, `cleanerAssignment`, `checklistItems`, `alerts` 상태를 받아 렌더링만 한다.

---

## Application Layer
> 유즈케이스 흐름 오케스트레이션. 이벤트 수신 → PIN 만료 → 청소팀 배정 → 체크리스트 생성 순서 조율.

| 책임 | 모듈 |
|------|------|
| 퇴실 이벤트 수신 → 체크아웃 판별 → PIN 만료 → 청소팀 배정 | `checkoutService.handleCheckout(event, deps)` |
| 청소팀 배정 완료 알림 생성 | `checkoutService.handleCheckout` 내부 |
| 청소 체크리스트 항목 완료 처리 | `checkoutService.completeChecklistItem(propId, itemId, deps)` |
| 전체 청소 완료 확인 → 숙소 상태 갱신 | `checkoutService.finalizeClean(propId, deps)` |

**규칙:** 각 단계 실패 시 throw를 catch해 alertStore에 에러 알림 추가. PIN 만료는 5초 타이머로 처리.

---

## Business Logic Layer
> 도메인 규칙. 순수 함수. 외부 의존성 없음 → 단위 테스트 가능.

| 책임 | 모듈 | 핵심 규칙 |
|------|------|----------|
| 퇴실 이벤트 유효성 판별 | `checkoutDomain.isCheckoutEvent(event, booking)` | `event.event === "door_locked"` + 체크아웃 가능 시간창 내 |
| 체크아웃 가능 시간창 계산 | `checkoutDomain.getCheckoutWindow(checkOut)` | checkOut 기준 -2시간 ~ +3시간 |
| PIN 만료 처리 (즉시) | `checkoutDomain.buildPinExpireRecord(pinRecord)` | validUntil = 지금 (즉시 만료) |
| 청소팀 자동 배정 | `checkoutDomain.assignCleaner(cleaners, propId, checkoutTime)` | 가용 청소팀 중 부하 최소 배정 |
| 청소 체크리스트 생성 | `checkoutDomain.buildChecklist(propId)` | 표준 체크리스트 항목 반환 |
| 체크아웃 완료 알림 텍스트 | `checkoutDomain.buildCheckoutAlert(propId, guestName)` | 순수 문자열 반환 |
| 청소 배정 알림 텍스트 | `checkoutDomain.buildCleanerAssignAlert(propId, cleaner)` | 순수 문자열 반환 |

**규칙:** side effect 없음. 입력 → 출력만.

---

## Infrastructure Layer
> 외부 시스템 연동. 실패 시 throw — 재시도 판단은 Application이 담당.

| 책임 | 모듈 | 외부 시스템 |
|------|------|------------|
| 도어락 PIN 즉시 만료 | `haClient.expirePin(entityId)` | HA REST API (`POST /api/services/lock/clear_code`) |
| 숙소 상태 업데이트 | `propStore.updateStatus(propId, status)` | 인메모리 상태 (`useState`) |
| 알림 피드 추가 | `alertStore.add(alert)` | 인메모리 상태 (`useState`) |
| 청소 배정 상태 저장 | `cleanStore.setAssignment(propId, assignment)` | 인메모리 상태 (`useState`) |
| 청소 체크리스트 상태 저장 | `cleanStore.setChecklist(propId, items)` | 인메모리 상태 (`useState`) |
| 체크아웃 완료 메시지 발송 | `messageClient.send(guestId, text)` | S01/S02와 공유 |

**규칙:** HA PIN 만료 실패 시 error 알림 추가. 청소팀 배정/체크리스트는 인메모리 우선.

---

## 의존 방향

```
UI (S04CheckoutPanel)
 ↓ (props/callback만)
Application (checkoutService)
 ↓                    ↓
Business Logic        Infrastructure
(checkoutDomain       (haClient / propStore /
 messageDomain)        alertStore / cleanStore / messageClient)
```

---

## 이벤트 흐름 요약

```
[퇴실 감지]
  도어락 잠금 이벤트 → UI
    → checkoutService.handleCheckout()
      → checkoutDomain.isCheckoutEvent()      [판별]
      → haClient.expirePin()                  [PIN 즉시 만료, 5초 내]
      → checkoutDomain.assignCleaner()        [청소팀 배정]
      → checkoutDomain.buildChecklist()       [체크리스트 생성]
      → cleanStore.setAssignment()            [배정 저장]
      → cleanStore.setChecklist()             [체크리스트 저장]
      → propStore.updateStatus("cleaning")    [상태 갱신]
      → alertStore.add("체크아웃 완료")       [알림]
      → alertStore.add("청소팀 배정 완료")    [알림]

[청소 항목 완료]
  → checkoutService.completeChecklistItem()
    → cleanStore.updateItem()                 [항목 완료 처리]

[전체 청소 완료]
  → checkoutService.finalizeClean()
    → propStore.updateStatus("vacant")        [상태 갱신]
    → alertStore.add("청소 완료")             [알림]
```

---

## S01/S02/S03과 공유되는 인터페이스

| 인터페이스 | 공유 여부 |
|-----------|---------|
| `Alert` 타입 | ✅ 동일 |
| `Booking` 타입 | ✅ 동일 |
| `alertStore.add()` | ✅ 동일 |
| `messageClient.send()` | ✅ 동일 |
| `propStore.updateStatus()` | ✅ S02와 동일 |
| `haClient.expirePin()` | 🆕 S04 신규 |
| `cleanStore.setAssignment()` | 🆕 S04 신규 |
| `cleanStore.setChecklist()` | 🆕 S04 신규 |
| `CheckoutEvent` 타입 | 🆕 S04 신규 |
| `CleanerAssignment` 타입 | 🆕 S04 신규 |
| `ChecklistItem` 타입 | 🆕 S04 신규 |

---

## 다음 단계
- [x] 인터페이스 정의 (s04-interface-definitions.md)
- [x] Business Logic 단위 테스트 작성 (`node:test`)
- [x] Infrastructure mock 구현
- [x] Application 통합 테스트
- [x] UI 컴포넌트 (S04CheckoutPanel.jsx)
