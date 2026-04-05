# S01 모듈 인터페이스 정의

> 레이어별 함수 시그니처 + 입출력 타입 정의
> 프로젝트 환경: 순수 JS (Babel standalone) — TypeScript 없음 → JSDoc 스타일로 표기
> 작성일: 2026-03-27

---

## 공통 타입

```js
/**
 * @typedef {Object} Booking
 * @property {string} propId       - 숙소 ID (예: "P-042")
 * @property {string} propName     - 숙소 이름
 * @property {string} guestName    - 게스트 이름
 * @property {string} guestId      - 게스트 식별자 (메시지 채널용)
 * @property {string} checkIn      - ISO 8601 (예: "2026-03-28T15:00:00")
 * @property {string} checkOut     - ISO 8601 (예: "2026-03-30T11:00:00")
 * @property {"confirmed"|"pending"|"cancelled"} status
 * @property {boolean} pinRequired
 * @property {{ ssid: string, pw: string }} wifi
 */

/**
 * @typedef {Object} PINRecord
 * @property {string} pin          - 6자리 숫자 문자열 (예: "492817")
 * @property {string} validFrom    - ISO 8601
 * @property {string} validUntil   - ISO 8601
 * @property {string} propId
 * @property {string} guestName
 */

/**
 * @typedef {Object} Alert
 * @property {"info"|"warn"|"error"} type
 * @property {string} prop         - 숙소 이름 또는 ID
 * @property {string} msg
 * @property {string} time         - "HH:MM" 형식
 */

/**
 * @typedef {Object} D1Result
 * @property {string} propId
 * @property {"success"|"partial"|"failed"} status
 * @property {{ pin: boolean, message: boolean, smartHome: boolean }} steps
 * @property {string|null} error   - 실패 시 에러 메시지
 */
```

---

## Business Logic Layer

> 순수 함수. 외부 의존성 없음. 단위 테스트 대상.

```js
// --- bookingDomain ---

/**
 * 예약 목록에서 내일 체크인 + confirmed 상태만 필터링
 * @param {Booking[]} bookings
 * @param {string} today - "YYYY-MM-DD" (테스트 주입용)
 * @returns {Booking[]}
 */
function filterTomorrowCheckIns(bookings, today) {}


// --- pinDomain ---

/**
 * 6자리 랜덤 PIN 생성
 * @returns {string} - "000000"~"999999" 범위의 문자열
 */
function generatePIN() {}

/**
 * PIN 유효기간 계산
 * @param {string} checkIn  - ISO 8601
 * @param {string} checkOut - ISO 8601
 * @returns {{ validFrom: string, validUntil: string }}
 * validFrom  = checkIn - 1시간
 * validUntil = checkOut
 */
function calcExpiry(checkIn, checkOut) {}


// --- messageDomain ---

/**
 * 웰컴 메시지 텍스트 조립 (순수 문자열 반환)
 * @param {Booking} booking
 * @param {PINRecord} pinRecord
 * @returns {string}
 */
function buildWelcomeMessage(booking, pinRecord) {}
```

---

## Application Layer

> 유즈케이스 오케스트레이션. Business Logic + Infrastructure 조합.

```js
/**
 * D-1 자동화 메인 진입점
 * - 내일 체크인 숙소 조회
 * - 숙소별 PIN 발급 → HA 등록 → 메시지 발송 → 스마트홈 초기화
 * - 개별 실패는 알림으로 기록하고 다음 숙소 계속 처리
 *
 * @param {Booking[]} allBookings      - 전체 예약 목록 (UI 상태에서 주입)
 * @param {string}    today            - "YYYY-MM-DD" (테스트 주입용)
 * @param {Object}    deps             - 의존성 주입
 * @param {Function}  deps.setLockCode - haClient.setLockCode
 * @param {Function}  deps.activateScene - haClient.activateScene
 * @param {Function}  deps.sendMessage - messageClient.send
 * @param {Function}  deps.addAlert    - alertStore.add
 * @returns {Promise<D1Result[]>}
 */
async function runD1Automation(allBookings, today, deps) {}
```

**오케스트레이션 순서 (각 숙소별):**
```
1. filterTomorrowCheckIns          → 대상 숙소 확정
2. generatePIN + calcExpiry        → PIN 생성
3. deps.setLockCode(...)           → HA 도어락 등록
4. buildWelcomeMessage(...)        → 메시지 텍스트 생성
5. deps.sendMessage(...)           → 메시지 발송
6. deps.activateScene(...)         → 스마트홈 초기화
7. deps.addAlert(...)              → 완료 알림
```

---

## Infrastructure Layer

> 외부 시스템 호출. 실패 시 throw — 재시도 판단은 Application이 담당.

```js
// --- haClient ---

/**
 * 도어락 PIN 등록
 * @param {string} entityId  - "lock.front_door_p042"
 * @param {string} code      - 6자리 PIN
 * @param {string} name      - "guest_김민준"
 * @returns {Promise<void>}
 * @throws {Error} HA 응답 비정상 시 (4xx / 5xx / timeout)
 */
async function setLockCode(entityId, code, name) {}

/**
 * HA 씬 실행 (스마트홈 초기화)
 * @param {string} entityId  - "scene.checkin_ready_p042"
 * @returns {Promise<void>}
 * @throws {Error} HA 응답 비정상 시
 */
async function activateScene(entityId) {}


// --- messageClient ---

/**
 * 게스트에게 메시지 발송
 * @param {string} guestId  - 게스트 식별자
 * @param {string} text     - 발송할 메시지 본문
 * @returns {Promise<void>}
 * @throws {Error} 발송 실패 시
 */
async function send(guestId, text) {}


// --- alertStore ---

/**
 * 알림 피드에 항목 추가 (UI 상태 직접 갱신)
 * @param {Alert} alert
 * @returns {void}
 */
function add(alert) {}
```

---

## 인터페이스 간 데이터 흐름 요약

```
allBookings (UI 상태)
  → filterTomorrowCheckIns()       [Business Logic]
  → generatePIN() + calcExpiry()   [Business Logic]
  → setLockCode()                  [Infrastructure → HA]
  → buildWelcomeMessage()          [Business Logic]
  → send()                         [Infrastructure → 메시지]
  → activateScene()                [Infrastructure → HA]
  → add()                          [Infrastructure → AlertFeed]
  → D1Result[]                     [Application → UI 반환]
```

---

## 다음 단계
- [x] Business Logic 단위 테스트 작성 (`node:test`)
- [x] Infrastructure mock 구현
- [x] Application 통합 테스트
