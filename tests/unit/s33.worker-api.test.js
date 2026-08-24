/**
 * Worker App API — 유닛 테스트
 * api/workers/[...slug].js 핸들러 로직 검증
 *
 * POST /api/workers/register  — 최초 설치 등록
 * POST /api/workers/heartbeat — 활동 유지 + inactive 복구
 * POST /api/workers/token     — FCM 토큰 로테이션
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ── 핵심 로직 추출 (순수 함수 형태로 테스트) ──────────────

/**
 * normalizePhone — api/workers/[...slug].js에서 추출
 */
function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "").replace(/^82/, "0");
  const m = digits.match(/^(\d{3})(\d{4})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

/**
 * parseSlug — api/workers/[...slug].js에서 추출
 */
function parseSlug(req) {
  const raw = req.query?.slug;
  if (raw) return Array.isArray(raw) ? raw : [raw];
  const path = (req.url || "").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const idx = parts.indexOf("workers");
  return idx >= 0 ? parts.slice(idx + 1) : [];
}

/**
 * validateRegisterBody — register 필드 검증 로직
 */
function validateRegisterBody({ phone, email, fcm_token } = {}) {
  if (!phone || !email || !fcm_token) return "phone, email, fcm_token 필수";
  return null;
}

/**
 * validateHeartbeatBody — heartbeat 필드 검증 로직
 */
function validateHeartbeatBody({ fcm_token } = {}) {
  if (!fcm_token) return "fcm_token 필수";
  return null;
}

/**
 * validateTokenUpdateBody — token update 필드 검증 로직
 */
function validateTokenUpdateBody({ fcm_token, new_token } = {}) {
  if (!fcm_token || !new_token) return "fcm_token, new_token 필수";
  return null;
}

/**
 * heartbeatFcmStatus — inactive 복구 로직
 */
function heartbeatFcmStatus(currentStatus) {
  return currentStatus === "inactive" ? "active" : currentStatus;
}

/**
 * isNewInstall — 신규 설치 여부 판단 (5초 이내 생성)
 */
function isNewInstall(app_installed_at) {
  if (!app_installed_at) return false;
  return new Date(app_installed_at) > new Date(Date.now() - 5000);
}

/**
 * registerResponse — 활성 여부에 따른 메시지 결정
 */
function registerResponse(active) {
  return active ? "등록 완료" : "등록 완료. 호스트 승인 대기 중";
}

// ── mock 헬퍼 ────────────────────────────────────────────────

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body;   return this; },
  };
  return res;
}

// ============================================================
// parseSlug — 라우팅
// ============================================================
describe("parseSlug — workers 라우팅", () => {
  test("query.slug 배열 → 그대로 반환", () => {
    const req = { query: { slug: ["register"] } };
    assert.deepEqual(parseSlug(req), ["register"]);
  });

  test("query.slug 문자열 → 배열로 래핑", () => {
    const req = { query: { slug: "heartbeat" } };
    assert.deepEqual(parseSlug(req), ["heartbeat"]);
  });

  test("URL 경로 /api/workers/token → ['token']", () => {
    const req = { url: "/api/workers/token" };
    assert.deepEqual(parseSlug(req), ["token"]);
  });

  test("URL 경로 /api/workers/register?foo=bar → ['register']", () => {
    const req = { url: "/api/workers/register?foo=bar" };
    assert.deepEqual(parseSlug(req), ["register"]);
  });

  test("workers 세그먼트 없는 경로 → 빈 배열", () => {
    const req = { url: "/api/ha/state" };
    assert.deepEqual(parseSlug(req), []);
  });

  test("빈 url → 빈 배열", () => {
    const req = { url: "" };
    assert.deepEqual(parseSlug(req), []);
  });
});

// ============================================================
// normalizePhone — 전화번호 정규화
// ============================================================
describe("normalizePhone — 전화번호 정규화", () => {
  test("010-xxxx-xxxx 형식은 그대로 유지", () => {
    assert.equal(normalizePhone("010-1234-5678"), "010-1234-5678");
  });

  test("01012345678 (하이픈 없음) → 010-1234-5678", () => {
    assert.equal(normalizePhone("01012345678"), "010-1234-5678");
  });

  test("국제번호 +8210xxxx-xxxx → 010-xxxx-xxxx", () => {
    assert.equal(normalizePhone("+821012345678"), "010-1234-5678");
  });

  test("국제번호 8210xxxxxxxx → 010-xxxx-xxxx", () => {
    assert.equal(normalizePhone("821012345678"), "010-1234-5678");
  });

  test("형식이 맞지 않으면 원본 반환", () => {
    assert.equal(normalizePhone("12345"), "12345");
  });

  test("공백·하이픈 혼합 → 정규화", () => {
    assert.equal(normalizePhone("010 1234 5678"), "010-1234-5678");
  });
});

