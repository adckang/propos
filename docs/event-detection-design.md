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
        │  scheduled_checkout_reached / late_checkout_detected / check_in_detected /
        │  cleaning_started / cleaning_finished /
        │  checkout_confirmation_needed(early_checkout) / early_checkin_suspected / no_show_suspected
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

### 4-A. scheduled_checkout_reached · late_checkout_detected (RF-29, DEC-08)

객실 상태는 예약 체크아웃 시각을 기준으로 바꾼다. 실제 퇴실(EXIT) 확인은 전환을 늦추지 않고, 확인되지 않으면 문제로만 남긴다.

```
OCCUPIED 상태에서:

[checkOut 전 EXIT]         → CHECKOUT_SUSPECTED 기록 (상태 변경 없음)
[CHECKOUT_SUSPECTED + ENTRY] → 의심 취소 (나갔다가 다시 돌아옴)

[checkOut 시각 도래 — 예약당 1회]
  → scheduled_checkout_reached (발생 시각 = 예약 checkOut) → CLEANING / CLEANING_PENDING
  퇴실 확인 = 그 판정의 EXIT, 또는 CHECKOUT_SUSPECTED + 지금 모션 없음
  확인되지 않았으면 CHECKOUT_GRACE_MIN 동안 EXIT를 더 기다린다 (상태와 무관)
    — EXIT는 문 닫힘 + EXIT_NO_MOTION_MIN 뒤에 확정되므로 정시에 나간 손님도 전환 순간엔 미확인일 수 있다

[유예 안에 EXIT 확인]     → 문제 없음
[checkOut + GRACE 경과, 미확인] → late_checkout_detected 1건 (발생 시각 = 예약 checkOut, 상태 변경 없음)
[유예가 지난 뒤 처음 판정]  → 전환만, 지연 판정 안 함 (워처가 꺼져 있던 구간은 보지 못했다)
```

- "같은 퇴실" = 예약 uid + checkOut 시각. 연장으로 checkOut이 바뀌면 새 시각에 다시 전환한다.
- 판정 상태(유예 대기)는 메모리에만 있다 — 유예 20분 안에 워처가 재시작하면 그 예약의 지연 판정은 빠진다.
- 체류 중인데 보유 예약의 checkIn이 아직 미래면(전환 전에 예약이 바뀐 경우) 자동으로 바로잡지 않는다 — 체류 중 재시작은 상태·기기를 건드리지 않는다(s103). 운영자가 상태를 바꾸면 대기 중인 예약도 그때 쓴다.

- 예전의 Case A(`checkout_confirmation_needed` / `late_checkout`, 게스트 확인 요청)는 퇴실 지연 문제로 대체했다.
- Pi가 퇴실 전환 전에 다음 예약이나 "예약 없음"을 받으면 지난 예약을 전환이 끝날 때까지 보존한다(`planMonitoringReservationUpdate`).
- 옛 `check_out_detected` 기록은 같은 전환·건수로 계속 읽는다.

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
| `scheduled_checkout_reached` | 예약 checkOut 시각 도래 (예약당 1회) |
| `cleaning_started` | ENTRY + 모션 20분 지속 |
| `cleaning_finished` | EXIT + 10분 조용 |
| `energy_waste_detected/resolved` | 기존 로직 유지 |
| `complaint_detected/resolved` | 기존 로직 유지 |

### 문제 이벤트 (상태 변경 없음, 문제·이상 건수에 포함)
| 이벤트 | 발생 조건 |
|---|---|
| `late_checkout_detected` | checkOut + CHECKOUT_GRACE_MIN까지 실제 퇴실 미확인 (예약당 1건) |

### Soft 이벤트 (ConfirmationManager로 라우팅, 상태 변경 없음)
| 이벤트 | 의미 |
|---|---|
| `checkout_confirmation_needed` | 조기 퇴실 징후(early_checkout) — 청소 조기 배정 가능 |
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
CHECKOUT_GRACE_MIN:     20  // 예정 체크아웃 뒤 실제 퇴실을 기다리는 시간 → 지나면 late_checkout_detected
SUSPICION_EXPIRE_MIN:  120  // (RF-29 이후 퇴실 판정에 쓰지 않음 — 전환 때 의심을 지운다)

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
