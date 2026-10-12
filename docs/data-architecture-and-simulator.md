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

## 파주201 검수 결과

현재 DB에서 파주201의 구성은 다음과 같다.

- 숙소 1개, `data_origin=REAL`, `source_system=AIRBNB_ICAL`, `source_ref=ical:파주201`
- 현재 iCal 예약 15건
- REAL 청소작업 30건
- 현재 예약과 매칭된 작업 15건
- iCal에서 사라진 과거/레거시 미매칭 작업 14건과 미래 레거시 작업 1건
- 미매칭 작업은 모두 source_ref가 있어 추적 가능하며 임의의 예약을 만들지 않는다.

현재 예약 15건에 연결된 청소 상태가 `PENDING 10건`, `ESCALATED 5건`이므로, 배정 완료로 임의 표시하지 않는 것이 원본 기준으로 맞다. 리스트에서 보이는 과거 `ASSIGNED` 작업은 현재 예약과 다른 레거시 작업 범위일 수 있으므로 화면 범위를 구분해 해석해야 한다.

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