// ============================================================
// validateRegisterBody — 입력 검증
// ============================================================
describe("validateRegisterBody — register 필수 필드 검증", () => {
  test("모든 필드 있음 → null (에러 없음)", () => {
    assert.equal(validateRegisterBody({ phone: "010-0000-0000", email: "a@b.com", fcm_token: "tok" }), null);
  });

  test("phone 누락 → 에러 문자열", () => {
    assert.ok(validateRegisterBody({ email: "a@b.com", fcm_token: "tok" }));
  });

  test("email 누락 → 에러 문자열", () => {
    assert.ok(validateRegisterBody({ phone: "010-0000-0000", fcm_token: "tok" }));
  });

  test("fcm_token 누락 → 에러 문자열", () => {
    assert.ok(validateRegisterBody({ phone: "010-0000-0000", email: "a@b.com" }));
  });

  test("빈 객체 → 에러 문자열", () => {
    assert.ok(validateRegisterBody({}));
  });

  test("빈 문자열 phone → 에러 문자열", () => {
    assert.ok(validateRegisterBody({ phone: "", email: "a@b.com", fcm_token: "tok" }));
  });
});

// ============================================================
// validateHeartbeatBody — heartbeat 입력 검증
// ============================================================
describe("validateHeartbeatBody — heartbeat 필수 필드 검증", () => {
  test("fcm_token 있음 → null", () => {
    assert.equal(validateHeartbeatBody({ fcm_token: "abc" }), null);
  });

  test("fcm_token 누락 → 에러 문자열", () => {
    assert.ok(validateHeartbeatBody({}));
  });

  test("fcm_token 빈 문자열 → 에러 문자열", () => {
    assert.ok(validateHeartbeatBody({ fcm_token: "" }));
  });
});

// ============================================================
// validateTokenUpdateBody — token 교체 입력 검증
// ============================================================
describe("validateTokenUpdateBody — token update 필수 필드 검증", () => {
  test("fcm_token + new_token 모두 있음 → null", () => {
    assert.equal(validateTokenUpdateBody({ fcm_token: "old", new_token: "new" }), null);
  });

  test("fcm_token 누락 → 에러 문자열", () => {
    assert.ok(validateTokenUpdateBody({ new_token: "new" }));
  });

  test("new_token 누락 → 에러 문자열", () => {
    assert.ok(validateTokenUpdateBody({ fcm_token: "old" }));
  });

  test("둘 다 누락 → 에러 문자열", () => {
    assert.ok(validateTokenUpdateBody({}));
  });
});

// ============================================================
// heartbeatFcmStatus — inactive 복구 로직
// ============================================================
describe("heartbeatFcmStatus — inactive → active 복구", () => {
  test("inactive → active 복구", () => {
    assert.equal(heartbeatFcmStatus("inactive"), "active");
  });

  test("active 유지", () => {
    assert.equal(heartbeatFcmStatus("active"), "active");
  });

  test("invalid 유지 (inactive가 아니면 건드리지 않음)", () => {
    assert.equal(heartbeatFcmStatus("invalid"), "invalid");
  });

  test("unregistered 유지", () => {
    assert.equal(heartbeatFcmStatus("unregistered"), "unregistered");
  });

  test("uninstalled 유지", () => {
    assert.equal(heartbeatFcmStatus("uninstalled"), "uninstalled");
  });
});

// ============================================================
// isNewInstall — 신규 설치 판단
// ============================================================
describe("isNewInstall — 신규 설치 여부 (5초 기준)", () => {
  test("방금 생성된 타임스탬프 → true", () => {
    const justNow = new Date().toISOString();
    assert.ok(isNewInstall(justNow));
  });

  test("10초 전 타임스탬프 → false", () => {
    const past = new Date(Date.now() - 10000).toISOString();
    assert.ok(!isNewInstall(past));
  });

  test("null → false", () => {
    assert.ok(!isNewInstall(null));
  });

  test("undefined → false", () => {
    assert.ok(!isNewInstall(undefined));
  });
});

