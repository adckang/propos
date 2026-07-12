# Room State Machine
> PROPOS 숙소 상태 전환 규칙 정본
> 버전: v2.1 | 업데이트: 2026-07-02

---

## 1. 구조 원칙

- **Main Status**가 최상위 컨테이너다.
- **Sub-Status**는 Main Status 내부에 포함된다.
- **Event**는 상태 사이를 연결하는 전환 트리거다. Event 자체는 독립 상태가 아니다.
- 초기 상태: `VACANT / CLEANING_FINISHED`

---

## 2. 전체 상태 목록

| Main Status      | Sub-Status              | 한국어           | 비고       |
|------------------|-------------------------|------------------|------------|
| VACANT           | CLEANING_FINISHED       | 공실 / 청소완료  | 초기 상태  |
| VACANT           | MAINTENANCE             | 공실 / 기타정비  |            |
| PRE_STAY_READY   | OPTIMIZING              | 입실전 / 최적화중 |           |
| PRE_STAY_READY   | OPTIMIZED               | 입실전 / 최적화완료 |         |
| OCCUPIED         | GOOD_CONDITION          | 체류중 / 상태좋음 |           |
| OCCUPIED         | ENERGY_WASTE            | 체류중 / 에너지낭비 |         |
| OCCUPIED         | ISSUE_COMPLAINT         | 체류중 / 민원발생 |           |
| OCCUPIED         | ISSUE_AND_ENERGY        | 체류중 / 민원+에너지낭비 | 복합 상태 |
| CLEANING         | CLEANING_PENDING        | 청소중 / 청소대기 |           |
| CLEANING         | CLEANING_IN_PROGRESS    | 청소중 / 청소진행중 |         |

---

## 3. 전체 이벤트 목록

| 이벤트                    | 설명                                                   |
|---------------------------|--------------------------------------------------------|
| `checkin_prep_time_reached` | 체크인 준비시간 도래 (스케줄러 발생, 아래 규칙 참고) |
| `reservation_cancelled`   | 예약 취소됨                                            |
| `maintenance_started`     | 정비 시작됨                                            |
| `maintenance_finished`    | 정비 완료됨                                            |
| `maintenance_required`    | 정비 필요 발생 (입실전 단계에서)                       |
| `optimization_finished`   | 숙소 최적화 완료                                       |
| `check_in_detected`       | 체크인 감지                                            |
| `energy_waste_detected`   | 에너지 낭비 감지                                       |
| `energy_waste_resolved`   | 에너지 낭비 해소됨                                     |
| `complaint_detected`      | 민원 / 위험 이벤트 감지                                |
| `complaint_resolved`      | 민원 / 위험 해소됨                                     |
| `check_out_detected`      | 체크아웃 감지                                          |
| `cleaning_started`        | 청소 시작됨                                            |
| `cleaning_finished`       | 청소 완료됨                                            |

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
VACANT / CLEANING_FINISHED
  -- checkin_prep_time_reached -->
VACANT / CLEANING_FINISHED → PRE_STAY_READY / OPTIMIZING

VACANT / CLEANING_FINISHED
  -- maintenance_started -->
VACANT / MAINTENANCE

VACANT / MAINTENANCE
  -- maintenance_finished -->
VACANT / CLEANING_FINISHED

VACANT / MAINTENANCE
  -- checkin_prep_time_reached -->
PRE_STAY_READY / OPTIMIZING
  [사이드이펙트] 운영자 알림 발생:
    내용: "정비 중 체크인 준비 시작 — 정비 완료 여부 확인 필요"
    운영자 선택지:
      A. 그대로 진행  → 현 상태 유지
      B. 시간 변경    → 스케줄러가 checkin_prep_time_reached 재발생 시점 재설정
      C. 예약 취소    → reservation_cancelled → VACANT / CLEANING_FINISHED
```

### B. PRE_STAY_READY / 입실전

```
PRE_STAY_READY / OPTIMIZING
  -- optimization_finished -->
PRE_STAY_READY / OPTIMIZED

PRE_STAY_READY / OPTIMIZING
  -- reservation_cancelled -->
VACANT / CLEANING_FINISHED

PRE_STAY_READY / OPTIMIZING
  -- maintenance_required -->
VACANT / MAINTENANCE
  [주의] 예약 취소 또는 보류는 예약 관리 시스템(비즈니스 레이어) 담당

PRE_STAY_READY / OPTIMIZED
  -- check_in_detected -->
OCCUPIED / GOOD_CONDITION

PRE_STAY_READY / OPTIMIZED
  -- reservation_cancelled -->
VACANT / CLEANING_FINISHED

PRE_STAY_READY / OPTIMIZED
  -- maintenance_required -->
VACANT / MAINTENANCE
  [주의] 예약 취소 또는 보류는 예약 관리 시스템(비즈니스 레이어) 담당
```

**`optimization_started` 제거 사유:**
OPTIMIZING 상태 진입 시 디스패처가 최적화 액션 시퀀스를 자동 실행한다.
완료되면 `optimization_finished` 이벤트가 발생한다.
`optimization_started`는 상태 변경이 없는 액션 트리거이므로 `getNextRoomState`에 등장하지 않는다.

### C. OCCUPIED / 체류중

**Sub-Status 4개 및 설계 원칙:**

민원(complaint)과 에너지낭비(energy_waste)는 시간차를 두고 독립적으로 발생·해소될 수 있다.
두 조건이 동시에 활성화된 상태를 `ISSUE_AND_ENERGY`로 분리하여 각각 독립 해소가 가능하다.

```
OCCUPIED / GOOD_CONDITION
  -- energy_waste_detected --> OCCUPIED / ENERGY_WASTE
  -- complaint_detected    --> OCCUPIED / ISSUE_COMPLAINT
  -- check_out_detected    --> CLEANING / CLEANING_PENDING

