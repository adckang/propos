# Design Decisions

> 이미 검토하고 버린 선택지를 Claude가 다시 제안하는 것을 방지.

---

## 현재 활성 결정

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
- **운영**: `src/config/propos.config.json.example`을 복사해 실제 토큰 입력 후 사용, 브라우저는 `src/config/propos.public.json`만 번들에 포함
- **재검토**: Vercel 환경변수로 전환 시 이 파일 구조 전면 교체

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

---

## 새 결정 추가 템플릿
```
## [D-XXX] 제목
- **결정**:
- **이유**:
- **버린 대안**:
- **재검토 시점**:
```
