# PROPOS Reporting Feature 설계
> 버전: v1.2 | 작성: 2026-08-04 | 업데이트: 2026-09-02
> 구현 기준 문서 — 이 파일과 data-storage-design.md를 축으로 삼아 reporting 코드를 작성·수정한다.
> 저장소 설계: `data-storage-design.md` / 이벤트 감지: `event-detection-design.md` / 상태 기계: `room-state-machine.md`

---

## 관련 문서 관계

| 문서 | 역할 |
|------|------|
| **이 파일** (`reporting-feature-design.md`) | **"어떻게 보여줄 것인가"** — 타임라인 필터 UX, KPI 타일 레이아웃, 요약 문장 규칙, Slack 알림 포맷, API 구현 가이드 |
| `report-architecture.md` | **"무엇을 보여줄 것인가"** — 레포트 데이터 모델, 3-Axis 설계, 4가지 템플릿 정의, 분석 레이어, Scope 변형 규칙 |

> 구현 시 두 파일을 함께 참조할 것.
> 데이터 모델·집계 규칙 변경 → `report-architecture.md` 먼저 수정.
> UI 배치·컴포넌트 변경 → 이 파일 먼저 수정.

---

## 0. 레포트 설계 철학 (최우선 원칙)

### 0-1. "안심" 원칙 — 레포트의 존재 이유

PROPOS 레포트는 **성과 대시보드가 아니다.**

관리자는 현장에 없고, 직원도 없다. 레포트의 핵심 역할은:
> "지금 현장에 문제 없습니까? 오늘도 방문 안 해도 됩니까?"
> 라는 질문에 답하는 것.

**예약률, 매출, ADR, RevPAR → PMS(에어비앤비/Guesty)가 보여준다. 중복 제공 금지.**

PROPOS 레포트가 보여줘야 하는 것: **PMS가 절대 알 수 없는 것**
- 실제 체크인/아웃 시각 (예약상 시각 vs 실제 감지 시각)
- 청소가 체크인 전에 실제로 완료됐는지
- 게스트가 불편하다고 메시지를 보냈고, 그게 자동으로 해결됐는지
- 심야 소음이 감지됐고, 자동 경고가 발송됐는지
- 에너지가 공실인데 낭비되고 있지 않은지

### 0-2. North Star Metric — "주간 안심 지수"

```
안심 지수 = 자동 해결된 이상 건수 / 전체 감지된 이상 건수 × 100%
```

- **100%**: 이상이 있었지만 관리자 개입 없이 전부 자동 처리됨
- **0%**: 모든 이상에 직접 개입해야 했음
- **목표**: 90% 이상 유지, 수동 개입은 주당 0~1회

이 숫자가 레포트 첫 줄에 나와야 한다. "이번 주 자동화로 절약한 시간"은 부가 지표.

#### 이상(異常) 집계 기준 — 분모 정의

분모인 "전체 감지된 이상 건수"의 기준. 기준 없이는 지표가 무의미하다.

| 이상으로 집계 (분모 포함) | 노이즈 — 제외 |
|---|---|
| 소음 임계값 초과 3분 이상 지속 | 3분 이내 자동 복귀 센서 스파이크 |
| 에너지 낭비 30분 이상 (공실 중 가동 확인) | 정상 체크인/아웃 프로세스 |
| 게스트 불만 키워드 + 센서 이상 동시 확인 | 단독 키워드 감지 (센서 정상인 경우) |
| 청소 미배정 (체크인 12시간 이내) | 24시간 이상 여유 있는 미배정 |
| IoT 기기 오프라인 30분 이상 | 정기 재시작/펌웨어 업데이트 |

> **기준 변경 시 이 테이블을 먼저 수정할 것.** 기준이 바뀌면 과거 지표와 비교 불가.

### 0-3. 예외 기반 레포트 (Exception-Based Reporting)

**이상 없으면 짧게. 이상 있으면 구체적으로.**

```
❌ 나쁜 예: "이번 주 체크인 8건, 체크아웃 7건, 평균 청소시간 42분"
✅ 좋은 예: "이번 주 이상 6건 — 5건 자동 해결, 1건 수동 개입 필요했습니다"
```

관리자가 "이상 없음"을 확인하는 데 5초 이상 걸려서는 안 된다.

### 0-4. 통합 감지 원칙 — 단순 모니터링과의 차별점

기존 IoT: 센서값 → 알림 (1:1 단순 반응)
PROPOS: **다중 데이터 교차 분석 → 맥락 있는 판단**

```
[날씨 API] × [예약 스케줄] × [청소 상태] × [센서값] × [게스트 메시지]
    ↓
상황 판단 → 자동 대응 → 레포트에 "통합 처리 완료"로 기록
```

