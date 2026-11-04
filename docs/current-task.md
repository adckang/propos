# Current Task
> 세션 시작 시 읽는다. 세션 끝날 때 업데이트한다.
> 업데이트: 2026-11-04 | 예약 청소 시각 기반 상세·리스트 타임라인 및 담당자 연결 검수

## 현재 진행: 더미 테스트와 Google/DB 청소 시각 정합성

사용자가 두 잔여 문제의 해결을 승인했다. 이번 범위는 테스트 시계 고정과 실제 Google 예약의 청소 시각 반영이다.

- 기존 테스트 실패 5개는 9월 조회와 실행 당일 기준으로 생성된 예약 fixture가 어긋난 결과였다. s54/s56/s70에서 import 전 Date 시계를 조회 기준일로 고정했다. 빈 결과의 합계끼리 비교해 통과하지 않도록 s70의 표본 존재도 확인한다. 운영 데이터 생성 방식은 변경하지 않았다.
- Google 배정 처리(Webhook/Scan/수동 iCal 복구)가 참석자·이벤트 ID만 저장하던 것이 시간 차이의 원인이었다. `calendarCleaningTimes`가 시간대가 명시된 예약의 시작·종료를 정규화하고, 취소/종일/블로커/잘못된 시각/퇴실 전 시작을 제외한다.
- 세 경로에서 `cleaning_start_at`·`cleaning_end_at`을 원본에 맞춘다. 이미 연결된 배정은 같은 담당자·이벤트만 시간 갱신할 수 있고, 완료 등으로 상태가 바뀐 행을 덮어쓰지 않는다. 시간만 갱신할 때 배정 알림은 재발송하지 않는다. 수동 복구는 Google 페이지 전체를 읽고 유일한 대응만 반영하며 재실행은 멱등이다.
- 운영 파주201 21건을 실제 Google 이벤트와 대조했다. 모두 퇴실 11:00, 예약 청소 12:00~15:00이며 다음 입실과 충돌하지 않았다. 트랜잭션으로 청소 시작·종료와 `updated_at`만 정정했고, 담당자·이벤트·상태·퇴실 키·예약은 보존했다. Google 쓰기·알림 발송은 0건이다.
- 최종 `npm test`: 2,493/2,493 통과. s89는 실제 Postgres 임시 테이블에서 실제 API SQL의 타입·제약·반복 실행·중복 알림 방지·동시 완료 보존을 검증하며 4개 통과했다. s85는 정정 후 실제 DB·Google 원본 2개 테스트에서 21건의 담당자·이벤트 ID·시작·종료 일치를 확인했다. 빌드·`verify:deploy`·`verify:scenarios`·`git diff --check` 통과.
- UTC·America/Los_Angeles 환경에서도 관련 166개씩 통과했다. 기존 데이터 검수기의 fixture는 오류·경고 0건, 실제 DB는 오류 0건이며 기존 `REAL_LEGACY_JOB_UID_MISSING` 경고 15건만 유지한다.
- 후속 사용자 승인: 상세 타임라인도 11~12시 대기 / 12~15시 진행으로 맞추도록 요청받았다. `reservationCleaningWindow`를 현재 상태·현재 타임라인·미래 타임라인이 공유한다. 청소 중 새로고침해도 예약 종료 시각을 보존하고, 종료와 같은 시각의 다음 입실을 포함한다.
- 분할·클리핑 이후에도 `cleaningCheckoutAt`으로 원래 예약을 찾아 담당자를 표시한다. 대기 구간과 진행 구간에 담당자 인디케이터를 중복 표시하지 않고, 명시된 퇴실 키가 없을 때만 기존 최근 퇴실 폴백을 허용한다.
- 공통 구간 계산의 영향 검토에서 리스트의 Gantt 병합이 진행 구간을 대기 색상으로 덮는 문제를 재현했다. 같은 하위 상태끼리만 병합하도록 조건 한 개를 보완하고 실제 병합 함수를 실행하는 회귀 테스트를 추가했다.
- s90 회귀 테스트: 예약 시각, 현재·과거·미래 구간, 대기/진행 경계, 입실 경계, 잘못된 시각의 기본 동작, 중복 UID, 담당자 연결을 실제 함수로 검수한다. 실제 DB 응답을 사용한 데스크톱 1440px/모바일 390px × 10:00/11:30/14:30의 6개 브라우저 시나리오에서 청소 막대와 담당자 표시를 확인했다. 실제 API 쓰기는 차단했고 화면 오류는 0건이다.
- 타임라인 수정 후 최종 전체 테스트 2,510/2,510 통과. UTC·America/Los_Angeles에서 관련 37개씩 통과했고 fixture 검수 오류·경고 0건, 빌드·배포 설정·시나리오 계약 검사도 통과했다. 이번 타임라인 수정은 DB·Google에 쓰지 않는다.
- 현재 코드 커밋·운영 배포 여부는 git log와 Vercel에서 확인한다. 검수 중인 로컬 변경을 배포 완료로 간주하지 않는다.

