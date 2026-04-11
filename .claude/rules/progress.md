# Project Progress

> 현재 어디까지 왔는지 Claude가 빠르게 파악하기 위한 파일.
> **작업 완료 후 반드시 업데이트할 것.**

---

## 현재 상태
- **버전**: v0.9 (Config 중앙화 + 미구현 항목 분석)
- **배포**: Netlify Drop (dist/index.html)
- **업데이트**: 2026-04-10

## 완료된 마일스톤

### ✅ M1: 기본 UI (2026-03-08)
- HomeAssistant: 현황/체크인아웃/스마트홈/메시지/청소/수익 탭
- CommandCenter: 48개 숙소 그리드+리스트, 상세 패널, 실시간 알림 피드
- Landing: 2개 카드 라우터

### ✅ M2: 보안 + 배포 (2026-03-09~10)
- Netlify Drop 배포 (index.html 단일 파일)
- 보안 5개 이슈 수정 (XSS, alert, CSP)
- TDD 184개 테스트 통과
- 명세 문서 작성

### ✅ M3: 라이트 테마 + 홈페이지 (2026-03-13~15)
- 다크→라이트 테마 (CSS 토큰)
- 홍보 홈페이지 (시나리오 5단계, 경쟁사 비교표, 기술 아키텍처)
- 파일 분리 (src/ 구조)
- .claude/ 문서 체계 구축

### ✅ M4: UC-001 D-1 자동화 완성 (2026-03-27 ~ 2026-04-02)
- `src/infrastructure/haClient.js` — 실제 HA REST API 클라이언트
- `src/components/D1AutomationPanel.jsx` — UC-001 전체 UI
- Home Assistant 실제 연동 (TV방: light.rgbcct_8002 + switch.tv_smart_plug_socket_1)
- PIN 발급 → HA persistent_notification 대체 (도어락 없음)
- 웰컴 메시지 → HA persistent_notification 대체 (메시지 채널 없음)
- Mock ↔ HA 모드 전환 토글
- 18:00 카운트다운 + 자동 트리거 (useEffect + ranAtZero ref)
- 알림 ACK 버튼 (개별 / 전체 확인)
- PIN 유효기간 표시 (체크인 -1h ~ 체크아웃)
- 웰컴 메시지 미리보기 (접기/펼치기)
- 스마트홈 씬 상세 표시
- **Airbnb iCal URL 파싱** (allorigins.win CORS 프록시)
  - `_ical.fetchViaProxy()` → `_ical.parse()` → `_ical.toBookings()`
  - 숙소별 iCal URL + WiFi + 체크인/아웃 시간 설정 UI (⚙ 설정 탭)
  - localStorage에 설정 저장 (`propos_prop_configs` 키)
  - 실데이터 / 목업 데이터 자동 전환 + 데이터 소스 뱃지 표시
- dist/index.html 동기화 완료

### ✅ M5: UC-002 체크인 당일 자동화 (2026-04-02)
- `.claude/rules/s02-module-boundary.md` — 모듈 경계 정의
- `.claude/rules/s02-interface-definitions.md` — 인터페이스 정의
- `src/domain/checkinDomain.js` — isCheckinEvent, getCheckinWindow
- `src/domain/messageDomain.js` — buildCheckinConfirmMessage, buildPinLockoutAlert 추가
- `src/application/checkinService.js` — handleDoorUnlocked, handlePinLockout
- `tests/unit/s02.domain.test.js` — 34개 통과
- `tests/functional/s02.functional.test.js` — TC-F-011~023, 27개 통과 (TC-F-023: haEvent.time 누락 fallback 버그 수정 검증 포함)
- `src/components/S02CheckinPanel.jsx` — 이벤트 시뮬레이터 + 숙소 상태 뱃지 + 알림 피드
- `dist/index.html` 동기화 + 랜딩 UC-002 카드 추가
- 버그 수정 2건: handleEvent try/finally 누락, buildCheckinConfirmMessage unguarded call
- **전체 테스트 112개 통과 (fail 0)**

