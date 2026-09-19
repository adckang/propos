/**
 * s44 — 다음주 레포트 도메인 함수 (futureWeekDomain.js)
 *
 * 테스트 대상:
 *   countWeekCheckIns(properties, weekStart, weekEnd)   → number
 *   countWeekCheckOuts(properties, weekStart, weekEnd)  → number
 *   getOccupancyForecast(properties, weekStart, weekEnd)
 *     → { occupiedRooms, vacantRooms, occupiedNights, vacantNights, totalNights, occupancyRate, vacancyRate }
 *   classifyCleaningAssignments(weekCheckouts, calendarEvents, dbJobs)
 *     → { assigned, needsRequest, requesting, failed }
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countWeekCheckIns,
  countWeekCheckOuts,
  getOccupancyForecast,
  classifyCleaningAssignments,
  futureSummaryFor,
} from '../../src/domain/futureWeekDomain.js';
import { periodToRemainingRange } from '../../src/domain/periodDomain.js';

// ── 테스트 픽스처 ──────────────────────────────────────────────────────────────
const DAY  = 86_400_000;
const HOUR = 3_600_000;

// 기준 주: 2026-09-21(월) 00:00 KST ~ 2026-09-28(월) 00:00 KST (= UTC 전날 15:00, periodDomain 경계와 동일)
const WS = new Date('2026-09-20T15:00:00.000Z'); // weekStart (포함)
const WE = new Date('2026-09-27T15:00:00.000Z'); // weekEnd   (미포함)

/** weekStart 기준 offset일 + hour(KST)의 Date */
const dt = (offsetDays, hourKst = 0) =>
  new Date(WS.getTime() + offsetDays * DAY + hourKst * HOUR);

/** 최소 숙소 객체 */
const prop = (id, reservations = []) => ({ id, reservations });

/** 예약 객체: offsetDays 기준, 기본 체크인 15시 / 체크아웃 11시 */
const res = (ciOffset, coOffset, ciHour = 15, coHour = 11) => ({
  checkIn:  dt(ciOffset, ciHour),
  checkOut: dt(coOffset, coHour),
});

/** 주간 체크아웃 항목 */
const co = (propertyId, offsetDays, coHour = 11) =>
  ({ propertyId, checkoutDate: dt(offsetDays, coHour) });

/** 캘린더 청소 일정 (날짜만 의미있음) */
const cal = (offsetDays) => ({ date: dt(offsetDays, 10) }); // 10시 청소 가정

/** DB cleaning_jobs 레코드 */
const dbJob = (propertyId, offsetDays, status) =>
  ({ propertyId, checkoutDate: dt(offsetDays, 11), status });

// 요청중 상태 전체 목록
const REQUESTING_STATUSES = [
  'PENDING', 'NOTIFYING_VIP_1', 'NOTIFYING_VIP_2', 'NOTIFYING_VIP_3',
  'NOTIFYING_BULK', 'BULK_REMINDED',
];

