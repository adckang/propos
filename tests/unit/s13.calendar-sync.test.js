import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveCurrentState,
  deriveTimeline,
} from "../../src/application/calendarSyncService.js";

function makeReservation(checkInIso, checkOutIso) {
  return {
    checkIn: new Date(checkInIso),
    checkOut: new Date(checkOutIso),
  };
}

describe("calendarSyncService current state", () => {
  test("미래 예약이 아직 준비 시간 전이면 공실이다", () => {
    const reservations = [
      makeReservation("2026-07-12T15:00:00+09:00", "2026-07-13T11:00:00+09:00"),
    ];
    const now = new Date("2026-07-12T10:30:00+09:00");

    assert.deepEqual(
      deriveCurrentState(reservations, now, 2.5),
      { mainStatus: "VACANT", subStatus: "CLEANING_FINISHED" },
    );
  });

  test("체크인 1시간 전 이전이면 공실이다 (스펙: 1시간 전 PRE_STAY_READY 시작)", () => {
    const reservations = [
      makeReservation("2026-07-12T15:00:00+09:00", "2026-07-13T11:00:00+09:00"),
    ];
    // 13:30은 체크인(15:00) 1.5시간 전 → 아직 공실
    const now = new Date("2026-07-12T13:30:00+09:00");

    assert.deepEqual(
      deriveCurrentState(reservations, now, 2.5),
      { mainStatus: "VACANT", subStatus: "CLEANING_FINISHED" },
    );
  });

  test("체크인 1시간 전부터 30분 전까지는 OPTIMIZING이다", () => {
    const reservations = [
      makeReservation("2026-07-12T15:00:00+09:00", "2026-07-13T11:00:00+09:00"),
    ];
    // 14:15 = 체크인 45분 전, 준비 윈도우(14:00~) 내 + OPTIMIZED 전환(14:30) 전
    const now = new Date("2026-07-12T14:15:00+09:00");

    assert.deepEqual(
      deriveCurrentState(reservations, now, 2.5),
      { mainStatus: "PRE_STAY_READY", subStatus: "OPTIMIZING" },
    );
  });

  test("체크인 30분 전부터는 OPTIMIZED이다", () => {
    const reservations = [
      makeReservation("2026-07-12T15:00:00+09:00", "2026-07-13T11:00:00+09:00"),
    ];
    const now = new Date("2026-07-12T14:40:00+09:00");

    assert.deepEqual(
      deriveCurrentState(reservations, now, 2.5),
      { mainStatus: "PRE_STAY_READY", subStatus: "OPTIMIZED" },
    );
  });

  test("청소가 아직 안 끝났으면 입실전보다 청소중이 우선이다", () => {
    const reservations = [
      makeReservation("2026-07-10T15:00:00+09:00", "2026-07-11T11:00:00+09:00"),
      makeReservation("2026-07-11T12:00:00+09:00", "2026-07-12T11:00:00+09:00"),
    ];
    const now = new Date("2026-07-11T11:30:00+09:00");

    assert.deepEqual(
      deriveCurrentState(reservations, now, 2.5),
      { mainStatus: "CLEANING", subStatus: "CLEANING_IN_PROGRESS" },
    );
  });
});

describe("calendarSyncService timeline", () => {
  test("입실전 상태면 타임라인 마지막 세그먼트가 PRE_STAY_READY 열린 구간이다", () => {
    const reservations = [
      makeReservation("2026-07-10T15:00:00+09:00", "2026-07-11T11:00:00+09:00"),
      makeReservation("2026-07-12T15:00:00+09:00", "2026-07-13T11:00:00+09:00"),
    ];

    const RealDate = Date;
    // 스펙: 체크인(15:00) 1시간 전(14:00)부터 PRE_STAY_READY. 14:15는 윈도우 안
    const now = new Date("2026-07-12T14:15:00+09:00");
    global.Date = class extends RealDate {
      constructor(...args) {
        return args.length ? new RealDate(...args) : new RealDate(now);
      }
      static now() {
        return now.getTime();
      }
      static parse(value) {
        return RealDate.parse(value);
      }
      static UTC(...args) {
        return RealDate.UTC(...args);
      }
    };

    try {
      const timeline = deriveTimeline(reservations, 2.5);
      const current = timeline[timeline.length - 1];
      assert.equal(current.mainStatus, "PRE_STAY_READY");
      assert.equal(current.subStatus, "OPTIMIZING");
      assert.equal(current.end, null);
    } finally {
      global.Date = RealDate;
    }
  });
});
