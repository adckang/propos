/**
 * POST /api/sms/send
 * android-sms-gateway 클라우드 API 프록시.
 * 내부 전용 — CRON_SECRET 또는 동일 프로세스에서만 호출.
 *
 * Body: { phone: "010-0000-0000", message: "..." }
 */

const GW_BASE = "https://api.sms-gate.app/3rdparty/v1";

function toE164(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  return `+${digits}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).end();
  }

  const gwId  = process.env.PROPOS_SMS_GW_ID;
  const gwPwd = process.env.PROPOS_SMS_GW_PWD;
  if (!gwId || !gwPwd) {
    return res.status(503).json({ error: "SMS gateway 환경변수 미설정" });
  }

  let body;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { phone, message } = body;
  if (!phone || !message) {
    return res.status(400).json({ error: "phone, message 필수" });
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
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        return res.status(200).json({ ok: true, data });
      }
      if (attempt === 3) {
        const text = await r.text().catch(() => "");
        return res.status(502).json({ error: `SMS 게이트웨이 오류 (${r.status})`, detail: text });
      }
    } catch (err) {
      if (attempt === 3) return res.status(502).json({ error: err.message });
    }
    await new Promise((r) => setTimeout(r, 2_000)); // 2초 재시도 (Vercel 타임아웃 방어)
  }
}
