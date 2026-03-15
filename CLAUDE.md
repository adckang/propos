# PROPOS — Project Context
> Airbnb 숙소 완전 관리 시스템. 관리자 1명 → 100개+ 숙소 + IoT 자동화.
> 업데이트: 2026-03-15

## 인프라 (확정)
- 라즈베리파이 + Home Assistant + Tailscale VPN (외부 접속 완료)
- 배포: Netlify Drop — **파일명 반드시 `index.html`**
- 목표: Vercel(웹) + 라즈베리파이(IoT 허브) 하이브리드

## UI/UX 원칙 (절대 준수)
- 라이트 테마 유지 — 다크 색상(#02080d, #030f18 등) 재사용 금지
- 한 화면에 정보 최소화, 점진적 공개
- 버튼 = 배경색 + 테두리 + 레이블 반드시 3가지 명시
- 실시간 센싱값은 시각적으로 "살아있는" 느낌
- 많이 보여줄 때 = Left→Right, Top→Bottom

## 코드 규칙
- 보안: `innerHTML` 금지, 사용자 입력은 반드시 `textContent` 또는 `escapeHtml()`
- 알림: `alert()` 금지, 반드시 `Toast.show()` 사용
- CSP 메타태그 추가 금지 (Netlify Drop에서 CDN 차단됨, D-003 참고)
- 언어: UI 레이블 한국어, 변수/함수명 영어

## 변경 금지 사항
| 항목 | 결정 | 이유 |
|------|------|------|
| CSP 헤더 | 제거 상태 유지 | Netlify Drop CDN 차단 |
| Babel | standalone CDN | 빌드 없는 단일 HTML |
| alert() | Toast로 대체 | XSS 방지 |
| 다크 테마 | 라이트 전환 완료 | 가시성 원칙 |

## 파일 구조
```
propos/
├── CLAUDE.md                  ← 이 파일 (자동 로드)
├── .claude/
│   ├── CLAUDE.md              ← 상세 컨텍스트 (@import 대상)
│   └── rules/
│       ├── architecture.md    ← 컴포넌트 구조 + 의존성
│       ├── decisions.md       ← 설계 결정 이유 (왜 이렇게 만들었나)
│       ├── bugs.md            ← 버그 이력 (재발 방지)
│       └── progress.md        ← 현재 상태 + 다음 작업
├── dist/index.html            ← 배포 파일 (Netlify에 올리는 것)
└── src/
    ├── data/mockData.js
    ├── styles/main.css
    ├── components/
    │   ├── App.jsx
    │   ├── HomeAssistant.jsx
    │   └── CommandCenter.jsx
    └── utils/toast.js
```

## 완료된 작업
- [x] 라이트 테마 (CSS 토큰 아키텍처)
- [x] XSS 방어 + Toast UI
- [x] Babel 경고 억제
- [x] 184개 테스트 통과
- [x] 홍보 홈페이지 (시나리오 5단계, 경쟁사 비교)
- [x] 파일 분리 (src/ 구조)
- [x] docs 체계 구축

## 다음 작업
- [ ] Home Assistant API 실제 연동 (라즈베리파이)
- [ ] Vercel 프로덕션 배포 + 도메인
- [ ] 실제 숙소 데이터 연결 (현재 전부 목업)
- [ ] AI 답장 초안 기능

## 알려진 이슈 (빠른 참조)
| 이슈 | 해결책 |
|------|--------|
| Netlify 404 | 폴더 X → `index.html` 파일 1개만 업로드 |
| 로컬 검은 화면 | `python -m http.server 8080` 또는 VSCode Live Server |
| Babel 경고 | console.warn 필터로 억제 완료 (건드리지 말 것) |

---
상세 내용: @.claude/CLAUDE.md
