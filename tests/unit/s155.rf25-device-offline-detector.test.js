import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeviceOfflineAnomalyDetector,
  DEVICE_OFFLINE_DETECTION_MINUTES,
} from '../../src/application/deviceOfflineAnomalyDetector.js';
import {
  buildDeviceAvailability,
  configuredDeviceEntities,
  normalizeDeviceMaintenanceUntil,
  setDeviceMaintenanceHours,
} from '../../src/domain/deviceMaintenanceDomain.js';
import { formatDeviceOfflineCriterion } from '../../server/deviceOfflineAnomalies.js';
import { request } from '../helpers/eventApiFixture.js';

const MIN = 60_000;
const ENTITY = 'light.fixture_living';
const device = (status, overrides = {}) => ({ entityId: ENTITY, name: '거실 조명', status, ...overrides });

test('RF-25 기기 오프라인: 매핑 기기 unavailable이 연속 30분일 때만 발생한다', () => {
  const detector = new DeviceOfflineAnomalyDetector();
  assert.equal(DEVICE_OFFLINE_DETECTION_MINUTES, 30);
  assert.deepEqual(detector.evaluate({ devices: [device('offline')], now: 0 }), []);
  detector.markPersisted();
  assert.equal(detector.needsPersistence, false);
  assert.deepEqual(detector.evaluate({ devices: [device('offline')], now: 30 * MIN - 1 }), []);
  const [event] = detector.evaluate({ devices: [device('offline')], now: 30 * MIN });
  assert.equal(event.type, 'device_offline_detected');
  assert.equal(event.timestamp, 30 * MIN);
  assert.deepEqual(event.data, {
    entityId: ENTITY,
    deviceName: '거실 조명',
    detectionMinutes: 30,
    offlineStartedAt: new Date(0).toISOString(),
  });
  assert.deepEqual(detector.evaluate({ devices: [device('offline')], now: 31 * MIN }), []);
});
test('RF-25 기기 오프라인: unknown과 점검 제외 시간은 오프라인 지속 시간에서 제외한다', () => {
  const detector = new DeviceOfflineAnomalyDetector();
  detector.evaluate({ devices: [device('offline')], now: 0 });
  detector.evaluate({ devices: [device('unknown')], now: 20 * MIN });
  assert.deepEqual(detector.snapshot(), {});
  detector.evaluate({ devices: [device('offline')], now: 21 * MIN });
  detector.evaluate({ devices: [device('excluded')], now: 50 * MIN });
  assert.deepEqual(detector.snapshot(), {});
  detector.evaluate({ devices: [device('offline')], now: 51 * MIN });
  assert.deepEqual(detector.evaluate({ devices: [device('offline')], now: 81 * MIN - 1 }), []);
  assert.equal(detector.evaluate({ devices: [device('offline')], now: 81 * MIN })[0].type, 'device_offline_detected');
});

test('RF-25 기기 오프라인: 정상 안정화·재발·재시작을 기기별로 이어서 처리한다', () => {
  const detector = new DeviceOfflineAnomalyDetector();
  detector.evaluate({ devices: [device('offline')], now: 0 });
  detector.evaluate({ devices: [device('offline')], now: 30 * MIN });
  const [normal] = detector.evaluate({ devices: [device('online')], now: 31 * MIN });
  assert.equal(normal.type, 'device_online_normal');
  assert.equal(normal.data.normalStartedAt, new Date(31 * MIN).toISOString());

  const restarted = new DeviceOfflineAnomalyDetector();
  restarted.restore(JSON.parse(JSON.stringify(detector.snapshot())));
  assert.equal(restarted.acknowledgeNormal({
    entityId: ENTITY,
    normalStartedAt: 31 * MIN,
    complete: false,
    eligibleAt: new Date(36 * MIN).toISOString(),
  }), true);
  assert.deepEqual(restarted.evaluate({ devices: [device('online')], now: 36 * MIN - 1 }), []);
  const [confirmed] = restarted.evaluate({ devices: [device('online')], now: 36 * MIN });
  assert.equal(confirmed.type, 'device_online_normal');
  const [recurred] = restarted.evaluate({ devices: [device('offline')], now: 37 * MIN });
  assert.equal(recurred.type, 'device_offline_recurred');
  assert.equal(recurred.data.entityId, ENTITY);
});

test('RF-25 기기 오프라인: 설정에서 빠진 활성 기기는 대상 사라짐 신호를 낸다', () => {
  const detector = new DeviceOfflineAnomalyDetector();
  detector.evaluate({ devices: [device('offline')], now: 0 });
  detector.evaluate({ devices: [device('offline')], now: 30 * MIN });
  const [removed] = detector.evaluate({ devices: [], now: 31 * MIN });
  assert.equal(removed.type, 'device_offline_tracking_removed');
  assert.equal(removed.data.entityId, ENTITY);
  assert.deepEqual(detector.snapshot(), {});
});

