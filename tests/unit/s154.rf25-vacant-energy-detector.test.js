import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VacantEnergyAnomalyDetector,
  VACANT_ENERGY_DETECTION_MINUTES,
} from '../../src/application/vacantEnergyAnomalyDetector.js';
import { formatVacantEnergyCriterion } from '../../server/vacantEnergyAnomalies.js';
import { request } from '../helpers/eventApiFixture.js';

const MIN = 60_000;
const TARGET = '15400000-0000-4000-8000-000000000001';
const input = (activeSources, now, overrides = {}) => ({
  activeSources, now, eligible: true, targetEnded: false, ...overrides,
});

test('RF-25 빈방 에너지: 매핑 장치가 연속 30분 켜졌을 때만 기존 감지 이벤트를 한 번 낸다', () => {
  const detector = new VacantEnergyAnomalyDetector();
  assert.equal(VACANT_ENERGY_DETECTION_MINUTES, 30);
  assert.deepEqual(detector.evaluate(input(['거실 조명'], 0)), []);
  detector.markPersisted();
  assert.equal(detector.needsPersistence, false);
  assert.deepEqual(detector.evaluate(input(['거실 조명'], 30 * MIN - 1)), []);
  assert.deepEqual(detector.evaluate(input([], 30 * MIN)), []);
  assert.equal(detector.snapshot(), null, '30분 전에 꺼지면 짧은 가동은 제외한다');

  detector.evaluate(input(['에어컨'], 31 * MIN));
  const [event] = detector.evaluate(input(['에어컨', '거실 조명'], 61 * MIN));
  assert.equal(event.type, 'vacant_energy_waste_detected');
  assert.equal(event.timestamp, 61 * MIN);
  assert.deepEqual(event.data, {
    detectionMinutes: 30,
    conditionStartedAt: new Date(31 * MIN).toISOString(),
    activeSources: ['거실 조명', '에어컨'],
  });
  assert.deepEqual(detector.evaluate(input(['에어컨'], 62 * MIN)), []);
});

test('RF-25 빈방 에너지: DB 사건 식별자와 해결 안정화 시각을 재시작 뒤에도 이어서 처리한다', () => {
  const detector = new VacantEnergyAnomalyDetector();
  detector.evaluate(input(['에어컨'], 0));
  detector.evaluate(input(['에어컨'], 30 * MIN));
  assert.equal(detector.acknowledgeDetected({ targetRef: TARGET }), true);
  const [normal] = detector.evaluate(input([], 31 * MIN));
  assert.equal(normal.type, 'vacant_energy_waste_normal');
  assert.equal(normal.data.targetRef, TARGET);
  assert.equal(normal.data.normalStartedAt, new Date(31 * MIN).toISOString());

  const restarted = new VacantEnergyAnomalyDetector();
  restarted.restore(JSON.parse(JSON.stringify(detector.snapshot())));
  assert.equal(restarted.acknowledgeNormal({
    targetRef: TARGET,
    normalStartedAt: 31 * MIN,
    complete: false,
    eligibleAt: new Date(36 * MIN).toISOString(),
  }), true);
  assert.deepEqual(restarted.evaluate(input([], 36 * MIN - 1)), []);
  const [confirmed] = restarted.evaluate(input([], 36 * MIN));
  assert.equal(confirmed.type, 'vacant_energy_waste_normal');
  assert.equal(restarted.acknowledgeNormal({
    targetRef: TARGET,
    normalStartedAt: 31 * MIN,
    complete: true,
    resolvedAt: new Date(36 * MIN).toISOString(),
    confirmedAt: 36 * MIN,
  }), true);
  const [resolved] = restarted.evaluate(input([], 36 * MIN + 1));
  assert.equal(resolved.type, 'vacant_energy_waste_resolved');
  assert.equal(resolved.timestamp, 36 * MIN);
  assert.equal(resolved.reason, '빈방 장치 꺼짐 — 정상 5분 유지 후 해결');
  assert.equal(resolved.data.stabilizationMinutes, 5);
  assert.equal(resolved.data.confirmedAt, new Date(36 * MIN).toISOString());
  assert.equal(restarted.snapshot(), null);
});

