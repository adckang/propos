# S03 모듈 인터페이스 정의

> 레이어별 함수 시그니처 + 입출력 타입 정의
> 프로젝트 환경: 순수 JS (Babel standalone) — TypeScript 없음 → JSDoc 스타일로 표기
> 작성일: 2026-04-02

---

## 공통 타입 (S01/S02 재사용 + S03 신규)

```js
// S01/S02에서 재사용: Booking, Alert

/**
 * @typedef {Object} SensorReading
 * @property {string} propId
 * @property {string} time             - "HH:MM"
 * @property {number|null} temp        - 섭씨 (null = 센서 없음)
 * @property {number|null} humidity    - % (null = 센서 없음)
 * @property {number|null} noise       - dB (null = 센서 없음)
 * @property {number|null} power       - W (null = 센서 없음)
 */

/**
 * @typedef {Object} Thresholds
 * @property {{ warn: number, critical: number }} temp     - 섭씨
 * @property {{ warn: number, critical: number }} humidity - %
 * @property {{ warn: number, critical: number }} noise    - dB
 * @property {{ warn: number, critical: number }} power    - W
 */

/**
 * @typedef {Object} AnomalyResult
 * @property {boolean} isAnomaly
 * @property {"warn"|"critical"|null} severity
 * @property {string[]} sensors   - 이상 감지된 센서 이름 목록 (예: ["temp", "noise"])
 */

/**
 * @typedef {Object} GuestMessage
 * @property {string} id
 * @property {string} guestId
 * @property {string} text
 * @property {string} time       - "HH:MM"
 * @property {"guest"|"host"} direction
 */

/**
 * @typedef {Object} S03PollResult
 * @property {string} propId
 * @property {"ok"|"anomaly"|"error"} status
 * @property {SensorReading} reading
 * @property {AnomalyResult|null} anomaly
 * @property {string|null} error
 */
```

---

## Business Logic Layer

> 순수 함수. 외부 의존성 없음. 단위 테스트 대상.

```js
// --- sensorDomain ---

/**
 * 센서 읽기가 임계값을 초과했는지 판별
 * @param {SensorReading} reading
 * @param {Thresholds}    thresholds
 * @returns {AnomalyResult}
 *
 * 판별 규칙:
 *   - 각 센서값이 critical 임계값 초과 → severity = "critical"
 *   - warn 임계값 초과 (critical 미만) → severity = "warn"
 *   - 둘 다 없으면 isAnomaly = false
 *   - null 센서값은 스킵
 *   - 여러 센서 이상 시 가장 높은 severity 적용
 */
function isAnomaly(reading, thresholds) {}

/**
 * 이상 감지 알림 텍스트 조립 (순수 문자열 반환)
 * @param {string}       propId
 * @param {SensorReading} reading
 * @param {AnomalyResult} anomaly
 * @returns {string}
 * 예: "온도 32°C 초과 (임계: 30°C) — 확인 필요"
 */
function buildAnomalyAlert(propId, reading, anomaly) {}

/**
 * 기본 임계값 반환
 * @returns {Thresholds}
 * temp:     { warn: 30, critical: 35 }  (°C)
 * humidity: { warn: 80, critical: 90 }  (%)
 * noise:    { warn: 60, critical: 75 }  (dB)
 * power:    { warn: 3000, critical: 5000 } (W)
 */
function getDefaultThresholds() {}


// --- messageDomain (S03 추가) ---

/**
 * 게스트 메시지에서 키워드를 감지해 AI 답장 초안 생성 (순수 문자열 반환)
 * @param {string}  guestMessage
 * @param {Booking} booking
 * @returns {string}
 *
 * 키워드 매칭 규칙 (우선순위 순):
 *   "wifi"|"와이파이"|"인터넷"   → WiFi 안내 템플릿
 *   "덥"|"뜨겁"|"춥"|"cold"|"hot" → 온도 조절 안내 템플릿
 *   "청소"|"clean"|"더럽"         → 청소 요청 처리 템플릿
 *   "체크아웃"|"checkout"|"퇴실"  → 체크아웃 안내 템플릿
 *   매칭 없음                      → 일반 응대 템플릿
 */
function buildReplyDraft(guestMessage, booking) {}
```

