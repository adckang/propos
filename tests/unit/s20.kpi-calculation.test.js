import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  countCurrentStats,
  countPeriodEvents,
} from "../../src/domain/reportingDomain.js";

// room-state-machine.md 기준 subStatus 목록:
// OCCUPIED: GOOD_CONDITION / ENERGY_WASTE / ISSUE_COMPLAINT / ISSUE_AND_ENERGY
// PRE_STAY_READY: OPTIMIZING / OPTIMIZED
// VACANT: CLEANING_FINISHED / MAINTENANCE
// CLEANING: CLEANING_PENDING / CLEANING_IN_PROGRESS

describe("countCurrentStats — 실시간 KPI 집계", () => {
  test("OCCUPIED/* 전체 → occupied 카운트, PRE_STAY_READY/VACANT/CLEANING 0", () => {
    const props = [
      { mainStatus: "OCCUPIED", subStatus: "GOOD_CONDITION" },
      { mainStatus: "OCCUPIED", subStatus: "ENERGY_WASTE" },
      { mainStatus: "OCCUPIED", subStatus: "ISSUE_COMPLAINT" },
      { mainStatus: "OCCUPIED", subStatus: "ISSUE_AND_ENERGY" },
    ];
    const stats = countCurrentStats(props);
    assert.equal(stats.occupied, 4);
    assert.equal(stats.preStayReady, 0);
    assert.equal(stats.vacant, 0);
    assert.equal(stats.cleaning, 0);
  });

  test("ISSUE_COMPLAINT + ISSUE_AND_ENERGY → anomalyCount (민원 관련만)", () => {
    const props = [
      { mainStatus: "OCCUPIED", subStatus: "GOOD_CONDITION" },
      { mainStatus: "OCCUPIED", subStatus: "ENERGY_WASTE" },
      { mainStatus: "OCCUPIED", subStatus: "ISSUE_COMPLAINT" },
      { mainStatus: "OCCUPIED", subStatus: "ISSUE_AND_ENERGY" },
    ];
    const stats = countCurrentStats(props);
    assert.equal(stats.anomalyCount, 2); // ISSUE_COMPLAINT + ISSUE_AND_ENERGY만
  });

  test("ENERGY_WASTE만 있는 숙소는 anomalyCount에 포함 안 됨", () => {
    const props = [{ mainStatus: "OCCUPIED", subStatus: "ENERGY_WASTE" }];
    const stats = countCurrentStats(props);
    assert.equal(stats.anomalyCount, 0);
    assert.equal(stats.occupied, 1);
  });

  test("PRE_STAY_READY/* → preStayReady 카운트", () => {
    const props = [
      { mainStatus: "PRE_STAY_READY", subStatus: "OPTIMIZING" },
      { mainStatus: "PRE_STAY_READY", subStatus: "OPTIMIZED" },
    ];
    const stats = countCurrentStats(props);
    assert.equal(stats.preStayReady, 2);
    assert.equal(stats.occupied, 0);
  });

  test("VACANT/* → vacant 카운트", () => {
    const props = [
      { mainStatus: "VACANT", subStatus: "CLEANING_FINISHED" },
      { mainStatus: "VACANT", subStatus: "MAINTENANCE" },
    ];
    const stats = countCurrentStats(props);
    assert.equal(stats.vacant, 2);
  });

  test("CLEANING/* → cleaning 카운트", () => {
    const props = [
      { mainStatus: "CLEANING", subStatus: "CLEANING_PENDING" },
      { mainStatus: "CLEANING", subStatus: "CLEANING_IN_PROGRESS" },
    ];
    const stats = countCurrentStats(props);
    assert.equal(stats.cleaning, 2);
  });

  test("혼합 숙소 — 모든 상태 동시 집계", () => {
    const props = [
      { mainStatus: "OCCUPIED", subStatus: "GOOD_CONDITION" },
      { mainStatus: "OCCUPIED", subStatus: "ISSUE_COMPLAINT" },
      { mainStatus: "PRE_STAY_READY", subStatus: "OPTIMIZED" },
      { mainStatus: "VACANT", subStatus: "CLEANING_FINISHED" },
      { mainStatus: "VACANT", subStatus: "CLEANING_FINISHED" },
      { mainStatus: "CLEANING", subStatus: "CLEANING_IN_PROGRESS" },
    ];
    const stats = countCurrentStats(props);
    assert.equal(stats.occupied, 2);
    assert.equal(stats.preStayReady, 1);
    assert.equal(stats.vacant, 2);
    assert.equal(stats.cleaning, 1);
    assert.equal(stats.anomalyCount, 1);
    assert.equal(stats.total, 6);
  });

  test("빈 배열 → 모든 값 0", () => {
    const stats = countCurrentStats([]);
    assert.equal(stats.occupied, 0);
    assert.equal(stats.preStayReady, 0);
    assert.equal(stats.vacant, 0);
    assert.equal(stats.cleaning, 0);
    assert.equal(stats.anomalyCount, 0);
    assert.equal(stats.total, 0);
  });
});

