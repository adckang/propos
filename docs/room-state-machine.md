# Room State Machine
> PROPOS 숙소 상태 전환 규칙 정본
> 버전: v2.5 | 업데이트: 2026-11-06 · 센서 기반 입실 준비

---

## 1. 구조 원칙

- **Main Status**가 최상위 컨테이너다.
- **Sub-Status**는 Main Status 내부에 포함된다.
- **Event**는 상태 사이를 연결하는 전환 트리거다. Event 자체는 독립 상태가 아니다.
- 초기 상태: `VACANT / CLEANING_FINISHED`
- **글로벌 이벤트**: 특정 상태에 묶이지 않고 모든 Main Status에서 발생할 수 있는 이벤트. 코드에서 GLOBAL_TRANSITIONS로 분리 관리. 중복 정의 금지.
- **OCCUPIED 공통 이벤트**: 4개 Sub-Status에서 동일하게 발생하는 이벤트. 코드에서 OCCUPIED_COMMON으로 분리 관리.

---

## 2. 전체 상태 목록

| Main Status      | Sub-Status              | 한국어           | 비고       |
|------------------|-------------------------|------------------|------------|
| VACANT           | CLEANING_FINISHED       | 공실 / 청소완료  | 초기 상태. 에너지 정상 기준선. |
| VACANT           | ENERGY_WASTE            | 공실 / 에너지낭비 | 공실 중 과다 에너지 감지 시 진입 |
| VACANT           | MAINTENANCE             | 공실 / 기타정비  | 글로벌 이벤트로 진입 |
| PRE_STAY_READY   | OPTIMIZING              | 입실전 / 최적화중 |           |
| PRE_STAY_READY   | OPTIMIZED               | 입실전 / 최적화완료 |         |
| PRE_STAY_READY   | OPTIMIZATION_FAILED     | 입실전 / 최적화실패 | 중요 센서·장치 실패·안전 중단 |
| OCCUPIED         | GOOD_CONDITION          | 체류중 / 상태좋음 |           |
| OCCUPIED         | ENERGY_WASTE            | 체류중 / 에너지낭비 |         |
| OCCUPIED         | ISSUE_COMPLAINT         | 체류중 / 민원발생 |           |
| OCCUPIED         | ISSUE_AND_ENERGY        | 체류중 / 민원+에너지낭비 | 복합 상태 |
| CLEANING         | CLEANING_PENDING        | 청소중 / 청소대기 |           |
| CLEANING         | CLEANING_IN_PROGRESS    | 청소중 / 청소진행중 |         |

---

### 예약 기반 타임라인의 청소 구간

현재 상태 예측과 상세·리스트 타임라인은 `reservationCleaningWindow`를 공통으로 사용한다. DB에서 전달한 예약의 `cleaningAt`·`cleaningEnd`가 유효하면 그 시각을 우선하고, 없거나 잘못된 경우 기존 퇴실 + 기본 청소시간을 사용한다.

파주201처럼 퇴실이 11:00이고 Google 청소 예약이 12:00~15:00이면 다음과 같이 나눈다.

| 구간 | 예측 상태 |
| --- | --- |
| 11:00~12:00 | `CLEANING / CLEANING_PENDING` |
| 12:00~15:00 | `CLEANING / CLEANING_IN_PROGRESS` |
| 15:00 이후 | 다음 예약에 따른 체류·입실준비·공실 |

- 청소 중 새로고침해도 예약 종료 15:00을 유지한다. 현재 시각부터 기본 청소시간을 다시 더하지 않는다.
- 다음 입실이 청소 종료와 같은 15:00이어도 체류 구간을 포함한다. 입실준비 구간은 청소 종료보다 앞서 시작하지 않는다.
- 대기·진행 구간에는 원래 퇴실 키 `cleaningCheckoutAt`을 보존한다. 현재 시각으로 잘린 구간과 미래 예약도 이 키로 담당자를 찾으며, 담당자 인디케이터는 진행 구간에 한 번만 표시한다.
- 위 규칙은 예약 기반 화면 예측이다. 센서 감지로 발생하는 실제 `cleaning_started`·`cleaning_finished` 이벤트의 전환 규칙은 아래 정의를 따른다.

