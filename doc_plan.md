# PROPOS 통합 도큐멘테이션 유지보수 계획

> 상태: DP-00~DP-08 완료  
> 최초 작성: 2026-11-16 · 중복 제거 갱신: 2026-11-17 · 동기화(DP-08): 2026-11-26 (Asia/Seoul)  
> 목적: 완성 문서의 내용을 복제하지 않고, 문서 소유권·작업 순서·검증 결과만 관리한다.  
> 단일 시작점: [design_overview.md](design_overview.md)  
> 문서 충돌·중복 대장: [refactoring_mdfile.md](refactoring_mdfile.md)  
> 실제 소스 리팩터링 상태: `docs/refactoring.md` — 이 계획의 수정 대상이 아님  
> 검색 키워드: `[DOC-PLAN]` `[OWNER]` `[PHASE]` `[VALIDATION]` `[DP-07]`

---

<a id="plan-goal"></a>

## 1. 목표 [DOC-PLAN]

처음 보는 사람은 다음 순서로 이해한다.

```text
사람과 목적 → 화면과 행동 → 시스템 협업 → 데이터 → 코드 → 오류·운영 근거
```

이 파일은 위 내용을 설명하지 않는다. 각 내용을 소유하는 문서와 유지보수 순서만 정한다.

---

<a id="ownership"></a>

## 2. 문서 소유권 [OWNER]

| 정보 | 유일한 상세 소유 문서 | 다른 문서의 허용 내용 |
| --- | --- | --- |
| 전체 메뉴·상위 구조·문서 색인 | [design_overview.md](design_overview.md) | 시작 링크만 제공 |
| 액터·권한·UI·사용 시나리오 | [actor_ui_scenarios.md](actor_ui_scenarios.md) | 시나리오 ID와 링크만 제공 |
| API·외부 인터페이스·Sequence·cron | [runtime_interfaces_and_collaboration.md](runtime_interfaces_and_collaboration.md) | 상위 경계와 링크만 제공 |
| 예외·재시도·로그·Slack·마스킹 | [error_observability.md](error_observability.md) | 오류 계약 링크만 제공 |
| 정책→코드→데이터→테스트 근거 | [documentation_traceability.md](documentation_traceability.md) | TR ID와 링크만 제공 |
| 문서 충돌·중복·모호성 | [refactoring_mdfile.md](refactoring_mdfile.md) | MD-R ID와 링크만 제공 |
| 문서 작업 단계·검증 이력 | [doc_plan.md](doc_plan.md) | 진행 상태를 다른 문서에 복제하지 않음 |
| 소스 리팩터링 작업 상태 | `docs/refactoring.md` | 통합 문서는 링크만 제공 |

### 중복 판정 기준

다음 중 하나면 중복 후보로 본다.

1. 같은 상태표·시나리오·API 계약·Sequence가 둘 이상의 문서에 존재한다.
2. 같은 코드·테스트 매핑 표가 상세 문서와 추적 문서에 함께 존재한다.
3. 허브가 상세 문서의 본문을 다시 설명한다.
4. 계획서가 완성 문서의 목차·요구사항·체크리스트를 계속 보존한다.
5. 날짜·커밋·테스트 수 같은 시점 값이 여러 문서에서 현재값처럼 반복된다.

중복처럼 보여도 데이터 원장과 외부 원천, 인증 역할과 업무 역할처럼 의미가 다른 구조는 합치지 않는다.

---

<a id="boundary"></a>

## 3. 작업 경계

### 수정 가능

- `design_overview.md`
- `actor_ui_scenarios.md`
- `runtime_interfaces_and_collaboration.md`
- `error_observability.md`
- `documentation_traceability.md`
- `refactoring_mdfile.md`
- `refactoring_TC.md`
- `doc_plan.md`
- 동기화 작업 중에만 두는 임시 작업 목록(DP-08의 `sync_md.md`처럼 — 끝나면 지운다)

### 수정 금지

