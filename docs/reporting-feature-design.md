# PROPOS Reporting Feature 설계
> 버전: v1.0 | 작성: 2026-08-04
> 구현 기준 문서 — 이 파일과 data-storage-design.md를 축으로 삼아 reporting 코드를 작성·수정한다.
> 저장소 설계: `data-storage-design.md` / 이벤트 감지: `event-detection-design.md` / 상태 기계: `room-state-machine.md`

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

## 2. 타임라인 필터 (확정)

```
◀  지난달   지난주  │  이번주  │  다음주   다음달  ▶
                   │  현재 ●  │
```

- 현재(●): 기본 선택. 실시간 상태.
- 좌측: 과거 결과 레포트.
- 우측: 미래 계획 레포트.
- 선택 변경 시 KPI 타일 전체 전환.

### 기간 정의

| 키 | 범위 |
|----|------|
| `now` | 실시간 (날짜 범위 없음) |
| `this_week` | 이번 주 월요일 00:00 ~ 일요일 23:59 |
| `last_week` | 직전 주 월요일 ~ 일요일 |
| `next_week` | 다음 주 월요일 ~ 일요일 |
| `this_month` | 이번 달 1일 ~ 말일 |
| `last_month` | 직전 달 1일 ~ 말일 |
| `next_month` | 다음 달 1일 ~ 말일 |

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

---

## 11. 수정 금지 파일 (이 기능 구현 중)

```
src/components/v1/*
src/components/App.jsx
docs/scenarios.yaml
docs/room-state-machine.md
docs/event-detection-design.md
dist/
```
