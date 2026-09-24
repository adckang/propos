# PROPOS — Codex 인수인계 문서

> 최초 작성: 2026-08-23 / **최종 업데이트: 2026-09-19** (코드와 대조해 검수·개정)
> 작성: Claude (Sonnet 4.6 → Sonnet 5 세션). 원격 `main` @ `a917351` 까지 push 완료.
> **먼저 읽을 것 (순서대로)**: `CLAUDE.md` → `.claude/rules/decisions.md` (D-004 ~ D-017) → 이 문서

---

## 0. 현재 상태 한눈에 (2026-09-19)

### 0-1. 방금 끝난 작업 (main 에 push 됨, Vercel 자동 배포 트리거됨)

| 커밋 | 내용 |
|------|------|
| `26a735f` | 레포트 정확도 개선 · 기간 확장(D-017) · 숙소 식별자를 이름으로 통일(D-016) |
| `3a40d8c` | 테스트가 실제 `data/` 를 덮어쓰지 않도록 격리 (s50) |
| `a917351` | 비밀키·운영 데이터를 `.gitignore` 에 추가 |

핵심 변경 (자세한 규칙은 `docs/report-architecture.md` §11~15, `decisions.md` D-015~D-017):
- **가짜 데모 수치 제거** — `useReportingStats` 는 서버 값이 0이어도 그대로 표시, 실패 시 `stats=null` ("데이터를 불러올 수 없어요"). dev 견본 데이터는 `vite.config.mjs` 스텁에만 있다.
- **선택 숙소 범위** — ListView 체크박스 → `selectionScopeDomain.js` → `propertyIds`(null=전체, []=없음, [...]=부분) 가 API 와 모든 패널(과거/오늘/이번주/미래, 상세, 대시보드)에 전달된다.
- **현재(now/today) 상태는 이벤트 기록에서 계산** (`roomStateFromEventsDomain.js`, `eventRepository.getLastKnownStatesFromDB`). 예전 KV 5분 캐시 방식은 숙소가 통째로 빠지고 이상 건수를 못 담아서 폐기(R5). `eventService.js` 의 KV 갱신 코드는 정리 후보로 남아 있다.
- **기간이 타임라인 위치를 따른다** — `periodDomain.js`: 이름 있는 기간(last_week/next_week/tomorrow …) + `weeks_ahead_N`/`weeks_ago_N`/`days_ahead_N`/`days_ago_N`. 경계는 KST 자정. API(`/api/stats`, `/api/cleaning/stats`, `/api/stats/drilldown`)가 새 이름을 받는다.
- **이번 주/오늘 [예정]** = 지금 ~ 기간 끝 (`periodToRemainingRange`). 청소 취소(CANCELLED)는 "배정 요청 필요"로 센다(사용자 결정).
- **숙소 식별자 = ListView 에 표시되는 숙소 이름** (D-016). 이름 변경 시 서버가 청소·이벤트 이력을 한 트랜잭션으로 이전(`propertyRenameRepository.js`, `POST /api/cleaning/properties` 의 `previous_property_id`). 이름 규칙: 쉼표 불가·중복 불가·60자 이하.
- **체류중 에너지낭비도 "이상"** (`OCCUPIED_ISSUE_SUB_STATUSES`, 스펙 §6-1).

### 0-2. 운영에서 사람이 확인해야 하는 것 (Codex 는 먼저 사용자에게 상태를 물을 것)

1. Vercel `propos-project-v2` 새 배포가 성공했는지.
2. **D-016 자동 이전** — 새 버전으로 앱을 처음 열 때 설정 id 가 이름과 다르면(레거시 `prop_…`) 서버 API 로 이력이 자동 이전된다. **실제 운영 DB 에는 아직 한 번도 실행되지 않았다**(로컬에서는 PGlite 로 검증, s47). 이전 전 미리보기: `previous_property_id` + `dry_run:true` 또는 `scripts/migrate-property-id-to-name.sql`. 성공 시 화면에 "숙소 이름 변경 — 이력을 새 이름으로 이전했어요", 실패 시 "숙소 이름 이전 실패: …" Toast(기존 설정 유지).
3. 이전 후: 파주201 상세에 오늘 체크인 예약이 보이는지, 청소 이력이 그대로인지.

### 0-3. 아직 커밋되지 않은 변경 (작업 폴더에만 있음 — 내용을 검토한 뒤 커밋할 것)

