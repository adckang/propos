# Pi watcher 수동 배포 절차

> 대상: Pi watcher 런타임 파일을 직접 배포하는 운영자
>
> 이 작업은 **Mac 로컬 터미널**과 **Pi SSH 터미널**을 번갈아 사용한다. 각 단계의 정상 결과를 확인한 뒤 다음 단계로 진행한다. 명령을 한꺼번에 자동 실행하지 않는다.

## 이 문서의 범위

Git/Vercel 배포만으로 바뀌지 않는 `/config/propos`의 watcher 런타임 파일을 직접 교체할 때 사용한다. 다음 순서를 지킨다.

1. 로컬 버전과 Pi 운영 상태 확인
2. Pi 복구본 생성
3. Mac에서 Pi로 필요한 파일만 전송
4. 해시 확인 후 원자적으로 교체
5. watcher 한 개만 재시작
6. 상태·로그 확인
7. Pi 릴리스 기록 갱신

화면·API·DB 배포 절차는 이 문서의 범위가 아니다.

## 터미널 구분

| 표시 | 실행 장소 | 구분 방법 |
| --- | --- | --- |
| **[Mac]** | 저장소가 있는 Mac 로컬 터미널 | 경로가 `/Users/.../propos-project-v2` |
| **[Pi]** | `ssh root@PI_LAN_ADDRESS`로 접속한 터미널 | 운영 경로가 `/config/propos` |

`cd /config/propos`가 실패하면 Mac 터미널에서 실행한 것이다. 그 명령은 Pi SSH 터미널에서 다시 실행한다.

Pi의 대화형 셸에서 `set -e`를 직접 켜 두지 않는다. 읽기 전용 검증 하나가 실패해도 SSH 접속 자체가 닫힐 수 있다. 이 문서의 엄격 실행 블록은 `( ... )` 서브셸 안에서만 `set -eu`를 사용한다.

## 시작 전에 정할 값

- Pi의 현재 LAN 주소
- 반영할 작업 ID와 소스 커밋 전체 값
- 교체하거나 새로 추가할 런타임 파일 목록
- 각 새 파일의 SHA-256
- 새 롤아웃 디렉터리 이름: `작업ID-UTC시각-짧은커밋`
- Pi 비공개 환경파일의 `PROPOS_EVENT_API_URL` — 전체 운영 수신 주소 `https://www.proposonline.com/api/events/write`. 코드 기본값은 없으며 값이 없거나 다른 경로면 큐만 보존하고 전송하지 않는다

예시:

```text
Pi 주소: 192.168.45.76
작업: RF-30
소스 커밋: 052aed670b202614d8c30749af451b6654ac5db1
롤아웃: /config/propos/.rollout/rf30-20261121T065635Z-052aed6
```

명령의 `REPLACE_WITH_...` 값은 실행 전에 실제 값으로 바꾼다. 이 문구가 하나라도 남아 있으면 명령을 실행하지 않는다.

## 1. 배포 전 확인

### 1-1. [Mac] 로컬 버전과 변경 파일 확인

```bash
cd /Users/kimjinsol/Downloads/propos-project-v2
SOURCE_COMMIT='REPLACE_WITH_FULL_COMMIT'
FILE_1='REPLACE_WITH_RELATIVE_PATH'
FILE_2='REPLACE_WITH_RELATIVE_PATH'

git status --short
git rev-parse HEAD
git rev-parse origin/main
git show --stat --oneline "$SOURCE_COMMIT"
shasum -a 256 "$FILE_1" "$FILE_2"
```

확인할 것:

- 반영할 코드가 `HEAD`에 포함돼 있다.
- 기존 사용자 파일과 관계없는 변경은 건드리지 않는다.
- 이후 Pi에서 확인할 새 파일 해시를 기록한다.

### 1-2. [Pi] 기존 파일·프로세스·상태 확인

