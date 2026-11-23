# PROPOS 이벤트 감지 설계
> 버전: v1.0 | 작성: 2026-07-13
> 구현 기준 문서 — 이 파일을 축으로 삼아 코드를 작성·수정한다.

---

## 1. 철학

**상태는 스케줄이 정하고, 감지는 그 스케줄 안에서 기대한 일이 일어났는지를 본다.** (정본: `room-state-machine.md` 0절)
퇴실·입실처럼 예약이 정한 시각이 되면 상태는 스케줄대로 바뀐다. 이 감지기는 그때 손님이 실제로 나갔는지·들어왔는지를 확인하고, 확인되지 않으면 문제로 남긴다. 기기 제어는 감지로 확인됐을 때만 자동으로 하고, 확인되지 않으면 운영자에게 넘긴다.

**의심(Suspicion) → 확신(Confirmation) 2단계 모델** — 감지 자체(나갔는지·들어왔는지)를 판단하는 방법

센서만으로는 절대적 확신을 줄 수 없다.
"나간 것 같다"는 의심 상태를 기록하고,
시간·외부 확인 등 추가 조건이 충족될 때 비로소 상태를 전환한다.

확실한 데이터의 예:
- 게스트 메시지: "퇴실했어요" / "들어왔어요"
- 운영자 CCTV 확인
- 도어락 PIN 입력 이벤트 (미래 연동)

---

## 2. 3계층 파이프라인

```
Raw Sensor (30초 폴링)
        │  snap: { doorOpen, motionDetected, presenceEvidence, acPower, noiseLevel, ... }
        ▼
[Layer 1: SensorEventGenerator]
  원시 센서 → EXIT / ENTRY 시맨틱 이벤트 조합
        │  { exit, exitAt, entry, entryAt }
        ▼
[Layer 2: SuspicionTracker]
  EXIT/ENTRY + 예약시각 + 현재상태 → 의심 기록 → 확신 이벤트 생성
        │  전환: scheduled_checkout_reached / scheduled_checkin_reached / cleaning_started / cleaning_finished
        │  확인(기기 제어만): checkout_confirmed / checkin_confirmed
        │  문제: late_checkout_detected / checkin_not_detected / detection_unconfirmable
        │  soft: checkout_confirmation_needed(early_checkout) / early_checkin_suspected
        ▼
[Layer 3: OccupancyMonitor.process()]
  기존 이벤트(smoke/noise/energy/environment) + 새 이벤트 통합 반환
        │  events[]
        ▼
[Dispatcher: occupancyWatcher.js]
  isValidTransition() → getNextRoomState() → 상태 전환
  soft events → ConfirmationManager (메시지 발송, 미래 구현)
```

---

## 3. Layer 1 — EXIT / ENTRY 정의

### EXIT (나감)
```
조건 순서 (모두 충족):
  ① 문 열리기 직전 N분 이내 모션 있었음   (누군가 있었다)
  ② 문 열림 → 닫힘 이벤트              (나갔다)
  ③ 문 닫힌 후 N분간 모션 없음          (돌아오지 않았다)

파라미터:
  EXIT_LOOKBACK_MIN   = 5   (①: 모션이 얼마나 최근이어야 하는가)
  EXIT_NO_MOTION_MIN  = 5   (③: 모션 없음 지속 시간)
```

### ENTRY (들어옴)
```
모션 경로 (모두 충족):
  ① 문 열림 → 닫힘 이벤트              (들어왔다)
  ② 이후 모션 감지                      (실내 있음)
  ③ 모션 N분 이상 지속                  (머물고 있다)

사람 조작 경로 (모션 센서가 꺼져 있어도 사용):
  ① 문 열림
  ② 그 뒤 스위치·조명·플러그·물리 버튼의 새 조작 기록
  ③ 문 닫힘                             (②는 문이 닫힌 직후여도 됨)

파라미터:
  ENTRY_SUSTAINED_MIN = 3   (③: 모션 지속 시간)
```

