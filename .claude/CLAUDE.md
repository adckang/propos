# PROPOS — 상세 컨텍스트

## 프로젝트 배경
에어비앤비 숙소 관리 시스템. 한국 서비스 우선.
- 운영 주체: 관리자 단 1명
- 운영 규모: 수십~수백 개 숙소 동시 운영
- 목표: 단순 모니터링이 아닌 체크인→정산 전 과정 완전 자동화

## 핵심 시나리오 5단계
| # | 시나리오 | 핵심 자동화 |
|---|----------|------------|
| 01 | 체크인 전날 | PIN 자동 발급, 웰컴 메시지, 스마트홈 초기화 |
| 02 | 체크인 당일 | 비대면 입실, IoT 씬 자동 실행, 채팅 오픈 |
| 03 | 체류 중 | 온도·습도·소음·전력 LIVE 센싱, 이상 감지, AI 답장 |
| 04 | 체크아웃 & 청소 | 5초 내 PIN 만료, 청소팀 자동 배정, 체크리스트 |
| 05 | 수익 정산 | 멀티플랫폼 통합, AI 가격 최적화(+18%), 세금 리포트 |

## 경쟁사 대비 차별화
1. **로컬 IoT 통합**: 라즈베리파이 엣지 컴퓨팅, 인터넷 없이도 동작
2. **5단계 풀 자동화**: 호스트 개입 없이 전 과정 실행 (14시간/월 절감)
3. **100+ 숙소 단일 대시보드**: 엔터프라이즈 스케일

## 기술 스택
- 프론트엔드: React 18 (Babel standalone CDN), 단일 HTML 파일
- 폰트: Nunito(제목) + DM Sans(본문) + DM Mono(숫자/코드)
- IoT: Home Assistant REST API + WebSocket
- 인프라: Netlify(현재) → Vercel(예정) + Tailscale VPN + 라즈베리파이

## 컴포넌트 의존성 맵
```
App.jsx (라우터 + 랜딩)
├── uses: GLOBAL_CSS (main.css 내용을 JS 변수로 인라인)
├── renders: HomeAssistant.jsx
│    └── data: BOOKING, SINGLE_PROP, DEVICES_INIT, CLEANERS, EXPENSES
└── renders: CommandCenter.jsx
     └── data: ALL_PROPS, INIT_ALERTS, AUTO_RULES, CLEANERS, SC, PC
     └── util: Toast (window.Toast)
```

## 중요 데이터 상수 위치 (src/data/mockData.js)
- `ALL_PROPS` — 48개 숙소 목업 (CommandCenter)
- `BOOKING` — 현재 예약 정보 (HomeAssistant)
- `SINGLE_PROP` — 개별 숙소 기본 정보 (HomeAssistant)
- `DEVICES_INIT` — IoT 디바이스 초기값 (HomeAssistant)
- `CLEANERS` — 청소 인력 목록 (공용)
- `SC` — 상태별 컬러 맵 (공용)
- `PC` — 우선순위 컬러 맵 (공용)

## CSS 토큰 (src/styles/main.css)
```css
--bg:#f0f4f8        /* 앱 배경 */
--surface:#ffffff   /* 카드/패널 */
--blue:#2563eb      /* 주 액션, 활성 상태 */
--green:#059669     /* 정상/완료/수익+ */
--red:#dc2626       /* 긴급/에러/비용 */
--yellow:#d97706    /* 경고/대기 */
```

## 세션 시작 체크리스트
```
□ CLAUDE.md 읽었는가?
□ .claude/rules/ 관련 파일 확인했는가?
□ 변경 금지 항목 확인했는가?
□ 작업할 컴포넌트 파일 첨부했는가?
□ 완료 후 해당 rules 파일 업데이트 요청할 것
```