test('RF-25 기기 오프라인: 같은 순간 여러 기기의 전송 시각을 겹치지 않게 보존한다', () => {
  const detector = new DeviceOfflineAnomalyDetector();
  const other = { entityId: 'switch.fixture_tv', name: 'TV', status: 'offline' };
  detector.evaluate({ devices: [device('offline'), other], now: 0 });
  const events = detector.evaluate({ devices: [device('offline'), other], now: 30 * MIN });
  assert.deepEqual(events.map(event => event.data.entityId), [ENTITY, other.entityId]);
  assert.equal(new Set(events.map(event => event.timestamp)).size, 2);
  assert.deepEqual(events.map(event => event.data.offlineStartedAt), [new Date(0).toISOString(), new Date(0).toISOString()]);
});

test('RF-25 기기 점검 설정: 매핑 기기만 유한 시간 제외하고 만료 뒤 자동 제거한다', () => {
  const devices = { LIGHT_LIVING: ENTITY, AC_MAIN: ['climate.fixture', ENTITY], UNUSED: null };
  assert.deepEqual(configuredDeviceEntities(devices), ['climate.fixture', ENTITY]);
  const configured = setDeviceMaintenanceHours({}, devices, ENTITY, 4, 0);
  assert.deepEqual(configured, { [ENTITY]: new Date(4 * 60 * MIN).toISOString() });
  assert.deepEqual(normalizeDeviceMaintenanceUntil({
    ...configured,
    'switch.not-mapped': new Date(5 * 60 * MIN).toISOString(),
    'climate.fixture': new Date(-1).toISOString(),
  }, devices, 0), configured);
  assert.deepEqual(normalizeDeviceMaintenanceUntil(configured, devices, 4 * 60 * MIN), {});
  assert.throws(() => setDeviceMaintenanceHours({}, devices, ENTITY, 48, 0), /시간이 올바르지/);
});

test('RF-25 기기 오프라인 관측: unavailable만 오프라인이고 unknown·점검은 구분한다', () => {
  const devices = { LIGHT_LIVING: ENTITY, AC_MAIN: 'climate.fixture', PLUG_TV: 'switch.missing' };
  const states = {
    [ENTITY]: { state: 'unavailable', attributes: { friendly_name: '거실 조명' } },
    'climate.fixture': { state: 'unknown', attributes: { friendly_name: '에어컨' } },
  };
  const maintenance = { [ENTITY]: new Date(4 * 60 * MIN).toISOString() };
  assert.deepEqual(buildDeviceAvailability(states, devices, maintenance, 0), [
    { entityId: 'climate.fixture', name: '에어컨', status: 'unknown' },
    { entityId: ENTITY, name: '거실 조명', status: 'excluded' },
    { entityId: 'switch.missing', name: 'switch.missing', status: 'unknown' },
  ]);
  assert.deepEqual(buildDeviceAvailability(states, devices, maintenance, 4 * 60 * MIN)
    .find(item => item.entityId === ENTITY), { entityId: ENTITY, name: '거실 조명', status: 'offline' });
});

test('RF-25 기기 오프라인 알림은 발생 30분과 사건에 저장된 해결 시간을 함께 표시한다', () => {
  assert.equal(formatDeviceOfflineCriterion(5), '기준: 30분 이상 · 정상 5분 유지 시 해결');
  assert.equal(formatDeviceOfflineCriterion(0), '기준: 30분 이상 · 해결 확인: 즉시');
});

test('RF-25 기기 오프라인 이벤트 API는 정본 이력에 연결하고 실제 기준 문구로 알린다', async () => {
  const alertLabel = '기기 오프라인 — 거실 조명 · 기준: 30분 이상 · 정상 7분 유지 시 해결';
  const anomaly = { complete: false, opened: true, resumed: false, anomalyId: '15500000-0000-4000-8000-000000000001', entityId: ENTITY, alertLabel };
  const result = await request('write', {
    type: 'device_offline_detected',
    is_soft: false,
    device_time: 30 * MIN,
    property_id: 'fixture-ingestion-property',
    source_system: 'HA_WATCHER',
    source_ref: 'watcher:event:device-offline',
    data: {
      entityId: ENTITY,
      deviceName: '거실 조명',
      detectionMinutes: 30,
      offlineStartedAt: new Date(0).toISOString(),
    },
  }, { duplicate: true, deviceOfflineResult: anomaly });
  assert.equal(result.res.code, 200);
  assert.deepEqual(result.res.body, { inserted: false, id: null, anomaly });
  assert.equal(result.deviceOfflineSignals.length, 1);
  assert.equal(result.notices[0][3].label, alertLabel);
});
