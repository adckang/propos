/**
 * S20 단위 테스트 — OccupancyWatcher (WebSocket 방식)
 * 검증 대상: docs/ha-websocket-migration.md 테스트 포인트 6개
 *
 * TC-OW-001: WebSocket 정상 연결 + 이벤트 수신
 * TC-OW-002: 끊김 감지 + 재연결 + 히스토리 재처리
 * TC-OW-003: debounce — 마지막 이벤트 500ms 후 정확히 1회만 처리
 * TC-OW-004: OccupancyMonitor 직렬 처리 사이클 안정성
 * TC-OW-005: 캘린더 이벤트 — 체크인 1시간/30분 전 발동
 * TC-OW-006: 과거 checkIn → 캘린더 이벤트 무시
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── MockWebSocket — addEventListener 방식 ─────────────────────────────────────
class MockWebSocket {
  constructor(url) {
    this.url       = url;
    this.readyState = MockWebSocket.CONNECTING;
    this._handlers = {};
    this.sent      = [];
    MockWebSocket.instances.push(this);
  }

  static get CONNECTING() { return 0; }
  static get OPEN()       { return 1; }
  static get CLOSING()    { return 2; }
  static get CLOSED()     { return 3; }

  addEventListener(type, fn) {
    (this._handlers[type] ??= []).push(fn);
  }
  send(data)  { this.sent.push(JSON.parse(data)); }
  close()     { this.readyState = MockWebSocket.CLOSED; this._emit('close', { code: 1000 }); }
  _emit(type, data) { (this._handlers[type] ?? []).forEach(h => h(data)); }

  // 테스트 헬퍼
  triggerOpen()          { this.readyState = MockWebSocket.OPEN; this._emit('open', {}); }
  triggerMessage(obj)    { this._emit('message', { data: JSON.stringify(obj) }); }
  triggerClose(code=1006){ this.readyState = MockWebSocket.CLOSED; this._emit('close', { code }); }

  // HA 인증 흐름 한 번에
  triggerAuthOk() {
    this.triggerOpen();
    this.triggerMessage({ type: 'auth_required' });
    this.triggerMessage({ type: 'auth_ok', ha_version: '2025.1.0' });
  }
}
MockWebSocket.instances = [];

// ── 모듈 로드 전 글로벌 설정 ─────────────────────────────────────────────────
global.WebSocket           = MockWebSocket;
process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_TOKEN    = 'test-token';

const {
  startWatcher, stopWatcher,
  getMonitoringState, setMonitoringConfig, setRoomState,
} = await import('../../server/occupancyWatcher.js');

// ── fetch 모크 헬퍼 ───────────────────────────────────────────────────────────
function mockFetch({ template = '[]', states = {}, history = {} } = {}) {
  const callLog = [];
  global.fetch = async (url, opts) => {
    callLog.push(url);
    if (url.includes('/api/template')) {
      return { ok: true, async text() { return template; }, async json() { return {}; } };
    }
    if (url.includes('/api/history/')) {
      const entityId = decodeURIComponent(new URL(url).searchParams.get('filter_entity_id') ?? '');
      const data     = history[entityId] ?? [];
      return { ok: true, async json() { return [data]; }, async text() { return '[]'; } };
    }
    const match = url.match(/\/api\/states\/(.+)$/);
    if (match) {
      const state = states[decodeURIComponent(match[1])] ?? null;
      return { ok: true, async json() { return state; }, async text() { return JSON.stringify(state); } };
    }
    return { ok: true, async json() { return {}; }, async text() { return '{}'; } };
  };
  return callLog;
}

// ── 상태 초기화 헬퍼 ─────────────────────────────────────────────────────────
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function resetWatcher() {
  stopWatcher();
  MockWebSocket.instances = [];
  setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
  // areaName null → initEntityMap 즉시 반환, checkCalendarEvents도 no-op
  setMonitoringConfig({ areaName: null, reservation: null });
}

beforeEach(() => {
  resetWatcher();
  mockFetch();
});
afterEach(() => {
  stopWatcher();
  global.fetch = undefined;
});

// ── TC-OW-001: WebSocket 정상 연결 + 이벤트 수신 ─────────────────────────────
describe('TC-OW-001: WebSocket 정상 연결 + 이벤트 수신', () => {

  test('auth_ok 후 wsConnected = true', async () => {
    mockFetch({ template: '[]' });
    setMonitoringConfig({ areaName: '테스트룸', reservation: null });
    startWatcher();
    await wait(80); // initEntityMap 완료 + connectWebSocket 호출 대기

    const ws = MockWebSocket.instances.at(-1);
    assert.ok(ws, 'WebSocket 인스턴스가 생성되어야 한다');
    ws.triggerAuthOk();

    assert.ok(getMonitoringState().wsConnected, 'auth_ok 후 wsConnected = true');
  });

  test('state_changed 이벤트 수신 후 debounce 완료 → lastEventAt 업데이트', async () => {
    mockFetch({
      template: '["binary_sensor.motion_test"]',
      states: {
        'binary_sensor.motion_test': {
          state: 'off',
          attributes: { device_class: 'motion', friendly_name: '모션' },
        },
      },
    });
    setMonitoringConfig({ areaName: '테스트룸', reservation: null });
    startWatcher();
    await wait(100);

    const ws = MockWebSocket.instances.at(-1);
    ws.triggerAuthOk();

    const beforeAt = getMonitoringState().lastEventAt;

    ws.triggerMessage({
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: 'binary_sensor.motion_test',
          new_state: { state: 'on', attributes: { device_class: 'motion', friendly_name: '모션' } },
          old_state: { state: 'off', attributes: {} },
        },
      },
    });

    await wait(600); // debounce 500ms + 여유

    assert.ok(
      getMonitoringState().lastEventAt > beforeAt,
      'state_changed 후 lastEventAt이 갱신되어야 한다',
    );
  });

  test('이 숙소 엔티티가 아닌 state_changed는 무시', async () => {
    mockFetch({ template: '["binary_sensor.motion_test"]' });
    setMonitoringConfig({ areaName: '테스트룸', reservation: null });
    startWatcher();
    await wait(80);

    const ws = MockWebSocket.instances.at(-1);
    ws.triggerAuthOk();

    const beforeAt = getMonitoringState().lastEventAt;

    ws.triggerMessage({
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: 'binary_sensor.other_room_motion', // 다른 숙소 엔티티
          new_state: { state: 'on', attributes: { device_class: 'motion' } },
          old_state: { state: 'off', attributes: {} },
        },
      },
    });

    await wait(600);

    // 다른 방 엔티티라 debounce → processNow가 안 불려야 하는데...
    // 실제로는 processNow가 안 불리므로 lastEventAt은 변하지 않아야 한다
    assert.equal(
      getMonitoringState().lastEventAt, beforeAt,
      '관련 없는 엔티티 이벤트는 lastEventAt을 바꾸지 않아야 한다',
    );
  });
});

// ── TC-OW-002: 끊김 + 재연결 + 히스토리 재처리 ───────────────────────────────
describe('TC-OW-002: 끊김 + 재연결 + 히스토리 재처리', () => {

  test('WebSocket 끊김 → 새 WebSocket 인스턴스 생성 (재연결)', async (ctx) => {
    ctx.timeout = 4000;

    const callLog = mockFetch({
      template: '["binary_sensor.door_test"]',
      states: {
        'binary_sensor.door_test': {
          state: 'off',
          attributes: { device_class: 'door', friendly_name: '현관문' },
        },
      },
      history: {
        'binary_sensor.door_test': [
          {
            entity_id: 'binary_sensor.door_test',
            state: 'on',
            last_changed: new Date(Date.now() - 30_000).toISOString(),
            attributes: { device_class: 'door', friendly_name: '현관문' },
          },
        ],
      },
    });

    setMonitoringConfig({ areaName: '테스트룸', reservation: null });
    startWatcher();
    await wait(100);

    const firstWs = MockWebSocket.instances.at(-1);
    firstWs.triggerAuthOk();
    await wait(50);

    const instancesBefore = MockWebSocket.instances.length;

    // 연결 끊김 시뮬레이션 (비정상 종료)
    firstWs.triggerClose(1006);

    // 재연결 기본 딜레이 1초 + async 완료 여유
    await wait(1500);

    assert.ok(
      MockWebSocket.instances.length > instancesBefore,
      '끊김 후 새 WebSocket 인스턴스가 생성되어야 한다',
    );

    // 히스토리 API 호출 확인
    const historyCalls = callLog.filter(u => u.includes('/api/history/'));
    assert.ok(historyCalls.length > 0, '재연결 후 히스토리 API가 호출되어야 한다');
  });

  test('재연결 성공 후 auth_ok → wsConnected = true', async (ctx) => {
    ctx.timeout = 4000;

    mockFetch({ template: '[]' });
    setMonitoringConfig({ areaName: '테스트룸', reservation: null });
    startWatcher();
    await wait(100);

    const firstWs = MockWebSocket.instances.at(-1);
    firstWs.triggerAuthOk();
    firstWs.triggerClose(1006);

    await wait(1500);

    const secondWs = MockWebSocket.instances.at(-1);
    assert.ok(secondWs !== firstWs, '새 WebSocket이어야 한다');
    secondWs.triggerAuthOk();

    assert.ok(getMonitoringState().wsConnected, '재연결 후 wsConnected = true');
  });
});

// ── TC-OW-003: debounce — 여러 이벤트 → 1회만 처리 ─────────────────────────
describe('TC-OW-003: debounce — 마지막 이벤트 500ms 후 정확히 1회만 처리', () => {

  test('5개 이벤트 연속 전송 → debounce 진행 중엔 처리 안 됨, 완료 후 정확히 1회', async () => {
    mockFetch({
      template: '["binary_sensor.motion_test"]',
      states: {
        'binary_sensor.motion_test': {
          state: 'off',
          attributes: { device_class: 'motion', friendly_name: '모션' },
        },
      },
    });
    setMonitoringConfig({ areaName: '테스트룸', reservation: null });
    startWatcher();
    await wait(100); // startWatcher 초기 processNow 완료 대기

    const ws = MockWebSocket.instances.at(-1);
    ws.triggerAuthOk();

    const stateChange = (stateVal) => ws.triggerMessage({
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: 'binary_sensor.motion_test',
          new_state: { state: stateVal, attributes: { device_class: 'motion', friendly_name: '모션' } },
          old_state: { state: stateVal === 'on' ? 'off' : 'on', attributes: {} },
        },
      },
    });

    const beforeAt = getMonitoringState().lastEventAt;

    // 5개 이벤트를 20ms 간격으로 전송 (총 80ms) — 매번 debounce 타이머 리셋
    stateChange('on');
    await wait(20); stateChange('off');
    await wait(20); stateChange('on');
    await wait(20); stateChange('off');
    await wait(20); stateChange('on'); // ← 이 시점부터 500ms debounce 카운트

    // [단계 1] 마지막 이벤트 후 300ms — debounce 아직 진행 중
    await wait(300);
    assert.equal(
      getMonitoringState().lastEventAt, beforeAt,
      'debounce 진행 중에는 처리 안 됨',
    );

    // [단계 2] 추가 300ms — debounce 완료(500ms 경과) + 처리 완료
    await wait(300);
    const afterAt = getMonitoringState().lastEventAt;
    assert.ok(afterAt > beforeAt, 'debounce 완료 후 1회 처리됨');

    // [단계 3] 추가 600ms — 더 이상 새 debounce 없으므로 추가 처리 없어야 함
    await wait(600);
    assert.equal(
      getMonitoringState().lastEventAt, afterAt,
      '이후 추가 처리 없음 — 정확히 1회만 실행',
    );
    assert.equal(getMonitoringState().lastError, null, '오류 없음');
  });
});

// ── TC-OW-004: OccupancyMonitor 직렬 처리 사이클 안정성 ──────────────────────
// isProcessing + pendingProcess 패턴은 단일 스레드 + debounce 구조상 unit test로
// race condition 재현이 어려움. 대신 독립 사이클 2회를 통해 OccupancyMonitor의
// 내부 상태 누적 없이 반복 호출이 안전함을 검증한다.
describe('TC-OW-004: OccupancyMonitor 직렬 처리 사이클 안정성', () => {

  test('독립 이벤트 사이클 2회 — 각 사이클 오류 없이 완료', async () => {
    mockFetch({
      template: '["binary_sensor.motion_test"]',
      states: {
        'binary_sensor.motion_test': {
          state: 'off',
          attributes: { device_class: 'motion', friendly_name: '모션' },
        },
      },
    });
    setMonitoringConfig({ areaName: '테스트룸', reservation: null });
    startWatcher();
    await wait(100);

    const ws = MockWebSocket.instances.at(-1);
    ws.triggerAuthOk();

    const stateChange = (s) => ws.triggerMessage({
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: 'binary_sensor.motion_test',
          new_state: { state: s, attributes: { device_class: 'motion', friendly_name: '모션' } },
          old_state: { state: s === 'on' ? 'off' : 'on', attributes: {} },
        },
      },
    });

    // ── 첫 번째 처리 사이클 ──
    stateChange('on');
    await wait(700); // debounce 500ms + 처리 여유
    assert.equal(getMonitoringState().lastError, null, '1사이클 오류 없음');
    assert.ok(
      ['VACANT', 'OCCUPIED', 'CLEANING', 'PRE_STAY_READY']
        .includes(getMonitoringState().roomState.mainStatus),
      '1사이클 후 유효한 상태',
    );

    // ── 두 번째 처리 사이클 ──
    // OccupancyMonitor가 내부 상태를 누적하지 않고 안전하게 재실행되는지 확인
    stateChange('off');
    await wait(700);
    assert.equal(getMonitoringState().lastError, null, '2사이클 오류 없음');
    assert.ok(
      ['VACANT', 'OCCUPIED', 'CLEANING', 'PRE_STAY_READY']
        .includes(getMonitoringState().roomState.mainStatus),
      '2사이클 후 유효한 상태',
    );
  });
});

// ── TC-OW-005: 캘린더 이벤트 발동 ───────────────────────────────────────────
describe('TC-OW-005: 캘린더 이벤트 — 체크인 시각 전 발동', () => {

  test('checkIn 45분 전 → VACANT에서 PRE_STAY_READY/OPTIMIZING 전환', async () => {
    mockFetch({ template: '[]' });
    const checkIn = new Date(Date.now() + 45 * 60 * 1000).toISOString(); // 45분 후

    setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    setMonitoringConfig({ areaName: 'test', reservation: { checkIn, checkOut: new Date(Date.now() + 25 * 3600 * 1000).toISOString() } });

    await wait(200); // checkCalendarEvents async 완료 대기

    const { roomState } = getMonitoringState();
    // 45분 후 체크인 → 1시간 전 조건 만족 → checkin_prep_time_reached 발동
    // 30분 전 조건 불만족 → OPTIMIZING 유지
    assert.equal(roomState.mainStatus, 'PRE_STAY_READY');
    assert.equal(roomState.subStatus,  'OPTIMIZING');
  });

  test('checkIn 20분 전 → PRE_STAY_READY/OPTIMIZED까지 전환', async () => {
    mockFetch({ template: '[]' });
    const checkIn = new Date(Date.now() + 20 * 60 * 1000).toISOString(); // 20분 후

    setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    setMonitoringConfig({ areaName: 'test', reservation: { checkIn, checkOut: new Date(Date.now() + 25 * 3600 * 1000).toISOString() } });

    await wait(200);

    const { roomState } = getMonitoringState();
    // 20분 후 체크인 → 1시간 전 + 30분 전 조건 모두 만족 → OPTIMIZED까지 전환
    assert.equal(roomState.mainStatus, 'PRE_STAY_READY');
    assert.equal(roomState.subStatus,  'OPTIMIZED');
  });

  test('checkIn 2시간 후 → 상태 변화 없음', async () => {
    mockFetch({ template: '[]' });
    const checkIn = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2시간 후

    setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    setMonitoringConfig({ areaName: 'test', reservation: { checkIn, checkOut: new Date(Date.now() + 26 * 3600 * 1000).toISOString() } });

    await wait(200);

    const { roomState } = getMonitoringState();
    // 2시간 후 → 아직 1시간 전 아님 → 상태 변화 없음
    assert.equal(roomState.mainStatus, 'VACANT');
    assert.equal(roomState.subStatus,  'CLEANING_FINISHED');
  });
});

// ── TC-OW-007: 예약 취소 → 상태 복귀 ────────────────────────────────────────
describe('TC-OW-007: reservation 취소 감지 — 상태 복귀', () => {

  test('PRE_STAY_READY 중 reservation null → VACANT/CLEANING_FINISHED 직접 복귀', async () => {
    mockFetch({ template: '[]' });

    // 체크인 20분 후 → OPTIMIZED 상태로 만들기
    const checkIn = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    setMonitoringConfig({ areaName: 'test', reservation: { checkIn, checkOut: new Date(Date.now() + 25 * 3600 * 1000).toISOString() } });
    await wait(200);

    assert.equal(getMonitoringState().roomState.mainStatus, 'PRE_STAY_READY', '사전 조건: PRE_STAY_READY');

    // 예약 취소 — reservation null로 업데이트
    setMonitoringConfig({ areaName: 'test', reservation: null });
    await wait(50);

    const { roomState } = getMonitoringState();
    assert.equal(roomState.mainStatus, 'VACANT',            '예약 취소 후 VACANT 복귀');
    assert.equal(roomState.subStatus,  'CLEANING_FINISHED', '예약 취소 후 CLEANING_FINISHED 복귀');
  });

  test('VACANT 중 reservation null → reservation_cancelled 이벤트 기록', async () => {
    mockFetch({ template: '[]' });

    // VACANT에서 예약 세팅 후 취소
    setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    setMonitoringConfig({ areaName: 'test', reservation: { checkIn: new Date(Date.now() + 5 * 3600 * 1000).toISOString(), checkOut: new Date(Date.now() + 29 * 3600 * 1000).toISOString() } });
    await wait(50);

    setMonitoringConfig({ areaName: 'test', reservation: null });
    await wait(100); // applyTransition async 완료 대기

    const { roomState, eventLog } = getMonitoringState();
    assert.equal(roomState.mainStatus, 'VACANT', '상태 유지 (자기전환)');
    assert.ok(
      eventLog.some(e => e.type === 'reservation_cancelled'),
      'eventLog에 reservation_cancelled 기록',
    );
  });
});

// ── TC-OW-006: 과거 checkIn → 캘린더 이벤트 무시 ────────────────────────────
describe('TC-OW-006: 과거 checkIn → 캘린더 이벤트 무시', () => {

  test('이미 지난 checkIn → 상태 변화 없음', async () => {
    mockFetch({ template: '[]' });
    const checkIn = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1시간 전 (과거)

    setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    setMonitoringConfig({ areaName: 'test', reservation: { checkIn, checkOut: new Date(Date.now() + 23 * 3600 * 1000).toISOString() } });

    await wait(200);

    const { roomState } = getMonitoringState();
    assert.equal(roomState.mainStatus, 'VACANT',            '상태 변화 없어야 한다');
    assert.equal(roomState.subStatus,  'CLEANING_FINISHED', '상태 변화 없어야 한다');
  });

  test('reservation 자체가 없을 때 → 상태 변화 없음', async () => {
    mockFetch({ template: '[]' });

    setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    setMonitoringConfig({ areaName: 'test', reservation: null });

    await wait(200);

    const { roomState } = getMonitoringState();
    assert.equal(roomState.mainStatus, 'VACANT');
  });
});
