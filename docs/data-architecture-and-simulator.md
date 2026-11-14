# PROPOS 데이터 아키텍처와 검수 시뮬레이터

## 운영 기준

운영 주소는 `https://proposonline.com`이다. 로컬 Vite와 Vercel 운영은 서로 다른 데이터 모드가 아니라 같은 `HYBRID` 계약을 사용한다.

- `REAL`: 현재는 숙소 `파주201` 하나. Airbnb iCal 예약 원본과 Google Calendar 연결을 사용한다.
- `SIMULATED`: 가상 숙소. REAL과 같은 테이블·키·관계·추적 필드를 사용하고, 숙소 설정의 `data_origin`으로만 구분한다.
- `DEMO`: 코드 fixture만 사용하는 명시적 테스트 프로필. 운영/일반 로컬의 기본값이 아니다.

## 저장 위치와 정본

| 영역 | 저장 위치 | 정본 여부 |
| --- | --- | --- |
| 숙소 설정 | Postgres `property_cleaning_config` | 정본 |
| 예약 원본 | Postgres `property_reservations` | 정본. REAL은 `AIRBNB_ICAL` |
| 청소 일정 | Postgres `cleaning_jobs` | 정본 |
| 청소 알림 | Postgres `cleaning_notifs` | 청소작업의 하위 추적 기록 |
| 캘린더 블로커 | Postgres `property_calendar_blockers` | Google Calendar 부수 상태 |
| 센서/자동화 이벤트 | Postgres `events` | 이벤트 원장 |
| 청소자 | Postgres `cleaners` | 전역 작업자 마스터 |
| 화면 캐시 | 브라우저 localStorage / Pi 설정 | 정본 아님 |
| 로컬 API | Vite가 동일한 Vercel handler를 동적 호출 | DB 어댑터 |
| 운영 API | Vercel serverless `/api/*` | Postgres 조회·갱신 |

## 실제 데이터 입력·조회 경로

예약 원본을 읽고 화면에 반영하는 경로는 하나다.

1. `POST /api/cleaning/ical-sync`가 `property_cleaning_config.ical_url`을 서버에서 읽는다.
2. 서버가 파싱한 예약을 `property_reservations`에 upsert하고, 체크아웃별 `cleaning_jobs`를 만든다.
3. 화면의 `runSync`와 청소 관리의 수동 동기화 버튼은 모두 위 API를 호출한다.
4. 화면은 이어서 `GET /api/cleaning/properties`를 읽어 예약·배정 상태를 렌더링한다. 브라우저가 Airbnb/Google iCal을 직접 파싱하거나 별도 예약 캐시를 만들지 않는다.

Gmail Watch와 Google Calendar 연동은 신규 예약 감지·블로커 보조 트리거일 뿐, 화면의 예약 정본을 대체하지 않는다. 동기화 실패 시 기존 Postgres 행을 임의로 삭제하거나 `미배정`으로 재생성하지 않는다.

청소 배정의 담당자와 확정 시작·종료 시각은 Google 예약 이벤트를 원본으로 삼아 `cleaning_jobs`에 반영한다. `checkout_at`은 Airbnb 숙박 예약의 퇴실 키로 보존한다. 예를 들어 퇴실 11:00에 청소 예약이 12:00~15:00이면, `checkout_at`은 11:00이고 `cleaning_start_at`·`cleaning_end_at`은 각각 12:00·15:00이다. 배정 전 기본 청소시간과 확정 예약 시각을 혼동해 퇴실 키를 변경하지 않는다.

현재 상태 예측과 상세·리스트의 청소 구간 계산도 같은 예약의 `cleaningAt`·`cleaningEnd`를 우선한다. 위 사례는 11:00~12:00 대기, 12:00~15:00 진행으로 표시한다. `cleaningCheckoutAt`은 화면 세그먼트에 보존하는 원래 퇴실 키이며 DB의 키를 변경하지 않는다. 대기/진행 분할·현재 시각 클리핑 후에도 그 예약의 담당자를 찾고 인디케이터는 진행 구간에 한 번만 표시한다. 이 계약은 s90에서 실제 함수와 담당자 매핑을 실행해 검수한다.

## Raspberry Pi의 책임 경계

Pi의 `/api/properties`와 `data/properties-config.json`은 Home Assistant 워처용 `id`, `name`, `district`, `watcherId`, `devices`만 저장한다. 예약, iCal URL, 청소작업은 저장하지 않는다.

- 운영 Vercel의 `/api/properties`는 Pi 워처 메타데이터 프록시다.
- 로컬 Vite도 같은 `api/properties.js` 핸들러를 사용하므로 라우팅 의미가 다르지 않다.
- 운영·로컬의 실제 예약 조회는 항상 Postgres `/api/cleaning/*`를 사용한다.
- Pi가 연결되지 않아도 DB의 파주201 예약과 청소 배정은 화면에 표시되어야 하며, Pi 메타데이터가 없을 때는 HA 제어/센서 기능만 제한된다.