---

## Application Layer

> 유즈케이스 오케스트레이션. Business Logic + Infrastructure 조합.

```js
/**
 * 단일 숙소 센서 1회 폴링 → 이상 감지 → 알림/상태 갱신
 *
 * @param {string}     propId
 * @param {Thresholds} thresholds
 * @param {Object}     deps
 * @param {Function}   deps.getSensorStates  - haClient.getSensorStates
 * @param {Function}   deps.updateReadings   - sensorStore.update
 * @param {Function}   deps.addAlert         - alertStore.add
 * @returns {Promise<S03PollResult>}
 */
async function pollSensors(propId, thresholds, deps) {}

/**
 * 여러 숙소 일괄 폴링 (propIds 순차 처리)
 * 개별 실패는 error status로 기록 후 다음 숙소 계속 처리
 *
 * @param {string[]}   propIds
 * @param {Thresholds} thresholds
 * @param {Object}     deps
 * @returns {Promise<S03PollResult[]>}
 */
async function pollAll(propIds, thresholds, deps) {}

/**
 * 게스트 메시지 수신 → AI 답장 초안 생성 → UI에 전달
 *
 * @param {GuestMessage} msg
 * @param {Booking}      booking
 * @param {Object}       deps
 * @param {Function}     deps.setDraft    - (propId, draftText) => void
 * @param {Function}     deps.addAlert    - alertStore.add
 * @returns {void}
 */
function handleGuestMessage(msg, booking, deps) {}
```

**오케스트레이션 순서 (pollSensors):**
```
1. deps.getSensorStates(propId)       → SensorReading 조회
2. sensorDomain.isAnomaly()           → AnomalyResult 판별
3. deps.updateReadings(propId, reading) → UI 센서 카드 갱신
4. anomaly.isAnomaly === true 이면:
   → sensorDomain.buildAnomalyAlert() → 알림 텍스트 생성
   → deps.addAlert({ type: severity }) → 알림 피드 추가
→ S03PollResult 반환
```

---

## Infrastructure Layer

> 외부 시스템 호출. 실패 시 throw — 재시도 판단은 Application이 담당.

```js
// --- haClient (S03 추가) ---

/**
 * 숙소의 모든 센서 상태 일괄 조회
 * @param {string} propId
 * @returns {Promise<SensorReading>}
 * @throws {Error} HA 응답 비정상 시
 *
 * entity 매핑 예시 (propId → HA entity):
 *   temp:     "sensor.temperature_p042"
 *   humidity: "sensor.humidity_p042"
 *   noise:    "sensor.noise_p042"
 *   power:    "sensor.power_p042"
 */
async function getSensorStates(propId) {}


// --- sensorStore ---

/**
 * 센서 읽기 상태 갱신 (SensorCard 실시간 업데이트)
 * @param {string}        propId
 * @param {SensorReading} reading
 * @returns {void}
 */
function update(propId, reading) {}


// --- alertStore / messageClient (S01/S02와 동일) ---
// add(alert): void
// send(guestId, text): Promise<void>
```

---

## 인터페이스 간 데이터 흐름 요약

```
[센서 폴링]
setInterval(30s)
  → pollAll(propIds, thresholds, deps)      [Application]
    → getSensorStates(propId)               [Infrastructure → HA REST]
    → isAnomaly(reading, thresholds)        [Business Logic]
    → updateReadings(propId, reading)       [Infrastructure → sensorStore]
    → buildAnomalyAlert(propId, reading)    [Business Logic — 이상 시만]
    → add({ type:"warn"|"error" })          [Infrastructure → alertStore]
  → S03PollResult[]

[게스트 메시지]
GuestMessage
  → handleGuestMessage(msg, booking, deps)  [Application]
    → buildReplyDraft(text, booking)        [Business Logic]
    → deps.setDraft(propId, draftText)      [UI 상태 직접 갱신]
    → deps.addAlert({ type:"info" })        [Infrastructure → alertStore]
```

---

## 다음 단계
- [x] Business Logic 단위 테스트 작성 (`node:test`)
- [x] Infrastructure mock 구현 (haClient.getSensorStates)
- [x] Application 통합 테스트