- 사람 조작 경로는 기기의 켜짐 상태 자체가 아니라 HA `last_changed`가 문이 열린 뒤인 새 기록만 쓴다. HA 사용자·자동화 문맥(`context.user_id`·`parent_id`)이 붙은 변경은 제외한다. Smart Life가 문맥 없이 보낸 원격 조작은 물리 조작과 구분할 수 없다.
- 문 동작 없는 조작은 ENTRY가 아니다. 이 보조 경로는 입실·청소 담당자가 들어온 것만 확인하며, 사람이 나간 것으로는 쓰지 않는다.

### 취소 조건
```
EXIT 후보 취소: ③ 완료 전 모션 또는 문 뒤 사람 조작 감지 → "나갔다가 돌아옴"
ENTRY 후보 취소: ③ 완료 전 모션이 EXIT_NO_MOTION_MIN 이상 없음 → "잠깐 들어왔다가 나감"
```

---

## 4. Layer 2 — SuspicionTracker 이벤트별 로직

### 4-A. scheduled_checkout_reached · late_checkout_detected (RF-29, DEC-08)

> DEC-11(2026-11-22): 퇴실이 확인되지 않은 전환에서는 청소 모드 기기 제어를 자동으로 하지 않고 운영자에게 넘긴다. 센서가 꺼져 판단할 수 없으면 `퇴실 지연`이 아니라 `확인 불가`.

객실 상태는 예약 체크아웃 시각을 기준으로 바꾼다. 실제 퇴실(EXIT) 확인은 전환을 늦추지 않고, 확인되지 않으면 문제로만 남긴다.

```
OCCUPIED 상태에서:

[checkOut 전 EXIT]         → CHECKOUT_SUSPECTED 기록 (상태 변경 없음)
[CHECKOUT_SUSPECTED + ENTRY] → 의심 취소 (나갔다가 다시 돌아옴)

[checkOut 시각 도래 — 예약당 1회]
  → scheduled_checkout_reached (발생 시각 = 예약 checkOut) → CLEANING / CLEANING_PENDING
  퇴실 확인 = 그 판정의 EXIT, 또는 CHECKOUT_SUSPECTED + 지금 모션 없음
  확인되지 않았으면 CHECKOUT_GRACE_MIN 동안 EXIT를 더 기다린다 (상태와 무관)
    — EXIT는 문 닫힘 + EXIT_NO_MOTION_MIN 뒤에 확정되므로 정시에 나간 손님도 전환 순간엔 미확인일 수 있다

[전환 때 이미 퇴실 확인]  → data.exitConfirmed = true — 전환과 함께 청소 모드 기기 제어
[유예 안에 EXIT 확인]     → checkout_confirmed — 그때 청소 모드 기기 제어 (청소 대기일 때만)
[checkOut + GRACE 경과, 미확인] → late_checkout_detected 1건 (발생 시각 = 예약 checkOut, 상태 변경 없음) + 운영자에게
                              ("청소 모드를 켜지 않았어요. 확인 후 직접 켜 주세요", Slack + HA 앱). 기기 제어 없음
[전환 때·유예 끝에 감지 센서 꺼짐] → detection_unconfirmable(phase checkout, cause sensor_off) — 지연으로 단정하지 않음.
                              센서가 꺼져 있으면 "움직임 없음"도 퇴실 확인이 아니다
[유예가 지난 뒤 처음 판정]  → 전환 + detection_unconfirmable(cause not_observed) — 워처가 꺼져 있던 구간은 보지 못했다
[유예 끝, 입실이 끝내 확인되지 않은 체류] → detection_unconfirmable(cause not_entered) — 노쇼일 수 있어 퇴실 지연이 아니다
```