환경별 `POSTGRES_URL`이 같은 DB를 가리키면 로컬·운영은 동일한 행을 본다. `.env.local`과 Vercel 환경변수는 저장소에 커밋하지 않는다.

## 관계 모델

```text
property_cleaning_config (property_id, data_origin)
  ├─< property_reservations (property_id, reservation_uid)
  │     └─< cleaning_jobs (property_id, reservation_uid, checkout_at)
  │           └─< cleaning_notifs (job_id, cleaner_id)
  ├─< property_calendar_blockers (property_id, block_date)
  └─< events (property_id, device_time)

cleaners (id) ─┬─< cleaning_jobs.assigned_cleaner_id
               └─< cleaning_notifs.cleaner_id
```

핵심 키와 무결성 규칙:

1. 예약은 `(property_id, reservation_uid)`가 유일하다.
2. 청소작업은 `(property_id, checkout_at)`가 유일하다.
3. 이벤트는 `(property_id, type, device_time)`가 유일하다.
4. 예약은 `check_out > check_in`이어야 한다.
5. 청소 시작은 체크아웃보다 빠를 수 없고 종료는 시작보다 늦어야 한다.
6. 하위 행의 `data_origin`은 숙소의 `data_origin`과 같아야 한다.
7. SIMULATED 청소작업은 반드시 SIMULATED 예약과 연결돼야 한다.
8. 현재 iCal 창에 없는 REAL 과거 작업은 삭제·추측 연결하지 않고 `legacy:cleaning_job:<id>`로 추적한다.
9. 배정된 청소자와 알림은 각각 `cleaners`, `cleaning_jobs`에 존재해야 하며, 알림의 `data_origin`은 연결된 작업과 같아야 한다.
10. 작업·이벤트·블로커·알림의 중복 키와 알림 token 중복을 검수한다.

담당자를 참조하는 데이터셋은 대상 `cleaners` 목록을 함께 제공한다. 목록이 비어 있거나 생략된 경우에도 참조 검사를 수행한다. 존재하지 않는 작업 담당자는 `JOB_CLEANER_MISSING`, 알림 담당자는 `NOTIF_CLEANER_MISSING`으로 판정한다. 과거 기록이 비활성 담당자를 가리키는 관계는 유효하다. 이 규칙은 REAL·SIMULATED에 동일하게 적용한다.

## 파주201 검수 결과

2026-10-12 초기 검수 당시 파주201의 구성은 다음과 같았다. 이 절의 건수는 당시 스냅샷이며 최신 운영 상태를 뜻하지 않는다.

- 숙소 1개, `data_origin=REAL`, `source_system=AIRBNB_ICAL`, `source_ref=ical:파주201`
- 현재 iCal 예약 15건
- REAL 청소작업 30건
- 현재 예약과 매칭된 작업 15건
- iCal에서 사라진 과거/레거시 미매칭 작업 14건과 미래 레거시 작업 1건
- 미매칭 작업은 모두 source_ref가 있어 추적 가능하며 임의의 예약을 만들지 않는다.

당시 예약 15건에 연결된 청소 상태는 `PENDING 10건`, `ESCALATED 5건`이어서 배정 완료로 임의 표시하지 않았다. 리스트에서 보이는 과거 `ASSIGNED` 작업은 조회 중인 예약과 다른 레거시 작업 범위일 수 있으므로 화면 범위를 구분해 해석해야 한다.

2026-11-04 담당자 연결 복구 검수:

- 청소 작업 33건 중 ASSIGNED 21건은 Google 이벤트 ID가 있었지만 담당자 ID가 비어 있었다. 원본 참석자 이메일과 `cleaners.email` 불일치가 원인이었다.
- Google 원본의 이름·예약 이메일과 전화번호 근거를 대조하고 사용자 승인을 받아 담당자 이메일 1건 및 기존 배정 21건의 담당자 연결을 정정했다. 10월 8일은 취소된 이벤트 참조를 현재 유효한 이벤트 ID로 교체했다.
- 복구 후 실DB 검수에서 담당자 ID/이름 누락은 0건이다. 실제 API 함수와 운영 DB를 연결한 검수에서 10월 배정 9건 모두 이름을 반환했다. 같은 응답을 사용한 데스크톱·모바일 상세 타임라인에서도 이름을 확인했다.
- 담당자 연결 복구 시점에는 배정 상태·일시·예약을 변경하지 않았다. 이후 시간 정합성 후속 작업에서 사용자 승인에 따라 21건의 청소 시각만 Google 원본 12:00~15:00로 정정했고 퇴실 11:00과 기존 관계를 보존했다.
- `google_event_id` 존재만으로 화면의 담당자 이름까지 보장되지는 않는다. `cleaning_jobs.assigned_cleaner_id → cleaners.id` 연결과 Google 예약 이메일 일치도 검수해야 한다. `RUN_LIVE_DB=1 node --test tests/integration/s85.real-cleaner-assignment.test.js`가 담당자 연결 누락을 실패로 판정한다.

