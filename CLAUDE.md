# PROPOS — Project Context
> Airbnb 숙소 완전 관리 시스템. 관리자 1명 → 100개+ 숙소 + IoT 자동화.
> 업데이트: 2026-04-13

## 인프라 (확정)
- 라즈베리파이 + Home Assistant + Tailscale VPN (외부 접속 완료)
- 프런트엔드: Vite + React
- 소스 오브 트루스: `src/`
- 빌드 산출물: `dist/`
- 목표: Vercel(웹) + 라즈베리파이(IoT 허브) 하이브리드

## UI/UX 원칙 (절대 준수)
- 라이트 테마 유지
- 한 화면에 정보 최소화, 점진적 공개
- 버튼 = 배경색 + 테두리 + 레이블 반드시 3가지 명시
- 실시간 센싱값은 시각적으로 "살아있는" 느낌
- 많이 보여줄 때 = Left→Right, Top→Bottom
- 시스템 페이지는 시나리오 1~5를 시간축으로 요약해야 함

## 코드 규칙
- 보안: `innerHTML` 금지, 사용자 입력은 반드시 `textContent` 또는 `escapeHtml()`
- 알림: `alert()` 금지, 반드시 `Toast.show()` 사용
- 언어: UI 레이블 한국어, 변수/함수명 영어
- `dist/` 직접 수정 금지

## 정본 계층
| 계층 | 파일 | 역할 |
|------|------|------|
| 시나리오 레지스트리 | `docs/scenarios.yaml` | 컴포넌트·다이어그램·서비스·테스트 연결의 단일 정본 |
| 워딩 기준 | `docs/content-guide.md` | UI 텍스트 일관성 규칙 |
| 빌드 결과물 | `dist/` | `src/` 빌드 파생물, 직접 수정 금지 |

## 파일 구조
```text
propos/
├── CLAUDE.md
├── docs/
│   ├── scenarios.yaml       ← 시나리오 레지스트리 (정본)
│   ├── content-guide.md     ← 워딩 규칙
│   └── ui-test-guide.md
├── myPlantUML/              ← 시퀀스 다이어그램 (scenarios.yaml이 참조)
├── scripts/
├── src/
│   ├── application/         ← 서비스 레이어 (entry_function이 여기 있음)
│   ├── components/
│   ├── config/              ← 공개/비공개 설정 분리
│   ├── domain/              ← 도메인 순수 함수
│   ├── infrastructure/      ← 브라우저/서버 HA 어댑터
│   ├── styles/
│   └── utils/
├── api/                     ← 서버리스 HA 프록시 엔드포인트
├── server/                  ← HA 프록시 공용 서버 코드
├── tests/
└── dist/
```

## 완료된 작업
- [x] Vite 전환 + `src` 단일 소스 오브 트루스화
- [x] Playwright 스모크 테스트
- [x] 시나리오 레지스트리 도입 (`scenarios.yaml` + `verify:scenarios`)
- [x] 중복 규칙 문서 제거 (s0X-interface-definitions, s0X-module-boundary 10개)
- [x] verify에 서비스 엔트리 함수 검증 추가 (`entry_function`)
- [x] Storybook 제거 (CI 중복, 유지 가치 없음)
- [x] 문서 전면 갱신 (CLAUDE.md, architecture.md, decisions.md, progress.md)
- [x] 브라우저 직접 HA 호출 제거, `/api/ha/*` 프록시 경유 구조 도입
- [x] Node 비공개 설정에 환경변수 우선 오버라이드 지원 (`PROPOS_HA_*`)
- [x] Vercel 배포 설정 파일 추가 (`vercel.json`, SPA rewrite + `/api/ha/*` no-store)

## 다음 작업
- [ ] Vercel 프로젝트 환경변수 주입 후 `/api/ha/*` 실배포 확인
- [ ] 실제 숙소 데이터 연결
- [ ] Vercel 프로덕션 배포

## 운영 명령
- 개발 서버: `npm run dev`
- 시나리오 드리프트 검증: `npm run verify:scenarios`
- 배포 준비 검증: `npm run verify:deploy`
- 빌드: `npm run build`
- 스모크 테스트: `npm run test:smoke`
- 유닛/기능 테스트: `npm test`

## 알려진 이슈
| 이슈 | 해결책 |
|------|--------|
| `dist` 직접 수정 | 금지. `src` 수정 후 `npm run build` |
| 시나리오 드리프트 | `npm run verify:scenarios` |

---
상세 내용: @.claude/CLAUDE.md
