# Design Decisions

> 이미 검토하고 버린 선택지를 Claude가 다시 제안하는 것을 방지.

---

## 현재 활성 결정

## [D-015] 통계 UI 시간 계층 구조 (2026-08-08 확정)
- **결정**: List View = 주/일 바이너리 토글, Detail View = 일/시 바이너리 토글
- **이유**: 각 단위가 데이터이자 필터 역할 동시 수행. 모드가 명확히 구분되어 인지 부하 최소화.
- **월 단위**: 현재 UI 범위 외. API는 구현됨(`last_month` 등). 향후 별도 월 캘린더 뷰로 구현.
- **버린 대안**: 단일 타임라인에 모든 필터 나열 → 현재/과거/미래 맥락이 섞여 혼란

## [D-016] 숙소 식별자 = ListView에 표시되는 숙소 이름 (2026-09-19 확정)
- **결정**: `property_id`는 숙소 리스트에 표시되는 이름(예: `파주 201`). 화면(`liveProperty.id`), 청소 DB(`property_cleaning_config`·`cleaning_jobs`·`property_calendar_blockers`), 이벤트(Pi 워처 `areaName`)가 같은 이름을 키로 쓴다.
  - 이름을 바꾸면 키가 바뀌므로 서버가 이력을 새 이름으로 **한 트랜잭션**에서 이전한다 (`POST /api/cleaning/properties`의 `previous_property_id` → `renamePropertyId`). 대상 이름이 이미 다른 숙소로 등록돼 있으면 409, 아무것도 옮기지 않는다.
  - 레거시 `prop_<시각>` id는 앱 첫 로드 때 같은 경로로 자동 이전 (재실행 안전). 수동 확인·실행용 SQL: `scripts/migrate-property-id-to-name.sql`.
  - 이름 규칙: 쉼표 불가(`property_ids` 구분자와 충돌), 제어문자 불가, 60자 이하, 중복 불가.
- **이유**: 이벤트가 이미 `areaName`(=이름)으로 쌓이고 HA 영역 조회도 같은 이름을 쓴다. 화면 `LIVE_001` / 청소 DB `prop_<시각>` / 이벤트 이름이 제각각이라 숙소를 선택하면 서버가 0을 돌려주던 문제(R10)를 없앤다.
- **버린 대안**: 바뀌지 않는 별도 ID(`prop_<시각>`) 유지 + 이름은 표시용 — 이름 변경에는 안전하지만 이벤트 키(areaName)·HA 연동까지 바꿔야 해서 채택하지 않음 (사용자 결정).
- **주의**: 이름 = HA 영역 이름이므로 이름을 바꾸면 HA 영역도 같은 이름이어야 한다 (기존과 동일). 목업 숙소 ID(`P001`…)는 서버에 데이터가 없어 유지.
- **구현**: `src/domain/propertyIdentityDomain.js`, `src/infrastructure/propertyRenameRepository.js`, `api/cleaning/[...slug].js`(upsertProperty), `RoomStateApp.jsx`. 테스트: `tests/unit/s47.property-identity.test.js`.
- **재검토 시점**: 실숙소가 여러 개가 되어 이름 변경·중복이 잦아질 때.

## [D-017] 레포트 기간은 타임라인 위치를 그대로 따른다 + 취소된 청소는 재배정 요청 (2026-09-19 확정)
- **결정 1 — 기간**: ListView에서 타임라인을 2주 뒤로 넘기면 "다음 주" 레포트가 아니라 **2주 뒤 주**의 정보를 보여준다. 주 모드는 가장 가까운 주(…, 2주 전, 지난주, 이번 주, 다음 주, 2주 뒤, …), 일 모드는 그 날(…, 어제, 오늘, 내일, 2일 뒤, …). 숙소 상세(일 모드)도 그 날 그대로.
  - 기존 이름(`last_week`·`next_week`·`tomorrow` 등)은 그대로 두고, 그 밖의 오프셋만 `weeks_ahead_2`·`weeks_ago_3`·`days_ahead_2`·`days_ago_5`로 표기 (`periodForOffset` / `parseOffsetPeriod`).
  - 제목은 "2주 뒤 레포트 · 9/28~10/4"처럼 날짜 범위를 함께 표시 (몇 번째 주인지 헷갈리지 않게).