| 항목 | 메모 |
|------|------|
| `api/cron/[...slug].js` | BULK 티어 조건 수정 + **Calendar Watch 7일 만료 → 월요일 자동 갱신** 추가 |
| `api/ha/[...slug].js`, `server/haProxy.js`, `server/haApiHandlers.js` | HA `all-states` 엔드포인트 추가 |
| `src/components/LandingPageV1.jsx` | 랜딩 페이지 변경 |
| `docs/data-storage-design.md`, `docs/cleaning-automation-design.md` | 문서 수정 |
| 미추적 | `docs/analytics-strategy.md`, `docs/cleaning-scenario-matrix.md`, `scripts/get-refresh-token.mjs`(비밀은 env 에서 읽음), `tests/e2e/s37.*`, `tests/integration/s36.*`, `docs/PROPOS_*.docx` 4개, `.agents/`, `.claude/skills/`, `.vscode/` |
| 레포트 상세 목록 (2026-09-21) | `src/domain/violationDetailDomain.js`(신규 — 한 줄 문장·색 근거·정렬 규칙), `src/domain/metricDrilldownDomain.js`(앞뒤 이벤트 짝짓기), `src/components/v2/reporting/ViolationRow.jsx`(신규 — 한 줄), `DrilldownSheet.jsx`, `FutureMatrixPanel.jsx`, `src/application/reportingService.js`, `api/cleaning/[...slug].js`(요청/거절 인원·취소 시각), `vite.config.mjs`(dev 스텁), `tests/unit/s54.*` |
| 월간 캘린더 "지금" 표시 · 숙소 이름 표시 | `src/domain/nowMarkerDomain.js`, `src/hooks/useNow.js`, `reporting/NowMarker.jsx`, `MonthlyCalendar.jsx`(다른 세션 파일), `src/domain/propertyNameDomain.js`, `tests/unit/s52.*`, `s53.*` |
| 커밋 금지/정리 | `mytest.txt`, `.DS_Store`(추적 중), `src/components/IntroScene copy.jsx` (`.gitignore` 의 따옴표 항목이 동작하지 않음 → 따옴표 제거 필요) |

### 0-4. 작업 규칙 (사고 방지) — 반드시 지킬 것

- **`git add .` / `git add -A` 금지.** 경로를 지정해서 add. `data/google-services.json`, `data/propos-worker-firebase-adminsdk-*.json` 은 비밀키다(지금은 `.gitignore` 로 막혀 있음, 과거 커밋 이력에는 없음).
- **pre-commit 훅** (`.githooks/pre-commit`) 이 커밋마다 `npm run sync:dist` = `npm run build` + `git add dist` 를 실행한다. 즉 **모든 커밋에 `dist/` 가 자동 포함**되고, 빌드는 커밋하지 않는 소스 변경까지 포함한 작업 폴더 전체 기준이다. 일부만 커밋할 때는 커밋하지 않을 파일을 잠시 stash 하고 커밋한 뒤 pop 한다. 훅을 `--no-verify` 로 건너뛰지 말 것.
- **테스트는 실제 `data/` 를 쓰면 안 된다.** `server/occupancyWatcher.js`·`server/propertiesStore.js` 를 쓰는 테스트는 `import '../helpers/isolateDataDir.js'` 를 **가장 먼저** import (`PROPOS_DATA_DIR` 를 임시 폴더로). 어기면 `s50` 이 실패한다. (과거에 테스트가 실제 `monitoring-config.json` 을 `{"areaName":"test","reservation":null}` 로 덮어써 운영 중인 예약 정보가 지워진 사고가 있었다.)
- **한 폴더를 여러 AI 세션이 동시에 편집하지 말 것.** 이번 작업 중 Claude 세션이 5개 열려 있었다. Codex 는 단독으로 작업하거나, 작업 전 다른 세션이 없는지 확인.
- `dist/` 직접 수정 금지 (`npm run build` 산출물). `vercel.json` 은 손으로 편집 후 반드시 JSON/경로 오타 확인 (한글 IME 로 `/api/cleaningㅍ/c` 같은 오타가 들어갔다가 발견·수정된 적 있음).
- 자세한 코드 규칙은 `CLAUDE.md` 의 "코드 규칙 (절대)" 와 이 문서 §6.

---

## 1. 프로젝트 전체 구조 (2026-09-19 코드와 대조 완료)