- 제품 소스·테스트·설정·DB
- Claude가 작업하는 `docs/refactoring.md`
- 기존 분야별 Markdown — 정정은 `docs/refactoring.md`의 작업으로 한다(ACT-08 QA-01 1~4차, 2026-11-19가 그렇게 했다). 예외: 통합 문서가 따르는 규칙의 정본이 틀렸을 때만 최소로 고친다(DP-08의 SM-04 — `room-state-machine.md` 0절의 Pi 반영 표시)
- 제품 동작·정책·UI 문구

기존 분야별 Markdown의 중복은 [MD-R16~20](refactoring_mdfile.md#duplicates)에서 기록만 하고, 별도 승인 전에는 수정하지 않는다.

---

<a id="phases"></a>

## 4. 실행 단계 [PHASE]

| 단계 | 결과 | 상태 |
| --- | --- | --- |
| DP-00 | 저장소·문서·코드·다이어그램 인벤토리 | 완료 |
| DP-01 | 액터·권한·UI·시나리오 문서 | 완료 |
| DP-02 | 런타임 인터페이스·협업 문서 | 완료 |
| DP-03 | 오류·재시도·관측 문서 | 완료 |
| DP-04 | 추적성·MD-R 연결 | 완료 |
| DP-05 | 단일 허브 조립 | 완료 |
| DP-06 | 링크·앵커·Mermaid·범위 검증 | 완료 |
| DP-07 | 통합 문서 중복 제거·소유권 고정 | 완료 |
| DP-08 | 2026-11-17 이후 리팩토링 결과와 통합 문서 동기화 | 완료 · 2026-11-26 |

### DP-07 · 2026-11-17

수행 내용:

1. 허브의 상세 Sequence, S01~S05 구현 목록, 명령 목록을 제거하고 소유 문서 링크로 바꿨다.
2. 액터·런타임·오류 문서의 단계 완료 체크리스트와 반복 테스트 근거표를 제거했다.
3. 런타임 문서의 데이터 계보 복제본을 제거하고 허브의 상위 계보를 참조하게 했다.
4. 이 계획서를 완성 문서의 장문 명세에서 소유권·단계·검증 기록 중심으로 축소했다.
5. [MD-R29](refactoring_mdfile.md#md-r29)에 통합 문서 중복의 판정과 정리 결과를 기록했다.

기존 분야별 Markdown은 수정하지 않았다. 남은 구조 중복은 MD-R16~20의 승인 대상이다.

### DP-08 · 2026-11-26

2026-11-17 이후 끝난 리팩토링(DEC-02·09~24, RF-25·42·43, ACT-08, 담당자 앱 등록 단순화 `4ea6801`)을 통합 문서 8개에 반영했다. 임시 작업 목록 `sync_md.md`(SM-00~33)로 단계마다 커밋하며 진행했고, 끝난 뒤 목록 파일은 지웠다. 목록 전체는 `git show 09c582e:sync_md.md`로 볼 수 있다.

| 단계 | 내용 | 커밋 |
| --- | --- | --- |
| 0 | 고치기 전 상태 그대로 처음 커밋(그때까지 git에 없었음) | `36133ae` |
| 1 | 지금 규칙과 반대로 읽히는 곳 — 상태 = 일정, 액터 번호 `AC-`·시험 수준 `T0~T6`, 깨진 링크, 이벤트 수신 주소, 담당자 앱 등록 | `6e883a7` |
| 2 | 끝난 일 표시 — MD-R05·12·14 종결, MD-R07·26 판정, TC-R01·02 해결, s34 한계 삭제, 이 계획의 수정 범위 | `61914d1` |
| 3 | 빠진 큰 흐름 — 운영 원칙, 서버→Pi 일정, Pi→운영자 넘김(SEQ-07), Pi 코드 위치, 이상 감지(TR-13), 재시도·개입 규칙, 용어 | `11202c2` |
| 4 | 시점 숫자 삭제, 머리말을 "마지막 동기화"로 | `4ad1abb` |

방식: 판정은 `docs/refactoring.md` 5절(완료)·6절(정해진 규칙)만 기준으로 하고, 코드는 그 항목 확인에 필요한 만큼만 봤다. 분야별 문서는 다시 전부 읽지 않았고 SM-04(`room-state-machine.md` 0절의 Pi 반영 표시) 하나만 고쳤다. 다음 동기화도 같은 방식으로 한다 — 임시 목록 → 단계마다 커밋 → 끝나면 목록 삭제, 기록은 DP 항목에.

문서 범위 밖에서 발견해 고치지 않은 것(필요하면 `docs/refactoring.md`에 등록):

- 문자 발송 경로가 코드(`server/cleaning/_notify.js`)에 남아 있다 — 정책은 앱 푸시만(ACT-11). [MD-R07](refactoring_mdfile.md#md-r07)
- 담당자 앱 첫 연결 때 나가는 Slack 문구가 "대시보드에서 이름·등급 지정 필요"라고 한다. 지금은 관리자가 담당자를 먼저 만들기 때문에 맞지 않는다(외부 발송 문구라 확인 필요).
- `src/domain/operationalMetricsDomain.js` 주석이 자동화 개선율을 "아직 계산하지 않음"이라고 하지만, RF-25로 정본 5가지 측정 연결이 끝났다.

---

<a id="maintenance-flow"></a>

## 5. 이후 유지보수 순서

```text
변경 사실 확인
  → 상세 소유 문서 1개 수정
    → documentation_traceability.md의 관련 TR 갱신
      → 충돌이 생긴 경우에만 refactoring_mdfile.md에 MD-R 추가
        → design_overview.md 메뉴·링크 검증
```

- 같은 내용을 다른 문서에 붙여 넣지 않는다.
- 요약이 필요하면 한 문장과 링크만 둔다.
- 테스트 목록은 추적성 문서가, 실행 명령은 README/package.json이 소유한다.
- 완료 체크리스트는 이 계획의 단계 기록에만 둔다.
- 구현·배포·운영 관측·제안을 서로 다른 근거로 표시한다.

---

<a id="validation"></a>

## 6. 검증 기준 [VALIDATION]

매 문서 변경 후 다음을 확인한다.

1. 로컬 파일 링크와 Markdown fragment가 존재한다.
2. 명시적 앵커와 H1이 중복되지 않는다.
3. Mermaid fence·diagram type·괄호와 화살표 방향이 맞는다.
4. 동일 표·다이어그램·체크리스트가 다른 통합 문서에 다시 생기지 않았다.
5. `CURRENT`, 정책, 날짜가 붙은 운영 관측, `TARGET · 미구현`이 섞이지 않았다.
6. 허용된 Markdown 외 파일을 수정하지 않았다.

### 최신 검증 기준점

| 항목 | 값 |
| --- | --- |
| 대조한 코드 | `f6a5017` · 2026-11-26 (DP-08 — 이 시점 코드와 문서를 대조. 이전 기준 `1f51a45`, 2026-11-17) |
| 검증일 | 2026-11-26 (Asia/Seoul) |
| Markdown 인벤토리 | 45개 · `.git`, `node_modules`, 보조 도구 `venv`, 생성·시험 디렉터리 제외 (11-17 이후 `refactoring_TC.md`·`docs/runbooks/pi-watcher-rollout.md` 추가) |
| Mermaid renderer | 저장소에 없음 · 정적 문법 검토만 수행 |
| 변경 범위 | DP-08: 통합 문서 8개 + `docs/room-state-machine.md` 0절(SM-04 예외) |

실제 배포 환경값·외부 계정·실기 수신 상태는 별도 운영 근거 없이는 확정하지 않는다.

---

<a id="next-action"></a>

## 7. 다음 작업

통합 문서 내부 중복 제거(DP-07)와 2026-11-26까지의 동기화(DP-08)는 완료됐다. 다음 후보는 기존 분야별 문서의 [MD-R16~20](refactoring_mdfile.md#duplicates)이지만, 현재 수정 금지 범위이므로 승인 전에는 실행하지 않는다.

새 코드·정책 변경이 생기면 [5. 이후 유지보수 순서](#maintenance-flow)에 따라 상세 소유 문서 하나부터 갱신한다.