### 지난 타임라인 (예약 기록 기반)

Airbnb iCal·Google Calendar는 지난 일정을 내보내지 않지만 PROPOS는 동기화한 예약·청소 기록을 지우지 않는다. 지난 구간은 이 기록을 뼈대로 미래와 같은 순서로 다시 그린다 (`buildReservationHistorySegments`).

| 구간 | 상태 |
| --- | --- |
| 앞 청소 종료 ~ 체크인 1시간 전 | `VACANT / CLEANING_FINISHED` |
| 체크인 1시간 전 ~ 30분 전 | `PRE_STAY_READY / OPTIMIZING` |
| 체크인 30분 전 ~ 체크인 | `PRE_STAY_READY / OPTIMIZED` |
| 체크인 ~ 퇴실 | `OCCUPIED / GOOD_CONDITION` |
| 퇴실 ~ 청소 종료 | 위 청소 구간 규칙과 동일 |

- 숙소 상세·리스트 타임라인(`deriveTimeline`)과 대시보드 캘린더(숙소 1곳 선택 시)가 같은 함수를 쓴다. 숙박 한 번의 순서(`appendStayCycle`)는 미래 예측과도 같은 함수다.
- 지금을 포함하는 구간이 현재 상태다(경계 판정은 `deriveCurrentState`와 같다: 청소 종료 정각이면 청소중이 아니라 공실).
- 첫 예약 이전처럼 기록이 없는 기간은 그리지 않는다. 기간이 겹치는 예약(중복 행, 날짜가 바뀐 예약의 옛 행)은 하나의 숙박으로 합친다(가장 이른 체크인 ~ 가장 늦은 체크아웃, 청소는 가장 늦게 퇴실하는 예약 기준).
- 청소가 다음 입실 시각을 넘기면 타임라인의 청소 대기·진행 표시와 다음 구간의 시작 기준을 입실 시각에서 함께 끊는다. 상세·리스트의 미래 예측에도 적용하며 두 번째 이후 예약을 누락하지 않는다. 저장된 청소 예정 시각·담당자·퇴실 연결 키는 바꾸지 않는다. 이는 표시 계산이며 실제 청소 완료나 센서 기반 환경 최적화 완료의 근거가 아니다.
- 감지기 이벤트(`check_out_detected` 등)는 지난 막대의 뼈대로 쓰지 않는다. 감지기가 응답하지 않으면 "청소중"이 다음 예약까지 이어지는 문제가 있었기 때문이다. 캘린더는 예약 기록이 시작되기 전 기간(또는 기록이 없는 숙소)만 감지기 기록으로 채운다.
- 지난 청소에는 담당자가 정해진 기록(`ASSIGNED`·`COMPLETED`)이 있을 때만 담당자를 표시한다. 기록이 없거나 갱신되지 않은 지난 청소에 "미배정"을 붙이지 않는다.

---

## 3. 이벤트 목록

### 3A. 글로벌 이벤트 (모든 Main Status에서 발생 가능)

중복 정의 없이 `GLOBAL_TRANSITIONS`로 관리. 상태별 TRANSITIONS에 포함하지 않는다.

| 이벤트 | 트리거 | 전환 대상 | 구현 |
|--------|--------|-----------|------|
| `maintenance_required` | Google Calendar 정비 일정 도래 | `VACANT / MAINTENANCE` | 미구현 |
| `maintenance_started` | 모션/도어 감지 → 운영자 확인 "방문하셨습니까?" | `VACANT / MAINTENANCE` | 미구현 |
| `maintenance_finished` | 모션/도어 부재 → 운영자 확인 "완료하셨습니까?" | `VACANT / CLEANING_FINISHED` | 미구현 |

**구현 방식:** 청소와 동일 구조 — 캘린더 기반 예약 → 방문/퇴장 이벤트 감지 → 운영자 확인 다이얼로그 → 상태 전환.  
실제 정비는 항상 VACANT/MAINTENANCE 상태에서 진행. OCCUPIED 중 일정이 잡혀도 체크아웃 후 처리.

