/**
 * 청소 자동화 — dispatch 로직 유닛 테스트
 * node:test 내장 러너 사용 (npm test)
 */

import { describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// ── 테스트 대상 함수 직접 import ────────────────────────────
// BASE_URL은 환경변수 없으면 'https://www.proposonline.com'
import {
  buildSmsVip,
  buildSmsBulk,
  buildSmsRemind,
  buildSmsComplete,
  calcCleaningTimes,
  createNotif,
  advanceJob,
} from "../../api/cleaning/_dispatch.js";

// ============================================================
// calcCleaningTimes
// ============================================================
describe("calcCleaningTimes — KST 기준 계산", () => {
  test("checkOutHour=11, duration=2.5 → UTC 변환 정확", () => {
    const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes(
      "2026-09-10",
      11,
      2.5
    );
    // KST 11:00 = UTC 02:00
    assert.equal(cleaning_start_at.toISOString(), "2026-09-10T02:00:00.000Z");
    // UTC 02:00 + 2.5h = UTC 04:30
    assert.equal(cleaning_end_at.toISOString(), "2026-09-10T04:30:00.000Z");
  });

  test("checkOutHour=10, duration=3 → UTC 01:00 ~ 04:00", () => {
    const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes(
      "2026-12-01",
      10,
      3
    );
    assert.equal(cleaning_start_at.toISOString(), "2026-12-01T01:00:00.000Z");
    assert.equal(cleaning_end_at.toISOString(), "2026-12-01T04:00:00.000Z");
  });

  test("자정 경계: checkOutHour=0 → 전날 UTC 15:00", () => {
    const { cleaning_start_at } = calcCleaningTimes("2026-09-10", 0, 1);
    assert.equal(cleaning_start_at.toISOString(), "2026-09-09T15:00:00.000Z");
  });

  test("duration이 분수여도 ms 정확히 계산됨", () => {
    const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes(
      "2026-09-10",
      11,
      1.5
    );
    const diffMs = cleaning_end_at.getTime() - cleaning_start_at.getTime();
    assert.equal(diffMs, 1.5 * 3_600_000);
  });
});

// ============================================================
// SMS 메시지 빌더
// ============================================================
describe("buildSmsVip", () => {
  const job = {
    property_id: "P-001",
    cleaning_start_at: new Date("2026-09-10T02:00:00Z"), // KST 11:00
  };

  test("[PROPOS] 헤더 포함", () => {
    const msg = buildSmsVip(job, "강남 숙소", "ABC123");
    assert.ok(msg.includes("[PROPOS]"));
  });

  test("숙소명 포함", () => {
    const msg = buildSmsVip(job, "강남 숙소", "ABC123");
    assert.ok(msg.includes("강남 숙소"));
  });

  test("KST 시각 포함 (11:00)", () => {
    const msg = buildSmsVip(job, "강남 숙소", "ABC123");
    assert.ok(msg.includes("11:00"), `메시지에 11:00 없음: ${msg}`);
  });

  test("수락 링크에 property_id 포함", () => {
    const msg = buildSmsVip(job, "강남 숙소", "ABC123");
    assert.ok(msg.includes("/c/P-001"));
  });

  test("거절 링크에 토큰 포함", () => {
    const msg = buildSmsVip(job, "강남 숙소", "ABC123");
    assert.ok(msg.includes("/d/ABC123"));
  });

  test("1시간 응답 안내 문구 포함", () => {
    const msg = buildSmsVip(job, "강남 숙소", "ABC123");
    assert.ok(msg.includes("1시간 내 응답"));
  });
});

describe("buildSmsBulk", () => {
  const job = {
    property_id: "P-002",
    cleaning_start_at: new Date("2026-09-10T02:00:00Z"),
  };

  test("선착순 예약 문구 포함", () => {
    const msg = buildSmsBulk(job, "서초 숙소", "XYZ789");
    assert.ok(msg.includes("선착순 예약"));
  });

  test("수락 링크 + 거절 링크 모두 포함", () => {
    const msg = buildSmsBulk(job, "서초 숙소", "XYZ789");
    assert.ok(msg.includes("/c/P-002"));
    assert.ok(msg.includes("/d/XYZ789"));
  });

  test("VIP 메시지와 달리 '1시간 내 응답' 없음", () => {
    const msg = buildSmsBulk(job, "서초 숙소", "XYZ789");
    assert.ok(!msg.includes("1시간 내 응답"));
  });
});

describe("buildSmsRemind", () => {
  const job = {
    property_id: "P-003",
    cleaning_start_at: new Date("2026-09-10T02:00:00Z"),
  };

  test("재안내 문구 포함", () => {
    const msg = buildSmsRemind(job, "마포 숙소", "RMD001");
    assert.ok(msg.includes("재안내"));
  });

  test("날짜 포함", () => {
    const msg = buildSmsRemind(job, "마포 숙소", "RMD001");
    assert.ok(msg.includes("2026-09-10"));
  });
});

describe("buildSmsComplete", () => {
  test("배정 완료 문구 포함", () => {
    const msg = buildSmsComplete("강남 숙소", "2026-09-10");
    assert.ok(msg.includes("배정 완료됐습니다"));
  });

  test("숙소명 + 날짜 포함", () => {
    const msg = buildSmsComplete("강남 숙소", "2026-09-10");
    assert.ok(msg.includes("강남 숙소"));
    assert.ok(msg.includes("2026-09-10"));
  });
});

// ============================================================
// createNotif — DB 모킹
// ============================================================
describe("createNotif — DB mock", () => {
  function makeDb(responses) {
    let callIdx = 0;
    return {
      query: async () => responses[callIdx++] ?? { rows: [] },
    };
  }

  test("신규 (job_id, cleaner_id) → INSERT 성공 반환", async () => {
    const db = makeDb([
      { rows: [] },                                         // 기존 조회: 없음
      { rows: [{ id: "notif-1", token: "ABCDEF" }] },      // INSERT 성공
    ]);
    const result = await createNotif(db, {
      jobId: "job-1",
      cleanerId: "cleaner-1",
      tier: "VIP_1",
    });
    assert.equal(result.token, "ABCDEF");
    assert.equal(result.id, "notif-1");
  });

  test("이미 존재하는 (job_id, cleaner_id) → 기존 레코드 반환 (멱등성)", async () => {
    const db = makeDb([
      { rows: [{ id: "notif-existing", token: "EXIST1" }] }, // 기존 조회: 있음
    ]);
    const result = await createNotif(db, {
      jobId: "job-1",
      cleanerId: "cleaner-1",
      tier: "VIP_1",
    });
    assert.equal(result.token, "EXIST1");
    assert.equal(result.id, "notif-existing");
  });

  test("token 충돌(23505) → 재시도 후 성공", async () => {
    let callIdx = 0;
    const db = {
      query: async () => {
        const i = callIdx++;
        if (i === 0) return { rows: [] }; // 기존 조회: 없음
        if (i === 1) { const e = new Error("unique"); e.code = "23505"; throw e; }
        return { rows: [{ id: "notif-retry", token: "NEWTKN" }] };
      },
    };
    const result = await createNotif(db, {
      jobId: "job-2",
      cleanerId: "cleaner-2",
      tier: "BULK",
    });
    assert.equal(result.token, "NEWTKN");
  });

  test("token 23505 5회 연속 → 오류 throw", async () => {
    let callIdx = 0;
    const db = {
      query: async () => {
        const i = callIdx++;
        if (i === 0) return { rows: [] }; // 기존 조회: 없음
        const e = new Error("unique"); e.code = "23505"; throw e;
      },
    };
    await assert.rejects(
      () => createNotif(db, { jobId: "job-3", cleanerId: "cleaner-3", tier: "VIP_2" }),
      /토큰 생성 실패/
    );
  });

  test("DB 오류(23505 아님) → 즉시 throw", async () => {
    let callIdx = 0;
    const db = {
      query: async () => {
        const i = callIdx++;
        if (i === 0) return { rows: [] };
        const e = new Error("connection refused"); e.code = "ECONNREFUSED"; throw e;
      },
    };
    await assert.rejects(
      () => createNotif(db, { jobId: "job-4", cleanerId: "cleaner-4", tier: "VIP_3" }),
      /connection refused/
    );
  });
});

// ============================================================
// advanceJob — DB + sendSms 모킹
// ============================================================
describe("advanceJob — DB mock", () => {
  // sendSms는 HTTP 호출이라 실제 호출 대신 mock
  // advanceJob은 직접 sendSms를 import하지 않고 _dispatch 내부에서 호출
  // → 테스트에서는 fetch를 mock으로 교체

  function makeMockDb({ propName = "테스트 숙소", cleaner = null } = {}) {
    const calls = [];
    return {
      _calls: calls,
      query: async (sql, params) => {
        calls.push({ sql: sql.trim().slice(0, 60), params });

        // property config
        if (sql.includes("property_cleaning_config")) {
          return { rows: [{ name: propName }] };
        }
        // VIP cleaner 조회
        if (sql.includes("FROM cleaners WHERE tier=")) {
          return { rows: cleaner ? [cleaner] : [] };
        }
        // 중복 발송 방지 체크
        if (sql.includes("j.status NOT IN") && sql.includes("cleaning_notifs")) {
          return { rows: [] }; // 겹치는 job 없음
        }
        // createNotif 기존 조회
        if (sql.includes("FROM cleaning_notifs WHERE job_id=")) {
          return { rows: [] };
        }
        // createNotif INSERT
        if (sql.includes("INSERT INTO cleaning_notifs")) {
          return { rows: [{ id: "notif-1", token: "TTTTT1" }] };
        }
        // status UPDATE
        if (sql.includes("UPDATE cleaning_jobs SET status=")) {
          return { rows: [] };
        }
        // BULK cleaners
        if (sql.includes("FROM cleaners c") && sql.includes("tier = 'BULK'")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
  }

  test("PENDING 상태 + VIP_1 없음 → VIP_1 status 업뎃 후 재귀로 VIP_2 시도", async () => {
    // VIP_1 없음, VIP_2도 없음, VIP_3도 없음 → BULK 전환
    const db = makeMockDb({ cleaner: null });
    const smsCalls = [];
    // fetch mock: SMS 발송 캡처
    global.fetch = async (url, opts) => {
      smsCalls.push({ url, opts });
      return { ok: true, json: async () => ({}) };
    };

    const job = {
      id: "job-1",
      property_id: "P-001",
      status: "PENDING",
      checkout_at: "2026-09-10T02:00:00Z",
      cleaning_start_at: "2026-09-10T02:00:00Z",
    };
    await advanceJob(db, job);

    // SMS 발송 없음 (VIP 없고 BULK도 없음)
    assert.equal(smsCalls.length, 0);

    // status 업데이트가 여러 번 호출됨 (PENDING→VIP_1, VIP_1→VIP_2, ...)
    const statusUpdates = db._calls.filter((c) =>
      c.sql.includes("UPDATE cleaning_jobs SET status=")
    );
    assert.ok(statusUpdates.length >= 1, "status 업데이트 호출 없음");
  });

  test("PENDING 상태 + VIP_1 있음 → VIP_1에게 SMS 발송 + status=NOTIFYING_VIP_1", async () => {
    const cleaner = { id: "c-1", phone: "010-1111-1111", name: "김청소", tier: "VIP_1" };
    const db = makeMockDb({ cleaner });
    const smsCalls = [];
    global.fetch = async (url, opts) => {
      smsCalls.push({ url, body: JSON.parse(opts?.body ?? "{}") });
      return { ok: true, json: async () => ({}) };
    };

    const job = {
      id: "job-2",
      property_id: "P-001",
      status: "PENDING",
      checkout_at: "2026-09-10T02:00:00Z",
      cleaning_start_at: "2026-09-10T02:00:00Z",
    };
    await advanceJob(db, job);

    // SMS 발송 1건
    assert.equal(smsCalls.length, 1);
    assert.equal(smsCalls[0].body.phone, "010-1111-1111");
    assert.ok(smsCalls[0].body.message.includes("[PROPOS]"));

    // NOTIFYING_VIP_1으로 status 업데이트
    const statusUpdates = db._calls.filter((c) =>
      c.sql.includes("UPDATE cleaning_jobs SET status=")
    );
    assert.ok(statusUpdates.length >= 1);
    assert.ok(statusUpdates.some((c) => c.params?.includes?.("NOTIFYING_VIP_1")));
  });

  test("NOTIFYING_BULK 상태 → advanceJob 즉시 반환 (followup 크론 영역)", async () => {
    const db = makeMockDb();
    const smsCalls = [];
    global.fetch = async () => ({ ok: true, json: async () => ({}) });

    const job = {
      id: "job-3",
      property_id: "P-001",
      status: "NOTIFYING_BULK",
      checkout_at: "2026-09-10T02:00:00Z",
      cleaning_start_at: "2026-09-10T02:00:00Z",
    };
    await advanceJob(db, job); // 반환만 하고 아무것도 안 함

    const statusUpdates = db._calls.filter((c) =>
      c.sql.includes("UPDATE cleaning_jobs SET status=")
    );
    assert.equal(statusUpdates.length, 0, "NOTIFYING_BULK에서 추가 상태 변경 없어야 함");
  });
});
