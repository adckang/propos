# S02 모듈 경계 정의 (Boundary Document)

> 시나리오: 체크인 당일 (입실 감지) — 비대면 입실 · IoT 씬 실행 · 게스트 채팅 오픈
> 작성일: 2026-03-31

---

## UI Layer
> 표시 전용. WebSocket 이벤트를 수신하고 Application 결과를 렌더링한다.

| 책임 | 모듈 |
|------|------|
| HA WebSocket 연결 유지 + 이벤트 수신 | `CommandCenter` > `haWebSocket.connect()` 호출 |
| 입실 감지 이벤트 → Application 호출 | `CommandCenter` > `onCheckinDetected()` 핸들러 |
| 숙소 카드 상태 갱신 ("입실 완료" 초록 뱃지) | `CommandCenter` > PropCard (`status: "occupied"`) |
| 알림 피드 렌더링 + ack 버튼 이벤트 | `AlertFeed` 컴포넌트 |
| PIN 오류 긴급 알림 표시 | `AlertFeed` (`type: "error"`) |

**규칙:** 비즈니스 판단 없음. `propStatus`, `alerts` 상태를 받아 렌더링만 한다.

---

## Application Layer
> 유즈케이스 흐름 오케스트레이션. 이벤트 수신 → 씬 실행 → 채팅 오픈 순서 조율.

| 책임 | 모듈 |
|------|------|
| 도어락 열림 이벤트 수신 → 체크인 판별 위임 | `checkinService.handleDoorUnlocked(event, deps)` |
| 체크인 감지 확정 → IoT 씬 실행 | `checkinService.runCheckinScene(propId, deps)` |
| 씬 완료 → 게스트 채팅 채널 오픈 | `checkinService.openGuestChannel(booking, deps)` |
| 예외 발생 시 알림 생성 후 처리 중단 (전체 루프 영향 없음) | 동일 — try/catch 격리 |
| PIN 오류 3회 이벤트 → 긴급 알림 생성 | `checkinService.handlePinLockout(event, deps)` |

**규칙:** 각 단계 실패 시 throw를 catch해 alertStore에 에러 알림 추가. 다음 숙소 처리 계속.

---

## Business Logic Layer
> 도메인 규칙. 순수 함수. 외부 의존성 없음 → 단위 테스트 가능.

| 책임 | 모듈 | 핵심 규칙 |
|------|------|----------|
| 도어락 열림이 체크인인지 판별 | `checkinDomain.isCheckinEvent(event, booking)` | `context === "guest_checkin"` + 체크인 가능 시간창 내 (`checkinWindow`) |
| 체크인 가능 시간창 계산 | `checkinDomain.getCheckinWindow(checkIn)` | checkIn 기준 ±3시간 (예: 12:00~20:00) |
| 입실 확인 메시지 텍스트 조립 | `messageDomain.buildCheckinConfirmMessage(booking)` | 순수 문자열 반환 |
| PIN 오류 알림 텍스트 조립 | `messageDomain.buildPinLockoutAlert(propId, failCount)` | 순수 문자열 반환 |

**규칙:** side effect 없음. 입력 → 출력만.

---

## Infrastructure Layer
> 외부 시스템 연동. 실패 시 throw — 재시도 판단은 Application이 담당.

| 책임 | 모듈 | 외부 시스템 |
|------|------|------------|
| HA WebSocket 연결 + 이벤트 구독 | `haWebSocket.connect(haUrl, token, onEvent)` | HA WebSocket API (`subscribe_events: state_changed`) |
| 체크인 씬 실행 (조명 + 에어컨) | `haClient.activateScene(entityId)` | HA REST API (`POST /api/services/scene/turn_on`) |
| 게스트 채팅 채널 오픈 | `messageClient.openChannel(booking)` | 에어비앤비 메시지 채널 |
| 입실 확인 메시지 발송 | `messageClient.send(guestId, text)` | 에어비앤비 메시지 채널 |
| 알림 피드 추가 | `alertStore.add(alert)` | 인메모리 상태 (`useState`) |
| 숙소 상태 업데이트 | `propStore.updateStatus(propId, status)` | 인메모리 상태 (`useState`) |

**규칙:** HA 호출 실패 시 503/timeout을 Application Layer로 throw. WebSocket 연결 끊김 시 자동 재연결 (Infrastructure 내부 처리).

---

## 의존 방향

```
UI (CommandCenter / AlertFeed)
 ↓ (props/callback만)
Application (checkinService)
 ↓                    ↓
Business Logic        Infrastructure
(checkinDomain        (haWebSocket / haClient /
 messageDomain)        messageClient / alertStore / propStore)
```

---

## 이벤트 흐름 요약

```
[도어락 PIN 인증 성공]
  HACore → HA → WebSocket → UI
    → checkinService.handleDoorUnlocked()
      → checkinDomain.isCheckinEvent()     [판별]
      → haClient.activateScene()           [씬 실행]
      → messageClient.openChannel()        [채팅 오픈]
      → messageClient.send()               [입실 확인 메시지]
      → propStore.updateStatus("occupied") [상태 갱신]
      → alertStore.add("입실 완료")        [알림]

[PIN 오류 3회]
  HACore → HA → WebSocket → UI
    → checkinService.handlePinLockout()
      → alertStore.add(type: "error")      [긴급 알림]
```

---

## 다음 단계
- [x] Business Logic 단위 테스트 작성 (`node:test`)
- [x] Infrastructure mock 구현 (haWebSocket, messageClient)
- [x] Application 통합 테스트