### 3B. 상태별 이벤트

| 이벤트 | 설명 |
|--------|------|
| `checkin_prep_time_reached` | 체크인 준비시간 도래 (스케줄러 발생, 아래 규칙 참고) |
| `reservation_cancelled` | 예약 취소됨 — VACANT 기간에만 발생. 체크인 당일 취소 불가 원칙. |
| `optimization_finished` | 숙소 최적화 완료 |
| `check_in_detected` | 체크인 감지 |
| `energy_waste_detected` | 에너지 낭비 감지 (OCCUPIED 전용) |
| `energy_waste_resolved` | 에너지 낭비 해소됨 (OCCUPIED 전용) |
| `vacant_energy_waste_detected` | 공실 중 에너지 과다사용 감지 (VACANT 전용) |
| `vacant_energy_waste_resolved` | 공실 중 에너지낭비 자동 절전처리 완료 (VACANT 전용) |
| `complaint_detected` | 민원 / 위험 이벤트 감지 |
| `complaint_resolved` | 민원 / 위험 해소됨 |
| `check_out_detected` | 체크아웃 감지 — **OCCUPIED 4개 Sub-Status 공통** (`OCCUPIED_COMMON`) |
| `cleaning_started` | 청소 시작됨 |
| `cleaning_finished` | 청소 완료됨 |

### `checkin_prep_time_reached` 발생 규칙 (스케줄러 담당)

```
기본값:
  체크인 1시간 전에 발생
  기본 체크인 시간 = 15:00 → 14:00에 발생

게스트 도착 시간이 메시지로 확인된 경우:
  해당 시간 기준 1시간 전으로 재설정

청소 완료 시점에 체크인까지 1시간 미만 남은 경우:
  cleaning_finished 전환 즉시 발생
  (스케줄러가 cleaning_finished 시점에 잔여 시간 재계산)
```

---

## 4. 전환 규칙

### A. VACANT / 공실

```
VACANT / CLEANING_FINISHED   ← 에너지 정상 기준 상태 (= GOOD_CONDITION for VACANT)
  -- checkin_prep_time_reached -->
PRE_STAY_READY / OPTIMIZING

VACANT / CLEANING_FINISHED
  -- reservation_cancelled -->
VACANT / CLEANING_FINISHED  (상태 유지, 비즈니스 레이어에서 처리)

VACANT / CLEANING_FINISHED
  -- vacant_energy_waste_detected -->
VACANT / ENERGY_WASTE

VACANT / ENERGY_WASTE
  -- vacant_energy_waste_resolved -->
VACANT / CLEANING_FINISHED  (자동 절전처리 완료 → 정상 복귀)

VACANT / ENERGY_WASTE
  -- checkin_prep_time_reached -->
PRE_STAY_READY / OPTIMIZING  (에너지낭비 상태에서도 체크인 준비 진입 허용)

> **설계 원칙:** VACANT/MAINTENANCE 상태에서는 `vacant_energy_waste_detected`가 유효하지 않다
> (isValidTransition = false). 정비 중 에너지 사용은 정상 운영으로 간주한다.

VACANT / MAINTENANCE
  -- checkin_prep_time_reached -->
PRE_STAY_READY / OPTIMIZING
  [사이드이펙트] 운영자 알림 발생:
    내용: "정비 중 체크인 준비 시작 — 정비 완료 여부 확인 필요"
    운영자 선택지:
      A. 그대로 진행  → 현 상태 유지
      B. 시간 변경    → 스케줄러가 checkin_prep_time_reached 재발생 시점 재설정
      C. 예약 취소    → 비즈니스 레이어 → VACANT / CLEANING_FINISHED
```

> **주의:** `maintenance_started` / `maintenance_finished` / `maintenance_required` 는 글로벌 이벤트 (3A 참고). VACANT/MAINTENANCE 진입과 탈출은 GLOBAL_TRANSITIONS에서 관리.

### B. PRE_STAY_READY / 입실전

