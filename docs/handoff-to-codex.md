# PROPOS — Codex 인수인계 문서

> 최초 작성: 2026-08-23 / 최종 업데이트: 2026-08-25
> 작성자: Claude Sonnet 4.6

---

## 1. 프로젝트 전체 구조

**PROPOS** = Airbnb 숙소 자동 관리 시스템 (운영자 1인)

```
propos-project-v2/          ← Vercel 배포 웹 + API
  api/
    cleaning/
      [...slug].js           ← 청소 CRUD + 웹훅 통합 API
      _dispatch.js           ← 알림 발송 공통 로직 (FCM + SMS 폴백)
      _notify.js             ← FCM 단일 진입점 (handleFcmFailure 포함)
      _push.js               ← Firebase Admin SDK FCM 유틸
      _calendar.js           ← Google Calendar OAuth2 블로커 이벤트 관리
    workers/
      [...slug].js           ← 직원 앱 전용 API (register/heartbeat/token)
    cron/
      [...slug].js           ← 크론 핸들러 모음 (daily-plan/result/monthly/worker-health)
      tick.js                ← 단일 크론 진입점 (매시간 KST 분기)
    ha/[...slug].js          ← Home Assistant 프록시
  src/
    components/v2/
      CleaningManager.jsx    ← 청소 관리 UI (60초 자동 폴링)
  data/
    schema-cleaning.sql      ← DB 스키마 정본
    migrate-cleaning-v2.sql  ← 기존 DB 마이그레이션 스크립트
  docs/
    cleaning-automation-design.md  ← 설계 정본 문서
    handoff-to-codex.md     ← 이 파일

worker-app/                  ← React Native Android 앱 (propos-project-v2 내부)
  android/
  src/
    screens/
      PhoneAuthScreen.tsx    ← 전화번호 OTP 인증
      HomeScreen.tsx         ← 대기 화면 + FCM 리스너
      JobScreen.tsx          ← 수락/거절/협의 화면
    services/
      api.ts                 ← Vercel API 호출
      fcm.ts                 ← FCM 토큰 관리
```

---

## 2. 완료된 것 (재작업 금지)

### 2-1. API 레이어

| 파일 | 완료 내용 |
|------|-----------|
| `api/cleaning/[...slug].js` | UUID slug 폴백 (경로 파라미터 ↔ 쿼리 파라미터 호환) |
| `api/cleaning/[...slug].js` | `upsertProperty` — `ical_url` COALESCE 지원 |
| `api/cleaning/[...slug].js` | `runFollowupChecks()` — VIP 1h/BULK 3h 타임아웃 체크, `listJobs` 에 편승 |
| `api/cleaning/[...slug].js` | `cancelJob` — CANCELLABLE 상태 처리 |
| `api/workers/[...slug].js` | register/heartbeat/token 3개 엔드포인트 |
| `api/cron/tick.js` | 단일 크론 (매시간) → KST 시각 보고 daily-plan/result/monthly/worker-health 분기 |

### 2-2. DB

- `cleaners`: `fcm_token`, `fcm_status`, `app_installed_at`, `last_seen_at` 컬럼
- `cleaning_jobs`: `google_event_id`, `google_blocker_event_id` 컬럼, `CANCELLED` 상태
- `cleaning_notifs`: `channel` 컬럼 (FCM/SMS/SMS_FALLBACK)
- `property_cleaning_config`: `host_phone`, `ical_url` 컬럼
- `property_calendar_blockers` 테이블
- 마이그레이션 스크립트: `data/migrate-cleaning-v2.sql`

### 2-3. 프론트엔드 (CleaningManager.jsx)

- `ical_url` 입력 필드 + "설정됨" 뱃지
- `host_phone` 입력 필드
- 잡 목록 60초 자동 폴링 (`setInterval(load, 60_000)`)
- CANCELLABLE 상태 잡 취소 버튼

### 2-4. 크론 구조 단순화

**전**: `vercel.json`에 크론 4개 (Hobby 한도 초과)
**후**: `api/cron/tick.js` 1개 (매시간 정각) → 내부에서 KST 분기

