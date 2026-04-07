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

// ── 센서 엔티티 매핑 (TV방 실제 센서) ─────────────────────────
const SENSOR_ENTITIES = {
  temperature: 'sensor.temperature_humidity_sensor_temperature',
  humidity:    'sensor.temperature_humidity_sensor_humidity',
  // noise/power: 미연동 (센서 없음)
};

/**
 * HA REST API로 센서 상태 조회
 * @param {string}   entityId
 * @param {Function} [fetchImpl]  - 테스트 주입용 (기본: global fetch)
 * @returns {Promise<number|null>}  파싱 실패 / 404 / unavailable → null
 */
async function _getState(entityId, fetchImpl) {
  const f = fetchImpl || fetch;
  let res;
  try {
    res = await f(`${HA_BASE}/api/states/${entityId}`, {
      headers: { 'Authorization': `Bearer ${HA_TOKEN}` },
    });
  } catch (_) {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data) return null;
  const v = parseFloat(data.state);
  return isNaN(v) ? null : v;
}

/**
 * 숙소 센서 상태 일괄 조회
 * @param {string}   propId
 * @param {Function} [fetchImpl]  - 테스트 주입용
 * @returns {Promise<SensorReading>}
 */
async function getSensorStates(propId, fetchImpl) {
  const [temp, humidity] = await Promise.all([
    _getState(SENSOR_ENTITIES.temperature, fetchImpl),
    _getState(SENSOR_ENTITIES.humidity,    fetchImpl),
  ]);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  return { propId, time: hhmm, temp, humidity, noise: null, power: null };
}

module.exports = { setLockCode, activateScene, sendMessage, getSensorStates, HA_BASE, HA_TOKEN, TV_ROOM };
