/**
 * Worker Health cron 로직 유닛 테스트
 * 30일 미접속 → fcm_status=inactive 전환
 * 7일 미접속 → Slack 경고
 * (api/cron/[...slug].js의 handleWorkerHealth 구현 시 이 로직과 일치해야 함)
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ============================================================
// 공통 헬퍼 (cron 구현 시 동일 로직 사용)
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(isoStr, nowMs = Date.now()) {
  if (!isoStr) return Infinity;
  return (nowMs - new Date(isoStr).getTime()) / DAY_MS;
}

function needsInactiveTransition(cleaner, nowMs = Date.now()) {
  if (cleaner.fcm_status !== "active") return false;
  if (!cleaner.last_seen_at) return false; // 신규 등록, 아직 한 번도 접속 안 함 → 전환 제외
  return daysSince(cleaner.last_seen_at, nowMs) > 30;
}

// 경고 대상: active 상태인 청소자만 — 앱 미설치(uninstalled)는 이미 알고 있으므로 제외
function needsWarning(cleaner, nowMs = Date.now()) {
  if (cleaner.fcm_status !== "active") return false;
  if (!cleaner.last_seen_at) return false;
  return daysSince(cleaner.last_seen_at, nowMs) > 7;
}

// ============================================================
// 30일 미접속 → inactive 전환 결정
// ============================================================

describe("Worker Health — 30일 미접속 inactive 전환 결정", () => {
  test("fcm_status=active + 31일 미접속 → 전환 필요", () => {
    const cleaner = {
      fcm_status: "active",
      last_seen_at: new Date(Date.now() - 31 * DAY_MS).toISOString(),
    };
    assert.ok(needsInactiveTransition(cleaner));
  });

  test("fcm_status=active + 29일 미접속 → 전환 불필요", () => {
    const cleaner = {
      fcm_status: "active",
      last_seen_at: new Date(Date.now() - 29 * DAY_MS).toISOString(),
    };
    assert.ok(!needsInactiveTransition(cleaner));
  });

  test("fcm_status=active + 정확히 30일 → 전환 불필요 (초과해야 전환)", () => {
    const cleaner = {
      fcm_status: "active",
      last_seen_at: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    };
    assert.ok(!needsInactiveTransition(cleaner));
  });

  test("fcm_status=uninstalled + 31일 미접속 → 전환 불필요 (이미 비활성 상태)", () => {
    const cleaner = {
      fcm_status: "uninstalled",
      last_seen_at: new Date(Date.now() - 31 * DAY_MS).toISOString(),
    };
    assert.ok(!needsInactiveTransition(cleaner));
  });

  test("fcm_status=inactive + 31일 미접속 → 전환 불필요 (이미 inactive)", () => {
    const cleaner = {
      fcm_status: "inactive",
      last_seen_at: new Date(Date.now() - 31 * DAY_MS).toISOString(),
    };
    assert.ok(!needsInactiveTransition(cleaner));
  });

  test("fcm_status=invalid + 31일 미접속 → 전환 불필요", () => {
    const cleaner = {
      fcm_status: "invalid",
      last_seen_at: new Date(Date.now() - 31 * DAY_MS).toISOString(),
    };
    assert.ok(!needsInactiveTransition(cleaner));
  });

  test("last_seen_at=null → 전환 불필요 (신규 등록 미접속)", () => {
    const cleaner = { fcm_status: "active", last_seen_at: null };
    assert.ok(!needsInactiveTransition(cleaner));
  });
});

// ============================================================
// 7일 미접속 Slack 경고 결정
// ============================================================

describe("Worker Health — 7일 미접속 Slack 경고 결정", () => {
  test("8일 미접속 → 경고 필요", () => {
    const cleaner = {
      fcm_status: "active",
      last_seen_at: new Date(Date.now() - 8 * DAY_MS).toISOString(),
    };
    assert.ok(needsWarning(cleaner));
  });

  test("6일 미접속 → 경고 불필요", () => {
    const cleaner = {
      fcm_status: "active",
      last_seen_at: new Date(Date.now() - 6 * DAY_MS).toISOString(),
    };
    assert.ok(!needsWarning(cleaner));
  });

  test("정확히 7일 → 경고 불필요 (초과해야 경고)", () => {
    const cleaner = {
      fcm_status: "active",
      last_seen_at: new Date(Date.now() - 7 * DAY_MS).toISOString(),
    };
    assert.ok(!needsWarning(cleaner));
  });

  test("last_seen_at=null → 경고 불필요", () => {
    const cleaner = { fcm_status: "active", last_seen_at: null };
    assert.ok(!needsWarning(cleaner));
  });

  // 앱 미설치(uninstalled)/inactive/invalid는 이미 인지된 상태 — 경고 제외
  test("fcm_status=uninstalled + 8일 미접속 → 경고 불필요", () => {
    const cleaner = {
      fcm_status: "uninstalled",
      last_seen_at: new Date(Date.now() - 8 * DAY_MS).toISOString(),
    };
    assert.ok(!needsWarning(cleaner));
  });

  test("fcm_status=inactive + 8일 미접속 → 경고 불필요 (이미 inactive로 관리 중)", () => {
    const cleaner = {
      fcm_status: "inactive",
      last_seen_at: new Date(Date.now() - 8 * DAY_MS).toISOString(),
    };
    assert.ok(!needsWarning(cleaner));
  });
});

// ============================================================
// 배치 처리 시뮬레이션 — 여러 직원 동시 판별
// ============================================================

describe("Worker Health — 배치 판별 시뮬레이션", () => {
  const now = Date.now();
  const cleaners = [
    { id: "c-1", name: "김청소", fcm_status: "active",      last_seen_at: new Date(now - 32 * DAY_MS).toISOString() }, // 전환 + 경고
    { id: "c-2", name: "이청소", fcm_status: "active",      last_seen_at: new Date(now - 10 * DAY_MS).toISOString() }, // 경고만
    { id: "c-3", name: "박청소", fcm_status: "active",      last_seen_at: new Date(now -  5 * DAY_MS).toISOString() }, // 이상 없음
    { id: "c-4", name: "최청소", fcm_status: "uninstalled", last_seen_at: new Date(now - 35 * DAY_MS).toISOString() }, // 이미 비활성 → 전환 불필요
  ];

  test("inactive 전환 대상: active + 30일 초과만 (1명)", () => {
    const toTransition = cleaners.filter((c) => needsInactiveTransition(c, now));
    assert.equal(toTransition.length, 1);
    assert.equal(toTransition[0].id, "c-1");
  });

  test("Slack 경고 대상: 7일 초과 (2명)", () => {
    const toWarn = cleaners.filter((c) => needsWarning(c, now));
    assert.equal(toWarn.length, 2);
    const ids = toWarn.map((c) => c.id);
    assert.ok(ids.includes("c-1"));
    assert.ok(ids.includes("c-2"));
  });
});

// ============================================================
// Slack 경고 메시지 형식
// ============================================================

describe("Worker Health — Slack 경고 메시지 형식", () => {
  function buildWarningMessage(workers) {
    return (
      `[PROPOS] ⚠️ 장기 미접속 직원 ${workers.length}명\n` +
      workers
        .map((w) => `${w.name ?? w.phone}: ${w.last_seen_at?.slice(0, 10) ?? "미기록"}`)
        .join("\n")
    );
  }

  test("미접속 인원 수 포함", () => {
    const workers = [
      { name: "김청소", phone: "010-1111-1111", last_seen_at: "2026-07-01T00:00:00Z" },
      { name: "이청소", phone: "010-2222-2222", last_seen_at: "2026-07-05T00:00:00Z" },
    ];
    const msg = buildWarningMessage(workers);
    assert.ok(msg.includes("2명"));
  });

  test("이름 + 마지막 접속일 포함", () => {
    const workers = [
      { name: "김청소", phone: "010-1111-1111", last_seen_at: "2026-07-01T00:00:00Z" },
    ];
    const msg = buildWarningMessage(workers);
    assert.ok(msg.includes("김청소"));
    assert.ok(msg.includes("2026-07-01"));
  });

  test("이름 없으면 phone으로 대체", () => {
    const workers = [
      { name: null, phone: "010-3333-3333", last_seen_at: "2026-07-01T00:00:00Z" },
    ];
    const msg = buildWarningMessage(workers);
    assert.ok(msg.includes("010-3333-3333"));
  });

  test("last_seen_at=null → '미기록' 표시", () => {
    const workers = [
      { name: "박청소", phone: "010-4444-4444", last_seen_at: null },
    ];
    const msg = buildWarningMessage(workers);
    assert.ok(msg.includes("미기록"));
  });

  test("[PROPOS] 헤더 포함", () => {
    const workers = [
      { name: "김청소", phone: "010-1111-1111", last_seen_at: "2026-07-01T00:00:00Z" },
    ];
    const msg = buildWarningMessage(workers);
    assert.ok(msg.includes("[PROPOS]"));
  });
});

// ============================================================
// daysSince 헬퍼 유닛 테스트
// ============================================================

describe("daysSince 헬퍼", () => {
  test("정확히 31일 전 → 31.0 (대략)", () => {
    const fixedNow = new Date("2026-09-10T00:00:00Z").getTime();
    const lastSeen = new Date("2026-08-10T00:00:00Z").toISOString(); // 31일 전
    const days = daysSince(lastSeen, fixedNow);
    assert.ok(Math.abs(days - 31) < 0.01, `예상 31, 실제 ${days}`);
  });

  test("null 입력 → Infinity 반환", () => {
    assert.equal(daysSince(null), Infinity);
  });
});
