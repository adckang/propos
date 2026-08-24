/**
 * NotificationService — 채널 선택 · 발송 · 기록 단일 진입점
 *
 * 채널 결정 우선순위:
 *   1. fcm_status='active' + fcm_token 있음  → FCM
 *   2. FCM 실패(UNREGISTERED/INVALID)         → SMS 폴백 (channel='SMS_FALLBACK')
 *   3. 그 외 (uninstalled/inactive/invalid 등) → SMS 직접 발송 (channel='SMS')
 *   4. phone도 없음                            → NONE
 *
 * 호출자(_dispatch.js)는 반드시 smsText를 함께 전달할 것.
 * smsText 없으면 FCM 실패 시 폴백 불가 → channel='NONE' 반환.
 */

import { sendPush } from "./_push.js";
import { sendSms } from "./_sms.js";

const SLACK_WEBHOOK = process.env.PROPOS_SLACK_WEBHOOK;

async function postSlackInternal(text) {
  if (!SLACK_WEBHOOK) return;
  await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => {});
}

async function handleFcmFailure(db, cleaner, errorCode) {
  if (errorCode === "UNREGISTERED") {
    await db.query(
      `UPDATE cleaners SET fcm_status='unregistered' WHERE id=$1`,
      [cleaner.id]
    ).catch(() => {});
    await postSlackInternal(
      `[PROPOS] ⚠️ ${cleaner.name ?? cleaner.phone ?? cleaner.id} 앱 삭제 감지 — 푸시 전달 실패`
    );
  } else if (errorCode === "INVALID_ARGUMENT") {
    await db.query(
      `UPDATE cleaners SET fcm_status='invalid' WHERE id=$1`,
      [cleaner.id]
    ).catch(() => {});
    await postSlackInternal(
      `[PROPOS] ⚠️ ${cleaner.name ?? cleaner.phone ?? cleaner.id} FCM 토큰 오류 — 재설치 필요`
    );
  } else {
    console.error(`[notify] FCM 알 수 없는 오류 (cleaner=${cleaner.id}):`, errorCode);
  }
}

export function selectChannel(cleaner) {
  if (cleaner.fcm_status === "active" && cleaner.fcm_token) return "FCM";
  if (cleaner.phone) return "SMS";
  return "NONE";
}

/**
 * @param {object} db           - Postgres Pool (cleaning_notifs.channel 기록 + fcm_status 업데이트용)
 * @param {object} cleaner      - { id, fcm_token, fcm_status, phone, name }
 * @param {object} payload
 * @param {string} payload.title     - FCM 알림 제목
 * @param {string} payload.body      - FCM 알림 본문
 * @param {object} payload.data      - FCM data payload
 * @param {string} payload.smsText   - SMS 문자 내용 (폴백용, 필수)
 * @param {string} [payload.notifId] - cleaning_notifs.id (channel 컬럼 업데이트용)
 * @returns {{ ok: boolean, channel: 'FCM'|'SMS'|'SMS_FALLBACK'|'NONE' }}
 */
export async function notify(db, cleaner, { title, body, data = {}, smsText, notifId }) {
  const channel = selectChannel(cleaner);
  let resultChannel = "NONE";

  if (channel === "FCM") {
    const result = await sendPush(cleaner.fcm_token, { title, body, data });
    if (result.success) {
      resultChannel = "FCM";
    } else {
      await handleFcmFailure(db, cleaner, result.errorCode);
      // FCM 실패 → SMS 폴백 시도
      if (smsText && cleaner.phone) {
        const ok = await sendSms(cleaner.phone, smsText);
        resultChannel = ok ? "SMS_FALLBACK" : "NONE";
      }
    }
  } else if (channel === "SMS") {
    if (!smsText) {
      console.warn(`[notify] smsText 없음 — cleaner=${cleaner.id} 발송 불가`);
      resultChannel = "NONE";
    } else {
      const ok = await sendSms(cleaner.phone, smsText);
      resultChannel = ok ? "SMS" : "NONE";
    }
  }

  // cleaning_notifs.channel 기록 (notifId 있을 때만)
  if (notifId && resultChannel !== "NONE") {
    await db.query(
      `UPDATE cleaning_notifs SET channel=$1 WHERE id=$2`,
      [resultChannel, notifId]
    ).catch((e) => console.error("[notify] channel 기록 실패:", e.message));
  }

  return { ok: resultChannel !== "NONE", channel: resultChannel };
}