// ── A: countWeekCheckIns ───────────────────────────────────────────────────────
describe('A: countWeekCheckIns', () => {
  it('A1 properties 빈 배열 → 0', () => {
    assert.equal(countWeekCheckIns([], WS, WE), 0);
  });

  it('A2 예약 없는 숙소 → 0', () => {
    assert.equal(countWeekCheckIns([prop('P1')], WS, WE), 0);
  });

  it('A3 체크인이 주중(수요일) → 1', () => {
    assert.equal(countWeekCheckIns([prop('P1', [res(2, 4)])], WS, WE), 1);
  });

  it('A4 체크인이 weekStart 정각 → 포함(경계 포함)', () => {
    const r = { checkIn: new Date(WS), checkOut: dt(2, 11) };
    assert.equal(countWeekCheckIns([prop('P1', [r])], WS, WE), 1);
  });

  it('A5 체크인이 weekEnd 정각 → 제외(경계 미포함)', () => {
    const r = { checkIn: new Date(WE), checkOut: dt(9, 11) };
    assert.equal(countWeekCheckIns([prop('P1', [r])], WS, WE), 0);
  });

  it('A6 체크인이 weekStart 1ms 전 → 제외', () => {
    const r = { checkIn: new Date(WS.getTime() - 1), checkOut: dt(2, 11) };
    assert.equal(countWeekCheckIns([prop('P1', [r])], WS, WE), 0);
  });

  it('A7 체크인이 weekEnd 이후(+8일) → 제외', () => {
    assert.equal(countWeekCheckIns([prop('P1', [res(8, 10)])], WS, WE), 0);
  });

  it('A8 체크아웃은 주중이나 체크인은 이전 주 → 0 (checkIn 기준)', () => {
    assert.equal(countWeekCheckIns([prop('P1', [res(-3, 2)])], WS, WE), 0);
  });

  it('A9 여러 숙소 여러 체크인 → 합산', () => {
    const p1 = prop('P1', [res(1, 3), res(5, 7)]);
    const p2 = prop('P2', [res(3, 5)]);
    assert.equal(countWeekCheckIns([p1, p2], WS, WE), 3);
  });

  it('A10 한 숙소에 주중 체크인 2건 + 이전 주 체크인 1건 → 2', () => {
    const p = prop('P1', [res(-3, -1), res(2, 4), res(5, 8)]);
    assert.equal(countWeekCheckIns([p], WS, WE), 2);
  });

  it('A11 reservations가 undefined인 숙소 → 0 (크래시 없음)', () => {
    assert.equal(countWeekCheckIns([{ id: 'P1' }], WS, WE), 0);
  });
});

// ── B: countWeekCheckOuts ─────────────────────────────────────────────────────
describe('B: countWeekCheckOuts', () => {
  it('B1 properties 빈 배열 → 0', () => {
    assert.equal(countWeekCheckOuts([], WS, WE), 0);
  });

  it('B2 체크아웃이 이전 주 → 0', () => {
    assert.equal(countWeekCheckOuts([prop('P1', [res(-3, -1)])], WS, WE), 0);
  });

  it('B3 체크아웃이 weekStart 정각 → 포함', () => {
    const r = { checkIn: dt(-3, 15), checkOut: new Date(WS) };
    assert.equal(countWeekCheckOuts([prop('P1', [r])], WS, WE), 1);
  });

  it('B4 체크아웃이 weekEnd 정각 → 제외', () => {
    const r = { checkIn: dt(5, 15), checkOut: new Date(WE) };
    assert.equal(countWeekCheckOuts([prop('P1', [r])], WS, WE), 0);
  });

  it('B5 체크아웃이 weekStart 1ms 전 → 제외', () => {
    const r = { checkIn: dt(-3, 15), checkOut: new Date(WS.getTime() - 1) };
    assert.equal(countWeekCheckOuts([prop('P1', [r])], WS, WE), 0);
  });

  it('B6 체크아웃이 weekEnd 이후 → 제외', () => {
    assert.equal(countWeekCheckOuts([prop('P1', [res(5, 9)])], WS, WE), 0);
  });

  it('B7 여러 숙소 여러 체크아웃 → 합산', () => {
    const p1 = prop('P1', [res(-3, 1), res(2, 5)]);
    const p2 = prop('P2', [res(1, 4)]);
    assert.equal(countWeekCheckOuts([p1, p2], WS, WE), 3);
  });
});