레포트는 이 통합 판단의 **결과물**을 보여준다. 날씨 예보 자체가 아니라,
"폭우 예보 + 체크인 예정 + 습도 센서 상승 → 제습 실행 + 게스트 우산 안내 예약"
처럼 **맥락 + 판단 + 결과** 3가지를 한 문장으로.

> **지역뉴스 연동은 Phase 3 예정 기능.** 현재 구현 범위 외. 문서·레포트 예시에 포함하지 않는다.

---

## 1. 기능 범위

두 가지 보고 채널:

| 채널 | 위치 | 역할 |
|------|------|------|
| 인앱 대시보드 | List View 상단, Detail View 상단 | 기간별 KPI 수치 + 필터 |
| 알림 (Slack) | PC·모바일 | 이벤트 발생 시 "볼 것 있음" 신호 |

알림은 내용을 담지 않는다. `proposonline.com/events/{id}` 링크만 보낸다.
실제 데이터는 항상 앱이 정본이다.

---

## 2. 뷰 계층 구조 (확정)

각 단위는 **데이터 단위이자 필터** 역할을 동시에 수행한다.
월 단위는 현재 UI 범위 외 — 향후 별도 월 캘린더 뷰로 구현 예정.

```
List View  (한눈에 = 1주일)
  ├── 주 단위: 지난주 | 이번주● | 다음주     ← Week DATA + FILTER
  └── 일 단위: 전날  | 오늘   | 내일        ← Day DATA + FILTER  (현재 = 오늘)

Detail View (한눈에 = 하루)
  ├── 일 단위: 전날  | 오늘   | 내일        ← Day DATA + FILTER
  └── 시 단위: 한시간 전 | 지금● | 한시간 후 ← Hour DATA + FILTER
```

### UI 네비게이션 형태

**List View** — 상단 바이너리 토글 + 수평 네비게이터
```
("주" | 일)   ←  지난주 | 이번주 | 다음주  →
( 주  |"일")  ←  전날  | 오늘  | 내일   →
```
- 토글로 주/일 모드 전환 → 네비게이터와 KPI 타일 동시 교체
- "주" 기본 선택

**Detail View** — 좌측 상단 (타임라인 위), 바이너리 토글 + 수직 네비게이터
```
("일" | 시)          ( 일  |"시")
  -  하루 전            -  한시간 전
  ○  오늘              ○  지금
  +  다음날             +  한시간 후
```
- `-` 이전 / `○` 현재 / `+` 다음 (아이콘 + 워딩 병기)
- "일" 기본 선택, `○` 행이 현재 선택 상태 강조

### 기간 키 정의

| 키 | 범위 | 사용 위치 |
|----|------|----------|
| `last_week` | 직전 주 월~일 | List 주 모드 |
| `this_week` | 이번 주 월~일 | List 주 모드 (기본) |
| `next_week` | 다음 주 월~일 | List 주 모드 |
| `yesterday` | 전날 00:00~23:59 | List 일 모드 / Detail 일 모드 |
| `today` | 오늘 00:00~23:59 | List 일 모드 / Detail 일 모드 (기본) |
| `tomorrow` | 다음날 00:00~23:59 | List 일 모드 / Detail 일 모드 |
| `last_hour` | 직전 1시간 | Detail 시 모드 |
| `now` | 실시간 (범위 없음) | Detail 시 모드 (기본) |
| `next_hour` | 다음 1시간 | Detail 시 모드 |

> 월 단위 키(`last_month`, `this_month`, `next_month`)는 API에 구현되어 있으나
> 현재 UI에서는 사용하지 않음. 향후 월 캘린더 뷰 구현 시 활성화.

### Navigation-Drives-Content 원칙

**네비게이션 위치가 어떤 Template 섹션을 표시할지 결정한다.**
중복 없이 맥락에 맞는 콘텐츠만 표시하는 핵심 설계 원칙.

| 네비게이션 위치 | Tense | 펼쳐지는 레포트 | KPI Tiles 역할 |
|---|---|---|---|
| 지난주 / 전날 / -1h | PAST | 결과만 (Template-P) | 이벤트 카운트 + 안심지수 |
| 이번주 / 오늘 | ACTIVE | 완료 so far + 예정 remaining (Template-A) | **실시간 상태 카운트** |
| 다음주 / 내일 / +1h | FUTURE | 계획만 (Template-F) | 예정 카운트 |
| 지금 (DetailView 시 모드) | NOW | Template-C (State Snapshot + IoT 전체) | 도어락·온도·전력 실시간 |

> `[현재]` 섹션을 Template-A 안에 따로 두지 않는다. **이번주/오늘 위치의 KPI Tiles가 이 역할을 담당한다.**
> 상세 데이터 명세는 `report-architecture.md` 섹션 11 참조.

---

## 3. KPI 타일 구성 (확정)

**room-state-machine.md 상태 기계 기반. 임의 재정의 금지.**

### 3-1. 현재 (실시간)

4개 상태 + 서브 인디케이터. Main Status 기준 집계.