```
PRE_STAY_READY / OPTIMIZING
  -- optimization_finished -->
PRE_STAY_READY / OPTIMIZED

PRE_STAY_READY / OPTIMIZED
  -- check_in_detected -->
OCCUPIED / GOOD_CONDITION
```

> **설계 원칙:** `reservation_cancelled`는 VACANT 기간에만 발생. 체크인 당일(PRE_STAY_READY) 취소는 운영 정책상 불가. PRE_STAY_READY에서 캘린더가 VACANT로 돌아온 경우 → 비즈니스 레이어에서 INITIAL_STATE로 직접 복귀.  
> `maintenance_required` / `maintenance_started` / `maintenance_finished` → 글로벌 이벤트 (3A).

**`optimization_started` 제거 사유:**
실제 최적화는 [센서 기반 입실 준비 명세](pre-stay-optimization.md)의 숙소 영역·센서·장치·알림 사전 검사를 통과해야 실행한다.
모든 지정 방의 실제 온습도가 목표를 5분 유지해야 `optimization_finished`가 발생한다. 입실 30분 전이라는 시간만으로 완료하지 않는다.
`optimization_started`는 상태 변경이 없는 액션 트리거이므로 `getNextRoomState`에 등장하지 않는다.

### C. OCCUPIED / 체류중

**OCCUPIED_COMMON (4개 Sub-Status 공통):**
```
모든 OCCUPIED Sub-Status
  -- check_out_detected -->
CLEANING / CLEANING_PENDING
```

**Sub-Status 4개 및 설계 원칙:**

민원(complaint)과 에너지낭비(energy_waste)는 시간차를 두고 독립적으로 발생·해소될 수 있다.
두 조건이 동시에 활성화된 상태를 `ISSUE_AND_ENERGY`로 분리하여 각각 독립 해소가 가능하다.

```
OCCUPIED / GOOD_CONDITION
  -- energy_waste_detected --> OCCUPIED / ENERGY_WASTE
  -- complaint_detected    --> OCCUPIED / ISSUE_COMPLAINT

OCCUPIED / ENERGY_WASTE
  -- energy_waste_resolved --> OCCUPIED / GOOD_CONDITION
  -- complaint_detected    --> OCCUPIED / ISSUE_AND_ENERGY

OCCUPIED / ISSUE_COMPLAINT
  -- complaint_resolved    --> OCCUPIED / GOOD_CONDITION
  -- energy_waste_detected --> OCCUPIED / ISSUE_AND_ENERGY

OCCUPIED / ISSUE_AND_ENERGY
  -- complaint_resolved    --> OCCUPIED / ENERGY_WASTE    (에너지낭비 잔존)
  -- energy_waste_resolved --> OCCUPIED / ISSUE_COMPLAINT (민원 잔존)
```

**대표 상태 우선순위 (집계·표시용):**

```
1. ISSUE_AND_ENERGY   (최고 우선순위)
2. ISSUE_COMPLAINT
3. ENERGY_WASTE
4. GOOD_CONDITION
```

### D. CLEANING / 청소중

```
CLEANING / CLEANING_PENDING
  -- cleaning_started -->
CLEANING / CLEANING_IN_PROGRESS

CLEANING / CLEANING_IN_PROGRESS
  -- cleaning_finished -->
VACANT / CLEANING_FINISHED
```

---

## 5. 전체 전환 테이블

### 5A. 글로벌 전환 (GLOBAL_TRANSITIONS — 모든 상태에서 유효)

| # | Event | To (Main/Sub) | 구현 |
|---|-------|---------------|------|
| G1 | maintenance_required | VACANT/MAINTENANCE | 미구현 |
| G2 | maintenance_started  | VACANT/MAINTENANCE | 미구현 |
| G3 | maintenance_finished | VACANT/CLEANING_FINISHED | 미구현 |

### 5B. OCCUPIED 공통 전환 (OCCUPIED_COMMON)

| # | From (Main/Sub) | Event | To (Main/Sub) |
|---|---|---|---|
| OC1 | OCCUPIED/\* (4개 전체) | check_out_detected | CLEANING/CLEANING_PENDING |

