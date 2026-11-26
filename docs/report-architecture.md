# PROPOS Report Architecture
> 버전 v1.4.2 | 작성 2026-09-03 | 업데이트 2026-11-14 · 정비·월간 상태 복원 범위 보완
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
| `ACTIVE` | 진행 | 현재 진행 중인 기간. 완료분 + 실시간 + 남은 예정 혼합. | Postgres(이벤트로 현재 상태 계산) + iCal 동기화 예약 — KV는 쓰지 않는다 |
| `NOW` | 실시간 | 이 순간의 스냅샷. H 단위에서만 순수 성립. ACTIVE의 Hour 특수케이스. | Postgres 이벤트 기록(현재 상태 계산) |
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
| `A` | Analysis | 안심지수(보조: 자동화 개선율, 계산 전 —), 이상 강조, 요약 문장 (모든 셀에 부가) |

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

### 3-1. Room State Tree (12개 상태 — room-state-machine.md 2절 정본)

```
Room State
│
├─ VACANT
│   ├─ CLEANING_FINISHED          초기/정상 공실 (초기 상태)
│   ├─ ENERGY_WASTE               공실 중 에너지 낭비 (7절)
│   └─ MAINTENANCE                정비 중 (수동 Pi·현재 상태 복원)
│
├─ PRE_STAY_READY
│   ├─ OPTIMIZING                 체크인 준비 실행 중
│   ├─ OPTIMIZED                  준비 완료, 체크인 대기
│   └─ OPTIMIZATION_FAILED        중요 센서·장치 실패·안전 중단
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
- `CHECKIN_INQUIRY`는 room-state-machine.md에 없는 Sub-State였다 — 가짜 데이터에서도 제거됐다(아래 표 H-1, 2026-11-19 코드에 없음 확인).
- State Matrix (Template-C)는 위 12개 상태만 집계 대상으로 삼는다. 상태 목록을 바꿀 때는 room-state-machine.md 2절이 먼저다.

### 3-2. 이벤트 분류표

LIFECYCLE/OPERATIONS는 발생 사실(fact)이므로 resolution 개념 없음. ANOMALY의 해결 여부는 이벤트별 열이 아니라 이상 1건 단위로 [6-1-1](#automation-rate)에서 판정한다(이벤트마다 Auto/Manual/Pending을 붙이던 Resolution 열은 2026-11-17 폐기).

| 그룹 | 이벤트 | 상태 전환 (From → To) | Count | Resolution |
|------|--------|----------------------|-------|------------|
| **LIFECYCLE** | `scheduled_checkin_reached` | 공실(정비 제외)·입실 준비·청소 중 → OCCUPIED/GOOD (입실 시각, DEC-10) | O (입실) | X |
| | `scheduled_checkout_reached` | OCCUPIED/* → CLEANING/PENDING (퇴실 시각, RF-29) | O (퇴실) | X |
| | `check_in_detected` · `check_out_detected` | 옛 기록 — 같은 전환·건수로 읽는다 | O | X |
| | `checkin_prep_time_reached` | VACANT/* → PRE_STAY_READY/OPTIMIZING | O | X |
| | `reservation_cancelled` | VACANT 자기전환 | O | X |
| **OPERATIONS** | `optimization_finished` | OPTIMIZING → OPTIMIZED | O | X |
| | `scheduled_cleaning_started` · `scheduled_cleaning_finished` | CLEANING_PENDING → IN_PROGRESS → VACANT/CLEANING_FINISHED (청소 일정, DEC-17) | X | X |
| | `cleaning_activity_started` · `cleaning_activity_finished` | 없음 — 실제 청소 시작·끝(청소시간 준수·청소 후 지표가 쓴다) | O | X |
| | `cleaning_started` | CLEANING_PENDING → IN_PROGRESS (일정이 없을 때·운영자 수동·옛 기록) | O | X |
| | `cleaning_finished` | IN_PROGRESS → VACANT/CLEANING_FINISHED (일정이 없을 때·운영자 수동·옛 기록) | O | X |
| **ANOMALY** | `energy_waste_detected` | → ENERGY_WASTE / ISSUE_AND_ENERGY | O | → 6-1-1 |
| | `energy_waste_resolved` | → GOOD_CONDITION / ISSUE_COMPLAINT | O | → 6-1-1 |
| | `complaint_detected` | → ISSUE_COMPLAINT / ISSUE_AND_ENERGY | O (severity별 분리) | → 6-1-1 |
| | `complaint_resolved` | → GOOD_CONDITION / ENERGY_WASTE | O | → 6-1-1 |
| | `late_checkout_detected` · `checkin_not_detected` · `cleaning_not_detected` · `detection_unconfirmable` | 없음 — 스케줄 안에서 퇴실·입실·청소가 확인되지 않음(퇴실 지연·입실 미감지·청소 미감지·확인 불가), 운영자에게 넘김 | O (이상) | → 6-1-1 |
| **SOFT** | `checkout_confirmation_needed` | 없음 | O | acknowledged Y/N |
| | `early_checkin_suspected` | 없음 | O | acknowledged Y/N |
| | `no_show_suspected` | 없음 — 옛 기록(`checkin_not_detected`로 바뀜, DEC-16) | O | acknowledged Y/N |
| | `sensor_precheck_failed` | 없음 — 퇴실·입실 하루 전·2시간 전 감지 센서 점검에서 꺼진 센서(미리 알림, 이상 아님, DEC-12) | X | X |
| **OPERATIONAL ALERT** | `vacant_energy_waste_detected` · `vacant_energy_waste_resolved` (빈방 에너지 낭비 — [7절](#vacant-energy-design)) | VACANT/CLEANING_FINISHED → ENERGY_WASTE → CLEANING_FINISHED | O | → 6-1-1 |
| **GLOBAL** | `maintenance_required` | VACANT/MAINTENANCE | 전용 집계 예약 | 예약 |
| | `maintenance_started` | VACANT/MAINTENANCE | 전용 집계 예약 | X |
| | `maintenance_finished` | VACANT/CLEANING_FINISHED | 전용 집계 예약 | X |

수동 정비의 Pi 처리·DB 저장·현재 상태 복원은 구현돼 있다. 지금·오늘 보고서는 정비 시작·완료를 주요 이벤트로 사용하고 `VACANT/MAINTENANCE`를 공실에 포함한다. 첫 정비 기록만 있는 숙소도 집계 대상이다. 같은 발생 시각의 이벤트는 현재 상태 조회에서 서버 기록 시각으로 순서를 보완한다. 두 시각이 모두 같은 경우의 실제 선후 관계에는 추가 근거가 필요하다. 월간 이벤트 상태 구간도 같은 주요 이벤트 목록을 사용한다. 기간별 정비 전용 카운터와 캘린더·모션 기반 자동 감지는 후속 설계 범위다.

정비 상태 복원 변경의 적용·검증·배포 상태는 [refactoring.md의 RF-13](refactoring.md#rf13-implementation)에서 관리한다.

단일 숙소의 월간 상태 구간은 월 시작 전 마지막 주요 이벤트와 그 뒤의 준비·이상 이벤트까지 함께 읽어 월초 상태를 복원한다. SQL 조회와 상태 재생 모두 발생 시각·서버 기록 시각 순서를 사용한다. 서버 기록 시각을 모두 생략한 기존 호출의 동시각 이벤트는 입력 순서를 유지한다. 월초 이전의 주요 이벤트도 월 안의 주요 이벤트도 없으면 상태 구간을 추측해 만들지 않는다.

---

## 4. 템플릿 정의

---

### Template-C — State Snapshot

**적용:** H x NOW 전용 (이벤트 기록 기반 실시간)
**Scope:** All-Properties 또는 Single-Property

#### All-Properties 형식

```
실시간 상태 스냅샷 — N개 숙소 (이벤트 기록 기준)
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
│                │ OPTIMIZATION_FAILED      │   N   │ ❌ 준비 실패  │
├────────────────┼──────────────────────────┼───────┼──────────────┤
│ CLEANING  (N)  │ CLEANING_PENDING         │   N   │ · 배정필요   │
│                │ CLEANING_IN_PROGRESS     │   N   │              │
├────────────────┼──────────────────────────┼───────┼──────────────┤
│ VACANT    (N)  │ CLEANING_FINISHED        │   N   │              │
│                │ ENERGY_WASTE             │   N   │ ⚠            │
│                │ MAINTENANCE              │   N   │              │
├────────────────┼──────────────────────────┼───────┼──────────────┤
│ TOTAL     (N)  │                          │   N   │              │
└────────────────┴──────────────────────────┴───────┴──────────────┘
[문제] 입실 미감지: N건 ⚠   ← State와 별도 표시 (옛 no_show_suspected를 대체, DEC-16)
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

