// ============================================================
// haWebSocket.js — Home Assistant WebSocket 클라이언트
// HA WebSocket API: ws://IP:8123/api/websocket
//
// 브라우저 환경에서 실행. node:test 시 WebSocketImpl 주입으로 테스트.
// 설정 변경: src/config/privateConfig.js 참고
// ============================================================

import CFG from "../config/privateConfig.js";

const HA_WS_URL = CFG.ha.wsUrl;
const HA_TOKEN  = CFG.ha.token;

const MAX_RECONNECT = 5;

/**
 * HA WebSocket 연결 생성
 *
 * @param {Object}   opts
 * @param {Function} opts.onEvent          - ({ entityId, newState, oldState }) => void
 * @param {Function} opts.onStatusChange   - ('connecting'|'connected'|'reconnecting'|'error'|'disconnected') => void
 * @param {Function} [opts.WebSocketImpl]  - 테스트 주입용 (기본: 전역 WebSocket)
 * @returns {{ disconnect: () => void }}
 */
export function createHAConnection({ onEvent, onStatusChange, WebSocketImpl }) {
  const WS = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  if (!WS) throw new Error('WebSocket을 사용할 수 없는 환경입니다');

  let ws             = null;
  let msgId          = 1;
  let intentionalClose = false;
  let reconnectCount = 0;
  let reconnectTimer = null;

  function connect() {
    if (intentionalClose) return;

    onStatusChange('connecting');

    try {
      ws = new WS(HA_WS_URL);
    } catch (_) {
      onStatusChange('error');
      return;
    }

    ws.onopen = () => {
      // auth_required 메시지를 기다림 — 아무 작업 없음
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }

      switch (msg.type) {
        case 'auth_required':
          ws.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }));
          break;

        case 'auth_ok':
          reconnectCount = 0;
          onStatusChange('connected');
          ws.send(JSON.stringify({
            id: msgId++,
            type: 'subscribe_events',
            event_type: 'state_changed',
          }));
          break;

        case 'auth_invalid':
          // 토큰 무효 — 재연결 불가
          intentionalClose = true;
          onStatusChange('error');
          ws.close();
          break;

        case 'event': {
          const ev = msg.event;
          if (ev?.event_type === 'state_changed') {
            const { entity_id, new_state, old_state } = ev.data || {};
            onEvent({
              entityId:  entity_id,
              newState:  new_state?.state ?? null,
              oldState:  old_state?.state ?? null,
            });
          }
          break;
        }

        // 'result' 등 나머지 타입은 무시
      }
    };

    ws.onerror = () => {
      onStatusChange('error');
    };

    ws.onclose = () => {
      if (intentionalClose) {
        onStatusChange('disconnected');
        return;
      }
      if (reconnectCount < MAX_RECONNECT) {
        reconnectCount++;
        onStatusChange('reconnecting');
        const delay = Math.min(1000 * reconnectCount, 30_000);
        reconnectTimer = setTimeout(connect, delay);
      } else {
        onStatusChange('error');
      }
    };
  }

  connect();

  return {
    disconnect() {
      intentionalClose = true;
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}

export { HA_WS_URL, HA_TOKEN };
export default { createHAConnection, HA_WS_URL, HA_TOKEN };