| 타일 | 집계 대상 | 서브 인디케이터 |
|------|-----------|----------------|
| 입실 중 | OCCUPIED/* 합산 | ISSUE_COMPLAINT / ISSUE_AND_ENERGY 건수 → "이상 N개" |
| 입실 준비 중 | PRE_STAY_READY/* 합산 | — |
| 공실 | VACANT/* 합산 | — |
| 청소 중 | CLEANING/* 합산 | — |

우선순위 표시 (room-state-machine.md 섹션 4C 기준):
```
ISSUE_AND_ENERGY > ISSUE_COMPLAINT > ENERGY_WASTE > GOOD_CONDITION
```

이상 건수가 있으면 "입실 중" 타일이 강조색으로 전환.

### 3-2. 이번 주 / 이번 달

| 타일 | 데이터 소스 |
|------|------------|
| 체크아웃 | events 테이블 `check_out_detected` (완료) + iCal (예정) |
| 체크인 | events 테이블 `check_in_detected` (완료) + iCal (예정) |
| 예약률 | iCal 예약 일수 / 전체 일수 |
| 이상감지 | events 테이블 `complaint_*` + `energy_waste_*` 건수 |

### 3-3. 지난주 / 지난달 (결과)

| 타일 | 데이터 소스 |
|------|------------|
| 총 체크인 | events 테이블 (해당 기간) |
| 총 체크아웃 | events 테이블 (해당 기간) |
| 이상감지 | events 테이블 complaint + energy_waste 합산 |
| 에너지 낭비 | events 테이블 `energy_waste_detected` 건수 |

90일 이전은 monthly_summaries에서 읽음. (data-storage-design.md 섹션 9)

### 3-4. 다음 주 / 다음 달 (계획)

| 타일 | 데이터 소스 | 비고 |
|------|------------|------|
| 예정 체크아웃 | iCal 데이터 | 기구현 |
| 예정 체크인 | iCal 데이터 | 기구현 |
| 예약률 | iCal 데이터 | 기구현 |
| 청소 할당 | — | **미구현 — Phase 2로 연기** |

청소 할당 타일은 청소 배정 기능 구현 전까지 "예약률" 타일로 대체.

---

### 3-5. 일 단위 — 어제 / today / 내일 (List 보조 / Detail 기본)

| 필터 | 성격 | 타일 | 데이터 소스 |
|------|------|------|------------|
| 어제 (`yesterday`) | 결과 | 체크인 완료 / 체크아웃 완료 / 이상감지 / 에너지낭비 | events DB |
| 오늘 (`today`) | 실시간+혼합 | 입실 중 / 공실 / 청소 중 (실시간) + 오늘 남은 예정 체크인/아웃 | KV + events DB + iCal |
| 내일 (`tomorrow`) | 계획 | 예정 체크인 / 예정 체크아웃 / 청소 예정 건수 | iCal |

- `today`는 오전에는 남은 예정이 많고, 오후로 갈수록 완료 건수가 늘어나는 혼합 뷰.
- List View에서 일 단위 선택 시: 주 뷰 목록에서 해당 날짜 행 포커스 + 상단 KPI 전환.
- Detail View에서 일 단위는 기본 네비게이션 — 단일 숙소의 하루 전체 타임라인.

---

### 3-6. 시간 단위 — 한시간 전 / 지금 / 한시간 후 (Detail 보조)

| 필터 | 성격 | 타일 | 데이터 소스 |
|------|------|------|------------|
| 한시간 전 (`last_hour`) | 결과 | 직전 1시간 발생 이벤트 목록 + 건수 | events DB |
| 지금 (`now`) | 실시간 | IoT 센서 상태 (온도/습도/소음/전력/모션) + 룸 상태 | KV + HA |
| 한시간 후 (`next_hour`) | 예측 | iCal 기반 다음 1시간 예정 이벤트 | iCal |

- 시간 단위는 Detail View에서만 사용 (List View에는 없음).
- `지금`이 기본 선택 — Detail View 진입 시 항상 실시간 상태 표시.
- `한시간 후`는 체크인/체크아웃 예정 시각이 1시간 내인 경우 강조 표시.

---

## 4. 요약 문장 생성 규칙 (content-guide.md 준수)

순수 함수 `generateSummary(period, stats)` → string.

규칙:
- 한 문장에 숫자는 최대 2개.
- 이상 없을 때: 짧게. "이번 주 정상 운영 중이에요."
- 주의 항목 있을 때: 명확하게. "청소 미할당 1건이 있어요."
- 긴급 상황: 즉시성 강조. "소음 이상이 감지됐어요. 바로 확인이 필요해요."
- 과거: 결과 요약. "지난주 체크인 8건 완료. 이상 없었어요."
- 미래: 준비 안내. "다음 주 체크아웃 6건 예정이에요."

금지:
- "양호합니다", "문제없습니다" 등 시스템 용어 단정
- 한 문장에 수치 3개 이상
- 내부 상태명 노출 (OCCUPIED, CLEANING_PENDING 등)

---

## 5. 코드 레이어 구조

기존 `src/application/` 패턴을 그대로 따른다.

```
api/
  events.js            HTTP 핸들러 (얇게 — 검증 후 서비스 위임)
  stats.js             HTTP 핸들러 (기간 파싱 후 서비스 위임)

src/
  config/
    eventTypes.js      이벤트 타입 상수 (Pi + Vercel 공유)

  domain/
    reportingDomain.js 기간 계산, 상태 분류 (순수 함수)

  application/
    eventService.js    이벤트 수신 파이프라인 오케스트레이션
    reportingService.js KPI 계산, 요약 문장 생성

  infrastructure/
    eventRepository.js Postgres 쿼리 (함수 인자로 주입 → mock 교체 가능)
    kvStore.js         KV 읽기/쓰기 (함수 인자로 주입 → mock 교체 가능)

server/
  slackNotifier.js     Slack webhook 발송 (env 없으면 no-op)

scripts/ (Pi)
  outbox.mjs           NDJSON 큐 읽기/쓰기/재전송 로직
```

### 의존 방향 (단방향, 역방향 금지)

```
api → application → domain
api → infrastructure
application → infrastructure
```

`domain`은 외부 의존 없음 (순수 함수만).
`infrastructure`는 DB/KV/Blob/Slack만 알고, domain/application을 모름.

---

## 6. eventTypes.js 전체 목록 (확정)

`src/config/eventTypes.js` — room-state-machine.md + event-detection-design.md 기반.

```js
export const EVENT_TYPES = Object.freeze({
  // 상태 기계 이벤트 (is_soft: false)
  CHECK_IN_DETECTED:             'check_in_detected',
  CHECK_OUT_DETECTED:            'check_out_detected',
  CLEANING_STARTED:              'cleaning_started',
  CLEANING_FINISHED:             'cleaning_finished',
  ENERGY_WASTE_DETECTED:         'energy_waste_detected',
  ENERGY_WASTE_RESOLVED:         'energy_waste_resolved',
  COMPLAINT_DETECTED:            'complaint_detected',
  COMPLAINT_RESOLVED:            'complaint_resolved',
  CHECKIN_PREP_TIME_REACHED:     'checkin_prep_time_reached',
  OPTIMIZATION_FINISHED:         'optimization_finished',
  RESERVATION_CANCELLED:         'reservation_cancelled',

  // 글로벌 이벤트 (미구현 — 상수만 선언)
  MAINTENANCE_REQUIRED:          'maintenance_required',
  MAINTENANCE_STARTED:           'maintenance_started',
  MAINTENANCE_FINISHED:          'maintenance_finished',

  // Soft 이벤트 (is_soft: true — 상태 변경 없음)
  CHECKOUT_CONFIRMATION_NEEDED:  'checkout_confirmation_needed',
  EARLY_CHECKIN_SUSPECTED:       'early_checkin_suspected',
  NO_SHOW_SUSPECTED:             'no_show_suspected',
});

export const SOFT_EVENT_TYPES = new Set([
  'checkout_confirmation_needed',
  'early_checkin_suspected',
  'no_show_suspected',
]);

// 미구현 이벤트 (Zod 검증 통과시키되 파이프라인 처리 건너뜀)
export const UNIMPLEMENTED_EVENT_TYPES = new Set([
  'maintenance_required',
  'maintenance_started',
  'maintenance_finished',
  'checkin_prep_time_reached',
  'optimization_finished',
  'reservation_cancelled',
]);
```

---

## 7. 테스트 전략

D-006: node:test 내장 러너 사용. 외부 테스트 라이브러리 금지.

### 단위 테스트 (mock 사용, DB 불필요)

| 파일 | 검증 내용 |
|------|-----------|
| `s17.event-types.test.js` | 상수 값 정확성, 집합 구성 |
| `s18.event-validation.test.js` | Zod 유효/무효 케이스 망라 |
| `s19.period-calculation.test.js` | 기간 날짜 경계값 (월 초/말, 주 경계) |
| `s20.kpi-calculation.test.js` | 상태별 카운팅, 우선순위 정렬 |
| `s21.summary-sentence.test.js` | 기간별 문장 생성, content-guide 규칙 준수 |
| `s22.outbox-ndjson.test.js` | append, parse, atomic rename, deadLetter 이동 |

mock 주입 방식:
```js
// eventRepository.js 함수를 인자로 받아서 테스트에서 교체
async function processEvent(event, { insertEvent, updateEventStatus }) { ... }
```

### 통합 테스트 (실 DB 필요 — npm run test:integration)

| 파일 | 검증 내용 |
|------|-----------|
| `i01.event-pipeline.test.js` | POST /api/events → Postgres 저장 확인 |
| `i02.stats-api.test.js` | GET /api/stats 기간별 수치 정합성 |

환경변수 `POSTGRES_URL` 없으면 테스트 skip.

### Slack 격리

`PROPOS_SLACK_WEBHOOK` 없으면 `slackNotifier.js`가 no-op 반환.
테스트 환경에서 실제 Slack 메시지 발송 안 됨.

---

## 8. API 엔드포인트 목록

| 메서드 | 경로 | 용도 |
|--------|------|------|
| POST | `/api/events` | Pi watcher 이벤트 수신 |
| GET | `/api/stats` | 기간별 KPI 수치 조회 |
| GET | `/api/events/history` | 히스토리 목록 조회 |
| GET | `/api/events/:id` | 단일 이벤트 상세 (Slack 링크 목적지) |
| POST | `/api/cron/archive-events` | 월별 압축 (Vercel Cron 호출) |

### GET /api/stats 파라미터

```
?period=now|this_week|last_week|next_week|this_month|last_month|next_month
&property_id=paju201   (생략 시 전체 숙소)
```

---

## 9. UI 통합 위치

`src/components/v2/PropertyListView.jsx` 상단:
```
TimelineFilter     ← period 선택
KpiTiles           ← 4개 타일, period에 따라 전환
SummaryBanner      ← 요약 문장 1줄
─────────────────────────────────
기존 목록 ...      ← 변경 없음
```

`src/components/v2/PropertyDetailView.jsx` 상단:
```
TimelineFilter     ← period 선택 (단일 숙소 범위)
KpiTiles           ← 4개 타일
SummaryBanner      ← 요약 문장 1줄
─────────────────────────────────
기존 상세 ...      ← 변경 없음
```

v1 파일 (`src/components/v1/*`) 수정 금지 — D-013.

---

## 10. 구현 순서 (Phase 1 → 4)

### Phase 1 — 기반 (이 단계 완료 후 Phase 2 시작)
- [ ] `src/config/eventTypes.js` 생성 (섹션 6)
- [ ] Vercel Postgres 생성 + 프로젝트 연결
- [ ] Postgres 스키마 적용 (data-storage-design.md 섹션 3)
- [ ] Vercel KV 생성 + 프로젝트 연결
- [ ] Vercel Blob 생성 + 프로젝트 연결
- [ ] `PROPOS_SLACK_WEBHOOK` Vercel 환경변수 추가
- [ ] `npm install zod @vercel/postgres @vercel/kv @vercel/blob`
- [ ] `src/infrastructure/eventRepository.js` 구현
- [ ] `src/infrastructure/kvStore.js` 구현
- [ ] `server/slackNotifier.js` 구현 (env 없으면 no-op)
- [ ] `src/application/eventService.js` 구현
- [ ] `POST /api/events` 구현
- [ ] Pi `scripts/outbox.mjs` 구현
- [ ] 단위 테스트 s17~s22 작성 및 통과

### Phase 2 — 조회 API
- [ ] `src/domain/reportingDomain.js` 구현 (기간 계산, 상태 분류)
- [ ] `src/application/reportingService.js` 구현 (KPI 계산, 요약 문장)
- [ ] `GET /api/stats` 구현
- [ ] `GET /api/events/history` 구현
- [ ] `GET /api/events/:id` 구현
- [ ] `api/cron/archive-events.js` 구현
- [ ] 단위 테스트 s19~s21 완성

### Phase 3 — UI
- [ ] `TimelineFilter` 컴포넌트
- [ ] `KpiTiles` 컴포넌트 (기간별 전환)
- [ ] `SummaryBanner` 컴포넌트
- [ ] PropertyListView 상단 통합
- [ ] PropertyDetailView 상단 통합

### Phase 4 — 알림
- [ ] `slackNotifier.js` 이벤트 발생 시 호출 (POST /api/events 파이프라인에 포함)
- [ ] 일일 계획 레포트 Cron (오전 8시)
- [ ] 일일 결과 레포트 Cron (저녁 10시)
- [ ] 주간 안심 결산 Cron (일요일 22시)
- [ ] 월간 현장 보고서 Cron (매월 1일 08시)

---

## 11. 정기 Slack 레포트 포맷 (상세)

> 모든 레포트는 **"안심" 원칙(섹션 0-1)** 과 **"예외 기반(섹션 0-3)"** 을 따른다.
> 이상이 없는 날은 3줄로 끝낸다. 이상이 있는 날은 구체적으로 설명한다.

### 이모지 팔레트 (모든 레포트 공통)

| 역할 | 이모지 | 사용 규칙 |
|------|--------|-----------|
| 상태: 정상 | ✅ | 이상 없음, 완료 |
| 상태: 주의 | ⚠️ | 확인 필요, 경고 |
| 상태: 미해결 | ❌ | 미완료, 없음 |
| 레포트: 아침 | 🌅 | 일일 아침 브리핑에만 |
| 레포트: 저녁 | 🌙 | 일일 저녁 결산에만 |
| 레포트: 주간 | 📊 | 주간 결산에만 |
| 레포트: 월간 | 📈 | 월간 보고서에만 |
| 예정 일정 | 📋 | 내일/다음 주 예정 항목 |
| 안심 지수 | 🔐 | 안심 지수 표시에만 |
| 절약 시간 | ⏱ | 절약 추정 항목에만 |

> 이 팔레트 외의 이모지를 레포트 본문에 추가하지 않는다. 팔레트 변경 시 이 표를 먼저 수정.

### 숙소 표기 규칙

레포트에는 `property_name` (관리자가 설정한 실제 이름)을 사용한다.
이름이 설정되지 않은 경우에만 `property_id`로 폴백.

```js
const displayName = property.name || property.id;
```

> 코드명(B101, B203 등)은 개발 내부에서만 사용. 고객이 보는 레포트에 절대 노출하지 않는다.

### 어조 규칙

| 금지 | 사용 |
|------|------|
| "없음", "완료", "처리됨" | "없어요", "됐어요", "처리됐어요" |
| "이상이 감지되었습니다" | "이상이 감지됐어요" |
| "확인이 필요합니다" | "확인이 필요해요" |
| 문어체 단정형 | 구어체 · 군더더기 없이 술술 읽히도록 |

---

### 11-1. 일일 아침 브리핑 (매일 08:00 KST — Cron: `api/cron/daily-plan`)

**목적**: 오늘 하루 현장에 가지 않아도 되는지 판단할 수 있는 최소 정보 제공.

```
🌅 PROPOS 오늘 브리핑 (10/3 수)

✅ 오늘 5개 숙소 모두 이상 없어요

체크아웃: 애월 스튜디오(11시) · 홍대 원룸 A(12시) — 청소 배정 됐어요
체크인:   이태원 테라스(15시) — 오늘 13시 청소 완료 예정이에요

날씨: 오후 폭우 예보 → 이태원 테라스 게스트 우산 안내 13:30 자동 발송 예약

⚠️ 확인 필요: 없어요
```

> **"현장 방문 불필요"는 쓰지 않는다.** "감지된 이상 없음"이 정확한 표현.
> **"우산 비치됨"은 쓰지 않는다.** 실제 비치 여부는 알 수 없음. "우산 안내"로만.
> **V2에는 스마트 도어락 없음.** PIN 발급 관련 내용 포함하지 않는다.
> 청소 배정은 DB 상태가 확정일 때만 "됐어요". 미확정이면 "예정이에요".

**이상 있는 날 예시:**

```
⚠️ 확인 필요: 1건
  이태원 테라스 청소 미배정 — 오늘 14시 체크인, 남은 시간 6시간
  → https://proposonline.com/events/abc123
```

**데이터 소스:**
| 항목 | 소스 |
|------|------|
| 오늘 체크인/아웃 예정 | iCal |
| 청소 배정 상태 | `cleaning_jobs` 테이블 |
| 날씨 예보 | 외부 날씨 API (좌표 기반) |
| 현재 이상 건수 | KV 현재 상태 (ISSUE_* 상태 숙소 수) |

---

### 11-2. 일일 저녁 결산 (매일 22:00 KST — Cron: `api/cron/daily-result`)

**목적**: 오늘 하루 현장에서 일어난 일의 요약. 내일을 위한 사전 인지.

```
🌙 PROPOS 오늘 결산 (10/3)

✅ 오늘 자동으로 처리됐어요
  • 체크아웃 2건 · 체크인 1건 — 전부 무인 처리 완료
  • 애월 스튜디오 게스트 불만 + 온도 17도
    → 22도 자동 조정했어요 (약 1분 내 완료)
  • 홍대 원룸 A 공실 중 냉방 감지 → 자동 차단했어요

📋 내일 예정
  • 체크아웃: 이태원 테라스(10시)
  • 청소 배정: 됐어요

❌ 미해결: 없어요
```

---

### 11-3. 주간 안심 결산 (매주 일요일 22:00 KST — Cron: `api/cron/weekly-report`)

**목적**: "이번 주 PROPOS가 얼마나 많은 현장 방문을 대체했는가"를 보여주는 레포트.
매출/예약률 없음. 현장 운영 품질만.

```
📊 PROPOS 주간 결산 (9/28~10/4)

🔐 안심 지수: 94%  (이상 17건 중 자동 16건 · 수동 1건)
⏱ 이번 주 절약 예상: 약 4시간 (건당 15분 추산 · 실제와 차이 있을 수 있어요)

체크인/아웃 14건 무인 처리  |  체크아웃 제시간: 85% (6/7건)
체크인 전 청소 완료율: 100%

이번 주 자동 처리된 주요 사례
  ▸ 화요일: 폭우 + 애월 스튜디오 습도 89% → 제습 자동 실행, 정상화 완료
  ▸ 목요일: 홍대 원룸 A 게스트 불만 + 온도 32도 → 냉방 가동, 약 15분 내 복귀
  ▸ 주말: 이태원 테라스 공실 냉방 3시간 → 자동 차단했어요

수동 개입: 1건  (이태원 테라스 청소팀 연락 불가 → 직접 대체 배정)
  원인: 연락처 업데이트 안 됨 → 수정 완료

다음 주: 체크인 6건 / 청소 배정 5/5 ✅
→ 전체 내역 보기: https://proposonline.com/weekly/2026-w40
```

> **절약 추정 시간은 계산 기준을 항상 명시한다.** (예: 건당 15분 기준)
> **수동 개입 소요 시간은 앱 처리 기준으로만 표기.** 실제 통화·이동 시간은 시스템이 측정 불가.
> **청소 소요시간은 레포트에 포함하지 않는다.** 청소 속도는 청소팀 역량. PROPOS 성과가 아님. "체크인 전 완료율"로 대체.

**데이터 소스:**
| 항목 | 소스 |
|------|------|
| 안심 지수 | events 테이블 (`resolution_type`: auto / manual) |
| 체크인 전 청소 완료율 | `cleaning_jobs.finished_at` vs iCal `checkin_at` |
| 체크아웃 준수율 | `check_out_detected` 시각 vs iCal `checkout_at` |
| 통합 감지 내역 | events 테이블 (`integration_sources` 필드) |
| 다음 주 청소 배정 | `cleaning_jobs` + iCal join |
| 날씨 정보 | 외부 날씨 API |

---

### 11-4. 월간 현장 보고서 (매월 1일 08:00 KST — Cron: `api/cron/monthly-report`)

**목적**: 숙소별 현장 품질 추세와 구조적 문제 파악. 다음 달 준비 상태 확인.

**Slack에는 요약 2줄 + 링크만 발송. 상세 내용은 웹 대시보드.**

Slack 발송 내용:
```
📈 PROPOS 9월 현장 보고서

안심 지수 91% (8월 87% → +4%p)  |  수동 개입 13건
확인 필요: 이태원 테라스 청소팀 교체 권장 · 부산 해운대뷰 도어락 배터리
→ 전체 보고서 보기: https://proposonline.com/monthly/2026-09
```

웹 대시보드 상세 내용 (Slack에 포함하지 않음):

```
현장 운영 품질 지표

| 항목                  | 9월      | 8월      | 추세  |
|-----------------------|----------|----------|-------|
| 청소 자동 배정율       | 94%      | 88%      | ✅    |
| 체크인 전 청소 완료율  | 97%      | 91%      | ✅    |
| 체크아웃 제시간 준수   | 81%      | 74%      | ✅    |
| 에너지 낭비 자동 차단  | 8건      | 15건     | ✅    |
| 소음 감지 후 자동 대응 | 100%     | 87%      | ✅    |

* "청소 소요시간"은 청소팀 역량에 따른 값 — PROPOS 성과 지표 제외.
* ✅ = 개선, ⚠️ = 악화.

자동화 처리 요약 (9월)
  자동 대응: 총 134건 (안심 지수 91%)
  수동 개입: 13건 — 앱 기준 평균 약 9분 소요

숙소별 현장 건강 지수

| 숙소            | 안심지수 | 저해 요인              | 개선 조건                  |
|-----------------|----------|----------------------|--------------------------|
| 애월 스튜디오    | A+(98%)  | —                    | —                        |
| 홍대 원룸 A     | A (93%)  | 냉방 지연 감지 2회    | HA 냉방 응답속도 점검      |
| 이태원 테라스   | B+(84%)  | 청소팀 연락 불가 2회  | 청소팀 교체 시 A 예상      |
| 강남 오피스텔 B | A (91%)  | —                    | —                        |
| 부산 해운대뷰   | B (79%)  | 도어락 오프라인 3회   | 배터리 교체 (이달 내)      |

다음 달 준비 상태
  청소 배정: 24/28건 완료 (4건 미배정 → 확인 필요해요)
  기기 점검: 부산 해운대뷰 도어락 배터리 교체 필요해요
```

**숙소 건강 지수 등급 기준:**

| 등급 | 안심지수 | 판단 기준 |
|------|----------|-----------|
| A+   | 95~100%  | 이달 수동 개입 0~1건 |
| A    | 88~94%   | 수동 개입 2~3건 또는 경미한 반복 패턴 존재 |
| B+   | 80~87%   | 반복 이슈 있음 — 원인 파악 및 개선 가능 |
| B    | 70~79%   | 구조적 문제 (기기 결함, 청소팀 이슈 등) — 조치 필요 |
| C    | ~69%     | 즉각 점검 필요 |

> **건강 지수는 IoT 기기 결함(배터리 방전, 오프라인)으로 하락할 수 있다.** 기기 문제는 운영 품질과 구분해서 원인을 표시한다. "B501 B등급 — 도어락 오프라인(배터리)"처럼 원인을 함께 표기.

---

## 12. 통합 감지 시나리오 유형 (Cross-Data Integration)

단일 센서 반응이 아닌 다중 데이터 교차 분석. PROPOS의 핵심 차별점.

**현재 구현 가능 (Phase 1~2)** / **Phase 3 예정** 으로 구분.

| 입력 조합 | 판단 + 자동 대응 | 구현 |
|-----------|-----------------|------|
| 날씨 폭우 + 당일 체크인 | 게스트에게 날씨 안내 발송 예약 | Phase 1 |
| 게스트 불만 키워드 + 온도/습도 센서 이상 동시 확인 | 냉난방 자동 조정 + 약 30분 후 재확인 | Phase 1 |
| 체크아웃 미감지 + 체크인 3시간 이내 | 청소팀 긴급 알림 + 게스트 지연 사전 안내 | Phase 1 |
| VACANT 상태 + 전력 소비 30분 이상 | 소등·소냉 자동 처리 | Phase 1 |
| 날씨 폭우/폭설 + 실내 습도 급등 | 자동 제습 실행 | Phase 1 |
| 게스트 불만 + 체류 7일 이상 | 관리자 즉시 알림 + 우선 대응 플래그 | Phase 2 |
| 청소 진행 시간 + 체크인까지 남은 시간 | 지연 가능성 계산 → 게스트 사전 안내 | Phase 2 |
| 지역 이벤트 뉴스 + 소음 센서 | 소음 임계값 사전 하향 + 게스트 안내 | Phase 3 (미정) |

### 구현 주의사항

**날씨 API**
- HA 연동 네이버 날씨 (기상청 데이터) 사용 — 이미 구현됨
- 숙소별 좌표(`lat`, `lon`)가 `property` 테이블에 있어야 날씨 연동 가능
- API 장애 시: 날씨 항목 생략, 나머지 레포트는 정상 발송
- 장애 감지 방법: HA의 weather entity 상태가 `unavailable`이면 생략 처리

**게스트 메시지 키워드 감지 — 오탐 방지**
- "춥다" 단독 키워드 매칭은 "안 춥다", "춥지 않아요"에서 오탐 발생
- 반드시 **센서 이상과 동시 확인**된 경우에만 자동 대응으로 연결
- "동시"의 시간 윈도우: **게스트 메시지 발생 전후 60분 이내** 센서 이상 확인된 경우
- 키워드 단독 감지(센서 정상)는 안심 지수 분모에 포함하지 않는다

**체크아웃 제시간 판정 기준**
- `checkout_at` + **30분** 이내에 `check_out_detected` 이벤트 발생 → 제시간
- 30분 초과 → 지연으로 집계
- 이 기준 변경 시 과거 데이터와 비교 불가 — 신중히 결정할 것

**청소 미배정 구분**
| 상태 | 정의 | 처리 |
|------|------|------|
| `PENDING_SCHEDULED` | 체크아웃 24시간 이상 남음 | 정상, 알림 없음 |
| `PENDING_URGENT` | 체크인 12시간 이내, 미배정 | ⚠️ 즉시 알림 |
| `ASSIGNMENT_ERROR` | 배정 로직 실행됐으나 실패 | ❌ 즉시 알림 + 에러 로그 |

미배정 레포트에는 `PENDING_URGENT`와 `ASSIGNMENT_ERROR`만 포함. `PENDING_SCHEDULED`는 정상으로 분류.

### 통합 감지 이벤트 DB 필드 (`events` 테이블 확장)

```sql
ALTER TABLE events ADD COLUMN IF NOT EXISTS
  integration_sources JSONB DEFAULT NULL;
  -- 예: {"weather": "rain", "sensor_humidity": 89, "checkin_in_hours": 4}

ALTER TABLE events ADD COLUMN IF NOT EXISTS
  auto_actions JSONB DEFAULT NULL;
  -- 예: ["hvac_set_22c", "guest_message_sent"]
  -- TEXT 아닌 JSONB: 복수 조치 저장 가능

ALTER TABLE events ADD COLUMN IF NOT EXISTS
  resolution_type TEXT DEFAULT NULL;
  -- 'auto' | 'manual' | 'pending'

ALTER TABLE events ADD COLUMN IF NOT EXISTS
  resolution_seconds INTEGER DEFAULT NULL;
  -- 감지 ~ 해결까지 소요 초 단위 (분 단위는 너무 거침)
```

이 필드들이 채워져야 안심 지수 계산과 통합 감지 레포트 생성 가능.

---

## 14. 수정 금지 파일 (이 기능 구현 중)

```
src/components/v1/*
src/components/App.jsx
docs/scenarios.yaml
docs/room-state-machine.md
docs/event-detection-design.md
dist/
```
