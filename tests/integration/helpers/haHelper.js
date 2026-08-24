/**
 * haHelper — 통합 테스트용 HA REST 직접 호출 유틸
 *
 * 브라우저 프록시(/api/ha/*) 없이 서버 사이드에서 직접 HA REST API를 호출한다.
 * 실제 HA 연결 필요 (PROPOS_HA_BASE_URL, PROPOS_HA_TOKEN).
 */

import { HA_BASE_URL, HA_TOKEN } from './setup.js';

const headers = {
  Authorization: `Bearer ${HA_TOKEN}`,
  'Content-Type': 'application/json',
};

/**
 * input_boolean 토글
 * @param {string} entityId  e.g. 'input_boolean.propos_test_door'
 * @param {boolean} value    true → turn_on, false → turn_off
 */
export async function setInputBoolean(entityId, value) {
  const service = value ? 'turn_on' : 'turn_off';
  const res = await fetch(`${HA_BASE_URL}/api/services/input_boolean/${service}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ entity_id: entityId }),
  });
  if (!res.ok) throw new Error(`HA service call failed: ${res.status} (${entityId})`);
}

/**
 * 단일 엔티티 상태 조회
 * @param {string} entityId
 * @returns {Promise<{state: string, attributes: object}>}
 */
export async function getEntityState(entityId) {
  const res = await fetch(`${HA_BASE_URL}/api/states/${entityId}`, { headers });
  if (!res.ok) throw new Error(`HA state fetch failed: ${res.status} (${entityId})`);
  return res.json();
}

/**
 * 엔티티가 기대 상태가 될 때까지 폴링
 * @param {string} entityId
 * @param {string} expectedState  'on' | 'off' 등
 * @param {number} timeoutMs
 */
export async function waitForEntityState(entityId, expectedState, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await getEntityState(entityId);
    if (s.state === expectedState) return s;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout: ${entityId} 가 '${expectedState}'로 변하지 않음 (${timeoutMs}ms)`);
}
