'use strict';

/**
 * S06 단위 테스트 — HA WebSocket 클라이언트
 * node --test tests/unit/s06.hawebsocket.test.js
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ============================================================
// MockWebSocket — 브라우저 WebSocket API 모방
// ============================================================
class MockWebSocket {
  constructor(url) {
    this.url    = url;
    this.sent   = [];          // 전송된 메시지 (파싱된 객체)
    this.closed = false;
    MockWebSocket.instances.push(this);
  }
  send(data)  { this.sent.push(JSON.parse(data)); }
  close()     { this.closed = true; if (this.onclose) this.onclose({ code: 1000 }); }
  // 테스트 헬퍼 — 서버 → 클라이언트 메시지 시뮬레이션
  receive(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
  triggerError() { if (this.onerror) this.onerror(new Error('connection failed')); }
  triggerClose(code = 1006) { this.closed = true; if (this.onclose) this.onclose({ code }); }
}

beforeEach(() => { MockWebSocket.instances = []; });

// createHAConnection 을 여기서 인라인 구현해 테스트
// (실제 모듈 require 후 테스트 — 구현 전이므로 선 정의)
function loadModule() {
  return require('../../src/infrastructure/haWebSocket.js');
}

// ============================================================
// TC-WS-001 ~ TC-WS-009
// ============================================================

describe('haWebSocket — TC-WS-001 ~ TC-WS-009', () => {

  test('TC-WS-001: connect() 호출 시 즉시 onStatusChange("connecting") 발생', () => {
    const { createHAConnection } = loadModule();
    const statuses = [];
    createHAConnection({
      onEvent: () => {},
      onStatusChange: s => statuses.push(s),
      WebSocketImpl: MockWebSocket,
    });
    assert.ok(statuses.includes('connecting'), `statuses: ${JSON.stringify(statuses)}`);
  });

  test('TC-WS-002: auth_required 수신 → auth 메시지 전송 (access_token 포함)', () => {
    const { createHAConnection, HA_TOKEN } = loadModule();
    createHAConnection({
      onEvent: () => {},
      onStatusChange: () => {},
      WebSocketImpl: MockWebSocket,
    });
    const ws = MockWebSocket.instances[0];
    ws.receive({ type: 'auth_required', ha_version: '2025.12.4' });
    const authMsg = ws.sent.find(m => m.type === 'auth');
    assert.ok(authMsg, 'auth 메시지가 전송되어야 한다');
    assert.equal(authMsg.access_token, HA_TOKEN);
  });

  test('TC-WS-003: auth_ok 수신 → onStatusChange("connected") + subscribe_events 전송', () => {
    const { createHAConnection } = loadModule();
    const statuses = [];
    createHAConnection({
      onEvent: () => {},
      onStatusChange: s => statuses.push(s),
      WebSocketImpl: MockWebSocket,
    });
    const ws = MockWebSocket.instances[0];
    ws.receive({ type: 'auth_required' });
    ws.receive({ type: 'auth_ok' });

    assert.ok(statuses.includes('connected'), `statuses: ${JSON.stringify(statuses)}`);
    const subMsg = ws.sent.find(m => m.type === 'subscribe_events');
    assert.ok(subMsg, 'subscribe_events 메시지가 전송되어야 한다');
    assert.equal(subMsg.event_type, 'state_changed');
  });

  test('TC-WS-004: auth_invalid 수신 → onStatusChange("error") + 재연결 없음', (t) => {
    const { createHAConnection } = loadModule();
    const statuses = [];
    const conn = createHAConnection({
      onEvent: () => {},
      onStatusChange: s => statuses.push(s),
      WebSocketImpl: MockWebSocket,
    });
    const ws = MockWebSocket.instances[0];
    ws.receive({ type: 'auth_required' });
    ws.receive({ type: 'auth_invalid' });

    assert.ok(statuses.includes('error'), `statuses: ${JSON.stringify(statuses)}`);
    assert.equal(MockWebSocket.instances.length, 1, '재연결 시도 없어야 한다');
    conn.disconnect(); // 정리
  });

  test('TC-WS-005: state_changed 이벤트 수신 → onEvent({ entityId, newState, oldState }) 호출', () => {
    const { createHAConnection } = loadModule();
    const events = [];
    createHAConnection({
      onEvent: ev => events.push(ev),
      onStatusChange: () => {},
      WebSocketImpl: MockWebSocket,
    });
    const ws = MockWebSocket.instances[0];
    ws.receive({ type: 'auth_required' });
    ws.receive({ type: 'auth_ok' });
    ws.receive({
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: 'lock.front_door_p042',
          new_state: { state: 'unlocked' },
          old_state: { state: 'locked' },
        },
      },
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].entityId,  'lock.front_door_p042');
    assert.equal(events[0].newState,  'unlocked');
    assert.equal(events[0].oldState,  'locked');
  });

  test('TC-WS-006: state_changed 외 이벤트 타입은 onEvent 호출하지 않음', () => {
    const { createHAConnection } = loadModule();
    const events = [];
    createHAConnection({
      onEvent: ev => events.push(ev),
      onStatusChange: () => {},
      WebSocketImpl: MockWebSocket,
    });
    const ws = MockWebSocket.instances[0];
    ws.receive({ type: 'auth_ok' });
    ws.receive({ type: 'event', event: { event_type: 'call_service', data: {} } });
    ws.receive({ type: 'result', success: true });

    assert.equal(events.length, 0);
  });

  test('TC-WS-007: disconnect() 호출 후 WS close + 재연결 없음', () => {
    const { createHAConnection } = loadModule();
    const conn = createHAConnection({
      onEvent: () => {},
      onStatusChange: () => {},
      WebSocketImpl: MockWebSocket,
    });
    const ws = MockWebSocket.instances[0];
    ws.receive({ type: 'auth_required' });
    ws.receive({ type: 'auth_ok' });

    conn.disconnect();

    assert.ok(ws.closed, 'WebSocket이 닫혀야 한다');
    assert.equal(MockWebSocket.instances.length, 1, '재연결 인스턴스 없어야 한다');
  });

  test('TC-WS-008: 비정상 연결 끊김 → onStatusChange("reconnecting") 발생', (t) => {
    const { createHAConnection } = loadModule();
    const statuses = [];
    const conn = createHAConnection({
      onEvent: () => {},
      onStatusChange: s => statuses.push(s),
      WebSocketImpl: MockWebSocket,
    });
    const ws = MockWebSocket.instances[0];
    ws.receive({ type: 'auth_required' });
    ws.receive({ type: 'auth_ok' });
    // 비정상 종료 시뮬레이션 (disconnect() 없이)
    ws.triggerClose(1006);

    assert.ok(statuses.includes('reconnecting'), `statuses: ${JSON.stringify(statuses)}`);
    conn.disconnect(); // 타이머 정리
  });

  test('TC-WS-009: JSON 파싱 오류 메시지는 조용히 무시 (onEvent 미호출)', () => {
    const { createHAConnection } = loadModule();
    const events = [];
    createHAConnection({
      onEvent: ev => events.push(ev),
      onStatusChange: () => {},
      WebSocketImpl: MockWebSocket,
    });
    const ws = MockWebSocket.instances[0];
    // onmessage에 유효하지 않은 JSON 직접 전달
    if (ws.onmessage) ws.onmessage({ data: 'NOT_JSON{{' });

    assert.equal(events.length, 0);
  });

});
