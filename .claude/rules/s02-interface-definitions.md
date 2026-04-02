# S02 모듈 인터페이스 정의

> 레이어별 함수 시그니처 + 입출력 타입 정의
> 프로젝트 환경: 순수 JS (Babel standalone) — TypeScript 없음 → JSDoc 스타일로 표기
> 작성일: 2026-03-31

---

## 공통 타입 (S01 Booking, Alert 재사용 + S02 신규 타입)

```js
// S01에서 그대로 재사용: Booking, Alert

/**
 * @typedef {Object} HAEvent
 * @property {"door_unlocked"|"pin_fail_lockout"} event
 * @property {string} propId           - "P-042"
 * @property {string} time             - "HH:MM"
 * @property {"guest_checkin"|"manual"|string} [context]
 * @property {number} [failCount]      - PIN 오류 횟수 (pin_fail_lockout 시)
 */

/**
 * @typedef {Object} CheckinWindow
 * @property {string} from   - "HH:MM" (체크인 가능 시작)
 * @property {string} until  - "HH:MM" (체크인 가능 종료)
 */

/**
 * @typedef {Object} S02Result
 * @property {string} propId
 * @property {"success"|"partial"|"failed"} status
 * @property {{ scene: boolean, channel: boolean, message: boolean }} steps
 * @property {string|null} error
 */
```

---

## Business Logic Layer

> 순수 함수. 외부 의존성 없음. 단위 테스트 대상.

```js
// --- checkinDomain ---

/**
 * 도어락 열림 이벤트가 게스트 체크인인지 판별
 * @param {HAEvent} event
 * @param {Booking} booking              - 해당 숙소의 현재 예약
 * @param {string}  now                  - "HH:MM" (테스트 주입용)
 * @returns {boolean}
 *
 * true 조건:
 *   event.context === "guest_checkin"
 *   AND now가 getCheckinWindow(booking.checkIn) 범위 내
 *   AND booking.status === "confirmed"
 */
function isCheckinEvent(event, booking, now) {}

/**
 * 체크인 가능 시간창 계산
 * @param {string} checkIn  - ISO 8601 (예: "2026-03-28T15:00:00")
 * @returns {CheckinWindow}
 * from  = checkIn - 1시간
 * until = checkIn + 5시간
 */
function getCheckinWindow(checkIn) {}


// --- messageDomain ---

/**
 * 입실 확인 메시지 텍스트 조립 (순수 문자열 반환)
 * @param {Booking} booking
 * @param {string}  actualCheckInTime  - "HH:MM" (실제 입실 시각)
 * @returns {string}
 * 예: "김민준님, 입실이 확인되었습니다.\n편안한 여행 되세요!\n불편하신 점은 채팅으로 알려주세요."
 */
function buildCheckinConfirmMessage(booking, actualCheckInTime) {}

/**
 * PIN 오류 긴급 알림 텍스트 조립 (순수 문자열 반환)
 * @param {string} propId
 * @param {number} failCount
 * @returns {string}
 * 예: "PIN 오류 3회 초과 — 도어락 잠금\n게스트 확인 필요"
 */
function buildPinLockoutAlert(propId, failCount) {}
```

---

## Application Layer

> 유즈케이스 오케스트레이션. Business Logic + Infrastructure 조합.

```js
/**
 * 도어락 열림 이벤트 수신 → 체크인 판별 → 씬/채팅 자동화 실행
 *
 * @param {HAEvent}   event
 * @param {Booking[]} allBookings       - 전체 예약 목록 (UI 상태에서 주입)
 * @param {Object}    deps              - 의존성 주입
 * @param {Function}  deps.activateScene   - haClient.activateScene
 * @param {Function}  deps.openChannel     - messageClient.openChannel
 * @param {Function}  deps.sendMessage     - messageClient.send
 * @param {Function}  deps.addAlert        - alertStore.add
 * @param {Function}  deps.updateStatus    - propStore.updateStatus
 * @param {string}    [now]             - "HH:MM" (테스트 주입용, 기본: 현재 시각)
 * @returns {Promise<S02Result>}
 */
async function handleDoorUnlocked(event, allBookings, deps, now) {}
```

**오케스트레이션 순서:**
```
1. allBookings에서 event.propId 해당 예약 조회
2. isCheckinEvent(event, booking, now)   → 체크인 여부 판별
   → false면 조기 종료 (일반 출입, 무시)
3. deps.activateScene("scene.checkin_welcome_p042")  → IoT 씬 실행
4. buildCheckinConfirmMessage(booking, event.time)   → 메시지 텍스트 생성
5. deps.openChannel(booking)             → 채팅 채널 오픈
6. deps.sendMessage(booking.guestId, text)           → 입실 확인 메시지 발송
7. deps.updateStatus(propId, "occupied") → 숙소 상태 갱신
8. deps.addAlert({ type:"info", ... })   → 완료 알림
→ S02Result 반환
```

