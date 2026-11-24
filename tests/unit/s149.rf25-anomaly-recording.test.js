import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnomalyIncidentKey } from '../../server/anomalyRepository.js';

describe('RF-25 이상 사건 열쇠', () => {
  test('유형별 내부 대상 식별자를 사용하고 구분 문자를 안전하게 인코딩한다', () => {
    assert.equal(buildAnomalyIncidentKey({
      type: 'noise', propertyId: '파주:201', stayId: 'stay-1',
    }), 'noise:%ED%8C%8C%EC%A3%BC%3A201:stay:stay-1');
    assert.equal(buildAnomalyIncidentKey({
      type: 'cleaning_unassigned', propertyId: 'p1', cleaningObligationId: 'obligation-1',
    }), 'cleaning_unassigned:p1:obligation:obligation-1');
    assert.equal(buildAnomalyIncidentKey({
      type: 'guest_complaint_sensor', propertyId: 'p1', stayId: 'stay-1', targetRef: 'noise:late-night',
    }), 'guest_complaint_sensor:p1:stay:stay-1:topic:noise%3Alate-night');
    assert.equal(buildAnomalyIncidentKey({
      type: 'device_offline', propertyId: 'p1', targetRef: 'sensor.front-door',
    }), 'device_offline:p1:target:sensor.front-door');
  });

  test('외부 예약 UID 대신 필요한 내부 대상이 없으면 거절한다', () => {
    assert.throws(() => buildAnomalyIncidentKey({ type: 'noise', propertyId: 'p1' }), /사건 열쇠 값/);
    assert.throws(() => buildAnomalyIncidentKey({ type: 'cleaning_unassigned', propertyId: 'p1' }), /사건 열쇠 값/);
    assert.throws(() => buildAnomalyIncidentKey({ type: 'unknown', propertyId: 'p1', targetRef: 'x' }), /알 수 없는 이상 유형/);
  });
});
