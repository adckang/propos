# 통합 문서 동기화 작업 목록 (임시)

> 만든 날: 2026-11-26 · **임시 문서 — 다 끝나면 남은 항목만 `refactoring_mdfile.md`로 옮기고 이 파일은 지운다.**
> 대상: 루트 통합 문서 8개(`design_overview` `refactoring_mdfile` `refactoring_TC` `actor_ui_scenarios` `runtime_interfaces_and_collaboration` `error_observability` `documentation_traceability` `doc_plan`). 모두 2026-11-17 시점 사진이라 그 뒤의 리팩토링이 반영돼 있지 않다.
> 다른 세션에서 이어받을 때: 이 파일부터 읽고, 상태가 `할 일`인 가장 앞 단계부터 한다.

## 작업 방식

- **한 줄 = 한 항목.** 문서 · 고칠 것 · 근거 · 상태만 적는다. 무엇을 왜 고쳤는지는 커밋 메시지에 쓴다.
- **큰 줄기만 맞춘다.** `docs/` 아래 분야별 문서는 다시 전부 읽지 않는다. 판정 기준은 `docs/refactoring.md`의 5절(완료)·6절(정해진 규칙)이고, 코드는 그 항목을 확인하는 데 필요한 만큼만 본다. 분야별 문서에 남은 작은 낡은 표현은 이미 `refactoring_mdfile.md`의 MD-R에 기록돼 있으니 이번 범위에서 고치지 않는다(예외: SM-04, DEC-10의 정본이라서).
- **시점 숫자는 고쳐 쓰지 않고 지운다.** 테스트 수·console 개수·기준 커밋은 다시 낡는다. 필요하면 다시 세는 방법만 남긴다.
- **단계마다 커밋 하나, 커밋 전에 사용자 확인.** 저장소가 공개이므로 비밀값·노출 위치 상세를 쓰지 않는다.
- 항목이 끝나면 상태를 `완료 · 커밋`으로 바꾼다. 이름·정책을 새로 정해야 하는 항목은 `확인 필요`로 두고 묻는다.

## 단계 0 · 기준점

| ID | 할 일 | 상태 |
| --- | --- | --- |
| SM-00 | 8개 통합 문서와 이 파일을 지금 상태 그대로 커밋 — git에 없어서 고치다 틀려도 되돌릴 수 없다. 커밋 전에 비밀값이 없는지 훑는다 | 완료 · `36133ae` |

## 단계 1 · 지금 규칙과 반대로 읽히는 곳

| ID | 문서 | 고칠 것 | 근거 | 상태 |
| --- | --- | --- | --- | --- |
| SM-01 | refactoring_mdfile 3절 표 | "예약 기반 타임라인 vs 센서 기반 실제 상태 전환" → 상태는 예약·청소 일정, 센서는 기대한 일이 일어났는지 확인·안 되면 문제 | DEC-10 | 완료 · `6e883a7` |
| SM-02 | design_overview 5.0 그림 | `Events → Room` 화살표를 "문제·감지 기록"으로 | DEC-10 | 완료 · `6e883a7` |
| SM-03 | actor_ui SCN-06·SCN-07 | "도어 이벤트로 체크인 상태", "Pi가 센서로 숙소 상태 제공" → 입실·퇴실·청소 시각에 상태가 바뀌고 미감지는 문제 | DEC-10·16·17 | 완료 · `6e883a7` |
| SM-04 | docs/room-state-machine.md 0절 | "현재" 열의 "Pi 반영 전" 5곳 → 11-23 반영 완료, 머리말 버전·날짜(v2.5.1·11-14)를 0절 이후로 | `e5e8939` · ACT-19 `655b3c5` | 완료 · `6e883a7` |
| SM-05 | actor_ui 액터 ID | `ACT-01~05`·`ACT-S01~08`이 refactoring.md의 실행 작업 `ACT-01~22`와 겹침 → `AC-`로(사용자 선택) | — | 완료 · `6e883a7` |
| SM-06 | refactoring_TC 5.2 | 시험 수준 L0~L6이 기존 뜻(L0=자기 검증 금지 패턴, L1=단위, L2=계약 — 테스트 파일 26개·decisions.md)과 충돌 → 계획 쪽을 `T0~T6`로 바꾸고 대응표(사용자 선택) | refactoring.md 7절 | 완료 · `6e883a7` |
| SM-07 | refactoring_TC 4.2 · traceability TR-03 | 깨진 링크 `tests/integration/s36.cleaning-integration.test.js` → `tests/unit/` | ACT-08 `e169b09` | 완료 · `6e883a7` |
| SM-08 | runtime 3.3 | `POST /api/events → 201` → 운영에서 기본 주소는 404, Pi는 환경파일의 `/api/events/write`만 사용 | RF-06.4 · RF-55 | 완료 · `6e883a7` |
| SM-09 | runtime 2.1·3.5·SEQ-04 · actor_ui 2.3·3절·4.2·SCN-04 · design_overview 4.5 | 등록이 "문자 인증 → 전화번호로 덮어쓰기·새 담당자 생성" → 문자 인증 없이 관리자가 미리 저장한 전화번호·이메일이 둘 다 맞는 기존 담당자에만 앱 연결, 새 담당자는 만들지 않음, 살아 있는 앱 연결은 덮어쓰지 않음, 이메일은 안 바뀜 | DEC-09 `d098707` · `4ea6801`(11-26, 다른 세션) | 완료 · `6e883a7` |

