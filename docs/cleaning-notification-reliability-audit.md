# ACT-10 · 최초 청소 요청 알림의 저장·실행 경계 조사

> 확인일: 2026-11-09 · 제품 코드 기준: `435f45f` / 문서 후속 `eda08ee` · 상태 정본: [refactoring.md](refactoring.md#sec-02)
>
> **1~9절은 수정 전 ACT-10 조사 기록이다.** 이후 사용자가 확인된 문제를 먼저 해결하도록 지시해 [10절의 ACT-11 코드 수정·회귀·리뷰](#act11-implementation)를 수행했다. 과거 조사와 최신 수정 결과를 구분한다. 기존 욕실 시험·개인 파일을 보존했으며 운영 DB 적용·실제 발송·푸시/배포는 하지 않았다.

<a id="act10-scope"></a>

## ACT10-01 · 확인 범위와 결론

**사용자 시나리오:** 운영자가 실제 숙소의 청소 일정에서 ‘발송 시작’을 누르거나 예약된 발송 시각이 되면, 우선순위에 따라 청소자 한 명에게 최초 요청을 보낸다. 실패·재시작·동시 요청이 있어도 발송을 누락하거나 같은 요청을 중복 발송하지 않고, 실제로 무엇이 확인됐는지 추적할 수 있어야 한다.

**결론:** 기존 `cleaning_notifs`의 작업·청소자 관계와 고유 키는 재사용할 수 있다. 그러나 현재 열만으로는 발송 의도·실행 중·외부 접수 확인·접수 미확인을 구분할 수 없다. `createNotif`의 행 중복 방지만으로 외부 발송의 중복까지 막지는 못한다. 먼저 최초 요청 한 경로에 필요한 작은 저장·선점·결과 기록을 제안한다. 새 큐 서버나 범용 워크플로 엔진을 도입할 근거는 없다.

| 구분 | 실제 확인 범위·한계 |
| --- | --- |
| 소스·명세 | 수동 발송·예약된 발송·VIP 후속·취소·발송 어댑터·스키마·관리 화면·관련 테스트를 직접 확인 |
| DB | 기존 `.env.local`의 `POSTGRES_URL`로 접속, `REPEATABLE READ READ ONLY`에서 `transaction_read_only=on` 확인 후 메타데이터·집계 SELECT만 수행, ROLLBACK. 운영 Vercel 비밀값과 연결 문자열의 동일성은 별도로 대조하지 못했으므로 **‘연결된 DB’의 결과**로 한정 |
| 기존 테스트 | s11·s25·s26, 104개 통과·실패 0. 기존 일부 테스트는 구현을 복사/모사하므로 이 결과만으로 신뢰성 검증 완료를 선언하지 않음 |
| 실제 함수 진단 | 제품 모듈을 메모리에서 로드하고 DB·SMS·FCM·Slack만 가짜로 대체한 15개 진단. 실제 업무 판단 로직은 복사하지 않음. 네트워크 기본 차단·실발송 0 |
| 실제 SQL 진단 | 두 실행 경로의 VIP 후속 SELECT를 소스에서 그대로 추출, READ ONLY 트랜잭션에서 JSON CTE로 입력만 대체한 12개 사례 확인. 임시 테이블·실제 업무 행 변경 없음 |
| 미확인 | 운영 서비스의 실제 SMSGate 지원 버전·현재 단수 경로의 계약·사용자 지정 메시지 ID 중복 응답·계정의 상태 조회 권한·실제 수신 결과·외부 추가 스케줄러. 메시지 원문·전화번호·토큰은 조회/출력하지 않음 |

진단 원본은 세션의 `/private/tmp/propos-act10-audit/`에 보관한다. `diagnose.mjs`, `diagnostics.json`, `diagnose-sql.mjs`, `sql-diagnostics.json`, `db-readonly.json`, `existing-tests.log`이며, 이 문서가 지속 관리하는 결과 요약이다. 임시 진단은 저장소의 상시 회귀 테스트를 대신하지 않는다.

<a id="act10-scenarios"></a>

## ACT10-02 · 사용자 행동부터 저장·화면까지의 현재 경로

| 시나리오 | 현재 실행 경로 | 저장·외부 동작과 확인 지점 |
| --- | --- | --- |
| 운영자가 최초 발송 버튼을 누름 | [버튼:679](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/src/components/v2/CleaningManager.jsx#L679) → [수신:1455](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cleaning/%5B...slug%5D.js#L1455) → [dispatchJob:419](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cleaning/%5B...slug%5D.js#L419) → `advanceJob` | 권한·숙소 범위·작업의 REAL/PENDING 확인 후 실행. 반환한 notify의 성공 여부와 관계없이 API는 정상 반환 시 `{ok:true}`이고 화면은 ‘발송 시작됨’ 표시 |
| 예약된 발송 시각이 됨 | [followup:258](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cron/%5B...slug%5D.js#L258)에서 REAL/PENDING/dispatch_after 조회 → `advanceJob` | 여러 호출의 동일 작업 선점을 보장하는 잠금·조건부 상태 전환 없음 |
| 청소자 한 명을 선택해 최초 요청 | [advanceJob:108](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_dispatch.js#L108) → 숙소 설정·가용 VIP 조회 → [createNotif:25](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_dispatch.js#L25) → [notify:58](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_notify.js#L58) → [작업 UPDATE:162](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_dispatch.js#L162) | 블로커 삭제도 이 흐름 앞에 존재. 알림 INSERT·외부 발송·작업 UPDATE는 하나의 원자적 DB 작업이 아님. VIP가 없으면 다음 단계로 이동하는 기존 순서가 있음 |
| 1시간 응답이 없음 | [API 후속:291](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cleaning/%5B...slug%5D.js#L291), [cron 후속:279](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cron/%5B...slug%5D.js#L279) | `cleaning_notifs.sent_at`에서 1시간 계산. 이 값은 스키마상 INSERT 시각이며 공급자 접수 시각이 아님 |
| 목록을 새로고침함 | [listJobs:331](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cleaning/%5B...slug%5D.js#L331) | GET이 `runFollowupChecks()`를 기다리지 않고 실행해 다음 VIP 발송/에스컬레이션을 유발할 수 있음. **읽기 전용 조사에서는 이 운영 GET을 호출하지 않음** |
| 운영자가 청소 일정을 취소함 | [cancelJob:1049](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cleaning/%5B...slug%5D.js#L1049) | CANCELLED 저장·기존 알림 대상 취소 안내. 동시에 진행하던 `advanceJob`의 마지막 UPDATE는 취소 상태를 재검사하지 않음 |
| 발송 이력을 확인함 | [상세 조회:366](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cleaning/%5B...slug%5D.js#L366), [관리 화면:798](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/src/components/v2/CleaningManager.jsx#L798) | 행 존재·응답 없음은 표시되지만 공급자 접수 미확인 상태는 없음. [시험 화면:1475](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/src/components/v2/CleaningManager.jsx#L1475)는 channel NULL도 SMS로 표시하므로 발송 성공 근거로 사용할 수 없음. UI 수정은 이번 범위 아님 |

**호출 주기 확인:** [vercel.json:5](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/vercel.json#L5)은 morning/evening 두 번을 설정하고, 두 핸들러가 [morning:458](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cron/%5B...slug%5D.js#L458)·[evening:553](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cron/%5B...slug%5D.js#L553)에서 followup을 호출한다. 문서의 ‘30분마다’나 과거 ‘하루 1회’ 설명을 현재 설정으로 간주하지 않는다. 외부 스케줄러는 미확인이다. 코드상 1시간 조건은 확인 시점의 판정이며, 현재 설정만으로 정확히 1시간 뒤 실행됨을 보장하지 못한다. cron 주기 변경은 별도 범위다.

<a id="act10-evidence"></a>

## ACT10-03 · 확인된 결함·위험과 재현 근거

아래 D 번호는 이번 임시 실제 함수 진단의 ID다. **‘진단 완료’는 현재 문제를 확인했다는 뜻이며 수정 통과가 아니다.**

| ID / 심각도 | 사용자에게 생길 수 있는 결과 | 실제 함수·쿼리 관측 | 근거·확실성 |
| --- | --- | --- | --- |
| ACT10-F01 / 높음 | 문자가 실패해도 ‘VIP1 응답 대기’로 넘어가 다음 청소자에게 진행 | D02: SMS false 뒤 `NOTIFYING_VIP_1`. D12: SQL의 IS NOT NULL은 통과할 수 있는 빈 전화번호 입력에서도 발송 없이 같은 상태. SQL 12개 중 두 경로 모두 채널 미확인·행 생성 2시간 경과 사례를 다음 단계 대상으로 선택 | [dispatch:153](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_dispatch.js#L153), [sent_at 기본값:101](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/data/schema-cleaning.sql#L101), [후속:293](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cleaning/%5B...slug%5D.js#L293). 구현·재현 확인, 운영 피해 건수 미확정 |
| ACT10-F02 / 높음 | 한 번 전송됐는데 화면 재시도·동시 실행으로 같은 요청을 다시 보냄 | D04: 발송 성공 후 작업 UPDATE 실패→재호출, 알림 행 1개·SMS 호출 2회. D05: 두 호출의 알림 조회 시점을 교차시켜 신규 행 1개를 공유해도 둘 다 발송 | [기존 행 반환:31](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_dispatch.js#L31), [무조건 notify:153](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_dispatch.js#L153). 재현 확인. 행 고유 키와 발송 선점은 다른 계약 |
| ACT10-F03 / 높음 | 취소한 일정이 다시 요청 중이 되고 알림이 나감 | D07: 알림 INSERT 뒤 별도 취소 쓰기가 발생한 상황을 주입, SMS 1회·최종 NOTIFYING_VIP_1로 취소 덮어씀 | [최종 UPDATE:162](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_dispatch.js#L162), [취소 UPDATE:1066](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/api/cleaning/%5B...slug%5D.js#L1066). 경쟁 상태 재현, 실제 운영 취소 API 호출 아님 |
| ACT10-F04 / 높음 | 접수됐는지 모르는 요청을 다시 보내거나 다른 채널로 추가 발송 | D10: FCM 통신 결과 미확인 오류 주입에도 SMS 폴백. D13: SMS 응답 유실→재시도 2회, 고정 메시지 ID·timeout signal 없음. D14: 확정 400도 최대 3회 재시도 | [notify:66](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_notify.js#L66), [SMS:22](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_sms.js#L22). 재시도/폴백 동작 확인, 공급자에 실제로 중복 접수됐다는 증거는 아님 |
| ACT10-F05 / 중간 | 발송은 접수됐어도 기록 실패 뒤 복구 판단이 불가능 | D03: channel UPDATE 실패를 기록만 하고 `{ok:true}`. D15: FCM이 반환한 메시지 ID를 sendPush가 버림. SMS도 boolean만 반환 | [채널 기록:84](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_notify.js#L84), [FCM 반환:41](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_push.js#L41), [SMS 반환:33](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_sms.js#L33). 구현·재현 확인 |
| ACT10-F06 / 중간 | 알림 행의 동시 생성 충돌이 ‘토큰 생성 실패’로 오분류 | D06: job/cleaner 고유 키 충돌에도 재조회 없이 INSERT 5회 후 오류 | [23505 처리:44](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_dispatch.js#L44). 실제 DB에 두 고유 제약이 있음을 확인. 토큰 충돌만 새 토큰 재시도가 맞고 작업/청소자 충돌은 기존 행 재조회가 필요 |
| ACT10-F07 / 높음·변경 시 방어 조건 | 숙소 속성을 SIMULATED로 전환했는데 오래된 REAL 작업을 보내는 경로 | D09: 작업 REAL·현재 숙소 SIMULATED 입력에서 SMS 호출. D08의 작업 자체 SIMULATED 입력은 DB/발송 전 차단 | [작업 origin 검사:111](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_dispatch.js#L111), [설정 조회:130](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/server/cleaning/_dispatch.js#L130). 가상 불일치 입력의 코드 재현. 연결된 DB 알림/작업 origin 불일치는 0이며 실제 불량 행 존재를 주장하지 않음 |

정상 동작도 대조했다. D01은 최초 SMS 1회·알림 1행·VIP1 진행, D08은 SIMULATED 차단, D11은 UNREGISTERED의 기존 SMS 폴백을 확인했다. 이후 수정에서 정상 우선순위·문자 본문·링크·구형 응답·명시적 fixture/혼합 데이터 계약을 보호할 기준이다.

<a id="act10-db"></a>

## ACT10-04 · 연결된 DB의 구조·집계

관측: **2026-11-09 18:56 KST**. 다음은 조회 당시 스냅샷이며 실시간 현황이나 Vercel 대상 동일성 검증을 대신하지 않는다.

| 항목 | 관측·해석 |
| --- | --- |
| 숙소 | REAL 1개(파주201), SIMULATED 21개 |
| 청소 작업 | REAL: ASSIGNED 21·ESCALATED 10·PENDING 5. SIMULATED: ASSIGNED 99·CANCELLED 18·ESCALATED 43·PENDING 44 |
| 알림 | REAL 77개: channel FCM 2개, NULL 75개. SIMULATED 알림 0개 |
| 관계·중복 | job/cleaner 중복 쌍 0, 부모 작업 없음 0, 청소자 없음 0, 알림/작업 origin 불일치 0 |
| 현재 진행 중인 미확인 | NOTIFYING 상태이면서 channel NULL인 알림 0개. 역사적 NULL 75개를 현재 실패·미발송·재발송 대상으로 분류할 근거는 없음 |
| 실제 제약 | notifs PK·token UNIQUE·(job_id,cleaner_id) UNIQUE·job/cleaner FK 모두 존재·검증 완료. 작업의 숙소·예약 복합 FK도 존재·검증 완료 |
| 기존 저장 항목 | notifs의 실제 11개 열은 [스키마:95](https://github.com/adckang/propos/blob/435f45fb3bee336c6584b3d09b5a1e7e0fc7942a/data/schema-cleaning.sql#L95)와 일치. `sent_at DEFAULT now()`·channel nullable. 별도 실행 상태·시도 식별자·접수 참조·접수 시각·요청 스냅샷·오류/다음 재시도 필드 없음 |

이 결과는 FK 검증 상태와 이번 집계 대상의 관계를 확인한 것이다. 전체 저장 데이터 감사 RF-12 완료를 뜻하지 않는다. 이름에 notif/outbox/delivery/request/audit가 있는 public 테이블·컬럼 메타데이터에서는 `cleaning_notifs`만 후보로 확인했다. 이 검색으로 모든 이름의 범용 저장소 부재를 단정하지 않는다. 기존 알림 테이블을 확장하는 방향을 우선 검토한다.

<a id="act10-contract"></a>

## ACT10-05 · 첫 적용의 최소 계약 · 제안·미구현

| 계약 | 권장 기준 |
| --- | --- |
| 첫 적용 범위 | 현재 우선순위가 선택한 청소자 1명의 **최초 요청**. 리마인드·다음 청소자 요청·배정 완료·취소 안내는 다른 업무 목적이며 일괄 이관하지 않음 |
| 작업 키 | 같은 청소 작업·청소자·목적 `INITIAL_REQUEST`를 같은 요청으로 구분. 기존 notif.id 및 (job_id,cleaner_id) 관계 활용. 시도 횟수·현재 시각을 새 업무 키로 쓰지 않음. 정당한 재안내는 별도 목적 |
| 함께 저장할 범위 | 같은 DB client의 짧은 트랜잭션에서 현재 작업/숙소·취소·권한·origin·이미 선택한 대상 재검사와 최초 발송 의도·고정 요청 내용/수신 대상 저장. 재시도 때 현재 설정으로 원래 본문을 다시 만들지 않음 |
| 실행 선점 | 동시 호출 중 한 실행자만 해당 요청을 실행 상태로 바꾸는 조건부 UPDATE/RETURNING. job/cleaner UNIQUE는 행 보호이며 외부 발송 선점을 대신하지 않음. 잠금은 외부 응답을 기다리며 유지하지 않음 |
| 결과 구분 | 준비됨·실행 중·접수 확인·안전 재시도 대기·접수 미확인·확정 실패·취소를 논리적으로 구분. 기존 job 상태 enum을 이 값들로 전면 교체하지 않음 |
| 성공 의미 | 공급자 접수 확인과 휴대폰 수신/사용자 확인을 구분. 권장안은 **접수 확인 후** 기존 VIP 응답 대기 상태와 그 시작 시각을 확정. 다른 한편 메시지 도착 여부는 별도 증거로 보관. 이 시각 기준 변경은 구현 승인 항목 |
| 복구 | 응답을 받았고 결과 저장만 실패하면 외부 액션을 다시 보내지 않고 결과 기록부터 복구. 프로세스가 접수 증거를 남기기 전에 종료된 경우는 미확인으로 남겨 공급자 조회로 대조. 조회/중복 방지가 불가능하면 자동 재발송 금지 |
| 재시도 책임 | 최초 요청 처리 함수 한 곳에서 분류·횟수·다음 시각을 결정. `_sms.js` 내부 3회와 바깥 retry를 중첩하지 않음. 기존 cron·수동 진입이 같은 선점/복구 함수를 사용하되 새 로컬 워처·새 메시지 서버는 만들지 않음 |
| 취소·배정·origin 변경 | 대기 중이면 실행 차단. 실행 중 취소 경합은 취소를 덮어쓰지 않는 결과 저장 조건 필요. 이미 공급자가 접수한 문자는 되돌릴 수 있다고 가정하지 않고 ‘취소 후 접수’ 사실을 남김. 숙소와 작업 모두 현재 REAL이어야 외부 실행 |
| 과거 데이터·호환 | 기존 행은 legacy/미확인으로 보존하고 자동 발송 후보로 편입하지 않음. 과거 channel NULL 일괄 보정·재발송 금지. token·링크·본문·채널 우선순위·동일 작업 중복 응답의 기존 계약을 보호. UI 문구 임의 수정 없음 |

발송 대기 중 청소자의 tier·active·가용 상태가 바뀌는 경우, 이미 선택한 대상의 요청을 취소/재평가하고 새 대상에는 새 대상 키를 사용한다. 같은 키의 수신자·본문을 조용히 바꾸지 않는다. `source_ref`를 예약 키로 간주하거나 다른 출처 데이터를 끼워 넣지 않는다.

**최소 저장 항목 제안:** 기존 notifs의 job/cleaner/tier/token/origin을 그대로 사용하고, 최초 요청의 상태·요청 스냅샷·시도 식별자/횟수/시각·접수 채널/공급자 메시지 ID/접수 시각·오류 코드/다음 시각을 보완한다. 열과 JSONB의 정확한 분리·제약·인덱스는 승인 전 스키마 비교안으로 확정한다. 새 테이블을 먼저 만들거나 단일 JSON에 검증 없는 임의 상태를 누적하지 않는다. 전화번호/푸시 토큰이 필요한 스냅샷은 기존 서버 권한 안에서 보호하며 로그/공개 문서/API 응답에 노출하지 않는다.

**응답 대기 시각의 호환성:** 기존 `sent_at`을 모든 경로에서 곧바로 접수 시각으로 재해석하면 레거시·리마인드가 달라진다. 새 최초 요청은 별도 접수 시각을 사용하고, legacy만 기존 기준을 유지하는 분기가 필요하다. 새 요청의 미확인 상태가 `COALESCE`로 기존 sent_at에 떨어져 응답 대기를 시작하지 않도록 두 후속 SELECT를 실제 SQL 회귀로 검증해야 한다.

<a id="act10-provider"></a>

## ACT10-06 · 공급자 근거와 미확인 경계

- SMSGate 공식 안내에는 사용자 지정 메시지 ID와 ID별 상태 조회가 있다. 현재 코드는 단수 `/message`·legacy `message` 본문, 안내는 복수 `/messages`를 사용한다. 문서만 보고 현재 URL을 바꾸거나 같은 ID의 중복 요청이 안전하다고 단정하지 않는다. 실제 서비스 계약 확인 후 적용해야 한다. [발송 안내](https://docs.sms-gate.app/features/sending-messages/), [상태 조회](https://docs.sms-gate.app/features/status-tracking/)
- SMSGate의 Pending·Processed·Sent·Delivered는 다른 단계다. 공식 안내도 Processed에 멈춘 요청을 확인 없이 재전송하지 말도록 설명한다. 공급자 접수와 휴대폰 도착을 같은 성공으로 집계하지 않는다. [수명 주기·접수 미확인](https://docs.sms-gate.app/features/status-tracking/#message-lifecycle)
- Firebase Admin `send()`는 성공 시 메시지 ID를 반환한다. 현재 `_push.js`는 이를 버리므로 기록 보존의 개선 근거가 있다. 이 ID가 사용자 읽음이나 임의 재전송의 멱등성을 보장하지는 않는다. 오류 종류별 재시도 안내도 구분돼 있다. [발송 반환값](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk), [오류 안내](https://firebase.google.com/docs/cloud-messaging/error-codes)

운영 SMSGate 계정에 요청하거나 메시지 상태를 조회하지 않았다. 현재 서비스의 `/message` 호환성·고정 ID 중복 의미·상태 조회 권한이 확인되기 전에는 ‘자동 재발송이 안전하다’는 보장을 구현 완료 조건으로 쓸 수 없다. 확인할 수 없는 접수 결과를 보류하는 경로는 필요하다.

<a id="act10-change"></a>

## ACT10-07 · ACT-11에서 승인받을 최소 변경 범위

| 순서 | 변경안·예상 파일 | 지켜야 할 경계 |
| --- | --- | --- |
| 1 | 실제 함수 회귀 fixture와 최초 요청/동시 실행/장애/취소 테스트 추가 | 이번 임시 진단의 모듈 주입 방식을 재사용하되 실제 DB 제약 경합은 격리 PostgreSQL QA와 구분. 테스트 전용 업무 로직 복사 금지 |
| 2 | `cleaning_notifs`의 최소 실행 기록을 위한 스키마/마이그레이션 **파일** 및 작은 저장 함수 제안 | 기존 행 legacy 유지·재발송 없음. 실제 DB 마이그레이션 실행은 별도 승인. 새 서버·범용 엔진·다른 테이블 재편 없음 |
| 3 | `_dispatch.js`의 최초 요청에만 원자적 의도 저장·선점·결과 기록 적용, unique 충돌 원인별 처리 | 우선순위·본문·링크 유지. 취소·배정·현재 origin을 재검사. 다음 단계/리마인드 전체를 동시에 이관하지 않음 |
| 4 | `_notify.js`·`_sms.js`·`_push.js`의 최초 요청용 결과 계약을 보완 | 기존 다른 호출자의 boolean/응답 계약 보호. 접수 참조·확정 실패·미확인을 구분. 확정된 토큰 폐기 오류의 기존 SMS 폴백 유지, 통신 미확인의 폴백은 별도 승인된 기준 적용 |
| 5 | 두 VIP 후속 SELECT가 새 최초 요청의 접수 시각을 보도록 최소 수정 | legacy는 기존 기준 유지. 목록 GET 부수 동작·cron 주기·UI·다른 업무를 임의로 변경하지 않음 |

아직 코드·테스트·마이그레이션 파일을 수정하지 않았다. 이 표는 정확한 필드 정의·공급자 계약 확인 후 사용자에게 승인받을 범위다. 접수 증거가 메모리에만 있을 때 프로세스가 중단될 수 있으므로, 작은 try/catch만으로 모든 복구가 해결된다고 약속하지 않는다.

<a id="act10-qa"></a>

## ACT10-08 · 다음 구현·반영의 검증 기준

1. 의도 저장 전/중간/직후, 외부 호출 전, 응답 미수신, 접수 후 결과 저장 실패, 재시작을 구분한다. 저장 묶음은 전부 확정되거나 전부 취소돼야 한다.
2. 같은 요청의 동시 실행·이미 존재하는 알림·token 충돌·job/cleaner 충돌·동시 취소·이미 배정됨을 각각 실제 구현으로 검증한다. 외부 접수는 가짜로 관측하고 DB 잠금/고유 제약은 승인된 격리 DB에서 검증한다.
3. 정상 SMS·정상 FCM·폐기 토큰 SMS 폴백·전화번호 없음/빈 값·설정 누락·확정 400·429/503·결과 미확인을 분리한다. 미확인 결과를 성공/실패로 임의 분류하거나 맹목 재전송하지 않는다.
4. REAL/SIMULATED 교차 불일치·속성 전환·명시적 DEMO·수신자 변경·legacy NULL 채널을 검증한다. 과거 75개 알림이 자동 발송 대상이 되면 실패다.
5. 응답 대기 기준의 전/후 차이, 일/월 경계, 기존 VIP 순서·리마인드·완료/취소 알림의 호환성을 검사한다. 공급자 접수와 실수신의 의미를 나누고 UI 기대값을 바꿔 결함을 숨기지 않는다.
6. 모의 QA·격리 DB·운영 읽기·실발송 결과를 분리한다. 실제 마이그레이션·배포·문자/푸시/Slack 시험은 각각 승인 범위에서만 진행한다.

<a id="act10-status"></a>

## ACT10-09 · 완료·남은 작업

**ACT-10 조사·분석은 위 범위에서 완료했다.** 실제 함수 15개·실제 SELECT 12개로 재현했고 기존 관련 테스트 104개가 통과했다. 저장 구조·작업 키·결과/복구 책임·최소 변경안을 정리했다. 제품 전체 테스트를 새로 돌린 결과나 문제 해결 완료가 아니다.

**다음은 ACT-11의 구체적 코드/테스트·스키마 파일 변경 범위 승인이다.** 승인안 확정 전에 공급자 단수/복수 경로·고정 ID·상태 조회 계약과 대상 DB 일치 여부를 확인할 범위를 제시한다. 확인 전 자동 재발송은 구현하지 않는다. ACT-12의 실제 DB 적용·배포·실발송은 그다음 별도 단계다. RF-06.4, 전체 데이터 감사, IR 최적화 연결, 욕실 외 장치 시험은 이번 조사로 완료 처리하지 않는다.

<a id="act11-implementation"></a>

## ACT11-01 · 승인 후 결함 수정·테스트·리뷰 결과

사용자 지시 **“확인된 주요 문제가 있으면 해결하고 다음단계로 넘어가야지”**, **“계속해”**를 확인된 최초 요청 경로의 코드·테스트·필요 스키마 파일 수정 지시로 반영했다. ACT-10의 조사 완료를 결함 해결 완료로 취급하지 않는다. 아래는 **작업 트리의 코드 수정·격리 검증 결과**이며 아직 운영 해결 확인 결과가 아니다.

### ACT11-02 · 수정 전후와 근거

| 감사 ID | 수정 전 | 현재 코드·검증 |
| --- | --- | --- |
| F01 발송 실패·응답 시각 | 실패에도 VIP 응답 대기로 전환. 행 생성 시각으로 1시간 계산 | 접수 확인된 최초 VIP 요청만 단계 전환. 새 요청은 `initial_accepted_at`, legacy만 기존 sent_at 사용. API/cron은 [공통 SELECT](../server/cleaning/_initialDelivery.js#L199) 호출. 미확인/실패에는 타이머 시작 없음 |
| F02 중복·부분 실패 | 같은 알림 행을 재사용해도 재발송. 접수 후 단계 UPDATE 실패 시 재호출도 발송 | 같은 client의 짧은 트랜잭션에서 현재 작업·숙소·청소자 잠금과 요청 스냅샷 저장·선점. 외부 발송은 COMMIT 뒤 실행. [접수 기록](../server/cleaning/_initialDelivery.js#L155)과 [작업 상태 투영](../server/cleaning/_initialDelivery.js#L181)을 분리해, 투영 실패는 저장된 접수로만 복구하고 재발송하지 않음 |
| F03 취소 경합 | 전송 중 취소돼도 마지막 UPDATE가 NOTIFYING으로 덮어씀 | 실행 직전 현재 상태 재검사·결과 투영 조건부 UPDATE. 이미 접수된 요청의 사실은 남기되 취소/배정 상태를 덮어쓰지 않음. VIP 건너뛰기·기존 BULK fallback의 마지막 상태 UPDATE도 같은 취소 보호 적용 |
| F04 접수 미확인 | SMS 내부 재시도·FCM 오류 시 무조건 SMS 폴백 | 최초 VIP 요청은 [상세 결과 모드](../server/cleaning/_notify.js#L58) 사용. 네트워크·timeout·서버 결과 미확인은 UNKNOWN으로 보존하고 자동 재전송/채널 폴백 금지. 확정 429만 요청 소유자가 Retry-After·대기 시각·최대 3회로 관리. 기존 다른 호출자의 인터페이스는 유지 |
| F05 접수 추적 | 채널 기록 실패 무시·공급자 메시지 ID 폐기 | 채널·접수 시각·공급자 ID(응답에 있는 경우)·최대 3개 시도 결과 보존. 접수 기록 저장은 같은 시도 ID로 최대 2회 재시도. 끝내 저장 못 하면 SENDING 선점을 보존하며 후속 실행은 재발송하지 않음 |
| F06 고유 키 충돌 | 모든 23505를 토큰 충돌로 간주 | [createNotif](../server/cleaning/_initialDelivery.js#L33)의 ON CONFLICT DO NOTHING 후 같은 job/cleaner 행 재조회. 토큰 충돌만 새 토큰 시도. 트랜잭션을 unique 오류로 중단시키지 않는 실제 PostgreSQL 사례 통과 |
| F07 현재 origin 불일치 | 과거 REAL 작업이면 현재 SIMULATED 숙소도 발송 | 현재 작업·숙소가 모두 REAL인지 선점 및 실행 직전 확인. SIMULATED 작업은 기존처럼 시작 전 차단. 이미 실행이 시작된 뒤 origin이 바뀌면 접수 사실을 남기되 추가 발송·원본 속성 정정은 하지 않음 |

첫 적용은 **VIP 청소자별 최초 요청 경로**다. 다음 VIP도 같은 최초 요청 함수를 사용하므로 후속 VIP의 일시 거절 복구까지 검증했다. BULK 발송·리마인드·완료/취소 알림 전체를 새 실행 기록으로 이관하지 않았다. BULK fallback의 마지막 상태 UPDATE에 취소 보호만 보완했다. 따라서 모든 기존 알림 경로의 중복·재시도 문제가 해결됐다고 확대하지 않는다.

현재 선택된 대상·본문은 요청 생성 때 고정한다. 재시도 때 새 청소자나 새 본문으로 바꾸지 않는다. 단, 같은 요청에서 FCM 토큰 폐기가 확정되고 SMS로 전환한 인과관계가 보존된 경우에는 그 SMS만 재시도한다. 임의 토큰/번호 변경은 차단한다. 미확인 과거 행과 channel NULL 75개는 자동 처리하지 않는다.

### ACT11-03 · 저장 구조와 개인정보 보호

기존 `cleaning_notifs`에 다음 **nullable 열 3개**를 보완하는 [마이그레이션 파일](../data/migrate-cleaning-initial-delivery.sql)을 작성했다. **실제 운영 DB에는 실행하지 않았다.** 새 테이블·외부 큐·범용 엔진·런타임 의존성은 추가하지 않았다.

| 필드 | 목적 |
| --- | --- |
| `initial_delivery_state` | READY / SENDING / ACCEPTED / RETRYABLE / UNKNOWN / FAILED / CANCELLED. NULL은 기존 legacy이며 자동 발송 후보로 편입하지 않음 |
| `initial_delivery_data` | 요청 목적·예상/다음 상태·고정 수신 대상/본문·시도 ID/횟수/시각·접수 결과/재시도 시각·최대 3개 결과 이력. 키·JSON 형식·청소자 FK와 스냅샷 ID 일치·실행/재시도 시각 제약 포함 |
| `initial_accepted_at` | 접수 확인 시각. ACCEPTED일 때만 값이 존재하도록 제약 |

마이그레이션 자체도 BEGIN/COMMIT으로 묶었고 기존 행은 NULL/legacy 그대로 둔다. fresh 스키마와 legacy 업그레이드의 제약 정의 일치, 반복 실행, 기존 행 보존을 실제 PostgreSQL에서 확인했다. 설정·전화번호·토큰·과거 이력의 일괄 보정은 하지 않았다.

실행 스냅샷에는 발송에 필요한 기존 연락처/푸시 자격정보가 포함되므로 서버에서만 보관한다. 기존 관리자/운영자 알림 조회의 공개 열을 명시적으로 투영해 새 스냅샷이 응답에 나오지 않게 했다. 관리자의 기존 거절 token 필드는 유지하고 운영자에게는 기존처럼 제외한다. PostgreSQL DETAIL에 전체 스냅샷이 포함될 수 있어 새 저장 경로 오류는 코드·제약 이름만 전달한다. UI 문구는 변경하지 않았다.

### ACT11-04 · 테스트·리뷰 사이클

| 검증 | 결과·범위 |
| --- | --- |
| 수정 전 회귀 | 신규 단위 7개·격리 SQL 9개, 총 16개 실패로 실제 오류 재현. 기대값 완화 없음 |
| 최초 수정 후 | 위 16개 통과. 기존 s11의 가짜 DB를 실제 저장소의 client/행 반환 계약으로 보강하고 정상 전송 fixture를 명시. 기존 기대값 유지 |
| 추가 리뷰 | FCM 토큰 폐기→SMS 429 뒤 복구가 막히는 사례를 새 TC로 먼저 재현·실패 확인, SMS만 재개하고 두 시도 결과를 보존하도록 개선. 동시 일정 변경 4개 사례도 먼저 실패를 재현해, 잠근 현재 일정으로 본문을 만들고 이전 일정의 재시도/늦은 접수가 새 일정에 적용되지 않게 보완. 접수 미확인·스냅샷 비공개·제약·경합 사례 보강 |
| 실제 PostgreSQL | 임시 localhost PostgreSQL 18.6에서 **36개 통과·실패 0**. 실제 pg.Pool 다중 연결로 동시 요청/같은 날 청소자 선점·취소·트랜잭션 롤백·접수 후 투영 복구·legacy 마이그레이션·관리자/운영자 실제 SQL 응답·정확한 1시간 경계·문자 설정 없는 FCM 정상/발송 불가 조건 검증 |
| 테스트 fixture 리뷰 | 네이티브 Pool의 메서드 바인딩/내부 콜백을 침범하던 장애 주입 fixture를 수정해 네이티브 SQL 전 항목 재검증. 프로덕션 판단을 fixture에 복사하거나 기대값을 바꾸지 않음 |
| 단위·기능 전체 | **총 2,769개 중 통과 2,767·일반 실패 0·기존 TODO 2 유지**. 초기 샌드박스의 localhost listen EPERM은 허용 환경 재실행으로 통과. 기존 권한 API의 SQL 계약도 유지해 재검증 |
| 준비 검사·빌드 | 시나리오·배포 준비 검사·임시 출력 폴더 빌드 통과. 저장소 dist·환경파일·package.json/lockfile 변경 없음 |

회귀: [s108 실제 전송/결과/API](../tests/unit/s108.cleaning-delivery-results.test.js), [s109 실제 SQL](../tests/integration/s109.cleaning-initial-delivery.test.js), [fixture](../tests/helpers/cleaningDeliveryFixture.js). 테스트는 실제 서비스·저장 SQL을 호출하고 외부 SMS/FCM/Slack만 가짜로 대체한다. 테스트용 바이너리·WASM 엔진은 임시 폴더에만 두고 프로젝트 의존성에 넣지 않았다.

SQL TC 실행은 **전용 loopback 테스트 DB**에 한정한다. fixture는 POSTGRES_URL·앱 환경파일을 읽지 않고 `127.0.0.1`의 `propos_delivery_test` 이외 DB URL을 거부하며, 매 사례 별도 스키마를 생성·정리한다.

```sh
CLEANING_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:PORT/propos_delivery_test node --test tests/integration/s109.cleaning-initial-delivery.test.js
node --test tests/unit/s108.cleaning-delivery-results.test.js
```

### ACT11-05 · 아직 운영에 적용되지 않은 부분과 반영 조건

**코드 수정·로컬 회귀·리뷰는 위 범위에서 완료했으나 서비스에는 아직 미반영이다.** 확인된 결함을 단순 조사 완료로 닫지 않고 운영 적용 대기로 남긴다. 실제 DB 변경·푸시·배포·문자/푸시/Slack 실발송·Pi 설정/제어는 하지 않았다. RF-06.4·기존 보고서 TODO 2개·IR 연결 등 별도 항목도 그대로다.

운영 반영 전에 다음을 별도 승인·확인해야 한다.

1. 대상 DB가 Vercel Production과 같은지 확인하고 기존 스키마/행 집계·복구 기준을 확보한다. [ACT11-06](#act11-production-preflight)에서 대상 일치·현재 스키마·집계를 읽기 전용으로 확인했다. SQL 변경 시험은 운영 DB가 아닌 격리 로컬 DB에서 수행했다. [사용자 확인 기준](#act11-fcm-scope)에 따라 앱 FCM 경로를 검증하며 미사용 SMS 설정은 운영 반영의 필수 조건이 아니다.
2. 전용 migration으로 열 3개·제약만 먼저 적용하고 기존 행 수/키/관계·legacy NULL 보존을 확인한다. 새 코드가 이 열을 사용하므로 마이그레이션 없이 배포하지 않는다.
3. 이전 실행자가 새 선점 기록을 무시하고 발송하지 않도록 기존 발송/cron 진행을 확인·정리한 반영 시간대를 정한다. 정상 발송이 진행 중인 상태에서 단순 코드 교체만으로 중복 방지가 완성된다고 가정하지 않는다.
4. 새 코드 반영 후 읽기 전용 smoke부터 수행한다. 실제 알림 시험은 수신자·범위를 별도 승인받고, 정상 업무의 자연 발생 처리와 시험 발송을 구분한다.
5. 새 요청이 생성된 뒤에는 구버전 코드가 선점을 무시할 수 있다. 원복 시 새 기록/접수 결과를 보존하고 이전 발송자를 재가동하기 전에 미완료 요청을 확인한다. 새 열 DROP·과거 NULL 채널 재발송·스냅샷으로 데이터 덮어쓰기는 복구 방법으로 사용하지 않는다.

공급자 접수 여부를 확인할 근거가 없는 UNKNOWN은 보관·보류한다. 현재 SMS 단수 endpoint/body와 기존 다른 알림의 인터페이스는 유지했고, 검증하지 않은 공급자 멱등성이나 임의 메시지 상태 조회를 가정해 자동 재발송을 추가하지 않았다. 결과 기록 전 프로세스가 종료되는 구간까지 ‘반드시 한 번 발송’이라고 보장하지 않는다. 안전한 재시도와 접수 미확인의 보류를 구분한 것이 이번 수정의 범위다.

<a id="act11-production-preflight"></a>

### ACT11-06 · 운영 반영 전 읽기 전용 점검 · 2026-11-09 20:11~20:15 KST

**아래는 당시 조회 결과이며, 문자 설정을 복구해야 한다는 후속 판단은 정정했다.** 사용자는 이후 “문자는 실제로 쓰지 않고 앱 노티를 우선 구현했다”고 확인했다. SMS 미설정은 운영 장애나 운영 반영의 필수 선행 조건이 아니다. 앱 등록·토큰 상태와 별도로 확인한 갱신 코드 문제는 [ACT11-07](#act11-fcm-scope)에서 구분한다. 코드 회귀 통과만으로 실제 기기 수신까지 완료됐다고 판단하지 않는다.

| 점검 | 확인 결과·근거 |
| --- | --- |
| 로컬·운영 DB 일치 | Vercel `propos-project-v2` Production의 `POSTGRES_URL`을 메모리에서 로컬 설정과 비교해 값·DB 대상 일치 확인. 실제 DB에서 `BEGIN READ ONLY` → `transaction_read_only=on` → SELECT → ROLLBACK 수행. 연결 주소·인증값은 출력/문서 저장하지 않음 |
| 현재 운영 배포 | Vercel 조회에서 `eda08ee` READY와 `www.proposonline.com`·`proposonline.com` 연결 확인. ACT-11 코드는 미커밋 작업 트리에 있으며 이 배포에 포함되지 않음 |
| 기존 데이터·스키마 | 작업 240개(REAL 36 / SIMULATED 204), 알림 77개, 담당자 5개. `cleaning_notifs`는 기존 11열이며 새 `initial_*` 열은 없음. 작업·알림의 기존 FK/고유 키/CHECK 16개 모두 validated. 키의 실제 값·연락처는 출력하지 않음 |
| 진행·예정 요청 | REAL의 `NOTIFYING_*` 작업 0개. PENDING 5개 모두 자동 발송 예정 시각 전이며 가장 이른 시각은 **2026-11-15 11:00 KST**. 상태 집계만으로 실행 중인 서버 함수가 없다고 보장하지 않으므로 실제 반영 직전 다시 확인 필요 |
| 미사용 문자 설정 | Vercel 프로젝트 Production, 연결된 공유 설정(0개), 현재 운영 배포의 환경변수 키에서 `PROPOS_SMS_GW_ID`·`PROPOS_SMS_GW_PWD` 모두 없음. 로컬에도 해당 키 없음. [문자 구현](../server/cleaning/_sms.js#L14)은 이 두 값이 없으면 실패로 반환하나, 사용하지 않는 인터페이스이므로 설정 복구를 요구하지 않음 |
| 현재 푸시 대상 | 활성 담당자는 VIP_1·VIP_2·BULK 각 1명. 모두 전화번호는 있으나, **`fcm_status='active'`이며 토큰이 있는 담당자는 0명**. 토큰 보유 여부만으로 발송 대상으로 판단하지 않음. [실제 채널 선택](../server/cleaning/_notify.js#L44)은 이 경우 SMS를 선택 |
| Firebase 설정 | 운영에 서비스 계정 설정 키는 있음. 이것만으로 담당자 기기의 등록·토큰 유효성·실수신 성공을 확인한 것은 아님 |

조회 증거는 비밀값을 제외한 집계로만 임시 작업 기록에 보관했다. 기존 FCM 채널 2건·channel NULL 75건은 과거 이력이며, 현재 설정 조회만으로 과거 발송 성공/실패를 재판정하지 않는다. 운영 데이터·스키마·설정·배포·장치 상태는 변경하지 않았다.

#### 사용자 시나리오와 추가 회귀

현재 데이터처럼 앱 푸시 조건을 충족하지 않으면 기존 코드는 문자 분기를 선택하지만, 미사용 문자 설정도 없어 발송할 수 없다. 이것은 **FCM 대상 등록이 필요하다는 사례**이지 문자를 사용해야 한다는 요구사항이 아니다. 수정 전 코드는 발송 성공 여부와 관계없이 응답 대기로 넘어갔다. ACT-11 코드는 이 분기의 `SMS_CONFIG_MISSING`을 FAILED로 저장하고 작업을 PENDING으로 유지하며, 접수 시각·응답 타이머를 시작하지 않는다. 이 방어 회귀는 유지하고 별도로 SMS 없이 FCM만 성공하는 회귀를 추가했다.

이 조합을 [실제 구현·SQL 회귀](../tests/integration/s109.cleaning-initial-delivery.test.js#L46)로 추가했다. 실패 원인 저장·대기 전환 방지·접수 시각 없음·반복 호출/복구 시 발송 0회를 확인했고, 당시 기존 34개와 함께 **35개 모두 통과**했다. 이후 SMS 없는 FCM 정상 회귀를 추가한 최신 결과는 36개 통과다. 운영 전화번호/토큰을 fixture에 복사하거나 실제 알림을 발송하지 않았다. 첫 재실행의 임시 DB 포트 불일치로 연결 거절이 있었으나 지정한 loopback 포트로 바로잡은 뒤 전 항목을 다시 검증했다. 코드 실패와 실행 환경 실패를 구분한다. 시나리오·배포 준비 검사도 통과했다.

#### 당시 후속 판단 정정

기존 SMS 발송용 휴대폰을 확인해 달라는 질문과 SMS 설정 복구를 선행시키던 작업은 철회한다. 실제 앱 등록 근거 없이 `fcm_status`를 임의로 active로 바꾸거나, 다른 서비스·개인 휴대폰으로 대체하지 않는다. 기존 알림 77개는 재발송하지 않는다. DB 열 3개·CHECK 적용과 코드 배포, 실제 알림 시험은 기존의 별도 반영 범위를 유지한다. 다음 검토 대상은 문자가 아닌 앱 FCM의 등록·갱신·수신 경로다.

<a id="act11-fcm-scope"></a>

### ACT11-07 · 앱 푸시 운영 기준 정정·경로 검토 · 2026-11-09

**운영 알림은 앱 푸시(FCM)가 기준이고 SMS는 현재 사용하지 않는 인터페이스다.** 사용자의 확인을 [청소 자동화 정본](cleaning-automation-design.md)에 반영했다. 이 명세 정정은 SMS 폴백 코드를 제거·활성화하거나 담당자 상태를 바꾸는 코드 변경 승인이 아니다.

#### 경로와 확인 범위

| 단계 | 실제 구현·의미 |
| --- | --- |
| 앱 최초 등록 | [App.tsx](../worker-app/App.tsx#L28)에서 FCM 토큰을 받아 [registerWorker](../worker-app/src/services/api.ts#L3) 호출. [운영 API](../api/workers/%5B...slug%5D.js#L59)가 전화번호 기준으로 토큰·상태를 저장. 기존 담당자의 업무 승인 `active`는 유지하며, 신규 담당자는 별도 승인 필요 |
| 앱 토큰 갱신 | [initFcm](../worker-app/src/services/fcm.ts#L55)·[갱신 리스너](../worker-app/src/services/fcm.ts#L71) → [updateFcmToken](../worker-app/src/services/api.ts#L43) → [서버 토큰 갱신](../api/workers/%5B...slug%5D.js#L116) |
| 장기 미접속·복귀 | [헬스체크](../api/cron/%5B...slug%5D.js#L371)는 30일 미접속을 inactive로 전환. [앱 홈](../worker-app/src/screens/HomeScreen.tsx#L15)의 heartbeat에 서버 저장 토큰이 일치하면 [inactive 복구](../api/workers/%5B...slug%5D.js#L92). 30일은 이 서비스의 활동 상태 정책이며 Google 토큰 만료일이 아님 |
| 청소 요청 발송 | [채널 선택](../server/cleaning/_notify.js#L41)은 active 상태·토큰이면 FCM. [SDK 호출](../server/cleaning/_push.js#L24)은 Firebase Admin SDK에 요청. ACT-11의 접수 저장·조건부 단계 전환과 앱 기기의 실제 수신 여부는 구분 |
| 앱 수신 | [포그라운드 수신](../worker-app/src/services/fcm.ts#L87), [알림 탭](../worker-app/src/screens/HomeScreen.tsx#L24), [종료 후 알림 진입](../worker-app/src/services/fcm.ts#L102) 처리 코드 존재. 설치된 앱 버전·OS 권한·실제 수신은 이번 조사에서 확인하지 못함 |

운영 DB를 `BEGIN READ ONLY` → SELECT → ROLLBACK으로 재조회했다. 활성 담당자 3명 중 **2명은 토큰·앱 등록 시각·마지막 접속 기록이 없고**, **1명은 토큰·앱 등록 기록이 있으나 마지막 접속이 30일을 넘어 inactive**였다. 비활성 담당자 2명은 발송 대상에서 제외한다. 상태·존재 여부만 집계했고 실제 연락처·토큰은 출력하지 않았다. DB 기록만으로 앱 삭제나 Google 토큰 무효화를 단정하지 않는다.

#### 검증과 새로 재현한 코드 문제

1. **문자 없는 FCM 정상 경로:** 실제 `advanceJob`·저장 SQL을 호출하되 Firebase 응답만 가짜로 대체했다. SMS 설정을 모두 제거해도 FCM 호출 1회·SMS 0회, 접수 ID/시각 저장·NOTIFYING_VIP_1 전환을 확인했다. [회귀 TC](../tests/integration/s109.cleaning-initial-delivery.test.js#L28)를 추가했고, 실제 격리 PostgreSQL의 기존 35개와 함께 **36개 모두 통과**했다. 실제 기기로 보낸 시험은 아니다.
2. **수정 전 앱 갱신 실패 재현:** 당시 [updateFcmToken](https://github.com/adckang/propos/blob/eda08ee44da53d77d1ee676af14fc77b64ff49e5/worker-app/src/services/api.ts#L21)은 HTTP 성공 여부를 확인하지 않았고 [initFcm](https://github.com/adckang/propos/blob/eda08ee44da53d77d1ee676af14fc77b64ff49e5/worker-app/src/services/fcm.ts#L19)은 서버 전송 오류를 무시한 뒤 새 토큰을 휴대폰 저장소에 기록했다. 실제 TypeScript 모듈을 실행해 **HTTP 500·네트워크 오류** 각각에서 서버 저장 실패에도 로컬이 새 토큰으로 바뀌고, 다음 initFcm에서 저장 요청을 **0회** 수행하는 것을 재현했다. 다음 실행에서는 로컬 값과 SDK 토큰이 같아 실패한 갱신을 다시 시도하지 않았다. 당시 갱신 리스너에도 같은 저장 순서가 있었다. 승인 후 수정 결과는 [ACT11-08](#act11-fcm-recovery)이다.
3. **운영 원인과의 구분:** 위 2번은 코드 결함 재현이다. 운영 담당자의 inactive 상태가 이 결함으로 생겼다는 증거는 아직 없다. 기기·요청 이력·설치 앱 버전은 미확인이다. [기존 s33](../tests/unit/s33.worker-api.test.js#L13)은 복사한 순수 로직 위주이며 실제 앱 TypeScript 모듈의 HTTP 오류·재시작 복구를 검증하지 않는다.

이전 진단 단계에서는 SDK·휴대폰 저장소·HTTP만 가짜로 대체했고 앱 업무 로직을 복사하지 않았다. 진단 2건은 **결함 재현**이며 수정 후 회귀 통과 수에 넣지 않는다. 그 단계에서는 운영 POST·실제 알림·앱/서버 제품 코드 수정·DB/설정 변경을 하지 않았다.

#### 최소 수정 제안과 남은 순서

아래는 당시 제안이다. 이후 사용자가 “앱 토큰 갱신 복구 수정·테스트 승인”으로 추가 코드 범위를 승인했고, [ACT11-08](#act11-fcm-recovery)에서 수정·검증을 완료했다. 현재 코드 승인 대기로 해석하지 않는다.

- **추가 코드 범위 확인:** 모바일 `services/api.ts`·`services/fcm.ts`와 필요한 경우 서버 `/api/workers/token`의 기존 요청 확인 분기, 실제 구현 회귀 테스트에 한정해 갱신 실패 복구를 개선한다. 현재 승인된 서버 최초 알림 경로와 모바일 토큰 등록·갱신의 변경 범위를 구분한다.
- **보장할 동작:** 서버 저장 완료 확인 전 갱신을 완료 처리하지 않고 재시도에 필요한 정보를 보존한다. HTTP 오류·통신 실패뿐 아니라 서버 저장 후 응답 유실·앱 재시작도 먼저 재현한다. 같은 담당자의 같은 갱신임을 확인할 근거 없이 새 담당자로 등록하거나 DB 상태를 덮어쓰지 않는다.
- **보존할 계약:** UI·승인 상태·우선순위·30일 미접속 정책·기존 Pi 요청·REAL/SIMULATED·SMS 미사용을 유지한다. 코드 수정 승인을 운영 DB 정정·앱 배포·서버 배포·실발송 승인으로 넓히지 않는다.
- **반영 구분:** 서버 최초 알림 신뢰성 코드는 준비된 nullable 열 3개·CHECK와 코드 배포가 남아 있다. SMS 설정은 반영 조건에서 제외한다. 모바일 갱신 복구의 코드/모의 검증과 설치 앱 갱신·실수신 검증은 각각 구분한다.

<a id="act11-fcm-recovery"></a>

### ACT11-08 · 승인된 앱 토큰 복구 수정·회귀·리뷰 결과 · 2026-11-09

**코드 수정·격리 테스트·리뷰 완료, 운영·설치 앱에는 미반영이다.** 승인한 앱 서비스 2개·기존 서버 token 분기·테스트/문서만 수정했다. 직전 작업 트리의 최초 청소 요청 코드·스키마 파일·욕실 시험 문서·개인 파일은 보존했다. 모바일 토큰 복구에 새 DB 테이블·열·라이브러리는 추가하지 않았다.

#### 사용자 상황별 수정 전후

| 상황 | 수정 전 | 수정 후·근거 |
| --- | --- | --- |
| 서버가 토큰 저장 요청을 500으로 거절 | HTTP 응답을 확인하지 않고 휴대폰 토큰을 새 값으로 덮어씀 | [API 확인](../worker-app/src/services/api.ts#L21)에서 HTTP 성공과 JSON `ok=true`를 모두 요구. 10초 중단 신호·오류/불완전 응답은 완료로 처리하지 않음 |
| 통신 실패 후 앱 재시작 | 실패한 갱신을 잊어 재시도하지 않음 | [앱 저장/복구](../worker-app/src/services/fcm.ts#L16)에서 기존 토큰 보존. 담당자 ID·기존/새 토큰을 비공개 pending 키에 먼저 저장한 뒤 요청하며 재시작 시 그 요청부터 복구 |
| 서버 저장 후 응답만 유실 | 기존 토큰을 서버에서 찾지 못해 재시도 실패 | [서버 확인 분기](../api/workers/%5B...slug%5D.js#L116)는 먼저 확인·보관한 담당자 ID와 새 토큰이 같은 행에 있을 때만 접수 확인. 다른 담당자의 같은 값만 보고 성공 처리하지 않음 |
| 서버 저장 뒤 휴대폰 저장이 실패 | 서버와 앱 상태가 엇갈림 | pending을 유지해 재시작 후 같은 서버 저장을 확인하고 로컬 확정. 로컬 확정 뒤 pending 삭제가 안 된 경우에는 불필요한 재전송 없이 정리 |
| 토큰 갱신 이벤트·앱 시작이 겹침 | 저장·요청이 경쟁할 수 있음 | [동일 앱 내 순차 처리](../worker-app/src/services/fcm.ts#L42). 실행 시점의 SDK 토큰을 읽고 이전 미확정 갱신부터 복구한 뒤 최신 토큰으로 진행 |
| 다른 담당자 토큰·중복 소유자 | 잘못된 덮어쓰기/여러 행 변경 위험 | 서버가 대상 행을 잠그고 소유자를 검사. 다른 담당자 소유·기존 중복은 409로 보류. token API끼리는 같은 새 토큰의 동시 선점을 DB의 짧은 트랜잭션 잠금으로 직렬화 |

#### 요청·저장 계약과 호환성

- **담당자 확인은 읽기 전용:** 기존 `/api/workers/token`의 GET에 기존 토큰을 Authorization 헤더로 전달해 담당자 ID만 확인한다. 토큰을 URL에 넣지 않으며 `private, no-store` 응답이다. 구 서버는 GET을 405로 거절하므로 새 토큰을 미리 써 버리지 않는다.
- **기존 요청 보존:** 기존 POST의 `{fcm_token,new_token}`·정상 응답 `{ok:true}`를 유지한다. 새 앱은 확인한 `worker_id`를 추가해 응답 유실을 복구한다. 기존 토큰도 없고 확인한 ID도 없으면 새 토큰의 존재만으로 다른 담당자의 성공을 추정하지 않는다.
- **확인과 활동 상태 구분:** 이미 저장된 갱신의 재확인은 행을 변경하지 않는다. inactive/invalid 상태나 활동 시각을 임의로 초기화하지 않는다. 기존 register·heartbeat·승인 상태·30일 미접속 정책은 수정하지 않았다.
- **DB/의존성 보존:** 이번 토큰 복구는 기존 cleaners의 열만 사용한다. 이전 최초 청소 요청용 nullable 3열 migration 파일과 구분한다. 앱에는 기존 AsyncStorage의 pending 키 1개만 추가했으며 SDK·연락처·권한·UI는 바꾸지 않았다.
- **실패 보류:** pending이 손상됐거나 저장 토큰과 연결되지 않으면 임의 정리·덮어쓰기를 하지 않는다. 과거에 이미 토큰 연결을 잃은 기기를 다른 담당자로 자동 등록하거나 DB에서 active로 강제 전환하지 않는다.

#### 테스트와 리뷰 결과

| 검증 | 결과 |
| --- | --- |
| 수정 전 재현 | 신규 단위 15개 중 **12개 실패**, 초기 SQL 7개 중 **5개 실패**. 실제 앱 TypeScript·서버 핸들러·SQL을 호출해 HTTP 오류·재시작·응답 유실·다른 담당자 보호 문제를 확인 |
| 수정 후 및 리뷰 | 위 17개 실패 모두 통과. 동시 리스너·최신 SDK 토큰·손상된 응답·10초 timeout 보강. UUID 대소문자 비교 오류 1개를 추가로 먼저 재현한 뒤 PostgreSQL 표기와 일치시켜 해결. 기대값 완화 없음 |
| 신규 단위 | [s110](../tests/unit/s110.worker-token-recovery.test.js) **19개 통과·실패 0**. 실제 앱 모듈을 재로딩해 프로세스 재시작을 모의하고 SDK·저장소·HTTP만 가짜로 대체 |
| 실제 PostgreSQL 통합 | [s111](../tests/integration/s111.worker-token-sql.test.js) **11개** + 기존 최초 요청 s109 **36개**, PostgreSQL 18.6의 실제 pg.Pool 다중 연결로 **47개 모두 통과**. 서버 커밋 뒤 응답 유실·기존 요청·소유자 충돌·동시 선점·롤백·오류 내 비밀값 보호 확인. 임시 loopback DB는 검증 후 종료 |
| 전체 회귀 | **총 2,788개 중 통과 2,786·일반 실패 0·기존 TODO 2 유지**. 이전 전체 회귀 대비 신규 단위 19개 추가. 기존 실패를 기대값 변경이나 TODO 삭제로 숨기지 않음 |
| 준비 검사·빌드 | 시나리오·배포 준비 검사·임시 폴더 웹 빌드 통과. 모바일 네이티브 빌드/APK 설치 검증을 웹 빌드로 대신했다고 해석하지 않음 |

[테스트 fixture](../tests/helpers/workerFcmFixture.js)는 실제 소스를 esbuild로 로드하고 외부 I/O만 주입한다. 서버 SQL 판단을 fixture에 복사하지 않았고 실제 운영 토큰·전화번호·환경파일을 읽지 않았다. 전체 테스트와 통합 SQL은 분리된 실행이며 47개를 전체 2,788개에 포함시켜 계산하지 않는다.

```sh
node --test tests/unit/s110.worker-token-recovery.test.js
CLEANING_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:PORT/propos_delivery_test node --test tests/integration/s109.cleaning-initial-delivery.test.js tests/integration/s111.worker-token-sql.test.js
npm test
```

#### 2026-11-09 배포 전 시점의 미검증 범위와 반영 순서

아래는 코드 수정·격리 검증 직후의 기록이다. 이후 토큰 API·테스트 앱 반영 결과와 현재 남은 작업은 [ACT11-09](#act11-phone-rollout)와 [refactoring.md SEC-02](refactoring.md#sec-02)를 따른다.

1. **실기 미검증:** 설치된 앱 버전·OS 알림 권한·네이티브 빌드·실제 FCM 전달/표시·heartbeat와 실제 앱 시작 순서는 확인하지 않았다. 서버 배포만으로 설치된 구 앱의 오류가 사라지지 않으므로 서버를 먼저 반영하고 앱 업데이트 후 승인된 기기에서 검증한다.
2. **이전 손상·다른 경로는 별도:** 과거에 이미 기존 토큰/담당자 연결을 잃은 기기는 자동 복구하지 않는다. 모든 register/profile 경로와의 동시 실행까지 전역 토큰 유일성을 보장한다고 확대하지 않는다. 운영 inactive 상태의 원인도 이번 수정으로 단정하지 않는다.
3. **반영 미실행:** 운영 DB·스키마·환경변수·앱/서버 배포·실제 SMS/FCM/Slack 발송·Pi·장치 상태는 변경하지 않았다. 다음은 기존 최초 요청용 DB 조건과 서버 배포, 앱 업데이트, 승인된 기기의 실제 수신을 순서대로 검증하는 단계다. SMS 설정·새 범용 엔진은 필요 없다.

<a id="act11-phone-rollout"></a>

### ACT11-09 · 테스트폰 앱 업데이트·토큰 API 반영 결과 · 2026-11-09~10

**사용자 시나리오:** 청소 담당자 앱이 푸시 수신 정보(토큰)를 갱신하다 통신이 끊겨도, 다시 켜면 복구되어 청소 요청을 계속 받는다.

| 항목 | 결과 |
| --- | --- |
| 테스트폰 앱 | 1.0 → 1.0.1(release, versionCode 2). 기존 서명·설치 이력·등록 계정 유지, 홈 화면 정상·실행 오류 0. 빌드는 별도 프로젝트 `ProposWorker`에서 수행 |
| 운영 토큰 API | `api/workers/[...slug].js` 1개만 CLI로 반영(READY, 기존 코드 기준 `eda08ee`). 무인증 GET 401 확인. 최초 요청 코드·DB·환경변수·Pi는 미변경 |
| Git 일치 | CLI 반영본이 커밋에 없어 `main` 푸시 시 되돌아갈 수 있었다. 토큰 API·앱 소스·회귀를 묶어 커밋해 해소 |
| 시험 알림 1차 | 23:13 KST 1회, `app/network-error`로 접수 미확인. 폰 도착 0건. 이후 인증·발송 사전 검증(validate_only)은 통과, 원인 미확정 |
| 시험 알림 2차 | 11월 10일 20:55 KST 지정 테스트폰 연결 후 별도 시험 1회 완료. Firebase 접수·안드로이드 표시 1건·탭 후 동일 메시지 앱 표시·대기 화면 복귀 확인. 과거 접수 미확인 발송의 자동 재시도가 아니다. [상세](#act11-phone-receipt) |

**리뷰에서 재현·수정(2건):** 본문이 JSON null이면 500 → 400. ROLLBACK까지 실패한 연결을 풀에 반환 → 폐기. 수정 전 2개 실패 → 수정 후 통과. 격리 PostgreSQL 18.6 통합 47개 통과, 토큰 커밋 묶음의 격리 실행 2,777개 통과·실패 0·기존 TODO 2.

**2026-11-10 독립 검수·후속:** 이전 배포본과 비교해 위 두 수정의 회귀를 직접 재현했고 실제 서버/앱 코드 단위 22개가 통과했다. 타임라인 후속 ACT-15까지 함께 적용한 전체 회귀는 2,798개 통과·실패 0·기존 TODO 2다. ACT-15는 로컬 코드·문서 보완이며 토큰 API·휴대폰 앱을 다시 배포한 것이 아니다. 이후 지정 테스트폰의 실수신·탭 동작은 [ACT11-10](#act11-phone-receipt)에서 확인했다.

**아직 확인하지 않은 범위**

1. 시험 알림은 서버의 채널 판단을 거치지 않는다. 실제 요청은 `fcm_status='active'`여야 앱 푸시로 간다. 11월 9일 23:09에는 inactive였지만 11월 10일 시험 직전에는 같은 대상이 active임을 읽기 전용으로 확인했다. 다른 담당자·최초 요청 전체 경로의 검증으로 확대하지 않는다.
2. 서버가 모르는 옛 토큰이 기기에 남으면 재등록에 성공해도 저장값이 맞춰지지 않고, 손상된 대기 기록은 앱 데이터를 지울 때까지 토큰 동기화를 막는다. 후자는 ACT11-08의 실패 보류 계약이다. 다른 담당자에게 배포하기 전에 처리 방향을 결정한다.
3. `worker-app`과 실제 빌드 프로젝트 `ProposWorker`의 `api.ts`가 다르고(거절 처리·프로필 조회), `ProposWorker`의 1.0.1 소스는 그 저장소에 미커밋이다.

<a id="act11-phone-receipt"></a>

### ACT11-10 · 지정 테스트폰 실수신·알림 열기 확인 · 2026-11-10 20:55 KST

**사용자 상황:** 업데이트한 청소 담당자 앱을 백그라운드에 둔 상태에서 시험 알림을 받고, 알림을 누르면 같은 내용이 앱에 열린다. 기존 지정 테스트폰 1대의 설치·알림 시험 승인에 따라 진행했다.

| 확인 항목 | 결과 |
| --- | --- |
| 대상·설치 상태 | 연결 기기 1대가 기존 승인 기기와 일치. 앱 1.0.1 / versionCode 2 / release, 기존 설치 이력 유지, 알림 권한 허용·잠금 해제. 재빌드·재설치 없음 |
| 앱·대상 상태 | 홈 화면·등록 유지·실행 오류 0. 기존 기기 토큰의 지문과 DB 대상이 1건으로 일치, 담당자 active 및 fcm_status active 확인. 수동 UPDATE·재등록 없음 |
| 발송 전 검사 | Firebase 서비스 계정 프로젝트가 설치 앱과 일치. 인증·validate_only 성공. 인증값·토큰은 출력하거나 시험 파일에 저장하지 않음 |
| 실제 시험 발송 | 실제 sendPush를 1회 호출, Firebase ACCEPTED와 접수 ID 확인. 공급자 접수 여부와 기기 수신을 별도 기록. 고유 시험 실행 기록으로 중복 실행 차단, 자동 재발송 없음 |
| 안드로이드 수신 | 발송 전 해당 앱 알림 0건 → 고유 확인 코드가 일치하는 앱 알림 1건. 다른 앱 알림 내용·원본 덤프는 저장하지 않음 |
| 알림 탭·복귀 | 해당 시험 알림만 눌러 앱에 같은 확인 코드가 표시됨을 확인. 뒤로 가기로 대기 화면 복귀, 실행 오류 0. 수락·거절·협의 버튼은 누르지 않음 |

근거는 `/private/tmp/propos-phone-confirmation-20261110/`의 `device-preflight.json`, `recipient-before.json`, `firebase-diagnostics.json`, `send-intent.json`, `send-result.json`, `notification-receipt.json`, `notification-open.json`에 민감값을 제외해 보관했다. 이 결과는 **지정 기기 1대의 FCM 접수·OS 수신·앱 열기 확인**이다.

- 실제 청소 작업·청소 일정·알림 DB 행을 생성·수정하거나 과거 UNKNOWN 발송을 재처리하지 않았다. 앱 실행 시 기존 정상 heartbeat·토큰 갱신 API는 동작할 수 있지만 수동 DB 보정은 하지 않았다. 운영 스키마·환경변수·Pi·앱/서버 소스·배포는 변경하지 않았다.
- 이번 시험 프로세스에는 IPv4 우선·주소 선택 대기 1초와 30초 응답 제한을 사용했다. 이전 `app/network-error`의 원인이 이 옵션이었다고 입증한 것은 아니며 당시 원인은 미확정이다.
- 실제 휴대폰 토큰을 강제로 교체하거나 네트워크 장애를 주입하지 않았다. 갱신 실패·응답 유실·재시작 복구는 기존 실제 코드 회귀·격리 SQL 결과와 구분한다.
- 최초 요청의 DB 3열·서버 변경은 여전히 미반영이다. 다음은 ACT-12에서 그 변경의 운영 대상·진행 중 실행자·전후 차이·복구 절차를 확인하고 반영 범위를 구체화하는 단계다. 실수신 확인만으로 최초 요청 전체 경로를 완료 처리하지 않는다.

<a id="act12-production-rollout"></a>

### ACT12-01 · 최종 리뷰·운영 반영·현재 범위 QA · 2026-11-10

**승인·범위:** 지정폰 확인 후 사용자가 “리뷰해보고 문제 없으면 서버 반영하고, 다음 단계 계속”을 지시했다. ACT-11 최초 VIP 요청 신뢰성 개선, ACT-15 미래 타임라인, 관련 테스트·명세와 빌드 산출물을 `1aed54a`로 커밋·푸시하고 기존 운영 Vercel 프로젝트에 반영했다. 개인 파일·환경변수·Pi·앱 설치는 변경하지 않았다.

| 단계 | 실제 결과 |
| --- | --- |
| 최종 리뷰 보완 | 최초 요청 저장의 ROLLBACK까지 실패하면 연결을 재사용하는 오류 1건을 실제 함수 회귀로 재현했다. 실패한 연결만 release(error)로 폐기하고 정상 롤백의 재사용을 보존. s108 14개 통과 |
| 코드 QA | 전체 2,802개 중 통과 2,800·실패 0·기존 보고서 TODO 2 유지. 격리 PostgreSQL 18.6의 실제 pg.Pool 다중 연결로 s109 36개+s111 11개, 총 47개 통과. 격리 빌드·시나리오·배포 준비·로컬 Chromium smoke 통과. 임시 PostgreSQL 종료 |
| 대상·사전 상태 | Vercel 프로젝트 `propos-project-v2`의 기존 ID와 운영 도메인 확인. Production DB 값을 메모리에서 로컬 값과 정확히 비교. 알림 77건·작업 240건, REAL PENDING 5건 중 현재 발송 도래 0건·NOTIFYING 0건·관련 활성 쿼리 0건 |
| DB 반영 | 21:41 KST 잠금 안에서 도래/진행 상태 재확인 후 `migrate-cleaning-initial-delivery.sql`의 nullable 3열과 CHECK 제약만 적용. 기존 알림·작업 행을 새 열을 제외한 전체 값의 지문으로 전후 대조해 일치한 경우에만 COMMIT. 기존 77개 알림의 새 열은 모두 NULL 유지, 제약 validated |
| 배포·CI | `main`에 `1aed54a` 푸시, Vercel `dpl_BFKniLnNDuQvezMNJrSqBP5r8Svq` READY 및 `www.proposonline.com`·`proposonline.com` 연결 확인. [해당 코드 CI](https://github.com/adckang/propos/actions/runs/42818075606) 성공 |
| 공개 HTTP·실제 운영 빌드 | 운영 HTML 200·정규 도메인 이동·JS 200·통계/토큰 API 무인증 401 확인. Vercel 빌드 로그의 clone commit `1aed54a`와 산출물 `index-DmI2MJFp.js`가 운영 HTML과 일치. 로컬 산출물 파일명 동일성을 배포 판정 근거로 삼지 않음 |
| 운영 화면 렌더 | 실제 운영 HTML·JS를 Chromium에서 로드해 주요 화면 렌더·실행 오류 검사를 통과. 서비스 API는 fixture로 대체하고 모든 쓰기·외부 분석 요청을 차단한 검사이며 실제 데이터의 화면 대조와 구분 |
| 실제 DB·구현 조회 | READ ONLY를 강제해 실제 주간 보고서·월간 캘린더·실패 목록 구현, 기존 청소 상세의 실제 SQL/응답 투영 실행 통과. 숙소 22개 중 파주201만 REAL·SIMULATED 21개. 실행 스냅샷이 기존 청소 상세 응답에서 제외됨을 확인 |
| 보존·외부 동작 | 반영 후에도 알림 77건·작업 240건의 기존 전체 값·키 지문 동일. 새 추적 요청 0건, 시험 청소 데이터·추가 실발송·Calendar 쓰기 없음. 앞선 지정폰 수신 시험과 이번 반영 검증을 구분 |

추가한 열의 의미는 다음과 같다. **기존 예약·배정 값을 갱신하는 마이그레이션이 아니다.**

| 열 | 보관하는 근거 | 기존 행 |
| --- | --- | --- |
| `initial_delivery_state` | 준비·전송 중·접수·재시도·확인 불가·실패·취소 상태 | NULL/legacy 유지 |
| `initial_delivery_data` | 당시 요청·대상·일정 연결·시도·결과. 공개 응답에서 제외하는 서버 실행 기록 | NULL/legacy 유지 |
| `initial_accepted_at` | 공급자 접수가 확인된 시각. 응답 대기 시간의 기준 | NULL/legacy 유지 |

**남은 검증과 복구 경계**

1. 운영 관리자 비밀번호가 재열람 불가인 sensitive 설정이고, 로컬 자격증명·연결된 로그인 브라우저가 없어 **로그인 후 HTTP API 200과 실제 데이터 화면 대조는 미검증**이다. 인증 설정을 바꾸거나 우회용 계정을 만들지 않았다. 실제 SQL 실행 통과를 인증 포함 종단 검증으로 표시하지 않는다.
2. 반영 후 새 최초 요청은 아직 0건이다. 실제 신규 요청의 저장→접수 기록→응답 대기→후속 처리 전체는 자연 발생 또는 구체적으로 승인된 업무 시험에서 검증한다. 기존 77개 알림 재발송이나 임의 상태 전환으로 증거를 만들지 않는다.
3. 코드 복구 기준은 이전 운영 `0fc61f7`이다. 새 실행 기록이 생겼다면 구버전이 선점을 무시할 수 있으므로 진행/접수 기록·이전 발송자를 확인한 뒤 복구한다. 새 열 DROP·과거 NULL 재발송·데이터 스냅샷 덮어쓰기는 복구 절차가 아니다.
4. 후속 처리의 Vercel 설정은 morning/evening이며, 별도 경로와 일정 조회에 편승하는 실행도 있다. 이 기록만으로 30분 주기나 외부 실행기 존재를 보장하지 않는다. 스케줄 구조는 이번 반영에서 변경하지 않았다.

민감값 없는 상세 근거는 `/private/tmp/propos-act12-rollout-20261110/`의 `migration-result.json`, `deployment-status.json`, `ci-status.json`, `production-readonly-check.json`, `production-smoke.json`, `production-ui.log`와 각 QA 로그에 보관했다. 로그인 후 HTTP 검사의 접근 한계와 최초 로컬 파일명 가정 오류도 별도 기록으로 남겼다.