// ── C: getOccupancyForecast ───────────────────────────────────────────────────
describe('C: getOccupancyForecast', () => {
  it('C1 빈 배열 → 모두 0', () => {
    assert.deepEqual(getOccupancyForecast([], WS, WE), {
      occupiedRooms: 0, vacantRooms: 0,
      occupiedNights: 0, vacantNights: 0,
      totalNights: 0, occupancyRate: 0, vacancyRate: 0,
    });
  });

  it('C2 예약 없는 숙소 1개 → vacantRooms:1, vacantNights:7', () => {
    const r = getOccupancyForecast([prop('P1')], WS, WE);
    assert.equal(r.vacantRooms, 1);
    assert.equal(r.occupiedRooms, 0);
    assert.equal(r.vacantNights, 7);
    assert.equal(r.occupiedNights, 0);
    assert.equal(r.totalNights, 7);
  });

  it('C3 주 전체 체류(전주 입실~다음주 퇴실) → occupiedNights:7', () => {
    const r = getOccupancyForecast([prop('P1', [res(-2, 9)])], WS, WE);
    assert.equal(r.occupiedRooms, 1);
    assert.equal(r.vacantRooms, 0);
    assert.equal(r.occupiedNights, 7);
    assert.equal(r.vacantNights, 0);
  });

  it('C4 월~수 체류(2박) → occupiedNights:2, vacantNights:5', () => {
    // checkIn Mon(0일차 15시), checkOut Wed(2일차 11시) → 2박
    const r = getOccupancyForecast([prop('P1', [res(0, 2)])], WS, WE);
    assert.equal(r.occupiedNights, 2);
    assert.equal(r.vacantNights, 5);
    assert.equal(r.totalNights, 7);
  });

  it('C5 이전 주 입실, 주 중간(수) 퇴실 → occupiedNights:2', () => {
    const r = getOccupancyForecast([prop('P1', [res(-3, 2)])], WS, WE);
    assert.equal(r.occupiedNights, 2); // Mon ~ Wed = 2박 겹침
    assert.equal(r.vacantNights, 5);
  });

  it('C6 주 중간(수) 입실, 다음 주 이후 퇴실 → occupiedNights:5', () => {
    // Wed(2) ~ Mon(7) = 5박 겹침
    const r = getOccupancyForecast([prop('P1', [res(2, 10)])], WS, WE);
    assert.equal(r.occupiedNights, 5);
    assert.equal(r.vacantNights, 2);
  });

  it('C7 이전 주에 퇴실 완료 → overlap 0, vacantRooms:1', () => {
    const r = getOccupancyForecast([prop('P1', [res(-5, -1)])], WS, WE);
    assert.equal(r.occupiedNights, 0);
    assert.equal(r.vacantNights, 7);
    assert.equal(r.vacantRooms, 1);
  });

  it('C8 다음 주 이후 입실 예정 → overlap 0', () => {
    const r = getOccupancyForecast([prop('P1', [res(8, 10)])], WS, WE);
    assert.equal(r.occupiedNights, 0);
    assert.equal(r.vacantRooms, 1);
  });

  it('C9 체크인이 weekEnd 당일 → overlap 0 (주에 포함 안됨)', () => {
    const r = getOccupancyForecast(
      [prop('P1', [{ checkIn: new Date(WE), checkOut: dt(9, 11) }])],
      WS, WE
    );
    assert.equal(r.occupiedNights, 0);
    assert.equal(r.vacantRooms, 1);
  });

  it('C10 숙소 2개 — 1개 전주 체류, 1개 공실 → 합산', () => {
    const r = getOccupancyForecast([
      prop('P1', [res(-1, 8)]), // 전체 주 체류
      prop('P2', []),            // 공실
    ], WS, WE);
    assert.equal(r.occupiedRooms, 1);
    assert.equal(r.vacantRooms, 1);
    assert.equal(r.occupiedNights, 7);
    assert.equal(r.vacantNights, 7);
    assert.equal(r.totalNights, 14);
  });

  it('C11 한 숙소에 예약 2건(월~수, 금~일) → 박수 합산, 숙소는 1개', () => {
    // Mon~Wed = 2박, Fri(4)~Sun(6) = 2박 → 4박
    const r = getOccupancyForecast([prop('P1', [res(0, 2), res(4, 6)])], WS, WE);
    assert.equal(r.occupiedNights, 4);
    assert.equal(r.vacantNights, 3);
    assert.equal(r.occupiedRooms, 1); // 방은 1개
  });

  it('C12 occupancyRate = occupiedNights / totalNights', () => {
    // P1: 7박, P2: 3박(목~일) → 10/14
    const r = getOccupancyForecast([
      prop('P1', [res(-1, 8)]),  // 7박
      prop('P2', [res(4, 7)]),   // 목(4)~일(7) = 3박
    ], WS, WE);
    assert.equal(r.occupiedNights, 10);
    assert.equal(r.totalNights, 14);
    assert.ok(Math.abs(r.occupancyRate - 10 / 14) < 0.001);
    assert.ok(Math.abs(r.vacancyRate - 4 / 14) < 0.001);
  });

  it('C13 totalNights = properties.length × 7', () => {
    const r = getOccupancyForecast(
      [prop('P1'), prop('P2'), prop('P3')],
      WS, WE
    );
    assert.equal(r.totalNights, 21);
  });
});

