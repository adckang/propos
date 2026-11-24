import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NoiseAnomalyDetector,
  NOISE_ANOMALY_DETECTION_MINUTES,
  NOISE_ANOMALY_THRESHOLD_DB,
} from '../../src/application/noiseAnomalyDetector.js';
import { formatNoiseCriterion } from '../../server/noiseAnomalies.js';
import { request } from '../helpers/eventApiFixture.js';

const MIN = 60_000;
const STAY = '11111111-1111-4111-8111-111111111111';
const input = (noiseLevel, now, overrides = {}) => ({ noiseLevel, now, stayId: STAY, eligible: true, ...overrides });

test('RF-25 소음: 65dB 초과가 연속 3분일 때만 한 번 발생하고 짧은 스파이크는 제외한다', () => {
  const detector = new NoiseAnomalyDetector();
  assert.equal(NOISE_ANOMALY_THRESHOLD_DB, 65);
  assert.equal(NOISE_ANOMALY_DETECTION_MINUTES, 3);
  assert.deepEqual(detector.evaluate(input(66, 0)), []);
  assert.equal(detector.needsPersistence, true);
  detector.markPersisted();
  assert.equal(detector.needsPersistence, false);
  assert.deepEqual(detector.evaluate(input(90, 3 * MIN - 1)), []);
  assert.deepEqual(detector.evaluate(input(65, 3 * MIN)), []);
  assert.equal(detector.snapshot(), null);
  assert.equal(detector.needsPersistence, true, '저장된 초과 시작 시각도 짧은 스파이크가 끝나면 즉시 지운다');
  assert.deepEqual(detector.evaluate(input(70, 4 * MIN)), []);
  const [event] = detector.evaluate(input(75, 7 * MIN));
  assert.equal(event.type, 'noise_threshold_sustained');
  assert.equal(event.timestamp, 7 * MIN);
  assert.deepEqual(event.data, {
    stayId: STAY,
    thresholdDb: 65,
    detectionMinutes: 3,
    thresholdStartedAt: new Date(4 * MIN).toISOString(),
    maxDb: 75,
  });
  assert.deepEqual(detector.evaluate(input(80, 8 * MIN)), []);
});

test('RF-25 소음: 정상 시작과 DB 정책의 안정화 완료 시각에만 확인하고 재시작해도 중복 발행하지 않는다', () => {
  const detector = new NoiseAnomalyDetector();
  detector.evaluate(input(70, 0));
  detector.evaluate(input(70, 3 * MIN));
  const [normal] = detector.evaluate(input(60, 4 * MIN));
  assert.equal(normal.type, 'noise_threshold_normal');
  assert.equal(normal.data.normalStartedAt, new Date(4 * MIN).toISOString());
  assert.deepEqual(detector.evaluate(input(60, 5 * MIN)), []);

  const restarted = new NoiseAnomalyDetector();
  restarted.restore(JSON.parse(JSON.stringify(detector.snapshot())));
  assert.deepEqual(restarted.evaluate(input(60, 6 * MIN)), []);
  assert.equal(restarted.acknowledgeNormal({
    stayId: STAY,
    normalStartedAt: 4 * MIN,
    complete: false,
    eligibleAt: new Date(9 * MIN).toISOString(),
  }), true);
  assert.deepEqual(restarted.evaluate(input(60, 9 * MIN - 1)), []);
  const [confirmed] = restarted.evaluate(input(60, 9 * MIN));
  assert.equal(confirmed.type, 'noise_threshold_normal');
  assert.equal(confirmed.data.normalStartedAt, new Date(4 * MIN).toISOString());
  assert.equal(restarted.acknowledgeNormal({
    stayId: STAY,
    normalStartedAt: 4 * MIN,
    complete: true,
  }), true);
  assert.equal(restarted.snapshot(), null);
});

