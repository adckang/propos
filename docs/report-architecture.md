# PROPOS Report Architecture
> 버전: v1.1 | 작성: 2026-09-03 | 업데이트: 2026-09-03
> 구현 기준 문서 — 레포트 데이터 모델, 템플릿 정의, 분석 레이어의 정본.

---

## 관련 문서 관계

| 문서 | 역할 |
|------|------|
| **이 파일** (`report-architecture.md`) | **"무엇을 보여줄 것인가"** — 데이터 모델, 3-Axis 설계, 템플릿 정의, 분석 레이어, Scope 변형 규칙 |
| `reporting-feature-design.md` | **"어떻게 보여줄 것인가"** — 타임라인 필터 UX, KPI 타일 레이아웃, 요약 문장 규칙, Slack 알림 포맷, API 구현 가이드 |

> 데이터 모델·집계 규칙 변경 → 이 파일 먼저 수정.
> UI 배치·컴포넌트 변경 → `reporting-feature-design.md` 먼저 수정.

---

## 1. 3-Axis 설계 원칙

레포트는 3개의 독립 축으로 구성된다.

### Axis-1: Time Size (시간 단위)

| 값 | 설명 | 사용 뷰 |
|----|------|---------|
| `W` | Week — 주 단위 집계 | ListView |
| `D` | Day — 일 단위 집계 | ListView + DetailView |
| `H` | Hour — 시간 단위 집계 | DetailView |

### Axis-2: Tense (시제 — 4가지)

기존 Past/Current/Future 3분류에서 수정. "Current"가 실제로 3가지 의미를 혼용했기 때문에 분리.

| 값 | 명칭 | 의미 | 데이터 소스 |
|----|------|------|------------|
| `PAST` | 결과 | 닫힌 기간. 모든 데이터 확정. | Postgres events |
| `ACTIVE` | 진행 | 현재 진행 중인 기간. 완료분 + 실시간 + 남은 예정 혼합. | KV + Postgres + iCal |
| `NOW` | 실시간 | 이 순간의 스냅샷. H 단위에서만 순수 성립. ACTIVE의 Hour 특수케이스. | KV 전용 |
| `FUTURE` | 계획 | 아직 시작하지 않은 기간. 예정/계획만 존재. | iCal + cleaning_jobs |

> **ACTIVE vs NOW 구분 이유:**
> Week/Day 진행 중 기간("이번 주", "오늘")은 완료된 이벤트(Postgres)와 남은 예정(iCal)을
> 동시에 포함해야 한다. 반면 Hour 단위 "지금"은 실시간 스냅샷(KV)만으로 충분하다.

### Axis-3: Data Layer (데이터 레이어)

| 값 | 명칭 | 내용 |
|----|------|------|
| `S` | State Matrix | Room State x Sub-State 스냅샷 (NOW 전용) |
| `E` | Event Matrix | 이벤트 타입별 카운트 + resolution (PAST 전용) |
| `H` | Hybrid | 완료 이벤트 + 현재 상태 + 남은 예정 (ACTIVE 전용) |
| `F` | Schedule | 예정 일정 목록 (FUTURE 전용) |
| `A` | Analysis | 안심지수, 이상 강조, 요약 문장 (모든 셀에 부가) |

---

## 2. 9-Cell Matrix

```
              PAST (결과)            ACTIVE (진행)            FUTURE (계획)
          ┌──────────────────────┬──────────────────────┬──────────────────────┐
   WEEK   │ last_week            │ this_week            │ next_week            │
          │ Template-P           │ Template-A           │ Template-F           │
          │ (Event Matrix)       │ (Hybrid)             │ (Schedule)           │
          ├──────────────────────┼──────────────────────┼──────────────────────┤
    DAY   │ yesterday            │ today                │ tomorrow             │
          │ Template-P           │ Template-A           │ Template-F           │
          │ (Event Matrix)       │ (Hybrid)             │ (Schedule)           │
          ├──────────────────────┼──────────────────────┼──────────────────────┤
   HOUR   │ last_hour            │ NOW                  │ next event           │
          │ Template-P           │ Template-C           │ Template-F           │
          │ (Event list)         │ (State Snapshot)     │ (단건, 고정 1h 아님) │
          └──────────────────────┴──────────────────────┴──────────────────────┘
```

