# PROPOS 이벤트 감지 설계
> 버전: v1.0 | 작성: 2026-07-13
> 구현 기준 문서 — 이 파일을 축으로 삼아 코드를 작성·수정한다.

---

## 1. 철학

**의심(Suspicion) → 확신(Confirmation) 2단계 모델**

센서만으로는 절대적 확신을 줄 수 없다.
"나간 것 같다"는 의심 상태를 기록하고,
시간·외부 확인 등 추가 조건이 충족될 때 비로소 상태를 전환한다.

확실한 데이터의 예:
- 게스트 메시지: "퇴실했어요" / "들어왔어요"
- 운영자 CCTV 확인
- 도어락 PIN 입력 이벤트 (미래 연동)

---

## 2. 3계층 파이프라인

```
Raw Sensor (30초 폴링)
        │  snap: { doorOpen, motionDetected, acPower, noiseLevel, ... }
        ▼
[Layer 1: SensorEventGenerator]
  원시 센서 → EXIT / ENTRY 시맨틱 이벤트 조합
        │  { exit, exitAt, entry, entryAt }
        ▼
[Layer 2: SuspicionTracker]
  EXIT/ENTRY + 예약시각 + 현재상태 → 의심 기록 → 확신 이벤트 생성
        │  check_out_detected / check_in_detected /
        │  cleaning_started / cleaning_finished /
        │  checkout_confirmation_needed / early_checkin_suspected / no_show_suspected
        ▼
[Layer 3: OccupancyMonitor.process()]
  기존 이벤트(smoke/noise/energy/environment) + 새 이벤트 통합 반환
        │  events[]
        ▼
[Dispatcher: occupancyWatcher.js]
  isValidTransition() → getNextRoomState() → 상태 전환
  soft events → ConfirmationManager (메시지 발송, 미래 구현)
```

---

## 3. Layer 1 — EXIT / ENTRY 정의

### EXIT (나감)
```
조건 순서 (모두 충족):
  ① 문 열리기 직전 N분 이내 모션 있었음   (누군가 있었다)
  ② 문 열림 → 닫힘 이벤트              (나갔다)
  ③ 문 닫힌 후 N분간 모션 없음          (돌아오지 않았다)

파라미터:
  EXIT_LOOKBACK_MIN   = 5   (①: 모션이 얼마나 최근이어야 하는가)
  EXIT_NO_MOTION_MIN  = 5   (③: 모션 없음 지속 시간)
```

### ENTRY (들어옴)
```
조건 순서 (모두 충족):
  ① 문 열림 → 닫힘 이벤트              (들어왔다)
  ② 이후 모션 감지                      (실내 있음)
  ③ 모션 N분 이상 지속                  (머물고 있다)

파라미터:
  ENTRY_SUSTAINED_MIN = 3   (③: 모션 지속 시간)
```

### 취소 조건
```
EXIT 후보 취소: ③ 완료 전 모션 감지 → "나갔다가 돌아옴"
ENTRY 후보 취소: ③ 완료 전 모션이 EXIT_NO_MOTION_MIN 이상 없음 → "잠깐 들어왔다가 나감"
```

---

## 4. Layer 2 — SuspicionTracker 이벤트별 로직

### 4-A. check_out_detected

```
OCCUPIED 상태에서:

[EXIT 감지 시]
  Case 1: checkOut 시각 이미 경과 → 즉시 check_out_detected 발생
  Case 2: checkOut 시각 미경과   → CHECKOUT_SUSPECTED 기록 (상태 변경 없음)

[CHECKOUT_SUSPECTED 상태 + checkOut 도래 + 모션 없음]
  → check_out_detected 발생 (정상 퇴실: 먼저 나갔다가 checkOut 시각 도래)

[ENTRY 감지 시 + CHECKOUT_SUSPECTED 상태]
  → 의심 취소 (나갔다가 다시 돌아옴)

[EXIT 없음 + checkOut + grace 경과 + 모션 없음]
  → checkout_confirmation_needed (메시지 발송 트리거, soft event)

[의심 만료: checkOut + SUSPICION_EXPIRE_MIN 경과]
  → 의심 자동 취소
```

### 4-B. check_in_detected