### 5C. 상태별 전환

| # | From (Main/Sub) | Event | To (Main/Sub) | 알림 |
|---|---|---|---|---|
| 1 | VACANT/CLEANING_FINISHED | checkin_prep_time_reached | PRE_STAY_READY/OPTIMIZING | |
| 2 | VACANT/CLEANING_FINISHED | reservation_cancelled | VACANT/CLEANING_FINISHED | (자기전환, 비즈니스 레이어 처리) |
| 3 | VACANT/CLEANING_FINISHED | vacant_energy_waste_detected | VACANT/ENERGY_WASTE | |
| 4 | VACANT/ENERGY_WASTE | vacant_energy_waste_resolved | VACANT/CLEANING_FINISHED | 자동 절전처리 완료 |
| 5 | VACANT/ENERGY_WASTE | checkin_prep_time_reached | PRE_STAY_READY/OPTIMIZING | |
| 6 | VACANT/MAINTENANCE | maintenance_finished | VACANT/CLEANING_FINISHED | ← (G3으로 커버, 중복 제거) |
| 7 | VACANT/MAINTENANCE | checkin_prep_time_reached | PRE_STAY_READY/OPTIMIZING | ✓ 운영자 알림 |
| 5 | PRE_STAY_READY/OPTIMIZING | optimization_finished | PRE_STAY_READY/OPTIMIZED | |
| 6 | PRE_STAY_READY/OPTIMIZED | check_in_detected | OCCUPIED/GOOD_CONDITION | |
| 7 | OCCUPIED/GOOD_CONDITION | energy_waste_detected | OCCUPIED/ENERGY_WASTE | |
| 8 | OCCUPIED/GOOD_CONDITION | complaint_detected | OCCUPIED/ISSUE_COMPLAINT | |
| 9 | OCCUPIED/ENERGY_WASTE | energy_waste_resolved | OCCUPIED/GOOD_CONDITION | |
| 10 | OCCUPIED/ENERGY_WASTE | complaint_detected | OCCUPIED/ISSUE_AND_ENERGY | |
| 11 | OCCUPIED/ISSUE_COMPLAINT | complaint_resolved | OCCUPIED/GOOD_CONDITION | |
| 12 | OCCUPIED/ISSUE_COMPLAINT | energy_waste_detected | OCCUPIED/ISSUE_AND_ENERGY | |
| 13 | OCCUPIED/ISSUE_AND_ENERGY | complaint_resolved | OCCUPIED/ENERGY_WASTE | |
| 14 | OCCUPIED/ISSUE_AND_ENERGY | energy_waste_resolved | OCCUPIED/ISSUE_COMPLAINT | |
| 15 | CLEANING/CLEANING_PENDING | cleaning_started | CLEANING/CLEANING_IN_PROGRESS | |
| 16 | CLEANING/CLEANING_IN_PROGRESS | cleaning_finished | VACANT/CLEANING_FINISHED | |

**전환 수:** 글로벌 3 + OCCUPIED 공통 1×4 + 상태별 18 = 총 25개 논리 전환 (중복 제거 후)

---

## 6. 구현 원칙

### getNextRoomState (순수 함수)

```
getNextRoomState(currentState, event)

입력:  { mainStatus: string, subStatus: string }, event: string
출력:  { mainStatus: string, subStatus: string }

우선순위:
  1. TRANSITIONS[key][event] — 상태별 전환 우선
  2. OCCUPIED_COMMON[event] — OCCUPIED 내부이면 공통 전환
  3. GLOBAL_TRANSITIONS[event] — 글로벌 전환 (fallback)
  4. throw new Error(`invalid transition: ${key} + ${event}`)

규칙:
- UI 상태, mock data, 외부 상태 직접 수정 금지.
- 알림 생성 금지. 알림은 디스패처(application layer)가 담당.
```

### 중복 이벤트 처리 (디스패처 담당)

IoT 센서는 같은 이벤트를 연속으로 보낼 수 있다.
중복 이벤트는 `getNextRoomState`에 도달하기 전에 디스패처가 제거한다.

