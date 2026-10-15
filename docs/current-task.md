# Current Task
> 세션 시작 시 읽는다. 세션 끝날 때 업데이트한다.
> 업데이트: 2026-10-15 | 숙소 이름 변경 FK 결함 수정(D-032) — 운영 DB 적용 완료, 커밋 전

## 목표
로컬과 운영이 동일한 Postgres 정본을 사용하고, 실제 예약 입력·청소 배정 상태가 화면에 동일하게 보이는지 검증한다.
실제 예약 원본은 서버 `POST /api/cleaning/ical-sync`가 읽고, 화면은 `GET /api/cleaning/properties`를 읽는다.

## 핵심 경계 파일
```
src/components/v2/RoomStateApp.jsx
src/components/v2/CleaningManager.jsx
api/cleaning/[...slug].js
api/properties.js
server/propertiesStore.js
vite.config.mjs
docs/data-architecture-and-simulator.md
```

## 수정 금지
`src/components/App.jsx` `src/components/v1/*` `docs/scenarios.yaml` `.claude/rules/decisions.md` `dist/`

## Decided
| 결정 | 내용 |
|------|------|
| 예약 입력 | 서버 `POST /api/cleaning/ical-sync` 단일 경로. 브라우저가 iCal을 직접 읽지 않는다. |
| 정본 저장 | Postgres `property_cleaning_config`·`property_reservations`·`cleaning_jobs` |
| Pi 역할 | `/api/properties`는 `id/name/district/watcherId/devices` 워처 메타데이터만 저장·전달 |
| 로컬/운영 | 기본 `HYBRID` 프로필과 동일한 `/api/cleaning/*` DB 핸들러 사용 |
| 싱크 주기 | 마운트 1회 + 15분 인터벌 |
| 데이터 구분 | 숙소·하위 행의 `data_origin` (`REAL`/`SIMULATED`)으로 구분 |

## 검수 결과

- `npm test`: 2,191개 통과
- `npm run build`: 통과
- `npm run test:smoke`: 통과
- `npm run data:check`: 오류 0
- `npm run data:check:db`: 오류 0, 파주201 레거시 작업 경고 15건(추적 보존)
- `docs/data-architecture-and-simulator.md`가 저장 위치·관계·입력 경로·Pi 경계의 상세 정본이다.

## 2026-10-15 정합성 개선 (D-032)
- FK 5개 `ON UPDATE CASCADE` 적용·검증 완료(운영 DB), 복합 FK는 DEFERRABLE
- 레거시 청소 작업 15건 `reservation_uid` 비움 — 원래 uid는 유실(D-032 사고 기록 참고)
- `data:check:db` 경고 15건(REAL_LEGACY_JOB_UID_MISSING)은 의도된 상태
- 아직 커밋·푸시 안 함 (코드/SQL/테스트 변경 있음)

## 싱크 실패 시 디버그 순서
1. DevTools → Network → `POST /api/cleaning/ical-sync` 상태 코드 확인
2. 성공 후 `GET /api/cleaning/properties` 응답에 파주201 `REAL` 행과 예약·청소상태가 있는지 확인
3. `ical_url` 미설정이면 숙소 설정에서 DB 저장 후 재시도
4. Pi가 오프라인이어도 DB 숙소·예약이 표시되는지 확인

## 다음 작업
- [x] 실제 예약 입력·조회 경로를 서버/DB 한 경로로 통합
- [x] Pi를 워처 메타데이터 전용 경계로 정리
- [x] 자동 검수·생성 도구와 소스 계약 테스트 추가
- [x] 관련 MD 문서 갱신 및 변경사항 커밋·푸시
- [ ] 사용자 승인 후 Vercel 운영 배포 및 `proposonline.com` 브라우저 확인

---

## 핸드오프 (에이전트 교체 시)
```
[넘기는 쪽]  git commit → 이 파일 업데이트 → "커밋 완료" 보고
[받는 쪽]    git log --oneline -3 → git diff HEAD~1 → 이 파일 읽기
```
> **완료 여부의 정본은 git log다. 이 파일이 낡아 있어도 커밋이 있으면 완료된 것.**
> 이 파일은 *다음 목표*를 기록하고, git은 *완료된 것*을 기록한다.

범위 밖 파일 건드리지 않는다. Decided 재논의 안 한다. 추가 개선은 제안만.
