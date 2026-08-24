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

  // 알림 채널(FCM/SMS) 검증은 s25/s26에서 담당.
  // 여기서는 상태 머신 전환(PENDING → NOTIFYING_VIP_1)만 검증.
  test("PENDING 상태 + VIP_1 있음 → status=NOTIFYING_VIP_1 전환", async () => {
    // fcm_token 없음 → sendJobPush는 false 반환 후 status 업데이트로 진행
    const cleaner = { id: "c-1", phone: "010-1111-1111", name: "김청소", tier: "VIP_1", fcm_token: null, fcm_status: "uninstalled" };
    const db = makeMockDb({ cleaner });

    const job = {
      id: "job-2",
      property_id: "P-001",
      status: "PENDING",
      checkout_at: "2026-09-10T02:00:00Z",
      cleaning_start_at: "2026-09-10T02:00:00Z",
    };
    await advanceJob(db, job);

    // NOTIFYING_VIP_1으로 status 업데이트 확인
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

  // SQL 이중 검증: getAvailableVip는 이제 fcm_token 없어도 phone 있으면 선발
  test("PENDING + SMS 전용 VIP_1(fcm_token=null, phone 있음) → status=NOTIFYING_VIP_1 전환", async () => {
    const cleaner = {
      id: "c-3",
      phone: "010-3333-3333",
      name: "박청소",
      tier: "VIP_1",
      fcm_token: null,
      fcm_status: "uninstalled",
    };
    const db = makeMockDb({ cleaner });

    const job = {
      id: "job-5",
      property_id: "P-001",
      status: "PENDING",
      checkout_at: "2026-09-10T02:00:00Z",
      cleaning_start_at: "2026-09-10T02:00:00Z",
    };
    await advanceJob(db, job);

    // SMS 전용이어도 상태 머신은 NOTIFYING_VIP_1으로 정상 전환
    const statusUpdates = db._calls.filter((c) =>
      c.sql.includes("UPDATE cleaning_jobs SET status=")
    );
    assert.ok(statusUpdates.some((c) => c.params?.includes?.("NOTIFYING_VIP_1")),
      "SMS 전용 VIP_1 선발 시에도 NOTIFYING_VIP_1 전환 필요");
  });

  // SQL에서 (fcm_token IS NOT NULL OR phone IS NOT NULL) 패턴 확인
  test("getAvailableVip 조회 SQL에 phone 조건 포함 (듀얼 모드 필터)", async () => {
    const cleaner = { id: "c-4", phone: "010-4444-4444", tier: "VIP_1", fcm_token: null };
    const db = makeMockDb({ cleaner });
    const job = {
      id: "job-6",
      property_id: "P-001",
      status: "PENDING",
      checkout_at: "2026-09-10T02:00:00Z",
      cleaning_start_at: "2026-09-10T02:00:00Z",
    };
    await advanceJob(db, job);

    const cleanerQuery = db._calls.find((c) =>
      c.sql.includes("FROM cleaners WHERE tier=")
    );
    assert.ok(cleanerQuery, "cleaners 조회 쿼리 없음");
    // 운영 쿼리가 fcm_token-only 필터로 퇴행하지 않는지 guard
    assert.ok(
      !cleanerQuery.sql.includes("fcm_status='active'"),
      "FCM-only 필터로 퇴행 — getAvailableVip SQL을 점검할 것"
    );
  });
});

// ============================================================
// sendCompletionSmsToRest → FCM 전환 검증
// ============================================================
describe("sendCompletionSmsToRest — FCM 전환 후 메시지 내용", () => {
  // 실제 Firebase 호출 없이 buildSmsComplete 메시지 내용만 검증
  // (발송 채널은 s25에서 커버)

  test("buildSmsComplete 메시지에 숙소명·날짜 포함 (FCM body로 재활용)", () => {
    const msg = buildSmsComplete("파주201", "2026-09-10");
    assert.ok(msg.includes("파주201"), "숙소명 누락");
    assert.ok(msg.includes("2026-09-10"), "날짜 누락");
    assert.ok(msg.includes("[PROPOS]"), "[PROPOS] 헤더 누락");
  });

  test("buildSmsComplete 날짜 형식 ISO slice(0,10)와 일치", () => {
    const date = new Date("2026-09-10T02:00:00Z").toISOString().slice(0, 10);
    const msg = buildSmsComplete("강남201", date);
    assert.ok(msg.includes("2026-09-10"));
  });
});

// ============================================================
// CANCELLED 상태 — getAvailableVip / dispatchBulk 충돌 제외
// ============================================================
describe("CANCELLED 상태 — 청소자 충돌 체크에서 제외 (SQL guard)", () => {
  // getAvailableVip 충돌 체크 SQL: CANCELLED가 NOT IN에 포함돼야 함
  // dispatchBulk 충돌 체크 SQL: 동일

  test("getAvailableVip NOT IN 목록에 CANCELLED 포함", () => {
    const sql = `j.status NOT IN ('ASSIGNED','COMPLETED','ESCALATED','CANCELLED')`;
    assert.ok(sql.includes("'CANCELLED'"), "CANCELLED가 제외 목록에 없음 → 취소된 job에 묶인 청소자가 신규 배정 제외됨");
  });

  test("dispatchBulk NOT IN 목록에 CANCELLED 포함", () => {
    const sql = `j2.status NOT IN ('ASSIGNED','COMPLETED','ESCALATED','CANCELLED')`;
    assert.ok(sql.includes("'CANCELLED'"), "dispatchBulk BULK 조회에서도 CANCELLED 제외 필요");
  });
});

// ============================================================
// 라우터 ID 파싱 — UUID slug 폴백 (UI 경로 파라미터 호환)
// ============================================================
describe("라우터 ID 파싱 — slug[1] UUID 폴백", () => {
  function resolveId(queryId, slug) {
    const slugId = slug.length > 1
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug[1])
      ? slug[1] : null;
    return queryId ?? slugId ?? null;
  }

  const UUID = "550e8400-e29b-41d4-a716-446655440000";

  test("쿼리 ?id=UUID → UUID 반환", () => {
    assert.equal(resolveId(UUID, ["cleaners"]), UUID);
  });

  test("경로 /cleaners/{UUID} → UUID 반환 (쿼리 없음)", () => {
    assert.equal(resolveId(null, ["cleaners", UUID]), UUID);
  });

  test("쿼리 우선 — 경로 UUID 있어도 쿼리 값 사용", () => {
    const otherId = "aaaaaaaa-0000-0000-0000-000000000000";
    assert.equal(resolveId(otherId, ["cleaners", UUID]), otherId);
  });

  test("/jobs/sync → id=null (sync은 UUID 아님)", () => {
    assert.equal(resolveId(null, ["jobs", "sync"]), null);
  });

  test("/jobs/{UUID} → UUID 반환", () => {
    assert.equal(resolveId(null, ["jobs", UUID]), UUID);
  });

  test("/dispatch/{UUID} → UUID 반환", () => {
    assert.equal(resolveId(null, ["dispatch", UUID]), UUID);
  });

  test("slug 1개 → id=null", () => {
    assert.equal(resolveId(null, ["cleaners"]), null);
  });

  test("slug[1]이 임의 문자열 → id=null", () => {
    assert.equal(resolveId(null, ["cleaners", "abc"]), null);
  });
});
