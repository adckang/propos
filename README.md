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

## Useful Commands

- `npm run dev`
- `npm run build`
- `npm run verify:scenarios`
- `npm run verify:dist`
- `npm run test`
- `npm run test:smoke`
