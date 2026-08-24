/**
 * s30 — OccupancyWatcher ↔ Home Assistant 통합 테스트
 *
 * IT-001 / IT-002: 실제 HA 연결 필요 (PROPOS_HA_BASE_URL + PROPOS_HA_TOKEN)
 * IT-003 / IT-004: HA 불필요 — 순수 캘린더 이벤트 로직 검증
 *
 * HA 설정 전제 (사용자가 직접 HA에 생성):
 *   - area: "테스트룸"
 *   - input_boolean.propos_test_door  (area: 테스트룸)
 *   - input_boolean.propos_test_motion (area: 테스트룸)
 *
 * 실행:  npm run test:integration
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { HA_AVAILABLE, wait } from './helpers/setup.js';
import {
  startWatcher,
  stopWatcher,
  getMonitoringState,
  setMonitoringConfig,
  setRoomState,
  resetWatcher,
  waitForWatcherState,
} from './helpers/watcherHelper.js';
import { setInputBoolean } from './helpers/haHelper.js';
import { INITIAL_STATE } from '../../src/domain/room-state/roomStateDomain.js';

// HA가 필요한 테스트용 기본 config
const TEST_AREA = 'test room';
const TEST_CONFIG = { areaName: TEST_AREA };

// ────────────────────────────────────────────────────────────────────────────
// IT-001  WebSocket 연결 확인
// ────────────────────────────────────────────────────────────────────────────
describe('IT-001 WebSocket 연결', { skip: !HA_AVAILABLE ? 'HA 미설정' : false }, () => {
  before(async () => {
    await resetWatcher(TEST_CONFIG);
  });

  after(() => stopWatcher());

  test('startWatcher() 후 5초 내 wsConnected: true', async () => {
    startWatcher();

    const state = await waitForWatcherState(
      s => s.wsConnected === true,
      5000,
    );

    assert.equal(state.wsConnected, true, 'HA WebSocket 연결 성공');
    assert.equal(state.lastError, null, '연결 오류 없음');
    assert.ok(Object.keys(getMonitoringState()).includes('roomState'), 'roomState 존재');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// IT-002  HA 이벤트 수신 → processNow 실행
// ────────────────────────────────────────────────────────────────────────────
describe('IT-002 HA 이벤트 수신 → 처리', { skip: !HA_AVAILABLE ? 'HA 미설정' : false }, () => {
  before(async () => {
    await resetWatcher(TEST_CONFIG);
    startWatcher();
    // 연결될 때까지 대기
    await waitForWatcherState(s => s.wsConnected === true, 5000);
    // 초기 debounce 정착
    await wait(600);
  });

  after(() => stopWatcher());

  test('input_boolean 토글 → lastEventAt 갱신', async () => {
    const before = getMonitoringState().lastEventAt;

    // HA REST로 도어 센서 토글 (on → off → on 으로 변화 보장)
    await setInputBoolean('input_boolean.propos_test_door', true);

    // debounce 500ms + 처리 여유 포함해서 최대 3초 대기
    const after = await waitForWatcherState(
      s => s.lastEventAt > before,
      3000,
    );

    assert.ok(after.lastEventAt > before, 'HA 이벤트 후 processNow 실행됨 (lastEventAt 갱신)');
    assert.equal(after.lastError, null, '처리 오류 없음');

    // 정리
    await setInputBoolean('input_boolean.propos_test_door', false).catch(() => {});
  });
});

// ────────────────────────────────────────────────────────────────────────────
// IT-003  캘린더 이벤트 — 과거 checkIn → 전환 없음
// ────────────────────────────────────────────────────────────────────────────
describe('IT-003 캘린더 이벤트 — 과거 checkIn 무시', () => {
  before(async () => {
    await resetWatcher();
    setRoomState(INITIAL_STATE); // VACANT/CLEANING_FINISHED
  });

  test('과거 checkIn 설정 후 상태가 VACANT 유지됨', async () => {
    const pastCheckIn = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2시간 전

    setMonitoringConfig({
      areaName: 'none',
      reservation: {
        checkIn:  pastCheckIn,
        checkOut: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    await wait(200); // checkCalendarEvents 완료 대기

    const state = getMonitoringState();
    assert.equal(state.roomState.mainStatus, 'VACANT', '과거 checkIn — VACANT 유지');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// IT-004  캘린더 이벤트 — 체크인 20분 후 → checkin_prep_time_reached 발동
// ────────────────────────────────────────────────────────────────────────────
describe('IT-004 캘린더 이벤트 — 체크인 근접 시 자동 전환', () => {
  before(async () => {
    await resetWatcher();
    setRoomState(INITIAL_STATE); // VACANT/CLEANING_FINISHED
  });

  test('checkIn = 지금 + 45분 → PRE_STAY_READY/OPTIMIZING 전환', async () => {
    // 45분: 1시간 이내(checkin_prep 발동) + 30분 초과(optimization_finished 미발동)
    const nearFutureCheckIn = new Date(Date.now() + 45 * 60 * 1000).toISOString();

    setMonitoringConfig({
      areaName: 'none',
      reservation: {
        checkIn:  nearFutureCheckIn,
        checkOut: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    // checkCalendarEvents() 비동기 완료 + applyTransition 완료 대기
    await wait(300);

    const state = getMonitoringState();
    assert.equal(
      state.roomState.mainStatus,
      'PRE_STAY_READY',
      '1시간 내 체크인 → PRE_STAY_READY 전환됨',
    );
    assert.equal(
      state.roomState.subStatus,
      'OPTIMIZING',
      '서브 상태 OPTIMIZING',
    );
  });
});