시간 정정 변경 전 사본: `/private/tmp/propos-cleaning-time-plan-1793781603836.json` (0600). 이 파일과 임시 진단/적용 스크립트는 커밋하지 않는다. 적용은 완료됐으며 재실행하지 않는다.

## 앞선 완료 작업: 파주201 담당자 이름 복구

사용자 요청은 담당자 미정 문제의 원인 확인 → TC/수정/리뷰 → 실제 해결 검증 → 문제 없으면 푸시다.
아래 과거 작업 기록의 완료 여부는 git log로 확인한다. 이번 작업은 `f166cfc`에서 시작했으며, 코드 배포의 최종 SHA·상태는 git log와 Vercel을 기준으로 확인한다.

- 복구 전 운영 DB: REAL 파주201 청소 작업 33건 중 ASSIGNED 21건 모두 `assigned_cleaner_id=NULL`. Google 이벤트 ID는 21건 모두 존재했다.
- 실제 Google Calendar 원본 조회에 성공했다. 프로젝트 로컬 메모에 있던 별도 Calendar 자격증명을 메모리에서만 사용했으며, 토큰 값은 출력·커밋하지 않았고 환경변수도 변경하지 않았다.
- 해당 기간 원본 80건을 조회했고 다음 페이지는 없었다. 누락 21건의 참석자 이메일은 등록된 어떤 담당자 이메일과도 일치하지 않았다. 일정 제목의 이름은 DB의 최유정 담당자 한 명과 일치한다. 같은 이름/예약 이메일의 원본 26건 중 22건은 본문 전화번호도 DB와 일치한다.
- 원인: 담당자 등록 이메일과 실제 예약 이메일이 다르므로, 기존 이메일 기반 복구 함수가 21건을 모두 건너뛴다. 로컬 OAuth 실패나 참석자 순서만으로 이 현상을 설명한 앞선 추정은 원인 확정 근거가 아니었다.
- 실제 `repairCalendarAssignments` 함수를 원본 데이터와 메모리 DB로 재실행: 정정 전 이메일이면 0건, 해당 담당자 이메일 한 건을 원본 주소로 정정한 입력이면 21건 모두 유일하게 복구됨을 사전 검증했다.
- 이벤트 ID 20건은 원본과 동일하다. 2026-10-08의 기존 ID는 Google 개별 조회에서 `cancelled`였고, 같은 날짜에 현재 유효한 예약 이벤트가 한 건 있다.
- 기존 로컬 수정: `RoomStateApp`/`CleaningManager`가 `assignmentRepair.error`를 성공으로 표시하지 않도록 처리. 예약 새로고침과 Pi 설정 전달은 유지한다. 이는 이메일 불일치 자체를 해결하는 변경은 아니다.
- TC: 실제 이름은 같지만 이메일이 다른 사례를 s87에 반영. 관련 67개 통과. 전체 테스트 재실행은 2,470개 중 2,465개 통과, 기존 실패 5개(s54/s56의 demo fixture 기대값). 같은 실패를 수정 전 HEAD에서도 재현했으며 이번 범위에서 수정하지 않는다.