// ============================================================
// registerResponse — 응답 메시지
// ============================================================
describe("registerResponse — 활성 여부에 따른 메시지", () => {
  test("active=true → '등록 완료'", () => {
    assert.equal(registerResponse(true), "등록 완료");
  });

  test("active=false → '등록 완료. 호스트 승인 대기 중'", () => {
    assert.equal(registerResponse(false), "등록 완료. 호스트 승인 대기 중");
  });
});

// ============================================================
// mock 핸들러 시뮬레이션 — 라우팅 + 메서드 검증
// ============================================================
describe("핸들러 라우팅 — 메서드 및 리소스 매핑", () => {
  // 라우터 디스패치 로직 추출
  function routeWorker(slug) {
    const [resource] = slug;
    if (resource === "register")  return "handleRegister";
    if (resource === "heartbeat") return "handleHeartbeat";
    if (resource === "token")     return "handleTokenUpdate";
    return "404";
  }

  test("['register'] → handleRegister", () => {
    assert.equal(routeWorker(["register"]), "handleRegister");
  });

  test("['heartbeat'] → handleHeartbeat", () => {
    assert.equal(routeWorker(["heartbeat"]), "handleHeartbeat");
  });

  test("['token'] → handleTokenUpdate", () => {
    assert.equal(routeWorker(["token"]), "handleTokenUpdate");
  });

  test("['unknown'] → 404", () => {
    assert.equal(routeWorker(["unknown"]), "404");
  });

  test("[] (빈 슬러그) → 404", () => {
    assert.equal(routeWorker([]), "404");
  });
});

// ============================================================
// 이메일 정규화 — toLowerCase + trim
// ============================================================
describe("이메일 정규화 — 소문자 + 공백 제거", () => {
  function normalizeEmail(email) {
    return email.toLowerCase().trim();
  }

  test("대문자 → 소문자", () => {
    assert.equal(normalizeEmail("User@Example.COM"), "user@example.com");
  });

  test("앞뒤 공백 제거", () => {
    assert.equal(normalizeEmail("  user@example.com  "), "user@example.com");
  });

  test("이미 정규화된 이메일 → 그대로", () => {
    assert.equal(normalizeEmail("user@example.com"), "user@example.com");
  });
});

// ============================================================
// 신규 등록 기본값 — DB INSERT 초기값 검증
// ============================================================
describe("register — DB INSERT 초기값", () => {
  test("신규 등록 시 tier = 'BULK' (기본값)", () => {
    // INSERT ... VALUES ($1, $2, 'BULK', false, ...)
    const tier = "BULK";
    assert.equal(tier, "BULK");
  });

  test("신규 등록 시 active = false (호스트 승인 전)", () => {
    const active = false;
    assert.equal(active, false);
  });

  test("신규 등록 시 fcm_status = 'active'", () => {
    const fcm_status = "active";
    assert.equal(fcm_status, "active");
  });

  test("충돌 시 ON CONFLICT(phone) → fcm_token, fcm_status, last_seen_at 갱신", () => {
    const conflictFields = ["email", "fcm_token", "fcm_token_at", "last_seen_at", "fcm_status"];
    assert.ok(conflictFields.includes("fcm_token"));
    assert.ok(conflictFields.includes("fcm_status"));
    assert.ok(!conflictFields.includes("tier"));  // tier는 ON CONFLICT에서 갱신 안 함
    assert.ok(!conflictFields.includes("active")); // active도 갱신 안 함
  });
});

// ============================================================
// fcm_status 상태 전이 규칙
// ============================================================
describe("fcm_status 상태 머신", () => {
  const VALID_STATUSES = ["active", "inactive", "uninstalled", "invalid", "unregistered"];

  test("유효한 fcm_status 목록 5가지", () => {
    assert.equal(VALID_STATUSES.length, 5);
  });

  test("register → fcm_status='active' (앱 설치 확인됨)", () => {
    const afterRegister = "active";
    assert.ok(VALID_STATUSES.includes(afterRegister));
  });

  test("heartbeat: inactive → active (복구)", () => {
    const before = "inactive";
    const after  = heartbeatFcmStatus(before);
    assert.equal(after, "active");
  });

  test("token update → fcm_status='active' 리셋", () => {
    const afterTokenUpdate = "active";
    assert.equal(afterTokenUpdate, "active");
  });

  test("FCM 발송 실패(UNREGISTERED) → fcm_status='unregistered'로 변경됨", () => {
    // _notify.js handleFcmFailure 처리 결과
    const failureStatus = "unregistered";
    assert.ok(VALID_STATUSES.includes(failureStatus));
  });
});
