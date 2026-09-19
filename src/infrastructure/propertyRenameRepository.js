/**
 * 숙소 식별자 이전 — 이름 변경 / 레거시(prop_…) → 이름 (D-016)
 *
 * property_id TEXT 컬럼을 가진 테이블(FK 없음)을 한 트랜잭션에서 옮긴다.
 * db는 인자로 주입 ({ connect() → { query, release } } — pg Pool 인터페이스).
 *
 * 안전 규칙
 *   - 이전할 행이 하나도 없으면 아무것도 하지 않는다 (재실행해도 안전 = idempotent)
 *   - 대상 이름이 이미 다른 숙소로 등록돼 있으면 거절 (두 숙소의 이력을 합치지 않는다)
 *   - 유니크 제약 충돌 등 어떤 오류든 전체 롤백
 */

// property_id 컬럼을 가진 테이블. 레지스트리는 name 컬럼도 새 이름으로 맞춘다.
const TABLES = [
  { table: "property_cleaning_config", set: "property_id = $2, name = $2, updated_at = NOW()" },
  { table: "cleaning_jobs" },
  { table: "property_calendar_blockers" },
  { table: "events" },
  { table: "monthly_summaries" }, // 환경에 따라 없을 수 있음 → presentTables 가 건너뜀
];

export const RENAMED_TABLES = TABLES.map((t) => t.table);

/** code: INVALID(입력 오류) | TARGET_EXISTS(대상 이름이 이미 등록됨) | CONFLICT(유니크 충돌) */
export class PropertyRenameError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PropertyRenameError";
    this.code = code;
  }
}

const isId = (v) => typeof v === "string" && v.trim().length > 0;

async function presentTables(client) {
  const { rows } = await client.query(
    `SELECT n AS table_name FROM unnest($1::text[]) AS n WHERE to_regclass(n) IS NOT NULL`,
    [RENAMED_TABLES]
  );
  const present = new Set(rows.map((r) => r.table_name));
  return TABLES.filter((t) => present.has(t.table)); // 없는 테이블(선택적 monthly_summaries 등)은 건너뜀
}

async function countRows(client, tables, propertyId) {
  const counts = {};
  for (const { table } of tables) {
    // table 은 위 상수 목록에서만 오므로 식별자 보간이 안전하다
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE property_id = $1`, [propertyId]);
    counts[table] = Number(rows[0]?.n) || 0;
  }
  return counts;
}

/**
 * @param {object} db  pg Pool
 * @param {string} from  이전 식별자 (레거시 prop_… 또는 변경 전 이름)
 * @param {string} to    새 식별자 (= 새 이름)
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<
 *   { ok: true, alreadyMigrated: true }
 * | { ok: true, dryRun: true, wouldMove: Record<string, number> }
 * | { ok: true, moved: Record<string, number> }>}
 * @throws {PropertyRenameError}
 */
export async function renamePropertyId(db, from, to, { dryRun = false } = {}) {
  if (!isId(from) || !isId(to)) throw new PropertyRenameError("INVALID", "이전/새 숙소 이름이 필요해요");
  if (from === to) throw new PropertyRenameError("INVALID", "이전 이름과 새 이름이 같아요");

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const tables = await presentTables(client);
    const counts = await countRows(client, tables, from);
    const total = Object.values(counts).reduce((s, n) => s + n, 0);

    if (total === 0) {
      await client.query("ROLLBACK");
      return { ok: true, alreadyMigrated: true };
    }

    const { rows: taken } = await client.query(
      "SELECT 1 FROM property_cleaning_config WHERE property_id = $1",
      [to]
    );
    if (taken.length) throw new PropertyRenameError("TARGET_EXISTS", `이미 "${to}" 숙소가 등록돼 있어요`);

    if (dryRun) {
      await client.query("ROLLBACK");
      return { ok: true, dryRun: true, wouldMove: counts };
    }

    const moved = {};
    for (const { table, set } of tables) {
      const res = await client.query(
        `UPDATE ${table} SET ${set ?? "property_id = $2"} WHERE property_id = $1`,
        [from, to]
      );
      moved[table] = res.rowCount ?? 0;
    }

    await client.query("COMMIT");
    return { ok: true, moved };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* 이미 종료된 트랜잭션 */ }
    if (err instanceof PropertyRenameError) throw err;
    if (err?.code === "23505") {
      throw new PropertyRenameError("CONFLICT", `"${to}" 이름에 이미 데이터가 있어 이력을 합칠 수 없어요`);
    }
    throw err;
  } finally {
    client.release();
  }
}