### ✅ M6: UC-003 체류 중 모니터링 (2026-04-03)
- `.claude/rules/s03-module-boundary.md` — 모듈 경계 정의 (완료)
- `.claude/rules/s03-interface-definitions.md` — 인터페이스 정의 (완료)
- `src/domain/sensorDomain.js` — isAnomaly, buildAnomalyAlert, getDefaultThresholds
- `src/domain/messageDomain.js` — buildReplyDraft 추가 (키워드 매칭 4종)
- `src/application/monitoringService.js` — pollSensors, pollAll, handleGuestMessage
- `tests/unit/s03.domain.test.js` — 35개 통과
- `tests/functional/s03.functional.test.js` — TC-F-024~036, 19개 통과
- `src/components/S03MonitoringPanel.jsx` — 센서 LIVE 카드, 이상 감지 알림, AI 답장 초안, 폴링 ON/OFF 토글, Mock/HA 모드 전환
- `dist/index.html` 동기화 + 랜딩 UC-003 카드 추가
- **전체 테스트 146개 통과 (fail 0)**

### ✅ M7: UC-004 체크아웃 & 청소 자동화 (2026-04-03)
- `.claude/rules/s04-module-boundary.md` — 모듈 경계 정의
- `.claude/rules/s04-interface-definitions.md` — 인터페이스 정의
- `src/domain/checkoutDomain.js` — isCheckoutEvent, getCheckoutWindow, assignCleaner, buildChecklist, buildCheckoutAlert, buildCleanerAssignAlert
- `src/domain/messageDomain.js` — buildCheckoutThankYouMessage 추가
- `src/application/checkoutService.js` — handleCheckout, completeChecklistItem, finalizeClean
- `tests/unit/s04.domain.test.js` — 52개 통과
- `tests/functional/s04.functional.test.js` — TC-F-037~054, 25개 통과
- `src/components/S04CheckoutPanel.jsx` — 이벤트 시뮬레이터 + PIN 만료 카운트다운 + 청소팀 배정 카드 + 체크리스트 + Mock/HA 모드 전환
- `dist/index.html` 동기화 + 랜딩 UC-004 카드 추가
- 버그 수정 1건: UTC vs 로컬 타임 불일치 (`getUTCHours` → `getHours`)
- **전체 테스트 243개 통과 (fail 0)**

### ✅ M8: UC-005 수익 정산 자동화 (2026-04-04)
- `.claude/rules/s05-module-boundary.md` — 모듈 경계 정의
- `.claude/rules/s05-interface-definitions.md` — 인터페이스 정의
- `src/domain/revenueDomain.js` — aggregateRevenue, calcTax, getPricingRecommendations, 알림 텍스트 함수 6개
- `src/application/settlementService.js` — runMonthlySettlement, applyPricingRecommendations, fetchWithRetry
- `tests/unit/s05.domain.test.js` — 61개 통과
- `tests/functional/s05.functional.test.js` — TC-F-055~065, 38개 통과
- `src/components/S05RevenuePanel.jsx` — 진행 단계 표시, 플랫폼별 수익 카드, AI 가격 최적화 체크박스, 세금 리포트, 알림 피드, API 오류 시뮬 토글
- `dist/index.html` 동기화 + 랜딩 UC-005 카드 추가
- **전체 테스트 342개 통과 (fail 0)**

## 진행 중
없음

---

## ✅ M9: Config 중앙화 (2026-04-10)
- `src/config/propos.config.js` 신규 생성 — 전체 설정 단일 파일 관리
- `src/infrastructure/haClient.js` → config require로 변경 (IP/토큰/entity 하드코딩 제거)
- `src/infrastructure/haWebSocket.js` → config require로 변경
- `src/components/{D1,S02,S03,S04}Panel.jsx` → `PROPOS_CONFIG` 전역 참조로 변경
- `dist/index.html`:
  - PROPOS_CONFIG 설정 블록 신규 추가 (파일 최상단 `<script>` 섹션)
  - IP/토큰/entity ID → 모두 PROPOS_CONFIG 단일 블록으로 통합
  - S02 WebSocket 중복 하드코딩 제거
  - S03 센서 임계값 → PROPOS_CONFIG.sensorThresholds 참조
  - S03 센서 entity ID → PROPOS_CONFIG.entities 참조 (null이면 스킵)
  - haClient.getSensorStates → noise/power 센서 추가 시 자동 반영 구조

