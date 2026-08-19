# PROPOS Worker App — 기획 명세

> 호스트가 현장 직원(청소·수리·기타)과 소통하는 채널
> 작성일: 2026-08-18 | 상태: 기획 초안

---

## 1. 배경 및 목적

현재 PROPOS의 청소 자동화는 SMS 링크 방식으로 구현되어 있다.
- 직원이 링크를 클릭해 수락/거절 처리
- 간단한 조정(시작 시간 변경 등)이 필요할 때 소통 수단 없음
- SMS 게이트웨이(sms-gate.app) 의존 — 별도 기기 필요

**Worker App**은 이를 대체한다.
- 직원 폰에 설치 한 번으로 이후 모든 소통 처리
- 푸시 알림으로 즉시 수신, 앱 안에서 수락/거절
- 조정이 필요하면 기본 문자앱으로 직접 연결
- SMS 폴백은 의도적으로 제거 (앱 미설치 직원은 대시보드에서 별도 파악)

---

## 2. 사용자

| 구분 | 설명 |
|------|------|
| **호스트** | PROPOS 웹 대시보드 사용 (기존) |
| **현장 직원** | Worker App 설치. 청소·수리·기타 작업 담당자 |

직원 유형은 청소에 국한하지 않는다 — 수리, 설비, 기타 작업자 모두 동일 앱 사용.

---

## 3. 핵심 기능

### 3-1. 알림 수신
- 작업 요청 시 푸시 알림 (잠금화면 포함)
- 알림 내용: 숙소명 / 날짜·시간 / 작업 유형

### 3-2. 수락 / 거절
- 앱에서 버튼 탭 → PROPOS API 즉시 호출
- 거절 시 자동으로 다음 순위 직원에게 알림 (기존 상태 머신 유지)
- **수락 흐름**: 앱 내 WebView로 Google Calendar 예약 URL 직접 오픈
  - 직원이 시간 선택 → 예약 완료
  - Google Calendar Webhook → PROPOS 감지 → status: ASSIGNED
- **거절 흐름**: `GET /api/cleaning/d?token=TOKEN` 호출
  - 현재 엔드포인트는 HTML 페이지 반환 (브라우저 링크 기반 설계)
  - Worker App 구현 시 JSON 응답용 엔드포인트 추가 필요 (예: `?format=api` 파라미터 또는 `POST /api/workers/decline`)

### 3-3. 협의 필요
- "협의 필요" 버튼 탭
- 기본 문자앱이 호스트 번호로 자동 열림 (`sms:` 딥링크)
- 별도 채팅 인프라 없음 — 일반 SMS로 직접 소통

### 3-4. 로그인 / 최초 등록
- 전화번호 입력 → OTP 자동 수신 → 인증 완료 (앱에서 폰번호 자동 읽기 불가 — 직접 입력)
- 이메일 입력 (필수) — Google Calendar 예약 시 입력하는 이메일과 **반드시 동일**해야 함
  - 이유: Calendar Webhook → attendee email → `cleaners.email` 매핑으로 배정 감지
- 전화번호 = Firebase Auth ID / 이메일 = 배정 매핑 키

---

## 4. 기술 스택

| 항목 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | React Native (Android 우선) | 기존 PROPOS React 스택과 동일 |
| 푸시 알림 | Firebase Cloud Messaging (FCM) | 무료, Google 표준 |
| 인증 | Firebase Auth (Phone) | OTP 자동 수신 (무료 한도 규모에 따라 확인 필요) |
| 채팅 | 없음 (기본 SMS 앱 딥링크) | 인프라 불필요, 친숙한 UX |
| API | 기존 PROPOS Vercel API 재사용 + `/api/workers/*` 신규 추가 | 아래 섹션 참고 |

---

## 5. 아키텍처

```
작업 발생 (체크아웃 감지 등)
        ↓
PROPOS 서버 (Vercel)
        ↓  sendPush()  [현재 sendSms() 대체]
Firebase FCM
        ↓
직원 폰 잠금화면 알림  { jobId, token, calendarUrl, hostPhone }
        ↓
Worker App 오픈
    ├── [수락] → 앱 내 WebView로 calendarUrl 직접 오픈
    │              (calendarUrl = property_cleaning_config.google_calendar_booking_url)
    │              → 직원이 예약 완료
    │              → Google Calendar Webhook → PROPOS → ASSIGNED
    ├── [거절] → GET /api/cleaning/d?token=TOKEN
    │              (Worker App 구현 시 JSON 응답 지원 확인 또는 신규 엔드포인트 추가)
    └── [협의 필요] → sms:01XXXXXXXXX (hostPhone)
```