시간 정합성 검수는 다음 경계를 포함한다.

- Webhook·수동 Scan·iCal 담당자 복구가 모두 같은 `calendarCleaningTimes` 검증을 사용한다. 시간대가 없는 시각, 종일 이벤트, 취소·블로커, 종료 역전, 퇴실 전 시작은 반영하지 않는다. 날짜 매칭은 KST 기준이다.
- 기존 배정의 시각 갱신은 저장된 이벤트 ID·담당자와 일치할 때만 허용한다. 담당자 누락 복구에서 후보가 여럿이면 추측하지 않는다. 반복 동기화는 같은 값을 다시 쓰지 않으며 시간만 갱신할 때 배정 알림을 재발송하지 않는다.
- `s88.calendar-cleaning-times.test.js`는 실제 API 함수에 가짜 I/O를 주입해 원본 시각 반영·잘못된 입력 거부·연결 보존을 검수한다.
- `s89.calendar-cleaning-times.test.js`는 `CLEANING_TEST_DATABASE_URL`의 격리 loopback PostgreSQL 또는 `PGLITE_TEST_ROOT`의 PGlite에서 실제 스키마·UPDATE SQL·중복 실행·동시 완료 보존을 검증한다. 실행은 해당 환경변수를 지정한 `node --test tests/integration/s89.calendar-cleaning-times.test.js`이며, fixture가 임시 저장소의 생성·종료 정리를 담당한다.
- 유효한 Calendar 자격증명이 있는 실행 환경에서 `RUN_LIVE_DB=1 RUN_LIVE_GOOGLE=1 node --test tests/integration/s85.real-cleaner-assignment.test.js`를 실행하면 실제 배정과 Google 원본의 담당자·이벤트 ID·시작·종료 일치까지 검수한다. 토큰은 실행 환경에만 설정하며 커밋하지 않는다.

## 자동 검수·생성 도구

검수 코어는 외부 패키지가 없는 `src/data/dataSimulator.js`다. DB 모드만 기존 프로젝트의 `pg`를 어댑터로 사용한다.

```bash
# 코드 fixture 검수
npm run data:check

# synthetic 데이터 생성·검수
node scripts/data-simulator.mjs generate --synthetic \
  --property-count 5 --reservations-per-property 8 \
  --out /tmp/propos-sim.json

# JSON 행 집합 재검수
node scripts/data-simulator.mjs check --file /tmp/propos-sim.json

# 현재 DB 읽기 전용 검수
npm run data:check:db

# 레거시 warning도 실패로 처리
node scripts/data-simulator.mjs check-db --strict
```

출력은 `PASS/FAIL`, origin별 건수, 오류 코드, warning 코드로 구성된다. 생성기는 결정적 seed를 사용하므로 같은 입력을 반복해도 같은 UID와 이벤트 키를 만들며, 생성 직후 같은 검수기를 통과시킨다.

`check-db`의 기본 모드는 운영을 막지 않는 오류 기준이다. `--strict`는 경고도 실패로 처리하므로, 현재처럼 과거 REAL 레거시 작업을 보존해야 하는 운영 DB에서는 기본 검수와 별도로 이력 정리 완료 여부를 판단하는 QA 게이트로 사용한다.

`scripts/seed-simulated-data.mjs`는 `property_cleaning_config`, `property_reservations`, `cleaning_jobs`, `events`만 비파괴 upsert한다. `cleaning_notifs`는 배정 발송 과정에서 생성되므로 seed 대상이 아니다. 기존 SIMULATED 잔여 행을 삭제하지 않으며, 대상 숙소 ID·이름이 REAL 또는 다른 숙소와 충돌하면 DB 저장을 시작하지 않고 중단한다.


### seed 트랜잭션과 담당자 관계 검수 · 2026-11-14

seed는 `pool.connect()`로 얻은 한 연결에서 사전 충돌 검사와 전체 upsert를 실행한다. 실패 시 같은 연결에서 롤백하고, 롤백 실패 연결은 폐기한다. dry-run은 DB 연결을 열지 않는다. 실제 CLI를 호출하는 단위·격리 SQL s121에서 중간 실패 복구·반복 저장·REAL 보존을 검증한다.

[RF-05.2 감사](refactoring.md#rf05-assignment-relations)에서 SIMULATED 배정의 담당자 목록·FK 저장 공백과 가상 Google ID가 이를 가리는 검수 공백을 확인했다. 현재 기본 검수 PASS는 이 필수 관계까지 검증됐다는 뜻이 아니다. 생성·검수·seed의 동시 보완은 RF-05.4의 다음 작업이며, 이번 연결 수정으로 기존 운영 데이터를 바꾸지 않았다.
