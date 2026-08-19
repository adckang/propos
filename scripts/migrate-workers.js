/**
 * Worker App DB 마이그레이션
 * cleaners 테이블에 FCM 컬럼 추가 + name NOT NULL 제약 해제
 *
 * 실행: node scripts/migrate-workers.js
 * 선행조건: POSTGRES_URL 환경변수 설정
 */

import { Pool } from "pg";

const db = new Pool({ connectionString: process.env.POSTGRES_URL });

async function migrate() {
  console.log("🔧 Worker App DB 마이그레이션 시작...");

  await db.query(`
    ALTER TABLE cleaners
      ALTER COLUMN name DROP NOT NULL
  `).catch((e) => {
    if (e.message.includes("does not exist") || e.message.includes("already")) {
      console.log("  → name NOT NULL: 이미 반영됨 (스킵)");
    } else throw e;
  });
  console.log("  ✓ cleaners.name: NOT NULL 제약 해제");

  const columns = [
    { name: "fcm_token",        type: "TEXT" },
    { name: "fcm_token_at",     type: "TIMESTAMPTZ" },
    { name: "app_installed_at", type: "TIMESTAMPTZ" },
    { name: "last_seen_at",     type: "TIMESTAMPTZ" },
    { name: "fcm_status",       type: "TEXT DEFAULT 'uninstalled'" },
  ];

  for (const col of columns) {
    await db.query(`ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
    console.log(`  ✓ cleaners.${col.name} 추가`);
  }

  // fcm_status 값 제약 (CHECK) — 기존 행은 null이므로 OR NULL 허용
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cleaners_fcm_status_check'
      ) THEN
        ALTER TABLE cleaners ADD CONSTRAINT cleaners_fcm_status_check
          CHECK (fcm_status IS NULL OR fcm_status IN (
            'uninstalled','active','inactive','invalid','unregistered'
          ));
      END IF;
    END $$
  `);
  console.log("  ✓ fcm_status CHECK 제약 추가");

  // 인덱스 (heartbeat 조회용)
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_cleaners_fcm_status ON cleaners(fcm_status)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_cleaners_last_seen ON cleaners(last_seen_at)
  `);
  console.log("  ✓ 인덱스 추가");

  console.log("\n✅ 마이그레이션 완료");
  await db.end();
}

migrate().catch((e) => {
  console.error("❌ 마이그레이션 실패:", e.message);
  process.exit(1);
});