```bash
cd /config/propos
date -Iseconds
EXISTING_FILE_1='REPLACE_WITH_RELATIVE_PATH'
EXISTING_FILE_2='REPLACE_WITH_RELATIVE_PATH'

for file in "$EXISTING_FILE_1" "$EXISTING_FILE_2"; do
  if [ -f "$file" ]; then
    sha256sum "$file"
  else
    echo "MISSING $file"
  fi
done
pgrep -af "node .*occupancy-watcher-standalone.mjs"

(
  set -a
  . ./.env.watcher
  set +a

  curl -fsS \
    -H "x-pi-secret: $PROPOS_PI_SECRET" \
    http://127.0.0.1:3001/api/monitoring/state |
  node -e 'let x="";process.stdin.on("data",d=>x+=d).on("end",()=>{const s=JSON.parse(x);console.log(JSON.stringify({roomState:s.roomState,wsConnected:s.wsConnected,isReplaying:s.isReplaying,preparation:s.preparation,eventDeliveryConfigured:s.eventDeliveryConfigured,eventDeliveryPending:s.eventDeliveryPending,eventDeliveryRejectedCount:s.eventDeliveryRejectedCount,statePersistenceFailed:s.statePersistenceFailed,lastError:s.lastError??null},null,2))})'
)
```

다음 조건이면 배포를 멈추고 원인을 먼저 확인한다.

- watcher가 없거나 두 개 이상 실행 중
- `wsConnected`가 `false`
- `isReplaying`이 `true`
- `preparation.run`이 `null`이 아님
- `eventDeliveryConfigured`가 `false`
- 대기·거절 이벤트가 있음
- `statePersistenceFailed`가 `true`
- `lastError`가 있음

객실 상태가 `OCCUPIED`여도 상태가 안정적이고 위 조건이 모두 정상이라면 파일 교체와 짧은 재시작은 가능하다. 장치 제어·가짜 이벤트·운영 POST 시험은 하지 않는다.

## 2. [Pi] 복구 지점 만들기

롤아웃 경로는 이번 작업에 맞게 새로 정한다.

```bash
(
  set -eu
  cd /config/propos
  ROLLOUT=/config/propos/.rollout/REPLACE_WITH_ROLLOUT_NAME
  umask 077
  mkdir -p "$ROLLOUT/incoming"

  cp -p scripts/occupancy-watcher-standalone.mjs \
    "$ROLLOUT/occupancy-watcher-standalone.mjs.before"
  cp -p .propos-release.json \
    "$ROLLOUT/propos-release.json.before"

  sha256sum "$ROLLOUT"/*.before
  stat -c '%a %U:%G %n' "$ROLLOUT" "$ROLLOUT/incoming"
)
```

교체할 기존 파일과 릴리스 기록을 백업한다. 파일별로 원래 경로를 알아볼 수 있는 이름을 쓴다.

새로 추가하는 파일은 기존 파일이 없다는 사실을 작업 메모에 남긴다. 없는 파일을 백업하려고 만들지는 않는다.

정상 기준:

- 롤아웃 디렉터리와 `incoming`이 `700 root:root`
- 백업 파일 해시가 배포 전 확인한 기존 해시와 같음

## 3. [Mac] 새 파일 전송

Pi SSH 애드온은 SCP/SFTP 서브시스템을 제공하지 않을 수 있다. 다음 오류가 나면 SCP를 반복하지 않는다.

```text
subsystem request failed on channel 0
scp: Connection closed
```

그때는 일반 SSH 연결로 tar 스트림을 보낸다. 아래는 서로 다른 디렉터리의 파일 두 개를 평평하게 전송하는 예다.

