# PROPOS — 상세 컨텍스트
> 업데이트: 2026-04-13

## 프로젝트 배경
에어비앤비 숙소 관리 시스템. 한국 서비스 우선.
- 운영 주체: 관리자 단 1명
- 운영 규모: 수십~수백 개 숙소 동시 운영
- 목표: 체크인→정산 전 과정 완전 자동화

## 기술 스택 (현재)
- 프레임워크: Vite + React 18
- 소스 오브 트루스: `src/`
- 빌드 산출물: `dist/` (`npm run build`)
- 폰트: Nunito(제목) + DM Sans(본문) + DM Mono(숫자/코드)
- IoT: Home Assistant REST API + 상태 폴링 기반 이벤트 감지
- 인프라: Vercel 배포 전환 준비 완료 + Tailscale VPN + 라즈베리파이

## 핵심 시나리오 5단계
| # | 시나리오 | 핵심 자동화 |
|---|----------|------------|
| 01 | 체크인 전날 | PIN 자동 발급, 웰컴 메시지, 스마트홈 초기화 |
| 02 | 체크인 당일 | 비대면 입실, IoT 씬 자동 실행, 채팅 오픈 |
| 03 | 체류 중 | 온도·습도·소음·전력 LIVE 센싱, 이상 감지, AI 답장 |
| 04 | 체크아웃 & 청소 | 5초 내 PIN 만료, 청소팀 자동 배정, 체크리스트 |
| 05 | 수익 정산 | 멀티플랫폼 통합, AI 가격 최적화(+18%), 세금 리포트 |

## 소스 구조
```
src/
├── application/          ← 서비스 레이어 (entry_function이 여기 있음)
│   ├── checkinPreparationService.js  (runD1Automation)
│   ├── checkinService.js             (handleDoorUnlocked)
│   ├── monitoringService.js          (pollSensors)
│   ├── checkoutService.js            (handleCheckout)
│   └── settlementService.js          (runMonthlySettlement)
├── components/
│   ├── App.jsx           ← 라우터 + 랜딩 (비즈니스 로직 없음)
│   ├── HomeAssistant.jsx ← 개별 숙소 (5단계 타임라인 스테퍼)
│   ├── CommandCenter.jsx ← 전체 관제 (파이프라인 뷰)
│   ├── D1AutomationPanel.jsx
│   ├── S02CheckinPanel.jsx
│   ├── S03MonitoringPanel.jsx
│   ├── S04CheckoutPanel.jsx
│   └── S05RevenuePanel.jsx
├── config/
│   ├── publicConfig.js    ← 브라우저 공개 설정
│   ├── privateConfig.js   ← Node 전용 비공개 설정 로더
│   ├── propos.public.json ← 공개 설정 정본
│   └── propos.config.json.example ← 로컬 비공개 설정 예시
├── domain/               ← 순수 함수 (부작용 없음)
│   ├── bookingDomain.js
│   ├── checkinDomain.js
│   ├── checkoutDomain.js
│   ├── messageDomain.js
│   ├── pinDomain.js
│   ├── revenueDomain.js
│   └── sensorDomain.js
├── infrastructure/
│   ├── haBrowserClient.js   ← 브라우저 → /api/ha 프록시 클라이언트
│   ├── haBrowserPolling.js  ← 브라우저 상태 폴링
│   ├── haClient.js          ← Node 서버측 HA REST 클라이언트
│   └── haWebSocket.js       ← HA WebSocket 어댑터 (테스트/레거시 검증용)
├── api/
│   └── ha/               ← 서버리스 HA 프록시 엔드포인트
├── server/
│   ├── haProxy.js        ← HA 직접 호출 공용 코드
│   └── haApiHandlers.js  ← dev/preview/API 공용 핸들러
├── vercel.json           ← SPA rewrite + API 캐시 제어
├── styles/
│   └── main.css          ← CSS 토큰 정의
└── utils/
    ├── settlementSchedule.js
    └── toast.js
```

## 정본 계층
| 계층 | 파일 | 역할 |
|------|------|------|
| 시나리오 레지스트리 | `docs/scenarios.yaml` | 컴포넌트·다이어그램·서비스 entry_function·테스트 연결의 단일 정본 |
| 워딩 기준 | `docs/content-guide.md` | UI 텍스트 일관성 규칙 |
| 시퀀스 다이어그램 | `myPlantUML/*.uml` | 시나리오별 동작 흐름 (scenarios.yaml이 참조) |
| 빌드 결과물 | `dist/` | `src/` 빌드 파생물, 직접 수정 금지 |

## CSS 토큰 (src/styles/main.css)
```css
--bg:#f0f4f8        /* 앱 배경 */
--surface:#ffffff   /* 카드/패널 */
--blue:#2563eb      /* 주 액션, 활성 상태 */
--green:#059669     /* 정상/완료/수익+ */
--red:#dc2626       /* 긴급/에러/비용 */
--yellow:#d97706    /* 경고/대기 */
```

## HA 환경 정보
- HA IP: `192.168.45.76:8123` (mDNS 불안정 → IP 직접 사용)
- HA 버전: 2025.12.4
- TV방 기기: `light.rgbcct_8002` / `switch.tv_smart_plug_socket_1`
- 브라우저 공개 설정: `src/config/publicConfig.js`
- Node 비공개 설정: `src/config/privateConfig.js`
- 브라우저는 HA를 직접 호출하지 않고 `/api/ha/*`만 호출
- 운영 배포는 환경변수 `PROPOS_HA_BASE_URL`, `PROPOS_HA_WS_URL`, `PROPOS_HA_TOKEN` 우선 사용

## 세션 시작 체크리스트
```
□ CLAUDE.md 읽었는가?
□ docs/scenarios.yaml에서 관련 시나리오 확인했는가?
□ .claude/rules/decisions.md 변경 금지 항목 확인했는가?
□ 배포 경계 작업이면 npm run verify:deploy 필요 여부 확인했는가?
□ 완료 후 progress.md 업데이트 요청할 것
```