- "같은 퇴실" = 예약 uid + checkOut 시각. 연장으로 checkOut이 바뀌면 새 시각에 다시 전환한다.
- 퇴실을 확인할 수 없어 운영자에게 넘길 때는 현재 체류에서 마지막으로 본 사람 조작 시각·기기 이름을 함께 준다. 이 단서는 판단 자료일 뿐 EXIT로 자동 확정하지 않는다.
- 판정 상태(유예·입실 기다림, 처리한 예약, 조기 입실, 마지막 판정 시각)는 워처 상태 파일(`monitor`)에 저장한다 — 재시작해도 이어진다. 깨진 값은 버린다.
- 워처 시작은 HA 기록을 다시 읽지 않는다. 그래서 되살린 기다림이 있는데 마지막 판정에서 10분 넘게 지났으면(또는 그 시각이 저장돼 있지 않으면) 그동안의 퇴실·입실을 놓쳤을 수 있다 — 그 기다림은 끝까지 판정하지 않고 `not_observed` 확인 불가로 넘긴다(그사이 확인되면 그대로 확인).
- "같은 체류" = 예약 uid + checkIn 시각. 퇴실 처리한 체류는 늦게 연장돼도 다시 입실로 만들지 않는다(uid가 없는 예약도).
- 체류 중인데 보유 예약의 checkIn이 아직 미래면(전환 전에 예약이 바뀐 경우) 자동으로 바로잡지 않는다 — 체류 중 재시작은 상태·기기를 건드리지 않는다(s103). 운영자가 상태를 바꾸면 대기 중인 예약도 그때 쓴다.

- 예전의 Case A(`checkout_confirmation_needed` / `late_checkout`, 게스트 확인 요청)는 퇴실 지연 문제로 대체했다.
- Pi가 퇴실 전환 전에 다음 예약이나 "예약 없음"을 받으면 지난 예약을 전환이 끝날 때까지 보존한다(`planMonitoringReservationUpdate`).
- 옛 `check_out_detected` 기록은 같은 전환·건수로 계속 읽는다.

### 4-B. scheduled_checkin_reached · checkin_not_detected (DEC-10·11·16)

객실 상태는 예약 체크인 시각을 기준으로 바꾼다(퇴실과 같은 원칙). 실제 입실(ENTRY)은 "손님이 들어왔는가"만 본다.

```
공실(정비 중 제외)·입실 준비·청소 중 상태에서 (체크아웃이 아직 안 지난 예약):

[checkIn 전 ENTRY (입실 준비 중, 또는 2시간 안의 공실)] → early_checkin_suspected (soft). 입실 시각에 확인된 입실로 본다
                                  (그 체류의 것만 — 다른 예약 때 본 조기 입실은 쓰지 않는다. 그보다 이른 공실 입장은 운영자·청소일 수 있어 세지 않는다)

[checkIn 시각 도래 — 예약당 1회]
  → scheduled_checkin_reached (발생 시각 = 예약 checkIn) → OCCUPIED / GOOD_CONDITION
  확인된 입실(조기 ENTRY 또는 그 판정의 ENTRY) → data.entryConfirmed = true — 전환과 함께 체류 기기 제어
  확인되지 않았으면 그날(한국 날짜) 자정까지 ENTRY를 기다린다 (입실 시각 + NO_SHOW_WINDOW가 더 늦으면 그때까지)

[기다리는 중 ENTRY]           → checkin_confirmed — 그때 체류 기기 제어(조명·TV, 에어컨은 입실 준비가 맡음) + 입실 준비에 도착 기록
[자정까지 미확인]             → checkin_not_detected 1건 (발생 시각 = 예약 checkIn, data.deadline = 기다린 시각) + 운영자에게("기기 상태를 직접 확인해 주세요")
[입실 시각·자정에 입실 감지 경로가 없음] → detection_unconfirmable(phase checkin, cause sensor_off) — 문 센서와, 움직임 또는 사람 조작 기기 중 하나도 쓸 수 없을 때. 미감지로 단정하지 않음
[자정이 지난 뒤 처음 판정]     → 전환 + detection_unconfirmable(cause not_observed)
[기다리는 중 예약 취소·변경]    → 판정하지 않음
```

