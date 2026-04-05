# S01 모듈 경계 정의 (Boundary Document)

> 시나리오: 체크인 전날 (D-1 자동화) — PIN 발급 · 웰컴 메시지 · 스마트홈 초기화
> 작성일: 2026-03-27

---

## UI Layer
> 표시 전용. 상태를 소유하지 않고 Application 결과를 렌더링한다.

| 책임 | 모듈 |
|------|------|
| D-1 자동화 처리 결과 요약 표시 | `CommandCenter` > 알림 피드 패널 |
| 숙소 카드 상태 뱃지 갱신 | `CommandCenter` > PropCard |
| 알림 ack(확인) 버튼 이벤트 | `AlertFeed` 컴포넌트 |

**규칙:** 비즈니스 판단 없음. `alerts` 배열을 받아 렌더링만 한다.

---

## Application Layer
> 유즈케이스 흐름 오케스트레이션. UI와 Business Logic을 연결한다.

| 책임 | 모듈 |
|------|------|
| D-1 트리거 수신 → 대상 숙소 조회 → PIN/메시지/스마트홈 순서 조율 | `checkinPreparationService.runD1Automation()` |
| 루프: 대상 숙소 N개 순차 처리 | 동일 |
| 예외 발생 시 알림 생성 후 다음 숙소 계속 처리 | 동일 |

**규칙:** try/catch로 예외 격리. 개별 숙소 실패가 전체 루프를 중단하지 않는다.

---

## Business Logic Layer
> 도메인 규칙. 순수 함수. 외부 의존성 없음 → 테스트 용이.

| 책임 | 모듈 | 핵심 규칙 |
|------|------|----------|
| 익일 체크인 대상 필터링 | `bookingDomain.filterTomorrowCheckIns(bookings)` | `checkIn === tomorrow && status === "confirmed"` |
| PIN 생성 | `pinDomain.generatePIN()` | 6자리 랜덤, 유효시작 = 체크인 -1시간 |
| PIN 유효기간 계산 | `pinDomain.calcExpiry(checkIn, checkOut)` | validFrom: checkIn-1h, validUntil: checkOut |
| 웰컴 메시지 텍스트 조립 | `messageDomain.buildWelcomeMessage(booking, pin, wifi)` | 순수 문자열 반환 |

**규칙:** side effect 없음. 입력 → 출력만.

---

## Infrastructure Layer
> 외부 시스템 연동. 인터페이스를 통해 교체 가능하게 설계.

| 책임 | 모듈 | 외부 시스템 |
|------|------|------------|
| 도어락 PIN 등록 | `haClient.setLockCode(entityId, code, name)` | HA REST API (`POST /api/services/lock/set_code`) |
| HA 씬 실행 (스마트홈 초기화) | `haClient.activateScene(entityId)` | HA REST API (`POST /api/services/scene/turn_on`) |
| 웰컴 메시지 발송 | `messageClient.send(guestId, text)` | 에어비앤비 메시지 채널 (추정) |
| 알림 피드 추가 | `alertStore.add(alert)` | 인메모리 상태 (`useState`) |

**규칙:** HA 호출 실패 시 503/timeout을 Application Layer로 throw. 재시도 없음 (Application이 결정).

---

## 의존 방향

```
UI
 ↓ (props/callback만)
Application
 ↓              ↓
Business Logic   Infrastructure
(순수함수)       (HA / 메시지 / 알림)
```

---

## 다음 단계
- [x] 각 모듈 인터페이스 정의
- [x] Business Logic 단위 테스트 작성
- [x] Infrastructure mock 구현
- [x] Application 통합
