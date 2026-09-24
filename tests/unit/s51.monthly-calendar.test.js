import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFutureCalendarDays,
  buildFutureReservationSegments,
  buildIssueItems,
  buildStateSegmentsFromEvents,
  groupIssueItemsByKstDate,
  toKstDateKey,
} from '../../src/domain/monthlyCalendarDomain.js';
import { getDrilldownForMetric } from '../../src/application/reportingService.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('월간 문제 아이템은 감지 이벤트를 분류하고 해결 시각을 연결한다', () => {
  const events = [
    { property_id: 'p1', type: 'complaint_detected', device_time: new Date('2026-09-03T01:00:00Z') },
    { property_id: 'p1', type: 'complaint_resolved', device_time: new Date('2026-09-03T02:00:00Z') },
    { property_id: 'p2', type: 'vacant_energy_waste_detected', device_time: new Date('2026-09-03T15:30:00Z') },
  ];
  const items = buildIssueItems(events);

  assert.equal(items.length, 2);
  assert.equal(items[0].category, 'OCCUPIED');
  assert.equal(items[0].resolved_at, '2026-09-03T02:00:00.000Z');
  assert.equal(items[1].category, 'VACANT');
});

test('날짜 집계는 KST 자정을 기준으로 같은 날의 여러 분류를 함께 센다', () => {
  const items = [
    { property_id: 'p1', occurred_at: '2026-09-03T14:59:00Z', category: 'OCCUPIED', label: '민원' },
    { property_id: 'p1', occurred_at: '2026-09-03T15:01:00Z', category: 'CLEANING', label: '청소' },
  ];
  const days = groupIssueItemsByKstDate(items);

  assert.equal(toKstDateKey(items[0].occurred_at), '2026-09-03');
  assert.equal(toKstDateKey(items[1].occurred_at), '2026-09-04');
  assert.equal(days['2026-09-03'].total, 1);
  assert.equal(days['2026-09-04'].categories.CLEANING, 1);
});

test('청소 잡 문제도 동일한 날짜 문제 아이템 계약에 포함된다', () => {
  const items = buildIssueItems([], [{
    property_id: 'p1',
    occurred_at: new Date('2026-09-07T03:00:00Z'),
    category: 'CLEANING',
    type: 'cleaning_assignment_issue',
    label: '청소 미배정',
  }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].category, 'CLEANING');
  assert.equal(items[0].label, '청소 미배정');
});

test('단일 숙소 상태 구간은 월 시작 전 마지막 anchor부터 월 안 이벤트를 재생한다', () => {
  const range = {
    from: new Date('2026-08-31T15:00:00Z'),
    to: new Date('2026-09-30T14:59:59.999Z'),
  };
  const events = [
    { property_id: 'p1', type: 'check_in_detected', device_time: new Date('2026-08-31T10:00:00Z') },
    { property_id: 'p1', type: 'complaint_detected', device_time: new Date('2026-09-02T01:00:00Z') },
    { property_id: 'p1', type: 'complaint_resolved', device_time: new Date('2026-09-02T02:00:00Z') },
  ];
  const segments = buildStateSegmentsFromEvents(events, range, new Date('2026-09-03T00:00:00Z'));

  assert.deepEqual(segments.map(segment => segment.subStatus), [
    'GOOD_CONDITION',
    'ISSUE_COMPLAINT',
    'GOOD_CONDITION',
  ]);
  assert.equal(segments[0].start.toISOString(), range.from.toISOString());
  assert.equal(segments.at(-1).end.toISOString(), '2026-09-03T00:00:00.000Z');
});

test('월간 지표 상세는 선택 숙소 ID를 이벤트 조회에 전달한다', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await getDrilldownForMetric('cleaning_time', 'this_month', { db, propertyIds: ['P003'] });
  assert.deepEqual(calls[0].params[0], ['P003']);
  assert.match(calls[0].sql, /property_id = ANY/);
});

test('MonthlyView ALL은 null 대신 화면의 숙소 ID 전체를 전달한다', () => {
  const source = readFileSync(path.join(ROOT, 'src/components/v2/MonthlyView.jsx'), 'utf8');
  assert.match(source, /statsPropertyIds\s*=\s*noSelection\s*\?\s*\[\]\s*:\s*scope\.selectedIds/);
});

test('다음달 날짜 합계는 레포트의 예약·점유·청소 예정 합계와 일치한다', () => {
  const range = {
    from: new Date('2026-09-30T15:00:00Z'),
    to: new Date('2026-10-31T15:00:00Z'),
  };
  const properties = [
    { id: 'p1', reservations: [{ checkIn: new Date('2026-10-01T15:00:00Z'), checkOut: new Date('2026-10-03T15:00:00Z') }] },
    { id: 'p2', reservations: [{ checkIn: new Date('2026-10-02T15:00:00Z'), checkOut: new Date('2026-10-04T15:00:00Z') }] },
  ];
  const cleaningItems = [
    { property_id: 'p1', checkout_at: '2026-10-03T15:00:00Z', status: 'ASSIGNED' },
    { property_id: 'p2', checkout_at: '2026-10-04T15:00:00Z', status: 'ESCALATED' },
  ];
  const days = Object.values(buildFutureCalendarDays(properties, range, cleaningItems));

  assert.equal(days.reduce((sum, day) => sum + day.checkIns, 0), 2);
  assert.equal(days.reduce((sum, day) => sum + day.checkOuts, 0), 2);
  assert.equal(days.reduce((sum, day) => sum + day.occupiedRooms, 0), 4);
  assert.equal(days.reduce((sum, day) => sum + day.vacantRooms, 0), 58);
  assert.equal(days.reduce((sum, day) => sum + day.cleaningItems.length, 0), 2);
});

test('단일 숙소 다음달 막대는 예약 체류 구간만 사용한다', () => {
  const range = {
    from: new Date('2026-09-30T15:00:00Z'),
    to: new Date('2026-10-31T15:00:00Z'),
  };
  const property = {
    id: 'p1',
    reservations: [
      { checkIn: new Date('2026-09-29T15:00:00Z'), checkOut: new Date('2026-10-02T15:00:00Z') },
      { checkIn: new Date('2026-10-10T15:00:00Z'), checkOut: new Date('2026-10-12T15:00:00Z') },
    ],
  };
  const segments = buildFutureReservationSegments(property, range);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].start.toISOString(), range.from.toISOString());
  assert.equal(segments[0].mainStatus, 'OCCUPIED');
  assert.equal(segments[1].end.toISOString(), '2026-10-12T15:00:00.000Z');
});
