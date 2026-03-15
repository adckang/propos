# Design Decisions

> 이미 검토하고 버린 선택지를 Claude가 다시 제안하는 것을 방지.

## [D-001] 단일 HTML 배포
- **결정**: 빌드 없이 `index.html` 1개로 배포
- **이유**: Netlify Drop 단순성. 빌드 환경 세팅 불필요.
- **버린 대안**: Vercel + Next.js → 데모 단계에서 오버엔지니어링
- **재검토**: 실제 HA API 연동 시 Vercel 전환 예정

## [D-002] Babel standalone CDN
- **결정**: `<script type="text/babel">` 방식 유지
- **이유**: 빌드 없이 JSX 사용 가능. 단일 HTML 유지.
- **트레이드오프**: 런타임 트랜스파일로 초기 로딩 약간 느림

## [D-003] CSP 메타태그 제거 ⚠️ 되돌리지 말 것
- **결정**: Content-Security-Policy 메타태그 완전 삭제
- **이유**: Netlify Drop에서 cdnjs.cloudflare.com CDN 차단 발생
- **버린 대안**: `_headers` 파일 → Netlify Drop 방식과 호환 안 됨
- **프로덕션 대응**: Vercel 전환 시 `vercel.json`에서 헤더 설정

## [D-004] alert() → Toast 교체
- **결정**: `window.Toast` 전역 객체로 모든 alert 대체
- **이유**: 보안 감사 지적 + UX 개선. textContent로 XSS 차단.
- **구현 위치**: `src/utils/toast.js`

## [D-005] 라이트 테마 전환
- **결정**: 전체 색상 CSS 토큰 기반 라이트 테마
- **이유**: 사용자 요청 — "가시성과 직관성이 부족해보임"
- **폰트**: Rajdhani/JetBrains → Nunito + DM Sans + DM Mono
- **다크 색상 절대 재사용 금지**: `#02080d`, `#030f18`, `#0a1f2e`, `#00d4ff`, `#00ff88`

## [D-006] Node.js 내장 테스트 러너
- **결정**: Jest/Vitest 대신 `node:test` (Node.js 22 내장)
- **이유**: npm install 없이 즉시 실행. 의존성 없음.
- **실행**: `node --test tests/unit/domain.test.js tests/security/security.test.js tests/nfr/nfr.test.js`
- **결과**: 184개 테스트 전부 통과

## [D-007] 개발/배포 분리 구조
- **결정**: 개발은 `src/` 파일 분리, 배포는 단일 `dist/index.html`
- **이유**: Netlify Drop 제약 유지 + Claude와 작업 시 파일별 첨부 편의
- **Babel 제약**: 전역 스코프 공유, import/export 불가

---
## 새 결정 추가 템플릿
```
## [D-XXX] 제목
- **결정**:
- **이유**:
- **버린 대안**:
- **재검토 시점**:
```
