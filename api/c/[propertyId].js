/**
 * GET /api/c/[propertyId]
 * 숙소별 구글 예약 캘린더로 302 redirect.
 * SMS에 포함된 단축 링크 → 실제 구글 예약 URL.
 */

import { Pool } from "pg";

const db = new Pool({ connectionString: process.env.POSTGRES_URL });

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const propertyId = Array.isArray(req.query.propertyId)
    ? req.query.propertyId[0]
    : req.query.propertyId;

  if (!propertyId) return res.status(400).end();

  const { rows: [cfg] } = await db.query(
    `SELECT google_calendar_booking_url FROM property_cleaning_config WHERE property_id=$1`,
    [propertyId]
  );

  if (!cfg?.google_calendar_booking_url) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(404).send(
      `<!doctype html><html lang="ko"><body style="font-family:sans-serif;padding:40px">
      <h2>링크 오류</h2><p>해당 숙소의 예약 캘린더가 설정되지 않았습니다. 호스트에게 문의하세요.</p>
      </body></html>`
    );
  }

  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, cfg.google_calendar_booking_url);
}
