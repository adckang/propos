// SMS 발송 유틸 (android-sms-gateway, server 전용 모듈)
// 환경변수: PROPOS_SMS_GW_ID, PROPOS_SMS_GW_PWD

const GW_BASE = "https://api.sms-gate.app/3rdparty/v1";

export function toE164(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  return `+${digits}`;
}

async function sendInitialSms(phone, message, { timeoutMs = 10_000 } = {}) {
  const gwId = process.env.PROPOS_SMS_GW_ID, gwPwd = process.env.PROPOS_SMS_GW_PWD;
  const failed = errorCode => ({ outcome: 'FAILED', provider: 'SMS', errorCode });
  if (!gwId || !gwPwd) return failed('SMS_CONFIG_MISSING');
  if (typeof phone !== 'string' || !message) return failed('SMS_INPUT_INVALID');
  const number = toE164(phone);
  if (!/^\+[1-9]\d{6,14}$/.test(number)) return failed('SMS_INPUT_INVALID');
  try {
    // No automatic retry: a lost response can follow an accepted message.
    // Keep the existing gateway endpoint/body until its ID contract is verified.
    const response = await fetch(`${GW_BASE}/message`, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${gwId}:${gwPwd}`).toString('base64')}` },
      body: JSON.stringify({ phoneNumbers: [number], message }),
    });
    if (response.ok) {
      const body = await response.json().catch(() => null);
      const id = body?.id ?? body?.messageId;
      return { outcome: 'ACCEPTED', provider: 'SMS', providerMessageId: typeof id === 'string' ? id : null };
    }
    const retryHeader = response.headers?.get?.('retry-after');
    const seconds = retryHeader == null ? NaN : Number(retryHeader);
    const retryAt = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryHeader);
    const retryAfterMs = Number.isFinite(retryAt) && Number.isFinite(new Date(retryAt).getTime()) && retryAt > Date.now() ? retryAt - Date.now() : undefined;
    return { outcome: response.status === 429 ? 'RETRYABLE' : response.status >= 400 && response.status < 500 ? 'FAILED' : 'UNKNOWN',
      provider: 'SMS', errorCode: `SMS_HTTP_${response.status}`, ...(retryAfterMs ? { retryAfterMs } : {}) };
  } catch { return { outcome: 'UNKNOWN', provider: 'SMS', errorCode: 'SMS_RESPONSE_UNKNOWN' }; }
}

export async function sendSms(phone, message, options = {}) {
  if (options.detailed) return sendInitialSms(phone, message, options);
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