```
제거 규칙:
  현재 상태에서 이미 활성화된 조건의 detected 이벤트는 무시한다.
  예: ENERGY_WASTE 상태에서 energy_waste_detected 재발생 → 무시
  예: ISSUE_AND_ENERGY 상태에서 complaint_detected 재발생  → 무시
```

---

## 7. 정상 운영 흐름 요약

```
VACANT / CLEANING_FINISHED
  -- checkin_prep_time_reached -->
PRE_STAY_READY / OPTIMIZING
  -- optimization_finished -->
PRE_STAY_READY / OPTIMIZED
  -- check_in_detected -->
OCCUPIED / GOOD_CONDITION
  -- (energy_waste_detected | complaint_detected | 해소 이벤트) -->
OCCUPIED / GOOD_CONDITION | ENERGY_WASTE | ISSUE_COMPLAINT | ISSUE_AND_ENERGY
  -- check_out_detected -->
CLEANING / CLEANING_PENDING
  -- cleaning_started -->
CLEANING / CLEANING_IN_PROGRESS
  -- cleaning_finished -->
VACANT / CLEANING_FINISHED
```

---

## 8. EventGuard (이벤트 선처리 레이어)

`getNextRoomState` 앞에서 비정상 이벤트를 걸러내는 전용 계층.

### 레이어 위치

```
IoT 센서 / 외부 시스템
    ↓ raw sensor data
[SensorEventGenerator]   ← 센서 → 이벤트 변환 (아래 섹션 참고)
    ↓ semantic events
[EventGuard]             ← stale check + validity check
    ↓ validated events
[Dispatcher]
    ↓
[getNextRoomState()]
```

### 필터 체인

```
수신 이벤트
    │
    ▼
① Stale Check
   event.timestamp < now - STALE_THRESHOLD ?
   → DROP  (warn log: "stale event dropped")
    │
    ▼
② Validity Check
   isValidTransition(currentState, event.type) ?
   → NO: DROP  (warn log: "invalid transition ignored")
    │
    ▼
  PASS → Dispatcher 전달
```

### Stale Threshold 기본값

| 이벤트 그룹 | STALE_THRESHOLD |
|---|---|
| checkin_prep_time_reached | 10분 |
| check_in_detected / check_out_detected | 5분 |
| energy_waste_* / complaint_* | 2분 |
| vacant_energy_waste_* | 2분 |
| cleaning_* / maintenance_* | 10분 |
| reservation_cancelled | 30분 |

---

## 9. SensorEventGenerator (센서 → 이벤트 변환 레이어)

원시 센서 데이터를 상태 기계 이벤트로 변환하는 계층.
`complaint_detected/resolved`, `energy_waste_detected/resolved` 4개 이벤트를 생성한다.

### 에너지낭비 — 지속 시간 기반 모델

```
원칙: 임계값을 N분 이상 연속으로 유지했을 때만 이벤트 발생
      중간에 값이 잠깐 내려가면 측정 타이머 리셋

SUSTAIN_DETECT  = 5분   (5분 연속 초과 → energy_waste_detected)
SUSTAIN_RESOLVE = 10분  (10분 연속 이하 → energy_waste_resolved)

SUSTAIN_RESOLVE > SUSTAIN_DETECT 이유:
  감지는 빨리, 해소는 확실하게 확인
```

실제 의미:
```
에어컨·주요 가전이 5분 내내 고전력 상태  → 감지
잠깐 꺼졌다가 바로 켜진 수준            → 미감지
정상 전력이 10분 내내 유지됨             → 해소
```

### 소음 민원 — 빈도 × 심각도 기반 모델 (슬라이딩 윈도우)

