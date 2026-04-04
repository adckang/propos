# S04 모듈 인터페이스 정의

> 레이어별 함수 시그니처 + 입출력 타입 정의
> 프로젝트 환경: 순수 JS (Babel standalone) — TypeScript 없음 → JSDoc 스타일로 표기
> 작성일: 2026-04-03

---

## 공통 타입 (S01/S02 재사용 + S04 신규)

```js
// S01/S02에서 재사용: Booking, Alert

/**
 * @typedef {Object} CheckoutEvent
 * @property {"door_locked"|"manual_checkout"} event
 * @property {string} propId           - "P-042"
 * @property {string} time             - "HH:MM"
 * @property {"guest_checkout"|"manual"|string} [context]
 */

/**
 * @typedef {Object} CheckoutWindow
 * @property {string} from   - "HH:MM" (체크아웃 가능 시작)
 * @property {string} until  - "HH:MM" (체크아웃 가능 종료)
 */

/**
 * @typedef {Object} Cleaner
 * @property {string} id
 * @property {string} name
 * @property {boolean} available
 * @property {number} activeJobs       - 현재 진행중 청소 건수 (부하 기준)
 * @property {string} phone
 */

/**
 * @typedef {Object} CleanerAssignment
 * @property {string} propId
 * @property {string} cleanerId
 * @property {string} cleanerName
 * @property {string} assignedAt       - "HH:MM"
 * @property {string} estimatedArrival - "HH:MM" (배정 후 30분)
 * @property {"assigned"|"in_progress"|"done"} status
 */

/**
 * @typedef {Object} ChecklistItem
 * @property {string} id
 * @property {string} label            - 한국어 항목명
 * @property {boolean} done
 * @property {"required"|"optional"} priority
 */

/**
 * @typedef {Object} S04Result
 * @property {string} propId
 * @property {"success"|"partial"|"failed"} status
 * @property {{ pinExpired: boolean, cleanerAssigned: boolean, checklistCreated: boolean }} steps
 * @property {string|null} error
 */
```

---

## Business Logic Layer

> 순수 함수. 외부 의존성 없음. 단위 테스트 대상.

```js
// --- checkoutDomain ---

/**
 * 퇴실 이벤트가 체크아웃인지 판별
 * @param {CheckoutEvent} event
 * @param {Booking}       booking
 * @param {string}        now    - "HH:MM" (테스트 주입용)
 * @returns {boolean}
 *
 * true 조건:
 *   event.event === "door_locked" || event.event === "manual_checkout"
 *   AND booking.status === "confirmed" || "occupied"
 *   AND now가 getCheckoutWindow(booking.checkOut) 범위 내
 */
function isCheckoutEvent(event, booking, now) {}

/**
 * 체크아웃 가능 시간창 계산
 * @param {string} checkOut - ISO 8601 (예: "2026-04-07T11:00:00")
 * @returns {CheckoutWindow}
 * from  = checkOut - 2시간
 * until = checkOut + 3시간
 */
function getCheckoutWindow(checkOut) {}

/**
 * 청소팀 자동 배정 (가용 팀 중 부하 최소)
 * @param {Cleaner[]} cleaners
 * @param {string}    propId
 * @param {string}    checkoutTime  - "HH:MM"
 * @returns {CleanerAssignment}
 * @throws {Error} 가용 청소팀 없을 시
 *
 * 배정 규칙:
 *   1. available === true 인 청소팀만 후보
 *   2. activeJobs 가장 적은 팀 선택 (동률이면 첫 번째)
 *   3. estimatedArrival = checkoutTime + 30분
 */
function assignCleaner(cleaners, propId, checkoutTime) {}

/**
 * 청소 체크리스트 생성 (표준 항목)
 * @param {string} propId
 * @returns {ChecklistItem[]}
 *
 * 표준 항목 (required):
 *   - 침구 교체
 *   - 화장실 청소
 *   - 주방 청소
 *   - 바닥 청소
 *   - 쓰레기 비우기
 *   - 도어락 PIN 초기화 확인
 * 표준 항목 (optional):
 *   - 에어컨 필터 청소
 *   - 창문 닦기
 */
function buildChecklist(propId) {}

/**
 * 체크아웃 완료 알림 텍스트 조립 (순수 문자열 반환)
 * @param {string} propId
 * @param {string} guestName
 * @param {string} checkoutTime - "HH:MM"
 * @returns {string}
 * 예: "P-042 체크아웃 완료 — 김민준님 퇴실 (11:05)"
 */
function buildCheckoutAlert(propId, guestName, checkoutTime) {}

/**
 * 청소팀 배정 알림 텍스트 조립 (순수 문자열 반환)
 * @param {string}            propId
 * @param {CleanerAssignment} assignment
 * @returns {string}
 * 예: "P-042 청소팀 배정 완료 — 김청소 도착예정 11:35"
 */
function buildCleanerAssignAlert(propId, assignment) {}
```