describe("countPeriodEvents — 기간 이벤트 집계", () => {
  test("check_in_detected → checkIns 카운트", () => {
    const events = [
      { type: "check_in_detected" },
      { type: "check_in_detected" },
    ];
    const stats = countPeriodEvents(events);
    assert.equal(stats.checkIns, 2);
  });

  test("check_out_detected → checkOuts 카운트", () => {
    const events = [{ type: "check_out_detected" }];
    const stats = countPeriodEvents(events);
    assert.equal(stats.checkOuts, 1);
  });

  test("complaint_detected → anomalies 카운트", () => {
    const events = [
      { type: "complaint_detected" },
      { type: "complaint_detected" },
    ];
    const stats = countPeriodEvents(events);
    assert.equal(stats.anomalies, 2);
  });

  test("energy_waste_detected → energyWaste + anomalies 동시 카운트", () => {
    const events = [{ type: "energy_waste_detected" }];
    const stats = countPeriodEvents(events);
    assert.equal(stats.energyWaste, 1);
    assert.equal(stats.anomalies, 1);
  });

  test("resolved 이벤트는 집계 안 함", () => {
    const events = [
      { type: "energy_waste_resolved" },
      { type: "complaint_resolved" },
    ];
    const stats = countPeriodEvents(events);
    assert.equal(stats.anomalies, 0);
    assert.equal(stats.energyWaste, 0);
  });

  test("혼합 이벤트 — 복합 집계", () => {
    const events = [
      { type: "check_in_detected" },
      { type: "check_out_detected" },
      { type: "check_out_detected" },
      { type: "complaint_detected" },
      { type: "energy_waste_detected" },
      { type: "energy_waste_resolved" }, // resolved는 집계 안 함
    ];
    const stats = countPeriodEvents(events);
    assert.equal(stats.checkIns, 1);
    assert.equal(stats.checkOuts, 2);
    assert.equal(stats.anomalies, 2); // complaint + energy_waste
    assert.equal(stats.energyWaste, 1);
  });

  test("빈 배열 → 모든 값 0", () => {
    const stats = countPeriodEvents([]);
    assert.equal(stats.checkIns, 0);
    assert.equal(stats.checkOuts, 0);
    assert.equal(stats.anomalies, 0);
    assert.equal(stats.energyWaste, 0);
    assert.equal(stats.noShowSuspected, 0);
    assert.equal(stats.earlyCheckinSuspected, 0);
    assert.equal(stats.checkoutConfirmationNeeded, 0);
  });

  test("no_show_suspected → noShowSuspected 카운트 (anomalies 미포함)", () => {
    const events = [
      { type: "no_show_suspected" },
      { type: "no_show_suspected" },
    ];
    const stats = countPeriodEvents(events);
    assert.equal(stats.noShowSuspected, 2);
    assert.equal(stats.anomalies, 0);
  });

  test("early_checkin_suspected → earlyCheckinSuspected 카운트", () => {
    const events = [{ type: "early_checkin_suspected" }];
    const stats = countPeriodEvents(events);
    assert.equal(stats.earlyCheckinSuspected, 1);
    assert.equal(stats.anomalies, 0);
  });

  test("checkout_confirmation_needed → checkoutConfirmationNeeded 카운트", () => {
    const events = [{ type: "checkout_confirmation_needed" }];
    const stats = countPeriodEvents(events);
    assert.equal(stats.checkoutConfirmationNeeded, 1);
    assert.equal(stats.anomalies, 0);
  });

  test("SOFT + ANOMALY 혼합 — 각 카운터 독립적으로 집계", () => {
    const events = [
      { type: "complaint_detected" },
      { type: "no_show_suspected" },
      { type: "early_checkin_suspected" },
      { type: "checkout_confirmation_needed" },
    ];
    const stats = countPeriodEvents(events);
    assert.equal(stats.anomalies, 1);
    assert.equal(stats.noShowSuspected, 1);
    assert.equal(stats.earlyCheckinSuspected, 1);
    assert.equal(stats.checkoutConfirmationNeeded, 1);
  });
});
