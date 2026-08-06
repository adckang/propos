# PROPOS
> Airbnb 숙소 관리 시스템. Vite + React 18. Vercel + 라즈베리파이 + Tailscale.
> 업데이트: 2026-08-06

## 코드 규칙 (절대)
- `innerHTML` 금지 → `textContent` 또는 `escapeHtml()`
- `alert()` / `confirm()` 금지 → `Toast.show()`
- `dist/` 직접 수정 금지 → `npm run build`
- HA 토큰 브라우저 번들 포함 금지 → `/api/ha/*` 프록시만
- entity ID 하드코딩 금지 → `src/config/publicConfig.js`
- iCal URL 소스코드 커밋 금지 → localStorage(`propos_calendar_sync`)만
- 다크 색상 재사용 금지: `#02080d` `#030f18` `#00d4ff` `#00ff88`
- DB/KV/Blob/Slack 자격증명 브라우저 번들 포함 금지 → `api/*` 프록시만
- `@vercel/postgres` `@vercel/kv` `@vercel/blob` → `api/` 폴더에서만 import (`src/` 금지)
- `PROPOS_SLACK_WEBHOOK` 소스코드·git 커밋 금지 → Vercel 환경변수만

## UI 원칙
- 라이트 테마. 한 화면에 최소 정보, 점진적 공개.
- 버튼 = 배경색 + 테두리 + 레이블 반드시 3가지 명시
- 실시간 센싱값은 시각적으로 "살아있는" 느낌
- UI 레이블: 한국어 / 변수·함수명: 영어

## HA 환경
- IP: `192.168.45.76:8123` (mDNS 불안정 → IP 직접 사용)
- 조명: `light.rgbcct_8002` / TV 플러그: `switch.tv_smart_plug_socket_1`
- 브라우저 → `/api/ha/*` → `server/haProxy.js` → HA (브라우저 직접 호출 금지)
- 운영 환경변수: `PROPOS_HA_BASE_URL` `PROPOS_HA_WS_URL` `PROPOS_HA_TOKEN`

## 명령어
```
npm run dev          개발 서버 (port 5173)
npm test             유닛 + 기능 테스트
npm run build        빌드 (dist/ 생성)
npm run verify:all   전체 검증 + 로그
npm run verify:scenarios  시나리오 드리프트 확인
```

## Vercel 배포 현황 (2026-08-06 확정)
- **프로덕션 프로젝트**: `propos-project-v2` (커스텀 도메인 구매, GitHub 자동배포 연결됨)
- **프로덕션 URL**: `www.proposonline.com`
- **주의**: `propos` (propos-henna.vercel.app)는 중복 프로젝트 — 무시할 것
- **배포 성공**: API 함수 17개 → 10개 통합 (Hobby 12함수 한도 해소)
- **API catch-all 구조**:
  - `api/ha/[...slug].js` — state/states/service/history/template
  - `api/cron/[...slug].js` — daily-plan/daily-result
  - `api/monitoring/[...slug].js` — config/state
  - `api/events/[...slug].js` — history/:uuid
- **환경변수** (`propos-project-v2`에 모두 설정 완료):
  - `POSTGRES_URL` — Neon Postgres (`neon-violet-park`)
  - `KV_REST_API_URL` + `KV_REST_API_TOKEN` — Upstash KV (`upstash-kv-coral-ridge`)
  - `PROPOS_SLACK_WEBHOOK` — Slack 인커밍 웹훅 (설정 완료)
  - `CRON_SECRET` — 크론 외부 호출 차단 (미설정 → 추가 필요)
- **크론 스케줄**: 매일 UTC 23:00 (KST 08:00) 브리핑 / UTC 13:00 (KST 22:00) 결산
- **Slack 알림**: 정상 작동 확인 (2026-08-06)