호스트(PROPOS 웹)에서도 직원 번호 탭 → 문자앱 오픈 (`tel:` 링크).

---

## 6. 신규 API 엔드포인트 (`api/workers/[...slug].js`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/workers/register` | 앱 설치 시 FCM 토큰 + 전화번호 등록 |
| POST | `/api/workers/heartbeat` | 앱 실행마다 `last_seen_at` 갱신 |
| POST | `/api/workers/token` | FCM 토큰 갱신 시 업데이트 |

```javascript
// POST /api/workers/register 요청 바디
{ phone: '010-1234-5678', email: 'worker@gmail.com', fcm_token: 'eXXX...' }
// email은 필수 — Google Calendar 예약 시 입력하는 이메일과 동일해야 배정 감지 가능
// → cleaners 테이블: phone 기준 upsert
//   신규 → name=null(호스트가 나중에 입력), tier='BULK', active=false, fcm_status='active'
//   기존 → email, fcm_token, fcm_token_at, app_installed_at, fcm_status='active' 갱신

// POST /api/workers/heartbeat 요청 바디
{ fcm_token: 'eXXX...' }
// → last_seen_at = NOW(), fcm_status = 'active' (inactive였어도 복구)
```

> **직원 등록 흐름**:
> - 직원이 앱에서 등록하면 `active=false` + `tier` 미정 상태로 저장
> - 호스트가 PROPOS 대시보드에서 이름·tier·active 승인 후 배정 대상에 포함됨
> - 현재 `POST /api/cleaning/cleaners`는 name·email·tier 필수이므로
>   자가 등록용 `/api/workers/register`는 별도 로직으로 구현

---

## 7. 서버 변경 사항

기존 상태 머신(PENDING → VIP_1 → ... → BULK)은 그대로 유지.
아래 두 함수를 `sendSms()` → `sendPush()` 로 교체:

| 교체 대상 | 위치 | 비고 |
|-----------|------|------|
| `advanceJob()` 내 VIP/BULK 발송 | `api/cleaning/_dispatch.js` | 요청 알림 발송 |
| `sendCompletionSmsToRest()` | `api/cleaning/_dispatch.js` | 배정 완료 시 나머지 직원 통보 |

```javascript
// 현재
await sendSms(phone, message)

// 변경 후 (요청 발송)
await sendPush(fcmToken, {
  title: '[PROPOS] 청소 요청',
  body: `${propertyName} ${date}`,
  data: {
    jobId,
    token,           // 거절 처리용 토큰 (cleaning_notifs.token)
    calendarUrl,     // google_calendar_booking_url (직접 URL, 단축 redirect 아님)
    hostPhone,       // 협의 필요 시 문자앱에 입력될 번호
  }
})

// 변경 후 (배정 완료 통보)
await sendPush(fcmToken, {
  title: '[PROPOS] 청소 배정 완료',
  body: `${propertyName} ${date} 건이 배정됐습니다. 감사합니다.`,
  data: {}
})
```

---

## 8. 직원 등록 플로우

```
Worker App 최초 실행
    ↓
전화번호 입력 + OTP 인증 (Firebase Auth)
    ↓
이메일 입력 (Google Calendar 예약 시 쓰는 이메일 — 배정 매핑 키)
    ↓
FCM 토큰 자동 발급
    ↓
POST /api/workers/register  { phone, email, fcm_token }
→ cleaners 테이블: phone 기준 upsert
  신규 → name=null, active=false, tier='BULK', fcm_status='active' 로 삽입
  기존 → email·fcm_token·fcm_token_at·fcm_status='active' 갱신
    ↓
호스트가 PROPOS 대시보드에서 확인
  → name 입력, tier 지정, active=true 승인
  → 배정 대상에 포함됨
```

---

## 9. 앱 상태 추적 (Lifecycle Management)

### 9-1. DB 스키마 추가 (`cleaners` 테이블)

```sql
ALTER TABLE cleaners ADD COLUMN fcm_token        TEXT;
ALTER TABLE cleaners ADD COLUMN fcm_token_at     TIMESTAMPTZ;  -- 토큰 등록/갱신 시각
ALTER TABLE cleaners ADD COLUMN app_installed_at TIMESTAMPTZ;  -- 최초 설치 시각
ALTER TABLE cleaners ADD COLUMN last_seen_at     TIMESTAMPTZ;  -- 마지막 앱 실행 시각
ALTER TABLE cleaners ADD COLUMN fcm_status       TEXT DEFAULT 'uninstalled';
-- fcm_status 허용값: 'uninstalled' | 'active' | 'inactive' | 'invalid' | 'unregistered'
```

