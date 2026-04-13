# PROPOS

## Source Of Truth

- `src/` is the single source of truth.
- `dist/` is a generated build output.
- `docs/scenarios.yaml` is the canonical mapping between system pages, scenarios, code, diagrams, and tests.
- Do not edit files inside `dist/` directly.
- Use `npm run dev` for local development.
- Use `npm run build` to regenerate `dist/`.

## Current Rules

1. `src`를 단일 소스 오브 트루스로 유지합니다.
2. Vite 엔트리와 `package.json`을 기준으로 앱을 실행합니다.
3. 단일 HTML 전용 패턴(`GLOBAL_CSS` 등)은 `src` 모듈 구조로 정리합니다.
4. 스타일 기준은 `src/styles/main.css`입니다.
5. `dist/`는 빌드 결과물로만 다룹니다.

## Scenario Registry

- `docs/scenarios.yaml` keeps the canonical mapping: system pages → scenarios → component → diagram → service (with `entry_function`) → domain modules → tests.
- `docs/content-guide.md` keeps the UI wording rules consistent across pages.

## Guard Rails

- 커밋 전 `.githooks/pre-commit`이 `npm run sync:dist`를 실행합니다.
- `dist`는 항상 `src`에서 다시 빌드된 결과만 스테이징됩니다.
- CI는 `npm run verify:scenarios`로 시나리오 레지스트리, 다이어그램, 서비스 엔트리 함수, 테스트의 연결 상태를 검증합니다.
- CI는 `npm run verify:dist`로 `dist`가 `src`와 동기화되어 있는지 검증합니다.
- CI는 Playwright 스모크 테스트로 핵심 화면 진입과 런타임 오류를 확인합니다.

## HA Security Boundary

- 브라우저는 Home Assistant를 직접 호출하지 않습니다.
- 프런트는 `/api/ha/*`만 호출하고, HA 토큰은 서버 측 `src/config/privateConfig.js`에서만 읽습니다.
- 공개 설정은 `src/config/propos.public.json`만 사용합니다.
- 비공개 설정은 `src/config/propos.config.json` 또는 환경변수 `PROPOS_HA_BASE_URL`, `PROPOS_HA_WS_URL`, `PROPOS_HA_TOKEN`으로 주입합니다.
- 실제 배포에서 이 구조를 쓰려면 서버리스/API 실행 환경이 필요합니다. 현재 기준 권장 배포는 Vercel입니다.

## Vercel Deployment

- `vercel.json` 에서 `dist/`를 정적 출력물로 지정하고, SPA 경로는 `index.html`로 rewrite 합니다.
- `/api/ha/*` 응답에는 `Cache-Control: no-store`를 적용해 상태 조회 응답이 캐시되지 않도록 합니다.
- Vercel 프로젝트 환경변수에 `PROPOS_HA_BASE_URL`, `PROPOS_HA_WS_URL`, `PROPOS_HA_TOKEN`을 등록하면 운영 프록시가 바로 같은 경계를 사용합니다.
- 환경변수 템플릿은 `.env.vercel.example`에 정리되어 있습니다.
- 배포 준비 검증은 `npm run verify:deploy`로 실행합니다.

## Useful Commands

- `npm run dev`
- `npm run build`
- `npm run verify:scenarios`
- `npm run verify:dist`
- `npm run test`
- `npm run test:smoke`
- `npm run verify:all`

## Verification Results

- `npm run verify:all` runs the full verification chain in one command.
- Latest results are always written to `artifacts/verification/latest/`.
- Each run is also stored in `artifacts/verification/history/<timestamp>/`.
- Start with `artifacts/verification/latest/summary.md`, then open the matching `*.log` file if a step failed.