// ── D: classifyCleaningAssignments ────────────────────────────────────────────
describe('D: classifyCleaningAssignments', () => {
  it('D1 체크아웃 없음 → 모두 0', () => {
    assert.deepEqual(classifyCleaningAssignments([], [], []), {
      assigned: 0, needsRequest: 0, requesting: 0, failed: 0,
    });
  });

  it('D2 캘린더 청소 일정 있음 → assigned', () => {
    const r = classifyCleaningAssignments([co('P1', 2)], [cal(2)], []);
    assert.equal(r.assigned, 1);
    assert.equal(r.needsRequest, 0);
  });

  it('D3 캘린더 없음, DB 없음 → needsRequest', () => {
    const r = classifyCleaningAssignments([co('P1', 2)], [], []);
    assert.deepEqual(r, { assigned: 0, needsRequest: 1, requesting: 0, failed: 0 });
  });

  it('D4 DB ESCALATED → failed', () => {
    const r = classifyCleaningAssignments([co('P1', 2)], [], [dbJob('P1', 2, 'ESCALATED')]);
    assert.equal(r.failed, 1);
    assert.equal(r.requesting, 0);
    assert.equal(r.assigned, 0);
  });

  it('D5 DB ASSIGNED → assigned (자동 배정 완료)', () => {
    const r = classifyCleaningAssignments([co('P1', 2)], [], [dbJob('P1', 2, 'ASSIGNED')]);
    assert.equal(r.assigned, 1);
  });

  it('D6 DB COMPLETED → assigned', () => {
    const r = classifyCleaningAssignments([co('P1', 2)], [], [dbJob('P1', 2, 'COMPLETED')]);
    assert.equal(r.assigned, 1);
  });

  // PENDING ~ BULK_REMINDED 전부 → requesting
  for (const status of REQUESTING_STATUSES) {
    it(`D7_${status} → requesting`, () => {
      const r = classifyCleaningAssignments(
        [co('P1', 2)], [], [dbJob('P1', 2, status)]
      );
      assert.equal(r.requesting, 1, `${status}는 requesting이어야 함`);
      assert.equal(r.failed, 0);
      assert.equal(r.assigned, 0);
      assert.equal(r.needsRequest, 0);
    });
  }

  it('D8 캘린더 있음 + DB ESCALATED → 캘린더 우선 → assigned (failed 아님)', () => {
    const r = classifyCleaningAssignments(
      [co('P1', 2)], [cal(2)], [dbJob('P1', 2, 'ESCALATED')]
    );
    assert.equal(r.assigned, 1);
    assert.equal(r.failed, 0);
  });

  it('D9 DB CANCELLED → needsRequest (청소 취소됨, 다시 배정 필요)', () => {
    const r = classifyCleaningAssignments([co('P1', 2)], [], [dbJob('P1', 2, 'CANCELLED')]);
    assert.equal(r.needsRequest, 1);
  });

  it('D10 캘린더 날짜 불일치 → 매칭 안됨 → needsRequest', () => {
    const r = classifyCleaningAssignments([co('P1', 2)], [cal(3)], []); // 3일, 체크아웃은 2일
    assert.equal(r.needsRequest, 1);
    assert.equal(r.assigned, 0);
  });

  it('D11 DB propertyId 불일치 → 매칭 안됨 → needsRequest', () => {
    const r = classifyCleaningAssignments(
      [co('P1', 2)], [], [dbJob('P99', 2, 'ASSIGNED')] // 다른 숙소 ID
    );
    assert.equal(r.needsRequest, 1);
    assert.equal(r.assigned, 0);
  });

  it('D12 같은 날 체크아웃 2개, 캘린더 1개 → 1 assigned, 1 needsRequest (1:1 소모)', () => {
    const r = classifyCleaningAssignments(
      [co('P1', 2), co('P2', 2)],
      [cal(2)], // 캘린더 이벤트 1개
      []
    );
    assert.equal(r.assigned, 1);
    assert.equal(r.needsRequest, 1);
  });

  it('D13 같은 날 체크아웃 2개, 캘린더 2개 → 2 assigned', () => {
    const r = classifyCleaningAssignments(
      [co('P1', 2), co('P2', 2)],
      [cal(2), cal(2)],
      []
    );
    assert.equal(r.assigned, 2);
    assert.equal(r.needsRequest, 0);
  });

  it('D14 4가지 상태 혼합 → 각각 분류, 합산 = 체크아웃 수', () => {
    const r = classifyCleaningAssignments(
      [co('P1', 1), co('P2', 2), co('P3', 3), co('P4', 4)],
      [cal(1)],                              // P1 → assigned
      [                                      // P2 → nothing → needsRequest
        dbJob('P3', 3, 'PENDING'),           // P3 → requesting
        dbJob('P4', 4, 'ESCALATED'),         // P4 → failed
      ]
    );
    assert.equal(r.assigned, 1);
    assert.equal(r.needsRequest, 1);
    assert.equal(r.requesting, 1);
    assert.equal(r.failed, 1);
    assert.equal(r.assigned + r.needsRequest + r.requesting + r.failed, 4);
  });
});