**PROPOS** = Airbnb 숙소 자동 관리 시스템 (운영자 1인). Vite + React 18, Vercel + 라즈베리파이. UI 는 인라인 스타일 우선(`CLAUDE.md` §13).

```
propos-project-v2/
  api/
    cleaning/
      [...slug].js           ← 청소 CRUD + 웹훅 + 통계(/stats) + 숙소 등록·이름 이전(properties)
      _dispatch.js           ← 알림 발송 공통 로직 (advanceJob, sendCompletionSmsToRest*)
      _notify.js             ← FCM 단일 진입점 (FCM 우선, SMS 폴백)
      _push.js               ← Firebase Admin SDK FCM
      _calendar.js           ← Google Calendar OAuth2 블로커 이벤트
    workers/[...slug].js     ← 직원 앱 API (register/heartbeat/token)
    cron/[...slug].js        ← 크론 핸들러 (morning / evening + 개별 action)   ※ tick.js 는 없다
    stats.js, stats/drilldown.js  ← 레포트 통계 / 지표 실패 목록
    events/[...slug].js      ← 이벤트 수집·조회
    ha/[...slug].js          ← Home Assistant 프록시
    properties.js            ← Pi 숙소 설정 프록시
  server/                    ← 로컬 dev·Pi 전용 (occupancyWatcher, haProxy, icalProxy, propertiesStore)
  src/
    domain/                  ← 순수 함수 (화면과 분리): periodDomain, reportingDomain,
                               futureWeekDomain, futureReportDomain, selectionScopeDomain,
                               propertyIdentityDomain, roomStateFromEventsDomain, …
    application/             ← reportingService, statsQueryParser, calendarSyncService, eventService
    infrastructure/          ← eventRepository, cleaningJobRepository, propertyRenameRepository, kvStore
    hooks/useReportingStats.js
    components/v2/           ← RoomStateApp, PropertyListView, PropertyDetailView, DashboardView,
                               CleaningManager, reporting/* (ReportPanel, FutureMatrixPanel, EventMatrixPanel,
                               ActiveHybridPanel, TodayStatusPanel, DrilldownSheet …)
    data/roomStateMockData.js ← 목업 숙소 20개 (dev 전용, 실데이터와 함께 리스트에 섞여 표시됨)
  data/                      ← schema-cleaning.sql, migrate-cleaning-v2.sql, (런타임: monitoring-*.json 은 gitignore)
  tests/  unit / functional / integration / e2e / helpers   ← 단위·기능 테스트가 `npm test`
  docs/                      ← 설계 정본 (report-architecture.md, cleaning-automation-design.md, …)
  worker-app/                ← React Native Android 직원 앱
```
\* `sendCompletionSmsToRest` 는 이름과 달리 이미 `notify()`(FCM 우선)를 쓴다 — 이름만 정리 후보.

---

## 2. 완료된 것 (재작업 금지)

### 2-1. 청소 자동화 (기존 — 코드로 재확인됨)

- API: UUID slug 폴백, `upsertProperty`(`ical_url` COALESCE), `runFollowupChecks()`(VIP 1h/BULK 3h 타임아웃, `listJobs` 에 편승), `cancelJob`, worker API 3종
- DB: `cleaners.fcm_*`, `cleaning_jobs.google_*`·`CANCELLED`, `cleaning_notifs.channel`, `property_cleaning_config.host_phone/ical_url`, `property_calendar_blockers`
- 프론트(`CleaningManager.jsx`): iCal URL·host_phone 입력, 60초 폴링, 취소 버튼, **직원 승인/비활성화 UI (승인 대기 → 승인 완료)**
- **거절 API JSON**: `GET /api/cleaning/d?token=…&format=api` 구현 완료 (`handleDecline`), worker-app `declineJob()` 도 `&format=api` 사용
- **배정 완료 알림 FCM 전환** 완료 (`sendCompletionSmsToRest` 가 `notify()` 사용)

### 2-2. 크론 구조 (⚠ 이전 문서의 "tick.js 단일 크론" 은 틀림 — 현재 구조)

`vercel.json` 크론은 **2개** (Hobby 플랜 한도 때문에 통합):

| 경로 | 스케줄(UTC) | KST | 실행 내용 |
|------|-------------|-----|-----------|
| `/api/cron/morning` | `0 23 * * *` | 08:00 | daily-plan(Slack 브리핑) + worker-health-check + cleaning-followup, 매월 15일 monthly-cleaning, (Gmail Watch 갱신), (미커밋: 월요일 Calendar Watch 갱신) |
| `/api/cron/evening` | `0 13 * * *` | 22:00 | cleaning-followup + daily-result(Slack 결산) |