test('RF-25 소음: 센서값 누락은 추적을 끝내지 않고 숙박 종료만 미해결 종료 신호를 낸다', () => {
  const detector = new NoiseAnomalyDetector();
  detector.evaluate(input(70, 0));
  detector.evaluate(input(70, 3 * MIN));
  assert.deepEqual(detector.evaluate(input(null, 4 * MIN)), []);
  const [ended] = detector.evaluate(input(null, 5 * MIN, { eligible: false }));
  assert.equal(ended.type, 'noise_tracking_ended');
  assert.deepEqual(ended.data, { stayId: STAY });
  assert.equal(detector.snapshot(), null);
});

test('RF-25 소음: 안정화 중 센서값이 끊기면 정상 유지 시작을 다시 잡는다', () => {
  const detector = new NoiseAnomalyDetector();
  detector.evaluate(input(70, 0));
  detector.evaluate(input(70, 3 * MIN));
  const [firstNormal] = detector.evaluate(input(60, 4 * MIN));
  detector.evaluate(input(null, 5 * MIN));
  assert.equal(detector.acknowledgeNormal({
    stayId: STAY, normalStartedAt: 4 * MIN, complete: false, eligibleAt: new Date(9 * MIN).toISOString(),
  }), false, '끊기기 전 정상 구간의 늦은 응답은 쓰지 않는다');
  const [restarted] = detector.evaluate(input(60, 6 * MIN));
  assert.equal(firstNormal.data.restartStabilization, undefined);
  assert.equal(restarted.data.normalStartedAt, new Date(6 * MIN).toISOString());
  assert.equal(restarted.data.restartStabilization, true);
});

test('RF-25 소음 알림 기준은 발생 3분과 사건에 저장된 해결 시간을 함께 표시한다', () => {
  assert.equal(formatNoiseCriterion(5), '65dB 초과 · 기준: 3분 이상 · 정상 5분 유지 시 해결');
  assert.equal(formatNoiseCriterion(0), '65dB 초과 · 기준: 3분 이상 · 해결 확인: 즉시');
});

test('RF-25 소음 이벤트 API는 DB 중복 신호도 저장된 ID로 다시 처리하고 정상 확인 결과를 Pi에 돌려준다', async () => {
  const body = {
    type: 'noise_threshold_normal',
    is_soft: false,
    device_time: 9 * MIN,
    property_id: 'fixture-ingestion-property',
    source_system: 'HA_WATCHER',
    source_ref: 'watcher:event:noise-normal',
    data: {
      stayId: STAY,
      thresholdDb: 65,
      detectionMinutes: 3,
      normalStartedAt: new Date(4 * MIN).toISOString(),
    },
  };
  const noiseResult = { complete: false, resolved: false, eligibleAt: new Date(10 * MIN).toISOString() };
  const result = await request('write', body, { duplicate: true, noiseResult });
  assert.equal(result.res.code, 200);
  assert.deepEqual(result.res.body, { inserted: false, id: null, anomaly: noiseResult });
  assert.equal(result.noiseSignals.length, 1);
  assert.equal(result.noiseSignals[0][1].eventId, '15300000-0000-4000-8000-000000000001');
  assert.equal(result.notices.length, 0);
});

test('RF-25 소음 발생 알림은 실제 사건의 발생·해결 기준 문구를 전달한다', async () => {
  const alertLabel = '소음 이상 — 65dB 초과 · 기준: 3분 이상 · 정상 7분 유지 시 해결';
  const result = await request('write', {
    type: 'noise_threshold_sustained',
    is_soft: false,
    device_time: 3 * MIN,
    property_id: 'fixture-ingestion-property',
    source_system: 'HA_WATCHER',
    source_ref: 'watcher:event:noise-sustained',
    data: {
      stayId: STAY,
      thresholdDb: 65,
      detectionMinutes: 3,
      thresholdStartedAt: new Date(0).toISOString(),
    },
  }, { noiseResult: { complete: false, opened: true, resumed: false, anomalyId: STAY, alertLabel } });
  assert.equal(result.res.code, 200);
  assert.equal(result.notices.length, 1);
  assert.equal(result.notices[0][3].label, alertLabel);
});