- **결정 2 — 청소 취소**: 청소가 취소(CANCELLED)되면 다시 배정을 요청해야 하므로 미래 레포트의 **"배정 요청 필요"**로 센다 ("배정 요청중"·"배정 실패"와 섞지 않음).
- **이유**: 화면이 보고 있는 시점과 레포트 시점이 어긋나면(2주 뒤를 보는데 다음 주 숫자) 운영자가 잘못된 정보로 판단한다. 취소된 청소를 무시하면 청소자 없이 퇴실일을 맞게 된다.
- **버린 대안**: 지난주/이번 주/다음 주 3단계로 뭉개기(±4일 임계값) — 2주 이상 넘기면 틀린 기간이 표시됨.
- **구현**: `src/domain/periodDomain.js`(기간 규칙), `reportingDomain.getPeriodRange`, `reportingService`(요약·미래 판정), `api/stats`·`api/stats/drilldown`(기간 허용), `PropertyListView`·`PropertyDetailView`·`ReportPanel`. 테스트: `tests/unit/s49.period-offsets.test.js`.

## [D-004] alert() → Toast 교체
- **결정**: `window.Toast` 전역 객체로 모든 alert 대체
- **이유**: 보안 감사 지적 + UX 개선. textContent로 XSS 차단.
- **구현 위치**: `src/utils/toast.js`

## [D-005] 라이트 테마 전환
- **결정**: 전체 색상 CSS 토큰 기반 라이트 테마 (`src/styles/main.css`)
- **이유**: 사용자 요청 — "가시성과 직관성이 부족해보임"
- **폰트**: Nunito + DM Sans + DM Mono
- **다크 색상 절대 재사용 금지**: `#02080d`, `#030f18`, `#0a1f2e`, `#00d4ff`, `#00ff88`

## [D-006] Node.js 내장 테스트 러너
- **결정**: Jest/Vitest 대신 `node:test` (Node.js 22 내장)
- **이유**: 의존성 없음. CI에서 `npm test`로 바로 실행.
- **실행**: `npm test` → `node --test tests/unit/*.test.js tests/functional/*.test.js`
- **저장 폴더 격리 (2026-09-19)**: 감시 프로그램(`server/occupancyWatcher.js`)·숙소 저장소(`server/propertiesStore.js`)는 `PROPOS_DATA_DIR`로 저장 폴더를 바꾼다. 이 모듈을 쓰는 테스트는 `tests/helpers/isolateDataDir.js`를 **가장 먼저** import 한다 — 안 그러면 테스트가 실제 `data/monitoring-*.json`(운영 중 감시 기록)을 덮어쓴다. `tests/unit/s50.test-data-isolation.test.js`가 강제한다.

## [D-008] Vite + src 단일 소스 오브 트루스
- **결정**: Vite 빌드 시스템 채택. `src/`가 정본. `dist/`는 빌드 산출물.
- **이유**: ESM import/export, HMR, 정상적인 빌드 파이프라인 필요.
- **배포 흐름**: `src/` 수정 → `npm run build` → `dist/` 자동 생성
- **버린 대안**: 단일 HTML 수동 편집 → 규모 커지면서 유지 불가

## [D-009] Config 공개/비공개 분리
- **결정**: 브라우저 공개 설정(`src/config/publicConfig.js`)과 Node 비공개 설정(`src/config/privateConfig.js`)을 분리
- **이유**: 정적 프런트 번들에 HA 토큰을 포함하면 민감정보가 그대로 노출됨
- **버린 대안**: 단일 config 파일에 토큰 포함 → 번들 노출 위험

## [D-011] HA 토큰 git 제외
- **결정**: `src/config/propos.config.json`을 `.gitignore`에 추가, git untrack
- **이유**: HA Long-Lived Access Token이 평문으로 포함됨 — git 히스토리에 남으면 안 됨
- **운영**: 로컬 파일(`src/config/propos.config.json`) 또는 환경변수(`PROPOS_HA_BASE_URL`, `PROPOS_HA_WS_URL`, `PROPOS_HA_TOKEN`)로 주입, 브라우저는 `src/config/propos.public.json`만 번들에 포함
- **재검토**: Vercel 환경변수로 전환 시 이 파일 구조 전면 교체

