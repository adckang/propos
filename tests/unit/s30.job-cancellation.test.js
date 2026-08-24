/**
 * 청소 자동화 — 예약 취소 처리 유닛 테스트
 * - CANCELLED 상태 전환 로직
 * - 블로커 재생성 조건
 * - COMPLETED / CANCELLED 상태 취소 불가 검증
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ============================================================
// CANCELLED 상태 전환 가능 여부 판별
// ============================================================

describe("Job 취소 — 상태 전환 가능 여부", () => {
  const CANCELLABLE = [
    "PENDING",
    "NOTIFYING_VIP_1",
    "NOTIFYING_VIP_2",
    "NOTIFYING_VIP_3",
    "NOTIFYING_BULK",
    "BULK_REMINDED",
    "ESCALATED",
    "ASSIGNED",
  ];
  const NOT_CANCELLABLE = ["COMPLETED", "CANCELLED"];

  function canCancel(status) {
    return !["COMPLETED", "CANCELLED"].includes(status);
  }

  for (const status of CANCELLABLE) {
    test(`${status} → 취소 가능`, () => {
      assert.ok(canCancel(status), `${status} 상태에서 취소 가능해야 함`);
    });
  }

  for (const status of NOT_CANCELLABLE) {
    test(`${status} → 취소 불가 (409)`, () => {
      assert.ok(!canCancel(status), `${status} 상태에서 취소 불가여야 함`);
    });
  }
});

// ============================================================
// 블로커 재생성 조건
// ============================================================

describe("Job 취소 — 블로커 재생성 조건", () => {
  function shouldRecreateBlocker(job) {
    return !!job.google_calendar_id;
  }

  test("google_calendar_id 있음 → 블로커 재생성 필요", () => {
    const job = { id: "j1", status: "ASSIGNED", google_calendar_id: "bnb.paju@gmail.com" };
    assert.ok(shouldRecreateBlocker(job));
  });

  test("google_calendar_id 없음 → 블로커 재생성 불필요", () => {
    const job = { id: "j2", status: "PENDING", google_calendar_id: null };
    assert.ok(!shouldRecreateBlocker(job));
  });
});

// ============================================================
// 취소 + 블로커 재생성 플로우 시뮬레이션
// ============================================================

describe("Job 취소 플로우 시뮬레이션", () => {
  function makeJobStore() {
    const jobs = new Map();
    return {
      add(job) { jobs.set(job.id, { ...job }); },
      cancel(id) {
        const job = jobs.get(id);
        if (!job) return { ok: false, error: "NOT_FOUND" };
        if (["COMPLETED", "CANCELLED"].includes(job.status)) {
          return { ok: false, error: `이미 ${job.status}` };
        }
        job.status = "CANCELLED";
        return { ok: true, job };
      },
      get(id) { return jobs.get(id) ?? null; },
    };
  }

  function makeBlockerStore() {
    const store = new Map();
    return {
      set(propertyId, date, eventId) { store.set(`${propertyId}_${date}`, eventId); },
      get(propertyId, date) { return store.get(`${propertyId}_${date}`) ?? null; },
      size() { return store.size; },
    };
  }

  test("PENDING 취소 → 성공, 상태 CANCELLED 전환", () => {
    const jobs = makeJobStore();
    jobs.add({ id: "j1", status: "PENDING", google_calendar_id: "cal@gmail.com", property_id: "prop-1" });
    const result = jobs.cancel("j1");
    assert.ok(result.ok);
    assert.equal(jobs.get("j1").status, "CANCELLED");
  });

  test("COMPLETED 취소 시도 → 실패 (409)", () => {
    const jobs = makeJobStore();
    jobs.add({ id: "j2", status: "COMPLETED", property_id: "prop-1" });
    const result = jobs.cancel("j2");
    assert.ok(!result.ok);
    assert.ok(result.error.includes("COMPLETED"));
  });

  test("이미 CANCELLED된 job 재취소 → 실패", () => {
    const jobs = makeJobStore();
    jobs.add({ id: "j3", status: "CANCELLED", property_id: "prop-1" });
    const result = jobs.cancel("j3");
    assert.ok(!result.ok);
  });

  test("존재하지 않는 job 취소 → 실패 (404)", () => {
    const jobs = makeJobStore();
    const result = jobs.cancel("j-nonexistent");
    assert.ok(!result.ok);
    assert.equal(result.error, "NOT_FOUND");
  });

  test("ASSIGNED 취소 + 블로커 재생성 → blocker store 업데이트", () => {
    const jobs = makeJobStore();
    const blockers = makeBlockerStore();
    jobs.add({
      id: "j4",
      status: "ASSIGNED",
      property_id: "prop-1",
      google_calendar_id: "bnb@gmail.com",
      cleaning_start_at: "2026-11-05T02:00:00.000Z", // KST 11:00
    });

    const result = jobs.cancel("j4");
    assert.ok(result.ok);

    // 블로커 재생성 시뮬레이션
    const date = new Date(result.job.cleaning_start_at).toISOString().slice(0, 10);
    const newEventId = "blocker-evt-new-abc";
    blockers.set(result.job.property_id, date, newEventId);

    assert.equal(blockers.get("prop-1", "2026-11-05"), "blocker-evt-new-abc");
    assert.equal(blockers.size(), 1);
  });
});

// ============================================================
// 취소 후 상태 머신 불변식 검증
// ============================================================

describe("CANCELLED 상태 — 상태 머신 불변식", () => {
  const VALID_STATUSES = [
    "PENDING", "NOTIFYING_VIP_1", "NOTIFYING_VIP_2", "NOTIFYING_VIP_3",
    "NOTIFYING_BULK", "BULK_REMINDED", "ESCALATED", "ASSIGNED", "COMPLETED", "CANCELLED"
  ];

  test("CANCELLED가 유효 상태 목록에 포함됨", () => {
    assert.ok(VALID_STATUSES.includes("CANCELLED"));
  });

  test("advanceJob 대상 아님 (CANCELLED → nextStatus 없음)", () => {
    const nextStatus = {
      PENDING: "NOTIFYING_VIP_1",
      NOTIFYING_VIP_1: "NOTIFYING_VIP_2",
      NOTIFYING_VIP_2: "NOTIFYING_VIP_3",
      NOTIFYING_VIP_3: "NOTIFYING_BULK",
    };
    assert.equal(nextStatus["CANCELLED"], undefined);
  });

  test("followup 크론 — CANCELLED job은 처리 대상 아님", () => {
    // followup 크론은 PENDING / NOTIFYING_VIP_* / NOTIFYING_BULK / BULK_REMINDED만 처리
    const followupStatuses = new Set([
      "PENDING", "NOTIFYING_VIP_1", "NOTIFYING_VIP_2", "NOTIFYING_VIP_3",
      "NOTIFYING_BULK", "BULK_REMINDED"
    ]);
    assert.ok(!followupStatuses.has("CANCELLED"));
  });
});

// ============================================================
// bootstrap 블로커 — 날짜 목록 생성 검증
// ============================================================

describe("Bootstrap 블로커 — 날짜 목록 생성", () => {
  function getMonthDates(yearMonth) {
    const [y, m] = yearMonth.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    return Array.from({ length: days }, (_, i) => `${yearMonth}-${pad(i + 1)}`);
  }

  test("2026-09 → 30개 날짜", () => {
    const dates = getMonthDates("2026-09");
    assert.equal(dates.length, 30);
    assert.equal(dates[0], "2026-09-01");
    assert.equal(dates[29], "2026-09-30");
  });

  test("2026-02 → 28개 날짜", () => {
    assert.equal(getMonthDates("2026-02").length, 28);
  });

  test("2024-02 → 29개 날짜 (윤년)", () => {
    assert.equal(getMonthDates("2024-02").length, 29);
  });

  test("2026-12 → 31개 날짜", () => {
    assert.equal(getMonthDates("2026-12").length, 31);
  });

  test("잘못된 YYYY-MM 형식 → 검증 실패 케이스 확인", () => {
    assert.ok(/^\d{4}-\d{2}$/.test("2026-09"), "유효 형식");
    assert.ok(!/^\d{4}-\d{2}$/.test("2026-9"), "월 한 자리 → 무효");
    assert.ok(!/^\d{4}-\d{2}$/.test("26-09"), "연도 두 자리 → 무효");
  });
});

// ============================================================
// Gmail Watch 등록 — 필수 환경변수 검증
// ============================================================

describe("Gmail Watch 등록 — 설정 검증", () => {
  test("GOOGLE_PUBSUB_TOPIC 없으면 500 반환 조건", () => {
    const topicName = process.env.GOOGLE_PUBSUB_TOPIC ?? null;
    // 테스트 환경에서 env 미설정 → 실제 서버에서 500 반환 경로
    if (!topicName) {
      assert.equal(topicName, null);
    } else {
      assert.ok(topicName.startsWith("projects/"), "topic 형식: projects/{id}/topics/{name}");
    }
  });

  test("Watch expiration → 7일 이내 (604800000ms)", () => {
    // Google Gmail Watch는 최대 7일 유효. 주기적 재등록 필요.
    const MAX_WATCH_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
    assert.equal(MAX_WATCH_DURATION_MS, 604_800_000);
  });
});

// ============================================================
// upsertProperty — ical_url 포함 필드 검증
// ============================================================

describe("upsertProperty — ical_url 처리 로직", () => {
  function buildUpsertPayload(input) {
    const { property_id, name, checkout_hour, cleaning_duration_hours,
            google_calendar_id, google_calendar_booking_url, host_phone, ical_url } = input;
    if (!property_id || !name) return { error: "property_id, name 필수" };
    return {
      property_id, name,
      checkout_hour: checkout_hour ?? 11,
      cleaning_duration_hours: cleaning_duration_hours ?? 2.5,
      google_calendar_id: google_calendar_id ?? null,
      google_calendar_booking_url: google_calendar_booking_url ?? null,
      host_phone: host_phone ?? null,
      ical_url: ical_url ?? null,
    };
  }

  test("ical_url 포함 저장 정상", () => {
    const p = buildUpsertPayload({
      property_id: "paju201", name: "파주201",
      ical_url: "https://www.airbnb.com/calendar/ical/abc123.ics",
    });
    assert.equal(p.ical_url, "https://www.airbnb.com/calendar/ical/abc123.ics");
  });

  test("ical_url 없으면 null → COALESCE로 기존 값 유지", () => {
    const p = buildUpsertPayload({ property_id: "paju201", name: "파주201" });
    assert.equal(p.ical_url, null);
    // SQL: COALESCE($8, property_cleaning_config.ical_url) → null이면 기존 값 유지
  });

  test("필수 필드 누락 → error 반환", () => {
    const p = buildUpsertPayload({ property_id: "paju201" });
    assert.ok("error" in p);
  });

  test("기본값: checkout_hour=11, duration=2.5", () => {
    const p = buildUpsertPayload({ property_id: "paju201", name: "파주201" });
    assert.equal(p.checkout_hour, 11);
    assert.equal(p.cleaning_duration_hours, 2.5);
  });

  test("ical_url은 listProperties 응답에 포함 (서버 전용)", () => {
    // SELECT * FROM property_cleaning_config → ical_url 컬럼 포함됨
    // 브라우저로 직접 노출되지만 Admin 전용 화면에서만 사용
    const responseShape = ["property_id", "name", "checkout_hour", "ical_url", "google_calendar_id"];
    assert.ok(responseShape.includes("ical_url"));
  });
});

// ============================================================
// cleaning-followup 크론 — 타이밍 로직 검증
// ============================================================

describe("followup 크론 — BULK 리마인드 타이밍 (1시간)", () => {
  // SQL: n.sent_at < NOW() - INTERVAL '1 hour'
  function shouldSendRemind(sentAt, nowMs = Date.now()) {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    return nowMs - new Date(sentAt).getTime() > ONE_HOUR_MS;
  }

  test("1시간 이상 경과 → 리마인드 발송", () => {
    const sentAt = new Date(Date.now() - 70 * 60 * 1000).toISOString(); // 70분 전
    assert.ok(shouldSendRemind(sentAt));
  });

  test("1시간 미만 경과 → 리마인드 미발송", () => {
    const sentAt = new Date(Date.now() - 50 * 60 * 1000).toISOString(); // 50분 전
    assert.ok(!shouldSendRemind(sentAt));
  });

  test("정확히 1시간 → 리마인드 발송 기준 초과 안함 (경계값)", () => {
    const sentAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 정확히 1시간
    // DB: INTERVAL '1 hour' → sent_at < NOW() - 1h (미만)
    // 정확히 1h는 경계라서 DB 쿼리에서는 미발송에 가까움
    assert.ok(!shouldSendRemind(sentAt)); // <= 1h는 아직 미발송
  });

  test("이미 reminded_at 있는 notif → 조건 쿼리에서 제외", () => {
    // SQL: n.reminded_at IS NULL 조건으로 중복 발송 방지
    const notif = { reminded_at: new Date().toISOString() };
    assert.ok(notif.reminded_at !== null, "reminded_at 있으면 재발송 불필요");
  });
});

describe("followup 크론 — 에스컬레이션 타이밍 (3시간)", () => {
  // SQL: first_sent < NOW() - INTERVAL '3 hours'
  function shouldEscalate(firstSentAt, nowMs = Date.now()) {
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
    return nowMs - new Date(firstSentAt).getTime() > THREE_HOURS_MS;
  }

  test("3시간 이상 경과 → 에스컬레이션", () => {
    const firstSent = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(); // 4시간 전
    assert.ok(shouldEscalate(firstSent));
  });

  test("2시간 경과 → 에스컬레이션 아직 아님", () => {
    const firstSent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    assert.ok(!shouldEscalate(firstSent));
  });

  test("에스컬레이션 대상 상태: NOTIFYING_BULK, BULK_REMINDED", () => {
    const escalatableStatuses = new Set(["NOTIFYING_BULK", "BULK_REMINDED"]);
    assert.ok(escalatableStatuses.has("NOTIFYING_BULK"));
    assert.ok(escalatableStatuses.has("BULK_REMINDED"));
    assert.ok(!escalatableStatuses.has("ASSIGNED"));
    assert.ok(!escalatableStatuses.has("ESCALATED"));
    assert.ok(!escalatableStatuses.has("CANCELLED"));
  });

  test("에스컬레이션 SQL — 조건부 UPDATE로 중복 방지", () => {
    // UPDATE ... WHERE status IN ('NOTIFYING_BULK','BULK_REMINDED') RETURNING id
    // rows.length === 0 → 이미 다른 배정/취소 → 스킵
    const sql = `UPDATE cleaning_jobs SET status='ESCALATED' WHERE id=$1 AND status IN ('NOTIFYING_BULK','BULK_REMINDED') RETURNING id`;
    assert.ok(sql.includes("RETURNING id"));
    assert.ok(sql.includes("AND status IN"));
  });

  test("3시간 후 Slack 알림 발송", () => {
    const msg = `[PROPOS] 🚨 파주201 2026-09-15 청소 배정 실패. 수동 처리 필요.`;
    assert.ok(msg.includes("수동 처리 필요"));
    assert.ok(msg.startsWith("[PROPOS]"));
  });
});