### 9-2. 상태 전환 규칙

| 이벤트 | fcm_status 변화 |
|--------|----------------|
| 앱 최초 설치 + 토큰 등록 | `uninstalled` → `active` |
| 앱 실행 시 heartbeat | `last_seen_at` 갱신, `inactive`이면 `active`로 복구 |
| FCM 토큰 갱신 | `fcm_token` + `fcm_token_at` 업데이트 |
| 푸시 발송 실패 (`UNREGISTERED`) | `active` → `unregistered` + Slack 알림 |
| 토큰 형식 오류 (`INVALID_ARGUMENT`) | → `invalid` + Slack 알림 |
| 30일 미접속 (크론) | `active` → `inactive` |
| 앱 재설치 후 토큰 재등록 | → `active` 복구 |

### 9-3. 푸시 발송 시 FCM 응답 처리

FCM HTTP v1 API 기준 에러 코드:

```javascript
// sendPush() 내부
const fcmResponse = await sendFcmMessage(token, payload)

if (fcmResponse.errorCode === 'UNREGISTERED') {
  // 앱 삭제 또는 토큰 만료
  await db.query(`UPDATE cleaners SET fcm_status='unregistered' WHERE id=$1`, [cleanerId])
  await postSlack(`[PROPOS] ⚠️ ${cleanerName} 앱 삭제 감지 — 푸시 전달 실패`)
}
if (fcmResponse.errorCode === 'INVALID_ARGUMENT') {
  // 잘못된 토큰
  await db.query(`UPDATE cleaners SET fcm_status='invalid' WHERE id=$1`, [cleanerId])
  await postSlack(`[PROPOS] ⚠️ ${cleanerName} FCM 토큰 오류 — 재설치 필요`)
}
```

### 9-4. 정기 헬스체크 크론

매일 1회 (`api/cron/[...slug].js`에 추가):

```sql
-- 30일 미접속 active 직원 → inactive 전환
UPDATE cleaners
SET fcm_status = 'inactive'
WHERE fcm_status = 'active'
  AND last_seen_at < NOW() - INTERVAL '30 days';
```

- `last_seen_at` 7일 초과 `active` 직원 → Slack 경고

### 9-5. 호스트 대시보드 직원 상태 표시

| 상태 | 표시 | 의미 |
|------|------|------|
| 🟢 활성 | `active` + 7일 이내 접속 | 정상 |
| 🟡 장기 미접속 | `active` + 7일 이상 | 확인 필요 |
| 🟠 비활성 | `inactive` (30일 이상) | 앱 열지 않음 |
| 🔴 앱 삭제 | `unregistered` | 재설치 요청 필요 |
| ⚫ 미설치 | `uninstalled` | 아직 앱 미설치 |

---

## 10. 미결 사항

- [ ] iOS 지원 여부 (Android 우선, 이후 검토)
- [ ] Play Store 배포 vs 직접 APK 배포
- [ ] 거절 API — 앱용 JSON 응답: 현재 `GET /api/cleaning/d`는 HTML 반환. `?format=api` 파라미터 추가 또는 `POST /api/workers/decline` 신규 엔드포인트 선택 필요
- [ ] 직원 자가 등록 시 보안 — 현재 phone만 있으면 등록 가능. 호스트 사전 초대 링크 방식 고려
- [ ] FCM 미전달 시 재발송 정책 (FCM은 전달 보장 안 함 — 최대 4주 보관 후 폐기)
- [ ] Firebase Auth Phone 무료 한도 확인 (직원 수 규모에 따라 Blaze 플랜 필요 가능)

---

## 11. 구현 순서 (제안)

1. DB 마이그레이션 — `cleaners` 테이블에 FCM 컬럼 추가 (섹션 9-1 SQL 참고)
2. `api/workers/[...slug].js` 신규 엔드포인트 구현 (register / heartbeat / token)
3. Firebase 프로젝트 생성 + FCM + Phone Auth 설정
4. React Native 프로젝트 초기화
5. FCM 토큰 발급 + `/api/workers/register` 연동
6. 수락(Calendar WebView) / 거절 / 협의 필요 버튼 구현
7. Heartbeat 구현 (`/api/workers/heartbeat`)
8. `sendSms()` → `sendPush()` 교체 — `advanceJob()` + `sendCompletionSmsToRest()` 동시 교체 (`api/cleaning/_dispatch.js`)
9. 크론 헬스체크 추가 (`api/cron/[...slug].js`)
10. 테스트 — 실제 푸시 수신, 수락/거절 상태 전환, 앱 삭제 감지
