/**
 * s147 — RF-25 자동화 개선율 정책 계약.
 * 런타임 코드 기본값 없이 DB 마스터 → 숙소 재정의 순서로 실제 적용값을 고르고,
 * 그 스냅샷에 든 시간으로 사용자 알림 기준 문구를 만든다.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANOMALY_TYPES,
  formatAnomalyTimingCriterion,
  resolveAnomalyPolicy,
} from '../../src/domain/anomalyPolicyDomain.js';

const MASTER_VALUES = {
  noise: 5,
  vacant_energy_waste: 5,
  guest_complaint_sensor: 10,
  cleaning_unassigned: 0,
  device_offline: 5,
};

const master = {
  versionId: 'master-v1',
  effectiveFrom: '2026-11-24T00:00:00.000Z',
  values: MASTER_VALUES,
};

describe('RF-25 정책 적용값', () => {
  test('마스터 설정이 없으면 코드 기본값으로 대체하지 않는다', () => {
    assert.throws(
      () => resolveAnomalyPolicy({ type: 'noise', master: null }),
      /마스터 설정/,
    );
  });

  test('마스터에는 정본 5가지의 유효한 값이 모두 있어야 한다', () => {
    assert.deepEqual(ANOMALY_TYPES, Object.keys(MASTER_VALUES));
    const incomplete = { ...master, values: { ...MASTER_VALUES } };
    delete incomplete.values.device_offline;
    assert.throws(
      () => resolveAnomalyPolicy({ type: 'noise', master: incomplete }),
      /device_offline/,
    );
    assert.throws(
      () => resolveAnomalyPolicy({ type: 'noise', master: { ...master, values: { ...MASTER_VALUES, noise: -1 } } }),
      /noise/,
    );
  });

  test('숙소 재정의가 없으면 마스터 값을 당시 버전과 함께 스냅샷한다', () => {
    assert.deepEqual(resolveAnomalyPolicy({ type: 'guest_complaint_sensor', master }), {
      type: 'guest_complaint_sensor',
      stabilizationMinutes: 10,
      masterPolicyVersionId: 'master-v1',
      propertyPolicyVersionId: null,
      policyEffectiveFrom: '2026-11-24T00:00:00.000Z',
    });
  });

  test('숙소에 해당 유형 재정의가 있으면 우선하고 0분도 설정 없음과 구분한다', () => {
    const property = {
      versionId: 'property-v3',
      effectiveFrom: '2026-11-25T03:00:00.000Z',
      values: { noise: 0 },
    };
    assert.deepEqual(resolveAnomalyPolicy({ type: 'noise', master, property }), {
      type: 'noise',
      stabilizationMinutes: 0,
      masterPolicyVersionId: 'master-v1',
      propertyPolicyVersionId: 'property-v3',
      policyEffectiveFrom: '2026-11-25T03:00:00.000Z',
    });
    assert.equal(resolveAnomalyPolicy({ type: 'device_offline', master, property }).stabilizationMinutes, 5);
  });
});

describe('RF-25 알림 기준 시간', () => {
  test('발생 기준과 해결 안정화 시간을 간결하게 함께 표시한다', () => {
    assert.equal(
      formatAnomalyTimingCriterion({ detectionMinutes: 30, stabilizationMinutes: 5 }),
      '기준: 30분 이상 · 정상 5분 유지 시 해결',
    );
  });

  test('안정화 0분은 즉시 해결로 표시한다', () => {
    assert.equal(
      formatAnomalyTimingCriterion({ detectionMinutes: 720, stabilizationMinutes: 0 }),
      '기준: 720분 이상 · 해결 확인: 즉시',
    );
  });
});
