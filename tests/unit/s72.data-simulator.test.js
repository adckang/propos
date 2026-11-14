import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSimulatedDataset,
  generateSyntheticProperties,
  validateDataset,
} from '../../src/data/dataSimulator.js';

function validDataset(origin = 'SIMULATED') {
  const dataset = buildSimulatedDataset(generateSyntheticProperties({
    propertyCount: 2,
    reservationsPerProperty: 4,
    startDate: '2026-10-12T00:00:00Z',
  }));
  for (const rows of [dataset.properties, dataset.reservations, dataset.jobs, dataset.events]) {
    for (const row of rows) row.data_origin = origin;
  }
  for (const property of dataset.properties) {
    property.source_system = origin === 'REAL' ? 'MANUAL' : 'SIMULATED_FIXTURE';
  }
  return dataset;
}

describe('data simulator contract', () => {
  test('DEMO 예약은 모든 KST 요일에서 날짜가 유효하고 P010의 다음 토요일 2박을 유지한다', async t => {
    const monday = Date.parse('2026-11-09T03:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now: monday });
    const findings = [];
    for (let day = 0; day < 7; day++) {
      t.mock.timers.setTime(monday + day * 86_400_000);
      const { PROPERTIES } = await import(`../../src/data/roomStateMockData.js?weekday-contract=${day}`);
      const dataset = buildSimulatedDataset(PROPERTIES);
      const result = validateDataset(dataset, { allowLegacyRealJobs: false });
      findings.push(...result.issues.map(issue => ({ day, code: issue.code, key: issue.key })));
      const property = PROPERTIES.find(row => row.id === 'P010');
      for (const reservation of [property.reservation, property.reservations[0]]) {
        const checkIn = new Date(reservation.checkIn.getTime() + 9 * 3_600_000);
        const checkOut = new Date(reservation.checkOut.getTime() + 9 * 3_600_000);
        if (checkIn.getUTCDay() !== 6 || checkOut.getUTCDay() !== 1
          || reservation.checkOut - reservation.checkIn !== 44 * 3_600_000) findings.push({ day, code: 'P010_TWO_NIGHT_SATURDAY_STAY' });
      }
    }
    assert.deepEqual(findings, []);
  });

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
    // 실제 배정 완료는 담당자와 함께 저장된다(RF-05.4) — 생성기의 가상 모양(담당자 없음)을 그대로 실제로 바꾸지 않는다
    const realCleanerId = '44444444-4444-4444-8444-444444444444';
    dataset.cleaners = [...(dataset.cleaners ?? []), { id: realCleanerId, name: 'Fixture Cleaner', active: true }];
    dataset.jobs = dataset.jobs.map(row => ({
      ...row, data_origin: 'REAL', source_ref: `legacy:cleaning_job:${row.reservation_uid}`,
      ...(['ASSIGNED', 'COMPLETED'].includes(row.status) && { assigned_cleaner_id: realCleanerId }),
    }));
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

  for (const origin of ['REAL', 'SIMULATED']) {
    test(`${origin} 담당자 목록이 비어 있어도 작업의 없는 담당자 참조를 탐지한다`, () => {
      const dataset = validDataset(origin);
      dataset.jobs[0].assigned_cleaner_id = '11111111-1111-4111-8111-111111111111';
      const result = validateDataset(dataset);
      assert.equal(result.ok, false);
      assert.equal(result.issues.filter(issue => issue.code === 'JOB_CLEANER_MISSING').length, 1);
    });

    test(`${origin} 담당자 목록이 비어 있어도 알림의 없는 담당자 참조를 탐지한다`, () => {
      const dataset = validDataset(origin);
      dataset.jobs[0].id = '22222222-2222-4222-8222-222222222222';
      dataset.notifs = [{ job_id: dataset.jobs[0].id, cleaner_id: '11111111-1111-4111-8111-111111111111', data_origin: origin }];
      const result = validateDataset(dataset);
      assert.equal(result.ok, false);
      assert.equal(result.issues.filter(issue => issue.code === 'NOTIF_CLEANER_MISSING').length, 1);
    });

    test(`${origin} 기록에 남은 비활성 담당자와 연결된 관계는 유효하다`, () => {
      const dataset = validDataset(origin);
      const cleanerId = '11111111-1111-4111-8111-111111111111';
      dataset.cleaners = [{ id: cleanerId, name: 'Fixture Cleaner', active: false }];
      dataset.jobs[0].id = '22222222-2222-4222-8222-222222222222';
      dataset.jobs[0].assigned_cleaner_id = cleanerId;
      dataset.notifs = [{ job_id: dataset.jobs[0].id, cleaner_id: cleanerId, data_origin: origin }];
      const result = validateDataset(dataset);
      assert.equal(result.ok, true);
      assert.equal(result.issues.filter(issue => ['JOB_CLEANER_MISSING', 'NOTIF_CLEANER_MISSING'].includes(issue.code)).length, 0);
    });
  }

  test('담당자 테이블이 생략된 입력의 참조도 검증한다', () => {
    const dataset = validDataset();
    delete dataset.cleaners;
    dataset.jobs[0].assigned_cleaner_id = '11111111-1111-4111-8111-111111111111';
    const result = validateDataset(dataset);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.code === 'JOB_CLEANER_MISSING'));
  });
});