- 입실이 확인되기 전엔 빈방이다 — 체류 중 점검(에너지 낭비·환경·소음)을 하지 않는다(입실 준비로 켠 에어컨이 "체류 중 에너지 낭비"로 잡히지 않게). 연기·장시간 문 열림은 한다.
- 자정이 지나 늦게 들어오거나 확인 불가 뒤에 들어온 것이 보이면 그때 입실로 확인한다(`checkin_confirmed` — 체류 기기 제어, 체류 중 점검 다시 시작). 이미 남긴 문제 기록은 그대로다.
- 청소 중(또는 청소 대기인데 누가 들어와 있음)에 입실 시각이 되면 안에 있는 사람은 청소 담당자일 수 있다 — 그 순간의 입장은 세지 않고, 누가 나가는 것(EXIT)을 본 뒤 들어온 것만 손님으로 본다. 아무도 없는 청소 대기면 들어온 사람을 바로 손님으로 본다.
- 입실 준비(냉방)는 체류로 바뀌어도 계속한다. 손님을 **기다리는 중**(입실 시각에 센서가 정상이었고 아직 안 옴)이면 체류 상태에서도 준비를 시작할 수 있다(상태는 바꾸지 않는다). 센서가 꺼져 확인할 수 없는 체류에선 안에 사람이 있을 수 있어 준비 제어(조명 끄기 포함)를 시작하지 않는다(DEC-11).
- 기다리는 중에 운영자가 상태를 바꾸면(정비·청소 시작 등) 그 판단을 따른다 — 기다림을 끝내고 자정·유예 끝에 문제를 내지 않는다.
- 기다리는 동안엔 일이 없어도 2분마다 판정 상태를 저장한다 — 재시작 뒤 "마지막으로 본 시각"이 실제 꺼져 있던 시간을 가리키게.
- 이미 퇴실 처리한 예약이 늦게 연장돼도 새 입실이 아니다(같은 예약을 두 번 입실로 세지 않는다).
- 예약에 체크인 시각이 없으면 전환하지 않는다(스케줄이 없다). 옛 `check_in_detected` 기록·화면 경로는 같은 전환·건수로 계속 읽는다. 옛 `no_show_suspected`(soft)는 `checkin_not_detected`로 바뀌었다.

### 4-C. 청소 — scheduled_cleaning_started · scheduled_cleaning_finished · cleaning_not_detected (RF-52, DEC-10·17)

서버가 정기 작업 때 예약과 함께 **그 예약의 퇴실에 딸린** 청소 일정을 Pi에 보낸다(`pickCurrentCleaning` — 청소 번호·퇴실 시각·시작·끝(비면 숙소 청소 소요 시간)·배정 완료 여부. 끝난 청소·다른 퇴실의 청소는 보내지 않는다). Pi는 **그 퇴실의 청소 일정일 때만**(일정의 퇴실 시각 = 처리한 퇴실 시각) 일정대로 상태를 바꾼다.

```
청소 대기(퇴실 처리 뒤)에서, 그 퇴실의 청소 일정이 있으면:

[시작 시각]  → scheduled_cleaning_started (발생 시각 = 시작 시각) → CLEANING / CLEANING_IN_PROGRESS. 기기 제어 없음(청소 모드는 퇴실 때 정한다)
[끝 시각]    → scheduled_cleaning_finished (발생 시각 = 끝 시각) → VACANT / CLEANING_FINISHED
               담당자가 나간 것을 봤으면(data.vacantConfirmed) 공실 기기 제어(전체 끄기·잠금). 아니면 하지 않는다 — 안에 있을 수 있다
               배정된 청소인데 퇴실 뒤 끝 시각까지 아무도 들어오지 않았으면(운영자가 시작을 누르지도 않음) → cleaning_not_detected (발생 시각 = 시작 시각) + 운영자에게
               그동안 입실 감지 경로가 한 번이라도 없었으면 → detection_unconfirmable(phase cleaning, sensor_off, 발생 시각 = 끝 시각),
               감시가 멈춰 있었으면(재시작 뒤 10분 넘게 못 봄, 또는 시작 시각보다 한참 뒤에야 기다리기 시작) not_observed
[끝 시각 뒤 1시간 안에 담당자가 나감] → cleaning_vacant_confirmed — 그때 공실 기기 제어
[끝 시각 뒤 1시간 안에 나가는 것을 못 봄] → detection_unconfirmable(phase cleaning, exit_not_seen) — 공실 기기 제어를 하지 않은 채 운영자에게
[나갔던 담당자가 끝 시각 전에 다시 들어옴] → 아직 안에 있는 것으로 본다(공실 기기 제어 안 함)

실제 청소 시각(상태를 바꾸지 않는 기록, 청소시간 준수 지표):
[ENTRY + 모션 CLEANING_SUSTAINED_MIN 지속] → cleaning_activity_started  (짧은 방문은 취소)
[그 뒤 EXIT + CLEANING_DONE_QUIET_MIN 조용] → cleaning_activity_finished (재입실은 취소). 끝 시각 뒤 1시간까지 본다
```