test('RF-25 빈방 에너지: 장치 관측 공백은 지속·정상 시간을 만들지 않고 다음 입실만 미해결 종료한다', () => {
  const detector = new VacantEnergyAnomalyDetector();
  detector.evaluate(input(['에어컨'], 0));
  assert.deepEqual(detector.evaluate(input(null, 20 * MIN)), []);
  assert.equal(detector.snapshot(), null);

  detector.evaluate(input(['에어컨'], 21 * MIN));
  detector.evaluate(input(['에어컨'], 51 * MIN));
  assert.deepEqual(detector.evaluate(input([], 52 * MIN)), [], '서버 사건 식별자를 받기 전 정상 신호는 기다린다');
  detector.acknowledgeDetected({ targetRef: TARGET });
  const [normal] = detector.evaluate(input([], 53 * MIN));
  assert.equal(normal.type, 'vacant_energy_waste_normal');
  detector.evaluate(input(null, 54 * MIN));
  const [restartedNormal] = detector.evaluate(input([], 55 * MIN));
  assert.equal(restartedNormal.data.normalStartedAt, new Date(55 * MIN).toISOString());
  assert.equal(restartedNormal.data.restartStabilization, true);

  const [ended] = detector.evaluate(input(null, 56 * MIN, { eligible: false, targetEnded: true }));
  assert.equal(ended.type, 'vacant_energy_tracking_ended');
  assert.deepEqual(ended.data, { targetRef: TARGET });
});

test('RF-25 빈방 에너지: 해결 안정화 중 장치가 다시 켜지면 같은 사건의 재발 신호를 낸다', () => {
  const detector = new VacantEnergyAnomalyDetector();
  detector.evaluate(input(['조명'], 0));
  detector.evaluate(input(['조명'], 30 * MIN));
  detector.acknowledgeDetected({ targetRef: TARGET });
  detector.evaluate(input([], 31 * MIN));
  detector.acknowledgeNormal({
    targetRef: TARGET,
    normalStartedAt: 31 * MIN,
    complete: false,
    eligibleAt: new Date(36 * MIN).toISOString(),
  });
  const [recurred] = detector.evaluate(input(['조명'], 33 * MIN));
  assert.equal(recurred.type, 'vacant_energy_waste_recurred');
  assert.equal(recurred.data.targetRef, TARGET);
  assert.deepEqual(detector.evaluate(input(['조명'], 34 * MIN)), []);
});

test('RF-25 빈방 에너지 알림 기준은 발생 30분과 사건에 저장된 해결 시간을 함께 표시한다', () => {
  assert.equal(formatVacantEnergyCriterion(5), '기준: 30분 이상 · 정상 5분 유지 시 해결');
  assert.equal(formatVacantEnergyCriterion(0), '기준: 30분 이상 · 해결 확인: 즉시');
});

test('RF-25 빈방 에너지 이벤트 API는 중복 신호도 정본 ID로 처리하고 Pi에 사건 식별자를 돌려준다', async () => {
  const anomaly = {
    complete: false,
    opened: true,
    resumed: false,
    anomalyId: '15400000-0000-4000-8000-000000000002',
    targetRef: TARGET,
  };
  const result = await request('write', {
    type: 'vacant_energy_waste_detected',
    is_soft: false,
    device_time: 30 * MIN,
    property_id: 'fixture-ingestion-property',
    source_system: 'HA_WATCHER',
    source_ref: 'watcher:event:vacant-energy',
    data: {
      detectionMinutes: 30,
      conditionStartedAt: new Date(0).toISOString(),
      activeSources: ['거실 조명'],
    },
  }, { duplicate: true, vacantEnergyResult: anomaly });
  assert.equal(result.res.code, 200);
  assert.deepEqual(result.res.body, { inserted: false, id: null, anomaly });
  assert.equal(result.vacantEnergySignals.length, 1);
  assert.equal(result.vacantEnergySignals[0][1].eventId, '15300000-0000-4000-8000-000000000001');
});

test('RF-25 빈방 에너지 발생 알림은 실제 사건의 발생·해결 기준 문구를 전달한다', async () => {
  const alertLabel = '빈방 에너지 낭비 — 기준: 30분 이상 · 정상 7분 유지 시 해결';
  const result = await request('write', {
    type: 'vacant_energy_waste_detected',
    is_soft: false,
    device_time: 30 * MIN,
    property_id: 'fixture-ingestion-property',
    source_system: 'HA_WATCHER',
    source_ref: 'watcher:event:vacant-energy-alert',
    data: {
      detectionMinutes: 30,
      conditionStartedAt: new Date(0).toISOString(),
      activeSources: ['에어컨'],
    },
  }, { vacantEnergyResult: {
    complete: false, opened: true, resumed: false, anomalyId: TARGET, targetRef: TARGET, alertLabel,
  } });
  assert.equal(result.res.code, 200);
  assert.equal(result.notices.length, 1);
  assert.equal(result.notices[0][3].label, alertLabel);
});