```bash
REPO=/Users/kimjinsol/Downloads/propos-project-v2
PI_HOST='REPLACE_WITH_PI_LAN_ADDRESS'
ROLLOUT_NAME='REPLACE_WITH_ROLLOUT_NAME'
SERVER_FILE='REPLACE_WITH_SERVER_FILE_BASENAME'
SCRIPT_FILE='REPLACE_WITH_SCRIPT_FILE_BASENAME'

tar -cf - \
  -C "$REPO/server" \
  "$SERVER_FILE" \
  -C "$REPO/scripts" \
  "$SCRIPT_FILE" |
ssh "root@$PI_HOST" \
  "tar -xf - -C /config/propos/.rollout/$ROLLOUT_NAME/incoming"
```

SSH 비밀번호는 Mac 터미널에 직접 입력한다. 채팅·문서·로그에 남기지 않는다.

## 4. [Pi] 전송 파일 검증

```bash
cd /config/propos
ROLLOUT=/config/propos/.rollout/REPLACE_WITH_ROLLOUT_NAME
FILE_1='REPLACE_WITH_INCOMING_BASENAME'
FILE_2='REPLACE_WITH_INCOMING_BASENAME'

sha256sum \
  "$ROLLOUT/incoming/$FILE_1" \
  "$ROLLOUT/incoming/$FILE_2"
stat -c '%a %U:%G %n' \
  "$ROLLOUT/incoming/$FILE_1" \
  "$ROLLOUT/incoming/$FILE_2"
```

두 해시가 [Mac]에서 기록한 값과 정확히 같아야 한다. tar 전송 뒤 소유자가 `UNKNOWN:dialout`처럼 보여도 내용이 잘못된 것은 아니다. 다음 설치 단계에서 `root:root`로 지정한다.

## 5. [Pi] 파일을 원자적으로 교체

먼저 숨김 임시 파일로 설치한 뒤 같은 파일시스템 안에서 `mv`한다. 대상별로 명령을 명시해 엉뚱한 경로를 덮어쓰지 않는다.

```bash
(
  set -eu
  cd /config/propos
  ROLLOUT=/config/propos/.rollout/REPLACE_WITH_ROLLOUT_NAME
  INCOMING_1='REPLACE_WITH_INCOMING_BASENAME'
  INCOMING_2='REPLACE_WITH_INCOMING_BASENAME'
  TARGET_1='REPLACE_WITH_TARGET_RELATIVE_PATH'
  TARGET_2='REPLACE_WITH_TARGET_RELATIVE_PATH'
  TEMP_1="$(dirname "$TARGET_1")/.rollout-$(basename "$TARGET_1")"
  TEMP_2="$(dirname "$TARGET_2")/.rollout-$(basename "$TARGET_2")"

  install -o root -g root -m 0644 \
    "$ROLLOUT/incoming/$INCOMING_1" \
    "$TEMP_1"
  mv "$TEMP_1" "$TARGET_1"

  install -o root -g root -m 0644 \
    "$ROLLOUT/incoming/$INCOMING_2" \
    "$TEMP_2"
  mv "$TEMP_2" "$TARGET_2"
)
```

JavaScript 파일이면 재시작 전에 구문과 최종 해시를 확인한다.

```bash
TARGET_1='REPLACE_WITH_TARGET_RELATIVE_PATH'
TARGET_2='REPLACE_WITH_TARGET_RELATIVE_PATH'

node --check "$TARGET_1"
node --check "$TARGET_2"
sha256sum "$TARGET_1" "$TARGET_2"
stat -c '%a %U:%G %n' "$TARGET_1" "$TARGET_2"
```

구문 검사나 해시가 실패하면 재시작하지 않는다.

## 6. [Pi] watcher 한 개만 재시작

재시작 직전 PID와 로그 줄 위치를 롤아웃 디렉터리에 기록한다.

