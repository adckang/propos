/**
 * 청소 자동화 스키마 적용.
 * 실행: node scripts/migrate-cleaning.mjs
 * 전제: .env.local에 POSTGRES_URL (npx vercel env pull .env.local)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { readFileSync } from "node:fs";
import pg from "pg";
const { Pool } = pg;

try {
  const lines = readFileSync(".env.local", "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch { /* .env.local 없으면 기존 환경변수 사용 */ }

if (!process.env.POSTGRES_URL) {
  console.error("POSTGRES_URL 없음. npx vercel env pull .env.local 먼저 실행.");
  process.exit(1);
}

const sql = readFileSync("data/schema-cleaning.sql", "utf8");
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

try {
  await pool.query(sql);
  console.log("✅ 청소 자동화 스키마 적용 완료");
} catch (e) {
  console.error("❌ 스키마 적용 실패:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