## [D-012] 브라우저 직접 HA 호출 금지
- **결정**: 브라우저는 Home Assistant를 직접 호출하지 않고 `/api/ha/*`만 사용
- **이유**: 토큰 노출 방지, 배포 환경별 보안 경계 일관화, UI 로직과 HA 인증 분리
- **구현 위치**: `src/infrastructure/haBrowserClient.js`, `server/haProxy.js`, `api/ha/*`
- **버린 대안**: 브라우저 번들에서 Bearer 토큰으로 HA REST/WebSocket 직접 호출

## [D-014] 데이터 저장 계층 분리 (2026-08-04 확정)
- **결정**: Vercel Postgres(진실 원천) + KV(캐시) + Blob(스냅샷 첨부) 3계층 분리
- **이유**: 히스토리 추적성·무결성 확보. 각 저장소를 특성에 맞게 사용.
- **설계 정본**: `docs/data-storage-design.md`
- **핵심 규칙**:
  - 쓰기 순서 고정: Postgres → KV → Blob → Slack
  - `@vercel/*` 패키지는 `api/` 폴더에서만 import (`src/` 금지 — Vite 빌드 오류)
  - `PROPOS_SLACK_WEBHOOK` 포함 모든 저장소 자격증명은 Vercel 환경변수만
  - 이벤트 타입 정본: `src/config/eventTypes.js` (Pi + Vercel 공유)
  - device_time = 표시·비즈니스 기준 / server_time = 삽입 순서 보장용
- **버린 대안**: Supabase 별도 도입 → Vercel 내장 스토리지로 충분
- **버린 대안**: Pi JSON 파일만 → Pi 장애 시 히스토리 접근 불가

## [D-010] 시나리오 레지스트리 경량화
- **결정**: `docs/scenarios.yaml`에 `entry_function` 추가, `content_keys` 제거
- **이유**: content_keys는 다이어그램/소스와 3중 중복이었고 기계 검증 없음. entry_function은 verify:scenarios가 source + diagram 양쪽 검증.
- **버린 대안**: s0X-interface-definitions / s0X-module-boundary 10개 파일 → 삭제
- **버린 대안**: docs/scenario-index.md + generate-scenario-index.mjs → 삭제

---

## 역사 섹션 (폐기된 결정 — 재제안 금지)

## [D-001] ~~단일 HTML 배포~~ → 폐기 (D-008로 대체)
- **당시 결정**: 빌드 없이 `index.html` 1개로 배포 (Netlify Drop)
- **폐기 이유**: Vite + src 구조(D-008)로 전환하면서 더 이상 유효하지 않음
- **현재**: `npm run build`로 `dist/` 생성, Netlify/Vercel에 배포

## [D-002] ~~Babel standalone CDN~~ → 폐기 (D-008로 대체)
- **당시 결정**: `<script type="text/babel">` 방식으로 브라우저 내 트랜스파일
- **폐기 이유**: Vite + @vitejs/plugin-react 채택으로 빌드 타임 트랜스파일로 전환
- **현재**: 표준 JSX, ESM import/export 사용 가능

## [D-003] ~~CSP 메타태그 제거~~ → 역사 기록
- **당시 결정**: Netlify Drop에서 CDN 차단으로 CSP 메타태그 삭제
- **현재**: Vite 빌드 + Netlify/Vercel 배포에서는 서버 헤더로 CSP 설정 가능
- **재검토**: Vercel 프로덕션 전환 시 `vercel.json`에서 CSP 설정 추가 예정

## [D-007] ~~개발/배포 분리 수동 구조~~ → 폐기 (D-008로 대체)
- **당시 결정**: `src/` 편집 후 `dist/index.html`에 수동 인라인 반영
- **폐기 이유**: Vite 도입으로 빌드가 자동화됨

## [D-013] 뷰 페르소나 구분 (2026-07-11 확정)
- **결정**: Admin 뷰(구 v1)와 PropertyManager 뷰(구 v2/rsm)를 별도 페르소나로 분리
- **Admin 뷰**: 시스템 장애 모니터링. CommandCenter, HomeAssistant, OperationsPortal. **유지 여부 미결정.**
- **PropertyManager 뷰**: 개별 숙소 상태 파악. RoomStateApp → Dashboard/List/Detail. **현재 활성 개발.**
- **버린 대안**: v1/v2 UI 버전 토글로 같은 앱에서 전환 → 페르소나가 다른 것이라 구분이 맞음

---

## 새 결정 추가 템플릿
```
## [D-XXX] 제목
- **결정**:
- **이유**:
- **버린 대안**:
- **재검토 시점**:
```