- `cleaning-followup` 은 "제거"된 게 아니라 morning/evening 크론과 `listJobs` 폴링에서 실행된다. 개별 호출용 action(`daily-plan` 등)도 남아 있다.
- 크론 보호: `CRON_SECRET` (`Authorization: Bearer`).

### 2-3. 레포트 시스템 (신규, 이번 세션)

- 설계 정본 `docs/report-architecture.md` (§11 네비게이션, §12 드릴다운, §13 패널, §14 멀티 숙소, **§15 기간=타임라인**)
- 데이터 소스: 과거=`events`(Postgres) / 현재=이벤트로 계산한 현재 상태 / 미래=`properties[].reservations`(iCal) + `cleaning_jobs`
- 청소 지표 6·7 은 서버(`reportingService.injectCleaningMetrics`)가 채운다 (`cleaningOnTime`, `cleaningCreated`, `cleaningAssigned`; 조회 실패 시 null → 화면 "해당 없음")
- **상세 목록(건수를 누르면 뜨는 바텀시트)의 한 줄 = 숙소 이름 · 구어체 한 줄 설명 · 시간** (결정 D-018) — 문장·색 근거·정렬은 `violationDetailDomain`(순수 함수), 그리기는 `ViolationRow`
  - 심각도는 글자·막대·칩 없이 **줄 색**으로만 (빨강/주황/초록, 등급 없는 지표는 회색). 심한 건이 위로 정렬됨. 사용자가 "심각이고 뭐고 상태바·막대는 없애고 일상적인 색으로"라고 지시해 1차 구현(태그+막대+칩)을 폐기했으니 되살리지 말 것
  - 색을 나누는 지표: 청소 시간 초과(기준 3시간 대비 초과분: <30분 초록 / 30~60분 주황 / ≥60분 빨강), 공실 에너지낭비(켜져 있던 시간: <1시간 초록 / 1~3시간 주황 / ≥3시간 빨강)
  - 색을 나누지 않는 지표(퇴실후 절전·보안, 청소후 보안, 입실전 최적화)는 회색 + "퇴실하고 12분 뒤에 …감지됐어요" 같은 문장만, 최근 순 정렬 — 근거 없는 등급을 만들지 않는다
  - 미래(배정 실패 / 배정 요청 필요): 체크아웃까지 24시간 이내 빨강 / 그 밖 주황 (초록은 쓰지 않음 — 문제가 있는데 초록이면 괜찮아 보임). 실패 건은 "(5명 중 2명 거절, 3명 무응답)", 취소 건은 "(N시간 전에 취소됨)"(`cleaning_jobs.updated_at` 기준)
  - 기준값은 `violationDetailDomain.js` 상단 상수 한 곳에서만 바꾼다
  - 서버는 건마다 짝을 붙여 내려준다: `detail.limit_hours`(청소), `detail.resolved_at`(공실 꺼짐), `detail.anchor_at`(퇴실·청소 완료 시각), `detail.reason`. 짝을 못 찾으면 키를 넣지 않는다
  - 공실 에너지낭비는 기간이 끝난 뒤에 꺼진 건도 짝지으려고 기간 끝~지금의 "꺼짐" 기록만 한 번 더 조회한다 (`reportingService.queryLateEvents`)
  - 한계: `post_checkout_*`·`post_cleaning_*` 이벤트는 아직 Pi 감시 프로그램이 보내지 않는다(타입만 정의) — 실데이터가 쌓이면 그때 문장이 채워진다. 행을 누르면 그 숙소로 이동
- 결함 감사 이력과 잔여 없음 상태는 `tests/unit/s45.report-scope-audit.test.js` 헤더 (R1~R12 전부 [수정])

### 2-4. 테스트 (현재 **1858 tests / 0 fail**, 단위 60파일)

