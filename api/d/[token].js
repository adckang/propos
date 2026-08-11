/**
 * GET /api/d/[token]
 * 청소자 거절 링크 (1회성, 6자 토큰).
 * 브라우저에서 직접 열리는 엔드포인트 → HTML 응답.
 */

import { Pool } from "pg";
import { advanceJob, sendCompletionSmsToRest, postSlack } from "../cleaning/_dispatch.js";

const db = new Pool({ connectionString: process.env.POSTGRES_URL });

function html(title, body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
min-height:100vh;margin:0;background:#f5f5f5}
.box{background:#fff;border-radius:12px;padding:40px 32px;max-width:360px;
text-align:center;box-shadow:0 2px 16px rgba(0,0,0,.1)}
h2{margin:0 0 12px;font-size:1.2rem;color:#111}
p{margin:0;color:#555;font-size:.95rem;line-height:1.6}
</style></head><body><div class="box"><h2>${title}</h2><p>${body}</p></div></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const token = (Array.isArray(req.query.token)
    ? req.query.token[0]
    : req.query.token ?? "").toUpperCase();

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!token || !/^[A-Z0-9]{6}$/.test(token)) {
    return res.status(404).send(html("링크 오류", "유효하지 않은 링크입니다."));
  }

  try {
    const { rows: [notif] } = await db.query(
      `SELECT n.id, n.job_id, n.cleaner_id, n.token, n.response,
              j.status AS job_status, j.property_id, j.cleaning_start_at
       FROM cleaning_notifs n
       JOIN cleaning_jobs j ON j.id = n.job_id
       WHERE n.token = $1`,
      [token]
    );

    if (!notif) {
      return res.status(404).send(html("링크 오류", "링크를 찾을 수 없습니다."));
    }

    if (notif.response) {
      return res.status(200).send(html("이미 처리됨", "이미 처리된 링크입니다."));
    }

    if (["ASSIGNED", "COMPLETED"].includes(notif.job_status)) {
      await db.query(
        `UPDATE cleaning_notifs SET response='DECLINED_AFTER_ASSIGNED', response_at=NOW()
         WHERE token=$1`,
        [token]
      );
      return res.status(200).send(html("배정 완료", "이미 배정 완료된 건입니다. 감사합니다."));
    }

    // 거절 기록
    await db.query(
      `UPDATE cleaning_notifs SET response='DECLINED', response_at=NOW() WHERE token=$1`,
      [token]
    );

    const jobStatus = notif.job_status;

    if (["NOTIFYING_VIP_1", "NOTIFYING_VIP_2", "NOTIFYING_VIP_3"].includes(jobStatus)) {
      const { rows: [job] } = await db.query(
        `SELECT * FROM cleaning_jobs WHERE id=$1`,
        [notif.job_id]
      );
      if (job) await advanceJob(db, job);
    } else if (["NOTIFYING_BULK", "BULK_REMINDED"].includes(jobStatus)) {
      const { rows } = await db.query(
        `SELECT COUNT(*) AS total,
                COUNT(CASE WHEN response='DECLINED' THEN 1 END) AS declined
         FROM cleaning_notifs
         WHERE job_id=$1`,
        [notif.job_id]
      );
      const { total, declined } = rows[0];
      if (parseInt(total) === parseInt(declined)) {
        await db.query(
          `UPDATE cleaning_jobs SET status='ESCALATED', updated_at=NOW() WHERE id=$1`,
          [notif.job_id]
        );
        const date = new Date(notif.cleaning_start_at).toISOString().slice(0, 10);
        await postSlack(
          `[PROPOS] 🚨 ${notif.property_id} ${date} 청소 배정 실패 (전원 거절). 수동 처리 필요.`
        );
      }
    }

    return res.status(200).send(html("거절 처리 완료", "거절 처리됐습니다. 감사합니다."));
  } catch (err) {
    console.error("[d/token] 오류:", err.message);
    return res.status(500).send(html("처리 오류", "일시적 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."));
  }
}
