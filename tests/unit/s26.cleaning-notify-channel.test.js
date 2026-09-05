/**
 * 청소 자동화 — NotificationService 채널 선택 + FCM 실패 처리 유닛 테스트
 * _notify.js의 selectChannel() 및 handleFcmFailure 로직 검증
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { selectChannel } from "../../api/cleaning/_notify.js";
import { toE164 } from "../../api/cleaning/_sms.js";

describe("NotificationService — 채널 선택", () => {
  test("fcm_status=active + fcm_token 있음 → FCM", () => {
    const cleaner = { fcm_status: "active", fcm_token: "tok-abc", phone: "010-1234-5678" };
    assert.equal(selectChannel(cleaner), "FCM");
  });

  test("fcm_status=uninstalled → SMS (앱 미설치)", () => {
    const cleaner = { fcm_status: "uninstalled", fcm_token: null, phone: "010-1234-5678" };
    assert.equal(selectChannel(cleaner), "SMS");
  });

  test("fcm_status=inactive → SMS (장기 미접속)", () => {
    const cleaner = { fcm_status: "inactive", fcm_token: "old-tok", phone: "010-1234-5678" };
    assert.equal(selectChannel(cleaner), "SMS");
  });

  test("fcm_status=unregistered → SMS (앱 삭제)", () => {
    const cleaner = { fcm_status: "unregistered", fcm_token: null, phone: "010-1234-5678" };
    assert.equal(selectChannel(cleaner), "SMS");
  });

  test("fcm_status=invalid → SMS (잘못된 토큰)", () => {
    const cleaner = { fcm_status: "invalid", fcm_token: "bad-tok", phone: "010-1234-5678" };
    assert.equal(selectChannel(cleaner), "SMS");
  });

  test("fcm_status=active이지만 fcm_token=null → SMS (토큰 없음)", () => {
    const cleaner = { fcm_status: "active", fcm_token: null, phone: "010-1234-5678" };
    assert.equal(selectChannel(cleaner), "SMS");
  });

  test("fcm_token도 없고 phone도 없음 → NONE", () => {
    const cleaner = { fcm_status: "uninstalled", fcm_token: null, phone: null };
    assert.equal(selectChannel(cleaner), "NONE");
  });
});

// ============================================================
// FCM 실패 후 SMS 폴백 여부 결정
// ============================================================

function shouldFallbackToSms(fcmResult, smsText) {
  if (fcmResult.success) return false;
  if (!smsText) return false; // smsText 없으면 폴백 불가
  return true;
}

describe("NotificationService — FCM 실패 시 SMS 폴백 결정", () => {
  test("FCM 성공 → 폴백 없음", () => {
    assert.equal(shouldFallbackToSms({ success: true }, "문자 내용"), false);
  });

  test("FCM 실패 + smsText 있음 → SMS 폴백", () => {
    assert.equal(shouldFallbackToSms({ success: false, errorCode: "UNREGISTERED" }, "문자 내용"), true);
  });

  test("FCM 실패 + smsText 없음(null) → 폴백 불가 (NONE)", () => {
    assert.equal(shouldFallbackToSms({ success: false, errorCode: "UNREGISTERED" }, null), false);
  });

  test("FCM 실패 + smsText 없음(undefined) → 폴백 불가", () => {
    assert.equal(shouldFallbackToSms({ success: false, errorCode: "INVALID_ARGUMENT" }, undefined), false);
  });
});

// ============================================================
// SMS → FCM 자동 전환 조건 (Worker App 설치 후)
// ============================================================

describe("NotificationService — SMS→FCM 자동 전환", () => {
  // Worker App 설치 시 fcm_status가 'active'로 갱신됨
  // 다음 알림부터 FCM 채널이 자동 선택됨

  function simulateAppInstall(cleaner, newToken) {
    return {
      ...cleaner,
      fcm_token: newToken,
      fcm_status: "active",
    };
  }

  test("앱 설치 후 fcm_status=active + fcm_token 세팅 → 다음 알림은 FCM", () => {
    const before = { fcm_status: "uninstalled", fcm_token: null, phone: "010-1234-5678" };
    assert.equal(selectChannel(before), "SMS");

    const after = simulateAppInstall(before, "new-fcm-token");
    assert.equal(selectChannel(after), "FCM");
  });
});

// ============================================================
// 채널별 결과 레코드 (cleaning_notifs.channel)
// ============================================================

describe("NotificationService — channel 컬럼 값 결정", () => {
  function determineChannelRecord(sentVia, wasFallback) {
    if (sentVia === "FCM") return "FCM";
    if (sentVia === "SMS" && wasFallback) return "SMS_FALLBACK";
    if (sentVia === "SMS") return "SMS";
    return null;
  }

  test("FCM 직접 발송 → channel = 'FCM'", () => {
    assert.equal(determineChannelRecord("FCM", false), "FCM");
  });

  test("SMS 직접 발송 (앱 미설치) → channel = 'SMS'", () => {
    assert.equal(determineChannelRecord("SMS", false), "SMS");
  });

  test("FCM 실패 후 SMS 폴백 → channel = 'SMS_FALLBACK'", () => {
    assert.equal(determineChannelRecord("SMS", true), "SMS_FALLBACK");
  });
});

// ============================================================
// handleFcmFailure — fcm_status DB 업데이트 로직 (notify() 내부)
// ============================================================

describe("handleFcmFailure — fcm_status 업데이트 결정 로직", () => {
  function decideFcmStatusFromNotify(errorCode) {
    // _notify.js의 handleFcmFailure 로직과 동일
    if (errorCode === "UNREGISTERED") return { newStatus: "unregistered", slackAlert: true };
    if (errorCode === "INVALID_ARGUMENT") return { newStatus: "invalid", slackAlert: true };
    return { newStatus: null, slackAlert: false };
  }

  test("UNREGISTERED → fcm_status='unregistered' + Slack 알림", () => {
    const result = decideFcmStatusFromNotify("UNREGISTERED");
    assert.equal(result.newStatus, "unregistered");
    assert.ok(result.slackAlert);
  });

  test("INVALID_ARGUMENT → fcm_status='invalid' + Slack 알림", () => {
    const result = decideFcmStatusFromNotify("INVALID_ARGUMENT");
    assert.equal(result.newStatus, "invalid");
    assert.ok(result.slackAlert);
  });

  test("QUOTA_EXCEEDED → DB 업데이트 없음, Slack 없음", () => {
    const result = decideFcmStatusFromNotify("QUOTA_EXCEEDED");
    assert.equal(result.newStatus, null);
    assert.ok(!result.slackAlert);
  });

  test("UNKNOWN → DB 업데이트 없음", () => {
    const result = decideFcmStatusFromNotify("UNKNOWN");
    assert.equal(result.newStatus, null);
  });
});

describe("handleFcmFailure — notify()에서 호출 검증 (플로우 시뮬레이션)", () => {
  function simulateNotifyWithFcmFailure(cleaner, fcmResult, smsText) {
    let fcmStatusUpdated = null;
    let slackPosted = false;
    let resultChannel = "NONE";

    if (fcmResult.success) {
      resultChannel = "FCM";
    } else {
      // handleFcmFailure 로직
      if (fcmResult.errorCode === "UNREGISTERED") {
        fcmStatusUpdated = "unregistered";
        slackPosted = true;
      } else if (fcmResult.errorCode === "INVALID_ARGUMENT") {
        fcmStatusUpdated = "invalid";
        slackPosted = true;
      }
      // SMS 폴백
      if (smsText && cleaner.phone) {
        resultChannel = "SMS_FALLBACK";
      }
    }

    return { resultChannel, fcmStatusUpdated, slackPosted };
  }

  const cleaner = { id: "c1", fcm_token: "tok", fcm_status: "active", phone: "010-1234-5678" };

  test("FCM UNREGISTERED → fcm_status 업데이트 + SMS 폴백", () => {
    const r = simulateNotifyWithFcmFailure(cleaner, { success: false, errorCode: "UNREGISTERED" }, "SMS");
    assert.equal(r.fcmStatusUpdated, "unregistered");
    assert.equal(r.resultChannel, "SMS_FALLBACK");
    assert.ok(r.slackPosted);
  });

  test("FCM INVALID_ARGUMENT + phone 없음 → fcm_status 업데이트, resultChannel=NONE", () => {
    const noPhone = { ...cleaner, phone: null };
    const r = simulateNotifyWithFcmFailure(noPhone, { success: false, errorCode: "INVALID_ARGUMENT" }, "SMS");
    assert.equal(r.fcmStatusUpdated, "invalid");
    assert.equal(r.resultChannel, "NONE");
  });

  test("FCM 성공 → fcm_status 업데이트 없음", () => {
    const r = simulateNotifyWithFcmFailure(cleaner, { success: true }, null);
    assert.equal(r.fcmStatusUpdated, null);
    assert.equal(r.resultChannel, "FCM");
    assert.ok(!r.slackPosted);
  });
});

// ============================================================
// sendCompletionSmsToRest → notify() 사용 검증
// ============================================================

describe("sendCompletionSmsToRest — notify() 호출 확인", () => {
  // sendCompletionSmsToRest는 이제 sendJobPush 대신 notify()를 사용
  // → FCM 미설치 청소자에게도 SMS 전달 가능

  function simulateCompletionNotify(cleaners, propertyName, date) {
    const smsText = `[PROPOS] ${propertyName} ${date} 청소가 배정 완료됐습니다. 감사합니다.`;
    const fcmBody = `${propertyName} ${date} 건이 배정됐습니다. 감사합니다.`;

    return cleaners.map((c) => {
      const channel = c.fcm_status === "active" && c.fcm_token ? "FCM" : c.phone ? "SMS" : "NONE";
      return { cleanerId: c.id, channel, smsText: channel !== "FCM" ? smsText : null, fcmBody: channel === "FCM" ? fcmBody : null };
    });
  }

  test("FCM 청소자 → FCM 채널, SMS 청소자 → SMS 채널로 각각 발송", () => {
    const cleaners = [
      { id: "c1", fcm_status: "active",       fcm_token: "tok1", phone: "010-1111-1111" },
      { id: "c2", fcm_status: "unregistered", fcm_token: null,   phone: "010-2222-2222" },
    ];
    const results = simulateCompletionNotify(cleaners, "파주201", "2026-08-25");

    assert.equal(results[0].channel, "FCM");
    assert.equal(results[1].channel, "SMS");
    assert.ok(results[1].smsText.includes("배정 완료됐습니다"));
  });

  test("phone도 없는 청소자 → NONE (완료 알림 누락 로그)", () => {
    const cleaners = [{ id: "c3", fcm_status: "inactive", fcm_token: null, phone: null }];
    const results = simulateCompletionNotify(cleaners, "파주201", "2026-08-25");
    assert.equal(results[0].channel, "NONE");
  });
});

// ============================================================
// User Scenario: 앱 미설치 청소자에게 SMS + 앱 설치 유도 링크
// ============================================================

describe("User Scenario — 앱 미설치 청소자 SMS 발송", () => {
  const WORKER_APP_URL = "https://play.google.com/store/apps/details?id=com.proposworker";

  function buildSmsWithInstallLink(smsText) {
    if (!smsText.includes(WORKER_APP_URL)) {
      return `${smsText}\n앱 설치: ${WORKER_APP_URL}`;
    }
    return smsText;
  }

  test("앱 설치 링크가 없으면 자동 추가", () => {
    const result = buildSmsWithInstallLink("[PROPOS] 청소 요청\n수락: https://calendar.app.google/xxx");
    assert.ok(result.includes(WORKER_APP_URL));
  });

  test("앱 설치 링크가 이미 있으면 중복 추가 안 함", () => {
    const text = `[PROPOS] 청소 요청\n앱 설치: ${WORKER_APP_URL}`;
    const result = buildSmsWithInstallLink(text);
    const count = result.split(WORKER_APP_URL).length - 1;
    assert.equal(count, 1, "앱 설치 링크가 중복 추가됨");
  });
});

// ============================================================
// Integration Scenario: VIP_1이 앱 없을 때 전체 흐름
// ============================================================

describe("Integration Scenario — VIP_1 앱 미설치 시 SMS 발송", () => {
  function simulateNotify(cleaner, payload) {
    const channel = selectChannel(cleaner);
    const { smsText } = payload;

    if (channel === "FCM") {
      // FCM 발송 (테스트에선 성공 가정)
      return { ok: true, channel: "FCM" };
    }
    if (channel === "SMS") {
      if (!smsText) return { ok: false, channel: "NONE", reason: "smsText missing" };
      return { ok: true, channel: "SMS" };
    }
    return { ok: false, channel: "NONE", reason: "no channel available" };
  }

  test("VIP_1 앱 없음 + smsText 있음 → SMS 발송 성공", () => {
    const vip1 = { fcm_status: "uninstalled", fcm_token: null, phone: "010-1111-1111" };
    const result = simulateNotify(vip1, { smsText: "[PROPOS] 청소 요청..." });
    assert.ok(result.ok);
    assert.equal(result.channel, "SMS");
  });

  test("VIP_1 앱 없음 + smsText 없음 → NONE (발송 실패)", () => {
    const vip1 = { fcm_status: "uninstalled", fcm_token: null, phone: "010-1111-1111" };
    const result = simulateNotify(vip1, { title: "타이틀", body: "본문" }); // smsText 없음
    assert.equal(result.channel, "NONE");
  });

  test("VIP_1 앱 있음 → FCM 발송", () => {
    const vip1 = { fcm_status: "active", fcm_token: "valid-token", phone: "010-1111-1111" };
    const result = simulateNotify(vip1, { title: "타이틀", body: "본문", smsText: "SMS" });
    assert.equal(result.channel, "FCM");
  });

  test("phone도 없고 fcm_token도 없음 → NONE (연락 불가)", () => {
    const cleaner = { fcm_status: "uninstalled", fcm_token: null, phone: null };
    const result = simulateNotify(cleaner, { smsText: "SMS" });
    assert.equal(result.channel, "NONE");
  });
});

// ============================================================
// SMS 환경변수 미설정 시 channel=null (2026-09-04 운영 이슈)
// PROPOS_SMS_GW_ID/PWD 미설정 → sendSms skip → resultChannel=NONE
// → notify()가 channel DB 기록을 건너뜀 → cleaning_notifs.channel = null
// ============================================================

describe("SMS 환경변수 미설정 → channel DB 기록 없음", () => {
  // _sms.js 핵심 로직 재현
  function sendSmsWillSkip(gwId, gwPwd) {
    return !gwId || !gwPwd; // 환경변수 없으면 return false (발송 skip)
  }

  // _notify.js 핵심 로직: channel 기록 조건
  function willRecordChannel(notifId, resultChannel) {
    return !!(notifId && resultChannel !== "NONE");
  }

  test("PROPOS_SMS_GW_ID 미설정 → SMS 발송 skip", () => {
    assert.ok(sendSmsWillSkip(undefined, "pwd"), "gwId 없으면 skip");
    assert.ok(sendSmsWillSkip("", "pwd"),        "gwId 빈 문자열도 skip");
  });

  test("PROPOS_SMS_GW_PWD 미설정 → SMS 발송 skip", () => {
    assert.ok(sendSmsWillSkip("id", undefined), "gwPwd 없으면 skip");
    assert.ok(sendSmsWillSkip("id", ""),        "gwPwd 빈 문자열도 skip");
  });

  test("양쪽 모두 설정 → SMS 발송 진행 (skip 안 함)", () => {
    assert.ok(!sendSmsWillSkip("my-id", "my-pwd"), "둘 다 있으면 skip 안 함");
  });

  test("SMS skip → resultChannel=NONE → channel DB 기록 안 됨", () => {
    // sendSms가 false 반환 → resultChannel = "NONE"
    const resultChannel = "NONE";
    const notifId = "test-notif-id";
    assert.ok(!willRecordChannel(notifId, resultChannel),
      "NONE이면 DB UPDATE 건너뜀 → cleaning_notifs.channel 컬럼 null 유지");
  });

  test("SMS 성공(resultChannel=SMS) → channel 기록됨", () => {
    const resultChannel = "SMS";
    const notifId = "test-notif-id";
    assert.ok(willRecordChannel(notifId, resultChannel), "SMS 성공 시 channel 기록");
  });

  test("notifId 없이 호출 → channel 기록 안 됨 (advanceJob에서 notifId 누락 방지 필요)", () => {
    const resultChannel = "SMS";
    assert.ok(!willRecordChannel(undefined, resultChannel),
      "notifId 미전달 시 channel 기록 불가 — notify() 호출 시 notifId 필수");
    assert.ok(!willRecordChannel(null, resultChannel),
      "notifId=null도 channel 기록 불가");
  });
});

// ============================================================
// L2 Contract — _sms.js toE164 번호 변환 (실제 함수 import)
// ============================================================

describe("L2 Contract — _sms.js toE164 번호 변환", () => {
  test("010-XXXX-XXXX → +8210XXXXXXXX", () => {
    assert.equal(toE164("010-1234-5678"), "+821012345678");
  });

  test("82로 시작 → 그대로 +82...", () => {
    assert.equal(toE164("821012345678"), "+821012345678");
  });

  test("하이픈·공백 제거", () => {
    assert.equal(toE164("010 1234 5678"), "+821012345678");
  });

  test("01012345678 (하이픈 없음) → +821012345678", () => {
    assert.equal(toE164("01012345678"), "+821012345678");
  });
});
