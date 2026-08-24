# 청소 자동화 시스템 설계

> 작성: 2026-08-09 | 최종 확정: **2026-08-20** | 상태: **아키텍처 확정, 구현 진행 중**
> 수정/삭제 로직은 이 문서 범위 제외 — 별도 문서로 추후 수립

---

## 확정된 결정

| 항목 | 결정 | 비고 |
|------|------|------|
| 청소자 관리 UI | PROPOS 내 자체 UI + Postgres | |
| 직원 알림 수단 | **FCM + SMS 듀얼 모드** (`_notify.js` NotificationService) | 앱 설치 시 FCM 우선, 미설치/실패 시 SMS 폴백 |
| 슬롯 제어 방식 | **구글 예약 캘린더 + 블로커 이벤트** | 아래 섹션 9 참고 |
| 선착순 보장 | 구글 예약 캘린더 슬롯 1개 (Google이 처리) + DB 조건부 UPDATE 이중 방어 | |
| 호스트 캘린더 뷰 | Google Calendar UI (숙소별 캘린더) | 별도 PROPOS UI 불필요 |
| 청소자 일정 등록 | 예약 시 청소자 구글 캘린더에 자동 등록 | Google이 처리 |
| 배정 감지 | Google Calendar Webhook → 이메일로 cleaner 매핑 | |
| 구글 예약 캘린더 양식 | 이메일 필드 (무료 기본 필드) | 전화번호 필드는 유료 |
| Google OAuth | 서비스 계정 (캘린더 편집 권한) | Gmail Watch + Calendar Webhook + 블로커 이벤트 모두 필요 |
| VIP 창 만료 후 뒤늦은 수락 | 블로커 삭제 후 오픈된 슬롯을 다른 사람이 이미 예약했으면 자동 차단 | |
| 블로커 생성 타이밍 | **매월 15일** 배치에서 다음 달 전체 블로커 일괄 생성 | iCal 폴링과 동일 크론에서 처리 |

---

## 1. 개요

에어비앤비 체크아웃 일정을 자동 감지하고, 청소자에게 FCM 또는 SMS로 순차/동시 알림을 보내 청소를 배정하는 완전 자동화 시스템.

**핵심 원리**: 구글 예약 캘린더를 슬롯 관리의 단일 진실 원천으로 사용. PROPOS는 체크아웃 일정에 맞춰 캘린더 슬롯을 "오픈"하고, 나머지는 구글이 처리(선착순, 청소자 캘린더 등록, 호스트 뷰).

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
| 직원 알림 (FCM) | Firebase Admin SDK | Worker App 설치자. `api/cleaning/_push.js` |
| 직원 알림 (SMS) | android-sms-gateway (Play Store) + 로컬 모드 | 앱 미설치자 또는 FCM 실패 폴백. `api/cleaning/_sms.js` |
| 알림 채널 결정 | **NotificationService** | `api/cleaning/_notify.js` — 채널 선택/발송/기록 단일 진입점 |
| 슬롯 제어 | Google Calendar API (events.insert/delete) | 블로커 이벤트 생성/삭제로 예약 가능 날짜 제어 |
| 배정 감지 | Google Calendar Webhook | 청소자 예약 완료 → 이메일로 cleaner 매핑 |
| 거절 링크 | `proposonline.com/d/[TOKEN]` | 6자 토큰, 1회성. FCM(앱 내 버튼) + SMS(URL 클릭) 양쪽 동작 |
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
T+0h    VIP_1에게 알림 발송 (FCM or SMS — NotificationService 결정)
T+1h    VIP_1 무응답 or 거절 → VIP_2에게 알림
T+2h    VIP_2 무응답 or 거절 → VIP_3에게 알림
T+3h    VIP_3 무응답 or 거절 → BULK 전원 동시 알림
T+4h    BULK 발송 후 1시간 내 무응답자 → 리마인드 알림 1회
T+6h    BULK 발송 후 3시간까지 배정 없음 → 호스트 Slack 알림
```

### 핵심 정책

- **슬롯 오픈 타이밍**: PROPOS가 `dispatch_after` 도달 시 블로커 이벤트를 삭제해 슬롯을 오픈하고, 동시에 알림 발송.
- **VIP 창 만료**: 다음 단계 알림 발송 전에 이전 VIP가 슬롯을 예약해도 유효. 단, 다음 단계로 넘어갔을 때 이미 다른 사람이 예약 완료했다면 구글 캘린더 자체에서 예약 불가.
- **BULK 중복 수락 방지**: 구글 예약 캘린더 슬롯 1개 → 선착순 1명만 예약 가능. Calendar Webhook에서도 조건부 UPDATE로 이중 방어.
- **수락 확정 시**: ASSIGNED 처리 즉시 나머지 notif 전원에게 "배정 완료됐습니다" 알림 자동 발송.

---

## 4. 상태 머신

### cleaning_jobs 상태

```
PENDING
  │ dispatch_after 도달 → 블로커 삭제 + 알림 발송 시작
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
BULK_REMINDED        ← 리마인드 알림 1회 발송 완료
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

