# PROPOS Test Case Refactoring Plan

> 상태: 계획 · 일부 선행 처리됨 — 테스트 안전(RF-23·42·43)과 로직 복사·소스 글자 검사 교체(ACT-08)는 `docs/refactoring.md` 작업으로 끝났다. 구조 정리(TC ID·수준 분류·gate)는 미실행. 상태 동기화 2026-11-26([sync_md.md](sync_md.md))  
> 작성일: 2026-11-17 (Asia/Seoul)  
> 목적: 현재 TC와 자동화 테스트를 사용자 시나리오·인터페이스·데이터·오류 구조에 맞춰 찾기 쉽고 안전한 체계로 재구성한다.  
> 대상 독자: 개발자, QA, 기획자, 운영 담당자  
> 분석 기준: 2026-11-17 작업 트리 관측, 2026-11-26 상태 동기화(DP-08, [doc_plan.md](doc_plan.md#phases)). 파일 수 같은 시점 숫자는 적지 않고, 실행 시작 시 TCR-00에서 다시 측정한다.  
> 문서 시작점: [design_overview.md](design_overview.md)  
> 시나리오: [actor_ui_scenarios.md](actor_ui_scenarios.md) · 인터페이스: [runtime_interfaces_and_collaboration.md](runtime_interfaces_and_collaboration.md) · 오류: [error_observability.md](error_observability.md) · 추적성: [documentation_traceability.md](documentation_traceability.md)  
> 범위: 이 파일은 **계획만 기록**한다. 이번 작업에서 테스트·소스·설정·CI는 수정하지 않는다.  
> 검색 키워드: `[TC-PLAN]` `[INVENTORY]` `[SAFETY]` `[ID]` `[LAYER]` `[GATE]` `[TRACE]` `[TCR-]`

---

<a id="tc-goal"></a>

## 1. 목표 [TC-PLAN]

TC를 다음 순서로 추적할 수 있게 만든다.

```text
사람의 시나리오 또는 시스템 계약
  → 안정적인 TC ID
    → 테스트 수준과 실행 환경
      → 자동화 파일·fixture
        → 실행 명령·CI gate
          → 통과·실패·skip 근거
```

핵심 목표는 테스트 수를 늘리는 것이 아니다.

1. 같은 요구사항을 여러 테스트가 검증한다면 각 테스트의 수준과 책임을 구분한다.
2. 파일명 `sNN`을 요구사항 ID로 오해하지 않게 한다.
3. 기본 테스트가 운영 DB·HA·Google·Slack·프로덕션 API를 건드리지 않게 한다.
4. `통과`와 `환경이 없어 skip`을 구분한다.
5. 빠른 PR 검증, 전체 격리 검증, 실연동 검증을 서로 다른 gate로 운영한다.
6. TC 설명을 여러 Markdown에 복사하지 않고 향후 TC registry 한 곳에서 관리한다.

---

<a id="terms"></a>

## 2. 용어

| 용어 | 이 계획에서의 의미 |
| --- | --- |
| 요구사항 | SCN·TR·IF·ERR·정책처럼 검증해야 하는 약속 |
| TC | 하나의 조건·행동·기대 결과를 가진 검증 단위 |
| 테스트 파일 | TC 하나 이상을 실행하는 코드 파일 |
| suite | 같은 계약·fixture·환경을 공유하는 TC 묶음 |
| level | static/contract, unit, handler, integration, browser, live 중 검증 깊이 |
| gate | PR·main·nightly·manual 중 테스트를 반드시 실행하는 시점 |
| fixture | 운영 데이터 대신 사용하는 격리 입력·DB·시간·외부 응답 |
| live probe | 실제 DB·HA·Google·Slack·배포 API를 확인하는 명시적 선택 실행 |

`S01~S05`는 제품 단계 시나리오 ID다. `s78.operator-scope-handlers.test.js` 같은 소문자 `sNN` 파일 번호와 같은 체계가 아니다.

---

<a id="current-inventory"></a>

## 3. 현재 TC 구조 [INVENTORY]

### 3.1 파일 인벤토리

| 영역 | 현재 역할 |
| --- | --- |
| `tests/unit/` | 순수 도메인, API handler, source contract, UI 구조, 운영 안전 검사가 혼재 |
| `tests/functional/` | [S01~S05](docs/scenarios.yaml) 서비스 시나리오 |
| `tests/integration/` | 격리 SQL/PGlite, fake HA, 선택적 실제 DB·HA·Google 검사 |
| `tests/e2e/` | Playwright 브라우저 E2E(`*.spec.js`)와 Node 기반 실연동 검사(s37)가 같은 폴더에 있음 |
| `tests/smoke/` | fixture API를 사용한 preview 브라우저 smoke |
| `tests/helpers/`·`tests/integration/helpers/` | API 호출, fixture, 시간, 저장 경로, 네트워크·HA 격리 |

파일 수는 시점마다 달라 적지 않는다. 필요하면 `find tests -name '*.test.js' -o -name '*.spec.js' | wc -l`로 다시 센다(TCR-00).

파일 수는 테스트 케이스 수가 아니다. 반복문으로 TC를 생성하거나 한 `test()`에서 여러 계약을 검증하는 파일이 있어 정적 호출 수를 TC 수로 사용하면 안 된다.

### 3.2 현재 실행 경로

| 명령·gate | 실제 포함 범위 | 현재 제외·주의 |
| --- | --- | --- |
| `npm test` | unit + functional, Node test runner, production fetch trap | integration·browser·live 제외 |
| `npm run test:integration` | `tests/integration/*.test.js` | 환경이 없으면 일부 suite skip; CI 기본 gate 아님 |
| `npm run test:smoke` | Playwright + preview server + fixture API | CI와 `verify:all`에 포함 |
| `npm run test:e2e` | Playwright + 데모 전용 dev server(5174, 기존 서버 재사용 안 함) + `tests/e2e/*.spec.js` | CI와 `verify:all`에 미포함. 실제 HA 시험(E2E-003)은 `RUN_LIVE_HA=1` 등을 명시할 때만 |
| `npm run test:connectivity` | s37 Node 외부 연결 시험(DB·Google·KV·Slack·운영 웹훅) | `RUN_LIVE_CONNECTIVITY=1` 없으면 요청 없이 전부 skip. KV·Slack·웹훅 쓰기 포함. CI·`verify:all` 미포함 |
| `npm run verify:scenarios` | S01~S05 registry→컴포넌트·서비스·UML·functional·smoke 연결 | 현재 SCN-01~07 전체를 포괄하지 않음 |
| `npm run verify:all` | unit+functional, scenario, deploy, dist, smoke | 이름과 달리 integration·E2E·live는 포함하지 않음 |
| GitHub CI | `npm test`, scenario, deploy, dist, smoke | integration·E2E 실행 없음 |

### 3.3 현재 안전장치

- `npm test`는 [productionFetchTrap.js](tests/helpers/productionFetchTrap.js)를 먼저 불러 운영 호스트 fetch를 차단한다.
- 저장 파일을 쓰는 watcher 시험은 [isolateDataDir.js](tests/helpers/isolateDataDir.js)로 임시 경로를 사용한다.
- integration HA helper는 기본적으로 fixture 호스트만 허용하고 `RUN_LIVE_HA=1`일 때만 실제 연결을 선택한다.
- smoke는 모든 `/api/*` 요청을 fixture 응답 또는 read-only 403으로 가로챈다.
- e2e 화면 시험은 데모 전용 dev 서버에서 돌고, 브라우저에서도 운영 주소·쓰기 요청을 막는다(RF-43 `86afce1`).
- s37 외부 연결 시험과 실제 HA 화면 시험은 명시적 허락 변수 없이는 켜지지 않는다. [s128](tests/unit/s128.test-runner-classification.test.js)이 두 실행기가 섞이지 않는지 실제로 실행해 확인한다(RF-42 `c58fbdd`).
- 다만 `npm run test:integration`에는 운영 주소 차단 장치가 걸리지 않는 등, 모든 runner에 같은 정책이 적용되는 것은 아니다(TC-R06).

---

<a id="review-findings"></a>

## 4. 리뷰 결과

### 4.1 P0 · 먼저 해결할 안전·gate 문제 [SAFETY]

| ID | 발견 | 위험 | 목표 | 상태(2026-11-26) |
| --- | --- | --- | --- | --- |
| TC-R01 | [s37.live-connectivity.test.js](tests/e2e/s37.live-connectivity.test.js)는 Node `node:test` 기반 live probe인데 Playwright `testDir` 안에 있음 | Playwright discovery가 파일을 import하면서 외부 검사를 실행할 수 있음 | live probe를 일반 discovery에서 완전히 분리 | 해결 · RF-42 `c58fbdd` — Playwright는 `*.spec.js`만 수집. 파일 위치는 그대로 |
| TC-R02 | `npx playwright test --list --config playwright.e2e.config.mjs` 실행만으로 s37 suite가 로드되어 프로덕션 GET/POST를 시도함 | 목록 조회가 side effect를 일으키며 안전한 dry-run이 아님 | `--list`·test discovery는 외부 I/O 0 보장 | 해결 · RF-42 — s128이 실제 실행으로 확인 |
| TC-R03 | s37은 “읽기 전용”이라고 설명하지만 KV SET/DEL, Slack POST, webhook POST가 포함됨 | 문서와 실제 외부 효과가 다름 | read-only probe와 write probe를 분리하고 write는 별도 승인·cleanup 필요 | 부분 · 설명은 “쓰기 포함”으로 정정, `RUN_LIVE_CONNECTIVITY=1` 없이는 안 돎. 읽기·쓰기 분리는 아직 |
| TC-R04 | `verify:all`과 CI가 integration·E2E를 실행하지 않음 | 전체 검증 통과가 전체 테스트 통과로 오해됨 | gate 이름과 실제 범위를 일치시키거나 `verify:full` 신설 | 유효 |
| TC-R05 | integration은 환경이 없으면 여러 suite가 skip됨 | exit 0만 보고 실제 SQL·실연동 검증이 실행됐다고 오해 | 실행·통과·skip 수와 이유를 gate 결과에 표시 | 유효 |
| TC-R06 | production fetch trap은 `npm test`에만 적용됨 | runner별 외부 호출 정책이 다르고 신규 테스트가 잘못된 gate에 들어갈 수 있음 | isolated gate 공통 network deny, live만 allowlist | 부분 · e2e는 브라우저 차단 추가(RF-43). integration은 차단 없음 |

#### 2026-11-17 관측 (과거 — RF-42에서 해결)

`npx playwright test --list --config playwright.e2e.config.mjs`는 Playwright TC 4개만 목록에 표시했지만, 목록 작성 과정에서 s37의 Node suite를 실행하고 프로덕션 API 요청을 시도했다. 이 관측은 TC-R01~03의 재현 근거였다. RF-42 이후에는 목록 조회가 s37을 불러오지 않는다.

### 4.2 P1 · 식별·분류·유지보수 문제 [ID] [LAYER]

| ID | 발견 | 영향 | 목표 |
| --- | --- | --- | --- |
| TC-R07 | 숫자 `sNN`이 시나리오·작성 순번·관련 unit/integration 묶음으로 동시에 사용됨 | 파일 번호만으로 요구사항·수준을 알 수 없음 | 안정적 TC ID와 파일명을 분리 |
| TC-R08 | 서로 다른 파일이 같은 숫자를 쓰는 묶음이 여럿 있음(unit과 integration이 같은 번호를 나눠 쓰는 경우 포함) | 링크·대화에서 `s30`, `s40`만 말하면 모호함 | 전체 경로 또는 TC ID로 식별 |
| TC-R09 | unit 안에 순수 계산, source text 검사, handler+fake DB, component 구조 검사가 혼재 | 실행 비용·신뢰 수준·실패 원인을 구분하기 어려움 | contract/unit/handler 분류를 메타데이터로 먼저 부여 |
| TC-R10 | `tests/e2e`에 browser E2E와 live connectivity가 혼재 | runner와 안전 정책 충돌 | browser와 live 디렉터리·명령 분리 |
| TC-R11 | 큰 테스트 파일이 여러 업무 계약을 함께 소유 | 한 변경이 넓은 fixture와 긴 파일 탐색을 요구 | 계약 경계에 따라 점진 분리 |
| TC-R12 | source 문자열·정규식 검사와 실행 동작 검사가 같은 “unit”으로 보임 | 구현 모양 검사가 실제 동작 보장처럼 읽힘 | `static contract`와 `behavior`를 명시 |

**2026-11-26:** TC-R09·R12는 ACT-08(2026-11-17~19)로 일부 해소됐다 — 로직을 복사한 시험과 소스 글자 검사 일부를 실제 코드를 실행하는 시험으로 바꿨다. 남은 소스 글자 검사는 TCR-03에서 T0로 분류한다.

대표 대형 파일:

| 파일 | 우선 검토 이유 |
| --- | --- |
| [s54.violation-detail.test.js](tests/unit/s54.violation-detail.test.js) | 상세 계산·표현 계약 다수 |
| [s79.operator-device-scope.test.js](tests/unit/s79.operator-device-scope.test.js) | auth·HA·watcher·camera scope 혼재 |
| [s30.job-cancellation.test.js](tests/unit/s30.job-cancellation.test.js) | 청소 취소·후속 처리 계약 다수 |
| [s36.cleaning-integration.test.js](tests/unit/s36.cleaning-integration.test.js) (11-18 integration → unit 이동) | 청소 API·DB 계약이 넓음 |
| [s44.future-week-report.test.js](tests/unit/s44.future-week-report.test.js) | 미래 기간·레포트 계약 다수 |
| [s29.gmail-ical-repoll.test.js](tests/unit/s29.gmail-ical-repoll.test.js) | Gmail·iCal·재조회 흐름 혼재 |

줄 수는 적지 않는다. 대상을 고를 때 `wc -l`로 다시 잰다.

파일 크기만으로 나누지 않는다. 공통 fixture가 같고 하나의 계약을 설명하면 유지할 수 있으며, 서로 다른 실패 원인과 소유 문서가 섞일 때만 분리한다.

### 4.3 P1 · 추적성 문제 [TRACE]

| ID | 발견 | 목표 |
| --- | --- | --- |
| TC-R13 | [scenarios.yaml](docs/scenarios.yaml)은 S01~S05만 registry로 관리 | 현재 SCN-01~07, auth, Room State, Worker, system flow까지 연결 범위 확장 |
| TC-R14 | [documentation_traceability.md](documentation_traceability.md)는 대표 테스트만 연결 | 대표 근거와 전체 TC catalog의 역할 분리 |
| TC-R15 | [ui-test-guide.md](docs/ui-test-guide.md)는 2026-04 수동 TC와 당시 UI gap을 누적 | 현재 UI 구조와 대조해 active/manual/history 상태 구분 |
| TC-R16 | 테스트 파일에 RF·DEC·IT·E2E·UC·S 번호가 혼재 | requirement ID와 TC ID를 별도 필드로 관리 |
| TC-R17 | 공통 TC registry가 없음 | 파일·제목·level·환경·gate·근거를 한곳에서 검색 |

### 4.4 P2 · 결과 품질·운영 문제

| ID | 발견 | 목표 |
| --- | --- | --- |
| TC-R18 | 공통 coverage·structured test report 설정이 확인되지 않음 | 숫자 목표보다 핵심 계약 미검증과 skip을 보이는 보고서 우선 |
| TC-R19 | 여러 테스트가 `process.env`, global fetch, DB singleton을 직접 바꿈 | 공통 sandbox와 restore helper로 누수 방지 |
| TC-R20 | live test의 연락·저장·알림 부수효과가 한 파일에 섞임 | 대상별 probe, dry-run, cleanup, 감사 로그 분리 |
| TC-R21 | 전체 테스트 수가 변경 이력 문서에 반복 기록됨 | 현재 수치는 자동 생성된 단일 결과에서만 관리 |

---

<a id="target-architecture"></a>

## 5. 목표 TC 아키텍처 [LAYER]

### 5.1 문서 구조와 테스트 책임

| 문서의 정보 | 주 테스트 수준 | TC가 검증할 것 |
| --- | --- | --- |
| [actor_ui_scenarios.md](actor_ui_scenarios.md) | functional, browser | 액터의 진입 조건·행동·성공·예외 흐름 |
| [runtime_interfaces_and_collaboration.md](runtime_interfaces_and_collaboration.md) | handler, integration | method/path/auth/request/response/idempotency와 Sequence 경계 |
| [error_observability.md](error_observability.md) | unit, handler, integration | 오류 코드·업무 실패·retry·masking·운영 알림 경계 |
| 데이터 설계·ERD | integration | 실제 schema·FK·transaction·REAL/SIMULATED 격리 |
| 운영·외부 인터페이스 | isolated integration, live probe | 격리 계약과 실제 연결 상태를 별도 증명 |
| [documentation_traceability.md](documentation_traceability.md) | registry 검증 | 정책·코드·데이터·TC 연결 누락 탐지 |

### 5.2 테스트 수준

```text
T0 Static Contract   파일·export·schema·금지 패턴·문서 연결
T1 Unit              순수 domain/application 계산과 상태 전이
T2 Handler Contract  HTTP handler + fake I/O/DB의 auth·body·status·side effect
T3 Integration       실제 schema/PGlite/test DB와 격리된 외부 adapter
T4 Browser Smoke     fixture API로 핵심 화면 부팅·탐색
T5 Browser E2E       로컬 dev server와 격리 backend의 사용자 흐름
T6 Live Probe        명시적 선택으로 실제 DB·HA·Google·배포 상태 확인
```

T0 검사는 T1~T6의 대체물이 아니다. 예를 들어 SQL 문자열 존재는 실제 transaction 동작을 증명하지 않고, 버튼 문구 존재는 사용 시나리오 성공을 증명하지 않는다.

**기존 L 표기와의 관계.** 테스트 파일 주석과 `.claude/rules/decisions.md`는 이미 L0~L3을 다른 뜻으로 쓴다. 이 계획의 수준은 그것과 섞이지 않도록 `T`로 부른다. 테스트 파일의 `L` 표기는 바꾸지 않는다.

| 기존 표기 | 뜻 | 이 계획의 수준 |
| --- | --- | --- |
| L0 | 자기 자신만 검증하는 금지 패턴(상수 단언, 테스트 파일 안의 SQL 문자열 검사, 로직 재구현) | 해당 없음 — 만들지 않는다 |
| L1 | 실제 함수를 불러 순수 로직 검증 | T1 |
| L2 | 실제 모듈·핸들러를 가짜 fetch·DB로 실행해 경계 검증. 예전의 소스 글자 검사도 이 이름을 썼다 | T2 (소스 글자 검사는 T0 — ACT-08부터 실제 실행 시험으로 교체 중) |
| L3 | 실제 DB·브라우저·외부 연결 | T3~T6 |

### 5.3 권장 디렉터리

아래는 목표 구조이며 TCR-03 승인 전에는 파일을 이동하지 않는다.

```text
tests/
├─ contract/             T0 · source/schema/document 계약
├─ unit/                 T1 · 순수 업무 규칙
├─ handler/              T2 · API handler + fake I/O
├─ functional/           액터·업무 시나리오
├─ integration/          T3 · 격리 DB·adapter
├─ browser/
│  ├─ smoke/             T4
│  └─ e2e/               T5
├─ live/                 T6 · 기본 discovery 제외
├─ fixtures/             불변 입력과 response fixture
└─ helpers/              env/network/time/DB/browser sandbox
```

### 5.4 안정적인 TC ID

파일 순번 대신 다음 형식을 사용한다.

```text
TC-<영역>-<계약>-<3자리 순번>
```

예시:

| TC ID | 의미 | 관련 요구사항 |
| --- | --- | --- |
| `TC-AUTH-SCOPE-001` | OPERATOR가 자기 숙소만 조회 | SCN-02, TR-06, IF-AUTH |
| `TC-CLEAN-ASSIGN-001` | 실제 숙소 수동 배정에 active cleaner 필수 | TR-03, IF-CLEAN |
| `TC-WORKER-TOKEN-001` | token lost-ACK 재시도 | SCN-04, IF-WORKER, ERR retry |
| `TC-REPORT-PERIOD-001` | 기간 경계 집계 | TR-05 |
| `TC-OPS-CRON-001` | morning 하위 작업 실패 격리 | SCN-07, TR-07 |
| `TC-LIVE-HA-001` | 실제 HA 연결·복원 확인 | IF-EXT04 |

규칙:

- TC ID는 파일 이동·이름 변경 후에도 유지한다.
- 기존 `sNN`, `UC-`, `IT-`, `E2E-`, `RF-`는 `legacy_ids` 또는 `trace_ids`로 보존한다.
- 한 TC는 하나의 핵심 기대 결과를 가진다.
- 정상·권한 거부·업무 충돌·외부 실패는 별도 TC로 나눈다.
- 동일 계약을 다른 level에서 검증하면 같은 ID를 재사용하지 않고 `related_tc`로 연결한다.

### 5.5 향후 TC registry

TCR-02에서 별도 승인을 받아 machine-readable registry를 만든다. 이 계획서는 registry 내용을 복제하지 않는다.

권장 필드:

| 필드 | 내용 |
| --- | --- |
| `id`, `title` | 안정적 TC ID와 사람이 읽는 제목 |
| `owner_doc`, `trace_ids` | 소유 문서와 SCN/TR/IF/ERR/DEC/RF |
| `level`, `domain`, `risk` | 테스트 수준·영역·위험도 |
| `file`, `runner`, `gate` | 자동화 위치·실행기·필수 gate |
| `mode` | isolated / live-read / live-write |
| `preconditions` | env·DB·fixture·기기 조건 |
| `action`, `expected` | 행동과 핵심 기대 결과 |
| `side_effects`, `cleanup` | 외부 변경과 복구 방식 |
| `status` | active / quarantine / manual / deprecated |
| `legacy_ids`, `related_tc` | 기존 번호와 다른 수준의 관련 TC |

---

<a id="target-gates"></a>

## 6. 목표 실행 gate [GATE]

| Gate | 포함 | 외부 네트워크 | 실패 의미 |
| --- | --- | --- | --- |
| `verify:pr` | T0~T2 + functional + browser smoke | deny | PR 차단 |
| `verify:full` | PR 범위 + 모든 격리 integration + local browser E2E | deny | main/nightly 차단 |
| `verify:live:read` | 승인된 read-only live probe | allowlist | 운영 연결 점검 실패 |
| `verify:live:write` | KV·Slack·webhook·실기 제어 | 명시 승인·대상 제한 | 별도 운영 점검 실패 |

목표 명령 이름은 예시다. `package.json`, Playwright config, CI 변경은 구현 단계에서 별도 승인 후 진행한다.

필수 결과 필드:

- 실행한 TC 수
- 통과·실패·skip·quarantine 수
- skip 이유와 요구 환경
- 실행 시간
- 사용한 data profile과 DB 종류
- 외부 네트워크 허용 여부
- live write 대상과 cleanup 결과
- artifact 경로와 기준 커밋

`0개 실행 + exit 0`은 통과로 보고하지 않는다.

---

<a id="phases"></a>

## 7. 실행 계획 [TCR-]

### TCR-00 · 기준점과 안전 동결

목표: 리팩터링 전 행동과 위험을 고정한다.

작업:

1. 최신 HEAD에서 테스트 파일·helper 인벤토리를 다시 생성한다.
2. 각 현재 명령의 실행 대상, pass/fail/skip, 시간, 외부 I/O를 기록한다.
3. `--list`·discovery·dry-run 중 외부 I/O가 발생하지 않아야 한다는 계약을 정한다.
4. 현재 실패·skip·flaky를 리팩터링 실패와 분리한다.
5. 기본 runner에서 운영 주소·DB·파일 쓰기를 차단한다.

완료 조건:

- 현재 결과를 재현할 수 있다.
- 실행하지 않은 테스트를 통과로 세지 않는다.
- 리팩터링 중 제품 동작을 바꾸지 않는다.

### TCR-01 · live probe 격리 [P0]

목표: 일반 test discovery와 실제 외부 연결을 분리한다.

**상태(2026-11-26): 대부분 끝남.** 1번(Playwright·일반 glob에서 제외)과 5번(목록 조회 외부 I/O 0 회귀 시험 [s128](tests/unit/s128.test-runner-classification.test.js))은 RF-42 `c58fbdd`, 화면 시험의 데모 전용 서버는 RF-43 `86afce1`에서 처리했다. 2번은 전용 명령(`test:connectivity`)만 생기고 파일은 `tests/e2e`에 그대로다. 남은 것은 3·4번(읽기/쓰기 분리, 쓰기 대상·정리 확인)과 6번(실행·skip·정리 결과 기록)이다.

작업:

1. s37을 Playwright `testDir`과 일반 test glob에서 제외한다.
2. Node live runner 전용 위치·명령으로 분리한다.
3. DB/Google profile 조회 같은 read probe와 KV/Slack/webhook 같은 write probe를 분리한다.
4. write probe는 `LIVE_WRITE_CONFIRM` 같은 명시적 승인, 대상 표시, cleanup 확인 없이는 실행하지 않는다.
5. Playwright `--list`와 Node test discovery가 외부 I/O 0인지 회귀 테스트를 추가한다.
6. 실연동 결과에는 실제 실행·skip·cleanup 상태를 남긴다.

완료 조건:

- `test:e2e --list`가 파일 import 부수효과 없이 브라우저 TC만 나열한다.
- PR·CI·`verify:full`이 실제 외부 시스템을 호출하지 않는다.
- live write는 일반 개발 명령으로 실행되지 않는다.

### TCR-02 · TC registry와 ID 도입

목표: 파일명과 무관한 TC 식별자를 만든다.

작업:

1. 모든 테스트 파일을 domain·level·mode·gate로 분류한다.
2. 현재 test/describe를 업무 계약 단위로 묶고 TC ID를 부여한다.
3. 같은 번호를 쓰는 `sNN` 묶음을 `legacy_ids`로 보존한다.
4. SCN/TR/IF/ERR와 TC를 연결한다.
5. registry schema와 누락·중복 ID 검증기를 만든다.

완료 조건:

- 모든 active 테스트 파일이 최소 하나의 TC 또는 suite ID에 연결된다.
- TC ID 중복과 끊어진 파일 링크가 없다.
- 파일명 변경 없이도 TC 검색이 가능하다.

### TCR-03 · 테스트 수준 분류

목표: 실패 원인과 신뢰 수준을 디렉터리·명령에서 알 수 있게 한다.

작업:

1. unit의 source text 검사를 T0 contract 후보로 표시한다.
2. handler+fake DB 검사를 T2로 표시한다.
3. 실제 schema/PGlite/test DB 검사를 T3로 묶는다.
4. browser smoke와 browser E2E를 분리한다.
5. live probe를 T6로 격리한다.
6. 이동 전·후 파일 매핑과 호환 명령을 유지한다.

완료 조건:

- level 이름만 보고 I/O·속도·신뢰 범위를 알 수 있다.
- 기존 링크는 alias 또는 일괄 갱신으로 보존된다.
- 분류 변경만으로 테스트 의미나 제품 동작이 바뀌지 않는다.

### TCR-04 · fixture·환경·네트워크 표준화

목표: 테스트 간 누수와 운영 접근을 막는다.

작업:

1. env save/restore, fake clock, fetch/WebSocket 복원 helper를 통합한다.
2. DB singleton 주입·복원을 공통 lifecycle로 묶는다.
3. REAL/SIMULATED/DEMO fixture 이름과 data_origin을 일관되게 한다.
4. isolated gate는 network deny-by-default를 사용한다.
5. DB 시험은 transaction/temporary schema/PGlite 중 하나를 명시한다.
6. 생성 파일·timer·server·connection cleanup을 검증한다.

완료 조건:

- 단독 실행과 전체 실행 결과가 같다.
- 실행 순서를 바꿔도 결과가 같다.
- 운영 주소 호출·실데이터 쓰기·열린 handle이 없다.

### TCR-05 · 중복 제거와 대형 suite 분리

목표: 같은 계약의 반복을 줄이고 실패 위치를 선명하게 한다.

참고: ACT-08(2026-11-17~19)이 이 단계의 일부를 먼저 했다 — 로직을 복사한 시험을 실제 코드 시험으로 바꾸고, 바꾼 시험이 결함을 잡는지 변형 검사로 확인했다.

작업:

1. 같은 입력·기대 결과·fixture를 가진 TC 후보를 찾는다.
2. static 계약과 behavior 계약이 같은 내용을 검증하면 각각의 역할을 명시하거나 낮은 가치의 중복을 제거한다.
3. 대형 파일은 auth, validation, state transition, side effect처럼 실패 원인이 다른 경계로만 분리한다.
4. fixture·assertion helper는 공유하되 업무 기대 결과를 helper 안에 숨기지 않는다.
5. 삭제 전 대체 TC가 같은 결함을 잡는지 mutation 또는 의도적 실패로 확인한다.

완료 조건:

- 제거된 TC마다 대체 근거 또는 불필요 판정이 있다.
- 테스트 수 감소를 coverage 감소나 향상으로 단정하지 않는다.
- 한 실패가 어느 계약을 깨뜨렸는지 제목만으로 알 수 있다.

### TCR-06 · 실행 명령·CI gate 정리

목표: 명령 이름과 실제 검증 범위를 일치시킨다.

작업:

1. unit/contract/handler/functional/integration/browser/live 명령을 분리한다.
2. `verify:all`을 실제 full isolated gate로 바꾸거나 오해 없는 이름으로 변경한다.
3. PR에는 빠르고 결정적인 격리 TC를 둔다.
4. 느린 전체 격리 TC는 main/nightly에 둔다.
5. live probe는 수동 승인 workflow로 분리한다.
6. pass/fail/skip과 artifact를 machine-readable하게 저장한다.

완료 조건:

- CI 표만 보고 어떤 수준이 실행됐는지 알 수 있다.
- 필수 gate에서 0개 실행·예상 밖 skip은 실패한다.
- live credential이 일반 CI에 필요하지 않다.

### TCR-07 · 문서 추적성 연결

목표: TC catalog를 현재 문서 뼈대에 연결한다.

작업:

1. `documentation_traceability.md`에는 기능별 대표 TC와 registry 링크만 둔다.
2. TC 상세는 registry가 소유하고 문서에 복제하지 않는다.
3. `actor_ui_scenarios.md`의 SCN-01~07과 시나리오 TC를 연결한다.
4. runtime IF/SEQ와 contract/integration TC를 연결한다.
5. error ERR와 negative/retry/observability TC를 연결한다.
6. `docs/ui-test-guide.md`의 항목을 active/manual/history/gap으로 분류한다.

완료 조건:

- 요구사항에서 TC로, TC에서 코드·결과로 이동할 수 있다.
- 같은 기대 결과가 여러 Markdown에 복사되지 않는다.
- 오래된 TC에는 기준일과 상태가 표시된다.

### TCR-08 · 최종 검증과 이전 번호 정리

목표: 새 구조가 기존 보호 범위를 잃지 않았는지 확인한다.

작업:

1. 이전/이후 gate 결과와 결함 탐지 범위를 비교한다.
2. 모든 TC ID·파일·문서 링크를 검사한다.
3. skip·quarantine·live 미실행 범위를 보고한다.
4. 기존 `sNN` 링크는 호환 기간 뒤에만 제거한다.
5. 삭제·이동된 파일과 복구 방법을 기록한다.

완료 조건:

- isolated full gate가 통과한다.
- test discovery 외부 I/O가 0이다.
- 모든 active TC가 owner·level·gate·trace를 가진다.
- 남은 미검증은 명시적 backlog로 남는다.

---

<a id="priority-backlog"></a>

## 8. 우선 실행 목록

| 순서 | 항목 | 이유 | 선행 조건 |
| ---: | --- | --- | --- |
| 1 | ~~TC-R01~03 · s37 discovery 격리~~ — R01·02 해결(RF-42), R03은 읽기/쓰기 분리만 남음 | 목록 조회만으로 외부 호출 가능했음 | — |
| 2 | TC-R04~06 · gate·skip·network 정책 확정 | “전체 통과” 의미부터 고정해야 함 | 현재 명령 baseline |
| 3 | TC-R07~10 · ID와 level 부여 | 이후 이동·분리의 기준 | registry schema 승인 |
| 4 | env/network/DB helper 통합 | 순서 의존·운영 접근 예방 | level 분류 |
| 5 | 대형 suite·중복 TC 정리 | 안전한 분류 뒤에 해야 회귀 손실을 막음 | TC ID와 대체 근거 |
| 6 | CI·artifact·문서 연결 | 구조가 안정된 뒤 최종 gate 적용 | 명령과 registry 완성 |

첫 구현 단위는 **TCR-00 + TCR-01의 남은 부분(s37 읽기/쓰기 분리)**이 적절하다. 파일 전체 이름 변경이나 전체 TC 재배치는 첫 작업으로 하지 않는다.

---

<a id="change-rules"></a>

## 9. 리팩터링 규칙

1. TC 리팩터링과 제품 동작 변경을 같은 커밋에 섞지 않는다.
2. 현재 실패를 기대값 수정으로 숨기지 않는다.
3. 테스트를 삭제하기 전에 어떤 결함을 막는지 확인한다.
4. source text 검사를 behavior test라고 부르지 않는다.
5. 실제 외부 쓰기는 명시 승인·대상·복구 절차가 없으면 실행하지 않는다.
6. 환경 미설정 skip을 통과로 요약하지 않는다.
7. 파일 이동 전 전체 링크와 `docs/refactoring.md`의 근거 링크 영향을 조사한다.
8. 테스트 수·통과 수 같은 시점 값은 자동 artifact 한 곳에서만 관리한다.
9. TC 설명은 registry가, 대표 추적은 `documentation_traceability.md`가 소유한다.
10. 이 계획(구조 정리)의 진행 상태는 이 파일에서 관리한다. 테스트가 운영에 닿는 것 같은 안전 결함은 발견 즉시 `docs/refactoring.md`의 RF로 고친다(RF-23·42·43처럼).
11. 테스트는 실제 코드를 실행한다. 테스트 안에 업무 로직을 복사하지 않는다(`docs/refactoring.md` 7절).

---

<a id="definition-of-done"></a>

## 10. 최종 완료 기준

- [ ] 모든 테스트 파일이 owner domain과 test level을 가진다.
- [ ] 모든 active suite가 안정적인 TC/suite ID를 가진다.
- [ ] 같은 TC ID가 둘 이상 존재하지 않는다.
- [ ] `S01~S05`와 일반 `sNN` 파일 번호를 혼동하지 않는다.
- [ ] PR·full·live gate의 포함 범위가 명확하다.
- [ ] `verify:full` 또는 동등 명령이 모든 격리 test level을 실행한다.
- [ ] 일반 discovery·list·PR·CI의 외부 네트워크와 운영 쓰기가 0이다.
- [ ] live read/write가 분리되고 write에는 승인·cleanup 근거가 있다.
- [ ] pass·fail·skip·quarantine이 별도로 보고된다.
- [ ] 단독 실행과 전체 실행의 결과가 같다.
- [ ] SCN/TR/IF/ERR에서 관련 TC와 결과 근거로 이동할 수 있다.
- [ ] 기존 링크와 legacy ID의 이전표가 있다.
- [ ] 제품 소스 동작을 바꾸지 않고 테스트 구조만 정리했음을 확인한다.

---

<a id="next-action"></a>

## 11. 다음 작업

다음 단계는 **TCR-00 기준점 고정과 TCR-01의 남은 부분(s37 읽기/쓰기 분리)**이다.

실행 전 결정할 것:

1. live probe 파일을 `tests/e2e`에서 별도 위치로 옮길지 (Playwright config 수정은 RF-42에서 이미 했다)
2. live write(KV·Slack·webhook)를 계속 유지할지, read-only로 바꿀지
3. 새 TC registry 형식을 YAML로 할지 JSON으로 할지
4. `verify:all`을 확장할지 `verify:pr`/`verify:full`로 나눌지

결정 전에는 테스트·설정·CI를 수정하지 않는다.