// RF-05.4(2026-11-14, 사용자 선택 "실제 데이터 검사만 강화"): 실제 숙소의 배정 완료는 담당자가 있어야 한다.
// 캘린더 배정 공용 함수는 담당자 + 구글 일정을 함께 저장한다. 구글 일정 번호만 있고 담당자가 없으면
// 예전에 있었던 "배정 완료인데 담당자 없음" 오염과 같은 모양이다(담당자 없이도 저장되는 수동 배정 입구도 있다). 가상 숙소는 D-032 계약 그대로(일정 번호만으로 충분).
describe('RF-05.4 — 실제 숙소의 배정 완료는 담당자가 있어야 한다', () => {
  const cleanerId = '33333333-3333-4333-8333-333333333333';
  const cleanerWarnings = result => result.warnings.filter(issue => issue.code === 'REAL_ASSIGNED_CLEANER_MISSING');

  // 실제 숙소 데이터: 배정 완료 작업에는 실제처럼 담당자와 구글 일정이 함께 있다
  function realDataset() {
    const dataset = validDataset('REAL');
    dataset.cleaners = [...(dataset.cleaners ?? []), { id: cleanerId, name: 'Fixture Cleaner', active: true }];
    for (const job of dataset.jobs) {
      if (['ASSIGNED', 'COMPLETED'].includes(job.status)) {
        job.assigned_cleaner_id = cleanerId;
        job.google_event_id = `google-event-${job.reservation_uid}`;
      }
    }
    return dataset;
  }

  test('담당자·구글 일정이 함께 있는 실제 배정은 경고하지 않는다', () => {
    const result = validateDataset(realDataset());
    assert.equal(result.strictOk, true, JSON.stringify(result.warnings));
  });

  for (const status of ['ASSIGNED', 'COMPLETED']) {
    test(`실제 숙소의 ${status}에 구글 일정 번호만 있고 담당자가 없으면 경고한다`, () => {
      const dataset = realDataset();
      dataset.jobs[0].status = status;
      dataset.jobs[0].google_event_id = 'google-event-only';
      dataset.jobs[0].assigned_cleaner_id = null;
      const result = validateDataset(dataset);
      assert.equal(result.ok, true, '오류가 아니라 경고다(기존 기록을 보존하고 사람이 확인)');
      assert.equal(cleanerWarnings(result).length, 1);
      assert.equal(result.strictOk, false);
    });
  }

  test('실제 숙소에 담당자·일정 번호가 둘 다 없으면 기존 경고 하나만 낸다(중복 경고 없음)', () => {
    const dataset = realDataset();
    dataset.jobs[0].status = 'ASSIGNED';
    dataset.jobs[0].google_event_id = null;
    dataset.jobs[0].assigned_cleaner_id = null;
    const result = validateDataset(dataset);
    const forJob = result.warnings.filter(issue => issue.table === 'cleaning_jobs');
    assert.deepEqual(forJob.map(issue => issue.code), ['JOB_ASSIGNMENT_TRACE_MISSING']);
  });

  test('가상 숙소는 D-032 계약 그대로 — 가상 일정 번호만 있어도 경고하지 않는다', () => {
    const dataset = validDataset('SIMULATED');
    const assigned = dataset.jobs.filter(job => job.status === 'ASSIGNED');
    assert.ok(assigned.length > 0, '생성기가 배정 완료 작업을 만든다');
    assert.ok(assigned.every(job => !job.assigned_cleaner_id && job.google_event_id), '지금 생성기 모양: 담당자 없이 가상 일정 번호');
    const result = validateDataset(dataset);
    assert.equal(cleanerWarnings(result).length, 0);
    assert.equal(result.strictOk, true);
  });
});