- 배정되지 않은 청소(요청 중·실패·취소)는 담당자 미감지를 판정하지 않는다 — 서버가 이미 `청소 미배정`으로 남긴다.
- 운영자가 화면에서 청소 시작·완료를 누르면 그 판단을 따른다: 시작 = 실제 청소 시작으로 본다, 완료 = 공실로 바꾸고 일정 판정을 끝낸다. 정비 등 다른 상태로 바꿔도 판정하지 않는다.
- 일정 판정(기다림·실제 청소 단계·처리한 청소)은 워처 상태 파일에 저장 — 재시작해도 이어지고, 10분 넘게 못 봤으면 `not_observed`.
- 청소 중에 담당자가 안에 있는 채 입실 시각이 되면 나가는 것을 본 뒤에 들어온 사람만 손님으로 본다(4-B).

**청소 일정이 없을 때(예전 방식)** — 그 퇴실의 일정이 없거나 읽을 수 없으면 감지로 전환한다:

```
CLEANING_PENDING: [ENTRY + 모션 CLEANING_SUSTAINED_MIN 지속] → cleaning_started → CLEANING_IN_PROGRESS (짧은 방문은 취소)
CLEANING_IN_PROGRESS: [EXIT + CLEANING_DONE_QUIET_MIN 조용] → cleaning_finished → VACANT (재입실은 취소)
```

- 청소시간 준수(3시간)의 초과 건은 실제 청소 시각(`cleaning_activity_*`와 일정 없을 때·운영자 수동·옛 `cleaning_started`/`cleaning_finished`)으로 잰다 — 숙소마다 시간 순서로 "시작 → 그 뒤 첫 끝"을 짝짓고, 짝 없는 끝(같은 청소의 감지된 끝 + 운영자 완료)과 끝을 못 본 시작은 버린다. 일정 전환은 쓰지 않는다.
- 공실이 된 횟수(청소 완료 수 — 빈방 지표·청소시간 준수의 분모)는 `scheduled_cleaning_finished`와 `cleaning_finished`로 센다. 실제 청소 끝 기록은 같은 청소를 두 번 세지 않게 넣지 않는다.

### 4-E. 감지 센서 사전 점검 · sensor_precheck_failed (DEC-12)

퇴실 확인은 숙소 구역의 문(`door`)·움직임(`motion`) 센서가 모두 필요하다. 입실·청소 담당자 입장 확인은 문 센서와, 움직임 또는 사람 조작 기기(스위치·조명·플러그·물리 버튼) 중 하나가 필요하다(DEC-18). 필요한 감지 경로가 꺼진 것을 시간 간격으로 반복해 알리지 않고, 그 센서가 **필요해지기 전에** 미리 점검한다(`src/domain/sensorHealthDomain.js`, 워처의 매 주기). 객실 상태·문제 건수는 바꾸지 않는다.

```
[퇴실·입실 하루 전, 2시간 전 — 각각 한 번]  지금 예약과 체류 중 미뤄 둔 다음 예약의 앞으로의 퇴실·입실 시각 기준
  퇴실: 문·움직임 센서가 unavailable이거나 없음
  입실: 문 센서를 쓸 수 없거나, 움직임·사람 조작 기기를 모두 쓸 수 없음
    → sensor_precheck_failed (soft) + 운영자 알림 "○○ 2시간 전 점검 — 꺼져 있는 센서: … 그 전에 확인해 주세요"
  워처가 꺼져 있어 두 점검 시각이 모두 지났으면 늦은 쪽(2시간 전)만 한다
[퇴실·입실 그 시각에도 꺼져 있음] → detection_unconfirmable (4-A·4-B)
```