```
KST 08:00 → daily-plan       (Slack 브리핑)
KST 09:00 → worker-health-check
KST 22:00 → daily-result     (Slack 결산)
KST 00:00 + 15일 → monthly-cleaning (iCal 재폴링)
```

`cleaning-followup` 크론 제거됨 → `listJobs` 60초 폴링으로 대체.

### 2-5. 테스트 (1118 tests / 0 fail)

| 파일 | 커버 영역 |
|------|-----------|
| `tests/unit/s33.worker-api.test.js` | Worker API 로직 53개 |
| `tests/unit/s34.cron-tick.test.js` | 크론 tick KST 분기 18개 |
| `tests/unit/s11.cleaning-dispatch.test.js` | UUID slug 폴백 8개 추가 |
| `tests/unit/s30.job-cancellation.test.js` | followup 타이밍 + ical_url 처리 |
| `tests/integration/s32.cleaning-api-routing.test.js` | 라우팅 E2E 43개 |

### 2-6. Worker App (React Native)

- Firebase v21.14.0 (v26 사용 금지 — default export 없음)
- Phone OTP → FCM → register API 연동 완료
- HomeScreen / JobScreen 완성
- APK 빌드 + 갤럭시 설치 완료

---

## 3. 남은 작업 (Codex가 이어받을 내용)

### 우선순위 HIGH

#### A. Gmail Watch 등록 ← 지금 여기

모든 환경변수 설정 완료 (2026-08-24). 배포 완료 후 아래 명령 1회 실행 필요:

```bash
curl -X POST https://www.proposonline.com/api/gmail/watch
# 성공 응답: { "ok": true, "historyId": "...", "expiration": "..." }
```

**환경변수 현황** (Vercel `propos-project-v2` + `.env.local` 모두 등록 완료):

```
CRON_SECRET                    ✅ 2026-08-06
GOOGLE_CLIENT_ID               ✅ 2026-08-24  (adcfirm@gmail.com Cloud Console)
GOOGLE_CLIENT_SECRET           ✅ 2026-08-24
GOOGLE_REFRESH_TOKEN           ✅ 2026-08-24  (nam5821@gmail.com — Gmail 감지용)
GOOGLE_CALENDAR_REFRESH_TOKEN  ✅ 2026-08-24  (bnb.paju@gmail.com — Calendar용)
GOOGLE_PUBSUB_TOPIC            ✅ 2026-08-24  (propos-gmail-notifications)
```

> **경로 참고**: `vercel.json` 리라이트에 의해 `/api/gmail/watch` → `/api/cleaning/gmail-watch`로 포워딩됨. 두 경로 모두 동작.

> **Gmail Watch 만료**: 7일마다 재등록 필요. 위 curl 명령 재실행.

**Google 계정 역할 구분** (혼동 금지):
- `adcfirm@gmail.com` — 개발자 계정. Cloud Console 앱 등록용. 실제 데이터 없음.
- `nam5821@gmail.com` — Airbnb 예약 알림 수신 Gmail. `GOOGLE_REFRESH_TOKEN` 발급 계정.
- `bnb.paju@gmail.com` — Google Calendar 청소 일정 관리. `GOOGLE_CALENDAR_REFRESH_TOKEN` 발급 계정.

#### B. 거절 API JSON 응답 지원

현재 `GET /api/cleaning/d?token=TOKEN`은 HTML 반환.
Worker App은 JSON이 필요 (`?format=api` 파라미터 추가).

**위치**: `api/cleaning/[...slug].js` `handleDecline` 함수

```javascript
// 추가
if (req.query.format === 'api') {
  return sendJson(res, 200, { ok: true, message: '거절 처리 완료' });
}
// 기존 HTML 응답은 그대로 유지 (SMS 링크 클릭용)
```

`worker-app/src/services/api.ts`의 `declineJob()`:
```typescript
// 현재 (이미 &format=api 포함되어 있는지 확인 필요)
const res = await fetch(`${BASE_URL}/api/cleaning/d?token=${token}&format=api`);
const data = await res.json();
return { ok: data.ok, message: data.message };
```

### 우선순위 MEDIUM

#### C. 배정 완료 알림 FCM 전환

`api/cleaning/_dispatch.js`의 `sendCompletionSmsToRest()`가 아직 SMS 방식.

