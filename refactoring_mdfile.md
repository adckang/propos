# PROPOS Markdown Refactoring Review

> 작성일: 2026-11-12 · 검토 보강·재검증: 2026-11-17 · 상태 동기화: 2026-11-26 (DP-08, [doc_plan.md](doc_plan.md#phases)) (Asia/Seoul)  
> 목적: 기존 Markdown의 중복·충돌·모호한 용어·검색성 문제와 정리 순서만 관리  
> 전체 문서 메뉴와 프로젝트 파일·폴더 아키텍처: [design_overview.md](design_overview.md)  
> 액터·화면·시나리오: [actor_ui_scenarios.md](actor_ui_scenarios.md)  
> API·외부 협업: [runtime_interfaces_and_collaboration.md](runtime_interfaces_and_collaboration.md)  
> 오류·재시도·로그: [error_observability.md](error_observability.md)  
> 정책→문서→코드→데이터→테스트 연결: [documentation_traceability.md](documentation_traceability.md)  
> 원칙: 이 문서는 정리 제안이지 새 제품 정본이 아니다. 분야별 Markdown의 정정은 `docs/refactoring.md`의 작업으로 한다(예: ACT-08 QA-01 1~4차, 2026-11-19). 여기에는 판정과 상태만 둔다.  
> 검색 키워드: `[CONFLICT]` `[DUPLICATE]` `[STALE]` `[TERM]` `[FORMAT]` `[ACTION]`

<a id="review-summary"></a>

## 1. 리팩터링 요약

| 구분 | 확인 결과 | 우선 처리 |
| --- | --- | --- |
| 직접 충돌·불일치 | [MD-R01~R15·R26~R28](#conflicts) | 예약 정본, 상태 수, 데이터 소스, 안심지수, 알림, OAuth, cron, 인증·오류·배정 의미 |
| 완전·구조 중복 | [MD-R16~R20·R29](#duplicates) | dev-tunnel 복제, 상태 머신·청소 상태·레포트 규칙, 통합 문서 역할 중복 |
| 용어 혼용 | [용어 범주](#terms) | 정본, 현재/실시간, 예약/입실, 완료, 앱, 역할, 알림·오류·관측 상태 |
| 형식·검색성 | [MD-R21~R25](#format-issues) | 잘못된 H1, 대형 누적 문서, 시점 값, 줄 번호 링크, 스타일 범위 |
| 정리 원칙 | 기존 파일 즉시 이동 금지 | 메타데이터 → 직접 충돌 → 중복 생성화 → 이력 분리 순서 |

이 문서에서는 문제의 판정과 정리 순서만 다룬다. 문서와 코드·API·폴더 구조를 찾을 때는 [design_overview.md](design_overview.md), 사람·화면은 [actor_ui_scenarios.md](actor_ui_scenarios.md), 실행 협업은 [runtime_interfaces_and_collaboration.md](runtime_interfaces_and_collaboration.md), 오류·로그는 [error_observability.md](error_observability.md), 정책부터 테스트까지의 연결은 [documentation_traceability.md](documentation_traceability.md)를 사용한다. 실제 작업·결정 상태는 [docs/refactoring.md](docs/refactoring.md#sec-02)에서만 관리한다.

<a id="review-findings"></a>

## 2. 리뷰 결과 [CONFLICT] [DUPLICATE] [STALE]

<a id="conflicts"></a>

### 2.1 명시적 충돌·불일치

상태는 기존 문서의 수정 여부가 아니라 현재 판정 단계를 뜻한다.

| 상태 | 의미 |
| --- | --- |
| 확인 완료 | 충돌·중복의 존재와 근거를 확인함 |
| 결정 필요 | 제품 의미나 운영 정책을 사용자 결정 없이 확정할 수 없음 |
| 운영 확인 필요 | 배포 환경·외부 서비스·실기 상태의 새 관측이 필요함 |
| 문서 정정 준비 | 코드·결정 근거가 명확해 최소 문서 정정안을 만들 수 있음 |
| 보류 | 선행 결정 또는 별도 작업을 기다림 |
| 종결 | 승인된 정리와 검증이 끝남 |

`11-26 그대로`는 2026-11-26에 해당 문장이 분야별 문서에 아직 남아 있음을 다시 확인했다는 뜻이다.

| ID | 중요도 | 주제 | 상태 |
| --- | --- | --- | --- |
| [MD-R01](#md-r01) | 높음 | 예약 정본·iCal URL | 문서 정정 준비 · 11-26 그대로 |
| [MD-R02](#md-r02) | 높음 | 숙소 상태 수·버전 | 문서 정정 준비 · 11-26 그대로 |
| [MD-R03](#md-r03) | 높음 | VACANT 에너지 낭비 | 문서 정정 준비 · 상태 트리에만 남음 |
| [MD-R04](#md-r04) | 높음 | 현재 상태 데이터 소스 | 문서 정정 준비 · 11-26 그대로 |
| [MD-R05](#md-r05) | 높음 | 안심지수의 구현과 제품 의미 | 종결 · DEC-02 |
| [MD-R06](#md-r06) | 높음 | Worker App 현재 상태 | 문서 정정 준비 · 11-26 그대로 |
| [MD-R07](#md-r07) | 매우 높음 | 알림 정책·채널 선택·운영 상태 | 확인 완료 · 정책-구현 불일치 |
| [MD-R08](#md-r08) | 높음 | Google 인증 방식 | 문서 정정 준비 · 11-26 그대로 |
| [MD-R09](#md-r09) | 높음 | 등록 cron과 하위 작업 | 문서 정정 준비 · 11-26 그대로 |
| [MD-R10](#md-r10) | 중간 | 월간 레포트 범위 | 문서 정정 준비 · 11-26 그대로 |
| [MD-R11](#md-r11) | 중간 | Slack의 역할 | 문서 정정 준비 · 11-26 그대로 |
| [MD-R12](#md-r12) | 중간 | 데이터 저장 구현 상태 | 종결 · `36a2153` |
| [MD-R13](#md-r13) | 중간 | 관리자 수 | 문서 정정 준비 · 11-26 그대로 |
| [MD-R14](#md-r14) | 중간 | 문서 최신 순서 | 종결 · `5f132f3` |
| [MD-R15](#md-r15) | 중간 | 완료의 의미 | 확인 완료 · 일부 반영 |
| [MD-R26](#md-r26) | 매우 높음 | 인증 기능과 운영 강제 여부 | 확인 완료 · 운영 관측 있음 |
| [MD-R27](#md-r27) | 높음 | 현재 오류·로그와 목표 표준 | 결정 필요 |
| [MD-R28](#md-r28) | 높음 | Worker 수락·Calendar 예약·ASSIGNED 확정 | 문서 정정 준비 |

<a id="md-r01"></a>

#### MD-R01 · 예약 정본·iCal URL

- **이전 설명:** [CLAUDE.md](CLAUDE.md)는 iCal URL을 브라우저 `localStorage`에만 둔다.
- **현재 구현:** 서버가 DB의 `ical_url`을 읽어 Airbnb iCal을 가져오고 `property_reservations`를 갱신한다.
- **판정:** Airbnb iCal은 외부 예약 원천이고 Postgres는 화면·청소 작업이 사용하는 내부 운영 원장이다. 둘을 포괄적으로 같은 `예약 정본`이라 부르면 경계가 사라진다.
- **정리 제안:** [data-architecture-and-simulator.md](docs/data-architecture-and-simulator.md)의 후속 구조를 기준으로 삼되 `외부 예약 원천 / 내부 운영 원장 / 브라우저 캐시`로 용어를 분리한다. CLAUDE의 해당 줄은 과거 규칙으로 표시한다.

<a id="md-r02"></a>

#### MD-R02 · 숙소 상태 수

- **레포트 문서:** [report-architecture.md](docs/report-architecture.md)는 “10개 상태”를 복제한다.
- **상태 정본:** [room-state-machine.md](docs/room-state-machine.md)는 두 상태를 더 포함한 12개 조합이다.
- **코드 대조:** `src/domain/room-state/roomStateDomain.js`의 전이도 12개 조합을 포함하지만 파일 머리말은 아직 `room-state-machine.md v2.2`를 가리키고 실제 문서는 v2.6이다(2026-11-26).
- **정리 제안:** 레포트 문서는 상태를 재정의하지 않고 상태 정본을 링크하거나 자동 생성한다. 코드의 버전 표시는 별도 소스 변경 작업에서 정정하되 이 문서 작업에서는 수정하지 않는다.

<a id="md-r03"></a>

#### MD-R03 · VACANT 에너지 낭비

- **확인:** `report-architecture.md`는 VACANT 에너지 낭비가 상태 머신 밖이라고 설명한다. `room-state-machine.md`에는 `VACANT/ENERGY_WASTE`와 `vacant_energy_waste_detected/resolved`가 이미 있다.
- **정리 제안:** 레포트 문서의 섹션 7을 현재 상태 정본과 다시 대조한다.
- **2026-11-26:** 이벤트 표(6절)에는 `vacant_energy_waste_detected/resolved`와 `VACANT/CLEANING_FINISHED → ENERGY_WASTE` 전환이 들어갔다. 3-1 상태 트리(“10개 상태”)에만 VACANT 에너지 낭비가 빠져 있다.

<a id="md-r04"></a>

#### MD-R04 · 현재 상태 데이터 소스

- **UI 설계 설명:** `reporting-feature-design.md`는 `today/now`를 `KV + events + iCal`, `KV + HA`로 기술한다.
- **저장 설계 설명:** [data-storage-design.md](docs/data-storage-design.md)는 현재 레포트를 Postgres 이벤트에서 재건한다고 명시한다.
- **추가 불일치:** `report-architecture.md`도 KV와 이벤트 표현이 섞인다.
- **코드 대조:** `src/application/reportingService.js`의 `now/today`는 `getLastKnownStatesFromDB`로 Postgres 이벤트를 재건하며 KV 인자는 더 이상 사용하지 않는다. 브라우저의 HA 조회는 별도의 live sensor 경로다.
- **정리 제안:** `보고 시점 상태=Postgres 이벤트 재건`, `live sensor=HA 최신 관측`, `KV=보조 상태·캐시`로 분리한다.

<a id="md-r05"></a>

#### MD-R05 · 안심지수의 구현과 제품 의미

- **UI 설계 설명:** 지속 시간·청소 미배정·기기 오프라인 등 임계값 기반 이상을 분모로 제시한다.
- **집계 설계 설명:** `complaint_detected`와 `energy_waste_detected` 중심의 이벤트 분모를 정의한다.
- **결정(종결):** DEC-02(2026-11-17)가 `안심지수 = 측정 가능한 운영 지표 성공률의 평균("최종적으로 성공한 비율")`으로 확정했다. 이상이 개입 없이 처리된 비율은 별도 보조 지표 `자동화 개선율`(RF-25)이며 섞지 않는다. [docs/refactoring.md 6절](docs/refactoring.md#rules)
- **현재 구현:** `operationalMetricsDomain.js`가 판정 기록이 없는 4개 지표(퇴실 후 절전·보안, 빈방 절전·보안 유지)를 점수·성공률에서 빼고(RF-26, 제외 목록은 이 파일 한 곳), 남은 지표 중 이 기간 대상이 있는 것의 성공률을 평균한다. 빠진 지표의 실제 실패는 배지·목록에 그대로 남는다. `완벽해요`는 평균 100이 아니라 총 실패 0건으로 판정한다. `e6b214a` `a9c1d52`
- **문서:** 분야별 레포트 문서도 같은 정의로 정리돼 있다(2026-11-26 확인) — 계산 정본은 [report-architecture 6-1·6-1-1](docs/report-architecture.md#safety-index), 표시는 [reporting-feature-design 0-2](docs/reporting-feature-design.md).

<a id="md-r06"></a>

#### MD-R06 · Worker App 현재 상태

- **문서 앞부분:** [worker-app-spec.md](docs/worker-app-spec.md)는 “SMS 링크 방식”, “기획 초안”, 거절 JSON 미구현이라고 한다.
- **문서 후반부:** Worker App·FCM·`format=api`·토큰 API 구현과 반영을 기록한다.
- **정리 제안:** 현재 상태와 역사적 배경을 나누고 완료된 항목은 미결 목록에서 제거한다.

<a id="md-r07"></a>

#### MD-R07 · 알림 채널

- **제품 정책(확정):** [docs/refactoring.md 6절](docs/refactoring.md#rules)의 ACT-11 규칙 — "청소 알림은 앱 푸시(FCM) 기준. 문자는 쓰지 않는다."
- **저장소 구현:** `server/cleaning/_notify.js`는 아직 활성 FCM 토큰이 없고 전화번호가 있으면 SMS를 선택하며, 확정된 일부 FCM 실패에서는 `SMS_FALLBACK`을 선택할 수 있다. 실제 발송은 문자 게이트웨이 환경변수가 있을 때만 된다.
- **운영 관측:** 2026-11-09 감사의 활성 토큰·SMS 설정 집계와 2026-11-10 이후 지정폰 수신 확인은 관측 시점과 범위가 다르다. 어느 하나를 영구적인 현재 상태로 일반화하지 않는다.
- **판정:** 정책은 확정됐고 코드에 문자 경로가 남은 `정책-구현 불일치`다. 사람 간 `sms:` 딥링크(Worker App의 host 협의)는 이 정책과 별개다. 코드 경로를 없앨지는 `docs/refactoring.md`의 작업으로 다룬다(2026-11-26 기준 미등록). 이 문서 정리만으로 SMS를 활성화하거나 코드를 제거하지 않는다.

<a id="md-r08"></a>

#### MD-R08 · Google 인증 방식

- **확인:** `cleaning-automation-design.md`의 결정표는 Google OAuth를 “서비스 계정”이라고 한다. 같은 문서 후반과 완료 이력은 OAuth2 Refresh Token 방식으로 정정했다고 적는다.
- **정리 제안:** 결정표를 최신 인증 방식과 맞춘다.

<a id="md-r09"></a>

#### MD-R09 · 등록 cron과 하위 작업

- **과거 설명:** `cleaning-scenario-matrix.md`는 30분마다, `cleaning-automation-design.md`는 하루 1회라고 적는다.
- **실행 설정:** [cleaning-notification-reliability-audit.md](docs/cleaning-notification-reliability-audit.md)는 `vercel.json` 기준 아침·저녁 두 번이라고 명시한다.
- **코드 대조:** `api/cron/[...slug].js`에는 `monthly-cleaning`, `cleaning-followup`, `worker-health-check` 같은 호출 가능한 handler가 있지만 `vercel.json`에 독립 스케줄로 등록된 것은 morning/evening 두 개다. 여러 하위 작업은 그 묶음 안에서 조건부 실행된다.
- **정리 제안:** `등록된 스케줄 / 호출 가능한 handler / 묶음 안의 하위 작업`을 분리하고 `vercel.json`을 저장소 실행 설정 기준으로 둔다.

<a id="md-r10"></a>

#### MD-R10 · 월간 레포트 범위

- **문서 초반:** 월 단위가 현재 UI 범위 밖이라고 한다.
- **후속 기록:** 같은 문서 후반과 D-021~D-029는 월간 보고서·UI 구현을 기록한다.
- **정리 제안:** 초기 범위와 현재 구현을 분리한다.

<a id="md-r11"></a>

#### MD-R11 · Slack의 역할

- **확인:** `reporting-feature-design.md` 섹션 1은 Slack이 내용 없이 링크만 보낸다고 한다. 섹션 11은 일일·주간 레포트 전체 본문 포맷을 정의한다.
- **코드 대조:** 일반 이벤트 링크 알림 외에도 cron 정기 보고와 청소 배정 실패·Worker 상태·Watch 갱신 같은 운영 메시지가 본문을 포함해 발송될 수 있다.
- **정리 제안:** `이벤트 링크 알림 / 정기 보고 / 운영 장애·에스컬레이션` 세 유형으로 명명한다.

<a id="md-r12"></a>

#### MD-R12 · 데이터 저장 구현 상태

- **확인:** `data-storage-design.md` 체크리스트는 event API/outbox 등을 미구현으로 남긴다. `event-ingestion-audit.md`는 입력 검증·일반 이벤트 영속 전송·운영/Pi 반영까지 기록한다.
- **정리 제안:** 체크리스트를 최신화하거나 “최초 설계 시점”으로 고정 표시한다.
- **종결(2026-11-19):** `data-storage-design.md` 13절에 “최초 설계(2026-08) 시점의 구현 계획”이라는 표시와 실제 구현·미구현 목록을 붙였다. `36a2153`

<a id="md-r13"></a>

#### MD-R13 · 관리자 수

- **확인:** `analytics-strategy.md`는 관리 앱 사용자가 1명이라고 전제한다. `.claude/rules/decisions.md` D-034·D-035는 다중 운영자와 숙소별 권한을 확정한다.
- **정리 제안:** 마케팅 분석 가정의 기준일을 표시하고 현재 사용자 모델과 분리한다.

<a id="md-r14"></a>

#### MD-R14 · 문서 최신 순서

- **확인:** `current-task.md`는 11월 4일, `handoff-to-claude.md`는 11월 10일, `refactoring.md`는 11월 12일이다. 모두 “현재/다음” 표현을 포함한다.
- **정리 제안:** 현재 상태는 `refactoring.md`만 담당하고 나머지는 명시적 스냅샷·아카이브로 분류한다.
- **종결:** `current-task.md`에 “과거 작업 스냅샷 — 더 이상 갱신하지 않는다” 표시(2026-11-19, `5f132f3`), `handoff-to-claude.md`는 “인계 시점의 스냅샷” 명시. 현재 상태는 `docs/refactoring.md`(할 일·완료·정해진 규칙 목록)만 담당한다.

<a id="md-r15"></a>

#### MD-R15 · 완료의 의미

- **확인:** 여러 문서에서 `완료`가 코드 작성, 테스트 통과, 배포, 운영 데이터 반영, 실기 수신을 각각 뜻한다.
- **정리 제안:** `설계 완료 / 구현 완료 / 검증 완료 / 배포 완료 / 현장 검증 완료` 다섯 상태를 공통 사용한다.
- **일부 반영:** `docs/refactoring.md` 7절 작업 원칙이 “로컬 완료 ≠ 운영 반영 ≠ 실물 검증 — 셋을 따로 표시한다”를 정했다. 다섯 상태로 넓힐지는 아직 정하지 않았다.

<a id="md-r26"></a>

#### MD-R26 · 인증 기능과 운영 강제 여부

- **저장소 구현:** `server/auth/operatorAuth.js`는 `off`(기본)·`log`·`enforce` 모드를 제공하고 관리자·운영자·숙소 범위 검사를 구현한다.
- **문서 위험:** API에 `권한이 적용됐다`고만 쓰면 인증 기능 존재와 운영 `enforce` 활성 상태를 같은 사실로 오해할 수 있다.
- **판정:** 저장소만으로 현재 Production 환경변수와 배포 상태를 확정하지 않는다. `인증 기능 구현 / 배포 코드 포함 / 운영 강제 활성`을 분리한다.
- **운영 관측:** 2026-11-10·11-12·11-14에 운영(`www.proposonline.com`)에서 로그인 없이 부른 보고서 API·청소 API·이벤트 조회가 401로 거절됐다. `off`·`log`였다면 통과했을 요청이므로 그 시점에 `enforce`가 켜져 있었다. 환경변수 값 자체는 보지 않았다. 근거: `git show ca41eb4:docs/refactoring.md`의 RF-10·RF-17 반영 기록, [event-ingestion-audit 10절](docs/event-ingestion-audit.md#rf-06-current-path-review)
- **정리 제안:** 구조 문서는 조건부 경계를 설명하고, 실제 활성 여부는 위처럼 날짜가 붙은 운영 관측으로 연결한다. 날짜 없이 “강제된다”고 쓰지 않는다.

<a id="md-r27"></a>

#### MD-R27 · 현재 오류·로그와 목표 표준

- **현재 구현:** API마다 `{error}`, `{error, code}`, delivery result, HTML, 빈 body가 공존한다. 일반 `Error`, 속성을 붙인 Error, 업무 `status/outcome/errorCode`도 함께 사용된다. 공통 structured logger·request ID·correlation ID는 확인되지 않았다.
- **문서 위험:** 공통 오류 하이어라키·로그 필드·마스킹 규칙을 권장한다는 설명이 현재 구현 완료처럼 읽히면, 클라이언트 계약과 운영 관측 수준을 잘못 판단하게 된다.
- **민감정보 관측:** 일부 console·Slack 경로가 전화번호·이메일을 포함할 수 있고 FCM token·iCal URL은 자격정보 성격을 가진다.
- **판정:** [error_observability.md](error_observability.md)의 `CURRENT`와 `TARGET · 미구현` 구역을 유지하고, 기존 분야 문서가 목표 규칙을 현재 표준이라고 표현하지 않게 한다.
- **정리 제안:** 먼저 현재 error/status catalog와 민감정보 마스킹 정책을 승인한 뒤, 코드 표준화는 별도 구현 작업으로 다룬다.

<a id="md-r28"></a>

#### MD-R28 · Worker 수락·Calendar 예약·ASSIGNED 확정

- **UI 문구·행동:** Worker App의 수락 버튼은 Google Calendar booking WebView를 연다.
- **내부 확정:** `cleaning_jobs.status = ASSIGNED`는 Calendar event·attendee를 webhook 또는 수동 scan이 읽어 담당자를 매칭한 뒤 반영한다.
- **문서 위험:** 버튼 클릭을 `청소자 수락`, Google Calendar 일정 생성을 `청소 예약`, DB 상태 전이를 `배정 확정`이라 각각 부르면서 같은 순간처럼 설명할 수 있다.
- **판정:** `수락 버튼 → 외부 예약 화면 진입 → Calendar 일정 생성 → webhook/scan → ASSIGNED 확정`으로 단계를 구분한다.
- **정리 제안:** [actor_ui_scenarios.md](actor_ui_scenarios.md)의 SCN-05와 [runtime_interfaces_and_collaboration.md](runtime_interfaces_and_collaboration.md)의 SEQ-03을 링크하고, 기존 문서의 축약 표현은 범위를 명시한다.

<a id="duplicates"></a>

### 2.2 중복·과도한 반복

| ID | 유형 | 영향 | 상태 |
| --- | --- | --- | --- |
| [MD-R16](#md-r16) | dev-tunnel 완전 중복 | 한쪽만 고치면 즉시 드리프트 | 확인 완료 · 11-26 그대로 |
| [MD-R17](#md-r17) | 숙소 상태표 복제 | 실제 10/12 상태 불일치 발생 | 확인 완료 |
| [MD-R18](#md-r18) | 청소 작업 상태 복제 | 상태·채널·cron 설명 분산 | 확인 완료 |
| [MD-R19](#md-r19) | 구현 일지 중복 | 과거 숫자를 최신처럼 오해 | 확인 완료 · 일부 해소 |
| [MD-R20](#md-r20) | 레포트 규칙 중복 | 분모와 데이터 소스 분기 | 확인 완료 |
| [MD-R29](#md-r29) | 통합 문서 내부 역할 중복 | 허브·세부 문서·계획서가 같은 흐름과 검증을 반복 | 종결 |

<a id="md-r16"></a>

#### MD-R16 · dev-tunnel 완전 중복

- **확인:** `.agents/skills/dev-tunnel/SKILL.md`와 `.claude/skills/dev-tunnel/SKILL.md`는 3,202 bytes, SHA-1 `8446167...`로 동일하다.
- **정리 제안:** 양쪽 경로의 필요성을 확인한 뒤 정본 1개와 동기화 또는 생성본 표지를 둔다.

<a id="md-r17"></a>

#### MD-R17 · 숙소 상태표 복제

- **확인:** 상태표가 `room-state-machine.md`, `report-architecture.md`, `reporting-feature-design.md`에 반복된다.
- **정리 제안:** 상태 목록은 정본 링크 또는 테스트로 생성한다.

<a id="md-r18"></a>

#### MD-R18 · 청소 작업 상태 복제

- **확인:** 청소 작업 상태가 `cleaning-automation-design.md`, `cleaning-scenario-matrix.md`, Worker App, 감사 문서에 반복된다.
- **정리 제안:** 도메인 상태 정의, 시나리오, 운영 이력을 분리한다.

<a id="md-r19"></a>

#### MD-R19 · 구현 일지 중복

- **확인:** `refactoring.md`, 두 handoff, `current-task.md`, 두 audit가 같은 커밋·테스트 수·배포 결과를 반복한다.
- **정리 제안:** 상태 정본에는 최신 요약만, 감사에는 불변 증거, handoff에는 링크만 둔다.
- **일부 해소(2026-11-19):** `docs/refactoring.md`는 할 일·완료·정해진 규칙 목록만 두고, 경위·검증 수치는 커밋 메시지로 보낸다. 그 전 상세 기록은 `git show ca41eb4:docs/refactoring.md`. handoff·audit 쪽 반복은 다시 확인하지 않았다.

<a id="md-r20"></a>

#### MD-R20 · 레포트 규칙 중복

- **확인:** 안심지수·미배정·현재 상태·요약 규칙이 두 레포트 문서와 결정 문서에 반복된다.
- **정리 제안:** 계산 규칙은 architecture, 표현은 feature, 승인 이유는 decisions로 단방향 참조한다.

<a id="md-r29"></a>

#### MD-R29 · 통합 문서 내부 역할 중복

- **확인:** `design_overview.md`가 상세 Sequence·S01~S05·명령 목록을 반복했고, 세부 문서는 테스트 매핑과 단계 완료 체크리스트를 각각 복제했다. `doc_plan.md`도 완성 문서의 목차·필수 내용을 장문으로 다시 담았다.
- **정리:** 허브에는 상위 구조와 링크만 남기고, 액터·런타임·오류 문서의 자체 체크리스트와 중복 근거표를 제거했다. 상세 근거 매핑은 `documentation_traceability.md`만 소유한다.
- **소유권:** 시나리오는 [actor_ui_scenarios.md](actor_ui_scenarios.md), API·Sequence·cron은 [runtime_interfaces_and_collaboration.md](runtime_interfaces_and_collaboration.md), 오류·로그는 [error_observability.md](error_observability.md), 문서 작업 계획·검증 이력은 [doc_plan.md](doc_plan.md)가 소유한다.
- **상태:** 2026-11-17 통합 문서 7개를 약 3,800줄에서 약 2,900줄로 축소하고 Mermaid를 28개에서 23개로 정리한 뒤 링크 검증까지 통과해 종결. 기존 분야별 Markdown의 MD-R16~20 중복은 수정 승인 전까지 별도 유지한다.

<a id="terms"></a>

### 2.3 모호하거나 어긋나는 용어 [TERM]

| 용어 | 현재 혼용 | 권장 구분 |
| --- | --- | --- |
| 정본 / Source Of Truth | 코드, DB, 문서, 시나리오, 현재 상태를 모두 “정본”이라 부름 | `코드 정본`, `데이터 원장`, `상태 관리 정본`, `정책 정본`, `매핑 정본` |
| 현재 / 실시간 / ACTIVE / NOW | 진행 중 기간, 순간 스냅샷, 이벤트 재건, HA 센서값 | `ACTIVE=진행 기간`, `NOW=보고 시점 상태`, `live sensor=HA 최신 관측` |
| 체크인/체크아웃 vs 입실/퇴실 | 예약 시각과 실제 센서 감지를 같은 말로 사용 | `체크인/체크아웃=예약`, `입실/퇴실 감지=실제 이벤트` |
| 청소 완료 | 작업 상태, 숙소 상태, 센서 이벤트가 혼재 | `청소 작업 완료`, `숙소 상태 청소완료`, `청소 완료 감지 이벤트` |
| 앱 | 운영 웹, Worker App, 설치 앱 | 세 이름을 구분해 표기 |
| 운영자 / 관리자 / 호스트 | 권한 역할과 업무 역할 혼용 | 인증 역할 `ADMIN/OPERATOR`와 업무 역할 `host` 분리 |
| 청소자 / 직원 / 작업자 | DB 객체와 사용자군 혼용 | `청소 담당자`, `현장 직원`, `작업자` 구분 |
| 접수 / 수락 / 배정 | 공급자 접수, 알림 확인, Calendar 확정 혼용 | `공급자 접수`, `알림 열람`, `청소자 수락`, `ASSIGNED 확정` |
| 예약 | 숙박 예약, 청소 예약, 블로커 혼용 | `숙박 예약`, `청소 예약 이벤트`, `예약 차단 블로커` |
| 안심지수 / 안심 지수 | 표기와 지표 범위 혼용 | 표기는 `안심지수`; 마케팅과 운영 지표에 범위 명시 |
| 안심지수 / 자동화 개선율 | 이상이 자동으로 처리된 비율을 안심지수라 부름 | `안심지수` = 운영 지표 최종 성공률 평균, `자동화 개선율` = 이상이 개입 없이 처리된 비율(DEC-02, RF-25). 섞지 않음 |
| 문제 이름 | 지연·미감지·확인 불가를 센서 고장이나 상태 전환과 섞어 씀 | `퇴실 지연`(퇴실 시각 + 20분까지 퇴장 미확인), `입실 미감지`(그날 자정까지 미확인), `청소 미감지`(배정된 청소에 아무도 안 옴), `확인 불가`(그 시각에 센서 꺼짐·감시 멈춤), `청소 미배정(취소)` — 모두 상태가 아니라 문제(DEC-10·15~17) |
| 노쇼 의심 | 예전 요약 끝 안내 | 쓰지 않음. `입실 미감지`로 대체(DEC-16·17) |
| 시험 수준 L / T | 테스트 파일의 L0~L3과 TC 계획의 수준이 같은 글자 | 테스트 파일은 `L0`~`L3`(기존 뜻), TC 계획은 `T0`~`T6`([refactoring_TC.md 5.2](refactoring_TC.md)) |
| ACT- / AC- | 실행 작업 번호와 액터 번호가 같은 접두어 | 실행 작업은 `ACT-`(`docs/refactoring.md`), 액터는 `AC-`(`actor_ui_scenarios.md`) |
| property_id / 숙소 이름 | 표시값과 FK 키 관계가 불명확 | 변경 가능성·표시값·참조 키를 계약으로 분리 |
| fallback / 폴백 | 채널 전환, 기본값, 대체 UI 혼용 | `알림 채널 전환`, `기본값`, `장애 대체 경로` |
| 실패 / 오류 / 상태 | HTTP 오류, throw, `FAILED`, `ESCALATED`, `UNKNOWN` 혼용 | `프로그램 예외`, `HTTP 오류`, `업무 실패 상태`, `외부 결과 불확실` |
| 로그 / 알림 / 관측 | console, Slack, DB 상태, UI Toast를 모두 로그라고 부름 | `진단 로그`, `운영 알림`, `업무 원장`, `사용자 피드백` |

<a id="format-issues"></a>

### 2.4 형식·검색성 문제 [FORMAT]

| ID | 발견 | 영향 | 상태 |
| --- | --- | --- | --- |
| [MD-R21](#md-r21) | 잘못된 H1 | 제목·TOC 탐색 실패 | 문서 정정 준비 · 11-26 그대로 |
| [MD-R22](#md-r22) | 대형 누적 문서 | 현재 규칙과 역사 혼재 | 확인 완료 · `refactoring.md`는 해소 |
| [MD-R23](#md-r23) | 시점 값 반복 | 최신값 판별 어려움 | 확인 완료 |
| [MD-R24](#md-r24) | 줄 링크와 의미 앵커 혼용 | 줄 이동 시 링크 손상 | 확인 완료 |
| [MD-R25](#md-r25) | 아이콘 스타일 적용 범위 불명확 | 전역 규칙으로 오해 가능 | 확인 완료 · 11-26 그대로 |

<a id="md-r21"></a>

#### MD-R21 · 잘못된 H1

- **확인:** [reporting-feature-design.md](docs/reporting-feature-design.md)의 첫 줄이 `claude# PROPOS...`라 정상 H1이 아니다.
- **정리 제안:** 별도 승인 후 `# PROPOS...`로 정정한다.

<a id="md-r22"></a>

#### MD-R22 · 대형 누적 문서

- **확인:** `refactoring.md`, `report-architecture.md`가 천 줄을 넘었고 감사 문서도 시간순으로 누적된다.
- **정리 제안:** 현재 계약·상태와 변경 이력을 파일 또는 최상위 절로 분리한다.
- **2026-11-26:** `refactoring.md`는 2026-11-19에 목록만 남기고 이력을 git(`ca41eb4`)으로 보내 해소됐다. `report-architecture.md`는 그 뒤로도 커져 현재 계약과 이력이 섞인 대형 문서로 남아 있다.

<a id="md-r23"></a>

#### MD-R23 · 시점 값 반복

- **확인:** 테스트 총수·커밋·배포 ID 같은 시점 값이 여러 문서에 박혀 있다.
- **정리 제안:** 모든 스냅샷 값에 관측일을 붙이고 최신 상태 문서 한 곳에서만 요약한다.

<a id="md-r24"></a>

#### MD-R24 · 줄 링크와 의미 앵커 혼용

- **확인:** 링크 대상 파일은 존재하지만 `#L숫자` 스타일과 의미 앵커가 혼용된다.
- **정리 제안:** 중요한 계약은 명시적 `<a id>` 앵커를 사용하고 줄 링크는 감사 증거에만 둔다.

<a id="md-r25"></a>

#### MD-R25 · 아이콘 스타일 적용 범위

- **확인:** 아이콘 가이드의 어두운 카드 예시와 전역 라이트 테마 규칙의 적용 범위가 명시되지 않는다.
- **정리 제안:** `Scene-1 한정` 또는 전역 예외 여부를 문서 상단에 명시한다.

<a id="intentional-differences"></a>

## 3. 충돌로 보면 안 되는 차이

| 차이 | 유지해야 하는 이유 |
| --- | --- |
| Postgres 원장 vs Pi 상태 파일 vs KV vs 브라우저 캐시 | 수명과 책임이 다른 저장소다. |
| 예약·청소 일정이 정하는 상태 vs 센서 감지 | 상태는 일정이 정한다. 센서 감지는 그 구간에서 기대한 일(입실·퇴실·청소)이 실제로 일어났는지 확인하는 근거이며, 확인되지 않으면 상태를 되돌리지 않고 문제로 남긴다(DEC-10, [room-state-machine.md 0절](docs/room-state-machine.md)). |
| 랜딩 문의 전환율 vs 운영 안심지수 | 서로 다른 사용자·제품 목표다. |
| `cleaning_jobs` 상태 vs Room State Machine | 업무 배정 상태와 숙소 물리 상태는 다른 상태 머신이다. |
| 설계 문서 vs 감사 문서 | 설계는 의도, 감사는 특정 시점의 구현 근거다. |
| REAL / SIMULATED / DEMO | REAL·SIMULATED는 같은 DB 계약, DEMO는 fixture 프로필이다. |

<a id="recommended-tree"></a>

## 4. 중복 제거 실행 원칙 [ACTION]

목표 문서 트리는 [design_overview.md의 문서 메뉴](design_overview.md#project-at-a-glance)가 소유한다. 이 문서에서는 별도 트리를 다시 만들지 않고 정리 순서만 관리한다.

1. 기존 문서를 고치지 않고 `design_overview.md`의 중앙 목록에서 역할·유형·주의사항을 관리한다.
2. 이 문서의 각 항목을 `정정 준비 / 결정 필요 / 운영 확인 필요`로 나누고 [documentation_traceability.md](documentation_traceability.md)의 근거 연결을 유지한다.
3. 사용자 결정이나 실제 작업이 필요한 항목은 `docs/refactoring.md`의 DEC/RF/ACT에 연결하고 여기에서 작업 상태를 복제하지 않는다.
4. 승인된 항목만 기존 문서에서 최소 정정하고 링크·앵커 회귀를 확인한다.
5. 상태 목록과 cron처럼 반복 비용이 큰 표는 생성 또는 계약 테스트 대상으로 검토한다.
6. 폴더 이동과 큰 문서 분리는 모든 링크 전략을 정한 뒤 마지막에 검토한다.

<a id="search-index"></a>

## 5. 검색 인덱스

| 검색어 | 찾을 내용 |
| --- | --- |
| [MD-R01~R15·R26~R28](#conflicts) | 직접 충돌·불일치 |
| [MD-R16~R20·R29](#duplicates) | 완전·구조 중복 |
| [용어 혼용](#terms) | 용어 정리 대상 |
| [MD-R21~R25](#format-issues) | 형식·검색성 문제 |
| `SEC-02` | 최신 작업 상태 |
| `D-0` / `DEC-0` | 과거 결정 / 후속 결정 |
| `RF-0` / `ACT-` | 감사 항목 / 실행 작업 |
| `SC-` / `S01~S05` / `sNN` | 사용자 시나리오 / 시스템 시나리오 / 테스트 |
| `REAL`, `SIMULATED`, `DEMO`, `HYBRID` | 데이터 프로필 |
| `PENDING`, `ASSIGNED`, `COMPLETED`, `CANCELLED` | 청소 작업 상태 |
| `VACANT`, `PRE_STAY_READY`, `OCCUPIED`, `CLEANING` | 숙소 Main Status |
| `FCM`, `SMS`, `NotificationService` | 알림 채널과 전환 |
| `iCal`, `Calendar`, `blocker` | 숙박·청소 예약과 슬롯 제어 |
| `Postgres`, `KV`, `Blob`, `outbox` | 저장·캐시·전송 신뢰성 |
| `CURRENT`, `TARGET`, `UNKNOWN`, `requestId` | 현재 오류 구조와 미구현 관측 목표 |
| [MD-R29](#md-r29) | 통합 문서 내부 중복 제거 결과 |

<a id="verification"></a>

## 6. 이번 리뷰의 검증 기록

- 최초 검토 대상 기존 Markdown과 2026-11-16 통합 문서 7개(`design_overview.md`, 이 문서, `documentation_traceability.md`, `doc_plan.md`, 액터/UI·런타임·오류 문서)를 구분했다. 정확한 현재 개수는 `doc_plan.md`의 기준점과 최종 검증 기록에서 관리한다.
- 두 dev-tunnel skill 파일은 파일 크기와 SHA-1이 완전히 같음을 확인했다.
- Markdown 로컬 링크 대상 누락은 발견되지 않았다.
- 2026-11-17 작성 시점에는 기존 분야별 Markdown을 수정하지 않았다. 그 뒤 ACT-08 QA-01 1~4차(2026-11-19, `5f132f3` `36a2153` `43497b7` `1390a3e`)가 `docs/refactoring.md` 작업으로 분야별 문서를 정정했다.
- 2026-11-26 상태 동기화: MD-R05·12·14 종결, MD-R07·26 판정 갱신, 남은 항목의 문장이 분야별 문서에 그대로 있는지 다시 확인했다(`11-26 그대로`). 작업 목록은 `git show 09c582e:sync_md.md`, 단계별 커밋은 [doc_plan.md DP-08](doc_plan.md#phases).
- 전체 안내는 `design_overview.md`, 사람·화면은 `actor_ui_scenarios.md`, 실행 협업은 `runtime_interfaces_and_collaboration.md`, 오류·관측은 `error_observability.md`, 문서 정합성 문제는 이 파일, 정책부터 테스트까지의 연결은 `documentation_traceability.md`로 분리했다.
- 외부 서비스의 현재 가격·제한은 인터넷으로 재검증하지 않았다.
