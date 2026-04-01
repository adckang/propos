'use strict';

// ============================================================
// haClient.js — Home Assistant REST API 클라이언트
// 대상: homeassistant.local:8123 (Tailscale VPN or 로컬)
// ============================================================

const HA_BASE  = 'http://192.168.45.76:8123';
const HA_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIyZThiNWNlY2U0MmU0ZjQ1ODc5ZjE1NDc4NTJkNjgyZCIsImlhdCI6MTc3NDk3MjM2OSwiZXhwIjoyMDkwMzMyMzY5fQ.fGrvj0ah1GenARULOtYrplDzlvgPl-injAB5Yqh2Zlw';

// TV방 entity ID 매핑
const TV_ROOM = {
  light  : 'light.rgbcct_8002',
  tv     : 'switch.tv_smart_plug_socket_1',
};

async function _post(path, data) {
  const res = await fetch(`${HA_BASE}${path}`, {
    method : 'POST',
    headers: {
      'Authorization': `Bearer ${HA_TOKEN}`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HA ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * 도어락 PIN 등록 — 실제 lock entity 없음 → HA 영구 알림으로 PIN 기록
 * @param {string} entityId
 * @param {string} code
 * @param {string} name
 */
async function setLockCode(entityId, code, name) {
  await _post('/api/services/persistent_notification/create', {
    title          : '[PROPOS] PIN 발급 완료',
    message        : `게스트: ${name}\nPIN: ${code}\n등록 entity: ${entityId}`,
    notification_id: `propos_pin_${entityId.replace(/\W/g, '_')}`,
  });
}

/**
 * HA 씬 실행 — checkin_ready 씬은 TV방 기기로 매핑
 * @param {string} entityId  "scene.checkin_ready_*" 형태
 */
async function activateScene(entityId) {
  if (entityId.includes('checkin_ready')) {
    // TV방 조명 켜기
    await _post('/api/services/light/turn_on', {
      entity_id : TV_ROOM.light,
      brightness: 255,
    });
    // TV 스마트 플러그 켜기
    await _post('/api/services/switch/turn_on', {
      entity_id: TV_ROOM.tv,
    });
    return;
  }
  // 그 외 씬은 그대로 실행
  await _post('/api/services/scene/turn_on', { entity_id: entityId });
}

/**
 * 웰컴 메시지 발송 — 에어비앤비 연동 없음 → HA 영구 알림으로 대체
 * @param {string} guestId
 * @param {string} text
 */
async function sendMessage(guestId, text) {
  await _post('/api/services/persistent_notification/create', {
    title          : `[PROPOS] 웰컴 메시지 — ${guestId}`,
    message        : text,
    notification_id: `propos_msg_${guestId}`,
  });
}

module.exports = { setLockCode, activateScene, sendMessage, HA_BASE, TV_ROOM };