```
원칙: 순간 임계값 초과가 아닌, 10분 윈도우 내 누적 가중치 점수로 판단

심각도 레벨:
  CRITICAL  > 85dB   고성방가·파티·싸움 수준, 이웃이 즉시 민원
  HIGH      > 75dB   큰 음악·고성 대화, 이웃이 신경 쓰이는 수준
  WARN      > 65dB   평소보다 큰 대화·높은 TV 볼륨, 애매한 수준

가중치:
  CRITICAL × 8  /  HIGH × 3  /  WARN × 1

트리거: 10분 윈도우 내 Score >= 8

실제 의미:
  CRITICAL 1회              → score 8  → 즉시 감지 (파티음악 한 번도 충분)
  HIGH     3회              → score 9  → 감지 (10분에 3번 큰 소음)
  WARN     8회              → score 8  → 감지 (10분 40% 이상 소음)
  HIGH 1회 + WARN 5회       → score 8  → 감지 (복합 상황)

해소: score 0 상태 (65dB 미만) 10분 유지 → complaint_resolved
```

### complaint_detected 이벤트 페이로드

상태 기계 전환 자체는 severity와 무관하게 동일하다.
severity는 UI 표시·알림 발송 레이어에서만 사용한다.

```javascript
{
  type: 'complaint_detected',
  subType: 'noise',
  severity: 'CRITICAL' | 'HIGH' | 'WARN',
  score: 8,
  counts: { critical: 1, high: 0, warn: 0 }
}
```

### 폴링 주기

```
센서 폴링: 30초
→ 10분 윈도우 = 최대 20회 폴링
→ WARN 8회 이상 = 10분 중 40% 이상 소음 상태
```

### 상태 변경 로그 (별도 함수)

```
createStatusSegment(prevState, nextState, event, timestamp)
appendStatusTransitionLog(log, segment)

getNextRoomState 내부에서 호출하지 않는다.
```

### 비즈니스 레이어 담당 항목 (상태 기계 밖)

```
- 예약 수락 가능 여부 검증 (VACANT/MAINTENANCE 중 예약 생성 허용 여부 등)
- checkin_prep_time_reached 발생 시각 계산 및 스케줄링
- reservation_cancelled 시 예약 관리 시스템 연동 (VACANT 기간에만 해당)
- PRE_STAY_READY에서 iCal이 VACANT로 돌아온 경우 → INITIAL_STATE 직접 복귀 (비즈니스 레이어)
- VACANT/MAINTENANCE + checkin_prep_time_reached 시 운영자 알림 발송
- maintenance_* 이벤트 운영자 확인 다이얼로그 처리
```

## 10. 센서 기반 입실 준비 · 2026-11-06

요구사항·목표·안전 조건·저장·검증 정본은 [pre-stay-optimization.md](pre-stay-optimization.md)다. 예약 타임라인의 1시간/30분 전 구간은 화면 예측이며 실제 제어·완료 증거로 사용하지 않는다.

| 전이 ID | From | 이벤트 | To | 실행 의미 |
| --- | --- | --- | --- | --- |
| PREP-T01 | VACANT/CLEANING_FINISHED 또는 ENERGY_WASTE | check_in_detected | OCCUPIED/GOOD_CONDITION | 준비를 시작하지 않았다면 별도 `optimization_skipped` 기록 |
| PREP-T02 | PRE_STAY_READY/OPTIMIZING | check_in_detected | OCCUPIED/GOOD_CONDITION | 입실과 별개로 진행 중 환경 최적화 계속 |
| PREP-T03 | PRE_STAY_READY/OPTIMIZING | optimization_failed | PRE_STAY_READY/OPTIMIZATION_FAILED | 환경 장치 안전 정지·운영자 알림 |
| PREP-T04 | PRE_STAY_READY/OPTIMIZATION_FAILED | check_in_detected | OCCUPIED/GOOD_CONDITION | 입실 때문에 준비 실패 이력을 지우거나 재가동하지 않음 |
| PREP-T05 | PRE_STAY_READY의 준비 중·완료·실패 | optimization_cancelled | VACANT/CLEANING_FINISHED | 준비 제어 종료·대상 제외. 일반 공실 씬/도어락을 재실행하지 않음 |

손님 입실 후 발생한 `optimization_finished`는 제어 회차의 완료 기록으로 저장한다. OCCUPIED를 PRE_STAY_READY로 되돌리지 않는다. 생략·취소·실패·완료는 준비 실행 상태이며 이벤트 수신 파이프라인의 `events.status`와 다르다.
