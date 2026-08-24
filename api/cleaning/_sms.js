// SMS 발송 유틸 (android-sms-gateway)
// 환경변수: PROPOS_SMS_GW_ID, PROPOS_SMS_GW_PWD

const GW_BASE = "https://api.sms-gate.app/3rdparty/v1";

export function toE164(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  return `+${digits}`;
}

export async function sendSms(phone, message) {
  const gwId  = process.env.PROPOS_SMS_GW_ID;
  const gwPwd = process.env.PROPOS_SMS_GW_PWD;
  if (!gwId || !gwPwd) {
    console.warn("[sendSms] SMS gateway 환경변수 미설정 — 건너뜀");
    return false;
  }
  const e164 = toE164(phone);
  let attempt = 0;
  while (attempt < 3) {
    attempt++;
    try {
      const r = await fetch(`${GW_BASE}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${gwId}:${gwPwd}`).toString("base64")}`,
        },
        body: JSON.stringify({ phoneNumbers: [e164], message }),
      });
      if (r.ok) return true;
      if (attempt === 3) {
        const text = await r.text().catch(() => "");
        console.error(`SMS 발송 실패 (${phone}): ${r.status} ${text}`);
        return false;
      }
    } catch (err) {
      if (attempt === 3) { console.error(`SMS 오류 (${phone}):`, err.message); return false; }
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}
