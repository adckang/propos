/**
 * s48 — "현재 상태"는 이벤트 기록에서 계산한다 (임시 저장소 5분 만료 문제 해소)
 *
 * 예전 문제 장면
 *   · 손님이 오후 3시에 체크인 → 3시 5분까지만 "체류중 1"로 보이고, 6분부터는 숙소가 통째로 사라져 "전체 0개"
 *   · 민원이 들어오면 그 방이 목록에서 사라지고, "이상 N건"은 영원히 0
 *   · 아침 8시 Slack 브리핑이 "입실 중 0 | 공실 0 | 청소 중 0"으로 나감
 *   · 입실 준비 중인 방은 어디에도 잡히지 않음
 *
 *   A. deriveRoomState             — 기록 → 지금 상태 (규칙 적용)   (L1)
 *   B. getLastKnownStatesFromDB    — 조회 방식(어느 숙소, 어떤 값)    (L1, 가짜 DB)
 *   C. getStatsForPeriod(now/today) — 화면·브리핑이 보는 숫자        (L1, 가짜 DB)
 *   D. 배선 계약                    — 더 이상 임시 저장소를 읽지 않음   (L2)
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { deriveRoomState, ANCHOR_EVENT_TYPES, FOLLOW_EVENT_TYPES } from "../../src/domain/roomStateFromEventsDomain.js";
import { getLastKnownStatesFromDB } from "../../src/infrastructure/eventRepository.js";
import { getStatsForPeriod } from "../../src/application/reportingService.js";
import { makeStateDb } from "../helpers/stateEventsFixtures.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const st = (main, sub) => ({ mainStatus: main, subStatus: sub });

// ══════════════════════════════════════════════════════════════════════════
// A. 기록 → 지금 상태
// ══════════════════════════════════════════════════════════════════════════
describe("deriveRoomState — 마지막 큰 변화가 출발점", () => {
  test("체크인했다 → 체류중(상태 좋음)", () => {
    assert.deepEqual(deriveRoomState("check_in_detected"), st("OCCUPIED", "GOOD_CONDITION"));
  });
  test("체크아웃했다 → 청소 대기", () => {
    assert.deepEqual(deriveRoomState("check_out_detected"), st("CLEANING", "CLEANING_PENDING"));
  });
  test("청소를 시작했다 → 청소 진행 중", () => {
    assert.deepEqual(deriveRoomState("cleaning_started"), st("CLEANING", "CLEANING_IN_PROGRESS"));
  });
  test("청소를 마쳤다 → 공실(청소 완료)", () => {
    assert.deepEqual(deriveRoomState("cleaning_finished"), st("VACANT", "CLEANING_FINISHED"));
  });
  test("큰 변화 기록이 하나도 없으면 상태를 알 수 없다(null)", () => {
    assert.equal(deriveRoomState(undefined), null);
    assert.equal(deriveRoomState("complaint_detected"), null); // 세부 이벤트만으로는 출발점이 될 수 없음
  });
});

describe("deriveRoomState — 체류 중 민원·에너지 낭비", () => {
  test("체류 중 민원이 들어왔다 → 이상(민원)", () => {
    assert.deepEqual(deriveRoomState("check_in_detected", ["complaint_detected"]), st("OCCUPIED", "ISSUE_COMPLAINT"));
  });
  test("민원이 해결됐다 → 다시 정상", () => {
    assert.deepEqual(deriveRoomState("check_in_detected", ["complaint_detected", "complaint_resolved"]), st("OCCUPIED", "GOOD_CONDITION"));
  });
  test("에너지 낭비가 감지됐다 → 이상(에너지)", () => {
    assert.deepEqual(deriveRoomState("check_in_detected", ["energy_waste_detected"]), st("OCCUPIED", "ENERGY_WASTE"));
  });
  test("민원과 에너지 낭비가 겹쳤다 → 복합 이상(방은 1개)", () => {
    const s = deriveRoomState("check_in_detected", ["energy_waste_detected", "complaint_detected"]);
    assert.deepEqual(s, st("OCCUPIED", "ISSUE_AND_ENERGY"));
  });
  test("복합 이상에서 민원만 해결 → 에너지 낭비만 남는다", () => {
    const s = deriveRoomState("check_in_detected", ["energy_waste_detected", "complaint_detected", "complaint_resolved"]);
    assert.deepEqual(s, st("OCCUPIED", "ENERGY_WASTE"));
  });
});

describe("deriveRoomState — 공실 중·입실 준비", () => {
  test("빈 방에서 전기가 낭비되고 있다 → 공실(에너지 낭비)", () => {
    assert.deepEqual(deriveRoomState("cleaning_finished", ["vacant_energy_waste_detected"]), st("VACANT", "ENERGY_WASTE"));
  });
  test("공실 에너지 낭비가 해결됐다 → 공실(정상)", () => {
    assert.deepEqual(
      deriveRoomState("cleaning_finished", ["vacant_energy_waste_detected", "vacant_energy_waste_resolved"]),
      st("VACANT", "CLEANING_FINISHED"),
    );
  });
  test("체크인 준비 시간이 됐다 → 입실 준비(최적화 중)", () => {
    assert.deepEqual(deriveRoomState("cleaning_finished", ["checkin_prep_time_reached"]), st("PRE_STAY_READY", "OPTIMIZING"));
  });
  test("최적화가 끝났다 → 입실 준비(최적화 완료)", () => {
    assert.deepEqual(
      deriveRoomState("cleaning_finished", ["checkin_prep_time_reached", "optimization_finished"]),
      st("PRE_STAY_READY", "OPTIMIZED"),
    );
  });
});

describe("deriveRoomState — 규칙에 맞지 않는 기록은 무시", () => {
  test("정상인 방에 '민원 해결' 기록이 와도 상태는 그대로", () => {
    assert.deepEqual(deriveRoomState("check_in_detected", ["complaint_resolved"]), st("OCCUPIED", "GOOD_CONDITION"));
  });
  test("체류 중인 방에 '공실 에너지 낭비'가 와도 무시", () => {
    assert.deepEqual(deriveRoomState("check_in_detected", ["vacant_energy_waste_detected"]), st("OCCUPIED", "GOOD_CONDITION"));
  });
  test("청소 대기 중인 방의 세부 이벤트는 무시", () => {
    assert.deepEqual(deriveRoomState("check_out_detected", ["complaint_detected", "optimization_finished"]), st("CLEANING", "CLEANING_PENDING"));
  });
  test("처리 못 하는 이벤트가 섞여도 뒤의 정상 이벤트는 적용", () => {
    const s = deriveRoomState("check_in_detected", ["optimization_finished", "complaint_detected"]);
    assert.deepEqual(s, st("OCCUPIED", "ISSUE_COMPLAINT"));
  });
});

describe("이벤트 종류 목록", () => {
  test("큰 변화 4종과 세부 이벤트 8종, 서로 겹치지 않는다", () => {
    assert.equal(ANCHOR_EVENT_TYPES.length, 4);
    assert.equal(FOLLOW_EVENT_TYPES.length, 8);
    assert.equal(new Set([...ANCHOR_EVENT_TYPES, ...FOLLOW_EVENT_TYPES]).size, 12);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. 조회 방식
// ══════════════════════════════════════════════════════════════════════════
describe("getLastKnownStatesFromDB — 어느 숙소를 어떻게 읽는가", () => {
  test("전체 조회: 기록이 있는 모든 숙소의 상태를 돌려준다", async () => {
    const db = makeStateDb({ A: ["check_in_detected"], B: ["cleaning_finished"] });
    const states = await getLastKnownStatesFromDB(db, null);
    assert.deepEqual([...states.keys()].sort(), ["A", "B"]);
    assert.deepEqual(states.get("A"), st("OCCUPIED", "GOOD_CONDITION"));
    assert.deepEqual(states.get("B"), st("VACANT", "CLEANING_FINISHED"));
  });

  test("전체 조회는 숙소 목록 필터 없이(null) 한 번의 질의로 처리", async () => {
    const db = makeStateDb({ A: ["check_in_detected"], B: ["cleaning_finished"] });
    await getLastKnownStatesFromDB(db, null);
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].params[1], null);
  });

  test("선택 조회: 고른 숙소만, 여러 곳이어도 한 번의 질의", async () => {
    const db = makeStateDb({ A: ["check_in_detected"], B: ["cleaning_finished"], C: ["check_out_detected"] });
    const states = await getLastKnownStatesFromDB(db, ["A", "C"]);
    assert.deepEqual([...states.keys()].sort(), ["A", "C"]);
    assert.equal(db.calls.length, 1);
    assert.deepEqual(db.calls[0].params[1], ["A", "C"]);
  });

  test("빈 선택이면 DB를 부르지 않고 빈 결과", async () => {
    const db = makeStateDb({ A: ["check_in_detected"] });
    const states = await getLastKnownStatesFromDB(db, []);
    assert.equal(states.size, 0);
    assert.equal(db.calls.length, 0);
  });

  test("기록이 전혀 없는 숙소는 결과에 없다 (상태를 알 수 없음)", async () => {
    const db = makeStateDb({ A: ["check_in_detected"], NEW: [] });
    const states = await getLastKnownStatesFromDB(db, ["A", "NEW"]);
    assert.deepEqual([...states.keys()], ["A"]);
  });

  test("질의에 시간 제한이 없다 — 오래전 체크인도 지금 체류중이면 그대로 잡힌다", async () => {
    const db = makeStateDb({ LONGSTAY: ["check_in_detected"] });
    await getLastKnownStatesFromDB(db, null);
    assert.ok(!/interval|NOW\(\)|now\(\)/i.test(db.calls[0].sql), "만료/기간 조건이 들어 있으면 안 됨");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. 화면·브리핑이 보는 숫자
// ══════════════════════════════════════════════════════════════════════════
const MORNING = {
  "파주 201": ["cleaning_finished", "check_in_detected"],                                        // 체류중(정상)
  "파주 202": ["check_in_detected", "complaint_detected"],                                      // 체류중 + 민원
  "파주 203": ["check_in_detected", "check_out_detected", "cleaning_started"],                  // 청소 중
  "파주 204": ["check_out_detected", "cleaning_started", "cleaning_finished", "checkin_prep_time_reached"], // 입실 준비
  "파주 205": ["cleaning_finished"],                                                            // 공실
  "파주 206": [],                                                                               // 기록 없음
};

for (const period of ["now", "today"]) {
  describe(`현재 상태 레포트(${period}) — 시나리오`, () => {
    const run = (histories, propertyIds = null, extra = {}) =>
      getStatsForPeriod(period, { db: makeStateDb(histories), propertyIds, ...extra });

    test("아침 8시 브리핑: 5개 숙소가 모두 제 상태로 잡힌다 (기록 없는 1곳은 제외)", async () => {
      const { stats } = await run(MORNING);
      assert.equal(stats.total, 5);
      assert.equal(stats.occupied, 2);
      assert.equal(stats.preStayReady, 1);
      assert.equal(stats.cleaning, 1);
      assert.equal(stats.vacant, 1);
    });

    test("체류 중 민원이 있는 방은 목록에서 사라지지 않고 '이상 1건'으로 잡힌다", async () => {
      const { stats } = await run(MORNING);
      assert.equal(stats.anomalyCount, 1);
    });

    test("체크인한 지 몇 시간·며칠이 지나도 체류중 숫자가 줄어들지 않는다", async () => {
      const now = await run({ A: ["check_in_detected"] });
      const nextWeek = await run({ A: ["check_in_detected"] }, null, { now: new Date(Date.now() + 7 * 86400000) });
      assert.deepEqual(nextWeek.stats, now.stats);
      assert.equal(now.stats.occupied, 1);
    });

    test("민원이 해결되면 이상 건수에서 빠진다 (방은 계속 체류중)", async () => {
      const { stats } = await run({ A: ["check_in_detected", "complaint_detected", "complaint_resolved"] });
      assert.equal(stats.anomalyCount, 0);
      assert.equal(stats.occupied, 1);
    });

    test("민원과 에너지 낭비가 함께 있어도 방 1개는 이상 1건", async () => {
      const { stats } = await run({ A: ["check_in_detected", "energy_waste_detected", "complaint_detected"] });
      assert.equal(stats.anomalyCount, 1);
      assert.equal(stats.occupied, 1);
    });

    test("이전 손님의 민원은 새 손님에게 이어지지 않는다", async () => {
      const { stats } = await run({
        A: ["check_in_detected", "complaint_detected", "check_out_detected", "cleaning_started", "cleaning_finished", "check_in_detected"],
      });
      assert.equal(stats.anomalyCount, 0);
      assert.equal(stats.occupied, 1);
    });

    test("입실 준비 중인 방이 '입실전'으로 집계된다", async () => {
      const { stats } = await run({ A: ["cleaning_finished", "checkin_prep_time_reached", "optimization_finished"] });
      assert.equal(stats.preStayReady, 1);
    });

    test("체류중+입실전+공실+청소중 = 전체 (빠지는 방이 없다)", async () => {
      const { stats } = await run(MORNING);
      assert.equal(stats.occupied + stats.preStayReady + stats.vacant + stats.cleaning, stats.total);
    });

    test("숙소를 골라서 보면 그 숙소들만 집계", async () => {
      const { stats } = await run(MORNING, ["파주 201", "파주 205"]);
      assert.equal(stats.total, 2);
      assert.equal(stats.occupied, 1);
      assert.equal(stats.vacant, 1);
      assert.equal(stats.anomalyCount, 0, "고르지 않은 파주 202의 민원은 포함되지 않는다");
    });

    test("같은 숙소를 두 번 골라도 한 번만 센다", async () => {
      const { stats } = await run(MORNING, ["파주 201", "파주 201"]);
      assert.equal(stats.total, 1);
    });

    test("선택을 모두 해제하면 전부 0 (전체로 되돌아가지 않는다)", async () => {
      const db = makeStateDb(MORNING);
      const { stats } = await getStatsForPeriod(period, { db, propertyIds: [] });
      for (const v of Object.values(stats)) assert.equal(v, 0);
      assert.equal(db.calls.length, 0);
    });

    test("기록이 없는 숙소만 고르면 '0개'", async () => {
      const { stats } = await run(MORNING, ["파주 206"]);
      assert.equal(stats.total, 0);
    });

    test("어떤 숙소를 조합해서 봐도 개별 숙소의 합과 같다 (모든 조합)", async () => {
      const ids = ["파주 201", "파주 202", "파주 203", "파주 204"];
      const fields = ["occupied", "preStayReady", "vacant", "cleaning", "anomalyCount", "total"];
      const single = {};
      for (const id of ids) single[id] = (await run(MORNING, [id])).stats;
      const bad = [];
      for (let mask = 1; mask < 1 << ids.length; mask++) {
        const subset = ids.filter((_, i) => mask & (1 << i));
        const multi = (await run(MORNING, subset)).stats;
        for (const f of fields) {
          const sum = subset.reduce((s, id) => s + single[id][f], 0);
          if (multi[f] !== sum) bad.push(`${subset.join("+")}.${f}: 합 ${sum} ≠ ${multi[f]}`);
        }
      }
      assert.deepEqual(bad, []);
    });

    test("전체 조회 결과 = 모든 숙소를 하나씩 고른 결과의 합", async () => {
      const all = (await run(MORNING)).stats;
      const ids = Object.keys(MORNING);
      const sumTotal = (await Promise.all(ids.map((id) => run(MORNING, [id])))).reduce((s, r) => s + r.stats.total, 0);
      assert.equal(all.total, sumTotal);
    });

    test("요약 문장: 이상이 있으면 알리고, 없으면 정상 운영 중이라고 말한다", async () => {
      const bad = await run(MORNING);
      assert.match(bad.summary, /이상 징후 1건/);
      const good = await run({ A: ["check_in_detected"], B: ["cleaning_finished"] });
      assert.match(good.summary, /2개 숙소 정상 운영 중/);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// D. 배선 계약 (L2)
// ══════════════════════════════════════════════════════════════════════════
describe("현재 상태 레포트는 더 이상 5분짜리 임시 저장소를 읽지 않는다 (L2)", () => {
  const svc = read("src/application/reportingService.js");

  test("reportingService 가 KV 상태 함수(getRoomState/setRoomState)를 쓰지 않는다", () => {
    assert.ok(!/getRoomState|setRoomState|kvStore/.test(svc));
  });

  test("현재 상태는 기록 기반 조회(getLastKnownStatesFromDB)로 계산한다", () => {
    assert.ok(svc.includes("getLastKnownStatesFromDB("));
  });

  test("한 숙소씩 반복 조회하지 않는다 (숙소 수만큼 DB를 부르는 구조 금지)", () => {
    const nowBranch = svc.slice(svc.indexOf('period === "now"'), svc.indexOf("const range = getPeriodRange"));
    assert.ok(!/ids\.map\(|Promise\.all/.test(nowBranch));
  });

  test("옛 한 숙소 조회(getLastKnownStateFromDB)는 남아 있지 않다", () => {
    assert.ok(!/getLastKnownStateFromDB\b/.test(read("src/infrastructure/eventRepository.js")));
  });
});