---

## 미구현 항목 — 구현 불가 / 조건부 구현 가능

### ❌ 구현 불가 (외부 의존성 없음)

| UC | 항목 | 이유 | 사용자가 해줘야 할 것 |
|----|------|------|----------------------|
| UC-003 | 소음(noise) 센서 | HA에 연결된 소음 센서 없음 | 소음 센서 구매 후 HA 연동 → `PROPOS_CONFIG.entities.noiseSensor` 입력 |
| UC-003 | 전력(power) 센서 | HA에 연결된 전력 측정기 없음 | 스마트 플러그(전력 측정 지원) 연동 후 entity 입력 |
| UC-001 | 도어락 실제 제어 | 스마트 도어락 HA 연동 없음 | Z-Wave/Zigbee 도어락 구매 → HA에서 `lock.*` entity 생성 |
| UC-002 | Airbnb 메시지 채널 | Airbnb API 미공개 (호스트 전용 API 없음) | 해결책 없음 (현재 HA persistent_notification 대체) |
| UC-005 | Airbnb 수익 API | Airbnb 공개 API 없음 | 해결책 없음 (현재 iCal으로 예약 수만 파악 가능) |
| UC-005 | 야놀자 수익 API | 야놀자 파트너 API는 기업 계약 필요 | 야놀자 파트너센터 API 계약 후 endpoint 연동 |

### 🔜 구현 가능 (사용자 준비 완료 시 즉시 구현)

| UC | 항목 | 필요한 것 | 예상 작업 |
|----|------|----------|----------|
| UC-001 | iCal 실예약 데이터 | Airbnb 숙소 → 예약 캘린더 → iCal URL 복사 | 설정 탭에 URL 붙여넣기 (이미 UI 있음) |
| UC-003 | 소음/전력 센서 추가 | HA entity_id 알려주기 | `PROPOS_CONFIG.entities.noiseSensor` 입력만으로 자동 반영 |
| UC-001 | 도어락 실제 PIN 등록 | HA `lock.*` entity 생성 | haClient.setLockCode() 이미 구현됨, entity만 연결하면 동작 |
| ALL | HA CORS 설정 | HA configuration.yaml 수정 | HA 외부(Netlify)에서 API 호출 허용 필요 |
| UC-003/005 | AI 답장/가격 최적화 | Claude API key 제공 | API key 있으면 즉시 구현 가능 |

### HA CORS 설정 (필수 — Netlify 배포 시 HA 연동에 필요)
```yaml
# HA configuration.yaml에 추가
http:
  cors_allowed_origins:
    - https://your-netlify-url.netlify.app
    - http://localhost:8080
```

---

## 다음 작업 (우선순위 순)

### 🔜 M10: HA CORS 설정 (사용자 직접)
- HA configuration.yaml 수정 후 HA 재시작
- Netlify URL 또는 Vercel URL 추가

### 🔜 M11: 프로덕션 전환
- [ ] Vercel 배포 + 도메인 설정
- [ ] HA 토큰 갱신 주기 관리 (현재 만료일: 2036년경)
- [ ] 실제 숙소 iCal URL 연결 (현재 전부 목업)

### 🔜 M12: AI 기능 (Claude API key 있을 때)
- [ ] UC-003 게스트 메시지 AI 답장 (Claude API)
- [ ] UC-005 AI 가격 최적화 실제 구현 (Claude API)

---

## HA 환경 정보 (실제 연동용)
- HA IP: `192.168.45.76:8123` (mDNS homeassistant.local 불안정 → IP 직접 사용)
- HA 버전: 2025.12.4
- TV방 기기:
  - 조명: `light.rgbcct_8002`
  - TV 플러그: `switch.tv_smart_plug_socket_1`
- 라즈베리파이: USB 허브 전원 불안정 → 전용 5V/3A 어댑터 권장

---
## 업데이트 방법
작업 완료 후:
```
"방금 작업 내용을 progress.md에 반영할 내용 알려줘"
```
