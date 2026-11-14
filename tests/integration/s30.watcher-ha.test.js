/**
 * s30 — OccupancyWatcher ↔ Home Assistant 통합 테스트
 *
 * IT-001 / IT-002: RUN_LIVE_HA=1 + HA 연결 설정으로 선택하는 실장치 시험
 * IT-003 / IT-004: 격리된 HA 응답으로 실제 워처·센서 준비 경로 검증
 *
 * HA 설정 전제 (사용자가 직접 HA에 생성):
 *   - area: "테스트룸"
 *   - input_boolean.propos_test_door  (area: 테스트룸)
 *   - input_boolean.propos_test_motion (area: 테스트룸)
 *
 * 기본 실행: npm run test:integration
 * 실장치 시험: RUN_LIVE_HA=1 node --test tests/integration/s30.watcher-ha.test.js
 */

import { describe, test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

import { HA_AVAILABLE, HA_BASE_URL, wait } from './helpers/setup.js';
import {
  startWatcher,
  stopWatcher,
  getMonitoringState,
  setMonitoringConfig,
  resetWatcher,
  waitForWatcherState,
} from './helpers/watcherHelper.js';
import { getEntityState, setInputBoolean, waitForEntityState } from './helpers/haHelper.js';

// HA가 필요한 테스트용 기본 config
const TEST_AREA = 'test room';
const TEST_CONFIG = { areaName: TEST_AREA };
let fixtureSequence = 0;

function preparationFixture(t, { temperatureAvailable = true } = {}) {
  const suffix = ++fixtureSequence;
  const temperatureEntity = `sensor.fixture_temperature_${suffix}`;
  const humidityEntity = `sensor.fixture_humidity_${suffix}`;
  const climateEntity = `climate.fixture_${suffix}`;
  const states = {
    [temperatureEntity]: { state: temperatureAvailable ? '29' : 'unavailable', attributes: { unit_of_measurement: '°C' } },
    [humidityEntity]: { state: '48', attributes: { unit_of_measurement: '%' } },
    [climateEntity]: { state: 'off', attributes: { hvac_modes: ['off', 'cool', 'heat'], temperature_unit: '°C' } },
  };
  const calls = [], unexpected = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = new URL(url);
    const data = options.body ? JSON.parse(options.body) : null;
    const response = body => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
    if (target.origin === new URL(HA_BASE_URL).origin) {
      const path = target.pathname;
      if (path === '/api/template') return response(Object.keys(states));
      if (path === '/api/services') return response([{ domain: 'notify', services: { mobile_app_fixture: {} } }]);
      if (path.startsWith('/api/states/')) {
        const state = states[path.slice('/api/states/'.length)];
        if (state) return response({ ...state, last_reported: new Date().toISOString() });
      }
      if (['/api/services/climate/set_temperature', '/api/services/climate/turn_off'].includes(path) && data?.entity_id === climateEntity) {
        calls.push({ path, data });
        states[climateEntity].state = path.endsWith('/turn_off') ? 'off' : data.hvac_mode;
        return response({});
      }
      if (['/api/services/persistent_notification/create', '/api/services/notify/mobile_app_fixture'].includes(path)) {
        calls.push({ path });
        return response({});
      }
    }
    unexpected.push('Unrecognized fixture request');
    throw new Error('Unrecognized fixture request');
  });
  t.after(async () => {
    try { await resetWatcher(); assert.deepEqual(unexpected, []); }
    finally { stopWatcher(); fetchMock.mock.restore(); }
  });
  return {
    calls,
    config: { areaName: 'fixture-property', dataOrigin: 'REAL', optimization: {
      operatorNotifyService: 'notify.mobile_app_fixture',
      rooms: [{ id: 'living', temperatureEntity, humidityEntity, climateEntity }],
    } },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// IT-001  WebSocket 연결 확인
// ────────────────────────────────────────────────────────────────────────────
describe('IT-001 WebSocket 연결', { skip: !HA_AVAILABLE ? 'RUN_LIVE_HA=1 및 HA 설정 필요' : false }, () => {
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
describe('IT-002 HA 이벤트 수신 → 처리', { skip: !HA_AVAILABLE ? 'RUN_LIVE_HA=1 및 HA 설정 필요' : false }, () => {
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
    const entity = 'input_boolean.propos_test_door';
    const original = await getEntityState(entity);
    assert.ok(['on', 'off'].includes(original?.state), '시험 전 스위치 상태 확인');
    try {
      const before = getMonitoringState().lastEventAt;
      await setInputBoolean(entity, original.state !== 'on');
      const after = await waitForWatcherState(s => s.lastEventAt > before, 3000);
      assert.ok(after.lastEventAt > before, 'HA 이벤트 후 processNow 실행됨 (lastEventAt 갱신)');
      assert.equal(after.lastError, null, '처리 오류 없음');
    } finally {
      await setInputBoolean(entity, original.state === 'on');
      await waitForEntityState(entity, original.state);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// IT-003  캘린더 이벤트 — 종료된 예약과 입실 지연 예약 구분
// ────────────────────────────────────────────────────────────────────────────
describe('IT-003 캘린더 이벤트 — 예약 유효기간', () => {
  test('퇴실까지 지난 예약은 준비를 시작하지 않는다', async t => {
    const fixture = preparationFixture(t);
    await resetWatcher();
    const previous = getMonitoringState().lastEventAt;
    await wait(1);
    setMonitoringConfig({ ...fixture.config, reservation: {
      checkIn: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      checkOut: new Date(Date.now() - 10 * 60_000).toISOString(),
    } });
    const state = await waitForWatcherState(s => s.lastEventAt > previous);
    assert.deepEqual(state.roomState, { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    assert.equal(state.preparation.run, null);
    assert.equal(fixture.calls.filter(call => call.path.endsWith('/set_temperature')).length, 0);
  });

  test('입실 시각이 지나도 퇴실 전·도착 미확인인 예약은 센서 준비를 시작한다', async t => {
    const fixture = preparationFixture(t);
    await resetWatcher();
    setMonitoringConfig({ ...fixture.config, reservation: {
      uid: 'late-arrival', checkIn: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      checkOut: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    } });
    const state = await waitForWatcherState(s => s.preparation.run?.status === 'PREPARING' && s.preparation.run.preflightPassed);
    assert.deepEqual(state.roomState, { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING' });
    assert.equal(state.preparation.run.status, 'PREPARING');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// IT-004  캘린더·센서·장치·알림 사전 검사 → 준비 시작 또는 안전 실패
// ────────────────────────────────────────────────────────────────────────────
describe('IT-004 캘린더 이벤트 — 센서 기반 준비', () => {
  test('입실 45분 전 정상 사전 검사 후 제어하며 실제 목표 미달이면 준비 중이다', async t => {
    const fixture = preparationFixture(t);
    await resetWatcher();
    setMonitoringConfig({ ...fixture.config, reservation: {
      uid: 'future-arrival', checkIn: new Date(Date.now() + 45 * 60_000).toISOString(),
      checkOut: new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString(),
    } });
    const state = await waitForWatcherState(s => s.preparation.run?.status === 'PREPARING' && s.preparation.run.preflightPassed);
    assert.deepEqual(state.roomState, { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING' });
    assert.equal(state.preparation.run.status, 'PREPARING');
    assert.equal(fixture.calls.filter(call => call.path.endsWith('/set_temperature')).length, 1);
    assert.equal(state.eventLog.filter(event => event.data?.optimizationRunId === state.preparation.run.id && event.type === 'optimization_finished').length, 0);
  });

  test('중요 센서 확인 불가 시 냉방 시작을 차단하고 안전 실패·알림을 기록한다', async t => {
    const fixture = preparationFixture(t, { temperatureAvailable: false });
    await resetWatcher();
    setMonitoringConfig({ ...fixture.config, reservation: {
      uid: 'sensor-failure', checkIn: new Date(Date.now() + 45 * 60_000).toISOString(),
      checkOut: new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString(),
    } });
    const state = await waitForWatcherState(s => s.preparation.run?.status === 'FAILED' && s.preparation.run.alerted);
    assert.deepEqual(state.roomState, { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZATION_FAILED' });
    assert.equal(state.preparation.run.reason, 'living:temperature_unavailable_or_stale');
    assert.equal(fixture.calls.filter(call => call.path.endsWith('/set_temperature')).length, 0);
    assert.equal(fixture.calls.filter(call => call.path.endsWith('/notify/mobile_app_fixture')).length, 1);
  });
});