OCCUPIED / ENERGY_WASTE
  -- energy_waste_resolved --> OCCUPIED / GOOD_CONDITION
  -- complaint_detected    --> OCCUPIED / ISSUE_AND_ENERGY
  -- check_out_detected    --> CLEANING / CLEANING_PENDING

OCCUPIED / ISSUE_COMPLAINT
  -- complaint_resolved    --> OCCUPIED / GOOD_CONDITION
  -- energy_waste_detected --> OCCUPIED / ISSUE_AND_ENERGY
  -- check_out_detected    --> CLEANING / CLEANING_PENDING

OCCUPIED / ISSUE_AND_ENERGY
  -- complaint_resolved    --> OCCUPIED / ENERGY_WASTE    (에너지낭비 잔존)
  -- energy_waste_resolved --> OCCUPIED / ISSUE_COMPLAINT (민원 잔존)
  -- check_out_detected    --> CLEANING / CLEANING_PENDING
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

| # | From (Main/Sub) | Event | To (Main/Sub) | 알림 |
|---|---|---|---|---|
| 1 | VACANT/CLEANING_FINISHED | checkin_prep_time_reached | PRE_STAY_READY/OPTIMIZING | |
| 2 | VACANT/CLEANING_FINISHED | maintenance_started | VACANT/MAINTENANCE | |
| 3 | VACANT/MAINTENANCE | maintenance_finished | VACANT/CLEANING_FINISHED | |
| 4 | VACANT/MAINTENANCE | checkin_prep_time_reached | PRE_STAY_READY/OPTIMIZING | ✓ 운영자 알림 |
| 5 | PRE_STAY_READY/OPTIMIZING | optimization_finished | PRE_STAY_READY/OPTIMIZED | |
| 6 | PRE_STAY_READY/OPTIMIZING | reservation_cancelled | VACANT/CLEANING_FINISHED | |
| 7 | PRE_STAY_READY/OPTIMIZING | maintenance_required | VACANT/MAINTENANCE | |
| 8 | PRE_STAY_READY/OPTIMIZED | check_in_detected | OCCUPIED/GOOD_CONDITION | |
| 9 | PRE_STAY_READY/OPTIMIZED | reservation_cancelled | VACANT/CLEANING_FINISHED | |
| 10 | PRE_STAY_READY/OPTIMIZED | maintenance_required | VACANT/MAINTENANCE | |
| 11 | OCCUPIED/GOOD_CONDITION | energy_waste_detected | OCCUPIED/ENERGY_WASTE | |
| 12 | OCCUPIED/GOOD_CONDITION | complaint_detected | OCCUPIED/ISSUE_COMPLAINT | |
| 13 | OCCUPIED/GOOD_CONDITION | check_out_detected | CLEANING/CLEANING_PENDING | |
| 14 | OCCUPIED/ENERGY_WASTE | energy_waste_resolved | OCCUPIED/GOOD_CONDITION | |
| 15 | OCCUPIED/ENERGY_WASTE | complaint_detected | OCCUPIED/ISSUE_AND_ENERGY | |
| 16 | OCCUPIED/ENERGY_WASTE | check_out_detected | CLEANING/CLEANING_PENDING | |
| 17 | OCCUPIED/ISSUE_COMPLAINT | complaint_resolved | OCCUPIED/GOOD_CONDITION | |
| 18 | OCCUPIED/ISSUE_COMPLAINT | energy_waste_detected | OCCUPIED/ISSUE_AND_ENERGY | |
| 19 | OCCUPIED/ISSUE_COMPLAINT | check_out_detected | CLEANING/CLEANING_PENDING | |
| 20 | OCCUPIED/ISSUE_AND_ENERGY | complaint_resolved | OCCUPIED/ENERGY_WASTE | |
| 21 | OCCUPIED/ISSUE_AND_ENERGY | energy_waste_resolved | OCCUPIED/ISSUE_COMPLAINT | |
| 22 | OCCUPIED/ISSUE_AND_ENERGY | check_out_detected | CLEANING/CLEANING_PENDING | |
| 23 | CLEANING/CLEANING_PENDING | cleaning_started | CLEANING/CLEANING_IN_PROGRESS | |
| 24 | CLEANING/CLEANING_IN_PROGRESS | cleaning_finished | VACANT/CLEANING_FINISHED | |

**총 전환 수: 24개**

---

## 6. 구현 원칙

### getNextRoomState (순수 함수)

```
getNextRoomState(currentState, event)

입력:  { mainStatus: string, subStatus: string }, event: string
출력:  { mainStatus: string, subStatus: string }

규칙:
- 위 전환 테이블에 정의된 전환만 허용한다.
- 미정의 전환은 throw new Error(`invalid transition: ${mainStatus}/${subStatus} + ${event}`)
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
- reservation_cancelled 시 예약 관리 시스템 연동
- maintenance_required 시 예약 보류 / 취소 처리
- VACANT/MAINTENANCE + checkin_prep_time_reached 시 운영자 알림 발송
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