---

## Application Layer

> 유즈케이스 오케스트레이션. Business Logic + Infrastructure 조합.

```js
/**
 * 퇴실 이벤트 수신 → 체크아웃 판별 → PIN 만료 → 청소팀 배정 → 체크리스트 생성
 *
 * @param {CheckoutEvent} event
 * @param {Booking[]}     allBookings     - 전체 예약 목록
 * @param {Cleaner[]}     cleaners        - 청소팀 목록
 * @param {Object}        deps
 * @param {Function}      deps.expirePin      - haClient.expirePin(entityId)
 * @param {Function}      deps.addAlert       - alertStore.add
 * @param {Function}      deps.updateStatus   - propStore.updateStatus
 * @param {Function}      deps.setAssignment  - cleanStore.setAssignment
 * @param {Function}      deps.setChecklist   - cleanStore.setChecklist
 * @param {Function}      deps.sendMessage    - messageClient.send (선택)
 * @param {string}        [now]           - "HH:MM" (테스트 주입용)
 * @returns {Promise<S04Result>}
 */
async function handleCheckout(event, allBookings, cleaners, deps, now) {}

/**
 * 청소 항목 완료 처리
 *
 * @param {string}   propId
 * @param {string}   itemId
 * @param {Object}   deps
 * @param {Function} deps.updateChecklistItem - (propId, itemId, done) => void
 * @returns {void}
 */
function completeChecklistItem(propId, itemId, deps) {}

/**
 * 전체 청소 완료 → 숙소 상태 "vacant"으로 변경
 *
 * @param {string}   propId
 * @param {Object}   deps
 * @param {Function} deps.updateStatus - propStore.updateStatus
 * @param {Function} deps.addAlert     - alertStore.add
 * @returns {void}
 */
function finalizeClean(propId, deps) {}
```

**오케스트레이션 순서 (handleCheckout):**
```
1. allBookings에서 event.propId 해당 예약 조회
2. isCheckoutEvent(event, booking, now)     → 체크아웃 여부 판별
   → false면 조기 종료 (일반 잠금, 무시)
3. deps.expirePin(entityId)                 → PIN 즉시 만료 (5초 내)
4. buildCheckoutAlert(...)                  → 체크아웃 완료 알림 텍스트
5. deps.addAlert({ type:"info", ... })      → 체크아웃 완료 알림
6. assignCleaner(cleaners, propId, time)    → 청소팀 배정
7. buildChecklist(propId)                   → 체크리스트 생성
8. deps.setAssignment(propId, assignment)   → 배정 저장
9. deps.setChecklist(propId, items)         → 체크리스트 저장
10. deps.updateStatus(propId, "cleaning")   → 숙소 상태 갱신
11. buildCleanerAssignAlert(...)            → 배정 알림 텍스트
12. deps.addAlert({ type:"info", ... })     → 청소 배정 완료 알림
→ S04Result 반환
```

---

## Infrastructure Layer

```js
// --- haClient (S04 추가) ---

/**
 * 도어락 PIN 즉시 만료
 * @param {string} entityId  - "lock.front_door_p042"
 * @returns {Promise<void>}
 * @throws {Error} HA 응답 비정상 시
 */
async function expirePin(entityId) {}


// --- cleanStore ---

/**
 * 청소팀 배정 저장 (UI 상태 갱신)
 * @param {string}            propId
 * @param {CleanerAssignment} assignment
 * @returns {void}
 */
function setAssignment(propId, assignment) {}

/**
 * 청소 체크리스트 저장 (UI 상태 갱신)
 * @param {string}         propId
 * @param {ChecklistItem[]} items
 * @returns {void}
 */
function setChecklist(propId, items) {}

/**
 * 체크리스트 항목 완료 처리
 * @param {string}  propId
 * @param {string}  itemId
 * @param {boolean} done
 * @returns {void}
 */
function updateChecklistItem(propId, itemId, done) {}


// --- propStore / alertStore / messageClient (S02와 공유) ---
```

---

## 인터페이스 간 데이터 흐름 요약

```
[체크아웃 자동화]
CheckoutEvent
  → handleCheckout()                    [Application]
    → isCheckoutEvent()                 [Business Logic — 판별]
    → expirePin()                       [Infrastructure → HA REST]
    → assignCleaner()                   [Business Logic — 배정]
    → buildChecklist()                  [Business Logic — 체크리스트]
    → setAssignment()                   [Infrastructure → cleanStore]
    → setChecklist()                    [Infrastructure → cleanStore]
    → updateStatus("cleaning")          [Infrastructure → propStore]
    → add({ type:"info" }) x2           [Infrastructure → alertStore]
  → S04Result

[청소 완료]
  → finalizeClean()                     [Application]
    → updateStatus("vacant")            [Infrastructure → propStore]
    → add({ type:"info" })              [Infrastructure → alertStore]
```
