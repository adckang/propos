# PROPOS 데이터 저장 설계
> 버전: v1.0 | 작성: 2026-08-04
> 구현 기준 문서 — 이 파일을 축으로 삼아 스토리지 코드를 작성·수정한다.
> 이벤트 타입 정의는 `event-detection-design.md`가 정본. 이 파일은 저장 방식만 다룬다.

---

## 1. 설계 원칙

**Postgres = 단일 진실 원천 (Single Source of Truth)**

- KV는 Postgres에서 언제든 재건 가능한 캐시다.
- Blob은 Postgres 이벤트 레코드가 URL을 소유하는 첨부다.
- Pi NDJSON은 Vercel 전송 전 임시 버퍼다. 영구 저장 위치가 아니다.

**쓰기 순서를 고정한다**

Postgres 저장이 성공해야 나머지 단계로 진행한다.
Postgres 저장 후 어느 단계가 실패해도 재처리 가능하다.

---

## 2. 저장소 역할

| 저장소 | 역할 | 실패 시 영향 |
|--------|------|-------------|
| Vercel Postgres | 이벤트 로그, 월별 집계 — 영구 저장 | 심각. 최우선 보호. |
| Vercel KV | 현재 상태 캐시 (TTL 5분) | 경미. 자동 복구. |
| Vercel Blob | 입퇴실 시점 CCTV 스냅샷 아카이브 | 경미. 이벤트 기록은 유지. |
| Pi NDJSON | 미전송 이벤트 임시 큐 (Outbox) | 경미. Vercel 전송 완료 후 제거. |

---

## 3. Postgres 스키마

### 3-1. events 테이블 (핵심)

```sql
CREATE TABLE events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   TEXT        NOT NULL,
  type          TEXT        NOT NULL,
  is_soft       BOOLEAN     NOT NULL DEFAULT false,
  device_time   TIMESTAMPTZ NOT NULL,
  server_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data          JSONB,
  blob_url      TEXT,
  notified_at   TIMESTAMPTZ,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'complete', 'failed')),
  UNIQUE (property_id, type, device_time)
);

CREATE INDEX idx_events_property_time ON events (property_id, device_time DESC);
CREATE INDEX idx_events_pending       ON events (status) WHERE status = 'pending';
```

**컬럼 설명**

| 컬럼 | 설명 |
|------|------|
| `id` | 모든 저장소의 연결 키. Blob 파일명(`{id}.jpg`), Slack 링크(`/events/{id}`)에 사용. |
| `type` | `event-detection-design.md` 섹션 5의 이벤트명 그대로 사용. |
| `is_soft` | true = 상태 변경 없는 soft 이벤트 (checkout_confirmation_needed 등). |
| `device_time` | Pi 발생 시각. **표시·비즈니스 로직 기준.** |
| `server_time` | Vercel 수신 시각. 삽입 순서 보장용. Pi 재시도 지연으로 왜곡 가능하므로 기준으로 쓰지 않는다. |
| `data` | 이벤트별 추가 정보. 예: `{"noise_db": 72, "duration_min": 15}` |
| `blob_url` | check_in_detected / check_out_detected 시점 스냅샷 URL. 나머지는 null. |
| `notified_at` | Slack 발송 시각. null이면 미발송. |
| `status` | pending → complete / failed. Pi가 200을 받으면 큐에서 제거. |

**UNIQUE 제약 해설**

`(property_id, type, device_time)` 조합으로 중복을 두 겹 차단한다.
- UUID 충돌 방지: `id` PRIMARY KEY
- 의미 기반 중복 방지: Pi 크래시 후 재시도 시 같은 실제 이벤트가 새 UUID로 들어오는 경우를 차단.

### 3-2. monthly_summaries 테이블

```sql
CREATE TABLE monthly_summaries (
  property_id        TEXT  NOT NULL,
  month              DATE  NOT NULL,   -- 해당 월 1일. 예: 2026-08-01
  check_ins          INT   NOT NULL DEFAULT 0,
  check_outs         INT   NOT NULL DEFAULT 0,
  anomaly_count      INT   NOT NULL DEFAULT 0,
  energy_waste_count INT   NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, month)
);
```

90일이 지난 events 행을 여기로 집계 후 원본 삭제한다. (→ 섹션 8 참조)

---

## 4. 이벤트 타입

`event-detection-design.md` 섹션 5를 정본으로 한다. 여기서 재정의하지 않는다.

저장 시 규칙:
- 상태 기계 이벤트 → `is_soft = false`
- Soft 이벤트 → `is_soft = true`, 상태 변경 없이 알림만 발송

공유 상수 파일 위치: `src/config/eventTypes.js`
Pi(`scripts/`)와 Vercel API(`api/`)가 동일 파일을 import한다.

