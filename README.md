# PROPOS

## Source Of Truth

- `src/` is the single source of truth.
- `dist/` is a generated build output.
- Do not edit files inside `dist/` directly.
- Use `npm run dev` for local development.
- Use `npm run build` to regenerate `dist/`.

## Current Rules

1. `src`를 단일 소스 오브 트루스로 유지합니다.
2. Vite 엔트리와 `package.json`을 기준으로 앱을 실행합니다.
3. 단일 HTML 전용 패턴(`GLOBAL_CSS` 등)은 `src` 모듈 구조로 정리합니다.
4. 스타일 기준은 `src/styles/main.css`입니다.
5. `dist/`는 빌드 결과물로만 다룹니다.