// ── E: KST 일 경계 (박수는 한국 달력 날짜 기준) ─────────────────────────────────
describe('E: getOccupancyForecast — KST 일 경계', () => {
  it('수요일 08:00 KST 체크인(UTC로는 화요일 23:00) → 수·목 2박 (UTC 일 기준이면 3박으로 과다)', () => {
    const p = prop('P1', [res(2, 4, 8, 11)]); // 수 08:00 KST ~ 금 11:00 KST
    assert.equal(getOccupancyForecast([p], WS, WE).occupiedNights, 2);
  });

  it('금요일 08:00 KST 체크아웃(UTC로는 목요일 23:00) → 체크아웃 당일 밤은 세지 않음', () => {
    const p = prop('P1', [res(0, 4, 15, 8)]); // 월 15:00 KST ~ 금 08:00 KST → 월화수목 4박
    assert.equal(getOccupancyForecast([p], WS, WE).occupiedNights, 4);
  });

  it('체크인 15:00 KST / 체크아웃 11:00 KST 표준 패턴은 박수 = 날짜 차이', () => {
    const p = prop('P1', [res(1, 3)]); // 화 15:00 ~ 목 11:00 → 2박
    assert.equal(getOccupancyForecast([p], WS, WE).occupiedNights, 2);
  });

  it('주 경계: 일요일 체크인 → 다음 주 월요일 체크아웃은 일요일 1박만 이번 주', () => {
    const p = prop('P1', [res(6, 7)]); // 일 15:00 ~ 다음 월 11:00
    assert.equal(getOccupancyForecast([p], WS, WE).occupiedNights, 1);
  });
});