```js
// src/config/eventTypes.js
// Pi(scripts/)와 Vercel(api/) 양쪽에서 공유. 위치·이름 변경 금지.
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

  // Soft 이벤트 (is_soft: true, 상태 변경 없음)
  CHECKOUT_CONFIRMATION_NEEDED:  'checkout_confirmation_needed',
  EARLY_CHECKIN_SUSPECTED:       'early_checkin_suspected',
  NO_SHOW_SUSPECTED:             'no_show_suspected',
});

export const SOFT_EVENT_TYPES = new Set([
  'checkout_confirmation_needed',
  'early_checkin_suspected',
  'no_show_suspected',
]);
```

---

## 5. 쓰기 파이프라인

### 5-1. 새 API 엔드포인트

`POST /api/events` — Pi watcher가 이벤트 발생 시 호출

### 5-2. 처리 순서 (순서 고정, 변경 금지)

```
1. Zod 검증
   ├─ 실패 → 400 반환 (Pi: deadLetter로 이동, 재시도 안 함)
   └─ 성공 → 계속

2. Postgres INSERT ON CONFLICT (property_id, type, device_time) DO NOTHING
   ├─ 실패 → 500 반환 (Pi: 재시도)
   └─ 성공 → event id 확보, 계속

3. KV 업데이트  state:{property_id} (TTL 5분)
   └─ 실패해도 계속 — 캐시 miss 시 Postgres에서 자동 복구

4. Blob 업로드  (check_in_detected / check_out_detected 에만)
   ├─ 성공 → Postgres UPDATE SET blob_url = '{id}.jpg'
   └─ 실패해도 계속 — blob_url null로 이벤트는 보존

5. Slack 발송   proposonline.com/events/{id} 링크 포함
   ├─ 성공 → Postgres UPDATE SET notified_at = NOW()
   └─ 실패해도 계속 — notified_at null로 재발송 가능

6. Postgres UPDATE SET status = 'complete'

7. 200 반환 → Pi가 큐에서 해당 행 제거
```

### 5-3. Zod 스키마

```js
import { z } from 'zod';
import { EVENT_TYPES } from '../../src/config/eventTypes.js';

export const EventSchema = z.object({
  id:          z.string().uuid(),
  property_id: z.string().min(1).max(64),
  type:        z.enum(Object.values(EVENT_TYPES)),
  device_time: z.string().datetime(),
  data:        z.record(z.unknown()).optional(),
});
```

---

## 6. Pi Outbox (NDJSON)

### 6-1. 파일 구조

```
data/
  eventQueue.ndjson    — 미전송 이벤트 (한 줄 = 이벤트 1개)
  deadLetter.ndjson    — 3회 재시도 실패 이벤트 (수동 확인용)
```

### 6-2. 이벤트 행 형식

```json
{"id":"uuid","property_id":"paju201","type":"check_out_detected","device_time":"2026-08-04T10:12:00Z","retry":0,"data":{}}
```

### 6-3. 쓰기 규칙

- 쓰기: `fs.appendFileSync` (줄 추가만)
- 전원 차단 시 마지막 줄만 손상, 나머지 행 보존
- 손상된 JSON 줄은 파싱 실패로 건너뜀

### 6-4. 전송 로직

```
startup → eventQueue.ndjson 읽기 → 미완료 이벤트 복원
          (Pi 재부팅 후 자동 재시도)

이벤트 발생 → UUID 생성 → appendFileSync

전송 루프 (30초 간격):
  각 행 POST /api/events
  ├─ 200 → 해당 행 제거 후 파일 재기록
  ├─ 400 → deadLetter로 이동 (재시도 안 함)
  └─ 기타 → retry++ → 3회 초과 시 deadLetter로 이동
```

### 6-5. 파일 재기록 안전성

```
1. eventQueue.ndjson 읽기
2. 처리 완료 행 제외하고 temp 파일에 쓰기
3. rename(temp → eventQueue.ndjson)  ← 원자적 교체
```

---

## 7. KV 전략

### 7-1. 키 구조

| 키 | 값 | TTL |
|----|-----|-----|
| `state:{property_id}` | `{roomState, temp, humidity, wsConnected, updatedAt}` | 5분 |
| `report:daily:{property_id}:{YYYY-MM-DD}` | 일별 집계 캐시 | 1시간 |

### 7-2. 읽기 전략

```
KV GET state:{property_id}
├─ 캐시 hit  → 즉시 반환
└─ 캐시 miss → Postgres 쿼리 → KV SET (TTL 5분) → 반환
```

명시적 동기화 코드 없음. TTL 만료가 자동 갱신 트리거.

### 7-3. KV 완전 초기화 복구

KV가 날아가도 Postgres의 최신 이벤트에서 현재 상태 재건 가능:

