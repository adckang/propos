/**
 * S39 — 미래 레포트 도메인 TC
 *
 * 대상 함수:
 *   assessDeviceReadiness(haStates[], now?)  — HA 기기 준비 상태 판정
 *   getOccupancyIssues(properties[], now?)   — 체류중 이상 감지
 *
 * 위치: src/domain/futureReportDomain.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessDeviceReadiness,
  getOccupancyIssues,
} from '../../src/domain/futureReportDomain.js';

// ────────────────────────────────────────────────
// 공통 상수·헬퍼
// ────────────────────────────────────────────────

const NOW    = new Date('2026-09-14T12:00:00Z');
const H24_MS = 24 * 60 * 60 * 1000;

/** HA state 객체 생성 헬퍼 */
function makeHaState(entityId, state, attributes = {}, msAgo = 0) {
  return {
    entity_id:    entityId,
    state,
    attributes,
    last_updated: new Date(NOW.getTime() - msAgo).toISOString(),
  };
}

/** property 객체 생성 헬퍼 */
function makeProp(id, mainStatus, subStatus, checkOutMsFromNow = null) {
  return {
    id,
    name: `숙소 ${id}`,
    currentState: { mainStatus, subStatus },
    reservation: checkOutMsFromNow != null
      ? { checkOut: new Date(NOW.getTime() + checkOutMsFromNow) }
      : null,
  };
}

// ────────────────────────────────────────────────
// assessDeviceReadiness
// ────────────────────────────────────────────────

describe('assessDeviceReadiness — 기본', () => {

  test('빈 배열 → total 0, ready 0, readyRate null, issues []', () => {
    const r = assessDeviceReadiness([], NOW);
    assert.equal(r.total,    0);
    assert.equal(r.ready,    0);
    assert.equal(r.readyRate, null);
    assert.deepEqual(r.issues, []);
  });

  test('모두 정상 → issues 없음, readyRate 100', () => {
    const states = [
      makeHaState('binary_sensor.door',   'off',  { battery_level: 85 }),
      makeHaState('sensor.temp',          '22.5', {}),
    ];
    const r = assessDeviceReadiness(states, NOW);
    assert.equal(r.total,    2);
    assert.equal(r.ready,    2);
    assert.equal(r.readyRate, 100);
    assert.equal(r.issues.length, 0);
  });

  test('issues 항목에 entity_id 포함', () => {
    const states = [makeHaState('binary_sensor.door', 'unavailable', {})];
    const r = assessDeviceReadiness(states, NOW);
    assert.equal(r.issues[0].entity_id, 'binary_sensor.door');
  });

  test('friendly_name 있으면 issues 항목에 포함', () => {
    const states = [
      makeHaState('binary_sensor.door', 'unavailable', { friendly_name: '현관 도어센서' }),
    ];
    const r = assessDeviceReadiness(states, NOW);
    assert.equal(r.issues[0].friendly_name, '현관 도어센서');
  });

  test('friendly_name 없으면 entity_id 그대로', () => {
    const states = [makeHaState('binary_sensor.door', 'unavailable', {})];
    const r = assessDeviceReadiness(states, NOW);
    assert.ok(r.issues[0].friendly_name || r.issues[0].entity_id);
  });

});

describe('assessDeviceReadiness — offline 판정', () => {

  test('state === "unavailable" → problem: offline', () => {
    const r = assessDeviceReadiness(
      [makeHaState('binary_sensor.door', 'unavailable', {})],
      NOW,
    );
    assert.equal(r.issues[0].problem, 'offline');
    assert.equal(r.ready, 0);
  });

  test('state === "unknown" → problem: offline', () => {
    const r = assessDeviceReadiness(
      [makeHaState('sensor.temp', 'unknown', {})],
      NOW,
    );
    assert.equal(r.issues[0].problem, 'offline');
  });

  test('offline이 battery_low보다 우선', () => {
    const r = assessDeviceReadiness(
      [makeHaState('binary_sensor.door', 'unavailable', { battery_level: 5 })],
      NOW,
    );
    assert.equal(r.issues[0].problem, 'offline');
  });

  test('offline이 no_response보다 우선', () => {
    const r = assessDeviceReadiness(
      [makeHaState('binary_sensor.door', 'unavailable', {}, H24_MS + 1)],
      NOW,
    );
    assert.equal(r.issues[0].problem, 'offline');
  });

});