// ── F: 이번 주 [예정] = 지금 ~ 주 끝 (진행 중 기간의 남은 구간) ────────────────────
describe('F: 이번 주 [예정] — 지금 ~ 일요일', () => {
  const NOW = dt(2, 12).getTime(); // 수 12:00 KST
  const range = periodToRemainingRange('this_week', NOW);
  const P = [prop('P1', [
    res(0, 3),   // 월 15:00 ~ 목 11:00  (현재 체류 중)
    res(4, 6),   // 금 15:00 ~ 일 11:00
  ]), prop('P2', [
    res(0, 1),   // 월 15:00 ~ 화 11:00  (이미 끝남)
  ])];

  it('구간이 기준 주와 일치: 지금 ~ 다음 주 월요일 00:00 KST', () => {
    assert.equal(range.from.getTime(), NOW);
    assert.equal(range.to.getTime(), WE.getTime());
  });

  it('체크인 예정: 이미 지난 월요일 체크인은 제외, 금요일만', () => {
    assert.equal(countWeekCheckIns(P, range.from, range.to), 1);
  });

  it('체크아웃 예정: 지난 화요일 체크아웃은 제외, 목·일만', () => {
    assert.equal(countWeekCheckOuts(P, range.from, range.to), 2);
  });

  it('점유 예측: 남은 5박(수~일) 중 P1 3박(수·금·토), P2 0박', () => {
    const f = getOccupancyForecast(P, range.from, range.to);
    assert.equal(f.totalNights, 2 * 5);
    assert.equal(f.occupiedNights, 3);
    assert.equal(f.occupiedRooms, 1);
    assert.equal(f.vacantRooms, 1);
  });

  it('주 전체로 세면 [완료]와 겹치는 값이 나옴 — 남은 구간과 값이 달라야 한다 (이중 집계 방지 근거)', () => {
    assert.ok(countWeekCheckIns(P, WS, WE) > countWeekCheckIns(P, range.from, range.to));
  });

  it('내일·다음 주 등 미래 기간은 기간 전체를 그대로 센다', () => {
    const next = periodToRemainingRange('next_week', NOW);
    assert.equal(next.from.getTime(), WE.getTime());
  });
});

// ── G: 미래 기간 요약 문장 (예약 기준, 서버 이벤트 기반 문장 대체) ───────────────────
describe('G: futureSummaryFor', () => {
  // WED = 2026-09-23 12:00 KST 기준 다음 주 = WS+7일 ~ WE+7일
  const NOW = dt(2, 12).getTime();
  const nextWeekDt = (offsetDays, hourKst) => dt(7 + offsetDays, hourKst);
  const nres = (ci, co) => ({ checkIn: nextWeekDt(ci, 15), checkOut: nextWeekDt(co, 11) });

  it('다음 주: 예약 기준 체크인·체크아웃 건수 문장', () => {
    const P = [prop('P1', [nres(0, 2), nres(3, 5)]), prop('P2', [nres(1, 4)])];
    assert.equal(futureSummaryFor('next_week', P, NOW), '다음 주 체크인 3건, 체크아웃 3건 예정이에요.');
  });

  it('예약이 없으면 "예정된 체크인·체크아웃이 없어요"', () => {
    assert.equal(futureSummaryFor('next_week', [prop('P1', [])], NOW), '다음 주 예정된 체크인·체크아웃이 없어요.');
    assert.equal(futureSummaryFor('next_week', [], NOW), '다음 주 예정된 체크인·체크아웃이 없어요.');
  });

  it('내일 라벨', () => {
    const tomorrowCi = new Date(dt(3, 15));           // 목 15:00 KST (기준 수요일의 내일)
    const P = [prop('P1', [{ checkIn: tomorrowCi, checkOut: dt(5, 11) }])];
    assert.equal(futureSummaryFor('tomorrow', P, NOW), '내일 체크인 1건, 체크아웃 0건 예정이에요.');
  });

  it('선택 숙소 범위: 넘겨준 숙소만 센다', () => {
    const A = prop('A', [nres(0, 2)]), B = prop('B', [nres(1, 3)]);
    assert.equal(futureSummaryFor('next_week', [A], NOW), '다음 주 체크인 1건, 체크아웃 1건 예정이에요.');
    assert.equal(futureSummaryFor('next_week', [A, B], NOW), '다음 주 체크인 2건, 체크아웃 2건 예정이에요.');
  });

  it('미래 기간이 아니면 빈 문자열 (호출자가 서버 요약 사용)', () => {
    for (const p of ['now', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'bogus']) {
      assert.equal(futureSummaryFor(p, [prop('P1', [nres(0, 2)])], NOW), '', p);
    }
  });

  it('content-guide: 한 문장에 숫자 최대 2개', () => {
    const P = [prop('P1', [nres(0, 2), nres(3, 5)])];
    const digits = futureSummaryFor('next_week', P, NOW).match(/\d+/g) ?? [];
    assert.ok(digits.length <= 2, digits.join(','));
  });
});