적용 및 검증 결과:
1. 사용자에게 실제 이메일 변경 전후와 대상 21건의 날짜, 10월 8일 이벤트 교체를 설명하고 명시적으로 승인을 받았다.
2. Google/DB를 재조회해 승인된 복구안과 동일함을 확인한 뒤, 이메일 1건과 담당자 연결 21건을 하나의 트랜잭션으로 정정했다. 10월 8일 이벤트 ID만 현재 유효한 예약으로 교체했다. 시간·상태·예약은 보존했고 Google 쓰기·알림 발송은 0건이다.
3. s85 실DB 테스트 통과: ASSIGNED 21건 모두 담당자 ID와 이름이 존재하며 누락 0건. 실제 `listProperties`/`getCleaningStats` 함수를 읽기 전용 DB로 실행해 조회된 배정 예약 14행과 10월 배정 9건 모두 이름을 확인했다.
4. 배포 빌드의 상세 타임라인을 데스크톱(1440px)/모바일(390px)에서 실제 API 응답으로 검증했다. 복구 전 입력은 `담당자 미정`, 복구 후 입력은 `최유정`으로 표시됐고 화면 오류는 0건이었다. API 쓰기 요청은 격리했으므로 이 검수로 동기화·알림이 실행되지 않았다. 운영 로그인 세션을 이용한 원격 UI 검증과는 구분한다.
5. 빌드·`verify:deploy`·`verify:scenarios`·`git diff --check` 통과. 코드와 배포의 최종 반영 상태는 해당 커밋의 Vercel READY 및 `proposonline.com` 별칭으로 확인한다.

당시 별도 검토 사항: 담당자 연결 복구에서는 시간 차이를 보존했다. 이후 위 후속 작업에서 별도 승인을 받아 Google 원본 12:00~15:00로 청소 시각을 정정했다.

진단용 임시 스크립트: `/private/tmp/propos-calendar-diagnostic.mjs` (기본 읽기 전용). 민감한 로컬 메모와 환경변수를 저장소에 추가하지 않는다.

실제 적용에 사용한 변경 전 사본은 권한 0600의 로컬 파일 `/private/tmp/propos-assignment-confirmed-plan-1793777333227.json`에 보존했다. 이 파일은 연락처를 포함하므로 커밋하거나 출력하지 않는다.
적용 스크립트 `/private/tmp/propos-apply-confirmed-assignment-repair.mjs` 실행은 완료됐다. 동일 복구를 재실행하지 않는다. 결과 화면은 `/private/tmp/propos-assignment-restored-390.png`, `/private/tmp/propos-assignment-restored-1440.png`에 있다.

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

## 2026-10-15 운영자 로그인 (D-033)
- 코드 배포 완료 시 `PROPOS_AUTH_MODE` 기본 off → 동작 변화 없음. 켜는 법·남은 노출은 D-033 참고
- 운영자 작업 필요: Vercel 환경변수 3개 설정 후 log → enforce

## 2026-10-15 다중 운영자 (D-034)
- 코드·테스트 완료, 독립 리뷰 반영, **운영 DB에 `operators`·`operator_properties` 적용 완료**, ERD 갱신 완료
- 운영자 화면이 관리자 전용 API 를 부르면 403 — 운영자 계정으로 화면 end-to-end 확인과 403 조용히 처리 필요

## 2026-10-16 운영자 스마트홈·CCTV (D-035)
- 운영자에게 자기 숙소의 스마트홈(보기+제어)·모니터링·CCTV를 숙소 범위로 열었다 — 코드·테스트 완료
- ⚠️ 운영자 화면에는 기기별 켜기/끄기 UI가 없어 사실상 보기 전용(서버는 기기별 제어 허용). 도어락 등 기기 제어는 열려 있고 `script/automation/scene`만 기본 차단 — `OPERATOR_BLOCKED_DOMAINS`

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
