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
