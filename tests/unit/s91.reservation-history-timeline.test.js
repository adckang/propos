/**
 * s91 — 지난 예약 일정이 타임라인에서 사라지던 버그 (2026-11-04 실사용 중 발견)
 *
 * 시나리오: 파주201 운영자가 숙소 상세를 열면 오늘 이전이 텅 비어 있고, 대시보드 캘린더(숙소 선택)는
 * 오늘 이전이 전부 빨간색(청소중)이었다. 예약·청소 기록은 DB에 그대로 있었다 —
 *   - 숙소 상세: deriveTimeline 이 가장 최근 숙박 1건만 그렸다.
 *   - 캘린더: 지난 막대를 감지기 기록만으로 그려, 퇴실 감지 뒤 "청소 끝남"이 안 오면 청소중으로 굳었다.
 * 고친 뒤: 지난 구간도 예약 기록으로 미래와 같은 순서(공실→입실준비→체류→청소)로 다시 그린다.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReservationHistorySegments, segmentsBefore } from '../../src/domain/reservationHistoryDomain.js';
import { buildLiveProperty, deriveCurrentState, deriveTimeline, lastPastReservation } from '../../src/application/calendarSyncService.js';
import { getWindowSegments, getGanttSegments } from '../../src/data/roomStateMockData.js';
import { ASSIGNED_STATUSES } from '../../src/domain/cleaningStatsDomain.js';
import { kst, withFrozenNow } from '../helpers/testTime.js';
import { evaluateMemo, readSource } from '../helpers/sourceCode.js';

const at = value => kst(`2026-${value}`);
const iso = value => at(value).toISOString();
const template = { id: '파주201', name: '파주201', checkOutHour: 11, cleaningDurationHours: 3 };

// 10/20~22, 10/25~27 은 지난 숙박, 11/03~06 은 지금(11/04) 체류 중, 11/08~ 은 다음 예약
function stays() {
  return [
    { uid: 'a', checkIn: at('10-20T15:00'), checkOut: at('10-22T11:00'), cleaningAt: at('10-22T12:00'), cleaningEnd: at('10-22T15:00'), cleaningStatus: 'COMPLETED', cleanerName: '김청소' },
    { uid: 'b', checkIn: at('10-25T15:00'), checkOut: at('10-27T11:00'), cleaningStatus: 'ASSIGNED', cleanerName: '이청소' },
    { uid: 'c', checkIn: at('11-03T15:00'), checkOut: at('11-06T11:00'), cleaningAt: at('11-06T12:00'), cleaningEnd: at('11-06T15:00'), cleaningStatus: 'ASSIGNED', cleanerName: '박청소' },
    { uid: 'd', checkIn: at('11-08T15:00'), checkOut: at('11-10T11:00') },
  ];
}
const rows = segments => segments.map(s => [s.mainStatus, s.subStatus, s.start.toISOString(), s.end?.toISOString() ?? null]);

const withNow = (value, run) => withFrozenNow(at(value), run);

function assertContiguous(segments) {
  for (let i = 1; i < segments.length; i++) {
    assert.equal(segments[i].start.getTime(), segments[i - 1].end.getTime(),
      `구간 ${i - 1}→${i} 사이에 빈틈/겹침: ${segments[i - 1].end?.toISOString()} vs ${segments[i].start.toISOString()}`);
  }
}

const indicatorMap = (property, recentSegs) => evaluateMemo('src/components/v2/PropertyDetailView.jsx', 'cleaningInfoMap',
  { property, recentSegs, lastPastReservation, ASSIGNED_STATUSES });

// ── L1: 예약 기록 → 지난 구간 ───────────────────────────────────────────────
describe('buildReservationHistorySegments — 지난 예약을 미래와 같은 순서로 다시 그린다', () => {
  test('지난 숙박 두 번: 입실준비 → 체류 → 청소대기 → 청소 → 공실이 빈틈 없이 이어진다', () => {
    const segments = buildReservationHistorySegments(stays().slice(0, 2), at('10-28T00:00'), 3);
    assert.deepEqual(rows(segments), [
      ['PRE_STAY_READY', 'OPTIMIZING', iso('10-20T14:00'), iso('10-20T14:30')],
      ['PRE_STAY_READY', 'OPTIMIZED', iso('10-20T14:30'), iso('10-20T15:00')],
      ['OCCUPIED', 'GOOD_CONDITION', iso('10-20T15:00'), iso('10-22T11:00')],
      ['CLEANING', 'CLEANING_PENDING', iso('10-22T11:00'), iso('10-22T12:00')],       // 저장된 청소 시각 12~15시
      ['CLEANING', 'CLEANING_IN_PROGRESS', iso('10-22T12:00'), iso('10-22T15:00')],
      ['VACANT', 'CLEANING_FINISHED', iso('10-22T15:00'), iso('10-25T14:00')],
      ['PRE_STAY_READY', 'OPTIMIZING', iso('10-25T14:00'), iso('10-25T14:30')],
      ['PRE_STAY_READY', 'OPTIMIZED', iso('10-25T14:30'), iso('10-25T15:00')],
      ['OCCUPIED', 'GOOD_CONDITION', iso('10-25T15:00'), iso('10-27T11:00')],
      ['CLEANING', 'CLEANING_IN_PROGRESS', iso('10-27T11:00'), iso('10-27T14:00')],   // 청소 시각 없음 → 퇴실 + 3시간
      ['VACANT', 'CLEANING_FINISHED', iso('10-27T14:00'), iso('10-28T00:00')],
    ]);
    assert.ok(segments.every(s => s.isFuture === false));
  });

  test('청소 구간은 그 청소를 만든 예약의 체크아웃 키를 갖는다 (담당자 찾기용)', () => {
    const cleaning = buildReservationHistorySegments(stays().slice(0, 2), at('10-28T00:00'), 3).filter(s => s.mainStatus === 'CLEANING');
    assert.deepEqual(cleaning.map(s => s.cleaningCheckoutAt.toISOString()),
      [iso('10-22T11:00'), iso('10-22T11:00'), iso('10-27T11:00')]);
  });

  test('until 에서 잘린다 — 진행 중 숙박은 until 까지만, until 이후 예약은 그리지 않는다', () => {
    const segments = buildReservationHistorySegments(stays(), at('11-04T10:00'), 3);
    const last = segments.at(-1);
    assert.deepEqual([last.mainStatus, last.start.toISOString(), last.end.toISOString()],
      ['OCCUPIED', iso('11-03T15:00'), iso('11-04T10:00')]);
    assert.ok(segments.every(s => s.end <= at('11-04T10:00')));
    assert.ok(!segments.some(s => s.start >= at('11-08T00:00')));
  });

  test('until 직후 체크인하는 예약은 입실준비 구간까지 그린다 (공실로 끝나지 않음)', () => {
    const segments = buildReservationHistorySegments(stays().slice(0, 2), at('10-25T14:40'), 3);
    assert.deepEqual(rows(segments.slice(-2)), [
      ['PRE_STAY_READY', 'OPTIMIZING', iso('10-25T14:00'), iso('10-25T14:30')],
      ['PRE_STAY_READY', 'OPTIMIZED', iso('10-25T14:30'), iso('10-25T14:40')],
    ]);
  });

  test('같은 예약이 다른 uid 로 두 번 있어도(실제 현상) 한 번 그린 것과 같다', () => {
    const once = buildReservationHistorySegments(stays().slice(0, 2), at('10-28T00:00'), 3);
    const dup = buildReservationHistorySegments([...stays().slice(0, 2), { ...stays()[0], uid: 'a-dup' }], at('10-28T00:00'), 3);
    assert.deepEqual(rows(dup), rows(once));
  });

  test('겹치는 예약도 구간이 겹치거나 되돌아가지 않는다', () => {
    const overlapping = [
      { checkIn: at('10-20T15:00'), checkOut: at('10-23T11:00') },
      { checkIn: at('10-22T15:00'), checkOut: at('10-24T11:00') },
    ];
    const segments = buildReservationHistorySegments(overlapping, at('10-25T00:00'), 3);
    assertContiguous(segments);
    assert.ok(segments.every(s => s.end > s.start));
  });

  test('기록이 없으면 아무것도 지어내지 않는다', () => {
    assert.deepEqual(buildReservationHistorySegments([], at('10-28T00:00')), []);
    assert.deepEqual(buildReservationHistorySegments(undefined, at('10-28T00:00')), []);
    assert.deepEqual(buildReservationHistorySegments(stays(), null), []);
    // 첫 예약 입실준비 이전 시점까지는 그릴 것이 없다
    assert.deepEqual(buildReservationHistorySegments(stays(), at('10-20T13:00')), []);
    // 날짜가 깨진 예약은 건너뛴다
    assert.deepEqual(buildReservationHistorySegments([{ checkIn: 'x', checkOut: at('10-22T11:00') }], at('10-28T00:00')), []);
  });
});

describe('buildReservationHistorySegments — 겹침·경계 (코드 리뷰 반영)', () => {
  test('날짜가 바뀐 예약의 옛 행이 남아 있어도(같은 체크인, 다른 체크아웃) 청소 뒤에 유령 체류가 생기지 않는다', () => {
    const rows2 = [
      { uid: 'old', checkIn: at('10-20T15:00'), checkOut: at('10-22T11:00') },
      { uid: 'new', checkIn: at('10-20T15:00'), checkOut: at('10-23T11:00'), cleaningStatus: 'ASSIGNED' },
    ];
    for (const order of [rows2, [...rows2].reverse()]) {
      const segments = buildReservationHistorySegments(order, at('10-24T00:00'), 3);
      assert.equal(segments.filter(s => s.mainStatus === 'OCCUPIED').length, 1);
      assert.deepEqual(rows(segments.filter(s => s.mainStatus !== 'PRE_STAY_READY')), [
        ['OCCUPIED', 'GOOD_CONDITION', iso('10-20T15:00'), iso('10-23T11:00')],
        ['CLEANING', 'CLEANING_IN_PROGRESS', iso('10-23T11:00'), iso('10-23T14:00')],
        ['VACANT', 'CLEANING_FINISHED', iso('10-23T14:00'), iso('10-24T00:00')],
      ]);
      assert.equal(segments.find(s => s.mainStatus === 'CLEANING').cleaningCheckoutAt.getTime(), at('10-23T11:00').getTime(),
        '청소는 가장 늦게 퇴실하는 예약 기준');
    }
  });

  test('openEnded: 지금을 포함하는 구간만 end=null 로 열고, 경계 시각은 deriveCurrentState 와 같다', () => {
    const cases = [
      ['10-22T11:00', 'CLEANING', 'CLEANING_PENDING'],      // 퇴실 정각
      ['10-22T12:00', 'CLEANING', 'CLEANING_IN_PROGRESS'],  // 청소 시작 정각
      ['10-22T15:00', 'VACANT', 'CLEANING_FINISHED'],       // 청소 끝 정각 — 청소중으로 남지 않음
      ['10-25T14:00', 'PRE_STAY_READY', 'OPTIMIZING'],      // 입실준비 시작 정각
      ['10-25T15:00', 'OCCUPIED', 'GOOD_CONDITION'],        // 체크인 정각
    ];
    for (const [now, main, sub] of cases) {
      const segments = buildReservationHistorySegments(stays(), at(now), 3, { openEnded: true });
      const last = segments.at(-1);
      assert.deepEqual([last.mainStatus, last.subStatus, last.end], [main, sub, null], now);
      assert.ok(segments.slice(0, -1).every(seg => seg.end && seg.end <= at(now)), now);
      const current = deriveCurrentState(stays(), at(now), 3);
      assert.deepEqual([current.mainStatus, current.subStatus], [main, sub], `deriveCurrentState ${now}`);
    }
  });

  test('segmentsBefore: 예약 기록이 시작되기 전 기간만 다른 출처로 채운다', () => {
    const fallback = [
      { mainStatus: 'VACANT', start: at('10-18T00:00'), end: at('10-19T00:00') },
      { mainStatus: 'CLEANING', start: at('10-19T00:00'), end: at('10-23T00:00') },   // 감지기에서 굳은 청소중
      { mainStatus: 'OCCUPIED', start: at('10-24T00:00'), end: null },
    ];
    assert.deepEqual(segmentsBefore(fallback, at('10-20T14:00')).map(s => [s.mainStatus, s.start.toISOString(), s.end.toISOString()]), [
      ['VACANT', iso('10-18T00:00'), iso('10-19T00:00')],
      ['CLEANING', iso('10-19T00:00'), iso('10-20T14:00')],
    ]);
    assert.deepEqual(segmentsBefore(fallback, null), []);
  });

  test('충돌 없는 예약도 미래 예측과 예약 기록의 숙박 순서가 일치한다', () => withNow('11-04T10:00', () => {
    const end = at('11-12T00:00');
    const expected = buildReservationHistorySegments(stays(), end, 3)
      .filter(segment => segment.end > at('11-04T10:00'))
      .map(segment => ({ ...segment, start: segment.start < at('11-04T10:00') ? at('11-04T10:00') : segment.start }));
    const future = getGanttSegments(buildLiveProperty(template, stays()), at('11-04T10:00'), end)
      .filter(segment => segment.isFuture);
    assert.deepEqual(rows(future), rows(expected));
  }));
});

describe('청소가 다음 체크인을 넘길 때 / 겹친 예약 — 상태 칩과 타임라인이 같은 말을 한다 (2차 코드 리뷰 반영)', () => {
  // 지난 퇴실 11/04 07:00, 예약된 청소 08:00~12:00 인데 다음 손님이 09:00 체크인
  const overrun = () => [
    { uid: 'prev', checkIn: at('11-02T15:00'), checkOut: at('11-04T07:00'), cleaningAt: at('11-04T08:00'), cleaningEnd: at('11-04T12:00'), cleaningStatus: 'ASSIGNED', cleanerName: '김청소' },
    { uid: 'next', checkIn: at('11-04T09:00'), checkOut: at('11-06T11:00') },
  ];

  test('손님이 들어온 뒤엔 체류 — 청소는 체크인에서 끊기고 숙박이 예측에서 빠지지 않는다', () => withNow('11-04T10:00', () => {
    assert.deepEqual(deriveCurrentState(overrun(), at('11-04T10:00'), 3), { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' });
    const timeline = deriveTimeline(overrun(), 3);
    assert.deepEqual([timeline.at(-1).mainStatus, timeline.at(-1).end], ['OCCUPIED', null]);
    const cleaning = timeline.filter(seg => seg.mainStatus === 'CLEANING');
    assert.equal(cleaning.at(-1).end.getTime(), at('11-04T09:00').getTime(), '청소는 체크인 09:00 에서 끝');
    const future = getWindowSegments(buildLiveProperty(template, overrun()), 24, 72).filter(seg => seg.isFuture);
    assert.deepEqual([future[0].mainStatus, future[0].end.toISOString()], ['OCCUPIED', iso('11-06T11:00')],
      '예측: 지금부터 체크아웃까지 체류 (예전엔 청소 → 공실로 손님이 사라졌다)');
  }));

  test('지금 청소 중이고 예약 청소가 체크인을 넘기면, 예측도 체크인에서 청소를 끊고 체류로 이어진다', () => withNow('11-04T08:30', () => {
    assert.equal(deriveCurrentState(overrun(), at('11-04T08:30'), 3).mainStatus, 'CLEANING');
    const future = getWindowSegments(buildLiveProperty(template, overrun()), 24, 72).filter(seg => seg.isFuture);
    assert.ok(!future.some(seg => seg.mainStatus === 'CLEANING' && seg.start < at('11-06T11:00') && seg.end > at('11-04T09:00')),
      '손님이 머무는 동안(09:00~퇴실) 청소 구간 없음');
    const occupied = future.find(seg => seg.mainStatus === 'OCCUPIED');
    assert.deepEqual([occupied.start.toISOString(), occupied.end.toISOString()], [iso('11-04T09:00'), iso('11-06T11:00')]);
  }));

  test('겹친 예약(A 가 B 보다 늦게 퇴실)에서도 상태 칩 = 타임라인 현재 구간', () => {
    const rowsAB = [
      { uid: 'A', checkIn: at('10-28T10:00'), checkOut: at('11-01T09:00') },
      { uid: 'B', checkIn: at('10-29T10:00'), checkOut: at('10-30T16:00') },
    ];
    for (const now of ['10-30T17:00', '11-01T09:30', '11-01T13:00']) withNow(now, () => {
      const current = deriveTimeline(rowsAB, 3).at(-1);
      assert.deepEqual(deriveCurrentState(rowsAB, at(now), 3), { mainStatus: current.mainStatus, subStatus: current.subStatus }, now);
      const property = buildLiveProperty(template, rowsAB);
      assert.deepEqual(property.currentState, { mainStatus: current.mainStatus, subStatus: current.subStatus }, `buildLiveProperty ${now}`);
    });
  });
});

describe('미래 청소가 다음 입실을 넘기는 경우 — 상세·리스트와 예약 기록의 경계 일치', () => {
  const reservations = () => [
    { uid: 'A', checkIn: at('11-09T15:00'), checkOut: at('11-10T11:00'), cleaningAt: at('11-10T12:00'), cleaningEnd: at('11-10T17:00'), cleaningStatus: 'ASSIGNED', cleanerName: '김청소' },
    { uid: 'B', checkIn: at('11-10T15:00'), checkOut: at('11-11T11:00'), cleaningAt: at('11-11T12:00'), cleaningEnd: at('11-11T17:00') },
    { uid: 'C', checkIn: at('11-11T15:00'), checkOut: at('11-12T11:00') },
  ];
  const futureViews = (property, end) => [
    getWindowSegments(property, 24, (end - Date.now()) / 3_600_000),
    getGanttSegments(property, new Date(Date.now() - 24 * 3_600_000), end),
  ].map(segments => segments.filter(segment => segment.isFuture));

  for (const [state, now] of [
    ['VACANT', '11-09T10:00'],
    ['PRE_STAY_READY', '11-09T14:10'],
    ['OCCUPIED', '11-10T10:00'],
    ['CLEANING', '11-10T12:30'],
  ]) {
    test(`${state}에서 미리 보아도 다음 두 숙박은 입실 시각에 시작한다`, () => withNow(now, () => {
      const list = reservations();
      const before = structuredClone(list);
      const property = buildLiveProperty(template, list);
      assert.equal(property.currentState.mainStatus, state);
      const end = at('11-12T18:00');
      const expected = buildReservationHistorySegments(list, end, 3)
        .filter(segment => segment.end > at(now))
        .map(segment => ({ ...segment, start: segment.start < at(now) ? at(now) : segment.start }));
      for (const future of futureViews(property, end)) {
        const occupied = future.filter(segment => segment.mainStatus === 'OCCUPIED');
        for (const [checkIn, checkOut] of [['11-10T15:00', '11-11T11:00'], ['11-11T15:00', '11-12T11:00']]) {
          assert.ok(occupied.some(segment => segment.start.getTime() === at(checkIn).getTime() && segment.end.getTime() === at(checkOut).getTime()), `${checkIn} 숙박이 누락되거나 늦게 시작됨`);
        }
        assertContiguous(future);
        // 예약 기록은 첫 준비 시작 전의 상태를 추정하지 않는다. 양쪽에 근거가 있는 기간을 비교한다.
        const commonStart = expected[0].start;
        const comparable = future.filter(segment => segment.end > commonStart)
          .map(segment => ({ ...segment, start: segment.start < commonStart ? commonStart : segment.start }));
        assert.deepEqual(rows(comparable), rows(expected), '미래 표시도 같은 예약의 과거 계산과 일치');
        const firstCleaning = future.find(segment => segment.cleaningCheckoutAt?.getTime() === at('11-10T11:00').getTime());
        assert.ok(firstCleaning, '앞선 청소의 퇴실 연결 키 유지');
      }
      assert.deepEqual(list, before, '저장된 예약·청소 시각은 바꾸지 않음');
    }));
  }

  for (const [label, cleaningAt, cleaningEnd, nextCheckIn] of [
    ['청소 시작도 입실 뒤인 경우', '11-10T16:00', '11-10T19:00', '11-10T15:00'],
    ['청소 종료와 입실이 같은 경우', '11-10T12:00', '11-10T15:00', '11-10T15:00'],
    ['퇴실 직후 다음 손님 입실', '11-10T12:00', '11-10T17:00', '11-10T11:00'],
    ['청소가 자정을 넘기는 경우', '11-10T23:00', '11-11T03:00', '11-11T01:00'],
  ]) {
    test(label, () => withNow('11-10T10:00', () => {
      const list = reservations().slice(0, 2);
      list[0] = { ...list[0], cleaningAt: at(cleaningAt), cleaningEnd: at(cleaningEnd) };
      list[1] = { ...list[1], checkIn: at(nextCheckIn) };
      const property = buildLiveProperty(template, list);
      for (const future of futureViews(property, at('11-11T10:00'))) {
        const occupied = future.find(segment => segment.mainStatus === 'OCCUPIED' && segment.start.getTime() === at(nextCheckIn).getTime());
        assert.ok(occupied, '다음 손님의 입실 시각부터 체류');
        assert.ok(!future.some(segment => segment.mainStatus === 'CLEANING' && segment.end > at(nextCheckIn)), '앞 청소가 입실 뒤까지 이어지지 않음');
        assert.ok(future.every(segment => segment.end > segment.start), '길이 0 또는 음수 구간 없음');
        assertContiguous(future);
      }
    }));
  }

  test('기본 청소시간도 다음 입실에서 끊고, 창 밖의 다음 입실은 화면에 그리지 않는다', () => withNow('11-10T10:00', () => {
    const list = reservations().slice(0, 2);
    delete list[0].cleaningAt;
    delete list[0].cleaningEnd;
    list[1] = { ...list[1], checkIn: at('11-10T12:00') };
    const property = buildLiveProperty(template, list);
    for (const future of futureViews(property, at('11-10T13:00'))) {
      assert.deepEqual(rows(future).slice(-2), [
        ['CLEANING', 'CLEANING_IN_PROGRESS', iso('11-10T11:00'), iso('11-10T12:00')],
        ['OCCUPIED', 'GOOD_CONDITION', iso('11-10T12:00'), iso('11-10T13:00')],
      ]);
    }
    for (const future of futureViews(property, at('11-10T11:30'))) {
      assert.equal(future.at(-1).end.getTime(), at('11-10T11:30').getTime());
      assert.equal(future.at(-1).mainStatus, 'CLEANING');
      assert.ok(future.every(segment => segment.end <= at('11-10T11:30')));
    }
  }));
});

describe('3차 코드 리뷰 반영 — 예측도 합친 숙박, since, 입실준비 경계', () => {
  test('지금 묵는 예약이 다른 행과 겹치면 예측도 늦은 퇴실까지 체류 (손님이 중간에 사라지지 않음)', () => withNow('11-04T10:00', () => {
    const rowsAB = [
      { uid: 'A', checkIn: at('11-02T10:00'), checkOut: at('11-04T15:00') },
      { uid: 'B', checkIn: at('11-03T10:00'), checkOut: at('11-06T12:00') },
    ];
    const future = getWindowSegments(buildLiveProperty(template, rowsAB), 24, 72).filter(seg => seg.isFuture);
    assert.deepEqual([future[0].mainStatus, future[0].end.toISOString()], ['OCCUPIED', iso('11-06T12:00')]);
  }));

  test('다음 예약이 겹친 두 행이어도 예측이 숙박 도중에 청소·공실을 넣지 않는다', () => withNow('11-04T10:00', () => {
    const rows3 = [
      { uid: 'prev', checkIn: at('11-01T15:00'), checkOut: at('11-03T11:00') },
      { uid: 'n1', checkIn: at('11-05T15:00'), checkOut: at('11-06T11:00') },
      { uid: 'n2', checkIn: at('11-05T15:00'), checkOut: at('11-08T11:00') },
    ];
    const future = getWindowSegments(buildLiveProperty(template, rows3), 24, 7 * 24).filter(seg => seg.isFuture);
    const during = future.filter(seg => seg.start < at('11-08T11:00') && seg.end > at('11-05T15:00'));
    assert.deepEqual(during.map(seg => seg.mainStatus), ['OCCUPIED']);
  }));

  test('그다음 예약(두 번째 이후)이 겹친 두 행이어도 예측이 숙박 도중에 청소·공실을 넣지 않는다', () => withNow('11-04T10:00', () => {
    const rows4 = [
      { uid: 'prev', checkIn: at('11-01T15:00'), checkOut: at('11-03T11:00') },
      { uid: 'next', checkIn: at('11-05T15:00'), checkOut: at('11-06T11:00') },
      { uid: 'm1', checkIn: at('11-07T15:00'), checkOut: at('11-08T11:00') },
      { uid: 'm2', checkIn: at('11-07T15:00'), checkOut: at('11-10T11:00') },
    ];
    const future = getWindowSegments(buildLiveProperty(template, rows4), 24, 7 * 24).filter(seg => seg.isFuture);
    const during = future.filter(seg => seg.start < at('11-10T11:00') && seg.end > at('11-07T15:00'));
    assert.deepEqual(during.map(seg => seg.mainStatus), ['OCCUPIED']);
  }));

  test('since: 그 이전에 끝난 숙박은 계산하지 않되, 화면에 걸치는 결과는 전체 계산과 같다', () => {
    const full = buildReservationHistorySegments(stays(), at('11-04T10:00'), 3);
    // since=11/01: 그 뒤에 끝나는 첫 숙박은 11/03~06, 바로 앞(10/25~27)은 문맥으로 남고 10/20~22 는 빠진다
    const bounded = buildReservationHistorySegments(stays(), at('11-04T10:00'), 3, { since: at('11-01T00:00') });
    const visible = list => list.filter(seg => seg.end > at('11-01T00:00')).map(seg => [seg.mainStatus, seg.subStatus, seg.start.toISOString(), seg.end.toISOString()]);
    assert.deepEqual(visible(bounded), visible(full));
    assert.equal(bounded[0].start.getTime(), at('10-25T14:00').getTime(), '앞선 숙박(10/20)은 계산에서 빠짐');
    // 모든 숙박이 since 이전에 끝났으면 마지막 한 건만 문맥으로 남긴다
    const allBefore = buildReservationHistorySegments(stays().slice(0, 2), at('11-04T10:00'), 3, { since: at('11-01T00:00') });
    assert.equal(allBefore.filter(seg => seg.mainStatus === 'OCCUPIED').length, 1);
    assert.equal(allBefore.at(-1).end.getTime(), at('11-04T10:00').getTime());
  });

  test('입실준비 예측도 체크인 30분 전에 최적화중 → 최적화완료로 바뀐다 (지난 구간과 같은 경계)', () => withNow('11-03T14:10', () => {
    const future = getWindowSegments(buildLiveProperty(template, stays()), 24, 24).filter(seg => seg.isFuture);
    assert.deepEqual(rows(future.slice(0, 2)), [
      ['PRE_STAY_READY', 'OPTIMIZING', iso('11-03T14:10'), iso('11-03T14:30')],
      ['PRE_STAY_READY', 'OPTIMIZED', iso('11-03T14:30'), iso('11-03T15:00')],
    ]);
  }));
});

// ── L1: 숙소 상세·리스트 타임라인 ──────────────────────────────────────────
describe('deriveTimeline — 가장 최근 숙박 이전의 과거도 남는다', () => {
  test('지금 체류 중이어도 지난 숙박 두 번이 타임라인 앞에 그대로 있다', () => withNow('11-04T10:00', () => {
    const timeline = deriveTimeline(stays(), 3);
    const occupied = timeline.filter(s => s.mainStatus === 'OCCUPIED').map(s => s.start.toISOString());
    assert.deepEqual(occupied, [iso('10-20T15:00'), iso('10-25T15:00'), iso('11-03T15:00')]);
    assertContiguous(timeline.slice(0, -1));
    assert.equal(timeline.at(-1).end, null, '마지막(현재) 구간은 end=null 계약을 유지');
    assert.equal(timeline.at(-1).mainStatus, 'OCCUPIED');
    assert.equal(timeline.at(-2).end.getTime(), timeline.at(-1).start.getTime(), '현재 구간 직전까지 빈틈 없음');
  }));

  test('지금 청소 중일 때도 이전 숙박들이 남는다', () => withNow('11-06T13:00', () => {
    const timeline = deriveTimeline(stays(), 3);
    assert.equal(timeline.filter(s => s.mainStatus === 'OCCUPIED').length, 3);
    assert.deepEqual([timeline.at(-1).mainStatus, timeline.at(-1).subStatus, timeline.at(-1).end],
      ['CLEANING', 'CLEANING_IN_PROGRESS', null]);
  }));

  test('현재 상태 판정은 그대로다 (과거를 붙여도 deriveCurrentState 와 마지막 구간이 일치)', () => {
    for (const now of ['11-04T10:00', '11-06T11:30', '11-06T13:00', '11-07T10:00', '11-08T14:20']) withNow(now, () => {
      const timeline = deriveTimeline(stays(), 3);
      const current = deriveCurrentState(stays(), at(now), 3);
      assert.deepEqual([timeline.at(-1).mainStatus, timeline.at(-1).subStatus], [current.mainStatus, current.subStatus], now);
    });
  });

  test('숙소 상세(지난 7일)와 리스트 간트에 지난 숙박이 보인다', () => withNow('11-04T10:00', () => {
    const property = buildLiveProperty(template, stays());
    const detail = getWindowSegments(property, 7 * 24, 7 * 24);
    // 10/28~11/03 은 공실 → 11/03 입실준비 → 체류. 예전엔 11/03 체크인 이전이 비어 있었다
    assert.equal(detail[0].start.getTime(), at('10-28T10:00').getTime(), '창 맨 앞부터 채워진다');
    assert.equal(detail[0].mainStatus, 'VACANT');
    const gantt = getGanttSegments(property, at('10-19T00:00'), at('11-12T00:00'));
    const pastOccupied = gantt.filter(s => s.mainStatus === 'OCCUPIED' && !s.isFuture).map(s => s.start.toISOString());
    assert.deepEqual(pastOccupied, [iso('10-20T15:00'), iso('10-25T15:00'), iso('11-03T15:00')]);
    assert.ok(!gantt.some(s => !s.isFuture && s.mainStatus === 'CLEANING' && s.end - s.start > 24 * 3_600_000),
      '하루 넘게 이어지는 지난 청소 구간 없음');
  }));
});

// ── L1: 지난 청소 담당자 표시 ──────────────────────────────────────────────
describe('숙소 상세 — 지난 청소에도 담당자가 보인다', () => {
  test('지난 청소는 담당자 이름, 기록 없는 청소는 표시 안 함, 진행 중 청소는 한 번만', () => withNow('11-06T13:00', () => {
    const list = stays().map(r => r.uid === 'b' ? { ...r, cleaningStatus: undefined, cleanerName: undefined } : r);
    const property = buildLiveProperty(template, list);
    const recentSegs = getWindowSegments(property, 20 * 24, 7 * 24);
    const map = indicatorMap(property, recentSegs);
    const shown = [...map.entries()].map(([seg, info]) => [seg.cleaningCheckoutAt?.toISOString(), seg.isFuture, info.cleanerName ?? null]);
    assert.deepEqual(shown.filter(([checkout]) => checkout === iso('10-22T11:00')), [[iso('10-22T11:00'), false, '김청소']]);
    assert.equal(shown.filter(([checkout]) => checkout === iso('10-27T11:00')).length, 0, '청소 기록 없는 지난 예약은 "미배정"으로 단정하지 않음');
    assert.deepEqual(shown.filter(([checkout]) => checkout === iso('11-06T11:00')), [[iso('11-06T11:00'), true, '박청소']],
      '지금 진행 중인 청소(지난/미래 두 조각)는 미래 조각에 한 번만');
  }));

  test('지난 청소가 완료(COMPLETED)로 바뀌어 있어도 배정으로 표시 (소스 계약)', () => {
    const source = readSource('src/components/v2/PropertyDetailView.jsx');
    assert.match(source, /const isAssigned = ASSIGNED_STATUSES\.has\(res\.cleaningStatus\)/);
    assert.deepEqual([...ASSIGNED_STATUSES].sort(), ['ASSIGNED', 'COMPLETED']);
  });

  test('지난 청소가 아직 배정 안 된 상태로 남아 있으면(ESCALATED 등) "미배정"을 붙이지 않는다', () => withNow('11-06T13:00', () => {
    const list = stays().map(r => r.uid === 'a' ? { ...r, cleaningStatus: 'ESCALATED', cleanerName: undefined } : r);
    const property = buildLiveProperty(template, list);
    const map = indicatorMap(property, getWindowSegments(property, 20 * 24, 7 * 24));
    assert.ok(![...map.keys()].some(seg => seg.cleaningCheckoutAt?.getTime() === at('10-22T11:00').getTime()));
  }));

  test('청소 표시는 그 청소 막대 안·창 안에 머문다 (소스 계약)', () => {
    const source = readSource('src/components/v2/PropertyDetailView.jsx');
    assert.match(source, /const anchorTime = new Date\(Math\.min\(\s*Math\.max\([\s\S]{0,160}seg\.start\.getTime\(\),\s*windowStart\.getTime\(\),\s*\),\s*segEnd\.getTime\(\),\s*\)\);/);
  });
});

// ── L2: 캘린더가 지난 막대를 예약 기록으로 그린다 ───────────────────────────
describe('MonthlyCalendar — 지난 막대의 뼈대는 감지기가 아니라 예약 기록', () => {
  const source = readSource('src/components/v2/reporting/MonthlyCalendar.jsx');
  test('예약 기록 막대를 우선하고, 기록이 없는 숙소만 감지기 기록으로', () => {
    assert.match(source, /import \{ buildReservationHistorySegments, segmentsBefore \} from '..\/..\/..\/domain\/reservationHistoryDomain\.js'/);
    assert.match(source, /const history = buildReservationHistorySegments\(\s*singleProperty\.reservations,\s*pastUntil,\s*singleProperty\.cleaningDurationHours \?\? 2\.5,\s*\{ since: from \},/);
    assert.match(source, /const fallback = data\?\.stateSegments\?\.length \? data\.stateSegments : getGanttSegments\(singleProperty, from, to\);/);
    assert.match(source, /const past = history\.length\s*\?\s*\[\.\.\.segmentsBefore\(fallback, history\[0\]\.start\), \.\.\.history\]\s*:\s*fallback;/);
  });
  test('"지금" 경계는 칸의 지금 표시와 같은 1분 시계로 다시 잡는다 (탭을 연 순간에 고정되지 않음)', () => {
    assert.match(source, /periodToRemainingRange\(statsPeriod, now\.getTime\(\)\)/);
    assert.match(source, /\[needsFutureData, statsPeriod, now\],/);
  });
  test('지난 막대는 미래 막대가 시작하는 시각에서 끝난다 (Date.now() 를 다시 읽지 않음)', () => {
    assert.match(source, /const pastUntil = futureRange\?\.from\s*\?\s*new Date\(futureRange\.from\)\s*:\s*new Date\(Math\.min\(to\.getTime\(\), Date\.now\(\)\)\);/);
  });
});
