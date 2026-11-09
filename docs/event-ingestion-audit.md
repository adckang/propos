# RF-06 · 이벤트 수신 경로 계약 감사

> 확인일: 2026-11-09 · 감사 기준: `d96e9d4` · 승인 코드 반영: `435f45f` · 상태 관리: [refactoring.md](refactoring.md#sec-02)
>
> **1~6절은 수정 전 읽기 전용 감사 기록**이며, 원인 코드는 `d96e9d4`에서 확인할 수 있다. 감사 당시 운영에는 인증정보 없는 GET 3회만 수행했고 코드·테스트·DB·환경변수·Pi 설정·장치·알림·배포는 변경하지 않았다. 이후 사용자가 우선 문제 해결을 지시해 코드·테스트를 수정했다. 1차 개선은 [7절](#rf-06-implementation), 후속 인증 보완·남은 범위는 [8절](#rf-06-followup), **운영·Pi 반영 완료 결과는 [9절](#rf-06-rollout)**을 따른다. 아래 감사의 ‘재현’은 외부 I/O를 가짜로 대체한 실제 함수 진단이다.

## 1. 사용자 시나리오와 확인 범위

**운영자가 기대하는 동작:** 파주201에서 실제 입실·청소·입실 준비가 발생하면, 로컬·운영 화면이 같은 저장 기록을 사용하고, 중복 전송으로 이벤트나 알림이 늘어나지 않아야 한다. 전송 실패와 준비 실패는 구분돼야 한다.

현재 Pi의 일반 이벤트와 센서 기반 준비 이벤트는 모두 **`/api/events/write`**로 전송한다. 일반 이벤트는 한 번 전송하고, `sensor-v1` 준비 이벤트는 상태 파일의 outbox에 보관한 뒤 성공 응답까지 재전송한다. 소스에서 기본 주소는 비-www이며 승인된 인증 검사는 앞서 canonical www에서 수행했다. 이번 감사에서는 실제 Pi POST의 리다이렉트·헤더 전달을 추가로 검증하지 않았다. [발행 구현](../server/occupancyWatcher.js#L411), [준비 이벤트 전송 계약](pre-stay-optimization.md#L89)

같은 서버 파일에는 별도로 **기본 수신 분기 `/api/events`**가 남아 있다. 두 분기는 같은 INSERT 함수를 사용하지만 같은 처리 파이프라인은 아니다. [수신 구현](../api/events/%5B...slug%5D.js#L54)

확인한 범위는 두 수신 분기, 검증기, 서비스, 저장소, 이벤트 분류, Pi 발행, 보고서 소비, 기존 단위 테스트와 저장 명세다. 실제 DB 내용·제약 적용 상태, 운영 POST 도달성, Slack 실수신, 과거 이벤트 누락 건수와 다른 외부 발행자는 확인하지 않았다. ACT-02·03의 실물/Slack 확인을 기다리는 동안 진행한 독립 감사다.

## 2. 계약 비교

| 계약 | 기본 수신 분기 | 현재 Pi의 `/write` 분기 | 통합할 때 주의할 점 |
| --- | --- | --- | --- |
| 기계 인증 | 분기 안에 secret·로그인 검사 없음 | 설정된 `PROPOS_PI_SECRET`과 요청 헤더 일치 필수 | 기본 분기의 운영 노출 여부와 별개로 코드의 인증 공백을 보완해야 함. Pi 쓰기를 사람 로그인으로 대체하지 않음 |
| 입력 형식 | 호출자 UUID, 알려진 타입, ISO 시각을 Zod로 검증 | UUID는 서버가 생성. 필수 3개 값의 truthy 여부만 검사, 밀리초 시각도 수용 | root 검증기를 그대로 적용하면 정상 구형 Pi 요청도 거절될 수 있음 |
| soft 분류 | 타입 목록에서 결정 | 요청 `is_soft`를 사용, 없으면 false | 누락·불일치 처리 정책을 먼저 정하고 실제 Pi payload와 비교 |
| 중복 키 | `property_id + type + device_time` | 같은 키 | 출처 참조나 새 수신 UUID로 중복 키를 바꾸지 않음 |
| 응답 | 신규 201, 중복 409 | 신규·중복 모두 200, 본문 `inserted/id` | 준비 outbox는 `response.ok`만 보고 제거. 409로 바꾸면 중복 전송이 계속 남을 수 있음 |
| 출처·숙소 유형 | 공통 저장소의 출처 fallback·숙소 origin 조회 | 같은 저장소 | RF-01 보존. `source_ref`를 예약 연결 키로 해석하지 않음 |
| 저장 후 상태 | `processEvent`가 complete로 갱신. 일부 타입은 skipped | INSERT만 수행, 상태 기본값은 스키마상 pending | `events.status`는 수신 처리 상태이며 입실 준비의 성공·실패나 청소 배정 상태가 아님 |
| 캐시·Slack | 일부 이벤트의 상태 캐시 갱신/삭제, 구현된 타입은 알림 시도 | 둘 다 호출하지 않음 | 현재 보고서는 이벤트 DB를 직접 계산. 캐시·Slack을 자동으로 추가하면 기존 부수 동작이 바뀜 |
| 테이블 준비 | 기존 스키마 전제 | 요청마다 축약된 `CREATE TABLE IF NOT EXISTS` 수행 | 축약 정의에는 출처·origin 열 등이 없어 정식 마이그레이션을 대체하지 못함 |
| DEMO | Pool 생성 전 403 | 동일 | 명시적 fixture의 쓰기 차단 유지 |

근거: [인증·검증·응답](../api/events/%5B...slug%5D.js#L66), [공통 INSERT](../src/infrastructure/eventRepository.js#L21), [서비스 후처리](../src/application/eventService.js#L20), [수신 상태 기본값](../data/schema.sql#L20), [현재 보고서의 DB 직접 계산](../src/application/reportingService.js#L189).

## 3. 발견 사항과 확실성

| ID | 심각도·확실성 | 사용자 상황·영향 | 근거·수정 제안 |
| --- | --- | --- | --- |
| RF-06.1 | 높음 · 코드상 인증 공백 확정, 운영 쓰기 노출 미확정 | 기본 수신 함수를 직접 호출하면 secret이 없거나 틀려도 유효 이벤트를 처리한다. 정상 Pi가 쓰는 `/write`에는 이 공백이 없음 | 격리 진단 D01~03, [분기](../api/events/%5B...slug%5D.js#L67). 경로 유지 여부·기존 외부 호출자를 확인하고, 유지하는 수신 분기 모두 기계 인증을 선행하도록 제안. 새 운영 root 경로를 열지는 않음 |
| RF-06.2 | 높음 · DB 호출 전 검증 누락 확정, 실제 DB 오염 미확인 | `/write`에 알려지지 않은 타입이나 잘못된 시각이 들어오면 저장소까지 전달된다. invalid Date는 실제 드라이버에서 오류가 날 수 있어 가짜 DB의 200을 실제 저장 성공으로 해석할 수 없음 | D04~07, [검증 범위](../api/events/%5B...slug%5D.js#L88). UUID 없는 기존 payload와 밀리초 시각을 보존하는 검증·정규화부터 회귀로 고정할 것을 권장 |
| RF-06.3 | 높음 · 일반 발행자의 재전송 공백 확정, 과거 손실 건수 미확인 | Pi 화면의 상태가 바뀌어도 일반 이벤트의 서버 전송이 401·500이면 재전송 없이 끝날 수 있다. 센서 준비 outbox는 별도로 재전송한다 | D16, [일반 전송](../server/occupancyWatcher.js#L430), [준비 재전송](../server/occupancyWatcher.js#L412). 일반 이벤트도 최초 시각·추적 정보를 보존하는 내구성 큐를 쓸지 별도 변경안으로 검토. 이번에 적용하지 않음 |
| RF-06.4 | 중간 · 후처리 실패의 재시도 공백 재현, 운영 발생 미확인 | 기본 분기에서 INSERT 이후 최종 UPDATE가 실패하면 500을 반환한다. 이후 같은 이벤트가 중복으로 판정되면 상태 갱신을 재개하지 않는다 | D13, [중복 조기 반환](../src/application/eventService.js#L25), [최종 UPDATE](../src/application/eventService.js#L53). 트랜잭션·후처리 재개·알림 중복 방지를 함께 설계해야 하므로 단순 서비스 통합으로 해결하지 않음 |
| RF-06.5 | 중간 · 문서와 코드 차이 확정 | 저장 문서는 검증→DB→KV→Blob→Slack→complete→200과 범용 outbox를 설명하지만 현재 Pi의 일반 발행과 두 수신 분기는 이를 모두 구현하지 않는다 | [기존 명세](data-storage-design.md#L128), [Pi outbox 명세](data-storage-design.md#L183), [현재 발행](../server/occupancyWatcher.js#L411). 이 감사 결과를 요구·현재 구현 비교 근거로 연결. 이 경로에서 확인되지 않은 Blob·deadLetter를 이미 제공되는 기능으로 문서화하지 않음 |

RF-06.4의 진단은 실제 함수에 INSERT 성공·UPDATE 실패·다음 호출 중복이라는 DB 응답을 주입했다. 실제 PostgreSQL 장애·트랜잭션 검증을 수행한 것은 아니다. 쿼리를 복사해 별도 업무 파이프라인을 만들지는 않았다.

### 운영 경로를 실제로 확인한 범위

2026-11-09 15:55 KST, `https://www.proposonline.com`에서 쿠키·인증정보 없이 GET만 보냈다. 리다이렉트를 따라가거나 운영 POST를 보내지 않았다.

| 경로 | GET 응답 | 이 결과로 판단할 수 있는 범위 |
| --- | --- | --- |
| `/api/events` | 404 · text/plain | 이 주소의 GET으로 기본 수신 분기 도달을 확인하지 못함. 모든 메서드·쿼리 조합의 비노출을 증명하지 않음 |
| `/api/events/write` | 401 · JSON | GET의 사람 로그인 검사를 확인. 이번 GET은 Pi POST 인증 검증이 아님 |
| `/api/events/history` | 401 · JSON | 인증 없는 이벤트 조회가 거절됨. 로그인 후 숙소별 범위 검증은 미실행 |

기본 주소를 위한 별도 파일이나 rewrite는 저장소에서 찾지 못했다. catch-all 함수 직접 호출 테스트가 운영의 기본 URL 도달성을 증명하지는 않는다. 따라서 ‘운영에서 아무나 이벤트를 저장할 수 있다’거나 ‘GET 404이므로 인증 보완이 불필요하다’고 단정하지 않는다. [배포 라우팅 정의](../vercel.json), [조회 권한 검사](../api/events/%5B...slug%5D.js#L110)

## 4. 의도된 차이와 보존할 부분

다음은 호환성 근거가 있어 일괄 제거하면 안 되는 차이다.

- `/write`의 UUID 자동 생성·밀리초 시각·중복 200은 현재 Pi와 outbox가 사용하는 계약이다. [발행](../server/occupancyWatcher.js#L418), [기존 API 회귀](../tests/unit/s93.event-provenance.test.js#L125)
- 두 경로의 공통 INSERT와 중복 키는 이미 공유된다. 경로를 합쳐야만 중복 저장이 방지되는 구조가 아니다. source 참조도 두 경로에서 보존된다. [저장소](../src/infrastructure/eventRepository.js#L21)
- `/write`에 `processEvent`를 연결하면 캐시·Slack·상태 종결이 새로 발생한다. 특히 `UNIMPLEMENTED_EVENT_TYPES`에는 준비 시작·완료도 남아 있으므로 이를 센서 기능 자체의 미구현 판정으로 사용하지 않는다. [분류](../src/config/eventTypes.js#L43)
- 보고서는 DB 이벤트를 읽으며 `events.status=complete`만 고르는 구조가 아니다. `/write`의 pending을 이유로 준비 실패나 화면 데이터 누락을 단정하지 않는다. 실제 준비 결과는 버전·회차·업무 이벤트로 판정한다. [쿼리](../src/infrastructure/eventRepository.js#L121), [준비 상태 구분](pre-stay-optimization.md#L86)
- 두 수신 분기는 예약·청소 작업·Google 블로커의 완료 처리나 Blob 업로드를 호출하지 않는다. 이벤트 수신 감사의 ‘종결’은 `events.status` 갱신을 뜻한다. 청소나 블로커 생명주기를 여기에 임의로 통합하지 않는다.

## 5. 실행한 검사

기존 테스트는 다음 명령으로 **34개 통과·실패 0개**였다. 워처 테스트는 임시 데이터 폴더와 가짜 HA·발행 응답을 사용했다. 실제 장치·DB·Slack 연결 검증은 아니다.

```sh
node --test tests/unit/s18.event-validation.test.js tests/unit/s24.event-service.test.js tests/unit/s93.event-provenance.test.js tests/unit/s97.preparation-watcher.test.js
```

| 기존 테스트 | 확인한 범위 | 아직 보장하지 않는 범위 |
| --- | --- | --- |
| [s18](../tests/unit/s18.event-validation.test.js#L14) · 14개 | 실제 검증기의 유효/무효 입력 | `/write`는 이 검증기를 호출하지 않음 |
| [s24](../tests/unit/s24.event-service.test.js#L18) · 4개 | 실제 서비스의 KV 실패 격리·미구현 분기·soft·중복 | HTTP 인증·실제 DB 실패 복구 |
| [s93](../tests/unit/s93.event-provenance.test.js#L46) · 13개 | 실제 API 함수·서비스·INSERT의 출처·구형 payload·중복·write secret | 배포 라우팅, root secret. 준비 시작 fixture가 skipped 분기여서 일반 입실의 Slack 동작까지 검증한 것은 아님 |
| [s97](../tests/unit/s97.preparation-watcher.test.js#L78) · 3개 | 실제 워처의 센서 준비·조기 입실·준비 전송 재시도 | 일반 이벤트의 영속 재시도, 실제 네트워크·장치·서버 POST |

추가로 실제 `handler/readBody/ensureTable/sendJson`을 AST에서 추출하고 실제 `validateEvent/processEvent/insertEvent` 및 일반 Pi 발행 함수를 호출하는 **임시 진단 16개**가 관측한 차이를 모두 재현했다. DB·KV·알림·통신만 대체했고 외부 fetch 시도는 0회였다. 새 테스트를 저장소에 등록하거나 업무 판정 로직을 복사하지 않았다.

| 진단 ID | 입력·결함 주입 | 관측·확인 결과 |
| --- | --- | --- |
| D01~03 | secret 누락·오류·서버 미설정 | root는 유효 입력을 처리, write는 401·쿼리 0 |
| D04~05 | 알 수 없는 타입·잘못된 날짜 문자열 | root는 400, write는 해당 타입/invalid Date를 가짜 DB에 전달 |
| D06 | UUID 없이 밀리초 시각 | write는 수용·정상 Date, root는 400 |
| D07 | soft 타입에 is_soft 누락 | root는 true, write는 false로 INSERT 전달 |
| D08 | 호출자 UUID 포함 | root는 보존, write는 새 수신 UUID 생성 |
| D09 | 정상 입실 이벤트 | root만 KV·Slack·complete UPDATE; write는 축약 CREATE·INSERT |
| D10 | INSERT 중복 응답 | root 409 / write 200, 두 분기 후처리 없음 |
| D11 | optimization_finished | root는 저장·complete·skipped, KV/Slack 호출 없음 |
| D12 | root Slack 예외 | 신규 수신 201·complete, notified_at null |
| D13 | INSERT 성공 후 UPDATE 실패, 다음 호출은 중복 | 첫 호출 500, 재호출 409·UPDATE 재개 없음 |
| D14 | 명시적 DEMO | 두 분기 모두 403·Pool 생성 0 |
| D15 | 잘못된 JSON | 두 분기 모두 400·쿼리 0 |
| D16 | 일반 Pi 발행에 HTTP 401·500 응답 | 한 번 호출 후 종료, outbox 추가·저장·재시도 없음 |

진단의 통과는 **기존 차이·문제의 재현 확인**이지 문제가 해결됐다는 뜻이 아니다. 전체 앱 회귀·실제 DB 검사·배포 테스트는 이번에 수행하지 않았다.

<a id="6-최소-변경-제안과-다음-작업"></a>

## 6. 감사 당시 최소 변경 제안

**첫 코드 개선 후보는 `/write`의 입력 검증이다.** 실제 Pi payload를 유지하면서 타입·날짜·필드 형식을 DB 전에 검증하는 회귀부터 추가한다. 호출자 UUID 없는 요청, 밀리초/유효 ISO 시각, 출처 필드 누락, 중복 200을 보존하고 Slack·캐시·상태 종결은 추가하지 않는 범위로 제안한다. soft 누락/불일치의 정규화 정책은 실제 발행 예시와 함께 승인 범위에 명시해야 한다.

기본 분기의 인증 보완은 운영 경로를 새로 열지 않는 조건으로 별도 제안한다. 일반 이벤트 outbox와 후처리 복구는 발생 시각·예약/회차 추적·중복 알림·재기동 복구가 얽혀 있어 독립 회귀와 변경 승인이 필요하다. DB 상태 일괄 변경, 경로 통합, Blob 구현, 새 알림은 이번 제안에 자동 포함하지 않는다.

감사 종료 당시 코드 개선은 미적용이었으며 RF-10을 다음 감사로 제안했다. 이후 사용자가 이번 문제를 먼저 해결하도록 지시해 RF-10을 후순위로 돌렸다. 현재 상태와 실행 순위는 [작업 현황](refactoring.md#sec-02)에서 관리한다.

<a id="rf-06-implementation"></a>

## 7. 2026-11-09 승인 후 1차 코드 개선·검증

사용자 지시: **“방금 니가 말한 3가지 문제 해결하고 가는게 맞지 않나?”** 이를 입력 검증·일반 이벤트 내구성 전송·API별 호환성 보존 범위의 코드/테스트 수정 지시로 반영했다. **작업 트리에서 수정·검증을 완료했으며 푸시·Vercel/Pi 반영은 하지 않았다.**

| 항목 | 수정 전 | 수정 후 | 근거 |
| --- | --- | --- | --- |
| `/write` 입력 검증 | 필수 3개 값만 검사, invalid Date·알 수 없는 타입이 저장소까지 전달됨. null 본문은 500 | root 스키마에서 공통 필드 규칙을 재사용하고 write 전용 UUID 생략·밀리초 시각·nullable data/flag를 허용. 잘못된 타입/날짜/속성은 SQL 전 400 | [검증기](../src/domain/eventValidation.js#L31), [API](../api/events/%5B...slug%5D.js#L87), s105 |
| 일반 이벤트 전송 | 한 번 전송, HTTP 오류 무시. 인증값이 없으면 발행을 생략 | 기존 준비 outbox에 일반 이벤트도 저장한 뒤 한 전송자로 처리. 인증값이 없어도 보관, 재시도·재시작 뒤 동일 발생 시각·출처·본문 재사용 | [영속화](../server/occupancyWatcher.js#L135), [발행·전송](../server/occupancyWatcher.js#L416), s106 |
| 중복·알림 호환성 | root 신규 201/중복 409, write 신규·중복 200. root만 캐시·Slack·complete 처리 | 응답·중복 키·부수 동작 유지. 공통 검증을 재사용하되 write를 root의 `processEvent`로 통합하지 않음 | [실제 handler fixture](../tests/helpers/eventApiFixture.js#L13), [경로별 회귀](../tests/unit/s105.event-ingestion-contract.test.js#L29) |

### 전송 실패 처리와 추적 계약

- `preparationOutbox`는 구형 Pi 상태 파일과 호환되도록 이름을 유지한다. 일반 이벤트에도 **발생 시 생성한** `watcher:event:<UUID>`를 기록한다. 센서 회차의 기존 `optimization:<회차>:<타입>` 참조와 예약/회차 연결은 바꾸지 않는다.
- 한 번 저장한 payload를 재전송한다. 새 수신 UUID·현재 재시도 시각·현재 숙소 설정으로 원래 이벤트의 키를 다시 만들지 않는다. 보관된 이벤트는 기존 30초 주기·처리 사이클에서 전송을 다시 시도하며, 새 이벤트도 같은 큐를 사용한다.
- 큐 저장이 실패하면 전송을 보류한다. 성공 응답 뒤 제거 기록이 실패하면 메모리 큐에도 다시 남기며, 다음 전송은 DB의 기존 중복 키와 write의 중복 200으로 확인한다.
- 2xx만으로 지우지 않고 JSON 응답의 `inserted`가 boolean인지 확인한다. `false`는 이미 수신된 중복으로 인정한다. 응답 파싱 실패·확인 필드 누락·통신/timeout·401/403·429·서버 오류 등은 큐에 보관한다.
- 400·422는 원본 payload와 HTTP 상태를 **`eventDeliveryRejected`**에 영속 보관한 뒤 다음 이벤트를 처리한다. 거절 보관에 실패하면 원래 큐에 되돌린다. 해당 자료의 자동 수정·자동 재주입·외부 알림은 추가하지 않았다.
- 조회 API의 기존 `preparationDeliveryPending`은 센서 준비 대기만 집계한다. 전체 대기와 거절 보관 건수는 `eventDeliveryPending`·`eventDeliveryRejectedCount`로 확인할 수 있다. UI 문구·화면은 추가하지 않았다.
- 기존 write soft 정책도 보존했다. null/누락은 false, 명시적 boolean은 그대로 저장하며 문자열 등 잘못된 형식은 거절한다. 타입별 soft 자동 재분류나 REAL/SIMULATED 필터 정책은 바꾸지 않았다.

### 테스트·리뷰 결과

| 검증 | 결과·해석 |
| --- | --- |
| s105 수정 전 재현 | 신규 20개 중 11개 실패: 잘못된 입력이 SQL에 도달하거나 null 본문이 500으로 처리됨 |
| s105 수정 후 | 20개 통과. UUID 없는 구형 요청·밀리초/ISO offset·flag 기본값·경로별 응답/알림·DEMO·인증 선행을 실제 API 함수로 확인 |
| s106 수정 전 재현 | 신규 11개 중 9개 실패: 일반 이벤트 미보관·재시도/복구 부재·확인 없는 제거 등 |
| s106 수정 후·보강 | 11개 통과. 401/500·네트워크·인증 누락·재기동·동시 발행·구형 준비 큐·거절 보관/재기동·디스크 실패·실제 watcher→실제 API 함수 연계를 검증 |
| 기존/신규 관련 회귀 | 106개 통과·실패 0. 투숙 재시작·종료·센서 준비·수동 이벤트 등 포함. 새 테스트 31개도 별도 통과 |
| 전체 테스트 | 총 2,747개 중 통과 2,745·일반 실패 0·기존 TODO 2. 초기 샌드박스 실행의 localhost listen EPERM 1건은 권한 있는 재실행에서 통과. TODO 기대값 변경·삭제 없음 |
| 시나리오·배포 준비 | `verify:scenarios`, `verify:deploy` 통과. 실제 배포를 수행한 결과가 아님 |
| 빌드 | 임시 출력 폴더로 성공. 저장소 dist 갱신·커밋·업로드 없음 |

신규 테스트는 실제 구현을 호출하고 DB·HA·Slack·통신만 가짜로 대체한다. 큐·거절 보관·복구는 임시 폴더에서 실제 파일 I/O로 확인했다. s93은 새 검증 함수 주입만 추가했으며 기존 기대값을 바꾸지 않았다. 데이터와 기존 미커밋 문서를 보존했다.

### 남은 범위와 반영 조건

**이번 세 항목의 코드 개선·모의 회귀는 완료다.** 운영의 과거 누락 복구, 실제 이벤트→운영 DB→보고서 검증, 현장 반영과 전체 RF-06 결함 해결은 별도다. **RF-06.1 기본 수신 분기의 인증 공백과 RF-06.4 후처리 실패 재개 공백은 이번 세 항목의 최소 수정에 포함하지 않았으므로 미해결로 유지한다.** 운영 root 쓰기 노출 여부도 여전히 미확정이다. ACT-02·03의 실물·Slack 대기를 코드 변경으로 완료 처리하지 않는다.

배포 전 API 검증기·Pi 워처 변경을 함께 검토한다. 정상 구형 Pi와 새 Pi 모두 `/write` 계약을 사용하므로 API 먼저, 승인된 Pi 반영 후 읽기 전용 상태 확인 순서로 제안한다. Pi 코드·기존 상태 파일·거절 보관 자료를 백업하고, 구형 코드 원복 시 새 거절 보관 필드를 잃지 않도록 별도로 보존해야 한다. 투숙 중 실제 장치·가짜 청소/입실·시험 알림은 검증용으로 보내지 않는다. 새 소스 배포·Pi 재시작은 이번 턴에서 실행하지 않았다.

<a id="rf-06-followup"></a>

## 8. 2026-11-09 후속 · 기본 분기 인증 보완과 복구 범위 분리

사용자의 다음 작업 진행 지시에 따라 RF-06을 재확인했다. **이번 제품 코드 변경은 이벤트 API의 인증 조건 한 곳이다.** 기존 `/write` 인증 조건을 두 POST 수신 분기 앞으로 옮겨 기본 분기도 같은 `PROPOS_PI_SECRET`을 요구하게 했다. GET의 운영자/숙소 권한, DEMO, 입력 형식, 중복 응답, 캐시·알림 동작은 유지했다. 경로·rewrite 추가, 실제 운영 POST·DB 변경·알림·Pi 재시작·푸시/배포는 하지 않았다.

### 8.1 · 사용 경로와 수정·검증 결과

- 저장소의 실행 코드에서 Pi 발행은 `/write` 두 호출로 확인했다. `processEvent`의 실행 코드 호출자는 기본 API 분기이며 다른 발행자는 찾지 못했다. 외부에서 별도로 쓰는 발행자가 없다는 증명은 아니다. [Pi 발행](../server/occupancyWatcher.js#L423), [기본 분기](../api/events/%5B...slug%5D.js#L76)
- `scripts/outbox.mjs`도 직접 읽었다. NDJSON 파일의 추가·조회·제거·deadLetter 보관 함수만 있고 HTTP 전송 함수나 실행 기동부는 없다. 해당 파일의 존재를 기본 수신 경로의 현장 사용 근거로 삼지 않는다. [NDJSON 도구](../scripts/outbox.mjs#L1)
- [s107](../tests/unit/s107.event-ingestion-auth.test.js#L5)의 실제 handler 회귀 10개 중 수정 전 기본 분기의 인증 누락/오류/서버 미설정/잘못된 본문 4개가 실패했다. 수정 후 10개 모두 통과했다. 인증 거절 때 SQL·캐시·알림 호출 0을 확인했고 정상 요청·DEMO도 유지했다.
- 기존 실제 API fixture에는 테스트용 서버 secret 설정·요청 헤더 생략 선택지만 추가했다. 실제 환경변수·인증값을 변경하거나 출력하지 않았다. 이전 테스트 기대값은 유지했다. [fixture](../tests/helpers/eventApiFixture.js#L22)
- 관련 회귀 72개 통과·실패 0. 전체 2,757개 중 통과 2,755·일반 실패 0·기존 TODO 2. 시나리오·배포 준비·임시 경로 빌드 통과. 새 소스는 작업 트리에 있으며 운영에 반영하지 않았다.

### 8.2 · RF-06.4를 중복 재실행으로 고치지 않은 이유

실제 `processEvent`에 가짜 DB/알림을 주입해 재확인했다. INSERT 성공→Slack 접수 응답→최종 상태 UPDATE 실패→재호출 중복이라는 순서에서, 첫 호출은 오류를 던지고 재호출은 `duplicate`를 반환했다. 알림 시도 1회·상태 갱신 시도 1회였으며 재개는 없었다. 실제 DB 쿼리·외부 요청은 0이었다. [서비스](../src/application/eventService.js#L20)

같은 `pending / notified_at=null`이라도 **현재 Pi `/write`로 정상 저장된 행**과 **기본 분기에서 후처리가 끊긴 행**일 수 있다. 두 분기는 저장소와 중복 키를 공유하고, 수신 경로·후처리 단계·외부 접수 미확인을 독립적으로 기록하지 않는다. 이 값만 보고 중복 이벤트의 Slack을 재실행하면 `/write`의 기존 무알림 계약까지 바뀔 수 있다. 외부 응답만 잃은 경우에는 중복 알림 위험도 있다.

따라서 RF-06.4는 **미해결로 유지**한다. 운영 기본 분기의 실제 사용·후처리 요구가 확인되면, 실행 의도/단계/결과를 구분하는 최소 변경안을 따로 제시한다. 새 테이블·플로우 엔진을 지금 만들어 기본 분기 전체를 옮기거나 과거 pending 행을 일괄 재처리하지 않는다. 이는 [SEC-13.5의 선행 범위](refactoring.md#sec-13)를 따른다.

### 8.3 · ACT-10에 넘길 사전 자료 · 청소 알림의 실제 함수 진단

아래 네 사례는 실제 함수만 추출하고 DB·발송 의존성만 가짜로 바꾼 임시 진단이다. 새 업무 로직을 복사하거나 제품 알림 코드를 수정하지 않았다. 운영 장애·실제 수신·중복 발송을 증명한 결과가 아니다.

| 입력/장애 주입 | 확인한 동작 | ACT-10에서 정할 계약 |
| --- | --- | --- |
| 최초 청소 요청의 SMS 결과가 false | `advanceJob`은 `notify` 결과의 ok를 검사하지 않고 `NOTIFYING_VIP_1`로 갱신 | 단계 전환이 요청 준비·발송 시도·접수 확인 중 무엇을 뜻하는지, 응답 대기 시간의 시작 기준 확인 |
| SMS 성공 후 channel UPDATE 실패 | `notify`는 `{ok:true, channel:SMS}`를 반환하고 기록 오류는 로그 처리 | 발송 성공/결과 기록 실패를 구분하고 원본 액션 재실행 없이 기록 복구 |
| FCM 결과가 통신 오류로 미확인 | 현재 notify는 이 실패 결과에도 SMS 폴백 시도 | 접수 미확인과 확정 실패를 분리. 폴백에 의한 두 채널 중복 위험 검토 |
| SMS 응답 누락 후 다음 시도 성공 | `sendSms`는 두 요청에 사용자 지정 id 없이 같은 내용을 전송 | 최초 메시지 ID 고정·접수 조회·중복 처리 응답과 내부 retry 책임자 확인 |

근거: [단계 갱신](../server/cleaning/_dispatch.js#L149), [결과·폴백](../server/cleaning/_notify.js#L58), [문자 재시도](../server/cleaning/_sms.js#L21). 기존 s25·s26의 일부 테스트는 판정 로직을 테스트 안에 복사하거나 흐름을 모사하므로, 이후 개선 회귀는 실제 구현 호출로 보강해야 한다. 기존 테스트를 제거하거나 기대값을 바꾸지는 않았다. [s25](../tests/unit/s25.cleaning-fcm-push.test.js#L10), [s26](../tests/unit/s26.cleaning-notify-channel.test.js#L127)

공식 SMSGate 안내에는 사용자 지정 메시지 ID와 상태 조회가 있다. 현재 코드는 단수 `/message`와 legacy `message` 필드를 사용하고, 안내는 복수 `/messages`를 기준으로 하므로 실제 호환성·중복 응답 의미를 확인하기 전 URL·요청을 바꾸지 않는다. 현재 SMS 함수는 응답 ID를 보존하지 않는다. Firebase도 성공 시 메시지 ID를 반환하지만 현재 `_push.js`는 이를 반환하지 않는다. [SMSGate 발행 안내](https://docs.sms-gate.app/features/sending-messages/), [상태 조회](https://docs.sms-gate.app/features/status-tracking/), [Firebase 반환 ID](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk), [현재 push 함수](../server/cleaning/_push.js#L29)

현재 운영 DB의 실제 열/제약·알림 원본 행, SMSGate 계정·서비스의 실제 지원 계약과 수신 결과는 조회하지 않았다. 이 사전 자료만으로 ACT-10의 계약 확정이나 ACT-11 구현 승인이 완료된 것으로 표시하지 않는다. 8절 작성 시 RF-06 반영과 RF-06.4 후속은 대기였으며, 이후 승인 코드 반영만 9절에서 완료했다. 다음 실행은 ACT-10의 읽기 전용 조사다.

<a id="rf-06-rollout"></a>

## 9. 2026-11-09 승인 코드 운영·Pi 반영 완료

사용자 지시 **“테스트 및 리뷰 완료 되었으면 새 코드 반영해”**에 따라 7·8절의 코드와 회귀를 재검토한 뒤 반영했다. 기본 분기 후처리 복구 RF-06.4를 새로 구현하거나 과거 이벤트를 재처리하지 않았다.

### 9.1 · 반영한 버전과 확인 결과

| 대상 | 결과 |
| --- | --- |
| Git | `435f45fb3bee336c6584b3d09b5a1e7e0fc7942a` (`fix: validate and durably deliver Pi events`)를 `origin/main`에 푸시. 개인 메모·기존 미추적 자료·`.DS_Store`는 제외 |
| Vercel | 실제 프로젝트 `propos-project-v2`의 [Production 배포](https://propos-project-v2-nw56m5n6u-adcfirmproj-5252s-projects.vercel.app) READY·커밋 일치. `www.proposonline.com`·`proposonline.com`·`propos-project-v2.vercel.app` 별칭 확인 |
| Pi 반영 순서 | 새 운영 API READY 확인 후 기존 투숙·준비 없음·빈 전송 큐·프로세스/코드/보호 설정 확인, 백업 후 `server/occupancyWatcher.js` 1개만 원자 교체·워처 재시작 |
| Pi 실행 | PID 1325→1399, 워처 1개. 정적 import로 추적한 런타임 19개 모듈이 대상 커밋 해시와 일치. `.propos-release.json`의 commit도 `435f45f`. Pi Git HEAD는 배포 버전의 근거로 사용하지 않음 |
| 설정 보존 | monitoring/properties 설정·비공개/공개 숙소 설정·기동 파일·비공개 환경파일·Git 제외 규칙 7개 해시 보존. 환경파일 root 전용 0600·Git 제외·기동 인자 유지. 인증값·장치 매핑 변경 없음 |
| 재시작 후 상태 | 즉시 확인과 후속 GET 모두 `OCCUPIED / GOOD_CONDITION`, WebSocket 정상·오류 없음·준비 실행 없음·전체 전송 대기 0·거절 보관 0 |

API를 먼저 반영해 구형 Pi 요청의 호환성을 유지하고 이어서 새 Pi를 반영했다. 워처 재시작이 포함되므로 무중단 배포로 표현하지 않는다. 배포 결과 문서는 제품 코드 변경 없는 후속 커밋으로 기록하며 Pi 릴리즈는 위 코드 커밋을 가리킨다.

### 9.2 · 테스트·리뷰와 운영 smoke 범위

- 전체 테스트 2,757개 중 통과 2,755·일반 실패 0·기존 TODO 2. 기대값 완화·TODO 제거 없이 유지했다.
- 시나리오·배포 준비·빌드·dist 동기화 검사와 격리 Playwright smoke 1개 통과. 격리 smoke는 외부 쓰기 요청을 fixture로 차단한다. 공개 후보 파일·dist에 로컬 비밀값이 포함되지 않았는지도 값 출력 없이 검사했다.
- [해당 코드의 GitHub CI](https://github.com/adckang/propos/actions/runs/42587630518) 성공. 단위/기능·시나리오·배포 준비·dist·Chromium 설치·smoke가 포함된 워크플로다.
- 운영 HTTPS GET: 홈페이지·엔트리 JS·`/api/auth/me`·개인정보처리방침·약관 200, 인증정보 없는 `/api/events/write`·`history` 401, 기본 `/api/events` 404. 기본 쓰기 경로를 새로 노출하지 않았다.
- Pi는 실제 파일 해시·프로세스 수·보호 설정·상태 GET으로 확인했다. **투숙 중이므로 장치 명령·가짜 입실/청소 이벤트·시험 알림·운영 POST는 실행하지 않았다.** DB/스키마 수동 변경·동기화·토큰 교체도 하지 않았다. 실제 자연 발생 이벤트를 새 코드로 DB에 저장하는 종단 검증은 아직 확인하지 않았다.

### 9.3 · 복구 기준과 남은 작업

Pi 복구 자료는 `/config/propos/.rollout/rf06-20261109T084329111Z-435f45f/`에 root 전용으로 보관한다. 이전 워처·릴리즈 기록·반영 전 상태 스냅샷·후보/결과 기록을 포함한다. 이번에는 복구가 필요하지 않았다. 문제 발생 시 소스·프로세스만 이전 버전으로 복구하고 최신 상태 파일·대기 이벤트·거절 보관을 과거 스냅샷으로 덮어쓰지 않는다. 구형 코드가 새 거절 필드를 보존하지 못할 수 있으므로 최신 상태도 별도 보존해야 한다. 직전 웹 코드 기준은 `d96e9d4`, Pi 워처 기준은 `25a1d28`이다.

**완료:** 승인한 입력 검증·일반 이벤트 영속 전송·호환성·인증 보완의 코드/테스트·운영/Pi 반영과 읽기 전용 smoke. **미완료:** RF-06.4 기본 분기 후처리 복구, 실제 이벤트→운영 DB→화면/보고서 대조, 실제 장치/알림 검증, 기존 보고서 TODO 2개. 다음 작업은 [ACT-10](refactoring.md#act-10) 조사다. 이번 반영을 리팩토링 전체나 운영 무결성 전체의 검증 완료로 해석하지 않는다.
