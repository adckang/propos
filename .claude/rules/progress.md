# Project Progress

> 현재 어디까지 왔는지 Claude가 빠르게 파악하기 위한 파일.
> **작업 완료 후 반드시 업데이트할 것.**

---

## 현재 상태
- **버전**: v0.4 (UC-001 완성 + iCal 연동)
- **배포**: Netlify Drop (dist/index.html)
- **업데이트**: 2026-04-02

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

## 진행 중
없음

## 다음 작업 (우선순위 순)

### 🔜 UC-002: 체크인 당일 자동화
> 시퀀스 다이어그램: `myPlantUML/propos-scenario02-sequence.uml` (미작성 — 먼저 작성 필요)

핵심 자동화:
- [ ] 입실 감지 (도어락 열림 이벤트 또는 수동 트리거)
- [ ] IoT 씬 자동 실행 (체크인 씬: 조명/에어컨/TV)
- [ ] 게스트 채팅 오픈 (웰컴 채팅 메시지)
- [ ] 관리자 알림 (입실 완료)

구현 순서:
1. 시퀀스 다이어그램 작성 (`.uml` 파일)
2. 모듈 경계 정의 (`.claude/rules/s02-module-boundary.md`)
3. 인터페이스 정의 (`.claude/rules/s02-interface-definitions.md`)
4. `src/components/CheckinDayPanel.jsx` 구현
5. `dist/index.html` 반영

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