describe('assessDeviceReadiness — battery_low 판정', () => {

  test('battery_level 19 → problem: battery_low (경계값 미만)', () => {
    const r = assessDeviceReadiness(
      [makeHaState('binary_sensor.door', 'off', { battery_level: 19 })],
      NOW,
    );
    assert.equal(r.issues[0].problem, 'battery_low');
  });

  test('battery_level 20 → 정상 (경계값 이상)', () => {
    const r = assessDeviceReadiness(
      [makeHaState('binary_sensor.door', 'off', { battery_level: 20 })],
      NOW,
    );
    assert.equal(r.issues.length, 0);
  });

  test('battery_level 0 → battery_low', () => {
    const r = assessDeviceReadiness(
      [makeHaState('binary_sensor.door', 'off', { battery_level: 0 })],
      NOW,
    );
    assert.equal(r.issues[0].problem, 'battery_low');
  });

  test('battery_level 속성 없으면 배터리 체크 스킵', () => {
    const r = assessDeviceReadiness(
      [makeHaState('sensor.temp', 'off', {})],
      NOW,
    );
    assert.equal(r.issues.length, 0);
  });

  test('detail 문자열에 배터리 수치 포함', () => {
    const r = assessDeviceReadiness(
      [makeHaState('binary_sensor.door', 'off', { battery_level: 12 })],
      NOW,
    );
    assert.ok(r.issues[0].detail.includes('12'));
  });

});

describe('assessDeviceReadiness — no_response 판정', () => {

  test('last_updated 24시간 + 1ms 초과 → problem: no_response', () => {
    const r = assessDeviceReadiness(
      [makeHaState('binary_sensor.door', 'off', {}, H24_MS + 1)],
      NOW,
    );
    assert.equal(r.issues[0].problem, 'no_response');
  });

  test('last_updated 정확히 24시간 → 정상 (경계값)', () => {
    const r = assessDeviceReadiness(
      [makeHaState('binary_sensor.door', 'off', {}, H24_MS)],
      NOW,
    );
    assert.equal(r.issues.length, 0);
  });

  test('last_updated 없으면 no_response 체크 스킵', () => {
    const state = { entity_id: 'sensor.temp', state: 'off', attributes: {} };
    // last_updated 필드 없음
    const r = assessDeviceReadiness([state], NOW);
    assert.equal(r.issues.length, 0);
  });

});

describe('assessDeviceReadiness — 복합·집계', () => {

  test('정상 2 + 문제 2 → total 4, ready 2, readyRate 50', () => {
    const states = [
      makeHaState('binary_sensor.door',   'off',         { battery_level: 80 }),
      makeHaState('sensor.temp',          '22.5',        {}),
      makeHaState('binary_sensor.motion', 'unavailable', {}),
      makeHaState('sensor.humidity',      'off',         { battery_level: 10 }),
    ];
    const r = assessDeviceReadiness(states, NOW);
    assert.equal(r.total,    4);
    assert.equal(r.ready,    2);
    assert.equal(r.readyRate, 50);
    assert.equal(r.issues.length, 2);
  });

  test('readyRate는 Math.round 정수', () => {
    const states = [
      makeHaState('s.a', 'off', {}),
      makeHaState('s.b', 'off', {}),
      makeHaState('s.c', 'unavailable', {}),
    ];
    const r = assessDeviceReadiness(states, NOW);
    assert.equal(r.readyRate, 67); // Math.round(2/3*100)
  });

  test('전부 문제 → ready 0, readyRate 0', () => {
    const states = [
      makeHaState('s.a', 'unavailable', {}),
      makeHaState('s.b', 'unavailable', {}),
    ];
    const r = assessDeviceReadiness(states, NOW);
    assert.equal(r.ready,     0);
    assert.equal(r.readyRate, 0);
  });

});

// ────────────────────────────────────────────────
// getOccupancyIssues
// ────────────────────────────────────────────────

