/**
 * 운영자 계정 관리 (D-034, 관리자 전용) — 목록·생성·수정(정지·비밀번호 재설정·숙소 배정).
 * 호출부(api/cleaning)가 반드시 requireAdminSession 을 먼저 통과시킨다. db 는 pg Pool({ query, connect }) 주입.
 * 응답에 password_hash 는 절대 포함하지 않는다.
 */
import { hashPassword, normalizeEmail, validatePassword } from './operatorAccounts.js';

const send = (res, status, body) => res.status(status).json(body);

async function operatorWithProperties(db, operatorId) {
  const { rows: [op] } = await db.query(`SELECT id, email, name, active, created_at FROM operators WHERE id = $1`, [operatorId]);
  if (!op) return null;
  const { rows } = await db.query(`SELECT property_id FROM operator_properties WHERE operator_id = $1 ORDER BY property_id`, [operatorId]);
  return { ...op, property_ids: rows.map((r) => r.property_id) };
}

export async function listOperators(db, res) {
  const { rows } = await db.query(
    `SELECT o.id, o.email, o.name, o.active, o.created_at,
            COALESCE(array_agg(op.property_id ORDER BY op.property_id) FILTER (WHERE op.property_id IS NOT NULL), '{}') AS property_ids
       FROM operators o LEFT JOIN operator_properties op ON op.operator_id = o.id
      GROUP BY o.id ORDER BY o.created_at`);
  return send(res, 200, rows);
}

/** 배정 숙소 목록을 한 트랜잭션에서 통째로 교체 (없는 숙소가 섞이면 전체 롤백 → 400) */
async function replaceOperatorProperties(client, operatorId, propertyIds) {
  await client.query(`DELETE FROM operator_properties WHERE operator_id = $1`, [operatorId]);
  if (propertyIds.length) {
    await client.query(
      `INSERT INTO operator_properties (operator_id, property_id) SELECT $1, unnest($2::text[])`,
      [operatorId, propertyIds]);
  }
}

/** undefined = 안 보냄, null = 형식 오류(목록이 아님), 배열 = 정리된 목록 */
function cleanPropertyIds(v) {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))] : null;
}

export async function createOperator(db, body, res) {
  const b = body ?? {};
  const email = normalizeEmail(b.email);
  if (!email) return send(res, 400, { error: '이메일 형식이 올바르지 않아요' });
  const pw = validatePassword(b.password);
  if (!pw.ok) return send(res, 400, { error: pw.reason });
  const propertyIds = cleanPropertyIds(b.property_ids);
  if (propertyIds === null) return send(res, 400, { error: 'property_ids 는 목록이어야 해요' }); // 조용히 빈 목록으로 만들지 않는다
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 60) : null;
  const hash = await hashPassword(b.password);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [op] } = await client.query(
      `INSERT INTO operators (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`, [email, name, hash]);
    await replaceOperatorProperties(client, op.id, propertyIds ?? []);
    await client.query('COMMIT');
    return send(res, 201, await operatorWithProperties(db, op.id));
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 종료 */ }
    if (err.code === '23505') return send(res, 409, { error: '이미 등록된 이메일이에요', code: 'EMAIL_TAKEN' });
    if (err.code === '23503') return send(res, 400, { error: '존재하지 않는 숙소가 포함돼 있어요', code: 'UNKNOWN_PROPERTY' });
    throw err;
  } finally {
    client.release();
  }
}

export async function updateOperator(db, body, res, id) {
  const b = body ?? {};
  const sets = []; const vals = [];
  if (typeof b.active === 'boolean') { vals.push(b.active); sets.push(`active = $${vals.length}`); }
  if (typeof b.name === 'string') { vals.push(b.name.trim().slice(0, 60) || null); sets.push(`name = $${vals.length}`); }
  if (b.password !== undefined) {
    const pw = validatePassword(b.password);
    if (!pw.ok) return send(res, 400, { error: pw.reason });
    // 비밀번호가 바뀌면 지문이 달라져 이미 발급된 세션도 즉시 무효가 된다
    vals.push(await hashPassword(b.password)); sets.push(`password_hash = $${vals.length}`);
  }
  const propertyIds = cleanPropertyIds(b.property_ids);
  if (propertyIds === null) return send(res, 400, { error: 'property_ids 는 목록이어야 해요' });
  if (!sets.length && propertyIds === undefined) return send(res, 400, { error: '바꿀 내용이 없어요' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [exists] } = await client.query(`SELECT 1 FROM operators WHERE id = $1 FOR UPDATE`, [id]);
    if (!exists) { await client.query('ROLLBACK'); return send(res, 404, { error: '운영자 없음' }); }
    if (sets.length) await client.query(`UPDATE operators SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`, [...vals, id]);
    if (propertyIds !== undefined) await replaceOperatorProperties(client, id, propertyIds);
    await client.query('COMMIT');
    return send(res, 200, await operatorWithProperties(db, id));
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 종료 */ }
    if (err.code === '23503') return send(res, 400, { error: '존재하지 않는 숙소가 포함돼 있어요', code: 'UNKNOWN_PROPERTY' });
    throw err;
  } finally {
    client.release();
  }
}
