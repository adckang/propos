/**
 * deviceActionExecutor.js — 상태 전환 시 HA 기기 제어 실행기
 *
 * 흐름:
 *   mainStatus → STATE_DEVICE_ACTIONS[mainStatus]
 *              → role → deviceMap[role] → entity_id(들)
 *              → ROLE_DOMAIN[role] → callHaService(domain, service, data)
 *
 * deviceMap 구조 (monitoring-config.json의 devices 필드):
 *   {
 *     "AC_MAIN":      "climate.lg_ac",
 *     "LIGHT_LIVING": ["light.ceiling", "light.floor_lamp"],  // 복수 지원
 *     "LOCK_ENTRANCE": null   // null or 미설정 → 건너뜀
 *   }
 */

import { callHaService } from './haProxy.js';
import { ROLE_DOMAIN, CMD } from '../src/domain/device-control/deviceRoles.js';
import { STATE_DEVICE_ACTIONS } from '../src/domain/device-control/stateActions.js';

function buildHaCall(role, cmd, entityId) {
  const domain = ROLE_DOMAIN[role];
  if (!domain) throw new Error(`알 수 없는 역할: ${role}`);

  switch (cmd.type) {
    case CMD.ON:
      return {
        domain,
        service: 'turn_on',
        data: {
          entity_id: entityId,
          ...(cmd.brightness != null ? { brightness_pct: cmd.brightness } : {}),
        },
      };

    case CMD.OFF:
      return { domain, service: 'turn_off', data: { entity_id: entityId } };

    case CMD.SET_TEMP:
      return {
        domain,
        service: 'set_temperature',
        data: {
          entity_id: entityId,
          temperature: cmd.value,
          ...(cmd.hvacMode ? { hvac_mode: cmd.hvacMode } : {}),
        },
      };

    case CMD.LOCK:
      return { domain, service: 'lock', data: { entity_id: entityId } };

    case CMD.UNLOCK:
      return { domain, service: 'unlock', data: { entity_id: entityId } };

    default:
      throw new Error(`알 수 없는 커맨드: ${cmd.type}`);
  }
}

function resolveEntityIds(role, deviceMap) {
  const val = deviceMap[role];
  if (!val) return [];
  const ids = Array.isArray(val) ? val : [val];
  return ids.filter(Boolean);
}

/**
 * @param {string} mainStatus   OCCUPIED | CLEANING | PRE_STAY_READY | VACANT
 * @param {object} deviceMap    { DEVICE_ROLE: string | string[] | null }
 * @returns {{ executed: object[], skipped: object[] }}
 */
export async function executeStateActions(mainStatus, deviceMap = {}) {
  const actions = STATE_DEVICE_ACTIONS[mainStatus];
  if (!actions?.length) return { executed: [], skipped: [] };

  const executed = [];
  const skipped  = [];

  for (const { role, cmd } of actions) {
    const entityIds = resolveEntityIds(role, deviceMap);

    if (!entityIds.length) {
      skipped.push({ role, reason: '매핑 없음' });
      continue;
    }

    for (const entityId of entityIds) {
      try {
        const haCall = buildHaCall(role, cmd, entityId);
        await callHaService(haCall.domain, haCall.service, haCall.data);
        executed.push({ role, entityId, cmd });
      } catch (err) {
        skipped.push({ role, entityId, reason: err.message });
        console.warn(`[DeviceExecutor] ${role}(${entityId}) 실패:`, err.message);
      }
    }
  }

  return { executed, skipped };
}
