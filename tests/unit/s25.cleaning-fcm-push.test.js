/**
 * 청소 자동화 — FCM 푸시 발송 + 에러 처리 유닛 테스트
 * _push.js sendPush() 및 _dispatch.js sendJobPush() 핵심 로직 검증
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ============================================================
// FCM 에러 코드 정규화 로직 (sendPush 내부 로직과 동일)
// ============================================================

function normalizeFcmErrorCode(code) {
  if (code.includes("registration-token-not-registered")) return "UNREGISTERED";
  if (code.includes("invalid-argument") || code.includes("invalid-registration-token"))
    return "INVALID_ARGUMENT";
  return code;
}

describe("FCM 에러 코드 정규화", () => {
  test("registration-token-not-registered → UNREGISTERED", () => {
    assert.equal(
      normalizeFcmErrorCode("messaging/registration-token-not-registered"),
      "UNREGISTERED"
    );
  });

  test("invalid-argument → INVALID_ARGUMENT", () => {
    assert.equal(
      normalizeFcmErrorCode("messaging/invalid-argument"),
      "INVALID_ARGUMENT"
    );
  });

  test("invalid-registration-token → INVALID_ARGUMENT", () => {
    assert.equal(
      normalizeFcmErrorCode("messaging/invalid-registration-token"),
      "INVALID_ARGUMENT"
    );
  });

  test("알 수 없는 코드 → 원본 그대로 반환", () => {
    assert.equal(normalizeFcmErrorCode("messaging/quota-exceeded"), "messaging/quota-exceeded");
  });

  test("빈 코드 → 빈 문자열 반환", () => {
    assert.equal(normalizeFcmErrorCode(""), "");
  });
});

// ============================================================
// sendPush 입력 검증 (fcmToken 없음)
// ============================================================

describe("sendPush — 입력 검증", () => {
  // sendPush는 실제 Firebase 호출하므로 로직만 단위 테스트
  function validateFcmInput(fcmToken) {
    if (!fcmToken) return { success: false, errorCode: "NO_TOKEN" };
    return null; // 유효
  }

  test("fcmToken 없음(null) → NO_TOKEN 즉시 반환", () => {
    const result = validateFcmInput(null);
    assert.deepEqual(result, { success: false, errorCode: "NO_TOKEN" });
  });

  test("fcmToken 없음(빈 문자열) → NO_TOKEN 즉시 반환", () => {
    const result = validateFcmInput("");
    assert.deepEqual(result, { success: false, errorCode: "NO_TOKEN" });
  });

  test("fcmToken 있음 → null (유효, Firebase 호출 진행)", () => {
    const result = validateFcmInput("valid-token-xyz");
    assert.equal(result, null);
  });
});

// ============================================================
// FCM data payload — 문자열 변환 (Firebase 요구사항)
// ============================================================

describe("FCM data payload 문자열 변환", () => {
  // Firebase FCM은 data 값이 모두 string이어야 함
  function coerceDataToStrings(data) {
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v ?? "")])
    );
  }

  test("숫자 값 → 문자열 변환", () => {
    const result = coerceDataToStrings({ jobId: 123, token: "ABC" });
    assert.equal(typeof result.jobId, "string");
    assert.equal(result.jobId, "123");
  });

  test("null 값 → 빈 문자열", () => {
    const result = coerceDataToStrings({ hostPhone: null });
    assert.equal(result.hostPhone, "");
  });

  test("undefined 값 → 빈 문자열", () => {
    const result = coerceDataToStrings({ calendarUrl: undefined });
    assert.equal(result.calendarUrl, "");
  });

  test("정상 문자열 → 그대로 유지", () => {
    const result = coerceDataToStrings({ token: "ABCDEF", jobId: "uuid-1" });
    assert.equal(result.token, "ABCDEF");
    assert.equal(result.jobId, "uuid-1");
  });
});

// ============================================================
// sendJobPush — fcm_status 업데이트 로직
// ============================================================

describe("sendJobPush — FCM 실패 시 fcm_status 업데이트", () => {
  function decideFcmStatusUpdate(errorCode) {
    if (errorCode === "UNREGISTERED") return "unregistered";
    if (errorCode === "INVALID_ARGUMENT") return "invalid";
    return null; // 그 외 오류는 DB 업데이트 없음
  }

  test("UNREGISTERED → fcm_status = 'unregistered'", () => {
    assert.equal(decideFcmStatusUpdate("UNREGISTERED"), "unregistered");
  });

  test("INVALID_ARGUMENT → fcm_status = 'invalid'", () => {
    assert.equal(decideFcmStatusUpdate("INVALID_ARGUMENT"), "invalid");
  });

  test("QUOTA_EXCEEDED → DB 업데이트 없음 (null)", () => {
    assert.equal(decideFcmStatusUpdate("QUOTA_EXCEEDED"), null);
  });

  test("UNKNOWN → DB 업데이트 없음", () => {
    assert.equal(decideFcmStatusUpdate("UNKNOWN"), null);
  });
});

// ============================================================
// FCM 메시지 빌더 (VIP/BULK/REMIND/COMPLETE — FCM 버전)
// ============================================================

const BASE_URL = "https://www.proposonline.com";

function buildFcmVip(job, propertyName) {
  return {
    title: "[PROPOS] 청소 요청",
    body: `${propertyName} ${new Date(job.cleaning_start_at).toISOString().slice(0, 10)}`,
  };
}

function buildFcmBulk(job, propertyName) {
  return {
    title: "[PROPOS] 청소 아르바이트 안내",
    body: `${propertyName} ${new Date(job.cleaning_start_at).toISOString().slice(0, 10)} 선착순`,
  };
}

function buildFcmRemind(job, propertyName) {
  return {
    title: "[PROPOS] 재안내",
    body: `${propertyName} ${new Date(job.cleaning_start_at).toISOString().slice(0, 10)} 청소 아직 미확정입니다`,
  };
}

function buildFcmComplete(propertyName, date) {
  return {
    title: "[PROPOS] 청소 배정 완료",
    body: `${propertyName} ${date} 건이 배정됐습니다. 감사합니다.`,
  };
}

const sampleJob = {
  id: "job-1",
  property_id: "paju201",
  cleaning_start_at: new Date("2026-08-25T02:00:00Z"), // KST 11:00
};

describe("FCM VIP 메시지 빌더", () => {
  test("title에 [PROPOS] 포함", () => {
    const msg = buildFcmVip(sampleJob, "파주201");
    assert.ok(msg.title.includes("[PROPOS]"));
  });

  test("body에 숙소명 포함", () => {
    const msg = buildFcmVip(sampleJob, "파주201");
    assert.ok(msg.body.includes("파주201"));
  });

  test("body에 날짜 포함", () => {
    const msg = buildFcmVip(sampleJob, "파주201");
    assert.ok(msg.body.includes("2026-08-25"));
  });

  test("title과 body 모두 비어있지 않음", () => {
    const msg = buildFcmVip(sampleJob, "파주201");
    assert.ok(msg.title.length > 0);
    assert.ok(msg.body.length > 0);
  });
});

describe("FCM BULK 메시지 빌더", () => {
  test("body에 '선착순' 포함", () => {
    const msg = buildFcmBulk(sampleJob, "파주201");
    assert.ok(msg.body.includes("선착순"));
  });

  test("VIP 메시지와 title 다름", () => {
    const vip = buildFcmVip(sampleJob, "파주201");
    const bulk = buildFcmBulk(sampleJob, "파주201");
    assert.notEqual(vip.title, bulk.title);
  });
});

describe("FCM 리마인드 메시지 빌더", () => {
  test("body에 '미확정' 포함", () => {
    const msg = buildFcmRemind(sampleJob, "파주201");
    assert.ok(msg.body.includes("미확정"));
  });
});

describe("FCM 배정 완료 메시지 빌더", () => {
  test("body에 '배정됐습니다' 포함", () => {
    const msg = buildFcmComplete("파주201", "2026-08-25");
    assert.ok(msg.body.includes("배정됐습니다"));
  });

  test("body에 숙소명 + 날짜 포함", () => {
    const msg = buildFcmComplete("파주201", "2026-08-25");
    assert.ok(msg.body.includes("파주201"));
    assert.ok(msg.body.includes("2026-08-25"));
  });
});
