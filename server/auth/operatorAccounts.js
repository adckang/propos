/**
 * 운영자 계정 + 숙소 범위 (D-034)
 *
 * 원칙: 요청이 오면 먼저 "누구인지"를 확인하고, 그 사람 몫의 숙소만 DB 에서 가져온다.
 *   scope = { all: true }                       슈퍼관리자 — 전부
 *   scope = { all: false, propertyIds: [...] }  운영자 — 배정된 숙소만 (배정 없으면 빈 배열 = 아무것도 안 보임)
 * db 는 pg Pool 인터페이스({ query })를 주입한다. 이 파일은 그 외에 아무것도 import 하지 않는다(node:crypto 만).
 */
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEYLEN = 32;
const MIN_PASSWORD_LENGTH = 10;

export const ADMIN_SCOPE = Object.freeze({ all: true });
export const NO_SCOPE = Object.freeze({ all: false, propertyIds: Object.freeze([]) });

export function normalizeEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) && email.length <= 254 ? email : null;
}

export function validatePassword(raw) {
  if (typeof raw !== 'string' || raw.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요` };
  if (raw.length > 200) return { ok: false, reason: '비밀번호가 너무 길어요' };
  return { ok: true };
}

/** scrypt$<salt hex>$<hash hex> */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// 저장 형식이 정확히 scrypt$<16바이트 salt hex>$<32바이트 hash hex> 일 때만 비교한다.
// (손상된 해시가 "빈 버퍼 == 빈 버퍼"로 통과해 아무 비밀번호나 로그인되던 문제 방지 — 형식이 틀리면 항상 실패)
const STORED_HASH_RE = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/;

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !STORED_HASH_RE.test(String(stored ?? ''))) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEYLEN);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * 비밀번호 해시의 지문(해시의 해시, 앞 16자). 로그인 시 세션에 넣고 요청마다 DB 의 현재 값과 비교한다 —
 * 비밀번호를 재설정하면 지문이 달라져 이미 발급된 세션이 즉시 무효가 된다(정지만이 유일한 차단 수단이던 문제).
 */
export const passwordFingerprint = (hash) => createHash('sha256').update(String(hash ?? '')).digest('hex').slice(0, 16);

// 없는 이메일이어도 같은 시간이 걸리게 하는 더미 해시 (계정 존재 여부를 응답 시간으로 알아내는 것을 막는다)
let dummyHash = null;
async function burnTime(password) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}

/** 이메일+비밀번호 확인. 성공하면 { id, email, name }, 아니면 null. 비활성 계정은 거절. */
export async function authenticateOperator(db, email, password) {
  const normalized = normalizeEmail(email);
  if (!normalized || typeof password !== 'string' || !password) { await burnTime(String(password ?? '')); return null; }
  const { rows } = await db.query(
    'SELECT id, email, name, password_hash, active FROM operators WHERE email = $1',
    [normalized]
  );
  const row = rows[0];
  if (!row) { await burnTime(password); return null; }
  const ok = await verifyPassword(password, row.password_hash);
  return ok && row.active ? { id: row.id, email: row.email, name: row.name, ph: passwordFingerprint(row.password_hash) } : null;
}

/**
 * 운영자의 상태와 볼 수 있는 숙소를 한 번의 쿼리로 읽는다(왕복 1회, 읽는 도중 상태가 바뀌는 틈 없음).
 * 계정이 없거나 비활성이면 null. 반환: { passwordHash, propertyIds }
 */
export async function loadOperatorAccess(db, operatorId) {
  const { rows } = await db.query(
    `SELECT o.active, o.password_hash,
            COALESCE(array_agg(op.property_id ORDER BY op.property_id) FILTER (WHERE op.property_id IS NOT NULL), '{}') AS property_ids
       FROM operators o LEFT JOIN operator_properties op ON op.operator_id = o.id
      WHERE o.id = $1
      GROUP BY o.id`,
    [operatorId]
  );
  const row = rows[0];
  if (!row || !row.active) return null;
  return { passwordHash: row.password_hash, propertyIds: row.property_ids ?? [] };
}

/**
 * 세션 → 범위. 요청마다 DB 에서 다시 읽으므로 관리자가 배정을 바꾸거나 계정을 정지하거나 비밀번호를 재설정하면
 * 즉시 반영된다. 세션이 없거나 계정이 정지됐거나 비밀번호가 바뀐 뒤 발급된 적 없는 세션이면 null.
 */
export async function resolveScope(session, db) {
  if (!session) return null;
  if (session.role === 'admin') return ADMIN_SCOPE;
  if (session.role === 'operator' && session.sub) {
    const access = await loadOperatorAccess(db, session.sub);
    if (!access) return null;
    if (!session.ph || session.ph !== passwordFingerprint(access.passwordHash)) return null;
    return { all: false, propertyIds: access.propertyIds };
  }
  return null;
}

export const isAdminScope = (scope) => scope?.all === true;

/**
 * 요청된 숙소 id 들(없으면 전체 요청)을 범위와 교집합. 항상 배열을 돌려준다.
 *   관리자: requested 그대로(없으면 null = 제한 없음)
 *   운영자: 허용 숙소 ∩ requested  — 비어 있으면 빈 배열(= 쿼리가 0건)
 */
export function scopePropertyIds(scope, requested = null) {
  if (!scope) return [];
  if (scope.all) return requested && requested.length ? requested : null;
  const allowed = new Set(scope.propertyIds);
  return requested && requested.length ? requested.filter((id) => allowed.has(id)) : [...allowed];
}

/** 배정이 하나도 없는 운영자를 뜻하는, 어떤 숙소와도 일치하지 않는 id (빈 배열이 "전체"로 해석되는 쿼리에 대비한 안전장치) */
export const NO_ACCESS_ID = '__no_access__';

/**
 * 쿼리에 그대로 넘기는 숙소 id 필터.  null = 제한 없음(관리자만), 그 외엔 항상 1개 이상의 배열.
 * 운영자가 볼 수 있는 숙소가 없으면 [NO_ACCESS_ID] — 어떤 코드 경로에서도 0건이 나오게 한다.
 */
export function scopeQueryIds(scope, requested = null) {
  const ids = scopePropertyIds(scope, requested);
  if (ids === null) return null;
  return ids.length ? ids : [NO_ACCESS_ID];
}

/** 이 숙소를 이 범위에서 볼 수 있는가 (단건 조회·쓰기 전 확인용 — 없으면 호출부가 404 로 응답) */
export function canAccessProperty(scope, propertyId) {
  if (!scope) return false;
  return scope.all === true || scope.propertyIds.includes(propertyId);
}