- `unknown`만으로는 꺼짐이 아니다 — 값이 바뀔 때만 보고하는 센서는 HA 재시작 뒤 한동안 `unknown`이지만 고장이 아니다. 구역 상태를 아직 못 읽었으면 판단하지 않는다.
- 한 점검은 워처 상태 파일(`sensorPrechecks`)에 저장 — 재시작해도 다시 하지 않는다(3일 뒤 기록을 버린다). 놓친 기록을 다시 처리하는 중(HA 재연결)엔 점검하지 않는다.
- 기록의 발생 시각 = 그 점검을 해야 했던 시각 + 점검마다 고정된 0~999ms — 같은 주기에 두 점검이 나와도 DB 중복 방지(숙소·종류·발생 시각)에 걸리지 않는다.
- 옛 `sensor_offline_detected`·`sensor_offline_resolved`(RF-28, 30분 꺼짐)는 더 내지 않는다. 옛 기록은 달력 "감지 센서 연결 끊김"·이상 건수로 계속 읽는다.

### 4-F. 운영자에게 넘기기 (DEC-11·16)

Pi가 운영자에게 넘기는 것 — `sensor_precheck_failed`·`late_checkout_detected`·`checkin_not_detected`·`detection_unconfirmable` — 은 **Slack + HA 앱** 둘 다 간다.
- HA 앱: 알림창(`persistent_notification`) + 숙소 설정 `optimization.operatorNotifyService`(`notify.*`, 입실 준비 안전 알림과 같은 값)가 있으면 그 휴대폰. 무엇이 안 됐고 무엇을 해 달라는지 한국 시각과 함께(`handoffAlertMessage`·`precheckAlertMessage`). 놓친 기록을 다시 처리하는 중엔 보내지 않는다.
- 퇴실·청소 퇴장을 확인하지 못한 알림에는 현재 체류·청소 구간의 마지막 사람 조작 시각과 기기 이름을 함께 적는다. 이 단서만으로 퇴장을 자동 확정하지 않는다.
- Slack: Pi에는 Slack 주소가 없다. Vercel의 Pi 입구(`/api/events/write`)가 이 종류(`OPERATOR_ALERT_EVENT_TYPES`)를 **처음 저장할 때만** 한 번 보낸다(재전송은 DB 중복이라 다시 안 감, 5초 제한, 실패는 로그만 — 재시도 없음). 한 줄은 `[숙소] 무엇이 안 됐고 무엇을 해 달라는지 → 링크` — 기록 내용은 넣지 않는다(`OPERATOR_ALERT_LABELS`). 그 밖의 Pi 이벤트는 저장만 한다(RF-06).
- 운영자가 할 수 있는 것: HA 앱·Smart Life로 기기 직접 제어, 화면의 청소 시작·완료·정비 전환.

---

## 5. 이벤트 분류

### 상태 기계 이벤트 (getNextRoomState 호출)
| 이벤트 | 발생 조건 |
|---|---|
| `scheduled_checkin_reached` | 예약 checkIn 시각 도래 (예약당 1회). `data.entryConfirmed` |
| `scheduled_checkout_reached` | 예약 checkOut 시각 도래 (예약당 1회). `data.exitConfirmed` |
| `check_in_detected` | 옛 경로(화면·옛 기록) — Pi는 내지 않는다 |
| `scheduled_cleaning_started` · `scheduled_cleaning_finished` | 청소 일정의 시작·끝 시각 (그 퇴실의 일정이 있을 때) |
| `cleaning_started` | ENTRY + 모션 20분 지속 — 청소 일정이 없을 때, 또는 운영자 수동 |
| `cleaning_finished` | EXIT + 10분 조용 — 청소 일정이 없을 때, 또는 운영자 수동 |
| `energy_waste_detected/resolved` | 기존 로직 유지 |
| `complaint_detected/resolved` | 기존 로직 유지 |

### 문제 이벤트 (상태 변경 없음, 문제·이상 건수에 포함)
| 이벤트 | 발생 조건 |
|---|---|
| `late_checkout_detected` | checkOut + CHECKOUT_GRACE_MIN까지 실제 퇴실 미확인 (예약당 1건) + 운영자에게 |
| `checkin_not_detected` | 입실 날 자정까지 입실 미확인 (예약당 1건) + 운영자에게 |
| `cleaning_not_detected` | 배정된 청소의 끝 시각까지 담당자가 들어온 것이 안 보임 (청소 1건에 1건) + 운영자에게 |
| `detection_unconfirmable` | 퇴실·입실·청소 그 시각에 감지 센서가 꺼져 있거나 감시가 멈춰 있어 확인할 수 없음 + 운영자에게 |
| `sensor_offline_detected/resolved` | 옛 기록(RF-28) — 더 내지 않는다 |