```sql
SELECT type, device_time FROM events
WHERE property_id = $1
ORDER BY device_time DESC LIMIT 1;
```

---

## 8. Blob 전략

### 8-1. 저장 대상

`check_in_detected` / `check_out_detected` 시점 스냅샷만 저장.
체류 중 이상감지 스냅샷은 Pi 로컬에만 보관 (Blob 저장 안 함).

### 8-2. 파일명

```
snapshots/{event_id}.jpg
```

event id를 파일명으로 쓰므로 Postgres events.blob_url로 역추적 가능.

### 8-3. 보존 정책

Blob 파일은 삭제하지 않는다. Vercel Blob은 URL이 영구적이며 events.blob_url이 이를 참조한다.

---

## 9. 데이터 보존 정책

### 9-1. 보존 기간

| 데이터 | 보존 | 처리 |
|--------|------|------|
| events (원본) | 90일 | 이후 monthly_summaries로 집계 후 삭제 |
| monthly_summaries | 영구 | 삭제 안 함 |
| Blob 스냅샷 | 영구 | 삭제 안 함 |

### 9-2. 월별 압축 Cron

Vercel Cron: 매월 1일 03:00 KST

```js
// api/cron/archive-events.js
// 1. 90일 이전 events → monthly_summaries로 INSERT ... ON CONFLICT DO UPDATE
// 2. 집계된 events DELETE
// 3. 결과 Slack 발송
```

### 9-3. 무료 한도 예상

숙소 10개, 일 30건 기준 연간 약 25MB.
Postgres 256MB 무료 한도에서 수년간 운영 가능.

---

## 10. 무결성·추적성 보장 원칙

| 리스크 | 예방책 |
|--------|--------|
| UUID 충돌 | PRIMARY KEY |
| 의미 중복 (Pi 재시도) | UNIQUE(property_id, type, device_time) |
| 이벤트 누락 | Pi Outbox + 재시도 |
| 파일 손상 | NDJSON + 원자적 rename |
| 형식 오염 | Zod 검증 (진입점) |
| 타임스탬프 왜곡 | device_time 기준, server_time 순서용 |
| 상태 기계 오염 | `event-detection-design.md`의 전이 규칙만 사용 |
| 부분 실패 추적 | status 컬럼 (pending/complete/failed) |
| 저장소 간 연결 | event id가 Blob 파일명·Slack 링크·KV key의 공통 키 |
| DB 연결 고갈 | @vercel/postgres 내장 풀링 |

---

## 11. 환경변수

Vercel 스토리지 연결 시 자동 주입 (수동 입력 불필요):

| 변수 | 출처 | 용도 |
|------|------|------|
| `POSTGRES_URL` | Vercel Postgres 연결 시 자동 | DB 연결 |
| `KV_REST_API_URL` | Vercel KV 연결 시 자동 | KV 읽기/쓰기 |
| `KV_REST_API_TOKEN` | Vercel KV 연결 시 자동 | KV 인증 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 연결 시 자동 | Blob 업로드 |

수동 추가 필요:

| 변수 | 저장 위치 | 용도 |
|------|----------|------|
| `PROPOS_SLACK_WEBHOOK` | Vercel 환경변수 | Slack 알림 발송 URL |

**모두 Vercel 환경변수만. 소스코드·git 커밋 절대 금지.**

---

## 12. 패키지

```bash
npm install zod @vercel/postgres @vercel/kv @vercel/blob
```

`@vercel/postgres`, `@vercel/kv`, `@vercel/blob`은 **`api/` 폴더에서만 import**.
`src/` 파일에서 import하면 Vite 번들링 시 Node.js built-in 오류 발생.

---

## 13. 구현 체크리스트

- [ ] `src/config/eventTypes.js` 생성
- [ ] Vercel Postgres 생성 및 프로젝트 연결
- [ ] Postgres 스키마 적용 (events, monthly_summaries)
- [ ] Vercel KV 생성 및 프로젝트 연결
- [ ] Vercel Blob 생성 및 프로젝트 연결
- [ ] `PROPOS_SLACK_WEBHOOK` Vercel 환경변수 추가
- [ ] `POST /api/events` 구현 (Zod → Postgres → KV → Blob → Slack)
- [ ] Pi Outbox 구현 (`data/eventQueue.ndjson`)
- [ ] `GET /api/events?property_id=&from=&to=` 구현 (히스토리 조회)
- [ ] `GET /api/events/report/daily` 구현 (일별 집계, KV 캐시)
- [ ] `api/cron/archive-events.js` 구현 (월별 압축)
- [ ] `npm install zod @vercel/postgres @vercel/kv @vercel/blob`
- [ ] node:test 테스트 작성 (eventTypes, Zod 검증, Outbox 로직)
- [ ] scenarios.yaml 업데이트 (레포팅 시나리오 추가)