```bash
(
  set -eu
  cd /config/propos
  ROLLOUT=/config/propos/.rollout/REPLACE_WITH_ROLLOUT_NAME
  WATCHER_PATTERN='^node --env-file=/config/propos/[.]env[.]watcher --network-family-autoselection-attempt-timeout=1000 /config/propos/scripts/occupancy-watcher-standalone[.]mjs$'

  set -- $(pgrep -f "$WATCHER_PATTERN")
  [ "$#" -eq 1 ] || {
    echo "ABORT: watcher count=$#"
    exit 1
  }

  OLD_PID="$1"
  BEFORE_LINES="$(wc -l < watcher.log)"
  printf '%s\n' "$OLD_PID" > "$ROLLOUT/old-pid"
  printf '%s\n' "$BEFORE_LINES" > "$ROLLOUT/watcher-log-lines-before-restart"

  kill "$OLD_PID"

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$OLD_PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "ABORT: old watcher still running PID=$OLD_PID"
    exit 1
  fi

  sh scripts/start-watcher.sh
  sleep 3

  set -- $(pgrep -f "$WATCHER_PATTERN")
  [ "$#" -eq 1 ] || {
    echo "START_FAILED: watcher count=$#"
    exit 1
  }

  NEW_PID="$1"
  [ "$NEW_PID" != "$OLD_PID" ] || {
    echo "START_FAILED: PID unchanged"
    exit 1
  }

  printf 'OLD_PID=%s\nNEW_PID=%s\nLOG_FROM_LINE=%s\n' \
    "$OLD_PID" "$NEW_PID" "$((BEFORE_LINES + 1))"
)
```

`start-watcher.sh` 자체가 시작 전에 15초 기다리므로 명령이 잠시 멈춘 것처럼 보여도 중단하지 않는다.

정상 기준:

- 새 PID 한 개만 표시됨
- 새 PID가 기존 PID와 다름
- `START_FAILED` 또는 초기화 오류가 없음

## 7. [Pi] 재시작 후 검증

### 7-1. 프로세스와 상태

1-2와 같은 명령으로 프로세스가 한 개인지와 `/api/monitoring/state`를 다시 확인한다. 객실 상태는 재시작 전과 같아야 하고 다음 값이 정상이어야 한다.

- `wsConnected: true`
- `isReplaying: false`
- `preparation.run: null`
- `eventDeliveryPending: 0`
- `eventDeliveryRejectedCount: 0`
- `statePersistenceFailed: false`
- `lastError: null`

### 7-2. 이번 재시작 뒤 로그만 확인

```bash
cd /config/propos
ROLLOUT=/config/propos/.rollout/REPLACE_WITH_ROLLOUT_NAME
FROM="$(cat "$ROLLOUT/watcher-log-lines-before-restart")"
FROM="$((FROM + 1))"
tail -n +"$FROM" watcher.log
```

확인할 것:

- HTTP 서버가 `:3001`에서 시작됨
- watcher 인증 모드가 `차단`이며 공유키 누락 경고가 없음
- 엔티티 맵 초기화 성공
- WebSocket 연결·HA 인증·구독 성공
- 새 코드가 추가한 로그 형식이 실제로 보임

로그 형식 변경을 배포한 경우, 기존 프로세스가 종료하며 남긴 마지막 줄은 옛 형식일 수 있다. 새 PID의 시작 로그부터 새 형식인지 확인한다.

## 8. [Pi] 릴리스 기록 갱신

모든 검증이 끝난 뒤에만 `/config/propos/.propos-release.json`을 갱신한다. Pi의 Git HEAD는 실제 배포 버전의 근거로 쓰지 않는다.

반드시 기록할 값:

- 소스 커밋 전체 값과 짧은 값
- 작업 ID
- 롤아웃 디렉터리
- 이전 PID와 새 PID
- 변경한 파일 목록과 최종 SHA-256
- 재시작 시각
- 확인한 객실 상태·WebSocket·큐·오류 상태
- 이전 배포 커밋

기존 JSON을 읽어 확인한 뒤 임시 파일에 새 JSON을 쓰고 `rename`하는 작업별 Node 명령을 사용한다. 기존 `stages` 배열은 지우지 않고 새 단계를 뒤에 추가한다. 갱신 후에는 다음을 실행한다.