describe('getOccupancyIssues — 기본', () => {

  test('빈 배열 → issueCount 0, items []', () => {
    const r = getOccupancyIssues([], NOW);
    assert.equal(r.issueCount, 0);
    assert.deepEqual(r.items, []);
  });

  test('모두 GOOD_CONDITION → issues 없음', () => {
    const props = [
      makeProp('P001', 'OCCUPIED', 'GOOD_CONDITION', 3 * H24_MS),
      makeProp('P002', 'OCCUPIED', 'GOOD_CONDITION', 2 * H24_MS),
    ];
    const r = getOccupancyIssues(props, NOW);
    assert.equal(r.issueCount, 0);
    assert.equal(r.items.length, 0);
  });

});

describe('getOccupancyIssues — 이상 서브 상태 감지', () => {

  test('ISSUE_AND_ENERGY → 감지', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'OCCUPIED', 'ISSUE_AND_ENERGY', 2 * H24_MS)],
      NOW,
    );
    assert.equal(r.issueCount, 1);
    assert.equal(r.items[0].property_id, 'P001');
  });

  test('ISSUE_COMPLAINT → 감지', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'OCCUPIED', 'ISSUE_COMPLAINT', 2 * H24_MS)],
      NOW,
    );
    assert.equal(r.issueCount, 1);
  });

  test('ENERGY_WASTE → 감지', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'OCCUPIED', 'ENERGY_WASTE', 2 * H24_MS)],
      NOW,
    );
    assert.equal(r.issueCount, 1);
  });

  test('items에 subStatus 포함', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'OCCUPIED', 'ISSUE_AND_ENERGY', H24_MS)],
      NOW,
    );
    assert.equal(r.items[0].subStatus, 'ISSUE_AND_ENERGY');
  });

});

describe('getOccupancyIssues — OCCUPIED 외 무시', () => {

  test('VACANT → 무시', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'VACANT', 'CLEANING_FINISHED')],
      NOW,
    );
    assert.equal(r.issueCount, 0);
  });

  test('CLEANING → 무시', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'CLEANING', 'CLEANING_IN_PROGRESS')],
      NOW,
    );
    assert.equal(r.issueCount, 0);
  });

  test('PRE_STAY_READY → 무시', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'PRE_STAY_READY', 'OPTIMIZING')],
      NOW,
    );
    assert.equal(r.issueCount, 0);
  });

});

describe('getOccupancyIssues — remainingNights', () => {

  test('checkOut 3일 후 → remainingNights 3', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'OCCUPIED', 'ENERGY_WASTE', 3 * H24_MS)],
      NOW,
    );
    assert.equal(r.items[0].remainingNights, 3);
  });

  test('checkOut 1시간 후 → remainingNights 1 (올림)', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'OCCUPIED', 'ENERGY_WASTE', 60 * 60 * 1000)],
      NOW,
    );
    assert.equal(r.items[0].remainingNights, 1);
  });

  test('reservation 없으면 remainingNights null', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'OCCUPIED', 'ENERGY_WASTE', null)],
      NOW,
    );
    assert.equal(r.items[0].remainingNights, null);
  });

});

describe('getOccupancyIssues — 복합', () => {

  test('정상 + 이상 혼합 — 이상만 반환', () => {
    const props = [
      makeProp('P001', 'OCCUPIED', 'GOOD_CONDITION',   2 * H24_MS),
      makeProp('P002', 'OCCUPIED', 'ENERGY_WASTE',     1 * H24_MS),
      makeProp('P003', 'OCCUPIED', 'ISSUE_COMPLAINT',  3 * H24_MS),
      makeProp('P004', 'VACANT',   'CLEANING_FINISHED'),
    ];
    const r = getOccupancyIssues(props, NOW);
    assert.equal(r.issueCount, 2);
    assert.equal(r.items.length, 2);
    assert.ok(r.items.every(i => i.property_id !== 'P001'));
    assert.ok(r.items.every(i => i.property_id !== 'P004'));
  });

  test('items에 property_id, name, subStatus, remainingNights 모두 포함', () => {
    const r = getOccupancyIssues(
      [makeProp('P001', 'OCCUPIED', 'ISSUE_AND_ENERGY', 2 * H24_MS)],
      NOW,
    );
    const item = r.items[0];
    assert.ok('property_id'    in item);
    assert.ok('name'           in item);
    assert.ok('subStatus'      in item);
    assert.ok('remainingNights' in item);
  });

});
