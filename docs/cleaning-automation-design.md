# 청소 자동화 시스템 설계

> 작성: 2026-08-09 | 최종 확정: 2026-08-10 | 상태: **구현 완료 (단계 1~12)**
> 코드 버그 리뷰: 2026-08-10 (버그 B·E·F·J 추가 수정)
> 수정/삭제 로직은 이 문서 범위 제외 — 별도 문서로 추후 수립

## 확정된 결정 (2026-08-10)

| 항목 | 결정 |
|------|------|
| 청소자 관리 UI | PROPOS 내 자체 UI + Postgres (A안) |
| VIP 창 만료 후 뒤늦은 수락 | 구글 예약 캘린더 선착순 — 슬롯 1개, 먼저 예약한 사람이 배정 |
| SMS 발송 | android-sms-gateway (Play Store) + 클라우드 모드 |
| 배정 감지 | 구글 예약 캘린더 예약 = 수락. Calendar Webhook → 이메일로 cleaner 매핑 |
| 구글 예약 캘린더 양식 | 전화번호 필드는 유료 → **이메일(무료 기본 필드)로 대체** |
| Google OAuth | Gmail Watch(단계 10) + Calendar Webhook(단계 9) 모두 필요 |

---

---

## 1. 개요

에어비앤비 체크아웃 일정을 자동 감지하고, 청소자에게 순차/동시 발송하여 청소를 배정하는 완전 자동화 시스템.

### 트리거 2가지

| 트리거 | 조건 | 발동 시점 |
|--------|------|----------|
| **월간 일괄** | 매월 15일 | 다음 달 전체 청소 일정 한꺼번에 처리 |
| **즉시 처리** | 2주 이내 신규 예약 | Gmail API 감지 후 즉시 발동 |

---

## 2. 기술 스택

| 컴포넌트 | 기술 | 비고 |
|---------|------|------|
| 예약 감지 (즉시) | Gmail API Watch (Pub/Sub) | 에어비앤비 예약 확정 이메일 감지 |
| 예약 파싱 | 기존 iCal 파서 | 이메일 감지 후 iCal 재폴링 트리거 |
| SMS 발송 | android-sms-gateway (Play Store) + 클라우드 모드 | 내 번호로 발송만 |
| 배정 감지 | Google Calendar Webhook | 청소자 예약 완료 → 이메일로 cleaner 매핑 |
| 거절 링크 | `proposonline.com/d/[TOKEN]` | 6자 토큰, 1회성 |
| 구글 예약 링크 | 숙소별 구글 예약 캘린더 | `proposonline.com/c/{property_id}` → redirect |
| 호스트 알림 | Slack (기존 인프라) | 에스컬레이션 시 |
| 청소자 DB | Vercel Postgres | `cleaners` 테이블 |
| 스케줄러 | Vercel Cron | 월간 배치 + 주기적 후속 처리 |
| 당근마켓 공고 | 수동 | 자동화 제외 |

---

## 3. 청소자 우선순위 모델

### 2티어 구조

```
VIP 티어 (순차 발송)
├── VIP_1  — 최우선. 한 명.
├── VIP_2  — VIP_1 불가 시. 한 명.
└── VIP_3  — VIP_2 불가 시. 한 명.

BULK 티어 (동시 발송)
└── 나머지 전원 — VIP 전원 불가 시 동시 발송.
```

### 타임라인

```
T+0h    VIP_1에게 SMS 발송
T+1h    VIP_1 무응답 or 거절 → VIP_2에게 발송
T+2h    VIP_2 무응답 or 거절 → VIP_3에게 발송
T+3h    VIP_3 무응답 or 거절 → BULK 전원 동시 발송
T+4h    BULK 발송 후 1시간 내 무응답자 → 리마인드 1회
T+6h    BULK 발송 후 3시간까지 배정 없음 → 호스트 Slack 알림
```

### 핵심 정책

- **VIP 창 만료**: 다음 단계로 넘어간 후 이전 VIP가 뒤늦게 구글 예약해도 무효. 구글 슬롯이 이미 다른 사람 것이면 예약 자체 불가. DB는 조건부 UPDATE (`WHERE status != 'ASSIGNED'`)로 이중 방어.
- **BULK 중복 수락 방지**: 구글 예약 캘린더 슬롯 1개 → 선착순 1명만 예약 가능. Calendar Webhook에서도 조건부 UPDATE로 이중 방어.
- **수락 확정 시**: ASSIGNED 처리 즉시 나머지 notif 전원에게 "배정 완료됐습니다" SMS 자동 발송.