| 파일 | 커버 영역 |
|------|-----------|
| `s33.worker-api`, `s30.job-cancellation`, `s11.cleaning-dispatch`, `integration/s32.cleaning-api-routing` | 청소/직원 API |
| `s39`~`s44` | 미래 레포트·기기 준비율·다음주 도메인·멀티 숙소 |
| `s45.report-scope-audit` | 집계 범위·모수 감사 (회귀 가드, `AUDIT_STRICT=1` 로 bug() 를 실제 실패로 볼 수 있음) |
| `s46.selection-scope` | 체크박스 선택(전체/1개/복수/해제) |
| `s47.property-identity` | 숙소 이름=ID·이름 변경 이전 (PGlite 로 실제 SQL 검증) |
| `s48.current-state-from-events` | 현재 상태를 이벤트에서 계산 |
| `s49.period-offsets` | 2주 뒤/3일 전 기간, 청소 취소 규칙 |
| `s50.test-data-isolation` | 테스트가 실제 `data/` 를 안 건드림 |

⚠ **`s34.cron-tick.test.js` 는 신뢰하지 말 것**: 테스트 파일 안에 `resolveTasks()` 를 다시 구현해 그걸 검증한다(존재하지 않는 `api/cron/tick.js` 를 대상으로 함). 실제 코드를 검증하지 않는다 → §3 의 정리 과제.

### 2-5. Worker App (React Native)

- Phone OTP → FCM → register API 연동, HomeScreen/JobScreen 완성, APK 빌드·갤럭시 설치 완료
- Firebase: `worker-app/package.json` 기준 `@react-native-firebase/*` **^20.0.0** (이전 문서의 "21.14.0" 표기는 package.json 과 불일치 — 설치본 버전은 이 환경에 node_modules 가 없어 확인 못 함). **v26 사용 금지**(default export 없음).

---

## 3. 남은 작업 (Codex 가 이어받을 내용)

### HIGH

**A. 운영 반영 확인** — §0-2 를 사용자와 함께 확인 (배포 성공, D-016 자동 이전, 파주201). 이전에 실패하면 Toast 문구와 `POST /api/cleaning/properties` 응답(409 이름 중복 등)을 확인.

**B. 미커밋 변경 검토·커밋** — §0-3 표. 각 항목이 어느 작업의 것인지 사용자에게 확인하고, 커밋은 `§0-4` 규칙(경로 지정, 훅 주의)대로. `api/cron` 의 Calendar Watch 갱신은 운영 동작을 바꾸므로 검토 후 배포.

**C. `s34.cron-tick.test.js` 재작성** — `api/cron/[...slug].js` 의 `morning`/`evening` 분기를 실제로 검증하도록(핸들러 mock + 소스 계약). 현재는 자기 자신을 검증하는 테스트(L0).

**D. Gmail Watch 상태 확인** — 등록 절차: `curl -X POST https://www.proposonline.com/api/gmail/watch` (`vercel.json` 리라이트로 `/api/cleaning/gmail-watch`). 성공 응답 `{ ok:true, historyId, expiration }`. 만료 7일 — 갱신 로직은 크론(`kv "gmail_watch_expiration"`)에 있으나 **운영 동작은 이 환경에서 확인 불가**. 계정 역할: `adcfirm@gmail.com`(Cloud Console 앱 등록, 데이터 없음) / `nam5821@gmail.com`(Airbnb 알림 Gmail, `GOOGLE_REFRESH_TOKEN`) / `bnb.paju@gmail.com`(Calendar 청소 일정, `GOOGLE_CALENDAR_REFRESH_TOKEN`). 환경변수(2026-08-24 기록, 재확인 필요): `CRON_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_PUBSUB_TOPIC`.

### MEDIUM

**E. 앱 → 감시 프로그램에 `checkIn` 전달 (⚠ 반드시 사용자 승인 후)** — 지금 `RoomStateApp.runSync` 는 `reservation: { checkOut }` 만 보낸다. `occupancyWatcher.checkCalendarEvents()` 는 `reservation.checkIn` 이 있어야 "체크인 1시간 전 입실 준비"를 서버에서 자동 실행하는데 값이 없어서 동작하지 않는다(현재는 브라우저가 열려 있을 때 클라이언트가 파생 상태로 처리). 보내면 **실제 집의 HA 기기가 자동으로 켜지는 동작**이 서버 쪽에서 시작되므로 사용자 확인 없이 바꾸지 말 것.

**F. 오늘 화면 [예정] 칸** — `TodayStatusPanel` 의 예정 영역은 "캘린더 연동 후 체크인 예정 · 청소 배정 현황이 표시됩니다" 안내문 그대로다. 오늘 남은 체크인/체크아웃·청소 배정을 표시하려면 `periodToRemainingRange('today')`(이미 지원)를 써서 `FutureMatrixPanel` 식으로 구현.

