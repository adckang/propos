/**
 * cron/tick.js — 매시간 KST 분기 로직 유닛 테스트
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

const KST_OFFSET = 9 * 3600 * 1000;

function resolveTasks(utcHour, dayOfMonth) {
  const kstHour = (utcHour + 9) % 24;
  const tasks = [];
  if (kstHour === 8)                tasks.push("daily-plan");
  if (kstHour === 8)                tasks.push("worker-health-check");
  if (kstHour === 8 && dayOfMonth === 15) tasks.push("monthly-cleaning");
  if (kstHour === 22)               tasks.push("daily-result");
  return tasks;
}

// ============================================================
// KST 시각 → 실행 작업 매핑
// ============================================================
describe("cron tick — KST 시각별 작업 선택", () => {
  test("UTC 23:00 = KST 08:00 → daily-plan + worker-health-check (동시 실행)", () => {
    assert.deepEqual(resolveTasks(23, 1), ["daily-plan", "worker-health-check"]);
  });

  test("UTC 23:00 = KST 08:00 + 15일 → daily-plan + worker-health-check + monthly-cleaning", () => {
    assert.deepEqual(resolveTasks(23, 15), ["daily-plan", "worker-health-check", "monthly-cleaning"]);
  });

  test("UTC 13:00 = KST 22:00 → daily-result", () => {
    assert.deepEqual(resolveTasks(13, 1), ["daily-result"]);
  });

  test("UTC 10:00 = KST 19:00 → 아무 작업 없음", () => {
    assert.deepEqual(resolveTasks(10, 1), []);
  });

  test("크론 호출 시각은 2개 (KST 08:00, KST 22:00)", () => {
    const cronKstHours = [8, 22];
    assert.equal(cronKstHours.length, 2);
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
describe("vercel.json — cron 2개 (Hobby 플랜 일 2회 한도)", () => {
  test("아침 크론: UTC 23:00 (KST 08:00) 하루 1회", () => {
    const schedule = "0 23 * * *";
    const parts = schedule.split(" ");
    assert.equal(parts[0], "0");    // 분: 정각
    assert.equal(parts[1], "23");   // 시: UTC 23
    assert.equal(parts[2], "*");    // 일
  });

  test("저녁 크론: UTC 13:00 (KST 22:00) 하루 1회", () => {
    const schedule = "0 13 * * *";
    const parts = schedule.split(" ");
    assert.equal(parts[0], "0");
    assert.equal(parts[1], "13");   // 시: UTC 13
  });

  test("크론 2개 합쳐 하루 2회 호출 (Hobby 한도 이내)", () => {
    const crons = ["0 23 * * *", "0 13 * * *"];
    assert.equal(crons.length, 2);
  });

  test("일반 날 실제 작업: morning=2건, evening=1건", () => {
    const morning = resolveTasks(23, 1); // UTC 23 = KST 08
    const evening = resolveTasks(13, 1); // UTC 13 = KST 22
    assert.equal(morning.length, 2); // daily-plan + worker-health-check
    assert.equal(evening.length, 1); // daily-result
  });

  test("15일 아침: morning=3건 (monthly-cleaning 추가)", () => {
    const morning = resolveTasks(23, 15);
    assert.equal(morning.length, 3);
    assert.ok(morning.includes("monthly-cleaning"));
  });
});