```
PRE_STAY_READY/OPTIMIZED 상태에서:

[ENTRY 감지 시]
  Case 1: checkIn 시각 이후 (또는 시각 정보 없음) → 즉시 check_in_detected
  Case 2: checkIn 시각 이전                        → early_checkin_suspected (soft event)

[checkIn 시각 + NO_SHOW_WINDOW_MIN 경과 + ENTRY 없음]
  → no_show_suspected (soft event)
```

### 4-C. cleaning_started

```
CLEANING/CLEANING_PENDING 상태에서:

[ENTRY 감지 시]
  → CLEANING_START_SUSPECTED 기록

[CLEANING_START_SUSPECTED + 모션 CLEANING_SUSTAINED_MIN 이상 지속]
  → cleaning_started 발생 (30분 활동 = 게스트 복귀와 구분)

[EXIT 감지 시 + 모션 지속 CLEANING_SUSTAINED_MIN 미만]
  → 의심 취소 (짧은 방문 = 청소팀 아님)
```

### 4-D. cleaning_finished

```
CLEANING/CLEANING_IN_PROGRESS 상태에서:

[EXIT 감지 시]
  → CLEANING_DONE_SUSPECTED 기록

[CLEANING_DONE_SUSPECTED + CLEANING_DONE_QUIET_MIN 이상 모션 없음]
  → cleaning_finished 발생

[ENTRY 감지 시 + CLEANING_DONE_SUSPECTED]
  → 의심 취소 (재입실)
```

---

## 5. 이벤트 분류

### 상태 기계 이벤트 (getNextRoomState 호출)
| 이벤트 | 발생 조건 |
|---|---|
| `check_in_detected` | ENTRY + checkIn 시각 이후 |
| `check_out_detected` | EXIT + checkOut 도래 또는 이미 경과 |
| `cleaning_started` | ENTRY + 모션 20분 지속 |
| `cleaning_finished` | EXIT + 10분 조용 |
| `energy_waste_detected/resolved` | 기존 로직 유지 |
| `complaint_detected/resolved` | 기존 로직 유지 |

### Soft 이벤트 (ConfirmationManager로 라우팅, 상태 변경 없음)
| 이벤트 | 의미 |
|---|---|
| `checkout_confirmation_needed` | 퇴실 여부 게스트에게 확인 필요 |
| `early_checkin_suspected` | 조기 체크인 가능성, 운영자 확인 |
| `no_show_suspected` | No-show 가능성, 운영자 확인 |

---

## 6. 파라미터 (monitoringThresholds.js)

```javascript
// EXIT/ENTRY 감지
EXIT_LOOKBACK_MIN:      5   // EXIT 조건①: 모션이 얼마나 최근이어야 하는가
EXIT_NO_MOTION_MIN:     5   // EXIT 조건③: 문닫힘 후 모션없음 지속
ENTRY_SUSTAINED_MIN:    3   // ENTRY 조건③: 모션 지속 시간

// 청소 감지
CLEANING_SUSTAINED_MIN: 20  // cleaning_started: 모션 지속 (게스트와 구분)
CLEANING_DONE_QUIET_MIN:10  // cleaning_finished: 조용 지속

// 퇴실 의심
CHECKOUT_GRACE_MIN:     20  // checkout_confirmation_needed 발동 grace
SUSPICION_EXPIRE_MIN:  120  // 의심 상태 최대 유효 기간

// 체크인
NO_SHOW_WINDOW_MIN:     60  // no_show_suspected 발동 기준
```

---

## 7. 파일 구조

```
src/application/
  occupancyMonitor.js        기존 유지 + SensorEventGenerator/SuspicionTracker 통합
  sensorEventGenerator.js    NEW: EXIT/ENTRY 감지
  suspicionTracker.js        NEW: 의심→확신 상태 관리
src/config/
  monitoringThresholds.js    기존 + 새 파라미터 추가
server/
  occupancyWatcher.js        reservation에 checkIn 추가
tests/unit/
  s14.occupancy-monitor.test.js  업데이트
  s15.sensor-event.test.js   NEW
  s16.suspicion-tracker.test.js  NEW
```

---

## 8. 폴링 모델 한계 (알려진 제약)

30초 폴링이므로:
- 도어가 30초 이내에 열렸다 닫히면 transition 미감지 가능
- ENTRY_SUSTAINED_MIN을 최소 60초 이상으로 설정해야 단일 폴링 노이즈를 방지
- 해결책: HA WebSocket push 이벤트로 전환 시 정밀도 대폭 향상 (미래 과제)