## 단계 2 · 끝난 일을 끝났다고 표시

| ID | 문서 | 고칠 것 | 근거 | 상태 |
| --- | --- | --- | --- | --- |
| SM-10 | refactoring_mdfile MD-R05 | 결정 필요 → 종결. 구현 설명을 "판정 기록 없는 4개 지표 제외"로, 자동화 개선율은 별도 | DEC-02 `e6b214a` · RF-26 `a9c1d52` · RF-25 | 완료 · `61914d1` |
| SM-11 | MD-R26 · actor_ui LIMIT-01 · runtime IF-L01 · traceability TR-06·4절 | 인증 강제 "운영 확인 필요" → 운영 관측: 로그인 없는 보고서·청소 API·이벤트 조회가 401(11-10·11-12·11-14) | `git show ca41eb4:docs/refactoring.md` · event-ingestion-audit 10절 | 완료 · `61914d1` |
| SM-12 | MD-R07 · runtime IF-EXT07 · error 4.2 FCM 줄 | 알림 채널 "용어 분리" → 정책 확정(앱 푸시만, 문자 안 씀), 코드(`_notify.js`)는 아직 문자를 고를 수 있음 = 정책-코드 불일치 | ACT-11 규칙 | 완료 · `61914d1` |
| SM-13 | refactoring_mdfile MD-R12·14·15·19·22 | R12 종결, R14 거의 종결, R19·R22는 refactoring.md 206줄로 축소(report-architecture는 오히려 커짐), R15는 refactoring.md 7절 3단계 표시와 맞출지 | `36a2153` `5f132f3` | 완료 · `61914d1` |
| SM-14 | refactoring_mdfile 머리말·남은 MD-R | "기존 분야별 Markdown은 수정하지 않았다" → QA-01 1~4차에서 정정함. R02·03·04·06·08·09·10·11·13·16·21·25는 11-26 확인 결과 그대로 남음으로 표시 | `5f132f3` `36a2153` `43497b7` `1390a3e` | 완료 · `61914d1` |
| SM-15 | refactoring_TC 머리말·4.1·8·11절 | TC-R01·02 해결, TC-R03 부분(설명 정정·허락 없이 안 돎, 읽기/쓰기 분리는 아직), "테스트 리팩터링 미실행" → ACT-08이 복사 테스트 12개·소스 글자 검사 8개를 실제 코드 시험으로 바꿈. 남은 결정은 2~4번과 s37 파일 위치. 9절 규칙 2개 추가(안전 결함은 RF로, 테스트는 실제 코드 실행) | RF-42 `c58fbdd` · RF-43 `86afce1` · ACT-08 | 완료 · `61914d1` |
| SM-16 | refactoring_TC 3.2·3.3 | `test:e2e`의 "live 파일과 충돌" 삭제, `test:connectivity`(명시적 허락) 줄 추가, 데모 전용 e2e 서버 안전장치 추가 | RF-42·43 | 완료 · `61914d1` |
| SM-17 | runtime SEQ-06·IF-L05 | "s34는 자기 재구현 한계" 삭제 — s34는 실제 정기 작업 핸들러를 실행 | ACT-08 | 완료 · `61914d1` |
| SM-18 | doc_plan 3절 | 수정 가능 목록에 `refactoring_TC.md`·이 파일 추가, "분야별 문서 수정 금지"를 실제(QA-01로 정정됨)에 맞게 | — | 완료 · `61914d1` |
| SM-19 | traceability TR-05·4절 | 정책 근거 D-026 → DEC-02·RF-26, 우선 갭 2번(안심지수) 정리 | DEC-02 | 완료 · `61914d1` |

