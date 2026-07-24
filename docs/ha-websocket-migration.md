# HA WebSocket 전환 설계서
> occupancyWatcher.js — REST 폴링 → WebSocket 이벤트 구독
> 작성: 2026-07-23

---

## 왜 바꾸나

지금은 30초마다 HA에 "센서 어때?" 물어봄 (폴링).
→ 최대 30초 지연, 이벤트 순서 보장 안 됨, 숙소/센서 늘수록 트래픽 폭증.

바꾸면: HA에 "바뀌면 바로 알려줘" 등록해두고 기다림 (이벤트 구독).
→ 변화 즉시 수신, 변경된 것만 전달, 연결 1개로 전체 커버.

---

## 최종 구조

```
시작
  ① HA REST → 현재 모든 센서 상태 가져오기 (entityStateMap 구성)
  ② HA WebSocket 연결 → "state_changed 이벤트 알려줘" 등록
  ③ 1분 타이머 시작 → 체크인 시각 확인용

평상시
  HA → state_changed 이벤트 push
    → 이 숙소 센서인지 확인 (entityStateMap에 있는 것만)
    → entityStateMap 해당 항목 업데이트
    → 500ms 기다렸다가 (debounce) 스냅샷 재계산 → 상태 머신 처리

1분마다 (캘린더 이벤트)
  → 체크인 1시간 전이 됐고 아직 VACANT이면 → checkin_prep_time_reached
  → 체크인 30분 전이 됐고 아직 OPTIMIZING이면 → optimization_finished

연결 끊김
  → 마지막 수신 시각 기록
  → 점진적 재연결 시도 (1초 → 2초 → 4초 ... 최대 60초)
  → 재연결 성공 시:
      ① HA REST → entityStateMap 다시 갱신
      ② HA history API → 끊긴 동안 놓친 이벤트 가져와서 시간 순으로 재처리
      ③ WebSocket 구독 다시 등록
```

---

## 핵심 결정사항

| 항목 | 결정 | 이유 |
|------|------|------|
| entityStateMap | 엔티티별 상태 객체 전체 보관 | 배열형 센서(온도 여러개) incremental 업데이트 불가 |
| 스냅샷 재계산 | 이벤트마다 buildSnapshot() 전체 재계산 | 단순하고 안전. 로컬 연산이라 부담 없음 |
| debounce 500ms | 여러 센서 동시 변화 시 한 번만 처리 | 도어+모션 동시 발생 등 |
| isProcessing 플래그 | 처리 중 중복 실행 방지 | OccupancyMonitor 내부 상태 보호 |
| 히스토리 재처리 | 재연결 후 놓친 이벤트 HA history API로 복구 | 도어 등 이벤트성 센서는 놓치면 안 됨 |
| 캘린더 이벤트 | 별도 1분 인터벌로 시각 비교 | WebSocket과 무관. 로컬 연산만으로 충분 |
| Node.js 내장 WebSocket | npm 패키지 없음 | Node.js 22+ 기본 제공 |

---

## 방어 조건 (구현 시 반드시 포함)

- `isProcessing` 중 새 처리 요청 들어오면 → 완료 후 1회 재실행
- 히스토리 재처리 중에는 WebSocket 이벤트 큐에 쌓아둠 (처리 충돌 방지)
- 캘린더 이벤트: 과거 시각이면 무시, isValidTransition() 통과한 것만 발동
- 모든 상태 전환과 에러는 명확히 로깅

## 허용된 미세 경쟁 조건

### checkCalendarEvents ↔ processNow

`checkCalendarEvents`는 시작 시 `isProcessing=true`이면 즉시 반환한다.
그러나 `checkCalendarEvents`가 `applyTransition`을 실행하는 동안(await sendHaNotification 포인트)
`processNow`가 시작될 수 있다. 두 함수 모두 `roomState`를 직접 수정하므로 이론상 경쟁이 존재한다.

**허용 이유**: JavaScript는 단일 스레드이므로 메모리 손상은 없다. 두 전환은 각각
`isValidTransition()` → `getNextRoomState()` 의 순서로 직렬 실행되어 최종 상태는 항상
유효한 도메인 상태다. `checkCalendarEvents`는 1분 인터벌에서 드물게 전환을 발생시키고,
`applyTransition` 내 경쟁 구간은 `sendHaNotification`의 await 포인트 뿐이다.

**리스크가 실질적 문제로 이어지는 조건**: 동일한 1분 틱 내에 checkCalendarEvents와
processNow가 각각 서로 다른 상태 전환을 발생시키는 경우. 발생 빈도가 매우 낮고,
isValidTransition()이 유효하지 않은 전환을 거르므로 실용적으로 수용 가능한 수준이다.

---

## 변경 범위

| 파일 | 변경 여부 |
|------|----------|
| `server/occupancyWatcher.js` | ✏️ 전면 재작성 |
| `server/haProxy.js` | ✏️ WebSocket URL 헬퍼 추가 |
| `src/application/occupancyMonitor.js` | ✅ 변경 없음 |
| `src/domain/room-state/roomStateDomain.js` | ✅ 변경 없음 |
| `server/deviceActionExecutor.js` | ✅ 변경 없음 |
| `api/monitoring/*` | ✅ 변경 없음 |
| `data/monitoring-config.json` | ✏️ `checkIn` 필드 추가 |

---

## 수용하는 한계 (지금은 OK, 나중에 개선)

- **SmartLife → HA 지연**: Tuya 클라우드 경유로 15~30초 지연 가능. HA에서 LocalTuya로 전환하면 해결되나 지금은 수용.
- **개별 센서 unavailable**: HA가 WebSocket으로 즉시 알려줌. 별도 처리 불필요.

---

## 테스트 포인트

- [ ] WebSocket 정상 연결 + 이벤트 수신
- [ ] 끊김 감지 + 재연결 + 히스토리 재처리
- [ ] debounce: 여러 이벤트 → 1회만 처리
- [ ] isProcessing: 동시 처리 차단
- [ ] 캘린더 이벤트: 체크인 1시간/30분 전 정확히 발동
- [ ] 과거 checkIn → 캘린더 이벤트 무시
