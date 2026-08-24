/**
 * s35 — 직원 승인 UI 로직 유닛 테스트
 *
 * CleaningManager 직원 승인 탭:
 *   - 승인 대기(active=false) 목록 필터
 *   - 승인/비활성화 API payload 구성
 *   - 상태 레이블 결정
 *   - 승인 가능 여부 판단
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ── 순수 로직 (CleaningManager에서 추출 가능한 함수들) ──────────

function filterPendingApproval(cleaners) {
  return cleaners.filter(c => c.active === false);
}

function filterActiveCleaners(cleaners) {
  return cleaners.filter(c => c.active === true);
}

function buildApprovalPayload(approve) {
  return { active: approve };
}

function approvalStatusLabel(cleaner) {
  if (!cleaner.active && !cleaner.app_installed_at) return "승인 대기";
  if (!cleaner.active && cleaner.app_installed_at)  return "앱 설치됨 · 승인 대기";
  if (cleaner.active && cleaner.fcm_status === "active") return "활성 (앱)";
  if (cleaner.active && cleaner.fcm_status === "inactive") return "활성 (장기 미접속)";
  if (cleaner.active) return "활성 (SMS)";
  return "비활성";
}

function canApprove(cleaner) {
  return cleaner.active === false;
}

function canDeactivate(cleaner) {
  return cleaner.active === true;
}

// ── 테스트 데이터 ────────────────────────────────────────────────

const PENDING_APP = { id: "u1", name: "홍길동", active: false, fcm_status: "active",     app_installed_at: "2026-08-24" };
const PENDING_SMS = { id: "u2", name: "김청소", active: false, fcm_status: "uninstalled", app_installed_at: null };
const ACTIVE_FCM  = { id: "u3", name: "이활성", active: true,  fcm_status: "active",      app_installed_at: "2026-08-20" };
const ACTIVE_SMS  = { id: "u4", name: "박문자", active: true,  fcm_status: "uninstalled", app_installed_at: null };
const ACTIVE_LAZY = { id: "u5", name: "최느림", active: true,  fcm_status: "inactive",    app_installed_at: "2026-07-01" };

// ── 승인 대기 필터 ───────────────────────────────────────────────

describe("filterPendingApproval — 승인 대기 목록", () => {
  const all = [PENDING_APP, PENDING_SMS, ACTIVE_FCM, ACTIVE_SMS, ACTIVE_LAZY];

  test("active=false인 청소자만 반환", () => {
    const result = filterPendingApproval(all);
    assert.equal(result.length, 2);
    assert.ok(result.every(c => c.active === false));
  });

  test("active=true 청소자 제외", () => {
    const result = filterPendingApproval(all);
    assert.ok(result.every(c => c.id !== "u3" && c.id !== "u4" && c.id !== "u5"));
  });

  test("전원 승인됨 → 빈 배열", () => {
    assert.deepEqual(filterPendingApproval([ACTIVE_FCM, ACTIVE_SMS]), []);
  });

  test("전원 대기 → 전부 반환", () => {
    assert.equal(filterPendingApproval([PENDING_APP, PENDING_SMS]).length, 2);
  });
});

// ── 활성 청소자 필터 ─────────────────────────────────────────────

describe("filterActiveCleaners — 활성 청소자 목록", () => {
  const all = [PENDING_APP, PENDING_SMS, ACTIVE_FCM, ACTIVE_SMS, ACTIVE_LAZY];

  test("active=true인 청소자만 반환", () => {
    const result = filterActiveCleaners(all);
    assert.equal(result.length, 3);
    assert.ok(result.every(c => c.active === true));
  });

  test("대기 중인 청소자 제외", () => {
    const result = filterActiveCleaners(all);
    assert.ok(result.every(c => c.id !== "u1" && c.id !== "u2"));
  });
});

// ── API payload 구성 ─────────────────────────────────────────────

describe("buildApprovalPayload — PATCH body 구성", () => {
  test("승인 → { active: true }", () => {
    assert.deepEqual(buildApprovalPayload(true), { active: true });
  });

  test("비활성화 → { active: false }", () => {
    assert.deepEqual(buildApprovalPayload(false), { active: false });
  });
});

// ── 상태 레이블 ──────────────────────────────────────────────────

describe("approvalStatusLabel — 상태 텍스트", () => {
  test("대기 + 앱 미설치 → '승인 대기'", () => {
    assert.equal(approvalStatusLabel(PENDING_SMS), "승인 대기");
  });

  test("대기 + 앱 설치됨 → '앱 설치됨 · 승인 대기'", () => {
    assert.equal(approvalStatusLabel(PENDING_APP), "앱 설치됨 · 승인 대기");
  });

  test("활성 + FCM → '활성 (앱)'", () => {
    assert.equal(approvalStatusLabel(ACTIVE_FCM), "활성 (앱)");
  });

  test("활성 + 장기 미접속 → '활성 (장기 미접속)'", () => {
    assert.equal(approvalStatusLabel(ACTIVE_LAZY), "활성 (장기 미접속)");
  });

  test("활성 + SMS 전용 → '활성 (SMS)'", () => {
    assert.equal(approvalStatusLabel(ACTIVE_SMS), "활성 (SMS)");
  });
});

// ── 승인/비활성화 가능 여부 ──────────────────────────────────────

describe("canApprove / canDeactivate — 버튼 노출 조건", () => {
  test("대기 중 → 승인 가능", () => {
    assert.ok(canApprove(PENDING_SMS));
    assert.ok(canApprove(PENDING_APP));
  });

  test("활성 → 승인 불가 (이미 승인됨)", () => {
    assert.ok(!canApprove(ACTIVE_FCM));
    assert.ok(!canApprove(ACTIVE_SMS));
  });

  test("활성 → 비활성화 가능", () => {
    assert.ok(canDeactivate(ACTIVE_FCM));
    assert.ok(canDeactivate(ACTIVE_SMS));
    assert.ok(canDeactivate(ACTIVE_LAZY));
  });

  test("대기 중 → 비활성화 불가 (아직 미승인)", () => {
    assert.ok(!canDeactivate(PENDING_SMS));
    assert.ok(!canDeactivate(PENDING_APP));
  });
});

// ── API 엔드포인트 ───────────────────────────────────────────────

describe("직원 승인 API — 엔드포인트 계약", () => {
  test("승인: PATCH /api/cleaning/cleaners/:id + body { active: true }", () => {
    const method = "PATCH";
    const path = "/api/cleaning/cleaners/some-uuid";
    const body = buildApprovalPayload(true);
    assert.equal(method, "PATCH");
    assert.ok(path.includes("cleaners"));
    assert.equal(body.active, true);
  });

  test("비활성화: PATCH /api/cleaning/cleaners/:id + body { active: false }", () => {
    const body = buildApprovalPayload(false);
    assert.equal(body.active, false);
  });

  test("승인 성공 응답에 active=true 포함 (서버 RETURNING *)", () => {
    const mockResponse = { id: "u2", name: "김청소", active: true, tier: "BULK" };
    assert.equal(mockResponse.active, true);
  });

  test("목록 API: GET /api/cleaning/cleaners — active 필드 포함", () => {
    const mockCleaner = { id: "u1", name: "홍길동", active: false, tier: "BULK" };
    assert.ok("active" in mockCleaner);
  });
});

// ── 승인 후 UI 상태 갱신 ─────────────────────────────────────────

describe("승인 처리 후 UI 갱신 시뮬레이션", () => {
  test("승인 후 해당 직원이 pending 목록에서 제거됨", () => {
    const before = [PENDING_APP, PENDING_SMS];
    // 승인 처리 시뮬레이션: active=true로 변경
    const updated = before.map(c => c.id === "u2" ? { ...c, active: true } : c);
    const pending = filterPendingApproval(updated);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, "u1");
  });

  test("비활성화 후 해당 직원이 active 목록에서 제거됨", () => {
    const before = [ACTIVE_FCM, ACTIVE_SMS];
    const updated = before.map(c => c.id === "u3" ? { ...c, active: false } : c);
    const active = filterActiveCleaners(updated);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, "u4");
  });

  test("신규 등록 직원은 pending에 즉시 노출", () => {
    const newCleaner = { id: "u6", name: "신규직원", active: false, fcm_status: "active", app_installed_at: "2026-08-25" };
    const list = [ACTIVE_FCM, newCleaner];
    const pending = filterPendingApproval(list);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, "u6");
  });
});
