# Architecture Rules

## 컴포넌트 구조 원칙
- `App.jsx`: 라우터 역할만. 비즈니스 로직 없음.
- `HomeAssistant.jsx`: 개별 숙소 1개 관리. BOOKING/DEVICES_INIT 데이터 사용.
- `CommandCenter.jsx`: 전체 관제. ALL_PROPS 데이터 사용. PCard/LRow/DetailPanel 내부 정의.
- 새 컴포넌트 추가 시 `src/components/`에 위치.

## 단일 HTML 번들 규칙
- Babel standalone 사용 → ES module `import/export` 사용 불가
- 모든 변수/함수는 전역 스코프 공유 (window 객체)
- 파일 분리는 개발 편의용. **배포는 반드시 단일 `dist/index.html`**
- 새 기능 개발 → `src/components/` 수정 → `dist/index.html`에 수동 반영

## 배포 흐름
```
src/ 파일 수정
  → dist/index.html에 변경사항 인라인 반영
  → index.html 1개 파일을 Netlify Drop에 업로드
```

## 금지 패턴
- `innerHTML`에 사용자 입력 직접 삽입 금지
- `alert()` / `confirm()` 사용 금지 → `Toast.show()` 사용
- CSP 메타태그 추가 금지
- 다크 테마 색상값 재사용 금지
