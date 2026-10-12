import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSimulatedDataset,
  generateSyntheticProperties,
  validateDataset,
} from '../../src/data/dataSimulator.js';

function validDataset() {
  return buildSimulatedDataset(generateSyntheticProperties({
    propertyCount: 2,
    reservationsPerProperty: 4,
    startDate: '2026-10-12T00:00:00Z',
  }));
}

describe('data simulator contract', () => {
  test('결정적 생성 결과는 관계형 행 수와 출처를 일관되게 만든다', () => {
    const dataset = validDataset();
    const result = validateDataset(dataset, { allowLegacyRealJobs: false });
    assert.equal(result.ok, true);
    assert.equal(result.strictOk, true);
    assert.equal(dataset.properties.length, 2);
    assert.equal(dataset.reservations.length, 8);
    assert.equal(dataset.jobs.length, 8);
    assert.ok(dataset.events.length >= 16);
    assert.deepEqual(result.summary.origins.properties, { SIMULATED: 2 });
    assert.deepEqual(result.summary.origins.jobs, { SIMULATED: 8 });
  });

  test('같은 입력은 같은 UID·이벤트를 만든다', () => {
    const input = generateSyntheticProperties({ propertyCount: 2, reservationsPerProperty: 3, startDate: '2026-10-12T00:00:00Z' });
    const first = buildSimulatedDataset(input, { seed: 'fixed-seed' });
    const second = buildSimulatedDataset(input, { seed: 'fixed-seed' });
    assert.deepEqual(first, second);
  });

  test('check_out <= check_in은 오류다', () => {
    const dataset = validDataset();
    dataset.reservations[0].check_out = dataset.reservations[0].check_in;
    const result = validateDataset(dataset);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.code === 'RESERVATION_DATE_ORDER'));
  });

  test('SIMULATED 청소작업의 예약 orphan은 오류다', () => {
    const dataset = validDataset();
    dataset.jobs[0].reservation_uid = 'sim:missing';
    const result = validateDataset(dataset);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.code === 'JOB_RESERVATION_MISSING'));
  });

  test('숙소와 하위 행의 data_origin이 다르면 오류다', () => {
    const dataset = validDataset();
    dataset.jobs[0].data_origin = 'REAL';
    const result = validateDataset(dataset);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.code === 'JOB_ORIGIN_MISMATCH'));
  });

  test('동일 숙소·체크아웃 청소작업 중복을 탐지한다', () => {
    const dataset = validDataset();
    dataset.jobs.push({ ...dataset.jobs[0], id: 'duplicate' });
    const result = validateDataset(dataset);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.code === 'JOB_DUPLICATE_CHECKOUT'));
  });

  test('동일 숙소·종류·시각 이벤트 중복을 탐지한다', () => {
    const dataset = validDataset();
    dataset.events.push({ ...dataset.events[0], id: 'duplicate-event' });
    const result = validateDataset(dataset);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.code === 'EVENT_DUPLICATE'));
  });

  test('현재 iCal에 없는 REAL 레거시 작업은 warning으로 보존한다', () => {
    const dataset = validDataset();
    const realPropertyId = dataset.properties[0].property_id;
    dataset.properties = dataset.properties.filter(row => row.property_id === realPropertyId);
    dataset.reservations = dataset.reservations.filter(row => row.property_id === realPropertyId);
    dataset.jobs = dataset.jobs.filter(row => row.property_id === realPropertyId);
    dataset.events = dataset.events.filter(row => row.property_id === realPropertyId);
    dataset.properties[0].data_origin = 'REAL';
    dataset.properties[0].source_system = 'AIRBNB_ICAL';
    dataset.properties[0].source_ref = 'ical:실제숙소';
    dataset.reservations = dataset.reservations.map(row => ({ ...row, data_origin: 'REAL', source_system: 'AIRBNB_ICAL', source_ref: 'ical:실제숙소' }));
    dataset.jobs = dataset.jobs.map(row => ({ ...row, data_origin: 'REAL', source_ref: `legacy:cleaning_job:${row.reservation_uid}` }));
    dataset.events = dataset.events.map(row => ({ ...row, data_origin: 'REAL', source_system: 'HA_WATCHER', source_ref: `legacy:event:${row.id}` }));
    dataset.reservations = dataset.reservations.slice(1);
    const result = validateDataset(dataset);
    assert.equal(result.ok, true);
    assert.equal(result.strictOk, false);
    assert.ok(result.warnings.every(issue => issue.code === 'REAL_LEGACY_RESERVATION_UNMATCHED'));
  });

  test('source_ref 없는 숙소는 오류다', () => {
    const dataset = validDataset();
    delete dataset.properties[0].source_ref;
    const result = validateDataset(dataset);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.code === 'PROPERTY_TRACE_REQUIRED'));
  });

  test('배정 완료인데 Google 이벤트·담당자 추적키가 없으면 warning이다', () => {
    const dataset = validDataset();
    dataset.jobs[0].status = 'ASSIGNED';
    dataset.jobs[0].google_event_id = null;
    delete dataset.jobs[0].assigned_cleaner_id;
    const result = validateDataset(dataset);
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some(issue => issue.code === 'JOB_ASSIGNMENT_TRACE_MISSING'));
  });

  test('청소자·알림 관계와 data_origin 불일치를 탐지한다', () => {
    const dataset = validDataset();
    dataset.jobs[0].id = 'job-1';
    dataset.jobs[0].assigned_cleaner_id = 'cleaner-1';
    dataset.cleaners = [{ id: 'cleaner-1', name: '테스트 청소자' }];
    dataset.notifs = [{
      id: 'notif-1',
      job_id: 'job-1',
      cleaner_id: 'cleaner-1',
      token: '123456',
      data_origin: 'REAL',
    }];
    const result = validateDataset(dataset);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.code === 'NOTIF_ORIGIN_MISMATCH'));
  });
});
