/**
 * watcherHelper — occupancyWatcher 제어 헬퍼
 *
 * 시험 사이 진행 중 준비·설정·방 상태를 정리한다.
 * - stopWatcher(): ws + calendarTimer + reconnectTimer + debounceTimer 모두 해제
 * - setRoomState(INITIAL_STATE): 상태 머신 리셋
 * - setMonitoringConfig(cfg): 새 config 주입 → initEntityMap + checkCalendarEvents 재실행
 */

import '../../helpers/isolateDataDir.js';
import { wait } from './setup.js';
import {
  startWatcher,
  stopWatcher,
  getMonitoringState,
  setMonitoringConfig,
  setRoomState,
} from '../../../server/occupancyWatcher.js';
import { INITIAL_STATE } from '../../../src/domain/room-state/roomStateDomain.js';

export { startWatcher, stopWatcher, getMonitoringState, setMonitoringConfig, setRoomState };

/**
 * 진행 중 준비를 종결하고 설정·방 상태를 초기화한다.
 * @param {object} [cfg]  null이면 areaName 없이 초기화 (캘린더 테스트용)
 */
export async function resetWatcher(cfg = null) {
  stopWatcher();
  setMonitoringConfig({ areaName: null, reservation: null, optimization: null, devices: null, district: null });
  await waitForWatcherState(state => state.config?.areaName === null
    && state.preparation.run?.status !== 'PREPARING' && !state.preparation.run?.pendingOff?.length);
  setRoomState({ ...INITIAL_STATE });
  if (cfg) setMonitoringConfig(cfg);
}

/**
 * predicate가 true가 될 때까지 폴링한다.
 * @param {(state: object) => boolean} predicate
 * @param {number} timeoutMs
 * @param {number} intervalMs
 * @returns {Promise<object>} 만족한 시점의 monitoring state
 */
export async function waitForWatcherState(predicate, timeoutMs = 5000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = getMonitoringState();
    if (predicate(state)) return state;
    await wait(intervalMs);
  }
  throw new Error(`Timeout: watcher 상태가 ${timeoutMs}ms 내에 조건을 만족하지 않음\n현재: ${JSON.stringify(getMonitoringState())}`);
}
