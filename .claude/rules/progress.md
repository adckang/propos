# Project Progress

> 현재 어디까지 왔는지 Claude가 빠르게 파악하기 위한 파일.
> **작업 완료 후 반드시 업데이트할 것.**

---

## 현재 상태
- **버전**: v0.6 (UC-003 완성 + TDD 146개 통과)
- **배포**: Netlify Drop (dist/index.html)
- **업데이트**: 2026-04-03

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

## 진행 중
없음

## 다음 작업 (우선순위 순)

### 🔜 UC-004: 체크아웃 & 청소 자동화
> 시나리오: 퇴실 감지 → PIN 만료 → 청소팀 자동 배정 → 체크리스트

핵심 자동화:
- [ ] 퇴실 감지 (체크아웃 시간 + 도어락 이벤트)
- [ ] 5초 이내 PIN 즉시 만료 처리
- [ ] 청소팀 자동 배정 알림
- [ ] 청소 체크리스트 생성

### 🔜 HA CORS 설정 (사용자 직접)
- HA configuration.yaml에 추가 필요:
  ```yaml
  http:
    cors_allowed_origins:
      - http://localhost:8080
  ```
- 설정 후 HA 재시작 → HA 연동 모드 테스트

### 🔜 M5: 프로덕션 전환
- [ ] Vercel 배포 + 도메인 설정
- [ ] 환경변수로 HA 주소/토큰 관리
- [ ] 실제 숙소 데이터 연결 (목업 → 실제)

### 🔜 M6: AI 기능
- [ ] 게스트 메시지 AI 번역 (다국어)
- [ ] AI 답장 초안 생성
- [ ] AI 가격 최적화 실제 구현

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
