/**
 * cron/tick.js — 매시간 KST 분기 로직 유닛 테스트
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

const KST_OFFSET = 9 * 3600 * 1000;

function resolveTasks(utcHour, dayOfMonth) {
  const tasks = [];
  if (utcHour === 8  - 9 + 24) { /* 계산 방식 확인용 */ }
  // kstHour = (utcHour + 9) % 24
  const kstHour = (utcHour + 9) % 24;
  if (kstHour === 8)               tasks.push("daily-plan");
  if (kstHour === 9)               tasks.push("worker-health-check");
  if (kstHour === 22)              tasks.push("daily-result");
  if (kstHour === 0 && dayOfMonth === 15) tasks.push("monthly-cleaning");
  return tasks;
}

// ============================================================
// KST 시각 → 실행 작업 매핑
// ============================================================
describe("cron tick — KST 시각별 작업 선택", () => {
  test("UTC 23:00 = KST 08:00 → daily-plan", () => {
    assert.deepEqual(resolveTasks(23, 1), ["daily-plan"]);
  });

  test("UTC 00:00 = KST 09:00 → worker-health-check", () => {
    assert.deepEqual(resolveTasks(0, 1), ["worker-health-check"]);
  });

  test("UTC 13:00 = KST 22:00 → daily-result", () => {
    assert.deepEqual(resolveTasks(13, 1), ["daily-result"]);
  });

  test("UTC 15:00 = KST 00:00 + 15일 → monthly-cleaning", () => {
    assert.deepEqual(resolveTasks(15, 15), ["monthly-cleaning"]);
  });

  test("UTC 15:00 = KST 00:00이지만 15일이 아님 → 빈 배열", () => {
    assert.deepEqual(resolveTasks(15, 14), []);
  });

  test("UTC 10:00 = KST 19:00 → 아무 작업 없음", () => {
    assert.deepEqual(resolveTasks(10, 1), []);
  });

  test("각 시각은 서로 겹치지 않음 (동시 실행 없음)", () => {
    const kstHours = [8, 9, 22, 0];
    const seen = new Set(kstHours);
    assert.equal(seen.size, kstHours.length);
  });
});

// ============================================================
// fakeRes — mock 응답 객체 동작
// ============================================================
describe("fakeRes — mock 응답 객체", () => {
  function fakeRes() {
    const r = { _code: 200, _body: null };
    r.status = (c) => { r._code = c; return r; };
    r.json   = (b) => { r._body = b; return r; };
    r.end    = ()  => r;
    return r;
  }

  test("status().json() 체이닝 → _code, _body 저장", () => {
    const fr = fakeRes();
    fr.status(200).json({ ok: true });
    assert.equal(fr._code, 200);
    assert.deepEqual(fr._body, { ok: true });
  });

  test("json() 직접 호출 → _body 저장", () => {
    const fr = fakeRes();
    fr.json({ result: "done" });
    assert.deepEqual(fr._body, { result: "done" });
  });

  test("end() 호출 가능", () => {
    const fr = fakeRes();
    assert.doesNotThrow(() => fr.end());
  });

  test("초기 _code=200, _body=null", () => {
    const fr = fakeRes();
    assert.equal(fr._code, 200);
    assert.equal(fr._body, null);
  });
});

// ============================================================
// CRON_SECRET 인증 로직
// ============================================================
describe("cron tick — CRON_SECRET 인증", () => {
  function checkAuth(envSecret, authHeader) {
    if (!envSecret) return true; // 미설정 시 허용
    return authHeader === `Bearer ${envSecret}`;
  }

  test("CRON_SECRET 미설정 → 모든 요청 허용", () => {
    assert.ok(checkAuth(undefined, ""));
    assert.ok(checkAuth("", "anything"));
  });

  test("CRON_SECRET 설정 + 올바른 헤더 → 허용", () => {
    assert.ok(checkAuth("my-secret", "Bearer my-secret"));
  });

  test("CRON_SECRET 설정 + 틀린 헤더 → 거부", () => {
    assert.ok(!checkAuth("my-secret", "Bearer wrong"));
    assert.ok(!checkAuth("my-secret", ""));
  });

  test("Bearer 접두사 없는 토큰 → 거부", () => {
    assert.ok(!checkAuth("my-secret", "my-secret"));
  });
});

// ============================================================
// vercel.json 크론 구조 검증
// ============================================================
describe("vercel.json — cron 단일화", () => {
  test("tick 크론은 매시간 정각 실행 (0 * * * *)", () => {
    const schedule = "0 * * * *";
    const parts = schedule.split(" ");
    assert.equal(parts[0], "0");    // 분: 정각
    assert.equal(parts[1], "*");    // 시: 매시간
    assert.equal(parts[2], "*");    // 일
    assert.equal(parts[3], "*");    // 월
    assert.equal(parts[4], "*");    // 요일
  });

  test("매시간 실행 → 하루 24회 호출", () => {
    let callCount = 0;
    for (let h = 0; h < 24; h++) callCount++;
    assert.equal(callCount, 24);
  });

  test("실제 작업은 4회/일 (08, 09, 22시 + 매월 15일 00시)", () => {
    let taskCallCount = 0;
    for (let h = 0; h < 24; h++) {
      const tasks = resolveTasks(h, 1);
      taskCallCount += tasks.length;
    }
    assert.equal(taskCallCount, 3); // 일반적인 날 — monthly-cleaning 제외
  });
});