모든 그룹은 Count 열만 둔다. 자동/수동은 맨 아래 자동화 개선율 줄에서만([6-1-1](#automation-rate), 이상 1건 단위).

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

[ANOMALY — 이벤트 건수 (상태 표시용, 자동화 개선율의 분모 아님)]
┌──────────────┬──────────────────────────┬───────┐
│ 그룹         │ Event                    │ Total │
├──────────────┼──────────────────────────┼───────┤
│ 에너지낭비   │ energy_waste_detected    │   N   │
│ (OCCUPIED)   │ energy_waste_resolved    │   N   │
├──────────────┼──────────────────────────┼───────┤
│ 민원         │ complaint_detected       │   N   │
│              │   CRITICAL               │   N   │
│              │   HIGH                   │   N   │
│              │   WARN                   │   N   │
│              │ complaint_resolved       │   N   │
└──────────────┴──────────────────────────┴───────┘

[SOFT — Acknowledged 포함]
┌──────────────┬──────────────────────────┬───────┬──────────────┐
│ 그룹         │ Event                    │ Count │ Acknowledged │
├──────────────┼──────────────────────────┼───────┼──────────────┤
│ Soft         │ no_show_suspected        │   N   │   Y / N      │
│              │ early_checkin_suspected  │   N   │   Y / N      │
│              │ checkout_confirmation_   │   N   │   Y / N      │
└──────────────┴──────────────────────────┴───────┴──────────────┘

[운영 알림 — VACANT 에너지낭비 (State Machine 외부)]
┌──────────────┬──────────────────────────┬───────┐
│              │ Event                    │ Count │
├──────────────┼──────────────────────────┼───────┤
│ 운영 알림    │ 빈방 에너지 낭비 (§7)    │   N   │
└──────────────┴──────────────────────────┴───────┘

─────────────────────────────────────────
안심지수: N%   (측정 가능한 운영 지표 평균)
자동화 개선율: 92%  (진행 중 1건)
수동개입: 1건
```

측정 범위가 생긴 뒤 형식 (향후 예시 — 계산은 [6-1-1](#automation-rate)):

```
자동화 개선율: N%   (자동 N / 수동 N / 진행 중 N · 측정 범위 5 / 5)
수동개입: N건
```

#### H x PAST 특수 형식 (last_hour)

주/일 단위와 달리 시간 단위는 이벤트 목록 (타임라인) 형식이 적합.

```
지난 1시간 이벤트 — {HH:mm} ~ {HH:mm}
  14:03  check_out_detected     홍대 원룸 A
  14:07  cleaning_started       홍대 원룸 A
  14:31  energy_waste_detected  이태원 테라스    (WARN)
  14:52  energy_waste_resolved  이태원 테라스
이벤트 4건  |  자동화 개선율 92% (진행 중 1건)
```

---

### Template-A — Active Hybrid

**현재 적용:** W x ACTIVE (`this_week`), M x ACTIVE (`this_month`). D x ACTIVE (`today`)는 `TodayStatusPanel`이 현재 상태 집계만 보여준다.
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

#### All-Properties 형식 (D x ACTIVE = today, 최초 설계·현재 미구현)

```
오늘 현황 — {M월 D일 (요일)} 기준 {HH:mm}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[완료] 오늘 {HH:mm}까지 처리된 이벤트 (Postgres)
  체크아웃 N건  |  체크인 N건  |  청소완료 N건
  이상감지 N건 (상태 표시용 — 자동화 개선율의 분모 아님)

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
  이상감지 N건 (상태 표시용 — 자동화 개선율의 분모 아님)
  현재까지 안심지수: N%  ·  자동화 개선율: N% (진행 중 N건)

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

<a id="summary-noshow-policy"></a>

### 요약의 노쇼 안내 — 2026-11-23 없앰 (DEC-17)

- 2026-11-10에 정했던 "지난 기간 요약 끝에 `노쇼 의심 N건 확인이 필요해요.`" 안내는 **없앴다**. 노쇼 의심(soft)은 `입실 미감지` 문제(DEC-16)로 바뀌었고, 문제는 문제 목록·이상 건수에 이미 보인다 — 같은 일을 두 번 알리지 않는다. 옛 `noShowSuspected` 집계값은 그대로 두되 요약 문장에는 쓰지 않는다.
- 명시적 DEMO의 예정 요약도 같은 응답의 `stats.checkIns`를 그대로 사용한다. 숙소 선택 범위와 기간별 기존 문장 형식은 유지하며, 요약용 입실 건수를 독립 계산하지 않는다. 기본 HYBRID·REAL/SIMULATED 필터·fixture 저장 방식은 변경하지 않는다.

---

## 6. Analysis Layer (A-Layer)

모든 템플릿에 부가되는 분석 레이어.

<a id="safety-index"></a>

### 6-1. 안심지수 (North Star Metric)

> **정의 (DEC-02, 2026-11-17 사용자 확정):** 안심지수 = **최종적으로 성공한 비율** = 측정 가능한 운영 지표 성공률의 평균, 반올림 정수 %. 분모가 0이거나 분자가 없는 지표는 뺀다. 표 하단과 요약 등급이 같은 함수(`src/domain/operationalMetricsDomain.js`의 `computeSafetyIndex`)를 쓴다. 대표 지표이자 주간 결산의 주 지표다. 결정 기록은 [DEC-02](refactoring.md#dec02-result), 화면·Slack 표시는 [기능 설계 0-2](reporting-feature-design.md#safety-index-display).

<a id="safety-index-exclusions"></a>

#### 점수·비율에서 빼는 지표 (RF-26 — 사용자 승인·구현 완료 2026-11-17)

**결정 (2026-11-17, 사용자):** 성공·실패·측정 불가를 **명시적으로 판정한 기록**이 생기기 전까지 아래 4개 지표는 **안심지수 점수와 성공률 계산에서만** 뺀다. 실제로 감지된 실패와, 실패 건수로 찾는 패턴은 그대로 둔다. 실패 이벤트만 추가하는 방식으로 해결하지 않는다 — "대상 수 − 실패 기록 수"는 실패를 놓치면 그만큼 성공으로 세기 때문이다.

| 지표 | 지금 계산 | 빼는 이유 |
| --- | --- | --- |
| 퇴실 후 절전 | 퇴실 수 − `post_checkout_energy_waste_detected` 수 | 실패 이벤트를 만드는 코드가 DEMO 데이터뿐 |
| 퇴실 후 보안 | 퇴실 수 − `post_checkout_security_breach_detected` 수 | 〃 |
| 빈방 절전 유지 | 청소 완료 수 − `vacant_energy_waste_detected` 수 | 〃 |
| 빈방 보안 유지 | 청소 완료 수 − `post_cleaning_security_breach_detected` 수 | 〃 |

- 근거: [계산](../src/domain/operationalMetricsDomain.js#L27), 실패 이벤트 생성은 [DEMO](../src/application/demoReportingService.js#L40)에만 있다. 운영 DB(읽기 전용, 2026-11-17 13:05 KST 조회, `events` 전체 기간, 실제 숙소 = 파주201): 실제 숙소 이벤트는 2건(2026-08-06 입실·퇴실)뿐이고 실패 이벤트는 0건.

**지표마다 두 값을 나눈다**

| 값 | 뜻 | 쓰는 곳 |
| --- | --- | --- |
| `rateEligibility` | 성공률을 계산해도 되는지 — `eligible`(대상) / `excluded`(측정 제외: 판정 기록 없음) / `no_target`(대상 없음: 분모 0) / `no_data`(데이터 없음: 대상은 있는데 분자를 못 불러옴). 4개 지표는 항상 `excluded`가 먼저 | 안심지수 점수, 요약 등급, 표의 성공률 칸, 전월(전주) 대비 패턴 |
| `observedFailCount` | 실제로 감지된 실패 건수(4개 지표는 실패 이벤트 수). 데이터를 못 불러왔으면 없음 | 표의 실패 배지, 요약의 "(실패 N건)", 반복·쏠림·연속 패턴, 상세 실패 목록 |

- 표 아래 설명은 이유를 나눠 적는다: "측정가능 N개 지표 평균 · 4개는 판정 기록이 없어 측정 제외 · K개는 이 기간 대상 없음 · J개는 데이터를 못 불러와 제외".
- 요약 등급의 점수는 `eligible`만으로 낸다. "완벽해요"는 `observedFailCount` 합이 0일 때만이라, 4개 지표에 실제 실패가 있으면 완벽해요가 아니다.
- **계산 가능한 지표가 0개인데 실제 실패가 있으면**(사용자 결정 2026-11-17) 등급 없이 "지난주 실패 1건이 있었어요."로 말한다 — 진행 중 기간은 "이번 주 실패 1건이 있어요.". 기존 문장으로 넘기면 "이상 없었어요"라고 해 실패를 가리기 때문이다. 실패도 없으면 기존 문장 그대로다. 이 문장의 배너 색은 [기능 설계 0-2](reporting-feature-design.md#safety-index-display).
- 표의 성공률 칸: `excluded` → "측정 제외"(대상 건수는 0이어도 "0건"으로 유지), `no_data` → "데이터 없음", `no_target` → "해당 없음". 로딩 중 "준비 중"은 별도 상태다.

**데이터 경로 (반영됨)**

| 위치 | 예전 | 지금 |
| --- | --- | --- |
| `operationalMetricsDomain` `computeOperationalMetrics` | 지표마다 분자·분모 | `rateEligibility`·`observedFailCount`를 붙인다. 측정 제외 목록(4개)은 이 파일 한 곳 |
| `operationalMetricsDomain` `computeMeasurableMetrics` | 비율과 실패를 한 목록으로 | 둘로 나눈다 — 비율 대상(`eligible`) 목록, 실패 건수 목록(`observedFailCount`가 있는 모든 지표) |
| `computeSafetyIndex`·`describeSafetyIndexBasis`·`summarizeOperationalMetrics` | 측정 가능 목록 하나 | 점수는 비율 대상, 실패 합계는 `observedFailCount`, 빠진 이유 3가지 |
| `reportingService` `computeAggregateMetricsForRange` ([L216](../src/application/reportingService.js#L216)) | `computeMeasurableMetrics` 결과 하나를 돌려준다 | 비율 대상 목록과 실패 건수 목록을 따로 돌려준다 |
| `reportingService` `buildInsightDetectorInputs` ([L264](../src/application/reportingService.js#L264)) | 전월 대비(`currentAgg`·`previousAgg`)·연속(`periodHistory`)·반복·쏠림(`propertyMetricRows`)이 같은 목록을 쓴다 | 전월 대비는 비율 대상만, 연속·반복·쏠림은 `observedFailCount`(모든 지표) |
| `EventMatrixPanel`·`SharedMetricRow`·`metricRowDomain` | 성공률과 실패 배지 | 4개 행은 대상 건수와 실패 배지를 그대로 두고 성공률 칸만 "측정 제외". 값을 못 불러온 행은 "데이터 없음" |
| `reportSummaryDomain` `isUrgentSummary`·`SummaryBanner` | 배너 안에 경고 패턴 | 경고 판정을 도메인 한 곳으로 옮기고, "실패 N건이 있(었)어요" 문장에만 경고색을 더함 |
| `vite.config.mjs`(개발 스텁)·DEMO | 같은 도메인 함수 사용 | 같은 규칙(DEMO 포함) |

- 그대로 두는 것: 실패 이벤트 저장, 달력의 문제 배지, 상세 실패 목록(`metricDrilldownDomain`).
- 검증·변경 파일·남은 한계는 커밋 `a9c1d52` 메시지와 [RF-26](refactoring.md#rf26-result)에 있다.

<a id="automation-rate"></a>

### 6-1-1. 자동화 개선율 (보조 지표) — 계산·데이터 계약 정본

이상이 생겼을 때 관리자·운영자 개입 없이 처리된 비율. 결정과 작업 상태는 [RF-25](refactoring.md#rf-25), 화면·Slack 표시는 [기능 설계 0-2](reporting-feature-design.md#safety-index-display)가 맡는다. 이 절이 계산과 데이터 계약의 정본이다.

#### 계산

```
자동화 개선율 = 자동 해결 / (기간 안에 발생한 이상 − 대상 사라짐) × 100 (%)
```

- **판정 시점:** 보고 종류에 따라 다르다(아래 "보고 종류"). 판정 시점에 끝나지 않은 이상(진행 중·안정화 대기)은 분모에만 넣고 분자에는 넣지 않는다. 진행 중 건수는 따로 보인다.
- **미해결 종료:** 분모에 넣고 분자에는 넣지 않는다. 건수를 따로 보인다.
- **자동 해결:** 해결됐고, 발생부터 해결까지의 이력에 **관리자·운영자 개입 기록이 하나도 없는** 이상. 관리자가 개입한 뒤 시스템이 해결해도 수동이다. "사람이 전혀 관여하지 않음"이라는 뜻은 아니다 — 담당자가 예약 링크로 칸을 잡고 캘린더 알림이 관리자 손 없이 배정하면 자동, 관리자가 "캘린더 다시 확인"을 눌러 배정되면 수동이다.
- **대상 사라짐:** 예약 취소처럼 대상 자체가 없어진 이상만 분모에서 뺀다.
- 계산할 수 없으면 "—". 목표 90% 이상, 수동 개입 주당 0~1회.

#### 이상 기준 (정본 5가지)

| 이상으로 집계 (분모 포함) | 노이즈 — 제외 |
|---|---|
| 소음 임계값 초과 3분 이상 지속 | 3분 이내 자동 복귀 센서 스파이크 |
| 에너지 낭비 30분 이상 (공실 중 가동 확인) | 정상 체크인/아웃 프로세스 |
| 게스트 불만 키워드 + 센서 이상 동시 확인 (게스트 메시지 전후 60분 이내) | 단독 키워드 감지 (센서 정상인 경우) |
| 청소 미배정 (체크인 12시간 이내) | 24시간 이상 여유 있는 미배정 |
| IoT 기기 오프라인 30분 이상 | 정기 재시작/펌웨어 업데이트 |

- 정본 5가지에 해당하면 `is_soft` 여부와 관계없이 센다. `no_show_suspected` 같은 SOFT 이벤트는 정본 항목이 아니므로 세지 않는다.
- 기준을 바꾸면 `policy_version`을 올린다. 과거 건은 당시 기준 그대로 남는다(기준이 바뀌면 과거 지표와 비교할 수 없다).

<a id="automation-rate-scope"></a>

#### 측정 범위: 5 / 5 (2026-11-25)

체크인 12시간 이내 청소 미배정, 소음 3분 지속, 빈방 에너지 낭비 30분 지속, 기기 오프라인 30분 지속, 게스트 온습도 불만과 센서 이상 교차 확인 감지기가 정본 상태·이력 계약에 연결됐다. 비슷한 기록도 기준이 다르면 정본 항목에 대응시키지 않는다.

| 정본 항목 | 정본 기준 감지기 | 근거·기존 비슷한 기록 |
| --- | --- | --- |
| 소음 3분 이상 지속 | [`NoiseAnomalyDetector`](../src/application/noiseAnomalyDetector.js) → [`reconcileNoiseSignal`](../server/noiseAnomalies.js) | 체류 중 65dB 초과가 연속 3분일 때 내부 숙박에 묶어 발생시킨다. Pi 재시작에도 초과 시작·정상 확인 대기를 보존하고, 센서값 공백은 연속 시간에서 제외한다. 정상 시작 뒤 서버가 해당 사건에 저장된 안정화 완료 시각을 응답하면 그 시각에 다시 확인해 해결한다. 기존 Pi 불만 기록의 10분 누적 점수 상태 전환([`_noise`](../src/application/occupancyMonitor.js))은 바꾸지 않는다. 알림에는 `65dB 초과 · 기준: 3분 이상`과 실제 해결 기준을 함께 표시한다 |
| 빈방 에너지 낭비 30분 이상 | [`VacantEnergyAnomalyDetector`](../src/application/vacantEnergyAnomalyDetector.js) → [`reconcileVacantEnergySignal`](../server/vacantEnergyAnomalies.js) | 청소 완료 뒤 공실에서 기존 공실 절전 액션에 매핑된 냉난방·조명·TV·환기 장치의 실제 ON 상태가 연속 30분일 때 기존 `vacant_energy_waste_detected`를 발생시키고 절전한다. 전체 전력값은 냉장고 같은 상시 부하가 섞일 수 있어 새 기준으로 쓰지 않는다. Pi 재시작에도 가동 시작·정상 확인 대기를 보존하고, 장치 상태를 모르는 구간은 연속 시간에서 제외한다. 청소 완료 이벤트 ID로 공실 사건을 묶고 서버가 사건에 저장한 안정화 시간 뒤 정상 재확인으로 해결한다. 알림에는 `기준: 30분 이상`과 실제 해결 기준을 함께 표시한다 |
| 게스트 불만 키워드 + 센서 이상 | [`EnvironmentSensorAnomalyDetector`](../src/application/environmentSensorAnomalyDetector.js) + [`extractAirbnbGuestComplaint`](../src/domain/guestComplaintEmailDomain.js) → [`reconcileGuestComplaintSensorSignal`](../server/guestComplaintAnomalies.js) | 체류 중 온도·습도 이상이 연속 3분일 때 센서 신호를 남기고, 같은 Gmail의 신뢰한 Airbnb 발신자 답장에서 해당 불만 주제만 분류한다. Airbnb 숙소 ID를 iCal 숙소 ID와 연결해 같은 내부 숙박의 메시지 전후 60분 이내 센서 이상만 하나의 사건으로 묶는다. 메일 원문은 저장하지 않으며 메일·센서 도착 순서와 Pi 재시작을 보존한다. 정상 시작 뒤 사건에 저장된 안정화 시간만큼 재확인해 해결하고 알림에는 `메시지 전후 60분 이내`와 실제 해결 기준을 함께 표시한다 |
| 체크인 12시간 이내 청소 미배정 | [`reconcileCleaningUnassignedAnomalies`](../server/cleaning/_unassignedAnomalies.js) | 청소 의무별 추가 전용 배정 상태 이력으로 중간 배정·취소를 재생한다. 캘린더 자동 배정은 자동 해결, 관리자 직접 배정·"캘린더 다시 확인"은 개입으로 기록한다. 다음 체크인이 취소·변경되면 앞 사건을 대상 사라짐으로 끝내고 새 기준의 사건을 연다. 알림에는 `기준: 체크인 12시간 이내`와 실제 해결 기준을 함께 표시한다 |
| 기기 오프라인 30분 이상 | [`DeviceOfflineAnomalyDetector`](../src/application/deviceOfflineAnomalyDetector.js) → [`reconcileDeviceOfflineSignal`](../server/deviceOfflineAnomalies.js) | 호스트가 숙소의 HA 기기 매핑에 명시한 엔티티만 대상으로, 실제 `unavailable`이 연속 30분일 때 기기 식별자에 묶어 발생시킨다. HA 재시작 뒤 나올 수 있는 `unknown`과 상태 누락은 연속 시간에서 제외한다. 정기 재시작·펌웨어 작업은 기존 접힌 HA 설정에서 기기별 1·4·24시간 동안만 제외하며 종료 시각 뒤 자동으로 감시를 재개한다. Pi 재시작에도 연결 끊김 시작·정상 확인 대기를 보존하고, 여러 기기의 동시 신호도 각각 저장한다. 정상 시작 뒤 사건에 저장된 안정화 시간만큼 재확인해 해결하며 매핑에서 기기를 제거하면 대상 사라짐으로 끝낸다. 알림에는 `기준: 30분 이상`과 실제 해결 기준을 함께 표시한다. 옛 RF-28 감지 센서 사전 점검 동작은 바꾸지 않는다 |

Pi 불만 기록 중 연기·실내 온습도·문 열림은 정본 5가지 어디에도 해당하지 않는다.

#### 데이터 계약 — 이상 본체와 이력을 나눈다

**이상 본체** — 이상 1건에 1개. 한 번 쓰면 바꾸지 않는다.

| 항목 | 뜻 |
| --- | --- |
| `anomaly_id` | 이상 1건의 번호. 본체와 모든 이력을 같은 사건으로 잇는다 |
| `incident_key` | 같은 사건인지 가르는 결정적 열쇠(아래 [상태와 중복 방지](#automation-rate-lifecycle)) |
| `previous_anomaly_id` | 해결이 확정된 뒤 다시 생겨 새로 만든 이상이면, 앞 이상의 번호 |
| 숙소 · 원본 연결 | 어느 숙소의 어떤 원본 기록(이벤트·청소 일정)에서 생겼는지 |
| 이상 유형 | 정본 5가지 중 하나 |
| `policy_version` / `effective_from` | 판정에 쓴 기준의 버전 / 그 기준을 적용하기 시작한 시각 |
| `occurred_at` | 발생 시각 — 기준을 넘은 시각 |
| `recorded_at` | 저장한 시각 |

**이력** — 추가만 한다(append-only). 고치거나 지우지 않는다.

| 기록 종류 | 남기는 것 |
| --- | --- |
| 상태 변경 | 진행 중 → 안정화 대기 → 해결, 또는 미해결 종료 / 대상 사라짐. 안정화 대기 중 조건이 다시 생기면 진행 중으로 돌아간다(아래) |
| 개입 | 관리자·운영자가 한 행동(예: "캘린더 다시 확인", 직접 배정, 원격 제어)과 개입 주체 |
| 해결 | 해결 경로(무엇으로 풀렸는지)와 해결 주체(시스템 / 관리자 / 운영자 / 담당자 / 게스트) |
| 정정 | 잘못 남긴 기록은 지우지 않고, 어느 기록을 정정하는지 가리키는 정정 기록을 덧붙인다 |

이력 기록마다 `history_type`(기록 종류: 상태 변경·개입·해결·정정), `occurred_at`(그 일이 일어난 시각 — 정정 기록은 고친 내용이 적용되는 시각 `effective_at`), `recorded_at`(저장한 시각), `source_event_key`(그 기록을 만든 감지 신호·관리자 요청·내부 타이머의 열쇠)를 남긴다.

자동/수동은 해결 기록 하나가 아니라 **발생부터 해결까지의 이력 전체**로 판정한다 — 개입 기록이 하나라도 있으면 수동이다.

<a id="automation-rate-lifecycle"></a>

#### 상태와 중복 방지 (확정 — DEC-21~23)

**상태** — 끝난 이상(해결·미해결 종료·대상 사라짐)은 다시 열지 않는다.

| 상태 | 뜻 | 집계 |
| --- | --- | --- |
| 진행 중 | 기준을 넘은 상태가 계속된다 | 분모 O · 분자 X |
| 안정화 대기 | 조건이 풀렸지만 안정화 시간이 아직 지나지 않았다. 이 사이 조건이 다시 생기면 같은 이상이 계속된다(해결된 적이 없다) | 진행 중으로 센다 |
| 해결 (끝남) | 안정화 시간 동안 다시 생기지 않아 확정. 확정 기록의 `occurred_at`은 안정화가 끝난 시각이고, 조건이 풀린 시각은 따로 남긴다 | 개입이 없을 때만 분자 O |
| 미해결 종료 (끝남) | 더 해결할 수 없게 끝났다(아래 유형별) | 분모 O · 분자 X · 따로 표시 |
| 대상 사라짐 (끝남) | 예약 취소·기기 제거 등 | 분모에서 뺀다 |

해결이 확정된 뒤 같은 일이 다시 생기면 새 이상(새 `anomaly_id`)으로 만들고 `previous_anomaly_id`로 앞 이상과 잇는다.

**열쇠 두 개를 나눈다**

| 열쇠 | 무엇을 가르나 | 규칙 |
| --- | --- | --- |
| `incident_key` | 같은 사건인지 — `유형:숙소:대상` | 입력이 같으면 항상 같은 문자열(결정적). 같은 `incident_key`로 끝나지 않은 이상은 최대 1건. 생성은 "찾고 없으면 만든다"를 한 번의 원자적 동작으로 — 두 요청이 동시에 와도 하나만 만들어지고 다른 하나는 그 이상을 받는다 |
| `source_event_key` | 같은 신호·요청인지 — 감지 신호의 원본 기록 번호(이벤트·청소 일정 변경·센서 보고), 관리자 요청 번호, 내부 타이머 실행 키 | **유일 범위는 (`anomaly_id`, `history_type`, `source_event_key`)** — 같은 이상의 같은 종류 이력에 같은 키는 한 번만 반영한다(재전송·재시작·재실행에도 같은 결과) |

- **재실행 가능한 키가 감지 신호 밖에도 필요하다.** 관리자·운영자 요청(예: "캘린더 다시 확인", 직접 배정, 원격 제어)은 요청마다 번호를 만들어 다시 보낼 때도 같은 번호를 쓰고, 내부 타이머(안정화 시간이 끝나 해결 확정, 기한이 지나 미해결 종료)는 `{anomaly_id}:{판정 종류}:{기준 시각}`처럼 같은 판정이면 같은 키를 만든다. 그래야 같은 요청·타이머가 두 번 돌아도 이력이 한 번만 남는다.

- 단순 조회, 알림 수신, 화면 열기는 개입이 아니다. 관리자·운영자가 이상을 해결하기 위해 실행한 재확인·직접 배정·원격 제어만 해당 이상과 연결된 개입 이력으로 남긴다.
- 안정화 완료만을 위한 별도 정시 타이머는 두지 않는다. 조건이 풀린 시각을 안정화 대기로 남기고, 다음 정상 확인이 실제 적용 시간을 채웠으면 `조건이 풀린 시각 + 안정화 시간`을 해결의 `occurred_at`으로 기록한다. 0분은 조건이 풀린 신호와 같은 처리에서 즉시 해결한다. 안정화 중 다시 조건이 생기면 같은 이상을 진행 중으로 되돌린다.
- 이상 본체와 이력은 추가 전용으로 유지한다. 진행 중인 `incident_key` 하나를 보장하는 별도 열린 사건 매핑을 두고, 종료 이력 추가와 매핑 해제를 같은 트랜잭션으로 처리한다. 이력의 (`anomaly_id`, `history_type`, `source_event_key`) 유일 제약으로 재전송·동시 실행 중복을 막는다.

구체적인 보장 방법(유일 제약 등)은 스키마 때 정한다.

**유형별 초안**

| 유형 | `incident_key`의 대상 | 미해결 종료 | 마스터 안정화 시간 |
| --- | --- | --- | --- |
| 소음 | 내부 숙박 식별자 | 그 숙박이 퇴실로 끝날 때까지 풀리지 않음 | 5분 |
| 빈방 에너지 낭비 | 공실 구간을 시작한 내부 기록 번호(청소 완료 이벤트) | 다음 입실까지 계속됨 | 5분 |
| 게스트 불만 + 센서 | 내부 숙박 식별자 + 불만 주제 | 그 숙박이 퇴실할 때까지 풀리지 않음 | 10분 |
| 청소 미배정 | **내부 청소 의무 식별자** | 체크인 시각이 지남 | 0분(조건이 풀리면 즉시 해결 확정) |
| 기기 오프라인 | 기기 식별자 | 없음(기기가 빠지면 대상 사라짐) | 5분 |

- **외부 예약 번호(iCal UID)는 열쇠로 쓰지 않는다.** 같은 숙박이 새 번호로 다시 발급될 수 있다(실제 사례: RF-16에서 같은 날 예약이 새 번호로 바뀌어 옛 번호 2행을 취소 처리). PROPOS 내부 `숙박`과 `청소 의무`를 별도 DB 개체로 두고, 예약을 처음 받아들이는 서버 동기화가 같은 트랜잭션에서 ID를 발급한다. 브라우저나 Pi는 이 ID를 만들지 않는다.
- 외부 예약 행은 내부 숙박을 가리키는 별칭이다. 같은 외부 UID로 다시 가져오면 기존 숙박 ID를 유지한다. 처음 보는 UID라도 같은 숙소·입실·퇴실 시각과 정확히 일치하는 후보가 하나뿐이면 기존 숙박과 청소 의무를 잇고, 후보가 없거나 여러 개면 임의로 합치지 않고 새 숙박으로 만든다. UID와 시각이 함께 바뀌어 같은 숙박인지 확신할 수 없는 경우도 새 숙박으로 둔다.
- `cleaning_jobs.id`는 실행 작업의 번호이고 청소 의무의 식별자가 아니다. 청소 작업이 아직 없거나 생성에 실패해도 청소 의무는 예약을 받아들일 때 이미 존재한다. `cleaning_jobs`는 내부 청소 의무를 참조하며 한 의무에 실행 작업은 최대 하나다.
- 같은 숙박의 퇴실 시각이 바뀌면 숙박 ID는 유지하되, 앞 청소 의무는 대상 사라짐으로 끝내고 새 퇴실 시각의 청소 의무를 새로 발급한다. 취소된 숙박의 현재 청소 의무도 대상 사라짐으로 끝낸다.
- 안정화 시간은 런타임 코드 상수가 아니다. DB의 버전 있는 마스터 설정을 모든 숙소에 적용하고, 해당 숙소에 버전 있는 재정의가 있으면 그것을 우선한다. 숙소 재정의가 없는 것과 명시적인 `0분`을 구분한다.
- 최초 마스터 설정은 스키마 반영 때 DB에 넣는다. 마스터 설정이 없으면 코드 값으로 조용히 대체하지 않고 설정 오류로 처리한다.
- 이상 본체에는 당시 마스터 설정 버전, 숙소 설정 버전(재정의가 있을 때), 실제 적용한 안정화 시간을 남겨 나중에 설정이 바뀌어도 과거 판정이 달라지지 않게 한다.
- 설정 화면은 자주 쓰는 기능이 아니므로 별도 메뉴·큰 패널을 만들지 않고, 마스터와 숙소의 기존 설정 화면에서 여러 설정 중 하나로 작게 둔다.
- 관련 알림에는 최신 설정이 아니라 해당 이상에 실제 적용한 기준 시간을 짧게 명시한다. 기술적인 정책 버전은 노출하지 않는다. 문장 안에 간결하게 넣거나 끝에 `기준: 30분 이상 · 정상 5분 유지 시 해결`처럼 붙이고, 안정화 시간이 0분이면 `해결 확인: 즉시`로 표시한다.

#### 시각 — 결과 시각과 레코드 시각

**결과 시각** — 계산 결과 1건마다 하나씩 남긴다.

| 이름 | 뜻 |
| --- | --- |
| `period_start_at` | 집계 기간의 시작 |
| `period_end_at` | 집계 기간의 끝 |
| `data_cutoff_at` | 계산에 쓸 기록의 마감. `recorded_at`이 이 시각 이하인 기록만 쓴다 |
| `calculated_at` | 계산을 실행한 시각 |

**레코드 시각** — 이상 본체와 이력 기록마다 따로 있다(결과 시각이 아니다).

| 이름 | 뜻 |
| --- | --- |
| `occurred_at` (정정은 `effective_at`) | 그 일이 일어난 시각 |
| `recorded_at` | 그 기록을 저장한 시각 |

- 집계 대상: 본체의 `period_start_at ≤ occurred_at < period_end_at`인 이상.
- 상태 판정: 그 이상의 이력 중 `recorded_at ≤ data_cutoff_at`이고 `occurred_at`(정정은 `effective_at`)이 판정 시점 이하인 기록으로 판정 시점의 마지막 상태를 정한다. 판정 시점은 아래 보고 종류를 따른다.
- 결과에 결과 시각 4개를 함께 남겨, 같은 `period_start_at`·`period_end_at`·`data_cutoff_at`으로 다시 계산하면 언제 계산해도 같은 결과가 나오게 한다.

<a id="automation-rate-report-kinds"></a>

#### 보고 종류 — 완료 기간 보고와 진행 중 스냅샷

| 보고 종류 | 언제 | 판정 시점 | 표시 |
| --- | --- | --- | --- |
| 완료 기간 보고 | 기간이 끝난 뒤 실행(`data_cutoff_at` ≥ `period_end_at`) | `period_end_at`의 상태 | 기간 이름 그대로(예: "지난주 11/9~11/15") |
| 진행 중 스냅샷 | 기간이 끝나기 전 실행(`data_cutoff_at` < `period_end_at`) | `data_cutoff_at`의 상태 | "22시 현재"처럼 기준 시각을 붙인다. 기간 전체 결과로 보이지 않게 한다 |

- 예(완료 기간 보고): 일요일 23시에 생겨 월요일 1시에 해결된 이상은 월요일 00:00 KST 이후에 계산하는 지난주 [직전 월요일 00:00, 이번 월요일 00:00) KST 보고에서 "진행 중"이다 — 기간 끝(이번 월요일 00:00 KST)에는 해결되지 않았기 때문.
- 예(진행 중 스냅샷): 같은 이상은 일요일 22시 스냅샷에는 아직 없다(23시에 생김).
- 주 범위는 [월요일 00:00, 다음 월요일 00:00) KST다([`periodDomain`](../src/domain/periodDomain.js#L109)). 지금 있는 정기 작업은 아침 8시·밤 10시 두 개뿐이고, 밤 10시 결산은 끝나지 않은 "오늘"을 계산하므로 진행 중 스냅샷이다. 주간·월간 결산은 정기 작업이 없다(아래 [8절](#slack-report-mapping)).

중복 감지·재발·동시 생성 규칙은 [상태와 중복 방지](#automation-rate-lifecycle)의 확정 계약을 따른다([RF-25](refactoring.md#rf25-contract), DEC-23).

#### 폐기 이력 (2026-11-17) — 지금 설계가 아니다

- **옛 분모:** 체류 중 `complaint_detected`(전수) + `energy_waste_detected`, 빈방 에너지 낭비(`vacancy_energy_alert`)와 SOFT 이벤트 제외. 정본 5가지와 기준이 다른 **과거 설계 후보**이며 정본의 부분집합이 아니다.
- **옛 분자:** `events.resolution_type = 'auto'`인 이상 이벤트 수. 발생과 해결을 같은 사건으로 잇지 못하고 개입 이력을 남기지 못해 폐기했다.
- **옛 칸 추가안:** `events`에 `resolution_type`·`resolution_seconds`를 더하는 SQL([기능 설계의 통합 감지 DB 필드](reporting-feature-design.md#integration-db-fields)). 위 데이터 계약으로 대체했다.
- **옛 이름:** 이 비율을 "안심지수"라고 부르던 표기. 지금 이름은 자동화 개선율이다.

### 6-2. 이상 강조 규칙

| 조건 | 강조 방식 |
|------|-----------|
| ISSUE_AND_ENERGY 상태 숙소 존재 | State Matrix 해당 행 배경 `#fef2f2`, `❌` |
| Pending anomaly(진행 중 이상) > 0 | 자동화 개선율 옆 진행 중 건수 빨강, 해당 이벤트 행 `⚠` |
| 안심지수 < 75% | 안심지수 전체 구간 빨강 강조 (90 이상 초록 · 75 이상 주황 · 75 미만 빨강 — DEC-20, 요약 배너가 빨개지는 기준과 같다) |
| CLEANING_PENDING 건수 > 0 (체크인 12h 이내) | Template-F 해당 행 `⚠ 미배정` |
| 입실 미감지(`checkin_not_detected`) 있음 | Template-C 하단 문제 줄 `⚠ N건` (옛 no_show_suspected 대체, DEC-16) |
| iCal 마지막 동기화 > 2시간 경과 | Template-F 상단 동기화 시각 강조 |

### 6-3. 요약 문장 연결

A-Layer 요약 문장은 `reporting-feature-design.md` 섹션 4의 `generateSummary()` 규칙을 따른다.
이 파일에서 중복 정의하지 않는다.

---

<a id="vacant-energy-design"></a>

## 7. VACANT 에너지낭비 — 기존 `vacant_energy_waste_detected` 재사용

> **구현 기록 (2026-11-24):** 옛 `vacancy_energy_alert` 설계(상태 전환 밖의 독립 SOFT 이벤트)는 폐기 상태를 유지한다. 사용자 결정대로 기존 `vacant_energy_waste_detected`·`vacant_energy_waste_resolved`와 기존 VACANT 상태 전환을 재사용한다([RF-25](refactoring.md#rf25-contract)). 감지·사건 기준은 [6-1-1](#automation-rate-scope)을 따른다. 옛 설계 내용은 Git 이력(`3ef0531` 이전 판의 이 절)에 있다.

---

<a id="slack-report-mapping"></a>

## 8. Slack 레포트 ↔ 템플릿 매핑

Slack 레포트의 텍스트 포맷은 `reporting-feature-design.md` 섹션 11에서 정의.
이 파일에서는 **어느 템플릿/기간 데이터를 조합하는지**만 정의한다.

| Slack 레포트 | Cron | 사용 템플릿 | 기간 | Scope |
|-------------|------|------------|------|-------|
| 아침 브리핑 | daily-plan (KST 08:00) | Template-A(today) [완료+현재+예정] + Template-F(tomorrow) | today + tomorrow | All |
| 저녁 결산 | daily-result (KST 22:00) | Template-P(today, **22시 현재 스냅샷** — 오늘은 아직 끝나지 않았다) + Template-F(tomorrow) | today + tomorrow | All |
| 주간 결산 | 월요일 00:00 KST 이후 실행(정확한 시각은 구현 때) · 정기 작업 없음(미구현) | Template-P(last_week, 완료 기간 보고) + A-Layer(주 지표 안심지수 + 보조 자동화 개선율) | last_week | All |
| 월간 보고서 | monthly (1일 KST 08:00) · 정기 작업 없음(미구현) | Template-P(last_month, 완료 기간 보고) + 숙소별 A-Layer | last_month | Per-property 분해 |

> **주간 결산의 실행 시각 — 결정 (2026-11-17, 사용자):** 월요일 00:00 KST 이후에 실행해 `last_week` = [직전 월요일 00:00, 이번 월요일 00:00) KST를 **완료 기간 보고**로 낸다. 예전 설계 "일요일 22시 실행 + `last_week`"는 이미 7일 전에 끝난 주를 보고하게 돼 쓰지 않고, 일요일 22시 스냅샷안도 쓰지 않는다. 판정 시점 규칙은 [6-1-1 보고 종류](#automation-rate-report-kinds), 결정 기록은 [RF-25](refactoring.md#rf25-contract).

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
| W x ACTIVE | this_week | ACTIVE | Template-A | Postgres + `properties[].reservations` + cleaning_jobs | O |
| D x ACTIVE | today | ACTIVE | `TodayStatusPanel` | Postgres 이벤트 기록(현재 상태 계산) | O |
| H x NOW | now | NOW | Template-C | Postgres 이벤트 기록(현재 상태 계산) | - |
| W x FUTURE | next_week | FUTURE | Template-F | `properties[].reservations` + cleaning_jobs | O |
| D x FUTURE | tomorrow | FUTURE | Template-F | `properties[].reservations` + cleaning_jobs | O |
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
| ~~5~~ | ~~빈방 에너지 낭비 감지기 구현 (기존 `vacant_energy_waste_detected` 재사용 — [7절](#vacant-energy-design))~~ | ✅ 완료 (`fb3a845`) | ~~Phase 2~~ |
| ~~6~~ | ~~Template-A 컴포넌트 신규 작성~~ | ✅ 완료 (`ActiveHybridPanel.jsx`) | ~~Phase 3~~ |
| ~~7~~ | ~~KPI Tiles 기간별 변형 구현 (섹션 11 기준)~~ | ✅ 완료 (ACTIVE/PAST/FUTURE 4타일) | ~~Phase 3~~ |
| 8 | Single-Property Template-A 타임라인 컴포넌트 | 설계 완료, 미구현 | Phase 3 |
| 9 | SOFT 이벤트 countPeriodEvents 집계 | ✅ 완료 (noShowSuspected 등 3개 필드) | ~~Phase 2~~ |
| 10 | 이상 발생·해결 기록([6-1-1 계약](#automation-rate)) → 자동화 개선율 계산 | 미구현 (현재 "—" 표시) · 측정 범위·이력 계약 보완 대기 | Phase 3 |
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
| 지난주 | PAST | 지난주 이벤트 카운트 (체크인N / 이상N / 자동화 개선율 N%) | Template-P: [결과] only |
| 이번주 | ACTIVE | **실시간 상태 카운트** (체류중N / 입실전N / 청소중N / 공실N) | Template-A: [완료 so far] + [예정 remaining] |
| 다음주 | FUTURE | 다음주 예정 카운트 (체크인N / 체크아웃N / 청소배정N) | Template-F: [계획] only |

#### 일 모드 (D) — 전날 / 오늘 / 내일

| 네비게이션 | Tense | KPI Tiles 역할 | 펼쳐지는 Template 섹션 |
|---|---|---|---|
| 전날 | PAST | 어제 이벤트 카운트 | Template-P: [결과] only |
| 오늘 | ACTIVE | **실시간 상태 카운트** | `TodayStatusPanel`: 현재 상태 분포(완료·예정 분할 없음) |
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
| PAST (지난주/전날) | 체크인 N건 | 이상감지 N건 | 자동해결 N건 | 자동화 개선율 N% |
| ACTIVE (이번주/오늘) | 체류중 N | 입실전 N | 청소중 N | 공실 N |
| FUTURE (다음주/내일) | 체크인 예정 N | 체크아웃 예정 N | 청소배정 N/N | - |

> **RF-25(2026-11-17, 2026-11-25 완료):** PAST 타일 2 "이상감지"는 체류 중 불만·에너지 낭비 이벤트 건수(상태 표시용)이며 자동화 개선율의 분모가 아니다. 타일 3·4(자동해결·자동화 개선율)는 [6-1-1](#automation-rate) 기준이다. 주 지표 안심지수는 같은 기간의 Template-P 표 하단에 나온다(`EventMatrixPanel`). 타일 부품(`KpiTiles.jsx`)은 지금 어느 화면에도 연결돼 있지 않다 — 다시 연결할 때도 안심지수를 빼지 않는다.

Single-Property (DetailView) KPI Tile 기준:

| 기간 위치 | Tile 1 | Tile 2 | Tile 3 | Tile 4 |
|---|---|---|---|---|
| PAST (전날/-1h) | 이벤트 총 N건 | 이상 N건 | - | - |
| ACTIVE (오늘) | **현재 State** | IoT 센서 요약 | 이상 상태 여부 | - |
| NOW (지금) | 도어락 상태 | 온도/습도 | 전력 | 경보 여부 |
| FUTURE (내일/+1h) | 다음 체크인 | 다음 체크아웃 | 청소 배정 | - |

---

## 12. 지표 드릴다운 (Metric Drilldown)

> Template-P 전용. 지표 카운트 탭 → 실패 건 바텀시트 → DetailView 네비게이션.

### 12-1. 개요

PAST 기간 레포트(Template-P)에서 지표 실패 건수를 탭하면 해당 숙소 목록을 볼 수 있다.
계산은 **쿼리 타임에 수행**. 별도 저장하지 않음.

### 12-2. 지원 지표 목록

| METRIC_KEYS 인덱스 | metric key | EventMatrixPanel 라벨 | 실패 감지 방식 |
|---|---|---|---|
| 0 | `pre_stay_optimization` | 게스트 맞이 준비 | 구형 A안은 준비부터 다음 준비/입실 전 첫 완료를 연결. `sensor-v1`은 동일 제어 회차의 센서 완료/명시 실패를 집계하고 생략·취소·미확인은 제외. [정본](pre-stay-optimization.md#prep-04) |
| 1 | `post_checkout_energy` | 퇴실 후 절전 | 감지 이벤트를 세고 직전 퇴실 시각을 `detail.anchor_at`에 연결 |
| 2 | `post_checkout_security` | 퇴실 후 보안 | 감지 이벤트를 세고 직전 퇴실 시각을 `detail.anchor_at`에 연결 |
| 3 | `vacant_energy` | 빈방 절전 유지 | 감지 이벤트와 이후 해소 이벤트를 연결해 `detail.resolved_at`을 담음 |
| 4 | `post_cleaning_security` | 빈방 보안 유지 | 감지 이벤트를 세고 직전 청소 완료 시각을 `detail.anchor_at`에 연결 |
| 5 | `cleaning_time` | 청소시간 준수 | `cleaning_started`→`cleaning_finished` 페어링, 소요시간 > 3h |
| 6 | `null` | 청소 담당자 배정 | 드릴다운 미지원 (`cleaning_jobs` 집계지만 숙소별 목록 API는 없음) |

### 12-3. 아키텍처 계층

```
EventMatrixPanel.jsx       — MetricRow 탭 이벤트 → DrilldownSheet 열기
DrilldownSheet.jsx         — /api/stats/drilldown 호출 → 실패 건 목록 → 숙소 탭 → onSelectRoom 콜백
api/stats/drilldown.js     — GET ?period=&metric= → reportingService.getDrilldownForMetric()
reportingService.js        — METRIC_DETECTORS 맵 → domain 함수 호출
metricDrilldownDomain.js   — 지표별 실패 감지·앞뒤 이벤트 연결 순수 함수
```

### 12-3a. 목록의 한 줄 (D-018)

바텀시트의 각 줄 = **[신호등 점] [숙소 이름] [무슨 문제가 어떻게 있었는지 구어체 한 줄] [시간 ›]**. 심각도는 글자·막대·칩 없이 줄 색으로만 알린다 (빨강 = 심각 / 주황 = 주의 / 초록 = 가벼움 / 회색 = 등급 없음), 심한 건이 위.

| 목록 | 문장 예시 | 색 기준 |
|---|---|---|
| 청소 시간 초과 | 청소가 3시간 48분 걸렸어요 (기준 3시간보다 48분 더) | 초과 30분 미만 초록 / 30~60분 주황 / 60분 이상 빨강 |
| 공실 에너지낭비 | 빈 숙소인데 전기가 2시간 10분 동안 켜져 있었어요 | 1시간 미만 초록 / 1~3시간 주황 / 3시간 이상 빨강 |
| 퇴실후 절전·보안 / 청소후 보안 | 퇴실하고 12분 뒤에 조명·냉난방이 켜진 채로 감지됐어요 | 회색 (건마다 크기를 재는 값이 없음) |
| 입실전 최적화 미완료 | 입실 준비 시간(13:30)이 지났는데 숙소 준비가 끝났다는 기록이 없어요 | 회색 |
| 배정 실패 / 배정 요청 필요 (미래) | 체크아웃이 2일 뒤인데 청소할 사람을 못 구했어요 (5명 중 2명 거절, 3명 무응답) | 체크아웃 24시간 이내 빨강 / 그 밖 주황 (초록 없음) |

계산은 `violationDetailDomain.js`(순수 함수, 기준값 상수 한 곳), 그리기는 `ViolationRow.jsx`. 서버는 문장에 필요한 값을 `detail`에 짝지어 내려준다 (`limit_hours`, `resolved_at`, `anchor_at`, `reason` — 짝을 못 찾으면 키 없음).

### 12-4. API

`GET /api/stats/drilldown?period={period}&metric={metric_key}`

**유효 period:** `periodCapabilities(period).drilldown === true`인 기간. 모든 과거 기간(`yesterday`, `last_hour`, `last_week`, `last_month`, `days_ago_N`, `weeks_ago_N`) + 진행 중인 `this_week`·`this_month`.
**유효 metric:** 12-2 테이블의 6개 key (index 6 null 제외)

**응답:**
```json
{
  "metric": "cleaning_time",
  "period": "last_week",
  "failCount": 2,
  "items": [
    { "property_id": "P001", "occurred_at": "2026-09-08T14:23:00Z", "detail": { "duration_hours": 3.5, "started_at": "...", "finished_at": "..." } }
  ]
}
```

### 12-5. 도메인 순수 함수 (`metricDrilldownDomain.js`)

| 함수 | 입력 | 실패 판정 기준 |
|---|---|---|
| `detectCleaningTimeFailures(events)` | events[] | cleaning_started→finished 페어, 소요시간 > 3h |
| `detectPostCheckoutFailures(events, eventType)` | events[], string | 해당 위반 + 직전 퇴실 시각 |
| `detectVacantEnergyFailures(events)` | events[] | 공실 전력 낭비 + 이후 해소 시각 |
| `detectPostCleaningFailures(events, eventType)` | events[], string | 해당 위반 + 직전 청소 완료 시각 |
| `detectPreStayOptimizationFailures(events, context)` | 기간 내 events[] + 기간 밖 연결 근거 | 구형 A안: 같은 숙소의 준비 시작부터 다음 준비/입실 전 첫 완료, 날짜 경계 허용. 신규 `sensor-v1`: 같은 숙소·optimizationRunId의 명시 실패만 반환. 조기 입실 뒤 완료 허용. [정본](pre-stay-optimization.md) |

반환 공통 형식: `[{ property_id, occurred_at, detail }]`

### 12-6. 네비게이션 연결

DrilldownSheet에서 숙소 탭 → `onSelectRoom(property_id)` 콜백 체인:

```
DrilldownSheet → EventMatrixPanel(onSelectRoom)
             → ReportPanel(onSelectRoom)
             → DashboardView / PropertyListView
             → RoomStateApp: setSelectedPropertyId + setView('detail')
```

`property_id`(이벤트) = 앱의 `property.id` = 숙소 리스트에 표시되는 이름 (D-016) — 그래서 드릴다운 항목에서 그 숙소로 이동할 수 있다.
실숙소는 `liveProperty.id = canonicalPropertyId(cfg)`(= 이름). 목업 숙소는 `P001`… 형식이며 서버에 데이터가 없다.

### 12-7. 테스트

`tests/unit/s38.metric-drilldown.test.js` — 28개 테스트 (4 describe 블록)
- `detectCleaningTimeFailures` 정상/페어링/3h 경계
- `detectEventTypeFailures` 필터/빈배열
- `detectPreStayOptimizationFailures` 매칭/미매칭
- 통합: 여러 지표 혼합 이벤트 배열

`tests/unit/s54.violation-detail.test.js`는 퇴실·청소 완료·해소 이벤트 연결과 화면용 심각도·문장을 함께 검증한다.

---

## 13. 구현 완료된 패널 뼈대 (EventMatrixPanel / FutureMatrixPanel)

> 이 섹션은 실제 구현된 UI 패널의 정본 뼈대다.
> 섹션 4의 데이터 모델 정의(이벤트 테이블 형식)와 구분한다 — 섹션 4는 "무엇을 담을 것인가",
> 이 섹션은 "어떻게 보여줄 것인가의 뼈대 (컴포넌트·지표·데이터소스·표시 규칙)".

---

### 13-1. SharedMetricRow 포맷 (공통 행 단위)

`EventMatrixPanel`이 쓰는 운영 지표 행 포맷. `FutureMatrixPanel`은 현재 예약·청소 세부 팝업을 위한 자체 `Row`를 쓴다.

```
┌──────────────────────┬──────────────────┬──────────┐
│ 지표명 (라벨)        │ n/m건 또는 N건   │  N%      │
└──────────────────────┴──────────────────┴──────────┘
```

**컬럼 정의:**

| 컬럼 | 내용 | 비고 |
|------|------|------|
| 라벨 | 지표명 (한국어) | 그대로 표시(오류 suffix 자동 추가 없음) |
| count | `n/m건` (ratio) / `N건` (isCount·측정 제외의 대상 건수) / `—` | 로딩·데이터 없음·대상 없음은 `—` |
| ratio | `N%` / `—` / `준비 중` / `측정 제외` / `데이터 없음` / `해당 없음` | 상태에 따라 구분 |

**색상 임계값 (`computeMetricRowDisplay`):**

| 구간 | 텍스트 색 | 배경 |
|------|----------|------|
| pct ≥ 90 | `#059669` (green) | `#dcfce7` |
| 70 ≤ pct < 90 | `#d97706` (amber) | `#fef9c3` |
| pct < 70 | `#dc2626` (red) | `#fee2e2` |

**표시 모드 (우선순위 순):**

1. `rateExcluded` — 대상 건수와 실제 실패 배지는 유지하고 성공률만 `측정 제외`.
2. `isCount` — 건수 전용. ratio 없음. failCount = count (count가 null 또는 0이면 0).
3. `noData` — 로딩/준비 중. `준비 중` 표시. failCount = 0.
   - **반드시 `noData=true`로만 로딩 상태를 표현한다.** numerator/denominator를 null로만 전달하면 isEmpty로 처리돼 `해당 없음`이 표시된다 — 의미가 다르다.
4. `dataUnavailable` — 대상은 있을 수 있지만 조회가 실패한 상태. `데이터 없음`, failCount = 0.
5. ratio (기본) — 분자/분모가 없거나 분모가 0이면 `해당 없음`, 그 밖에는 `n/m건` + `N%`. failCount = `observedFailCount ?? max(0, denominator - numerator)`.

> **isEmpty 규칙:** `numerator == null || denominator == null || denominator === 0` → `해당 없음` 표시.
> `numerator=null`, `denominator=5` 조합도 isEmpty로 처리 (`null/5건` 방지).

**구현:** `src/domain/metricRowDomain.js` + `src/components/v2/reporting/SharedMetricRow.jsx`

---

### 13-2. Template-P 구현체 — EventMatrixPanel

**파일:** `src/components/v2/reporting/EventMatrixPanel.jsx`
**적용:** 모든 PAST 기간(`last_week`, `yesterday`, `last_hour`, `last_month`, 일반화된 `days_ago_N`·`weeks_ago_N`) + ACTIVE `this_week`·`this_month`의 [완료] 섹션
**데이터 소스:** `GET /api/stats?period=` → Postgres `events` 테이블

#### 7개 지표 행

| # | 라벨 | 분자 (계산식) | 분모 | 모드 | 드릴다운 key |
|---|------|--------------|------|------|------------|
| 1 | 게스트 맞이 준비 | `preStayOptimized` | `preStayAttempts` | ratio | `pre_stay_optimization` |
| 2 | 퇴실 후 절전 | `checkOuts - postCheckoutEnergyWaste` | `checkOuts` | rateExcluded | `post_checkout_energy` |
| 3 | 퇴실 후 보안 | `checkOuts - postCheckoutSecurityBreach` | `checkOuts` | rateExcluded | `post_checkout_security` |
| 4 | 빈방 절전 유지 | `cleaningFinished - vacantEnergyWaste` | `cleaningFinished` | rateExcluded | `vacant_energy` |
| 5 | 빈방 보안 유지 | `cleaningFinished - postCleaningSecurityBreach` | `cleaningFinished` | rateExcluded | `post_cleaning_security` |
| 6 | 청소시간 준수 | `cleaningOnTime` (= 청소 완료 − 3시간 초과 건. 드릴다운 실패 목록과 동일 기준) | `cleaningFinished` | ratio | `cleaning_time` |
| 7 | 청소 담당자 배정 | `cleaningAssigned` (ASSIGNED+COMPLETED) | `cleaningCreated` (CANCELLED 제외 생성 잡, `cleaning_jobs.checkout_at` 기준·체크아웃이 지난 건만). 조회 실패 시 null → "데이터 없음" | ratio | — (드릴다운 미지원) |

> **역산 패턴 (지표 #2~#5):** 위반 건수를 분모에서 빼서 달성 건수로 환산.
> `max(0, 분모 - 위반건수)` — 음수 방지.
>
> ⚠️ **RF-26(2026-11-17 사용자 승인·구현 완료):** 이 역산은 실패를 놓치면 그만큼 성공으로 센다. #2~#5는 성공·실패·측정 불가를 명시적으로 판정한 기록이 생기기 전까지 안심지수 점수·성공률에서 빠지고 표에는 "측정 제외"로 보인다([6-1](#safety-index-exclusions)). 실제 감지 실패는 배지·패턴에 그대로 쓴다. 실패 이벤트만 추가하는 방식으로 해결하지 않는다.

**드릴다운:** `DrilldownSheet` → `GET /api/stats/drilldown?period=&metric=` (섹션 12 참조)

---

### 13-3. Template-F 구현체 — FutureMatrixPanel

**파일:** `src/components/v2/reporting/FutureMatrixPanel.jsx`
**적용:** 모든 FUTURE 기간(`tomorrow`, `next_week`, `next_month`, `next_hour`, 일반화된 `days_ahead_N`·`weeks_ahead_N`) + ACTIVE 기간의 [예정] 구간(`this_week`, `this_month`)
**공유:** 같은 컴포넌트를 ListView와 **대시보드(현황 대시보드) "다음달" 탭**이 함께 쓴다 —
`ReportPanel`이 `describePeriod(period).tense === 'future'`일 때 이 패널로 분기하고, `next_month`도 tense가 `future`다.

> ⚠️ 이 섹션은 예전에 "기기 준비율 / 체류중 이상 감지 / 청소 할당율" 4개 행 구조로 적혀 있었으나,
> 실제 구현은 그 구조로 만들어진 적 없이 청소 배정 중심의 8줄(체크인·체크아웃·배정4분류·공실·체류) 구조를 거쳐
> 2026-09-24 하루 동안 다섯 번 수정 끝에 5개 기본 헤드라인+팝업 구조로 재구성됐다 (D-019). DEC-05 이후에는 해당 건이 있을 때만 "퇴실 없는 청소" 행이 추가된다.

#### 5개 기본 헤드라인 + 조건부 1행 (D-019 — "한 화면에 너무 많이" 방지, 세부는 팝업)

| # | 헤드라인 | 데이터 소스 | 누르면 뜨는 팝업 |
|---|---------|------------|------------------|
| 1 | 체크인 예정 N건 | `properties[].reservations` → `countWeekCheckIns` | — (클릭 없음) |
| 2 | 퇴실예정 N건 | `properties[].reservations` → `countWeekCheckOuts` | — (클릭 없음, 청소 배정과 섞지 않음. 1·2는 각자 한 줄씩 순차적으로 — 나란히 아님) |
| 3 | 배정완료 M건 | `GET /api/cleaning/stats?period=&items=true`의 `items` + 예약 → `summarizeFutureCleaning` | — (클릭 없음) |
| 4 | 미배정 K건 (K>0이면 빨강) | 위와 동일, 아래 "청소 배정 값 재계산" 참고 | **배정 요청중 / 수동배정 필요 / 청소 계획 없음** 3줄(배정완료는 3에서 이미 보이므로 팝업엔 없음) → 각 항목의 숙소별 상세 목록 |
| 5 | 공실률 NN% | `properties[].reservations` → `getOccupancyForecast` (`vacancyRate`) | 숙소별 공실률 높은 순 목록(10개씩), 숙소 행을 누르면 상세 화면 |
| 조건부 | 퇴실 없는 청소 N건 | `summarizeFutureCleaning().orphan` | 퇴실과 맞지 않는 살아 있는 청소 작업 목록. 있을 때만 헤드라인에 표시 |

> ACT-14 이후 `배정완료 + 미배정 = 퇴실예정`이다. 잡이 없는 퇴실은 `청소 계획 없음`으로 미배정에 포함한다.
> DEC-05의 `퇴실 없는 청소`는 이 등식 밖에 따로 표시한다.

**청소 배정 값 재계산 (`GET /api/cleaning/stats` 응답을 화면에서 다시 묶음):**

| 화면 값 | 계산 |
|---|---|
| 배정완료 | `summarizeFutureCleaning().assigned` |
| 배정 요청중 | `summarizeFutureCleaning().requesting` |
| **수동배정 필요** | `summarizeFutureCleaning().manual` — CANCELLED·ESCALATED를 하나로 묶고 상세 문장은 구분 |
| 청소 계획 없음 | `summarizeFutureCleaning().noJob` — 퇴실 예약은 있지만 맞는 청소 작업이 없음 |
| 미배정 (헤드라인 값) | `배정 요청중 + 수동배정 필요 + 청소 계획 없음` |
| 퇴실 없는 청소 | `summarizeFutureCleaning().orphan` — 배정 숫자에 섞지 않는 별도 행 |

> D-017의 "배정 요청 필요"·"배정 실패"를 안 섞는다는 규칙은 **집계 로직(서버 쿼리)** 기준이며 그대로 유지된다.
> 여기서 합치는 건 화면 헤드라인의 표시 방식일 뿐 — 상세 목록에서는 여전히 각자 다른 문장으로 구분된다.

**수동배정 필요 상세 목록:** 집계의 `manual` 항목에 서버의 `failedItems`·`needsRequestItems` 세부를 붙여
`buildManualCleaningRows(entries, details, now)` (`src/domain/violationDetailDomain.js`)로 급한(체크아웃이 가까운) 순 정렬.
그리기는 D-018과 같은 `ViolationRow` (신호등 색, 등급 글자 없음).

**배정 요청중 상세 목록:** 서버를 추가로 부르지 않고, `/api/cleaning/stats?items=true`가 이미 주는 `items`(전체 잡,
상태 포함)를 `REQUESTING_STATUSES`(PENDING~BULK_REMINDED)로 걸러 `buildCleaningIssueRows('requesting', items, now)`
로 만든다. `describeCleaningIssue('requesting', …)`는 **항상 회색(info)** — 아직 시스템이 정상 진행 중인 상태라 급함을
표시하지 않는다. 줄 문장은 `cleaning_jobs.status` 코드를 그대로 보여주지 않고 "담당자를 찾고 있어요" 같은 문장으로
옮긴다(`REQUESTING_STAGE_TEXT`, content-guide 내부 상태명 노출 금지 원칙).

**보류된 것 — "입실예정" 클릭 시 기기 상태:** 제안은 됐으나 미구현 (D-019 참고).
`assessDeviceReadiness(haStates, now)` (`src/domain/futureReportDomain.js`, 테스트 완료)와 `GET /api/ha/all-states`가
이미 존재하지만 **현재 이 패널(또는 다른 어떤 화면)에도 연결돼 있지 않다.** 재검토 시 이 함수를 새로 만들 필요 없이 연결만 하면 된다.

**드릴다운 모드:** `DrilldownSheet` `staticItems` 모드 (API fetch 없이 컴포넌트가 직접 items 전달). 미배정/공실률 팝업은
`renderItem`에 `StatRow` 또는 숙소별 공실률 행(클릭 가능한 항목만 다음 화면·팝업으로 넘어가는 `›`)을 넘겨 재사용한다 — 인라인
펼침이 아니라 다른 모든 상세보기와 같은 팝업(딤 배경 + 바텀시트)이다.

---

### 13-4. 공유 인프라 구조

```
src/domain/
  metricRowDomain.js       computeMetricRowDisplay() — EventMatrixPanel 행 상태·색상 임계값
  monthlyCalendarDomain.js summarizeFutureCleaning() — 예약 퇴실과 cleaning_jobs를 맞춰 미래 배정 상태 분류
  violationDetailDomain.js 미래 청소 문제·공실률 목록 문장·정렬

src/components/v2/reporting/
  SharedMetricRow.jsx      EventMatrixPanel의 3-컬럼 운영 지표 행
  EventMatrixPanel.jsx     Template-P 패널 (7개 지표)
  FutureMatrixPanel.jsx    Template-F 패널 (5개 기본 헤드라인 + 조건부 퇴실 없는 청소 + 세부 팝업)
  DrilldownSheet.jsx       바텀 시트 — fetch 모드 (Template-P) + staticItems 모드 (Template-F)
```

**TC 커버리지:**
- `tests/unit/s38.metric-drilldown.test.js` — 28개 (Template-P 드릴다운 도메인)
- `tests/unit/s39.future-report.test.js` — Template-F 도메인
- `tests/unit/s40.shared-components.test.js` — 34개 (computeMetricRowDisplay + computeCleaningStats)
- `tests/unit/s42.active-matrix.test.js` — 38개 (periodToDateRange 기간 경계 + splitActiveStats + 패널 배선)

---

### 13-5. Template-A 구현체 — ActiveHybridPanel

**적용:** W x ACTIVE (`this_week`), M x ACTIVE (`this_month`). `today`는 `ReportPanel`에서 `TodayStatusPanel`로 분기한다.

**구조:** `[완료]` + `[예정]` 두 섹션을 하나의 패널에 수직 결합.

```
ActiveHybridPanel
├── [완료] 섹션 헤더 (녹색, #059669)
│   └── EventMatrixPanel (Template-P — 7개 완료 지표 + 안심지수)
│       props: stats=pastStats, period, isMobile, onSelectRoom
└── [예정] 섹션 헤더 (파란색, #1e40af)
    └── FutureMatrixPanel (Template-F — 5개 기본 헤드라인 + 조건부 퇴실 없는 청소 + 세부 팝업)
        props: stats=futureStats, period, properties, isMobile, onSelectRoom
```

**데이터 분리 — `splitActiveStats(stats)`:**

`/api/stats?period=this_week` 응답의 통합 stats를 분리:

| 필드 | 분류 | 용도 |
|------|------|------|
| `checkOuts`, `preStayAttempts`, `preStayOptimized`, `cleaningFinished`, `cleaningOnTime`, `cleaningAssigned`, `cleaningCreated`, `vacantEnergyWaste`, `postCheckoutEnergyWaste`, `postCheckoutSecurityBreach`, `postCleaningSecurityBreach` | `pastStats` | EventMatrixPanel |
| `checkIns` | `futureStats.checkIns` | 패널 렌더 가능 상태를 유지하는 호환 값. 실제 체크인 예정 건수는 `properties[].reservations`와 `periodToRemainingRange`로 다시 계산 |

불변식:
- `checkIns` 는 `pastStats`에 포함되지 않는다
- `stats.checkIns == null` → `futureStats.checkIns = null` (undefined 아님)
- `stats.checkIns === 0` → `futureStats.checkIns = 0` (0을 null로 변환 금지)
- 원본 객체 변경 없음 (불변성)
- 알 수 없는 추가 필드는 `pastStats`에 포함 (미래 확장 허용)

**`periodToDateRange` 확장:**

`src/domain/periodDomain.js`에 `this_week` / `last_week` 추가 (KST 월요일 기준):

| period | from | to |
|--------|------|----|
| `last_week` | `d + toMon - 7` (지난 월) | `d + toMon` (이번 월) |
| `this_week` | `d + toMon` (이번 월) | `d + toMon + 7` (다음 월) |
| `next_week` | `d + toMon + 7` (다음 월) | `d + toMon + 14` |

`toMon = dow === 0 ? -6 : 1 - dow` (0=일요일 기준)

3주 연속성 불변식: `last_week.to === this_week.from === next_week.from - 7days`

기간 계산은 `src/domain/periodDomain.js` 하나가 정본이다. `api/cleaning/[...slug].js`에는 별도 인라인 `periodToDateRange`가 없다.

**공유 인프라 추가:**

```
src/domain/
  periodDomain.js       periodToDateRange(period, nowMs?) — 모든 기간 지원, 테스트 가능
  activeWeekDomain.js   splitActiveStats(stats) — this_week stats → { pastStats, futureStats }

src/components/v2/reporting/
  ActiveHybridPanel.jsx  Template-A 패널 (완료+예정 결합)
```

---

## 14. 멀티 프로퍼티 필터 (s43 — ListView 체크박스)

> 구현 기준: 2026-09-16

### 14-1. 개요

ListView에서 각 숙소 행 앞의 체크박스로 특정 숙소들을 선택하면, ReportPanel이 선택된 숙소들의 집계 데이터만 표시한다.

### 14-2. 데이터 흐름

```
[체크박스 선택] → selectedRooms: Set<string>
               → statsPropertyIds: string[]|null
               → useReportingStats(period, propertyIds)
               → GET /api/stats?period=...&property_ids=p1,p2
               → parsePropertyIds(req.query) → string[]|null
               → getStatsForPeriod(period, { db, kv, propertyIds })
               → queryEvents(db, range, propertyIds)
               → WHERE property_id = ANY($1::text[])
```

### 14-3. 계약

| 입력 | queryEvents 동작 | getStatsForPeriod 동작 |
|------|-----------------|----------------------|
| `propertyIds = null` | 전체 조회 (필터 없음) | 전체 숙소 집계 |
| `propertyIds = ['p1']` | `WHERE property_id = ANY($1::text[])` | 해당 숙소만 집계 |
| `propertyIds = ['p1','p2']` | 같은 ANY 쿼리 | 두 숙소 합산 |
| `propertyIds = []` | DB 호출 없이 `[]` 반환 | 전 항목 0 |

`now` / `today`는 기간 집계가 아니라 **숙소별 현재 상태**를 센다. 상태는 이벤트 기록(Postgres)에서 계산한다
(마지막 큰 상태 변화 + 그 뒤 세부 이벤트, `roomStateFromEventsDomain` — data-storage-design §7-2).
`propertyIds` 지정 시 **선택한 숙소만**, `null`(전체)은 기록이 있는 모든 숙소. 시간이 지나도 숙소가 빠지지 않는다.
현재 상태 집계의 "이상(anomaly)"은 체류중 `ISSUE_COMPLAINT` / `ISSUE_AND_ENERGY` / `ENERGY_WASTE` (§6-1, `OCCUPIED_ISSUE_SUB_STATUSES`).

### 14-4. `parsePropertyIds(query)` — API 계층

`src/application/statsQueryParser.js` 순수 함수.

| query | 반환 |
|-------|------|
| `{}` | `null` (전체) |
| `{ property_ids: '' }` | `null` |
| `{ property_id: 'p1' }` | `['p1']` (하위 호환) |
| `{ property_ids: 'p1,p2' }` | `['p1', 'p2']` |
| `{ property_ids: '', property_id: 'p1' }` | `null` (property_ids 키 존재 → property_id 무시) |

`property_ids` 키가 존재하면 `property_id`는 항상 무시된다 (precedence 규칙).  
공백 trim + 빈 세그먼트 제거 적용.

### 14-5. `useReportingStats` 훅 시그니처 변경

```js
// 이전 (deprecated)
useReportingStats(period, propertyId: string|null)

// 현재
useReportingStats(period, propertyIds: string[]|null)
```

`idsKey = propertyIds?.join(',')` — 배열 레퍼런스가 바뀌어도 내용이 같으면 재요청 없음 (stable dependency).

### 14-6. UI 동작

- 체크박스 클릭 → `e.stopPropagation()` 필수 (행 클릭과 분리)
- 선택된 숙소 있을 때: 행 배경 `#f0fdf4`, 테두리 `#86efac`
- 헤더 "N개 선택 · 해제" 버튼으로 전체 해제
- 빈 선택(해제) → `mode 'none'` → `statsPropertyIds = []`, 레포트 fetch 스킵 + "숙소를 선택해주세요" 표시 (전체로 복귀하지 않음)
- 선택 판정·신규 숙소 자동 선택은 `src/domain/selectionScopeDomain.js` (테스트: `tests/unit/s46.selection-scope.test.js`)
- 이미 알던 숙소를 사용자가 해제한 경우, 숙소 목록이 갱신돼도 되살리지 않음 (처음 보는 숙소만 자동 선택)
- 서버 값은 0이어도 그대로 표시한다. 데모 수치로 대체하지 않으며, API 실패 시 "데이터를 불러올 수 없어요" (`useReportingStats`)

### 14-7. 새 파일

```
src/application/statsQueryParser.js   parsePropertyIds(query) — 순수 함수
```

### 14-8. 수정된 파일

```
src/infrastructure/eventRepository.js   queryEvents: propertyId(string) → propertyIds(string[]|null)
src/application/reportingService.js     getStatsForPeriod: { propertyId } → { propertyIds }
src/hooks/useReportingStats.js          propertyId → propertyIds, idsKey stable dependency
src/components/v2/PropertyListView.jsx  체크박스 UI, selectedRooms state
src/components/v2/PropertyDetailView.jsx  useReportingStats 호출부 → [property.id]
api/stats.js                           parsePropertyIds 사용
```

---

## 15. 기간이 타임라인 위치를 따른다 (N주 뒤/전)

> 결정: `.claude/rules/decisions.md` D-017 (2026-09-19)

### 15-1. 동작

ListView 타임라인을 이동한 만큼 레포트 기간이 따라간다. 이름이 있던 기간(지난주·이번 주·다음 주, 어제·오늘·내일)은 그대로이고, 그 밖은 몇 주/며칠 뒤·전으로 표시한다.

| 화면 | 타임라인 위치 | 레포트 기간 | 제목 |
|---|---|---|---|
| 주 모드 | 오프셋 ÷ 7 을 가장 가까운 주로 (예: +14일) | `weeks_ahead_2` | 2주 뒤 레포트 · 9/28~10/4 |
| 주 모드 | -7일 | `last_week` | 지난주 레포트 |
| 일 모드 / 숙소 상세 | +2일 | `days_ahead_2` | 2일 뒤 레포트 · 9/21 |

### 15-2. 기간 이름 규칙 (`src/domain/periodDomain.js`)

- 주: `last_week`(-1) · `this_week`(0) · `next_week`(+1) · `weeks_ahead_N` · `weeks_ago_N` (N ≥ 2, 최대 520)
- 일: `yesterday`(-1) · `today`(0) · `tomorrow`(+1) · `days_ahead_N` · `days_ago_N` (N ≥ 2, 최대 3650)
- 시제: 오프셋 < 0 과거(Template-P), 0 진행 중(Template-A/오늘 상태), > 0 미래(Template-F)
- 범위는 KST 자정 경계. 이벤트 집계(`getPeriodRange`)는 끝을 23:59:59.999 로 포함, 예정 계산(`periodToDateRange`)은 `[from, to)`.
- API: `GET /api/stats?period=weeks_ahead_2`, `GET /api/cleaning/stats?period=weeks_ahead_2`, `GET /api/stats/drilldown?period=weeks_ago_2&metric=…` (드릴다운은 과거 기간만).

### 15-3. 청소 취소 규칙

청소가 취소(CANCELLED)되면 다시 배정을 요청해야 하므로 미래 레포트의 "배정 요청 필요"로 집계하고, 상세 목록에도 나온다. "배정 요청중"·"배정 실패"와 섞지 않는다.

