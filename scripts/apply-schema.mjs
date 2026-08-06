/**
 * Vercel Postgres에 schema.sql을 적용한다.
 * 실행: node scripts/apply-schema.mjs
 * 전제: .env.local에 POSTGRES_URL이 있어야 함 (npx vercel env pull .env.local)
 */
// 로컬 실행 시 Neon 인증서 체인 검증 우회 (스크립트 전용)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { readFileSync } from "node:fs";
import pg from "pg";
const { Pool: createPool } = pg;

// .env.local 수동 파싱 (dotenv 의존성 없이)
try {
  const lines = readFileSync(".env.local", "utf8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
} catch { /* .env.local 없으면 기존 환경변수 사용 */ }

if (!process.env.POSTGRES_URL) {
  console.error("POSTGRES_URL 없음. npx vercel env pull .env.local 먼저 실행.");
  process.exit(1);
}

const sql = readFileSync("data/schema.sql", "utf8");
const pool = new createPool({ connectionString: process.env.POSTGRES_URL });

try {
  await pool.query(sql);
  console.log("스키마 적용 완료.");
} catch (err) {
  console.error("스키마 적용 실패:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
