# Architecture Rules

## 소스 오브 트루스
- `src/` 가 단일 소스 오브 트루스.
- `dist/` 는 `npm run build` 결과물. **직접 수정 금지.**
- 변경 흐름: `src/` 수정 → `npm run build` → `dist/` 갱신

## 컴포넌트 구조 원칙
- `App.jsx`: 라우터 역할만. 비즈니스 로직 없음.
- `HomeAssistant.jsx`: 개별 숙소 1개. 5단계 타임라인 스테퍼 (`HA_STAGES`).
- `CommandCenter.jsx`: 전체 관제. 파이프라인 뷰 (`CC_STAGES`). ALL_PROPS 데이터 사용.
- 시나리오 패널(`D1AutomationPanel`, `S02~S05`): 각 UC의 UI + 이벤트 처리.
- 새 컴포넌트는 `src/components/`에 위치.

## 레이어 규칙
- `src/domain/`: 순수 함수만. 부작용(API 호출, setState) 없음.
- `src/application/`: 서비스 레이어. 도메인 함수 조합 + 외부 의존성 주입(`deps` 패턴).
- `src/infrastructure/`: HA REST / WebSocket 클라이언트. 외부 시스템 어댑터.
- `src/config/publicConfig.js`: 브라우저 공개 설정. 토큰 포함 금지.
- `src/config/privateConfig.js`: Node 전용 비공개 설정 로더. HA 토큰은 여기서만 읽기.

## 시나리오 추적성 (삼박자 싱크)
- `docs/scenarios.yaml`: 각 시나리오의 `entry_function` 필드가 정본.
- `npm run verify:scenarios`: service 파일 + diagram 파일 양쪽에 entry_function 존재 검증.
- 새 시나리오 추가 시 scenarios.yaml → service → diagram → functional_test 네 곳 동시 업데이트.

## 배포 흐름
```
src/ 수정
  → npm run build
  → dist/ 갱신 (자동 — 직접 편집 금지)
  → npm run verify:dist 로 동기화 확인
  → 배포 (Netlify / Vercel)
```

## 금지 패턴
- `innerHTML`에 사용자 입력 직접 삽입 금지 → `textContent` 또는 `escapeHtml()` 사용
- `alert()` / `confirm()` 사용 금지 → `Toast.show()` 사용
- `dist/` 직접 수정 금지
- 다크 테마 색상값 재사용 금지 (`#02080d`, `#030f18`, `#0a1f2e`, `#00d4ff`, `#00ff88`)
- entity ID 하드코딩 금지 → `src/config/publicConfig.js`에서 참조
- HA 토큰을 브라우저 번들에 포함하지 말 것 → Node 코드는 `src/config/privateConfig.js`, 브라우저는 런타임 토큰만 사용