### property_cleaning_config

```sql
CREATE TABLE IF NOT EXISTS property_cleaning_config (
  property_id                TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  checkout_hour              INT  NOT NULL DEFAULT 11,
  cleaning_duration_hours    FLOAT NOT NULL DEFAULT 2.5,
  google_calendar_id         TEXT,            -- Webhook calendarId 매핑용 (예: bnb.paju@gmail.com)
  google_calendar_booking_url TEXT,           -- 구글 예약 캘린더 공개 URL
  host_phone                 TEXT,            -- 호스트 연락처 (협의용 딥링크)
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### cleaners

```sql
CREATE TABLE cleaners (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT,
  phone            TEXT NOT NULL UNIQUE,
  email            TEXT UNIQUE,                -- 구글 예약 캘린더 매핑 키
  tier             TEXT NOT NULL CHECK (tier IN ('VIP_1','VIP_2','VIP_3','BULK')),
  active           BOOLEAN NOT NULL DEFAULT true,
  fcm_token        TEXT,
  fcm_token_at     TIMESTAMPTZ,
  fcm_status       TEXT DEFAULT 'uninstalled'
                     CHECK (fcm_status IN ('uninstalled','active','inactive','invalid','unregistered')),
  app_installed_at TIMESTAMPTZ,
  last_seen_at     TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`fcm_status` 의미:

| 값 | 의미 | 알림 채널 |
|----|------|---------|
| `uninstalled` | 앱 미설치 | SMS |
| `active` | 앱 설치 + 정상 | FCM (실패 시 SMS 폴백) |
| `inactive` | 30일 이상 미접속 | SMS (앱 재활성화 유도 문구 포함) |
| `invalid` | 잘못된 토큰 | SMS |
| `unregistered` | 앱 삭제됨 | SMS |

### cleaning_jobs

```sql
CREATE TABLE cleaning_jobs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id             TEXT NOT NULL,
  reservation_uid         TEXT,
  checkout_at             TIMESTAMPTZ NOT NULL,
  cleaning_start_at       TIMESTAMPTZ NOT NULL,
  cleaning_end_at         TIMESTAMPTZ,
  dispatch_after          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                  TEXT NOT NULL DEFAULT 'PENDING',
  assigned_cleaner_id     UUID REFERENCES cleaners(id),
  google_blocker_event_id TEXT,               -- 블로커 이벤트 ID (삭제 시 필요)
  source                  TEXT NOT NULL CHECK (source IN ('MONTHLY_BATCH','SHORT_NOTICE')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, checkout_at)
);
```

### cleaning_notifs

```sql
CREATE TABLE cleaning_notifs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES cleaning_jobs(id) ON DELETE CASCADE,
  cleaner_id  UUID NOT NULL REFERENCES cleaners(id),
  tier        TEXT NOT NULL,
  token       CHAR(6) NOT NULL UNIQUE,
  channel     TEXT NOT NULL DEFAULT 'SMS'
                CHECK (channel IN ('FCM','SMS','SMS_FALLBACK')),  -- 실제 발송된 채널
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reminded_at TIMESTAMPTZ,
  response    TEXT CHECK (response IS NULL OR response IN ('DECLINED','DECLINED_AFTER_ASSIGNED')),
  response_at TIMESTAMPTZ,
  UNIQUE (job_id, cleaner_id)
);
```

`channel` 컬럼: 호스트가 PROPOS UI에서 "이 직원은 앱으로 받았나, 문자로 받았나" 확인 가능.

---

## 6. API 엔드포인트

### 자동화 흐름 (내부)

| 메서드 | 경로 | 역할 |
|--------|------|------|
| **GET** | `/api/cron/monthly-cleaning` | 매월 15일 KST 09:00 — 다음 달 블로커 생성 + iCal 폴링 + dispatch_after 스케줄링 |
| **GET** | `/api/cron/cleaning-followup` | 30분마다 — PENDING 발동 + 리마인드 + 에스컬레이션 |
| POST | `/api/gmail/webhook` | Gmail Pub/Sub 수신 |
| POST | `/api/calendar/webhook` | 구글 예약 완료 수신 → 배정 처리 |

### 공개 링크

| 메서드 | 경로 | 역할 |
|--------|------|------|
| GET | `/api/d/[token]` | 거절 처리 (토큰 1회성) — HTML(SMS 클릭용) + `?format=api`(Worker App용) 양쪽 지원 |
| GET | `/api/c/[propertyId]` | 숙소별 구글 예약 캘린더로 302 redirect |

### 관리자 UI용

| 메서드 | 경로 | 역할 |
|--------|------|------|
| GET/POST | `/api/cleaning/cleaners` | 청소자 목록/등록 |
| PATCH/DELETE | `/api/cleaning/cleaners/[id]` | 청소자 수정/비활성화 |
| GET/POST | `/api/cleaning/properties` | 숙소 청소 설정 목록/등록·수정 |
| GET | `/api/cleaning/jobs` | 청소 일정 목록 (?status=&limit=) |
| GET | `/api/cleaning/jobs/[id]` | 청소 일정 상세 (notifs + channel 포함) |
| POST | `/api/cleaning/dispatch/[jobId]` | 수동 발송 시작 (PENDING job 전용) |

---

## 7. NotificationService 설계 (`_notify.js`)

모든 알림 발송은 `_dispatch.js`에서 채널을 직접 결정하지 않고 `_notify.js`의 `notify()` 하나만 호출한다. 채널 결정·폴백·기록은 내부에서만 처리.

### 채널 선택 로직

```
cleaner.fcm_status = 'active' + fcm_token 있음
  → FCM 발송 시도
  → 성공 → channel = 'FCM'
  → UNREGISTERED/INVALID 에러 → SMS 폴백, channel = 'SMS_FALLBACK', fcm_status 갱신

cleaner.fcm_status = 'uninstalled'
  → SMS 직접 발송, channel = 'SMS'

cleaner.fcm_status = 'inactive'
  → SMS 발송 (앱 재활성화 안내 문구 포함), channel = 'SMS'

cleaner.fcm_status = 'invalid' | 'unregistered'
  → SMS 발송, channel = 'SMS'

fcm_token 자체가 NULL
  → SMS 발송, channel = 'SMS'
```

### FCM → SMS 자동 전환 (리마인드 시)

FCM 발송 성공 후 N분 무응답인 경우, `cleaning-followup` 크론의 리마인드 로직에서 **SMS 추가 발송** 가능 (channel = 'SMS_FALLBACK'). 이는 FCM 알림을 읽지 않은 경우에 대한 안전망.

### SMS → FCM 자동 전환

Worker App 설치 시 `POST /api/workers/register` → `fcm_status = 'active'` 갱신. 다음 알림부터 자동으로 FCM 채널 선택. 별도 전환 작업 없음.

### 인터페이스

```javascript
// api/cleaning/_notify.js (유일한 공개 함수)
export async function notify(db, cleaner, {
  title,       // FCM 제목
  body,        // FCM 본문
  smsText,     // SMS 문자 내용 (앱 설치 유도 링크 포함)
               // ⚠️ 필수: smsText 없으면 FCM 실패 시 SMS 폴백 불가 → 'NONE' 반환
  data         // FCM data payload { jobId, token, calendarUrl, hostPhone }
}) → { ok, channel }  // 'FCM' | 'SMS' | 'SMS_FALLBACK' | 'NONE'
```

> `_dispatch.js`에서 `notify()` 호출 시 반드시 `smsText`를 함께 전달할 것.
> FCM 전용 의도라도 폴백 보장을 위해 생략 금지.

### 파일 구조

```
api/cleaning/
  _notify.js    ← NotificationService (채널 결정 + 발송 + cleaning_notifs.channel 기록)
  _push.js      ← FCM 발송 유틸 (Firebase Admin SDK)
  _sms.js       ← SMS 발송 유틸 (android-sms-gateway)
  _dispatch.js  ← notify() 호출만. 채널 로직 없음.
```

### ⚠️ `_notify.js` 구현 시 반드시 함께 수정해야 하는 DB 쿼리

현재 `_dispatch.js`의 `getAvailableVip`와 `dispatchBulk` SQL에는 아래 조건이 있다:

```sql
AND fcm_token IS NOT NULL AND fcm_status='active'
```

이 조건은 **SMS 전용 청소자(앱 미설치, `fcm_token = NULL`)를 선발 대상에서 완전히 제외**한다.  
`_notify.js` 설계 의도(앱 없어도 SMS로 알림 가능)와 충돌한다.

**`_notify.js` 구현 시 함께 수정**:
```sql
-- 변경 전 (FCM-only)
WHERE tier=$1 AND active=true AND fcm_token IS NOT NULL AND fcm_status='active'

-- 변경 후 (FCM + SMS 듀얼 모드)
-- phone 또는 fcm_token 중 하나라도 있으면 선발, 채널 결정은 _notify.js가 담당
WHERE tier=$1 AND active=true AND (fcm_token IS NOT NULL OR phone IS NOT NULL)
```

`dispatchBulk`의 BULK 조회 쿼리(`FROM cleaners c WHERE c.active = true AND c.tier = 'BULK' ...`)도 동일하게 수정 필요.

---

## 8. 알림 메시지 템플릿

### VIP 발송

**FCM**
```
title: [PROPOS] 청소 요청
body:  {숙소명} {checkout_date} {start_time}
data:  { jobId, token, calendarUrl, hostPhone }
```

**SMS**
```
[PROPOS] 청소 요청 드립니다
📍 {숙소명}
🕐 {checkout_date} {start_time}
수락(예약): {calendarUrl}
거절: proposonline.com/d/{TOKEN}
앱 설치: {worker_app_download_url}
```

### BULK 발송

**FCM**
```
title: [PROPOS] 청소 아르바이트 안내
body:  {숙소명} {checkout_date} {start_time} 선착순
data:  { jobId, token, calendarUrl, hostPhone }
```

**SMS**
```
[PROPOS] 청소 아르바이트 안내
📍 {숙소명}
🕐 {checkout_date} {start_time}
선착순 예약: {calendarUrl}
불가 시: proposonline.com/d/{TOKEN}
```

### 리마인드

**FCM**
```
title: [PROPOS] 재안내
body:  {숙소명} {checkout_date} 청소 아직 미확정입니다. 선착순 예약 가능
data:  { jobId, token, calendarUrl, hostPhone }
```

**SMS**
```
[PROPOS] 재안내 드립니다
{숙소명} {checkout_date} 청소 아직 미확정입니다
예약: {calendarUrl}
거절: proposonline.com/d/{TOKEN}
```

### 배정 완료 (나머지 청소자용)

**FCM**
```
title: [PROPOS] 청소 배정 완료
body:  {숙소명} {date} 건이 배정됐습니다. 감사합니다.
```

**SMS**
```
[PROPOS] {숙소명} {date} 청소가 배정 완료됐습니다. 감사합니다.
```

---

## 9. 거절 처리 흐름

거절 경로는 채널에 따라 2가지:
- **Worker App 사용자**: 앱 내 거절 버튼 → `GET /api/cleaning/d?token=TOKEN&format=api` → JSON 응답
- **SMS 사용자**: 문자 내 URL 클릭 → `GET /api/cleaning/d?token=TOKEN` → HTML 페이지

양쪽 모두 동일한 핵심 로직 처리:

```
token 유효성 검사
├── 토큰 없음 → 404
├── 이미 응답됨 → "이미 처리된 링크입니다"
└── job이 ASSIGNED/COMPLETED → "이미 배정 완료된 건입니다"
    ↓
cleaning_notifs.response = 'DECLINED', response_at = NOW()
    ↓
cleaning_jobs 상태 확인
├── NOTIFYING_VIP_1 → 즉시 VIP_2 알림 (1시간 대기 스킵)
├── NOTIFYING_VIP_2 → 즉시 VIP_3 알림
├── NOTIFYING_VIP_3 → 즉시 BULK 알림
└── NOTIFYING_BULK / BULK_REMINDED
    ├── 아직 미거절자 있음 → 계속 대기
    └── 전원 거절 → 즉시 ESCALATED 처리
```

---

## 10. 구글 예약 캘린더 슬롯 제어 (블로커 메커니즘)

### 핵심 원리

구글 예약 캘린더(Appointment Schedule)는 **호스트 캘린더에 `transparency: opaque` 이벤트가 있으면 해당 시간을 자동으로 "예약 불가"로 표시**한다.

> 공식 근거 (Google Calendar 지원 문서):
> *"Appointment times during events on your calendar that are set to Busy don't show on the booking page."*
> *"Appointment Schedules will automatically block out any times that conflict with existing events."*

`events.insert` + `transparency: 'opaque'` = 해당 슬롯 차단. 표준 Calendar API 동작이며 비공식 우회가 아님.

---

### 숙소당 초기 설정 (수동, 1회)

1. 숙소 담당 구글 캘린더에서 **예약 일정(Appointment Schedule)** 생성
2. 가용 시간: 매일 `checkout_hour:00` ~ `(checkout_hour + cleaning_duration_hours):00`
   - 파주201 예시: 매일 11:00~14:00
3. 예약 단위: `cleaning_duration_hours`시간 → 하루 슬롯 1개
4. 예약 양식 필드: **이름 + 이메일** (이메일로 cleaner DB 매핑)
5. 생성된 예약 URL + 캘린더 ID를 `property_cleaning_config`에 등록

> 슬롯 단위를 청소 시간과 동일하게 설정하면 **하루에 슬롯이 정확히 1개** → 선착순 1명만 예약 가능.

---

### 월간 배치 (매월 15일) — 블로커 + 예약 일괄 처리

```
매월 15일 Vercel Cron 발동
    ↓
[1] 다음 달 전체 날짜에 블로커 이벤트 일괄 생성 (숙소당 ~31회 API 호출)
    → 모든 슬롯이 기본 "예약 불가" 상태
    ↓
[2] 다음 달 Airbnb 예약 iCal 폴링 → checkout_at 목록 추출
    ↓
[3] 각 checkout_at에 대해:
    - cleaning_jobs INSERT (PENDING)
    - 해당 날짜 블로커 이벤트 삭제 (슬롯 오픈)
    - google_blocker_event_id = NULL로 갱신
    ↓
[4] dispatch_after 설정 (같은 날 여러 건 → 10분 간격 순차)
    ↓
슬랙 요약 알림 발송 후 종료
```

---

### 즉시 처리 (2주 이내 신규 예약)

```
Gmail Pub/Sub 수신 → iCal 재폴링
    ↓
신규 checkout_at 감지
    ↓
cleaning_jobs INSERT (SHORT_NOTICE, PENDING)
    ↓
Calendar API: 해당 날짜 블로커 삭제 (슬롯 즉시 오픈)
    ↓
dispatch_after = NOW() → cleaning-followup 크론에서 즉시 알림 발송
```

---

### 블로커 이벤트 스펙

```javascript
await calendar.events.insert({
  calendarId: 'bnb.paju@gmail.com',
  requestBody: {
    summary: '[PROPOS-BLOCK]',
    start: { dateTime: `${date}T${checkoutHour}:00:00+09:00` },
    end:   { dateTime: `${date}T${checkoutHour + duration}:00:00+09:00` },
    transparency: 'opaque',       // 핵심: 예약 불가로 표시
    visibility: 'private',
    extendedProperties: {
      private: { propos: 'blocker', property_id: propertyId }
    }
  }
});
// 반환된 event.id → cleaning_jobs.google_blocker_event_id에 저장
```

---

### 예약 취소 시

```
Airbnb 예약 취소 감지
  → cleaning_jobs status = 'CANCELLED'
  → Calendar API: 블로커 이벤트 재생성 (슬롯 다시 잠금)
  → cleaning_jobs.google_blocker_event_id 갱신
```

---

### Calendar Webhook 배정 흐름

> **주의**: Google Calendar Webhook은 변경 알림만 전달하고 이벤트 데이터는 포함하지 않음.
> attendee 이메일은 별도로 `calendar.events.list` API를 호출해 조회해야 함.

```
청소자가 구글 예약 캘린더에서 이름 + 이메일 입력 후 예약
    ↓
Google Calendar → Webhook → POST /api/calendar/webhook
    ↓
헤더 파싱: X-Goog-Resource-State, X-Goog-Resource-Uri
└── resourceState = 'sync' → 무시 (초기 등록 ping)
└── resourceState = 'exists' → 처리
    ↓
X-Goog-Resource-Uri에서 calendarId 추출 (URL decode 필요)
    ↓
Calendar API: events.list(calendarId, timeMin=청소일시) → 예약 이벤트 조회
    ↓
이벤트에서 attendees[0].email 추출 (청소자가 입력한 이메일)
    ↓
property WHERE google_calendar_id = calendarId → property_id 확정
    ↓
cleaning_jobs WHERE property_id = :id AND status NOT IN ('ASSIGNED','COMPLETED')
→ 진행 중인 job 1건 조회
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
  → 나머지 notif 전원에게 "배정 완료됐습니다" notify()
  → 호스트 Slack: "{숙소명} {date} 청소 배정 완료 ({청소자명})"
rows 없음 → 이미 다른 청소자가 선점 (슬롯 1개라 실질적으로 미발생)
```

---

### 멀티 숙소 / 멀티 호스트

- 숙소마다 구글 예약 캘린더 **1개씩** 생성 (수동 초기 설정)
- 블로커 이벤트는 각 캘린더에 별도 관리
- 호스트는 자신의 구글 캘린더 UI에서 담당 숙소 캘린더만 구독 → 필터 뷰 자연스럽게 지원
- 청소자도 예약 시 자신의 구글 캘린더에 자동 등록 → 별도 앱 없이 일정 확인

---

## 11. Gmail API 감지 흐름

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
├── YES → SHORT_NOTICE 즉시 플로우 (블로커 삭제 + dispatch_after = NOW())
└── NO  → cleaning_jobs INSERT (PENDING, 월간 배치에 포함)
```

---

## 12. 월간 배치 흐름 요약 (매월 15일)

> 상세 플로우는 섹션 10 참고.

```
Vercel Cron 발동 (UTC 00:00 = KST 09:00)
    ↓
[1] 다음 달 블로커 일괄 생성 → [2] iCal 폴링 → [3] 예약 날짜 블로커 삭제
    ↓
dispatch_after 스케줄링 (같은 날 여러 건 → 10분 간격)
    ↓
슬랙 알림 발송 후 종료

    ↓ (dispatch_after 도달 시, cleaning-followup 크론)

dispatch_after <= NOW() AND status='PENDING' → notify() 발송 시작
```

> **설계 결정**: Vercel 60s 타임아웃으로 `setTimeout` 불가. `dispatch_after` 컬럼으로 발송 시각을 기록하고 followup 크론이 실제 발송 담당.

---

## 13. Google OAuth 설정 (OAuth2 Refresh Token 방식)

> ⚠️ 설계 초안은 서비스 계정(`GOOGLE_SERVICE_ACCOUNT_JSON`)이었으나 **실제 구현은 OAuth2 refresh token 방식**으로 변경됨.

Calendar API 블로커 이벤트 생성/삭제, Calendar Webhook 등록, Gmail Watch 모두 OAuth 인증 필요.

1. Google Cloud Console → OAuth 2.0 클라이언트 ID 생성 (Desktop 또는 Web 유형)
2. Google Calendar API + Gmail API + Pub/Sub API 활성화
3. OAuth 동의 화면 설정 (scope: `calendar`, `gmail.readonly`)
4. Access Token 최초 발급 후 **Refresh Token** 보관 → 이후 자동 갱신
5. Google Calendar → 공유 설정 → OAuth 계정 이메일에 **편집 권한** 부여
6. 각 값을 Vercel 환경변수로 등록 (`propos-project-v2` 프로젝트)

| 환경변수 | 용도 | 필수 |
|--------|------|------|
| `GOOGLE_CLIENT_ID` | OAuth2 클라이언트 ID | ✅ |
| `GOOGLE_CLIENT_SECRET` | OAuth2 클라이언트 시크릿 | ✅ |
| `GOOGLE_REFRESH_TOKEN` | 장기 갱신 토큰 | ✅ |
| `GOOGLE_PUBSUB_TOPIC` | Gmail Watch Pub/Sub 토픽 (`projects/{proj}/topics/{topic}`) | ✅ |
| `GOOGLE_WEBHOOK_SECRET` | Calendar/Gmail webhook 요청 인증 (미설정 시 검증 생략) | 권장 |

---

## 14. 미구현 항목 (다음 단계)

| 항목 | 우선순위 | 비고 |
|------|---------|------|
| Google OAuth 자격증명 Vercel 설정 | HIGH | `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `GOOGLE_REFRESH_TOKEN` `GOOGLE_PUBSUB_TOPIC` `GOOGLE_WEBHOOK_SECRET` |
| Gmail Watch 실제 등록 | MEDIUM | `POST /api/gmail/watch` 엔드포인트 구현 완료. 실제 Gmail API 호출 1회 필요 (7일마다 갱신 필요) |
| CRON_SECRET Vercel 환경변수 설정 | LOW | 외부 크론 호출 차단 |
| cleaning-followup 크론 주기 | LOW | 현재 `0 2 * * *` (하루 1회). Vercel Pro 업그레이드 시 `*/30 * * * *` 변경 권장 |

### 완료된 항목 (2026-08-23)

| 항목 | 완료일 | 비고 |
|------|--------|------|
| `_notify.js` NotificationService 구현 | 2026-08-23 | FCM primary + SMS fallback. SQL 쿼리 동시 수정 완료 |
| `_sms.js` 복원 (android-sms-gateway) | 2026-08-23 | 3-retry, Basic auth |
| `_calendar.js` 블로커 이벤트 생성/삭제 | 2026-08-23 | `createBlockerEvent`, `deleteBlockerEvent`, `getNextMonthDates`, `parseCheckoutsFromIcal` |
| `property_calendar_blockers` 테이블 | 2026-08-23 | `data/schema-cleaning.sql` + `migrate-cleaning-v2.sql` |
| `cleaning_notifs.channel` 컬럼 | 2026-08-23 | `migrate-cleaning-v2.sql` |
| 월간 배치 블로커 일괄 생성 + iCal 폴링 | 2026-08-23 | `handleMonthlyClean` 재구성. `property_cleaning_config.ical_url` 컬럼 추가 |
| `syncJobs` 블로커 자동 삭제 | 2026-08-23 | 예약 확정 시 해당 날짜 블로커 삭제 + 슬롯 오픈 |
| Calendar Webhook 등록 및 수신 | 2026-08-23 | `handleCalendarWebhook` 구현 완료 |
| 거절 API JSON 응답 (`?format=api`) | 2026-08-23 | `handleDecline` — JSON / HTML 이중 응답 |
| 청소자 헬스체크 크론 (30일 미접속 → inactive) | 2026-08-23 | `handleWorkerHealthCheck` 구현 완료 |
| Worker App FCM 등록 + fcm_status 관리 | 2026-08-23 | `worker-app/` 구현 완료 |
| Calendar Webhook `updatedMin` 버그 수정 | 2026-08-23 | `timeMin` → `updatedMin` 변경. `[PROPOS-BLOCK]` 이벤트 건너뜀 추가 |
| Gmail Webhook iCal 재폴링 구현 | 2026-08-23 | 예약 이메일 감지 시 전체 숙소 iCal 폴링 → SHORT_NOTICE 즉시 발동 |
| `CANCELLED` 상태 추가 | 2026-08-23 | schema + migration CHECK 제약 수정 |
| 예약 취소 엔드포인트 | 2026-08-23 | `PATCH /api/cleaning/jobs?id=:id` `{status:"CANCELLED"}` + 블로커 재생성 |
| 부트스트랩 블로커 엔드포인트 | 2026-08-23 | `POST /api/cleaning/bootstrap` — 당월/지정월 블로커 일괄 생성 |
| Gmail Watch 등록 엔드포인트 | 2026-08-23 | `POST /api/gmail/watch` → `handleRegisterGmailWatch` |
| `parseAllFutureCheckouts` 추가 | 2026-08-23 | `_calendar.js` — 월 필터 없이 오늘 이후 전체 체크아웃 추출 |
| `sendCompletionSmsToRest` → `notify()` 교체 | 2026-08-23 | `_dispatch.js` — SMS 미설치 청소자에게도 완료 알림 전달. `sendJobPush` 제거 |
| `handleFcmFailure` → `_notify.js` 이동 | 2026-08-23 | FCM UNREGISTERED/INVALID 시 `fcm_status` DB 업데이트 + Slack 단일 진입점으로 통합 |
| Calendar Webhook job 조회 PENDING 추가 | 2026-08-23 | 블로커 삭제 후 followup 크론 전 PENDING 상태에서 직접 예약하는 경우 처리 |
| BULK 리마인드 FCM data payload 수정 | 2026-08-23 | `api/cron/[...slug].js` — `data: {}` → `{ jobId, token, calendarUrl, hostPhone }` (Worker App 수락/거절 처리 가능하도록) |
| Worker App cold-start 알림 처리 | 2026-08-23 | `NavigationContainerRef` + `onReady` 콜백으로 앱 완전 종료 후 알림 탭 시 JobScreen 이동 |
| Worker App `HomeScreen.tsx` import 버그 수정 | 2026-08-23 | `sendHeartbeat`를 `fcm.ts` 대신 `api.ts`에서 import (fcm.ts에 미존재) |
| Worker App `declineJob` 반환 타입 개선 | 2026-08-23 | `boolean` → `{ ok, message }`, `format=api` 쿼리 추가. `JobScreen.tsx`에서 실패 메시지 표시 |
| 라우터 slug UUID 폴백 (UI 경로 파라미터 호환) | 2026-08-23 | `slug[1]`이 UUID 형식이면 `?id=` 없어도 id로 인식. PATCH/DELETE cleaners 등 UI 호환성 확보 |
| 통합 테스트 — API 라우터 E2E 시뮬레이션 | 2026-08-23 | `tests/integration/s32.cleaning-api-routing.test.js` 43개 테스트 (parseSlug/resolveId/dispatch 분기) |
| Webhook 보안 검증 테스트 | 2026-08-23 | s29에 Gmail/Calendar webhook secret 검증 로직 + Google OAuth env var 목록 테스트 추가 |
| 설계 문서 오류 수정 (섹션 13) | 2026-08-23 | `GOOGLE_SERVICE_ACCOUNT_JSON` → OAuth2 refresh token 방식으로 정정. 실제 구현과 일치시킴 |
| `upsertProperty` ical_url 지원 추가 | 2026-08-23 | 서버 폴링(Gmail Webhook + 월간 배치)에 필요. COALESCE로 미전송 시 기존 값 유지 |
| `PropertyPanel` UI — host_phone + ical_url 필드 추가 | 2026-08-23 | 숙소 설정 폼에서 직접 입력 가능. ical_url은 이미 설정된 경우 "(유지됨)" 표시 |
| `migrate-cleaning-v2.sql` — google_event_id 컬럼 누락 수정 | 2026-08-23 | 기존 DB에서 Calendar Webhook ASSIGNED UPDATE 쿼리 실패 버그 수정 |
| `JobsPanel` — 취소 버튼 추가 | 2026-08-23 | PENDING~ESCALATED 상태 잡에 취소 버튼 UI 추가. `PATCH /api/cleaning/jobs?id=` 호출 |
| followup 크론 타이밍 테스트 | 2026-08-23 | s30에 1시간 리마인드, 3시간 에스컬레이션 타이밍 로직 검증 9개 테스트 추가 |
