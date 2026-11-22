/**
 * FCM 푸시 발송 유틸리티 (sendSms 대체, server 전용 모듈)
 * 환경변수: FIREBASE_SERVICE_ACCOUNT_JSON (서비스 계정 키 전체 JSON 문자열)
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON 환경변수 미설정");
  return initializeApp({ credential: cert(JSON.parse(raw)) });
}

/**
 * FCM 푸시 발송
 * @param {string} fcmToken - 직원 기기 FCM 토큰
 * @param {{ title: string, body: string, data?: Record<string, string> }} payload
 * @returns {{ success: boolean, errorCode?: string }}
 */
export async function sendPush(fcmToken, { title, body, data = {} }, options = {}) {
  if (!fcmToken) return { success: false, errorCode: "NO_TOKEN", ...(options.detailed ? { outcome: 'FAILED', provider: 'FCM' } : {}) };

  let started = false, timer;
  try {
    const app = getAdminApp();
    const messaging = getMessaging(app);

    started = true;
    const sending = messaging.send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v ?? "")])
      ),
      android: {
        priority: "high",
        notification: { sound: "default" },
      },
    });

    const messageId = await (options.detailed ? Promise.race([sending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('FCM response unknown'), { code: 'FCM_RESPONSE_TIMEOUT' })), options.timeoutMs ?? 10_000);
    })]) : sending);
    if (options.detailed && (typeof messageId !== 'string' || !messageId)) {
      return { success: false, outcome: 'UNKNOWN', provider: 'FCM', errorCode: 'FCM_RECEIPT_MISSING' };
    }
    return options.detailed ? { success: true, outcome: 'ACCEPTED', provider: 'FCM', providerMessageId: messageId } : { success: true };
  } catch (err) {
    const code = err?.errorInfo?.code ?? err?.code ?? "UNKNOWN";
    if (!options.detailed) console.error("[push] FCM 발송 실패:", {
      code,
      message: err?.message,
      errorInfo: err?.errorInfo,
    });
    // FCM v1 오류 코드 정규화
    const errorCode = code.includes("registration-token-not-registered")
      ? "UNREGISTERED"
      : code.includes("invalid-argument") || code.includes("invalid-registration-token")
      ? "INVALID_ARGUMENT"
      : code;
    return { success: false, errorCode, ...(options.detailed ? { provider: 'FCM', outcome:
      !started || ['UNREGISTERED','INVALID_ARGUMENT'].includes(errorCode) ? 'FAILED' :
        code === 'messaging/quota-exceeded' ? 'RETRYABLE' : 'UNKNOWN' } : {}) };
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * 옛 토큰이 아직 쓸 수 있는지 알림 서버에 시험 발송(validate only — 기기에는 아무것도 가지 않는다)으로 묻는다.
 * 담당자 앱을 다시 설치하면 옛 토큰은 알림 서버에서 없어진다 — 그때만 재등록으로 새 토큰을 받는다 (DEC-09).
 * 확인할 수 없으면(설정 없음·응답 없음·그 밖의 오류) 'unknown' — 호출부는 막는 쪽으로 다룬다.
 * @returns {Promise<'dead'|'alive'|'unknown'>}
 */
export async function probeToken(fcmToken, { timeoutMs = 5_000 } = {}) {
  if (!fcmToken) return "dead";
  let timer;
  try {
    const messaging = getMessaging(getAdminApp());
    await Promise.race([
      messaging.send({ token: fcmToken, data: { probe: "1" } }, true),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("FCM response unknown"), { code: "FCM_RESPONSE_TIMEOUT" })), timeoutMs); }),
    ]);
    return "alive";
  } catch (err) {
    const code = String(err?.errorInfo?.code ?? err?.code ?? "");
    // 등록 안 됨·잘못된 토큰만 "없음"이다. invalid-argument는 시험 메시지 자체의 문제일 수도 있어(그러면 모든 토큰이 없음으로
    // 보여 누구나 번호를 가로챈다) 확인 불가로 둔다
    if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")) return "dead";
    return "unknown";
  } finally { if (timer) clearTimeout(timer); }
}