```javascript
// 쿼리에 fcm_token 추가
SELECT n.*, c.phone, c.fcm_token FROM cleaning_notifs n
JOIN cleaners c ON c.id = n.cleaner_id
WHERE n.job_id = $1 AND n.cleaner_id != $2 AND n.response IS NULL

// sendSms() → sendJobPush() 교체
await sendJobPush(db, { id: n.cleaner_id, fcm_token: n.fcm_token }, {
  title: '[PROPOS] 청소 배정 완료',
  body: `${propertyName} 청소 확정됐습니다. 감사합니다.`,
  data: {},
})
```

#### D. 직원 관리 UI

앱 설치 시 `active=false`로 등록 → 호스트가 PROPOS 웹에서 승인해야 함.
현재 DB 직접 수정으로 대체 중. `CleaningManager.jsx`에 직원 목록/승인 탭 필요.

#### E. Worker App Play Store 내부 테스트 배포

```bash
cd worker-app
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd android && ./gradlew bundleRelease
# 산출물: android/app/build/outputs/bundle/release/app-release.aab
```

Play Console → 내부 테스트 트랙 → AAB 업로드 → 청소 직원 이메일 초대

#### F. 숙소별 Google Calendar 초기 설정

숙소마다:
1. Google Calendar에서 캘린더 생성 → Calendar ID 복사
2. Appointment Schedule 생성 → 예약 URL 복사
3. PROPOS 대시보드 → 숙소 설정 패널 → 두 값 입력

---

## 4. 핵심 데이터 흐름

```
체크아웃 감지 (iCal 폴링 or Google Calendar Webhook)
  → POST /api/cleaning/jobs/sync → cleaning_jobs INSERT (PENDING)
  → POST /api/cleaning/dispatch/:id → advanceJob()
      → VIP 1번 FCM 푸시
      → [무응답 1h] runFollowupChecks() (listJobs 폴링 편승) → VIP 2번
      → [무응답 1h] → VIP 3번
      → [무응답 1h] → BULK 전체 발송
      → [무응답 3h] → ESCALATED + Slack 🚨
      → [수락] Calendar 예약 → Webhook → ASSIGNED
      → [거절] GET /api/cleaning/d?token=TOKEN&format=api → 다음 순위 자동 발송
```

---

## 5. 로컬 개발

```bash
# Vercel (웹 + API)
cd ~/Downloads/propos-project-v2
npm run dev          # http://localhost:5173
npm test             # 1118 tests

# Worker App
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd worker-app
npx react-native start --reset-cache &
npx react-native run-android --no-packager
```

---

## 6. 변경 금지 항목

| 항목 | 이유 |
|------|------|
| Firebase v26 사용 | default export 없음 — v21.14.0 유지 |
| `innerHTML` 사용 | XSS 취약 → `textContent` 사용 |
| `alert()` 사용 | 웹: Toast, 앱: Alert.alert() |
| HA 토큰 브라우저 번들 | `/api/ha/*` 프록시 경유만 |
| `PROPOS_SLACK_WEBHOOK` 소스 커밋 | Vercel 환경변수만 |
| iCal URL 소스 커밋 | localStorage만 |
| `@vercel/*` src/ import | api/ 폴더에서만 |
| `cleaning-followup` 크론 재추가 | listJobs 편승으로 대체됨 |
| vercel.json 크론 4개로 복원 | tick.js 단일 크론으로 대체됨 |

---

## 7. 참고 문서

- **시스템 아키텍처 시각화**: https://claude.ai/code/artifact/025d28ec-9b72-416e-9cc5-313de1100140
  - 전체 구조 / Google 계정 체계 / OAuth2 흐름 / 환경변수 현황 / 크론 스케줄 / 유지보수 항목

---

## 8. Vercel 배포 정보

- **프로젝트**: `propos-project-v2`
- **URL**: `https://www.proposonline.com`
- **GitHub**: 자동 배포 연결됨 (main 브랜치 push → 자동 빌드)
- **DB**: Neon Postgres (`neon-violet-park`)
- **KV**: Upstash KV (`upstash-kv-coral-ridge`)
- **주의**: `propos` (propos-henna.vercel.app)는 중복 프로젝트 — 무시