### 확인 이벤트 (상태 변경 없음, 서버에 보내지 않음 — 그 순간의 기기 제어만)
| 이벤트 | 의미 |
|---|---|
| `checkout_confirmed` | 퇴실 시각 뒤 유예 안에 퇴실 확인 → 청소 모드 기기 제어 |
| `checkin_confirmed` | 입실 시각 뒤 입실 확인 → 체류 기기 제어 + 입실 준비에 도착 기록 |
| `cleaning_vacant_confirmed` | 청소 끝 시각 뒤 담당자 퇴장 확인 → 공실 기기 제어 |

### 기록 이벤트 (상태 변경 없음, 서버에 보냄 — 실제 청소 시각, 청소시간 준수 지표)
| 이벤트 | 의미 |
|---|---|
| `cleaning_activity_started` | 실제 청소 시작 (ENTRY + 모션 20분) |
| `cleaning_activity_finished` | 실제 청소 끝 (EXIT + 10분 조용) |

### Soft 이벤트 (ConfirmationManager로 라우팅, 상태 변경 없음)
| 이벤트 | 의미 |
|---|---|
| `checkout_confirmation_needed` | 조기 퇴실 징후(early_checkout) — 청소 조기 배정 가능 |
| `early_checkin_suspected` | 조기 체크인 가능성, 운영자 확인 |
| `sensor_precheck_failed` | 퇴실·입실 하루 전·2시간 전 감지 센서 점검에서 꺼진 센서 — 운영자에게 미리 알림 (건수에 넣지 않음) |
| `no_show_suspected` | 옛 기록 — `checkin_not_detected`로 바뀜 |

---

## 6. 파라미터 (monitoringThresholds.js)

```javascript
// EXIT/ENTRY 감지
EXIT_LOOKBACK_MIN:      5   // EXIT 조건①: 모션이 얼마나 최근이어야 하는가
EXIT_NO_MOTION_MIN:     5   // EXIT 조건③: 문닫힘 후 모션없음 지속
ENTRY_SUSTAINED_MIN:    3   // ENTRY 조건③: 모션 지속 시간

// 청소 감지
CLEANING_SUSTAINED_MIN: 20  // cleaning_started: 모션 지속 (게스트와 구분)
CLEANING_DONE_QUIET_MIN:10  // cleaning_finished: 조용 지속

// 퇴실 의심
CHECKOUT_GRACE_MIN:     20  // 예정 체크아웃 뒤 실제 퇴실을 기다리는 시간 → 지나면 late_checkout_detected
SUSPICION_EXPIRE_MIN:  120  // (RF-29 이후 퇴실 판정에 쓰지 않음 — 전환 때 의심을 지운다)

// 체크인
NO_SHOW_WINDOW_MIN:     60  // 입실 미감지 판정 = max(입실 + 60분, 그날 한국 날짜 자정)
```

---

## 7. 파일 구조

```
src/application/
  occupancyMonitor.js        기존 유지 + SensorEventGenerator/SuspicionTracker 통합
  sensorEventGenerator.js    NEW: EXIT/ENTRY 감지
  suspicionTracker.js        NEW: 의심→확신 상태 관리
src/config/
  monitoringThresholds.js    기존 + 새 파라미터 추가
server/
  occupancyWatcher.js        reservation에 checkIn 추가
tests/unit/
  s14.occupancy-monitor.test.js  업데이트
  s15.sensor-event.test.js   NEW
  s16.suspicion-tracker.test.js  NEW
```

---

## 8. 폴링 모델 한계 (알려진 제약)

30초 폴링이므로:
- 도어가 30초 이내에 열렸다 닫히면 transition 미감지 가능
- ENTRY_SUSTAINED_MIN을 최소 60초 이상으로 설정해야 단일 폴링 노이즈를 방지
- 해결책: HA WebSocket push 이벤트로 전환 시 정밀도 대폭 향상 (미래 과제)