**G. Worker App Play Store 내부 테스트 배포**
```bash
cd worker-app
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd android && ./gradlew bundleRelease
# 산출물: android/app/build/outputs/bundle/release/app-release.aab
```
Play Console → 내부 테스트 트랙 → AAB 업로드 → 청소 직원 이메일 초대

**H. 숙소별 Google Calendar 초기 설정** — 숙소마다 Calendar 생성 → Calendar ID·Appointment Schedule 예약 URL 을 PROPOS 숙소 설정 패널에 입력.

### LOW (정리 후보)

- `eventService._updateRoomStateCache` 의 KV 룸 상태 갱신 코드는 현재 상태 레포트가 더 이상 읽지 않는다 → 다른 용도가 없으면 제거.
- `sendCompletionSmsToRest` 이름 정리 (이미 FCM 우선).
- `.gitignore` 의 `"src/components/IntroScene copy.jsx"` 따옴표 제거.
- dev 스텁(`vite.config.mjs`)은 과거 기간마다 값을 바꾸지 않는다 (2주 전과 지난주 숫자 동일). 백엔드 없이 dev 를 켜면 가짜 데이터가 아니라 빈 화면/오류 표시가 정상.
- 알려진 개선 여지: `PropertyListView` 의 `useReportingStats` 이전 응답 경쟁은 취소 처리됨(`FutureMatrixPanel` 포함) — 추가 조치 불필요.

---

## 4. 핵심 데이터 흐름

### 4-1. 청소 배정
```
체크아웃 감지 (iCal 폴링 or Google Calendar Webhook)
  → POST /api/cleaning/jobs (sync) → cleaning_jobs INSERT (PENDING)
  → POST /api/cleaning/dispatch/:id → advanceJob()
      → VIP 1번 FCM 푸시 → [무응답 1h] runFollowupChecks() → VIP 2번 → VIP 3번
      → [무응답 1h] → BULK 전체 → [무응답 3h] → ESCALATED + Slack
      → [수락] Calendar 예약 → Webhook → ASSIGNED
      → [거절] GET /api/cleaning/d?token=…&format=api → 다음 순위 자동 발송
```

### 4-2. 레포트
```
ListView 체크박스/타임라인 → (selectionScopeDomain, periodForOffset) → useReportingStats(period, propertyIds)
  → GET /api/stats?period=&property_ids=      → reportingService.getStatsForPeriod
       now/today : getLastKnownStatesFromDB → countCurrentStats
       그 외     : queryEvents(period range, propertyIds) → countPeriodEvents + injectCleaningMetrics
  → 미래/예정 패널: properties[].reservations(클라이언트 iCal) + GET /api/cleaning/stats?period=&property_ids=&items=true
```

### 4-3. 숙소 식별자
`syncConfig.name` = ID. 저장된 id 가 이름과 다르면 앱 첫 로드에서 `registerProperty(cfg, previousId)` → 서버 `renamePropertyId` 트랜잭션(cleaning 설정·잡·블로커·알림 이력의 property_id 이전). 실패하면 기존 설정 유지.

---

## 5. 로컬 개발

```bash
cd ~/Downloads/propos-project-v2
npm run dev            # http://localhost:5173 (strictPort). 서버 워처(HA WebSocket) 도 함께 시작됨
npm test               # 단위+기능 1737 tests (실제 data/ 를 건드리지 않음)
AUDIT_STRICT=1 node --test tests/unit/s45.report-scope-audit.test.js   # bug() todo 를 실제 실패로
npm run build          # dist 생성 (커밋 훅이 자동 실행)
```
- 개발 서버는 포트 5173 을 점유한다. 다른 곳에서 이미 떠 있으면 `strictPort` 때문에 실패 — 기존 서버를 재사용하거나 종료.
- 개발 서버로 화면을 검증할 때 브라우저 자동화는 **쓰기 요청(POST/PUT)을 차단**해서 운영 중인 서버의 `data/monitoring-*.json` 이 바뀌지 않게 할 것.