---

## 4. 상태 머신

### cleaning_jobs 상태

```
PENDING
  │ 발송 시작
  ▼
NOTIFYING_VIP_1
  │ 1시간 무응답 or 거절
  ▼
NOTIFYING_VIP_2
  │ 1시간 무응답 or 거절
  ▼
NOTIFYING_VIP_3
  │ 1시간 무응답 or 거절
  ▼
NOTIFYING_BULK
  │ 1시간 경과
  ▼
BULK_REMINDED        ← 리마인드 1회 발송 완료
  │ 3시간 경과 or 전원 거절
  ▼
ESCALATED            ← 호스트 Slack 알림 발송

━━━━━━━━━━━━━━━━━━━━━
어느 상태에서든 구글 예약 완료 webhook 수신 시
  ▼
ASSIGNED             ← 청소자 확정
  ▼
COMPLETED            ← (향후) 청소 완료 처리
```

---

## 5. 데이터 모델

### property_cleaning_config (신규)

```sql
CREATE TABLE IF NOT EXISTS property_cleaning_config (
  property_id                TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  checkout_hour              INT  NOT NULL DEFAULT 11,
  cleaning_duration_hours    FLOAT NOT NULL DEFAULT 2.5,
  google_calendar_id         TEXT,
  google_calendar_booking_url TEXT,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`/api/cleaning/properties` (GET/POST)로 관리.

### cleaners

```sql
CREATE TABLE cleaners (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,          -- 010-0000-0000 형식 (하이픈 포함)
  email      TEXT NOT NULL UNIQUE,          -- 구글 예약 캘린더 매핑 키
  tier       TEXT NOT NULL                  -- 'VIP_1'|'VIP_2'|'VIP_3'|'BULK'
               CHECK (tier IN ('VIP_1','VIP_2','VIP_3','BULK')),
  active     BOOLEAN NOT NULL DEFAULT true,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### cleaning_jobs

```sql
CREATE TABLE cleaning_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         TEXT NOT NULL,
  reservation_uid     TEXT,                 -- iCal UID (중복 방지)
  checkout_at         TIMESTAMPTZ NOT NULL,
  cleaning_start_at   TIMESTAMPTZ NOT NULL, -- property.checkOutHour 기준 KST (숙소별 상이)
  cleaning_end_at     TIMESTAMPTZ,          -- cleaning_start_at + property.cleaningDurationHours
  dispatch_after      TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- 발송 가능 시각 (월간 배치 10분 분산용)
  status              TEXT NOT NULL DEFAULT 'PENDING',
  assigned_cleaner_id UUID REFERENCES cleaners(id),
  google_event_id     TEXT,                 -- Calendar Webhook에서 수신한 구글 이벤트 ID
  source              TEXT NOT NULL         -- 'MONTHLY_BATCH'|'SHORT_NOTICE'
               CHECK (source IN ('MONTHLY_BATCH','SHORT_NOTICE')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, checkout_at)         -- 같은 숙소 같은 날 중복 방지
);
```

### cleaning_notifs

```sql
CREATE TABLE cleaning_notifs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES cleaning_jobs(id) ON DELETE CASCADE,
  cleaner_id    UUID NOT NULL REFERENCES cleaners(id),
  tier          TEXT NOT NULL,              -- 발송 당시 티어
  token         CHAR(6) NOT NULL UNIQUE,    -- 거절 링크 토큰 (A-Z0-9)
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reminded_at   TIMESTAMPTZ,               -- 리마인드 발송 시각
  response      TEXT                        -- 'DECLINED' | 'DECLINED_AFTER_ASSIGNED' | NULL
               CHECK (response IS NULL OR response IN ('DECLINED','DECLINED_AFTER_ASSIGNED')),
  response_at   TIMESTAMPTZ,
  UNIQUE (job_id, cleaner_id)
);
```

**인덱스**
```sql
CREATE INDEX idx_cleaning_jobs_status    ON cleaning_jobs(status);
CREATE INDEX idx_cleaning_jobs_checkout  ON cleaning_jobs(checkout_at);
CREATE INDEX idx_cleaning_notifs_token   ON cleaning_notifs(token);
CREATE INDEX idx_cleaning_notifs_job     ON cleaning_notifs(job_id);
```

---

## 6. API 엔드포인트

### 자동화 흐름 (내부)

| 메서드 | 경로 | 역할 |
|--------|------|------|
| **GET** | `/api/cron/monthly-cleaning` | 매월 15일 KST 09:00 — dispatch_after 스케줄링 |
| **GET** | `/api/cron/cleaning-followup` | 30분마다 — PENDING 발동 + 리마인드 + 에스컬레이션 |
| POST | `/api/gmail/webhook` | Gmail Pub/Sub 수신 |
| POST | `/api/calendar/webhook` | 구글 예약 완료 수신 → 배정 처리 |
| POST | `/api/sms/send` | android-sms-gateway 발송 프록시 (CRON_SECRET 인증) |

> **참고**: Vercel Cron은 GET 메서드로 호출. POST가 아님.

### 공개 링크

| 메서드 | 경로 | 역할 |
|--------|------|------|
| GET | `/api/d/[token]` | 거절 처리 (토큰 1회성) — HTML 응답 |
| GET | `/api/c/[propertyId]` | 숙소별 구글 예약 캘린더로 302 redirect |

### 관리자 UI용

| 메서드 | 경로 | 역할 |
|--------|------|------|
| GET/POST | `/api/cleaning/cleaners` | 청소자 목록/등록 |
| PATCH/DELETE | `/api/cleaning/cleaners/[id]` | 청소자 수정/비활성화 |
| GET/POST | `/api/cleaning/properties` | 숙소 청소 설정 목록/등록·수정 |
| GET | `/api/cleaning/jobs` | 청소 일정 목록 (?status=&limit=) |
| GET | `/api/cleaning/jobs/[id]` | 청소 일정 상세 (notifs 포함) |
| POST | `/api/cleaning/dispatch/[jobId]` | 수동 발송 시작 (PENDING job 전용) |

---

## 7. SMS 메시지 템플릿

### VIP 발송

```
[PROPOS] 청소 요청 드립니다
📍 {숙소명}
🕐 {checkout_date} {start_time}
수락(예약): proposonline.com/c/{property_id}
거절: proposonline.com/d/{TOKEN}
1시간 내 응답 부탁드립니다
```

### BULK 발송

```
[PROPOS] 청소 아르바이트 안내
📍 {숙소명}
🕐 {checkout_date} {start_time}
선착순 예약: proposonline.com/c/{property_id}
불가 시: proposonline.com/d/{TOKEN}
```

### 리마인드

```
[PROPOS] 재안내 드립니다
{숙소명} {checkout_date} 청소 아직 미확정입니다
예약: proposonline.com/c/{property_id}
거절: proposonline.com/d/{TOKEN}
```

### 배정 완료 (나머지 청소자용)

```
[PROPOS] {숙소명} {date} 청소가 배정 완료됐습니다. 감사합니다.
```

---

## 8. 거절 링크 처리 흐름

```
청소자가 proposonline.com/d/ABC123 클릭
    ↓
GET /api/d/ABC123
    ↓
cleaning_notifs WHERE token='ABC123' 조회
    ↓
유효성 검사
├── 토큰 없음 → 404
├── 이미 응답됨 → "이미 처리된 링크입니다"
└── job이 ASSIGNED/COMPLETED → "이미 배정 완료된 건입니다"
    ↓
cleaning_notifs.response = 'DECLINED', response_at = NOW()
    ↓
cleaning_jobs 상태 확인
├── NOTIFYING_VIP_1 → 즉시 VIP_2 발송 (1시간 대기 스킵)
├── NOTIFYING_VIP_2 → 즉시 VIP_3 발송
├── NOTIFYING_VIP_3 → 즉시 BULK 발송
└── NOTIFYING_BULK / BULK_REMINDED
    ├── 아직 미거절자 있음 → 계속 대기
    └── 전원 거절 → 즉시 ESCALATED 처리
    ↓
브라우저 응답: "거절 처리됐습니다. 감사합니다."
```

---

## 9. 구글 캘린더 Webhook 배정 흐름

```
청소자가 proposonline.com/c/{property_id} 클릭
    ↓
숙소별 구글 예약 캘린더 페이지 (이름 + 이메일 입력 후 예약)
    ↓
Google Calendar → Webhook → POST /api/calendar/webhook
    ↓
이벤트 파싱: 이메일, 시작 시각, calendarId
    ↓
property WHERE google_calendar_id = calendarId → property_id 확정
    ↓
cleaning_jobs WHERE property_id = :id
  AND status IN ('NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3',
                 'NOTIFYING_BULK','BULK_REMINDED')
→ 해당 property의 현재 진행 중인 job 1건 조회
(청소자가 어떤 슬롯을 예약했든 job은 property + 상태로 특정)
    ↓
cleaners WHERE email = 이메일 → cleaner_id 확정
(미등록 이메일 → assigned_cleaner_id = NULL, status = ASSIGNED, 호스트 Slack 알림)
    ↓
조건부 UPDATE (race condition 방지):
UPDATE cleaning_jobs SET status='ASSIGNED', assigned_cleaner_id=:id
WHERE id=:job_id AND status != 'ASSIGNED'
RETURNING id
    ↓
rows 반환 있음 → 정상 배정
    → 해당 job 나머지 notif 전원에게 "배정 완료됐습니다" SMS
    → 호스트 Slack: "{숙소명} {date} 청소 배정 완료 ({청소자명})"
rows 없음 → 이미 다른 청소자가 선점
    → (구글 예약은 슬롯 1개라 이 케이스 실질적으로 발생 안 함)
```

**구글 예약 캘린더 식별 방식**: 청소자가 입력하는 이메일(무료 기본 필드) → `cleaners.email` 매핑. 전화번호 필드(유료) 불필요.

**숙소 설정에 필요한 필드 2개**:
- `google_calendar_id` — `abc123@group.calendar.google.com` (Webhook calendarId 매핑용)
- `google_calendar_booking_url` — 구글 예약 페이지 URL (`/c/{property_id}` redirect 대상)

---

## 10. Gmail API 감지 흐름

```
에어비앤비 → 예약 확정 이메일 발송
    ↓
Gmail Pub/Sub → POST /api/gmail/webhook
    ↓
이메일 Subject 패턴 확인
└── "Reservation confirmed" | "예약 확정" 포함 여부
    ↓
iCal 즉시 재폴링 트리거
    ↓
신규 예약 감지 → checkout_at 계산
    ↓
checkout_at이 오늘부터 14일 이내?
├── YES → SHORT_NOTICE 즉시 플로우 시작
└── NO  → cleaning_jobs 생성 (PENDING 상태 유지, 월간 배치에 포함)
```

---

## 11. 월간 배치 흐름 (매월 15일)

```
Vercel Cron 발동 (UTC 00:00 = KST 09:00)
    ↓
다음 달 PENDING 상태 job 전체 조회
    ↓
같은 날 여러 건 → job마다 dispatch_after 설정 (10분 간격 순차)
예: 9/10 청소 3건 → dispatch_after = NOW(), NOW()+10m, NOW()+20m
    ↓
슬랙 알림 발송 후 종료 (함수 즉시 반환 — Vercel 타임아웃 방지)

    ↓ (30분 후)

cleaning-followup 크론 발동
    ↓
dispatch_after <= NOW() AND status='PENDING' → advanceJob 실행
```

> **설계 결정**: 월간 배치 내 `setTimeout` 불가 (Vercel 60s 제한). `dispatch_after` 컬럼으로 발송 시각을 DB에 기록하고, followup 크론이 실제 발송을 담당.

---

## 11-1. cleaning_start_at / cleaning_end_at 계산 공식

iCal에서 추출한 체크아웃 날짜와 숙소 설정값으로 KST 기준 계산:

```
// iCal DTEND는 날짜값(VALUE=DATE). 체크아웃 시각은 property.checkOutHour로 결정.
const checkoutDate = parsedFromIcal;          // e.g. "2026-09-10"
const checkOutHour  = property.checkOutHour ?? 11;
const durationHours = property.cleaningDurationHours ?? 2.5;

// KST → UTC 변환 (-9h)
cleaning_start_at = `${checkoutDate}T${pad(checkOutHour)}:00:00+09:00`
cleaning_end_at   = cleaning_start_at + durationHours * 3600s
```

**예시** (checkOutHour=11, cleaningDurationHours=2.5):
- 체크아웃 날짜: 2026-09-10
- `cleaning_start_at` = `2026-09-10T02:00:00Z` (KST 11:00)
- `cleaning_end_at`   = `2026-09-10T04:30:00Z` (KST 13:30)

**중요**: PROPOS UI에서 숙소 추가/수정 시 `checkOutHour`와 `cleaningDurationHours`를 입력받으며, 이 값이 cleaning_jobs 생성 시점에 스냅샷으로 반영됨. 이후 설정이 바뀌어도 기존 job은 유지.

---

## 12. 후속 처리 크론 (30분마다)

```
cleaning_jobs WHERE status IN ('NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3') 조회
    ↓
각 job의 최신 cleaning_notifs.sent_at + 1시간 경과 여부 확인
    ↓
경과됐으나 response 없음 → 다음 단계로 전환 + 발송

cleaning_jobs WHERE status = 'NOTIFYING_BULK' 조회
    ↓
sent_at + 1시간 경과 + reminded_at IS NULL인 notifs → 리마인드 발송
reminded_at 업데이트

cleaning_jobs WHERE status IN ('NOTIFYING_BULK','BULK_REMINDED') 조회
    ↓
bulk 발송 후 3시간 경과 OR 모든 notifs가 DECLINED
    ↓
status = 'ESCALATED'
Slack 알림 발송: "[PROPOS] 🚨 {숙소명} {date} 청소 배정 실패. 수동 처리 필요."
```

---

## 13. 링크 단축

| 링크 종류 | 단축 경로 | 실제 대상 |
|-----------|----------|----------|
| 숙소별 구글 예약 캘린더 | `proposonline.com/c/{property_id}` | 해당 숙소의 구글 예약 캘린더 URL |
| 거절 링크 | `proposonline.com/d/[6자토큰]` | `/api/d/[token]` |

`/c/{property_id}` → `api/c/[propertyId].js`에서 숙소의 `google_calendar_booking_url`을 읽어 302 redirect. URL 변경 시 redirect 대상만 수정.

---

## 14. 토큰 보안

- **형식**: 대문자+숫자 6자 (`[A-Z0-9]{6}`) — 36^6 ≈ 21억 조합
- **만료**: 해당 job이 ASSIGNED 또는 CANCELLED 상태가 되면 무효
- **1회성**: response_at이 채워진 토큰은 재처리 불가
- **Rate limiting**: 동일 IP에서 `/api/d/*` 10회/분 초과 시 차단

---

## 15. 외부 의존성 설정 체크리스트

### android-sms-gateway (단계 5 전에)

- [ ] Play Store에서 "SMS Gateway for Android" 설치 (개발사: capcom6)
- [ ] 앱 내 클라우드 모드 활성화 → ID/Password 발급
- [ ] Vercel 환경변수 추가: `PROPOS_SMS_GW_ID`, `PROPOS_SMS_GW_PWD`

### Google API (단계 9~10 전에)

- [ ] Google Cloud Console 프로젝트 생성 (또는 기존 사용)
- [ ] Calendar API + Gmail API 활성화
- [ ] OAuth2 자격증명 생성 (서비스 계정 권장)
- [ ] 숙소별 구글 예약 캘린더 생성 → `google_calendar_id` + `google_calendar_booking_url` 숙소 설정에 입력
- [ ] Gmail Pub/Sub 토픽 설정
- [ ] Calendar Webhook 등록 (`calendar.events.watch`, 숙소별 1회씩)
- [ ] Vercel 환경변수: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`

### Vercel Cron 추가

```json
// vercel.json crons 섹션에 추가
{ "path": "/api/cron/monthly-cleaning",  "schedule": "0 0 15 * *" },
{ "path": "/api/cron/cleaning-followup", "schedule": "*/30 * * * *" }
```

---

## 16. 엣지케이스

| 상황 | 처리 방법 |
|------|----------|
| VIP 창 넘긴 후 VIP가 뒤늦게 구글 예약 | 조건부 UPDATE (`WHERE status != 'ASSIGNED'`)로 방어. 구글 슬롯이 이미 다른 사람에게 예약됐으면 애초에 예약 불가. |
| 여러 숙소가 같은 날 체크아웃 | 각 cleaning_job 독립 처리. BULK 발송 목록 구성 시 해당 날짜에 이미 ASSIGNED된 cleaner_id 제외. VIP도 같은 날 다른 job으로 NOTIFYING 중인 청소자는 건너뜀. |
| 청소자가 뒤늦게 취소 (배정 후) | 수정/삭제 로직 범위 — 별도 문서. 당장은 호스트가 수동 처리. |
| Monthly batch 이후 2주 이내 신규 예약 | SHORT_NOTICE로 처리. cleaning_jobs UNIQUE 제약으로 중복 INSERT 방지 (`ON CONFLICT DO NOTHING`). |
| iCal 폴링 실패 | Gmail webhook 트리거 후 iCal 파싱 실패 → 3회 재시도 → Slack 알림 |
| SMS 발송 실패 (gateway 오프라인) | 3회 재시도 (2초 간격) → 모두 실패 시 Slack 알림. 클라우드 모드는 폰 재기동 후 자동 복구. |
| 구글 예약 시 이메일 미등록 | cleaners 매핑 실패 → assigned_cleaner_id = NULL, status = ASSIGNED. 호스트 Slack 알림으로 수동 확인. |

---

## 17. 구현 순서

| 단계 | 작업 | 선행 조건 |
|------|------|----------|
| 1 | DB 테이블 생성 (cleaners, cleaning_jobs, cleaning_notifs) | Postgres 연결 (완료) |
| 2 | 청소자 관리 API + UI | DB 완료 |
| 3 | iCal → cleaning_jobs 변환 로직 | iCal 파서 (완료) |
| 4 | 거절 링크 엔드포인트 (`/api/d/[token]`) | DB 완료 |
| 5 | android-sms-gateway 연동 (`/api/sms/send`) | Play Store 설치 + 클라우드 모드 설정 |
| 6 | VIP 순차 발송 로직 | 4, 5 완료 |
| 7 | BULK 동시 발송 로직 | 6 완료 |
| 8 | 후속 처리 크론 (리마인드 + 에스컬레이션) | 6, 7 완료 |
| 9 | Google Calendar Webhook 배정 감지 (`/api/calendar/webhook`) | Google API 설정 |
| 10 | Gmail API Watch 즉시 트리거 (`/api/gmail/webhook`) | Google API 설정 |
| 11 | Monthly batch 크론 (매월 15일) | 1~8 완료 |
| 12 | `/c/{property_id}` redirect 설정 (`api/c/[propertyId].js`) | 구글 예약 URL 확정 |

---

## 18. 미결 사항 (구현 시작 전 확정 필요)

**단계 1~8 시작 전 (지금 당장)**
- [ ] VIP 청소자 1~3인 이름 / 전화번호(`010-XXXX-XXXX`) / 이메일 준비 (PROPOS UI 완성 후 직접 입력)
- [ ] Play Store에서 "SMS Gateway for Android" 설치 + 클라우드 모드 활성화
- [ ] Vercel 환경변수 추가: `PROPOS_SMS_GW_ID`, `PROPOS_SMS_GW_PWD`

**단계 9~10 전 (나중에)**
- [ ] Google Cloud Console: Calendar API + Gmail API 활성화
- [ ] 숙소별 구글 예약 캘린더 생성 + 이메일 필드 필수 설정
- [ ] OAuth2 자격증명 + Refresh Token 발급
- [ ] Calendar Webhook 등록 (숙소별)
- [ ] Gmail Pub/Sub 토픽 설정
- [ ] Vercel 환경변수 추가: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`

---

## 19. 설계 버그 리뷰 결과 (2026-08-10)

> 구현 전 발견된 설계상 이슈. 구현 시 반드시 해결하고 시작.

---

### [이슈 #1 — ✅ RESOLVED] 구글 캘린더 cleaner 매핑

**확정**: 전화번호 필드(유료) 대신 **이메일(무료 기본 필드)로 매핑**. `cleaners.email` 추가. Calendar Webhook → attendee email → `cleaners WHERE email` 조회. 숙소별 별도 캘린더로 property_id 특정 → 시각 충돌 없음.

---

### [이슈 #2 — ✅ RESOLVED] 전화번호 형식

**확정**: DB 저장 형식은 `010-0000-0000` (하이픈 포함). 청소자 관리 UI에서 입력 시 이 형식으로 저장.

청소자 관리 UI 입력 시 형식 통일. Calendar Webhook의 attendee 이메일은 그대로 사용 (정규화 불필요).
전화번호는 SMS 발송용으로만 사용:
```js
const normalizePhone = (raw) => {
  const digits = raw.replace(/\D/g, '').replace(/^82/, '0'); // +82 → 0
  return digits.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
};
// 입력값 정규화 후 DB 저장. 발송 시 그대로 사용.
```

---

### [이슈 #3 — HIGH] VIP도 같은 날 여러 숙소에 중복 발송됨

**문제**: 여러 숙소가 같은 날 체크아웃하면 각 job이 독립적으로 VIP_1에게 SMS를 보냄. VIP_1은 같은 날 두 건의 청소 요청을 받게 되어 혼란 발생.

**해결**: VIP 발송 로직에 중복 체크 추가.
```sql
-- VIP_1 발송 전: 해당 날짜에 이미 VIP_1에게 발송 중인 다른 job이 있으면 스킵
SELECT COUNT(*) FROM cleaning_jobs j
JOIN cleaning_notifs n ON n.job_id = j.id
WHERE n.cleaner_id = :vip1_id
  AND j.checkout_at::date = :checkout_date
  AND j.status NOT IN ('ASSIGNED','COMPLETED','ESCALATED')
  AND j.id != :current_job_id
```
결과 > 0이면 해당 VIP를 건너뛰고 다음 VIP로 진행.

---

### [이슈 #4 — MEDIUM] 크론 타이밍 슬립 최대 30분

**문제**: 후속 처리 크론이 30분 주기. VIP 창이 1시간이므로 최악의 경우 1시간 30분 후에야 다음 단계로 진행될 수 있음 (크론이 T+29에 돌고, 다음 실행이 T+59에서 아직 1h 미경과, T+89에서 드디어 체크 통과).

**영향**: 긴급 청소(당일 오전에 체크아웃, 당일 오후 체크인)에서 문제가 될 수 있음. 3단계 VIP + BULK 전체 흐름이 최대 6시간 → 최악 6h 90min.

**해결 (선택)**: 크론 주기를 15분으로 단축하거나, VIP 타임아웃 크론 대신 Vercel `setTimeout` 지연 호출로 대체. 현재는 30분 주기로 진행하되 운영 모니터링 필요.

---

### [이슈 #5 — MEDIUM] 토큰 충돌 시 재시도 미명시

**문제**: `cleaning_notifs.token UNIQUE` 제약으로 충돌 시 INSERT 실패. 재시도 로직이 명시되지 않음.

**해결**: 토큰 생성 시 최대 5회 재시도. 실패 시 로그 후 Slack 알림.
```js
for (let i = 0; i < 5; i++) {
  const token = randomToken(); // [A-Z0-9]{6}
  try { await db.insert({ token, ... }); break; }
  catch (e) { if (e.code !== '23505') throw e; } // 23505 = unique_violation
}
```
충돌 확률 ≈ 1/36^6 per attempt ≈ 무시 가능. 5회 안에 확실히 성공.

---

### [이슈 #6 — LOW] ASSIGNED 이후 거절 링크 클릭 시 응답 미기록

**문제**: job이 ASSIGNED 상태일 때 아직 거절하지 않은 청소자가 "이미 배정 완료된 건입니다"를 보고 링크를 닫으면, 해당 `cleaning_notifs.response`는 NULL로 남음. 추후 감사 추적(audit trail)에서 누가 응답 안 했는지 불명확.

**해결 (선택)**: ASSIGNED 상태라도 거절 링크 클릭 시 `response = 'DECLINED_AFTER_ASSIGNED'`로 기록. 구현 복잡도 낮음.

---

### [이슈 #7 — LOW] Monthly batch 동시 다중 job 분산 발송 정책 불명확

**문제**: "같은 날 N건이면 N분 간격"이라고 명시됐으나 N분의 기준이 없음. 5분? 10분? SMS 게이트웨이 처리 용량 고려 필요.

**결정**: SMS 게이트웨이가 개인 폰 기반이므로 과도한 동시 발송 피해야 함. **같은 날 여러 job은 건당 10분 간격으로 발송** (최대 5건이면 40분에 걸쳐 발송). 단, 긴급 처리(SHORT_NOTICE)는 즉시.

---

### [이슈 #8 — CONFIRMED OK] 30분 크론 vs 1회성 리마인드 중복 방지

**확인**: `cleaning_notifs.reminded_at`이 채워진 경우 리마인드 재발송 안 함 → 크론이 여러 번 돌아도 중복 없음. 설계 정확.

---

### [이슈 #9 — CONFIRMED OK] UNIQUE(property_id, checkout_at) 재삽입

**확인**: monthly batch 실행 후 SHORT_NOTICE 경로로 같은 (property_id, checkout_at) 재삽입 시 UNIQUE 위반 → INSERT 무시 (`ON CONFLICT DO NOTHING`). 중복 없음. 단, 코드에서 `INSERT ... ON CONFLICT DO NOTHING` 명시 필요.

---

### [이슈 #10 — CONFIRMED OK] BULK 전원 거절 즉시 에스컬레이션

**확인**: 거절 링크 클릭 핸들러에서 해당 job의 모든 cleaning_notifs.response = 'DECLINED' 여부 체크 → 즉시 ESCALATED 처리. 30분 크론 대기 없이 빠르게 에스컬레이션 가능. 설계 정확.

---

## 20. 구현 후 버그 리뷰 (2026-08-10)

> 구현 완료 후 코드 검토에서 발견·수정된 이슈.

---

### [구현 버그 #1 — ✅ FIXED] createNotif ON CONFLICT 무한 루프

**문제**: `ON CONFLICT (job_id, cleaner_id) DO NOTHING`이 0행 반환 → 5회 재시도 후 오류. 동시 호출(cron + decline handler)에서 발생.

**수정**: `SELECT` 먼저 조회해서 기존 레코드 반환 (멱등성). 없을 때만 `INSERT`. token 충돌(23505)만 재시도.

---

### [구현 버그 #2 — ✅ FIXED] SMS 재시도 대기 60s → Vercel 타임아웃

**문제**: `api/sms/send.js` 재시도 대기 60s. Vercel Hobby 60s 제한 초과.

**수정**: 2s로 단축.

---

### [구현 버그 #3 — ✅ FIXED] Calendar Webhook channelId 파싱 regex 오작동

**문제**: `channelId.replace(/-\d+$/, "")` 방식이 calendarId 내 숫자로 끝나는 경우 오파싱.

**수정**: `x-goog-resource-uri` 헤더의 URL 경로(`/calendars/{calendarId}/events`)에서 `decodeURIComponent`로 파싱.

---

### [구현 버그 #4 — ✅ FIXED] handleMonthlyClean의 setTimeout → Vercel 타임아웃

**문제**: 같은 날 N건 × 10분 간격 `setTimeout` → 잡이 7건이면 60분 대기 → Vercel 타임아웃.

**수정**: `dispatch_after` 컬럼에 발송 시각만 기록 후 종료. followup 크론이 실제 발동 담당.

---

### [구현 버그 #5 — ✅ FIXED] updateCleaner email 정규화 누락

**문제**: PATCH 시 email 소문자 정규화가 빠져 있어 대소문자 불일치로 Calendar Webhook 이메일 매핑 실패 가능.

**수정**: `b.email.toLowerCase().trim()` 추가.

---

### [구현 버그 #6 — ✅ FIXED] api/d/[token].js try/catch 없음

**문제**: DB 오류 시 `Content-Type: text/html` 설정 후 Vercel 기본 JSON 500 반환 → 브라우저 이상 화면.

**수정**: 전체 try/catch 추가 → HTML 에러 페이지 반환.

---

### [구현 버그 #7 — ✅ FIXED] Calendar Webhook 이벤트 조회 창 5분

**문제**: Google Webhook 재시도 지연 시 이미 5분이 지나 이벤트 조회 실패.

**수정**: 30분으로 확장. 조건부 UPDATE로 중복 배정 방지.

---

### [구현 버그 #8 — ✅ FIXED] handleCleaningFollowup 미사용 변수 `now`

**수정**: 제거.

---

### [미구현 — ⚠️ TODO] Calendar/Gmail Webhook 인증

**상태**: 현재 `/api/calendar/webhook`와 `/api/gmail/webhook`에 인증이 없음.

**보안 위험**: 외부에서 임의 요청 가능.

**권장 조치**:
- Calendar Webhook: 등록 시 `token` 파라미터 설정 → 수신 헤더 `X-Goog-Channel-Token` 검증
- Gmail Pub/Sub: Google OIDC Bearer 토큰 검증 (`https://oauth2.googleapis.com/tokeninfo`)
- 단기 완화: Vercel 환경변수 `GOOGLE_WEBHOOK_SECRET` 설정 후 헤더 비교

**선행 조건**: Google API 설정 완료 후 처리 (단계 9~10).