### 템플릿 적용 범위 (명시적)

| 템플릿 | 적용 가능 셀 | 적용 불가 셀 |
|--------|------------|------------|
| Template-C (State Matrix) | H x NOW | 나머지 8개 셀 전부 |
| Template-P (Event Matrix) | W x PAST, D x PAST, H x PAST | 나머지 6개 셀 |
| Template-A (Hybrid) | W x ACTIVE, D x ACTIVE | 나머지 7개 셀 |
| Template-F (Schedule) | W x FUTURE, D x FUTURE, H x FUTURE | 나머지 6개 셀 |
| A-Layer (Analysis) | 모든 셀에 부가 | 없음 |

---

## 3. 데이터 포함관계 (Containment Hierarchy)

### 3-1. Room State Tree (10개 상태 — room-state-machine.md 정본)

```
Room State
│
├─ VACANT
│   ├─ CLEANING_FINISHED          초기/정상 공실 (초기 상태)
│   └─ MAINTENANCE                정비 중 (미구현)
│
├─ PRE_STAY_READY
│   ├─ OPTIMIZING                 체크인 준비 실행 중
│   └─ OPTIMIZED                  준비 완료, 체크인 대기
│
├─ OCCUPIED
│   ├─ GOOD_CONDITION             정상 체류 (진입 초기 상태)
│   ├─ ENERGY_WASTE               에너지낭비 단독 감지
│   ├─ ISSUE_COMPLAINT            민원 단독 감지
│   └─ ISSUE_AND_ENERGY           복합 이상 (최우선 — 두 조건 동시 활성)
│
└─ CLEANING
    ├─ CLEANING_PENDING            청소 대기 (check_out 직후)
    └─ CLEANING_IN_PROGRESS        청소 진행 중
```

**주의:**
- `CHECKIN_INQUIRY`는 room-state-machine.md에 없는 Sub-State. Mock data에만 존재. 레포트 집계에서 제외.
- State Matrix (Template-C)는 위 10개 상태만 집계 대상으로 삼는다.

### 3-2. 이벤트 분류표

Resolution 열은 ANOMALY 그룹에만 적용. LIFECYCLE/OPERATIONS는 발생 사실(fact)이므로 resolution 개념 없음.