## 단계 3 · 빠진 큰 흐름 추가 (상세는 design_overview·runtime에만, 나머지는 링크)

| ID | 문서 | 고칠 것 | 근거 | 상태 |
| --- | --- | --- | --- | --- |
| SM-20 | design_overview 2절 | 운영 원칙 3개(상태=일정·예외는 사람에게·알림은 필요할 때) 한 줄+링크, Pi→운영자 넘김(Slack + HA 앱), 서버→Pi 예약·청소 일정 전달, CSP 차단 모드 | DEC-10~12·16 · RF-27·52 · RF-47 | 완료 · `11202c2` |
| SM-21 | design_overview 3절 | `server/`에 Pi에서 도는 워처 코드(`occupancyWatcher.js` 등, 시작은 `scripts/occupancy-watcher-standalone.mjs`)와 이상 감지 모듈이 함께 있음 — Pi 반영은 따로 | RF-25 · refactoring.md 8절 | 완료 · `11202c2` |
| SM-22 | design_overview 4.3 | `/api/cleaning/anomaly-policy`, 이벤트 저장 때 이상 감지, Gmail 웹훅의 게스트 불만 분류, 저녁 정기 작업의 담당자 하루 전 알림 | RF-25 · DEC-21 · ACT-18 | 완료 · `11202c2` |
| SM-23 | design_overview 5.0 | 원장에 숙박·청소 의무, 배정 이력, 이상 기록 추가 | DEC-22·23·24 | 완료 · `11202c2` |
| SM-24 | design_overview 7절 | `docs/runbooks/pi-watcher-rollout.md` 추가. CLAUDE.md 줄(MD-R01만 남음), refactoring.md 줄(목록만, 11-19 이전 상세는 `ca41eb4`), data-storage 줄(Blob 미구현), decisions 줄(이후 결정은 DEC-01~24) | D-014 현재 상태 | 완료 · `11202c2` |
| SM-25 | runtime 6.2·5절 | 정기 작업 트리에 Pi 예약 전달(아침·저녁)·하루 전 알림(저녁)·청소 미배정 이상 기록. 새 흐름 2개: Pi가 확인 못 함→운영자, 서버→Pi 일정 | RF-27·52 · ACT-18 · DEC-11·16 | 완료 · `11202c2` |
| SM-26 | error 4.2·5.3 | 재시도·개입 표에 확인 안 되면 기기 제어 없이 운영자에게·센서 사전 점검·IR 토글 복구 1회·이상 중복 방지. 업무 기록 표에 이상 기록·배정 이력 | DEC-11·12·23 · ACT-21 | 완료 · `11202c2` |
| SM-27 | traceability | RF-25 이상 감지 TR 신설, TR-01에 DEC-10, TR-04에 DEC-09·ACT-11, TR-08에 ACT-20·21·DEC-19 | — | 완료 · `11202c2` |
| SM-28 | refactoring_mdfile 용어표 | "노쇼 의심"→"입실 미감지", 새 문제 이름(퇴실 지연·확인 불가·청소 미감지·청소 미배정(취소)), 안심지수 vs 자동화 개선율 | DEC-15~17 · DEC-02 | 완료 · `11202c2` |
| SM-29 | actor_ui SCN-06 | 운영 시나리오 실제 범위 연결(입·퇴실 감지는 현관 센서 고장으로 지금 불가) | DEC-04 | 완료 · `11202c2` |

## 단계 4 · 시점 숫자 지우기

| ID | 문서 | 고칠 것 | 상태 |
| --- | --- | --- | --- |
| SM-30 | refactoring_TC 3.1·4.2·10절 | 파일 수·줄 수·중복 번호 수·"144개" 삭제, 다시 세는 방법만 | 할 일 |
| SM-31 | error 5.1 | console 호출 개수 표 삭제 | 할 일 |
| SM-32 | 8개 문서 머리말 · doc_plan 6절 | "기준일 2026-11-17"·기준 커밋 → "마지막 동기화: 날짜 · 이 파일" 한 줄 | 할 일 |
| SM-33 | 마무리 | 남은 `확인 필요` 항목을 refactoring_mdfile.md로 옮기고 이 파일 삭제 | 할 일 |
