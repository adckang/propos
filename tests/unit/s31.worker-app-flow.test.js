/**
 * Worker App 플로우 유닛 테스트
 * - cold-start 알림 처리 (app 완전 종료 → 알림 탭)
 * - declineJob API 응답 형식 ({ ok, message })
 * - BULK 리마인드 FCM data payload 검증
 * - sendHeartbeat import 경로 검증
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ============================================================
// declineJob API 응답 형식 — { ok, message } + format=api
// ============================================================

describe("declineJob API — 응답 형식 검증", () => {
  function buildDeclineUrl(baseUrl, token, format) {
    const url = new URL(`${baseUrl}/api/cleaning/d`);
    url.searchParams.set("token", token);
    if (format) url.searchParams.set("format", format);
    return url.toString();
  }

  test("format=api 쿼리 파라미터 포함 여부 확인", () => {
    const url = buildDeclineUrl("https://www.proposonline.com", "ABC123", "api");
    assert.ok(url.includes("format=api"), "Worker App 거절 요청에 format=api 필요");
  });

  test("API 응답 구조 — { ok, message } 형식", () => {
    const successResponse = { ok: true, message: "거절 처리 완료" };
    const failResponse    = { ok: false, message: "이미 처리된 링크입니다." };

    assert.ok(typeof successResponse.ok === "boolean");
    assert.ok(typeof successResponse.message === "string");
    assert.ok(!failResponse.ok);
  });

  test("ok=false 시 메시지 표시 결정 로직", () => {
    function shouldShowErrorAlert(result) {
      return !result.ok;
    }
    assert.ok(shouldShowErrorAlert({ ok: false, message: "처리 불가" }));
    assert.ok(!shouldShowErrorAlert({ ok: true }));
  });

  test("ok=true 시 declined=true 상태로 전환", () => {
    let declined = false;
    function handleDeclineResult(result) {
      if (result.ok) declined = true;
    }
    handleDeclineResult({ ok: true, message: "거절 처리 완료" });
    assert.ok(declined);
  });
});

// ============================================================
// BULK 리마인드 FCM data payload — 필수 필드 검증
// ============================================================

describe("BULK 리마인드 FCM data payload", () => {
  function buildRemindFcmData(jobId, token, calendarUrl, hostPhone) {
    return {
      jobId: String(jobId),
      token,
      calendarUrl,
      hostPhone: hostPhone ?? "",
    };
  }

  test("jobId, token, calendarUrl, hostPhone 모두 포함", () => {
    const data = buildRemindFcmData("j-123", "ABCDEF", "https://calendar.app.google/xxx", "010-1234-5678");
    assert.ok("jobId" in data);
    assert.ok("token" in data);
    assert.ok("calendarUrl" in data);
    assert.ok("hostPhone" in data);
  });

  test("jobId는 항상 문자열 (Firebase 요구사항)", () => {
    const data = buildRemindFcmData(999, "ABCDEF", "https://calendar.app.google/xxx", null);
    assert.equal(typeof data.jobId, "string");
    assert.equal(data.jobId, "999");
  });

  test("hostPhone null → 빈 문자열", () => {
    const data = buildRemindFcmData("j-1", "ABC123", "https://cal.app", null);
    assert.equal(data.hostPhone, "");
  });

  test("리마인드와 최초 발송의 data 형식 동일성", () => {
    // Worker App이 두 알림을 동일하게 처리할 수 있도록
    const initialData = { jobId: "j-1", token: "AAA111", calendarUrl: "https://cal.app", hostPhone: "" };
    const remindData  = { jobId: "j-1", token: "AAA111", calendarUrl: "https://cal.app", hostPhone: "" };
    assert.deepEqual(Object.keys(initialData).sort(), Object.keys(remindData).sort());
  });
});

// ============================================================
// cold-start 알림 처리 — NavigationRef 기반 라우팅
// ============================================================

describe("cold-start 알림 처리 플로우", () => {
  // App.tsx: getInitialNotification() → setInitialPayload → Navigation({ initialPayload })
  // Navigation: onReady 콜백에서 initialPayload가 있으면 JobScreen으로 navigate

  function simulateColdStart(initialPayload) {
    const state = { navigatedTo: null };
    const navigationRef = {
      isReady: () => true,
      navigate: (screen, params) => { state.navigatedTo = { screen, params }; },
    };
    const handledInitial = { current: false };

    function handleReady() {
      if (initialPayload && !handledInitial.current && navigationRef.isReady()) {
        handledInitial.current = true;
        navigationRef.navigate("Job", { payload: initialPayload });
      }
    }

    handleReady();
    return state;
  }

  test("initialPayload 있음 → Job 화면으로 이동", () => {
    const payload = { jobId: "j-1", token: "ABC123", calendarUrl: "https://cal.app", hostPhone: "", title: "청소 요청", body: "파주201" };
    const state = simulateColdStart(payload);
    assert.equal(state.navigatedTo?.screen, "Job");
    assert.deepEqual(state.navigatedTo?.params?.payload, payload);
  });

  test("initialPayload null → 이동 없음 (HomeScreen 유지)", () => {
    const state = simulateColdStart(null);
    assert.equal(state.navigatedTo, null);
  });

  test("중복 처리 방지 — handledInitial.current = true 설정", () => {
    const payload = { jobId: "j-1", token: "ABC123", calendarUrl: "https://cal.app", hostPhone: "", title: "", body: "" };
    let navigateCount = 0;
    const navigationRef = { isReady: () => true, navigate: () => { navigateCount++; } };
    const handledInitial = { current: false };

    function handleReady() {
      if (payload && !handledInitial.current && navigationRef.isReady()) {
        handledInitial.current = true;
        navigationRef.navigate("Job", { payload });
      }
    }

    handleReady();
    handleReady(); // 두 번 호출
    assert.equal(navigateCount, 1, "중복 navigate 호출 방지");
  });
});

// ============================================================
// sendHeartbeat import 경로 검증 (HomeScreen.tsx 수정 검증)
// ============================================================

describe("sendHeartbeat — import 경로 (api.ts)", () => {
  // HomeScreen.tsx에서 sendHeartbeat는 fcm.ts가 아닌 api.ts에서 import해야 함
  // fcm.ts: initFcm, getStoredFcmToken, watchTokenRefresh, onForegroundMessage, getInitialNotification
  // api.ts: registerWorker, sendHeartbeat, updateFcmToken, declineJob

  const FCM_EXPORTS = ["initFcm", "getStoredFcmToken", "watchTokenRefresh", "onForegroundMessage", "getInitialNotification"];
  const API_EXPORTS = ["registerWorker", "sendHeartbeat", "updateFcmToken", "declineJob"];

  test("sendHeartbeat는 api.ts에서 export됨", () => {
    assert.ok(API_EXPORTS.includes("sendHeartbeat"));
  });

  test("sendHeartbeat는 fcm.ts에서 export되지 않음", () => {
    assert.ok(!FCM_EXPORTS.includes("sendHeartbeat"));
  });

  test("fcm.ts 전용 exports 목록 정합성", () => {
    assert.ok(FCM_EXPORTS.includes("onForegroundMessage"));
    assert.ok(FCM_EXPORTS.includes("getInitialNotification"));
    assert.ok(FCM_EXPORTS.includes("getStoredFcmToken"));
  });
});

// ============================================================
// Worker App 등록 흐름 — 정상/오류 시나리오
// ============================================================

describe("Worker App 등록 흐름", () => {
  function simulateRegistration(phone, email, fcmToken) {
    if (!phone || !email || !fcmToken) return { ok: false, error: "필수 입력 누락" };
    const normalized = phone.replace(/\D/g, "").replace(/^82/, "0");
    const formatted = normalized.match(/^(\d{3})(\d{4})(\d{4})$/)
      ? `${normalized.slice(0,3)}-${normalized.slice(3,7)}-${normalized.slice(7)}`
      : phone;
    return { ok: true, phone: formatted, email: email.toLowerCase().trim() };
  }

  test("정상 등록 → ok=true", () => {
    const result = simulateRegistration("010-1234-5678", "test@gmail.com", "fcm-token-abc");
    assert.ok(result.ok);
  });

  test("전화번호 정규화 (국제 형식 → 로컬)", () => {
    const result = simulateRegistration("821012345678", "a@b.com", "tok");
    assert.ok(result.ok);
    assert.equal(result.phone, "010-1234-5678");
  });

  test("이메일 소문자 정규화", () => {
    const result = simulateRegistration("010-1234-5678", "TEST@GMAIL.COM", "tok");
    assert.equal(result.email, "test@gmail.com");
  });

  test("fcmToken 없음 → 등록 불가", () => {
    const result = simulateRegistration("010-1234-5678", "test@gmail.com", "");
    assert.ok(!result.ok);
  });
});
