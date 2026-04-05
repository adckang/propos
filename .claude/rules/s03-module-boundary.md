# S03 모듈 경계 정의 (Boundary Document)

> 시나리오: 체류 중 (상시 모니터링) — 센서 LIVE 센싱 · 이상 감지 · AI 답장 초안
> 작성일: 2026-04-02

---

## UI Layer
> 표시 전용. 폴링 결과와 알림을 렌더링하고, 관리자 입력(답장 확정)을 Application에 전달한다.

| 책임 | 모듈 |
|------|------|
| 센서 LIVE 카드 (온도·습도·소음·전력) | `S03MonitoringPanel` > `SensorCard` |
| 이상 감지 알림 배지 (경고/긴급) | `S03MonitoringPanel` > `AlertFeed` |
| 게스트 메시지 목록 + AI 초안 표시 | `S03MonitoringPanel` > `MessagePanel` |
| 답장 확정 / 수정 버튼 이벤트 | `S03MonitoringPanel` > `ReplyDraftCard` |
| 폴링 ON/OFF 토글 | `S03MonitoringPanel` > 헤더 컨트롤 |

**규칙:** 비즈니스 판단 없음. `sensorReadings`, `alerts`, `messages` 상태를 받아 렌더링만 한다.

---

## Application Layer
> 폴링 루프 오케스트레이션. 센서 조회 → 이상 감지 → 알림 생성 순서 조율.

| 책임 | 모듈 |
|------|------|
| 30초 주기 센서 폴링 시작/중지 | `monitoringService.startPolling(propIds, deps)` |
| 센서 읽기 → 이상 감지 → 알림 생성 | `monitoringService.processSensorReading(propId, reading, deps)` |
| 게스트 메시지 수신 → AI 초안 생성 | `monitoringService.handleGuestMessage(msg, booking, deps)` |

**규칙:** 폴링 실패는 warn 알림 후 다음 주기에 재시도. 개별 숙소 실패가 전체 루프를 중단하지 않는다.

---

## Business Logic Layer
> 도메인 규칙. 순수 함수. 외부 의존성 없음.

| 책임 | 모듈 | 핵심 규칙 |
|------|------|----------|
| 센서 이상 여부 판별 | `sensorDomain.isAnomaly(reading, thresholds)` | 각 센서별 임계값 초과 시 true |
| 이상 심각도 분류 | `sensorDomain.classifySeverity(reading, thresholds)` | `warn` (경고) / `critical` (긴급) |
| 이상 알림 텍스트 조립 | `sensorDomain.buildAnomalyAlert(propId, reading, thresholds)` | 순수 문자열 반환 |
| AI 답장 초안 생성 | `messageDomain.buildReplyDraft(guestMessage, booking)` | 키워드 매칭 → 템플릿 선택 → 문자열 반환 |

**규칙:** side effect 없음. 입력 → 출력만.

---

## Infrastructure Layer
> 외부 시스템 연동. 실패 시 throw — 재시도 판단은 Application이 담당.

| 책임 | 모듈 | 외부 시스템 |
|------|------|------------|
| HA 센서 상태 조회 | `haClient.getSensorStates(propId)` | HA REST API (`GET /api/states`) |
| 알림 피드 추가 | `alertStore.add(alert)` | 인메모리 상태 (`useState`) |
| 센서 읽기 상태 갱신 | `sensorStore.update(propId, readings)` | 인메모리 상태 (`useState`) |
| 게스트 메시지 목록 조회 | `messageClient.getMessages(guestId)` | HA persistent_notification (목업) |
| 답장 발송 | `messageClient.send(guestId, text)` | S01/S02와 공유 |

**규칙:** HA 폴링 실패 시 warn 알림만 생성하고 stale 데이터 유지 (마지막 정상 값 표시).

---

## 의존 방향

```
UI (S03MonitoringPanel)
 ↓ (props/callback만)
Application (monitoringService)
 ↓                    ↓
Business Logic        Infrastructure
(sensorDomain         (haClient / alertStore /
 messageDomain)        sensorStore / messageClient)
```

---

## 이벤트 흐름 요약

```
[센서 폴링]
setInterval(30s)
  → monitoringService.processSensorReading()
    → haClient.getSensorStates(propId)      [Infrastructure → HA REST]
    → sensorDomain.isAnomaly()              [Business Logic — 판별]
    → sensorDomain.classifySeverity()       [Business Logic — 분류]
    → sensorDomain.buildAnomalyAlert()      [Business Logic — 텍스트]
    → alertStore.add({ type:"warn"|"error" }) [Infrastructure → alertStore]
    → sensorStore.update(propId, readings)  [Infrastructure → sensorStore]

[게스트 메시지 수신]
  → monitoringService.handleGuestMessage()
    → messageDomain.buildReplyDraft()       [Business Logic — 초안]
    → deps.setDraft(draftText)              [UI 상태 직접 갱신]
```

---

## S01/S02와 공유되는 인터페이스

| 인터페이스 | 공유 여부 |
|-----------|---------|
| `Alert` 타입 | ✅ 동일 |
| `Booking` 타입 | ✅ 동일 |
| `alertStore.add()` | ✅ 동일 |
| `messageClient.send()` | ✅ 동일 |
| `haClient.getSensorStates()` | 🆕 S03 신규 |
| `sensorStore.update()` | 🆕 S03 신규 |
| `SensorReading` 타입 | 🆕 S03 신규 |
| `Thresholds` 타입 | 🆕 S03 신규 |

---

## 다음 단계
- [x] 인터페이스 정의 (s03-interface-definitions.md)
- [x] Business Logic 단위 테스트 작성 (`node:test`)
- [x] Infrastructure mock 구현
- [x] Application 통합 테스트