| 그룹 | 이벤트 | 상태 전환 (From → To) | Count | Resolution |
|------|--------|----------------------|-------|------------|
| **LIFECYCLE** | `check_in_detected` | PRE_STAY_READY/OPTIMIZED → OCCUPIED/GOOD | O | X |
| | `check_out_detected` | OCCUPIED/* → CLEANING/PENDING | O | X |
| | `checkin_prep_time_reached` | VACANT/* → PRE_STAY_READY/OPTIMIZING | O | X |
| | `reservation_cancelled` | VACANT 자기전환 | O | X |
| **OPERATIONS** | `optimization_finished` | OPTIMIZING → OPTIMIZED | O | X |
| | `cleaning_started` | CLEANING_PENDING → IN_PROGRESS | O | X |
| | `cleaning_finished` | IN_PROGRESS → VACANT/CLEANING_FINISHED | O | X |
| **ANOMALY** | `energy_waste_detected` | → ENERGY_WASTE / ISSUE_AND_ENERGY | O | O (Auto/Manual/Pending) |
| | `energy_waste_resolved` | → GOOD_CONDITION / ISSUE_COMPLAINT | O | O |
| | `complaint_detected` | → ISSUE_COMPLAINT / ISSUE_AND_ENERGY | O | O (severity별 분리) |
| | `complaint_resolved` | → GOOD_CONDITION / ENERGY_WASTE | O | O |
| **SOFT** | `checkout_confirmation_needed` | 없음 | O | acknowledged Y/N |
| | `early_checkin_suspected` | 없음 | O | acknowledged Y/N |
| | `no_show_suspected` | 없음 | O | acknowledged Y/N |
| **OPERATIONAL ALERT** | `vacancy_energy_alert` | 없음 (State Machine 외부) | O | O (별도 섹션) |
| **GLOBAL (미구현)** | `maintenance_required/started/finished` | VACANT/MAINTENANCE | 예약 | 예약 |

---

## 4. 템플릿 정의

---

### Template-C — State Snapshot

**적용:** H x NOW 전용 (KV 실시간)
**Scope:** All-Properties 또는 Single-Property

#### All-Properties 형식

```
실시간 상태 스냅샷 — N개 숙소 (KV 기준)
┌────────────────┬──────────────────────────┬───────┬──────────────┐
│ Main State     │ Sub State                │ Count │ Flag         │
├────────────────┼──────────────────────────┼───────┼──────────────┤
│ OCCUPIED  (N)  │ GOOD_CONDITION           │   N   │              │
│                │ ENERGY_WASTE             │   N   │ ⚠            │
│                │ ISSUE_COMPLAINT          │   N   │ ⚠            │
│                │ ISSUE_AND_ENERGY         │   N   │ ❌ 최우선    │
├────────────────┼──────────────────────────┼───────┼──────────────┤
│ PRE_STAY  (N)  │ OPTIMIZING               │   N   │              │
│                │ OPTIMIZED                │   N   │ · 체크인대기  │
├────────────────┼──────────────────────────┼───────┼──────────────┤
│ CLEANING  (N)  │ CLEANING_PENDING         │   N   │ · 배정필요   │
│                │ CLEANING_IN_PROGRESS     │   N   │              │
├────────────────┼──────────────────────────┼───────┼──────────────┤
│ VACANT    (N)  │ CLEANING_FINISHED        │   N   │              │
│                │ MAINTENANCE              │   N   │ (미구현)     │
├────────────────┼──────────────────────────┼───────┼──────────────┤
│ TOTAL     (N)  │                          │   N   │              │
└────────────────┴──────────────────────────┴───────┴──────────────┘
[Soft 활성] no_show_suspected: N건 미확인 ⚠   ← State와 별도 표시
```

#### Single-Property 형식

단일 숙소는 State가 1개이므로 행이 1개. 현재 상태 + IoT 센서값 표시.

```
[홍대 원룸 A] 현재 상태
  OCCUPIED / ENERGY_WASTE  ⚠
  온도: 28°C  습도: 65%  소음: 42dB  전력: 1.8kW (높음)
  에너지낭비 감지: 23분 경과 (auto 처리 대기 중)
[Soft] 없음
```

---

### Template-P — Event Matrix

**적용:** W x PAST, D x PAST, H x PAST (Postgres events 테이블)
**Scope:** All-Properties 또는 Single-Property (property_id 필터)

#### 형식

LIFECYCLE/OPERATIONS는 Count 단일 열. ANOMALY만 Resolution 열 추가.

```
이벤트 결과 — {기간 레이블} (Postgres events)

[LIFECYCLE + OPERATIONS]
┌──────────────┬─────────────────────────────┬───────┐
│ 그룹         │ Event                       │ Count │
├──────────────┼─────────────────────────────┼───────┤
│ LIFECYCLE    │ check_in_detected           │   N   │
│              │ check_out_detected          │   N   │
│              │ checkin_prep_time_reached   │   N   │
│              │ reservation_cancelled       │   N   │
├──────────────┼─────────────────────────────┼───────┤
│ OPERATIONS   │ optimization_finished       │   N   │
│              │ cleaning_started            │   N   │
│              │ cleaning_finished           │   N   │
└──────────────┴─────────────────────────────┴───────┘

[ANOMALY — Resolution 포함]
┌──────────────┬──────────────────────────┬───────┬──────┬────────┬─────────┐
│ 그룹         │ Event                    │ Total │ Auto │ Manual │ Pending │
├──────────────┼──────────────────────────┼───────┼──────┼────────┼─────────┤
│ 에너지낭비   │ energy_waste_detected    │   N   │   N  │    N   │    N    │
│ (OCCUPIED)   │ energy_waste_resolved    │   N   │   N  │    -   │    -    │
├──────────────┼──────────────────────────┼───────┼──────┼────────┼─────────┤
│ 민원         │ complaint_detected       │   N   │      │        │         │
│              │   CRITICAL               │   N   │   N  │    N   │    N    │
│              │   HIGH                   │   N   │   N  │    N   │    N    │
│              │   WARN                   │   N   │   N  │    N   │    N    │
│              │ complaint_resolved       │   N   │   N  │    N   │    -    │
└──────────────┴──────────────────────────┴───────┴──────┴────────┴─────────┘

[SOFT — Acknowledged 포함]
┌──────────────┬──────────────────────────┬───────┬──────────────┐
│ 그룹         │ Event                    │ Count │ Acknowledged │
├──────────────┼──────────────────────────┼───────┼──────────────┤
│ Soft         │ no_show_suspected        │   N   │   Y / N      │
│              │ early_checkin_suspected  │   N   │   Y / N      │
│              │ checkout_confirmation_   │   N   │   Y / N      │
└──────────────┴──────────────────────────┴───────┴──────────────┘

[운영 알림 — VACANT 에너지낭비 (State Machine 외부)]
┌──────────────┬──────────────────────────┬───────┬──────┬────────┐
│              │ Event                    │ Count │ Auto │ Manual │
├──────────────┼──────────────────────────┼───────┼──────┼────────┤
│ 운영 알림    │ vacancy_energy_alert     │   N   │   N  │    N   │
└──────────────┴──────────────────────────┴───────┴──────┴────────┘

─────────────────────────────────────────
안심지수: N%   (이상 N건 — Auto N / Manual N / Pending N)
수동개입: N건
```

#### H x PAST 특수 형식 (last_hour)

주/일 단위와 달리 시간 단위는 이벤트 목록 (타임라인) 형식이 적합.

```
지난 1시간 이벤트 — {HH:mm} ~ {HH:mm}
  14:03  check_out_detected     홍대 원룸 A
  14:07  cleaning_started       홍대 원룸 A      (auto)
  14:31  energy_waste_detected  이태원 테라스    (WARN — auto 처리 중)
  14:52  energy_waste_resolved  이태원 테라스    (auto 21분 소요)
이벤트 4건  |  이상 1건 → 자동 해결
```

---

### Template-A — Active Hybrid

**적용:** W x ACTIVE (this_week), D x ACTIVE (today) 전용
**Scope:** All-Properties 또는 Single-Property

기간을 "현재 시각"을 기준으로 두 구간으로 분할하여 3개 섹션으로 표시.

#### 집계 규칙

Template-A는 **[완료]** + **[예정]** 두 섹션으로만 구성한다.

| 섹션 | 시간 범위 | 데이터 소스 |
|------|-----------|------------|
| [완료] | period_start(KST 00:00) ~ now | Postgres events (device_time 기준) |
| [예정] | now ~ period_end(KST 23:59 또는 일요일 23:59) | iCal + cleaning_jobs |

> **[현재] 섹션 없음:** 기존 설계에 있던 `[현재]` 섹션은 **KPI Tiles가 담당**한다. (섹션 11 참조)
> Template-A에서 중복 표시하지 않는다.
>
> **KST 기준 필수:** period_start/end는 KST(UTC+9) 자정 기준. UTC로 계산하면 한국 호스트의 "오늘"과 9시간 불일치 발생.

#### All-Properties 형식 (D x ACTIVE = today)

```
오늘 현황 — {M월 D일 (요일)} 기준 {HH:mm}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[완료] 오늘 {HH:mm}까지 처리된 이벤트 (Postgres)
  체크아웃 N건  |  체크인 N건  |  청소완료 N건
  이상감지 N건 → 자동 N / 수동 N / 미해결 N

[예정] 오늘 남은 일정 (iCal + cleaning_jobs)
  {HH:mm}  {숙소명}  체크인 예정   청소 ✅ / ⚠ 미배정
  {HH:mm}  {숙소명}  체크아웃 예정
  (예정 없으면 "오늘 남은 일정 없어요")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### All-Properties 형식 (W x ACTIVE = this_week)

```
이번 주 현황 — {M월 D일(월)} ~ {M월 D일(일)} 기준 {HH:mm}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[완료] 이번 주 {요일}까지 처리된 이벤트 (Postgres)
  체크아웃 N건  |  체크인 N건  |  청소완료 N건
  이상감지 N건 → 자동 N / 수동 N / 미해결 N
  현재까지 안심지수: N%

[예정] 이번 주 남은 일정 (iCal + cleaning_jobs)
  {요일} {HH:mm}  {숙소명}  체크인/아웃   청소 ✅/⚠
  ...
  청소 미배정: N건 ⚠ (해당 시 강조)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Single-Property 형식 (타임라인)

단일 숙소는 숫자 집계보다 시간 순서 표현이 더 유용.

```
[홍대 원룸 A] 오늘 타임라인

[완료]
  10:00  check_out_detected
  10:15  cleaning_started
  12:03  cleaning_finished

─── 지금 {HH:mm} ─── [현재 상태: VACANT / CLEANING_FINISHED]  ← 구분선만 표시

[예정]
  15:00  체크인 예정
         청소 완료 ✅  |  최적화 실행 예정 14:00
```

---

### Template-F — Schedule

**적용:** W x FUTURE, D x FUTURE, H x FUTURE 전용
**Scope:** All-Properties 또는 Single-Property

#### 청소 배정 연결 규칙

청소 job은 `check_out_detected` → `CLEANING/CLEANING_PENDING` 전환에서 발생.
따라서 청소 배정 상태는 **체크아웃 행에 표시**한다. 체크인 행에 표시하지 않는다.

```
다음 주 일정 — {M월 D일(월)} ~ {M월 D일(일)}
iCal 마지막 동기화: N분 전 ✅ / ⚠ N시간 전 (오래된 경우 강조)

┌──────────┬──────────────────────┬────────────────┬──────────────────────┐
│ 날짜     │ 체크아웃             │ 청소 배정      │ 체크인               │
├──────────┼──────────────────────┼────────────────┼──────────────────────┤
│ 월       │ N건 (HH:mm, HH:mm)  │ N/N ✅         │ N건 (HH:mm)          │
│ 화       │ 없음                 │ -              │ N건 (HH:mm, HH:mm)   │
│ 수       │ N건 (HH:mm)         │ 0/N ⚠ 미배정  │ N건 (HH:mm)          │
│ 목       │ 없음                 │ -              │ 없음                 │
│ 금       │ N건 (HH:mm)         │ N/N ✅         │ N건 (HH:mm)          │
│ 토       │ 없음                 │ -              │ N건 (HH:mm)          │
│ 일       │ 없음                 │ -              │ 없음                 │
└──────────┴──────────────────────┴────────────────┴──────────────────────┘
청소 미배정: N건 ⚠  |  총 체크인 N건 / 체크아웃 N건 예정
```

#### H x FUTURE 특수 형식 ("next event" — 고정 1시간 창 아님)

1시간 고정 창은 대부분 비어 있어 정보 밀도가 낮다.
대신 **오늘 남은 예정 중 가장 가까운 다음 이벤트 1건**을 표시한다.

```
다음 예정 이벤트:
  15:00 (1시간 23분 후)  홍대 원룸 A  체크인 예정
  청소 완료 ✅

  (오늘 남은 예정 없으면: "오늘 일정 모두 완료됐어요")
```

---

## 5. Scope 변형 규칙 (All-Properties vs Single-Property)

| 항목 | All-Properties | Single-Property |
|------|---------------|----------------|
| 트리거 | ListView (전체 숙소 집계) | DetailView (숙소 선택 후) |
| API 파라미터 | `property_id` 없음 | `property_id={id}` |
| Template-C | 전체 상태 분포 (N개 행) | 해당 숙소 상태 1행 + IoT 센서값 |
| Template-P | 전체 이벤트 집계 | 해당 숙소 이벤트만 필터 |
| Template-A | 전체 완료/현재/예정 | 해당 숙소 타임라인 형식 |
| Template-F | 날짜별 전체 일정표 | 해당 숙소 단일 일정 |
| 숫자 스케일 | N개 숙소 규모 | 주당 체크인/아웃 최대 1~2건 |

### Drill-Down 경로 (Scope 전환 포함)

```
[ListView — All-Properties Scope]
  W x ACTIVE (this_week, Template-A)
    ↕ 주/일 토글
  D x ACTIVE (today, Template-A)
    ↕ 스크롤
  D x PAST (yesterday, Template-P)
  D x FUTURE (tomorrow, Template-F)
    ↓ 숙소 행 클릭 → [Scope 전환]
─────────────────────────────────────────────────
[DetailView — Single-Property Scope]
  D x ACTIVE (today, Template-A 타임라인 형식)
    ↕ 일/시 토글
  H x NOW (Template-C 단일 숙소)
    ↕ 이전/지금/다음 네비게이션
  H x PAST (last_hour, Template-P 이벤트 목록)
  H x FUTURE (next event, Template-F 단건)
```

> **규칙:** ListView는 항상 All-Properties. DetailView는 항상 Single-Property.
> 두 Scope 사이는 "숙소 선택" 액션으로만 전환된다.
> ListView 안에서 H 단위로 드릴다운하지 않는다.

---

## 6. Analysis Layer (A-Layer)

모든 템플릿에 부가되는 분석 레이어.

### 6-1. 안심지수 (North Star Metric)

```
안심지수 = auto_resolved / total_anomalies × 100 (%)

분모 정의 (total_anomalies):
  complaint_detected   — OCCUPIED 내에서 발생. severity 무관 전수 포함.
  energy_waste_detected — OCCUPIED 내에서 발생 (State Machine 기준).

분모 제외:
  vacancy_energy_alert  — VACANT 에너지낭비는 별도 운영 알림 카운터로 분리.
  SOFT 이벤트           — no_show_suspected 등은 이상 감지 분모에 미포함.

분자 정의 (auto_resolved):
  resolution_type = 'auto'인 이상 이벤트 건수.

목표: 90% 이상 유지.
```

### 6-2. 이상 강조 규칙

| 조건 | 강조 방식 |
|------|-----------|
| ISSUE_AND_ENERGY 상태 숙소 존재 | State Matrix 해당 행 배경 `#fef2f2`, `❌` |
| Pending anomaly > 0 | 안심지수 수치 빨강, 해당 이벤트 행 `⚠` |
| 안심지수 < 70% | 안심지수 전체 구간 빨강 강조 |
| CLEANING_PENDING 건수 > 0 (체크인 12h 이내) | Template-F 해당 행 `⚠ 미배정` |
| no_show_suspected 미확인 | Template-C 하단 Soft 섹션 `⚠ N건 미확인` |
| iCal 마지막 동기화 > 2시간 경과 | Template-F 상단 동기화 시각 강조 |

### 6-3. 요약 문장 연결

A-Layer 요약 문장은 `reporting-feature-design.md` 섹션 4의 `generateSummary()` 규칙을 따른다.
이 파일에서 중복 정의하지 않는다.

---

## 7. VACANT 에너지낭비 — vacancy_energy_alert 설계

### 배경

`room-state-machine.md`에서 `energy_waste_detected`는 OCCUPIED 내부 전환에만 정의됨.
VACANT 상태의 에너지낭비는 State Machine 이벤트로 처리할 수 없음 (수정 금지 파일).

### 설계 결정

VACANT 에너지낭비는 State Machine 밖에서 **독립 운영 알림**으로 처리한다.

| 항목 | 결정값 |
|------|--------|
| 이벤트 타입 | `vacancy_energy_alert` |
| is_soft | `true` (상태 변경 없음) |
| 감지 조건 | mainStatus = VACANT이면서 전력소비 임계값 초과 30분+ 지속 |
| 감지 주체 | SensorEventGenerator (State Machine EventGuard를 거치지 않음) |
| 저장 | events 테이블 (is_soft=true, UNIMPLEMENTED_EVENT_TYPES에서 제외) |
| 안심지수 분모 | **미포함** (별도 카운터) |
| 자동 처리 | HA를 통해 소등/소냉 자동 실행 → `resolution_type = 'auto'` |
| 레포트 위치 | Template-P의 [운영 알림] 섹션 |
| Slack 알림 | 발생 즉시 발송 (일반 이상과 동일 채널) |

### eventTypes.js 추가 필요

```js
// 기존 SOFT_EVENT_TYPES에 추가
export const SOFT_EVENT_TYPES = new Set([
  'checkout_confirmation_needed',
  'early_checkin_suspected',
  'no_show_suspected',
  'vacancy_energy_alert',   // ← 추가
]);
```

---

## 8. Slack 레포트 ↔ 템플릿 매핑

Slack 레포트의 텍스트 포맷은 `reporting-feature-design.md` 섹션 11에서 정의.
이 파일에서는 **어느 템플릿/기간 데이터를 조합하는지**만 정의한다.

| Slack 레포트 | Cron | 사용 템플릿 | 기간 | Scope |
|-------------|------|------------|------|-------|
| 아침 브리핑 | daily-plan (KST 08:00) | Template-A(today) [완료+현재+예정] + Template-F(tomorrow) | today + tomorrow | All |
| 저녁 결산 | daily-result (KST 22:00) | Template-P(today 전체) + Template-F(tomorrow) | today + tomorrow | All |
| 주간 결산 | weekly (일 KST 22:00) | Template-P(last_week) + A-Layer(안심지수 전체) | last_week | All |
| 월간 보고서 | monthly (1일 KST 08:00) | Template-P(last_month) + 숙소별 A-Layer | last_month | Per-property 분해 |

### 매핑 규칙

- Slack에는 **텍스트 요약만** 발송. 표(table) 그대로 붙이지 않는다.
- 실제 표/데이터는 항상 웹 앱이 정본. Slack은 "볼 것 있음" 신호.
- Template 데이터 → `generateSummary()` → Slack 텍스트 변환은 `slackNotifier.js` 담당.

---

## 9. 데이터소스 매핑 요약

| 셀 | Period Key | Tense | 템플릿 | 소스 | KST 날짜 기준 |
|----|-----------|-------|--------|------|--------------|
| W x PAST | last_week | PAST | Template-P | Postgres | O |
| D x PAST | yesterday | PAST | Template-P | Postgres | O |
| H x PAST | last_hour | PAST | Template-P (목록) | Postgres | - (상대시간) |
| W x ACTIVE | this_week | ACTIVE | Template-A | KV + Postgres + iCal | O |
| D x ACTIVE | today | ACTIVE | Template-A | KV + Postgres + iCal | O |
| H x NOW | now | NOW | Template-C | KV 전용 | - |
| W x FUTURE | next_week | FUTURE | Template-F | iCal + cleaning_jobs | O |
| D x FUTURE | tomorrow | FUTURE | Template-F | iCal + cleaning_jobs | O |
| H x FUTURE | next_event | FUTURE | Template-F (단건) | iCal | - |

> **KST 날짜 기준 O 표시:** `getPeriodRange()`에서 UTC가 아닌 KST(UTC+9) 기준 자정으로
> period_start/period_end를 계산해야 한다. 현재 구현(UTC)은 버그 — `reportingDomain.js` 수정 필요.

---

## 10. 미결 사항 (구현 전 확정 필요)

| # | 항목 | 현황 | 우선순위 |
|---|------|------|---------|
| ~~1~~ | ~~`reportingDomain.js` KST 날짜 경계 수정~~ | ✅ 완료 (C-2) | ~~즉시~~ |
| ~~2~~ | ~~`api/stats.js` VALID_PERIODS에 today/yesterday/tomorrow 추가~~ | ✅ 완료 (C-1) | ~~즉시~~ |
| 3 | `countCurrentStats` anomalyCount에 ENERGY_WASTE 포함 여부 통일 | 보류 (H-2 rollback — 기존 테스트 명세 유지) | Phase 3 |
| ~~4~~ | ~~`roomStateMockData.js`에서 CHECKIN_INQUIRY 제거~~ | ✅ 완료 (H-1) | ~~Phase 2~~ |
| ~~5~~ | ~~`vacancy_energy_alert` eventTypes.js 추가~~ | ✅ 완료 | ~~Phase 2~~ |
| ~~6~~ | ~~Template-A 컴포넌트 신규 작성~~ | ✅ 완료 (`ActiveHybridPanel.jsx`) | ~~Phase 3~~ |
| ~~7~~ | ~~KPI Tiles 기간별 변형 구현 (섹션 11 기준)~~ | ✅ 완료 (ACTIVE/PAST/FUTURE 4타일) | ~~Phase 3~~ |
| 8 | Single-Property Template-A 타임라인 컴포넌트 | 설계 완료, 미구현 | Phase 3 |
| 9 | SOFT 이벤트 countPeriodEvents 집계 | ✅ 완료 (noShowSuspected 등 3개 필드) | ~~Phase 2~~ |
| 10 | resolution(Auto/Manual/Pending) 데이터 연동 → 안심지수 계산 완성 | 미구현 (현재 "—" 표시) | Phase 3 |
| 11 | EventMatrixPanel: SOFT 이벤트 섹션 | ✅ 완료 | ~~Phase 2~~ |
| 12 | iCal 연동 후 Template-F 날짜별 테이블, Template-A [예정] 섹션 | 미구현 (placeholder) | Phase 3 |

---

## 11. Navigation-Drives-Content 원칙

> **핵심 설계 원칙**: 네비게이션 위치(지난주/이번주/다음주 or 전날/오늘/내일 etc.)가
> 어떤 템플릿 섹션을 표시할지 결정한다. 중복 없이 맥락에 맞는 콘텐츠만 표시한다.

---

### 11-1. ListView (All-Properties Scope)

#### 주 모드 (W) — 지난주 / 이번주 / 다음주

| 네비게이션 | Tense | KPI Tiles 역할 | 펼쳐지는 Template 섹션 |
|---|---|---|---|
| 지난주 | PAST | 지난주 이벤트 카운트 (체크인N / 이상N / 안심지수N%) | Template-P: [결과] only |
| 이번주 | ACTIVE | **실시간 상태 카운트** (체류중N / 입실전N / 청소중N / 공실N) | Template-A: [완료 so far] + [예정 remaining] |
| 다음주 | FUTURE | 다음주 예정 카운트 (체크인N / 체크아웃N / 청소배정N) | Template-F: [계획] only |

#### 일 모드 (D) — 전날 / 오늘 / 내일

| 네비게이션 | Tense | KPI Tiles 역할 | 펼쳐지는 Template 섹션 |
|---|---|---|---|
| 전날 | PAST | 어제 이벤트 카운트 | Template-P: [결과] only |
| 오늘 | ACTIVE | **실시간 상태 카운트** (이번주 동일) | Template-A: [완료 so far] + [예정 remaining] |
| 내일 | FUTURE | 내일 예정 카운트 | Template-F: [계획] only |

> **이번주/오늘 KPI Tiles = [현재] 역할 대체.** Template 안에 [현재] 섹션을 따로 두지 않는다.

---

### 11-2. DetailView (Single-Property Scope)

#### 일 모드 (D) — 전날 / 오늘 / 내일

| 네비게이션 | Tense | KPI Tiles 역할 | 펼쳐지는 Template 섹션 |
|---|---|---|---|
| 전날 | PAST | 이 숙소 어제 이벤트 카운트 | Template-P: [결과] only (해당 숙소) |
| 오늘 | ACTIVE | **이 숙소 현재 상태** + IoT 센서 요약 | Template-A: [완료 so far] + [예정 remaining] (타임라인 형식) |
| 내일 | FUTURE | 이 숙소 내일 일정 카운트 | Template-F: [계획] only (해당 숙소) |

#### 시 모드 (H) — -1h / 지금 / +1h

| 네비게이션 | Tense | KPI Tiles 역할 | 펼쳐지는 Template 섹션 |
|---|---|---|---|
| -1h | PAST | 직전 1시간 이벤트 수 | Template-P: 시간 범위 이벤트 목록 |
| 지금 | NOW | **도어락·온도·습도·전력 실시간** | Template-C: State Snapshot + IoT 전체 |
| +1h | FUTURE | 다음 예정 이벤트 건수 | Template-F: 다음 이벤트 단건 |

> **DetailView [지금] = Template-C 완전체.** ListView에서는 Template-C가 요약에 그치지만,
> DetailView [지금] 모드에서 IoT 센서 전체(도어락/온도/전력)가 노출된다. 이것이 DetailView 드릴다운의 핵심 가치.

---

### 11-3. KPI Tiles 기간별 데이터 명세

All-Properties (ListView) KPI Tile 4개 기준:

| 기간 위치 | Tile 1 | Tile 2 | Tile 3 | Tile 4 |
|---|---|---|---|---|
| PAST (지난주/전날) | 체크인 N건 | 이상감지 N건 | 자동해결 N건 | 안심지수 N% |
| ACTIVE (이번주/오늘) | 체류중 N | 입실전 N | 청소중 N | 공실 N |
| FUTURE (다음주/내일) | 체크인 예정 N | 체크아웃 예정 N | 청소배정 N/N | - |

Single-Property (DetailView) KPI Tile 기준:

| 기간 위치 | Tile 1 | Tile 2 | Tile 3 | Tile 4 |
|---|---|---|---|---|
| PAST (전날/-1h) | 이벤트 총 N건 | 이상 N건 | - | - |
| ACTIVE (오늘) | **현재 State** | IoT 센서 요약 | 이상 상태 여부 | - |
| NOW (지금) | 도어락 상태 | 온도/습도 | 전력 | 경보 여부 |
| FUTURE (내일/+1h) | 다음 체크인 | 다음 체크아웃 | 청소 배정 | - |