```js
/**
 * PIN 오류 3회 초과 이벤트 수신 → 긴급 알림 생성
 *
 * @param {HAEvent}  event              - event.event === "pin_fail_lockout"
 * @param {Object}   deps
 * @param {Function} deps.addAlert      - alertStore.add
 * @returns {void}
 */
function handlePinLockout(event, deps) {}
```

**오케스트레이션 순서:**
```
1. buildPinLockoutAlert(event.propId, event.failCount)  → 알림 텍스트 생성
2. deps.addAlert({ type: "error", ... })                → 긴급 알림 추가
```

---

## Infrastructure Layer

> 외부 시스템 호출. 실패 시 throw — 재시도 판단은 Application이 담당.

```js
// --- haWebSocket ---

/**
 * HA WebSocket 연결 + state_changed 이벤트 구독
 * @param {string}   haUrl     - "ws://homeassistant.local:8123/api/websocket"
 * @param {string}   token     - HA Long-Lived Access Token
 * @param {Function} onEvent   - (HAEvent) => void  이벤트 수신 콜백
 * @returns {{ disconnect: () => void }}
 *
 * - 연결 끊김 시 자동 재연결 (지수 백오프, 최대 5회)
 * - subscribe_events: state_changed 필터링 후 HAEvent 형태로 정규화해서 onEvent 호출
 */
function connect(haUrl, token, onEvent) {}


// --- haClient (S01과 공유, S02에서 activateScene만 사용) ---

/**
 * HA 씬 실행 (체크인 웰컴 씬)
 * @param {string} entityId  - "scene.checkin_welcome_p042"
 * @returns {Promise<void>}
 * @throws {Error} HA 응답 비정상 시 (4xx / 5xx / timeout)
 */
async function activateScene(entityId) {}


// --- messageClient ---

/**
 * 게스트 채팅 채널 활성화
 * @param {Booking} booking
 * @returns {Promise<void>}
 * @throws {Error} 채널 오픈 실패 시
 */
async function openChannel(booking) {}

/**
 * 게스트에게 메시지 발송 (S01과 공유)
 * @param {string} guestId
 * @param {string} text
 * @returns {Promise<void>}
 * @throws {Error} 발송 실패 시
 */
async function send(guestId, text) {}


// --- propStore ---

/**
 * 숙소 상태 업데이트 (CommandCenter PropCard 뱃지 반영)
 * @param {string} propId
 * @param {"vacant"|"occupied"|"cleaning"|"maintenance"} status
 * @returns {void}
 */
function updateStatus(propId, status) {}


// --- alertStore (S01과 공유) ---

/**
 * 알림 피드에 항목 추가
 * @param {Alert} alert
 * @returns {void}
 */
function add(alert) {}
```

---

## 인터페이스 간 데이터 흐름 요약

```
[정상 체크인]
HAEvent (WebSocket)
  → handleDoorUnlocked()            [Application]
    → isCheckinEvent()              [Business Logic — 판별]
    → activateScene()               [Infrastructure → HA REST]
    → buildCheckinConfirmMessage()  [Business Logic — 텍스트]
    → openChannel()                 [Infrastructure → 메시지 채널]
    → send()                        [Infrastructure → 메시지 채널]
    → updateStatus("occupied")      [Infrastructure → propStore]
    → add({ type:"info" })          [Infrastructure → alertStore]
  → S02Result

[PIN 오류 잠금]
HAEvent (WebSocket)
  → handlePinLockout()              [Application]
    → buildPinLockoutAlert()        [Business Logic — 텍스트]
    → add({ type:"error" })         [Infrastructure → alertStore]
```

---

## S01과 공유되는 인터페이스

| 인터페이스 | 공유 여부 |
|-----------|---------|
| `Booking` 타입 | ✅ 동일 |
| `Alert` 타입 | ✅ 동일 |
| `haClient.activateScene()` | ✅ 동일 |
| `messageClient.send()` | ✅ 동일 |
| `alertStore.add()` | ✅ 동일 |
| `messageClient.openChannel()` | 🆕 S02 신규 |
| `haWebSocket.connect()` | 🆕 S02 신규 |
| `propStore.updateStatus()` | 🆕 S02 신규 |

---

## 다음 단계
- [ ] Business Logic 단위 테스트 작성 (`node:test`)
- [ ] Infrastructure mock 구현 (haWebSocket, messageClient.openChannel)
- [ ] Application 통합 테스트