```bash
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
| Firebase v26 사용 | default export 없음 — 현재 ^20.x 유지 |
| `innerHTML` 사용 | XSS → `textContent` |
| `alert()` / `confirm()` | 웹: `Toast.show()`, 앱: `Alert.alert()` |
| HA 토큰 브라우저 번들 | `/api/ha/*` 프록시 경유만 |
| `PROPOS_SLACK_WEBHOOK`·DB/KV/Blob 자격증명 소스 커밋 | Vercel 환경변수만 |
| iCal URL 소스 커밋 | localStorage(`propos_calendar_sync`)·Pi/DB 설정만 |
| `@vercel/*` 를 `src/` 에서 import | `api/` 폴더에서만 |
| vercel.json 크론을 3개 이상으로 늘리기 | Hobby 한도 — `morning`/`evening` 2개에 작업을 얹어라 |
| 현재(now/today) 레포트를 KV 임시 캐시로 집계 | 5분 만료로 숙소가 빠지고 이상 건수를 못 담음 → 이벤트 기록에서 계산 |
| DEMO/견본 수치로 실제 응답 대체 | 운영 화면에 가짜 숫자가 진짜처럼 표시됨 → 견본은 dev 스텁에만 |
| 숙소 이름에 쉼표·중복 이름 허용 | 이름이 곧 ID (`property_ids` 구분자와 충돌, 이력이 섞임) |
| 테스트에서 실제 `data/` 쓰기 | 운영 감시 기록 오염 (s50 이 강제) |
| `git add .` / 훅 우회 | 비밀키 유출, dist 불일치 |

---

## 7. 참고 문서

- `CLAUDE.md`, `.claude/rules/decisions.md` (결정 정본)
- `docs/report-architecture.md` (레포트), `docs/reporting-feature-design.md`, `docs/cleaning-automation-design.md`, `docs/data-storage-design.md`
- 시스템 아키텍처 시각화(외부 링크, 이 환경에서 미검증): https://claude.ai/code/artifact/025d28ec-9b72-416e-9cc5-313de1100140
- Claude 개인 메모리(`~/.claude/…/memory`)는 Codex 가 읽을 수 없으므로 핵심은 위 문서에 옮겨 두었다. 사용자 선호: **설명·보고는 코드 용어보다 "누가 무엇을 하면 화면에 무엇이 보이는지"(시나리오) 중심의 쉬운 문장으로**.

## 8. Vercel 배포 정보

- **프로젝트**: `propos-project-v2` / **URL**: `https://www.proposonline.com`
- **GitHub**: `adckang/propos` main push → 자동 빌드·배포 (⚠ push 하면 운영에 즉시 반영됨)
- **DB**: Neon Postgres (`neon-violet-park`) / **KV**: Upstash (`upstash-kv-coral-ridge`)
- **주의**: `propos` (propos-henna.vercel.app)는 중복 프로젝트 — 무시
- `.env.local` 의 `POSTGRES_URL` 은 **운영 DB 일 수 있으니** 로컬 스크립트·테스트에서 사용 금지 (테스트는 fake db / PGlite 만)

---

## 9. 이 문서의 검수 기록 (2026-09-19, 이전 판 대비 정정)

| 이전 서술 | 실제(코드) | 조치 |
|-----------|-----------|------|
| `api/cron/tick.js` 단일 매시간 크론, KST 분기 | 파일 없음. `vercel.json` 크론 2개(`morning`/`evening`) | §2-2 재작성 |
| `cleaning-followup` 크론 제거됨 | `morning`/`evening` 크론과 `listJobs` 에서 실행됨 | §2-2 정정 |
| 작업 B: 거절 API JSON 미구현 | `format=api` 구현·worker-app 사용 중 | 완료 이동 |
| 작업 C: 배정 완료 알림 SMS → FCM 전환 필요 | `notify()`(FCM 우선) 사용 중 | 완료 이동 (이름만 정리 후보) |
| 작업 D: 직원 승인 UI 없음(DB 직접 수정) | `CleaningManager` 에 승인 대기/승인 UI 있음 | 완료 이동 |
| Firebase v21.14.0 | `package.json` ^20.0.0 | 표기 정정 (설치본 확인 필요) |
| 테스트 1118개 | 1737개, 단위 56파일 | 갱신, 신규 s39~s50 추가 |
| `s34.cron-tick` 이 tick.js 를 검증 | 대상 파일이 없고 테스트 내부에서 로직 재구현(L0) | §3-C 과제로 기록 |
| (없음) 레포트·기간·숙소 식별자·테스트 격리 | 이번 세션 결과 | §0, §2-3, §6 신설 |
| Gmail Watch "지금 여기" | 등록 후 운영 중(9/4 웹훅 토큰 버그 수정 이력), 갱신 로직은 크론에 있음 | §3-D 로 확인 과제화 |
