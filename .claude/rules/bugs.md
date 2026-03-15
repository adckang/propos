# Bug History

> 수정한 버그를 Claude가 다시 만들지 않도록 기록.

## [B-001] Netlify Drop 404 ✅
- **현상**: 폴더째 업로드 시 Page not found
- **원인**: Netlify Drop은 루트에 index.html 없으면 404
- **수정**: 파일 1개(`index.html`)만 업로드
- **재발 방지**: 폴더 업로드 절대 금지

## [B-002] 로컬 더블클릭 검은 화면 ✅ (해결책 확인)
- **현상**: index.html 파일을 브라우저에서 직접 열면 빈 화면
- **원인**: `file://` 프로토콜에서 CORS로 CDN 스크립트 차단
- **해결**: `python -m http.server 8080` 또는 VSCode Live Server 필수
- **재발 방지**: 로컬 개발 시 항상 HTTP 서버 사용

## [B-003] Babel 콘솔 경고 ✅
- **현상**: "You are using the in-browser Babel transformer" 경고
- **수정**: `console.warn` 필터로 억제 완료 (`dist/index.html` 상단)
- **재발 방지**: 해당 필터 코드 건드리지 말 것

## [B-004] XSS 취약점 ✅
- **현상**: 사용자 입력을 innerHTML에 직접 삽입
- **수정**: `escapeHtml()` 적용, Toast는 `textContent` 사용
- **재발 방지**: `innerHTML`에 동적 값 삽입 절대 금지

## [B-005] CSP + CDN 충돌 ✅
- **현상**: CSP 메타태그로 React/Babel CDN 차단
- **수정**: CSP 메타태그 완전 제거 (D-003 참고)
- **재발 방지**: CSP 메타태그 다시 추가하지 말 것

## [B-006] CommandCenter chat 상태 초기화 (낮은 우선순위)
- **현상**: 숙소 클릭 시 chat 초기화 (`setChat([])` 호출)
- **영향**: 목업 단계라 실제 영향 없음
- **예정**: 실제 메시지 API 연동 시 재설계

---
## 새 버그 추가 템플릿
```
## [B-XXX] 제목 (✅ 완료 / ⚠️ 진행중 / 🔜 예정)
- **현상**:
- **원인**:
- **수정**:
- **재발 방지**:
```
