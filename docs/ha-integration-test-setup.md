# HA 통합·E2E 테스트 설정 가이드

> IT-001, IT-002, E2E-003 실행 전 HA에서 한 번만 수동 설정.

---

## 1. 환경변수 설정

```bash
export PROPOS_HA_BASE_URL=http://192.168.45.76:8123   # 라즈베리파이 HA 주소
export PROPOS_HA_TOKEN=<Long-Lived Access Token>
```

Tailscale 외부 접속 시 HA IP 대신 Tailscale IP 사용.

---

## 2. HA 설정 (관리자 UI or configuration.yaml)

### 2-1. Helper — input_boolean 3개 생성

HA 관리자 → **설정 > 기기 및 서비스 > 헬퍼 > 추가 > 토글**

| 헬퍼 이름 (Entity ID)               | 역할        |
|--------------------------------------|-------------|
| `input_boolean.propos_test_door`     | 도어 센서   |
| `input_boolean.propos_test_motion`   | 모션 센서   |
| `input_boolean.propos_test_smoke`    | 연기 센서   |

### 2-2. Area — 테스트룸 생성

HA 관리자 → **설정 > 영역 > 영역 추가**  
이름: `테스트룸`

생성 후 input_boolean 3개를 테스트룸 영역에 할당.

### 2-3. Template Binary Sensor 3개 (device_class 매핑용)

> PROPOS `buildSnapshotFromStates`가 `binary_sensor` domain + `device_class`만 인식하기 때문에 필요.

`configuration.yaml` 또는 `template.yaml`에 추가:

```yaml
template:
  - binary_sensor:
      - name: "PROPOS Test Door"
        unique_id: propos_test_door
        device_class: door
        state: "{{ is_state('input_boolean.propos_test_door', 'on') }}"

      - name: "PROPOS Test Motion"
        unique_id: propos_test_motion
        device_class: motion
        state: "{{ is_state('input_boolean.propos_test_motion', 'on') }}"

      - name: "PROPOS Test Smoke"
        unique_id: propos_test_smoke
        device_class: smoke
        state: "{{ is_state('input_boolean.propos_test_smoke', 'on') }}"
```

HA 재시작 후 `binary_sensor.propos_test_door` 등 3개의 엔티티가 생성됨.

**테스트룸 영역에 binary_sensor 3개도 추가할 것.**

---

## 3. 테스트 실행

```bash
# 통합 테스트 (HA 필요 없는 IT-003/004 포함)
npm run test:integration

# 통합 테스트 (IT-001/002 포함, HA 필요)
PROPOS_HA_BASE_URL=http://... PROPOS_HA_TOKEN=... npm run test:integration

# E2E 테스트 (dev 서버 자동 기동)
npm run test:e2e

# E2E-003 (HA 필요)
PROPOS_HA_BASE_URL=http://... PROPOS_HA_TOKEN=... npm run test:e2e
```

---

## 4. 테스트 범위 요약

| ID      | 설명                              | HA 필요 |
|---------|-----------------------------------|---------|
| IT-001  | WebSocket 연결 확인               | ✅       |
| IT-002  | input_boolean 토글 → processNow  | ✅       |
| IT-003  | 과거 checkIn → 상태 변화 없음     | ❌       |
| IT-004  | checkIn 45분 후 → OPTIMIZING 전환 | ❌       |
| E2E-001 | 대시보드 페이지 로드              | ❌       |
| E2E-002 | 상태 카드 클릭 → 리스트 뷰 전환  | ❌       |
| E2E-003 | 도어 토글 → LIVE 배지 갱신        | ✅       |