```bash
cd /config/propos
ROLLOUT=/config/propos/.rollout/REPLACE_WITH_ROLLOUT_NAME

node -e 'JSON.parse(require("node:fs").readFileSync(".propos-release.json","utf8"));console.log("release json ok")'
cp -p .propos-release.json "$ROLLOUT/propos-release.json.after"
stat -c '%a %U:%G %n' .propos-release.json
sha256sum .propos-release.json
cat .propos-release.json
```

`.propos-release.json`에는 비밀값을 넣지 않는다.

## 9. 실패 시 복구

재시작 실패나 상태 회귀가 있으면 새 기능을 더 확인하려 하지 말고 기존 파일로 되돌린다.

1. 현재 watcher PID가 한 개인지 확인한다.
2. 새 watcher를 종료한다.
3. `*.before` 파일을 원래 경로의 임시 파일로 `install`한 뒤 `mv`한다.
4. 이번에 **새로 추가한 파일만** 제거한다.
5. `propos-release.json.before`를 원래 위치로 복원한다.
6. `sh scripts/start-watcher.sh`로 다시 시작한다.
7. 프로세스·상태·로그를 다시 확인한다.

예시:

```bash
cd /config/propos
ROLLOUT=/config/propos/.rollout/REPLACE_WITH_ROLLOUT_NAME

install -o root -g root -m 0644 \
  "$ROLLOUT/occupancy-watcher-standalone.mjs.before" \
  scripts/.occupancy-watcher-standalone.mjs.rollback
mv scripts/.occupancy-watcher-standalone.mjs.rollback \
  scripts/occupancy-watcher-standalone.mjs

install -o root -g root -m 0644 \
  "$ROLLOUT/propos-release.json.before" \
  .propos-release.json.rollback
mv .propos-release.json.rollback .propos-release.json
```

제거할 파일과 복원할 파일은 해당 롤아웃 기록을 보고 명시한다. 와일드카드나 디렉터리 전체 삭제를 사용하지 않는다.

## 10. 보안과 기록 원칙

- 공유해도 되는 값: 파일 해시, PID, 파일 권한, 롤아웃 경로, 비밀값이 없는 릴리스 JSON, 선별한 상태 요약
- 공유하면 안 되는 값: SSH 비밀번호, 개인키, `.env.watcher` 내용, `PROPOS_PI_SECRET`, HA 토큰, 캘린더 주소
- `.env.watcher`는 `source`만 하고 `cat`하지 않는다.
- `scripts/start-watcher.sh`를 저장소 사본으로 덮어쓰지 않는다. Pi에서 현재 사용하는 기동 방식과 환경파일 인자를 보존한다.
- 전체 저장소를 Pi에 복사하지 않고 승인된 런타임 파일만 교체한다.
- 직접 LAN에 연결돼 있으면 Tailscale은 필요 없다.
- 사용자 파일·Pi 설정·상태 파일은 배포 대상이 아니면 수정하지 않는다.

## RF-30 실제 완료 기록

2026-11-21에 이 절차의 기준이 된 RF-30 배포를 수행했다.

| 항목 | 결과 |
| --- | --- |
| 코드 커밋 | `052aed670b202614d8c30749af451b6654ac5db1` |
| 변경 파일 | `server/logTimestamps.js`, `scripts/occupancy-watcher-standalone.mjs` |
| 복구 경로 | `/config/propos/.rollout/rf30-20261121T065635Z-052aed6` |
| PID | `1983 → 2608` |
| 상태 | `OCCUPIED / GOOD_CONDITION`, WebSocket 정상, 준비 실행·대기 이벤트·오류 없음 |
| 로그 | 새 PID의 시작 로그 7줄 모두 KST 타임스탬프 확인 |
| Pi 릴리스 | `.propos-release.json`이 커밋 `052aed6`과 두 파일 해시를 기록 |

이 표는 당시 결과 기록이다. 다음 배포에서는 현재 상태와 새 값을 다시 확인한다.
