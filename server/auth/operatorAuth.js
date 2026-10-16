/**
 * 로그인·세션 (D-033, D-034) — 로그인하면 서명된 쿠키를 받는다.
 *   슈퍼관리자: 이메일 없이 환경변수 비밀번호 → role 'admin' (전부 볼 수 있음)
 *   운영자: 이메일+비밀번호(DB 계정) → role 'operator' + sub(계정 id), 배정된 숙소만 본다
 *
 * 단계적 적용: PROPOS_AUTH_MODE
 *   off(기본/미설정)  아무것도 검사하지 않는다 — 배포해도 동작이 바뀌지 않는다
 *   log               통과시키되 로그인 안 된 호출을 경고로 남긴다 (누가 호출하는지 먼저 확인)
 *   enforce           로그인 안 된 호출은 401
 *
 * 환경변수: PROPOS_AUTH_MODE / PROPOS_ADMIN_PASSWORD / PROPOS_SESSION_SECRET
 * enforce 인데 비밀번호·서명키가 없으면 모두 거절한다 (설정 실수로 문이 열리는 쪽보다 닫히는 쪽이 안전).
 * 순수 함수 + node:crypto 만 쓴다 — 테스트에서 env/req 를 주입해 검증한다.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { authenticateOperator, resolveScope, ADMIN_SCOPE } from './operatorAccounts.js';

export const COOKIE_NAME = 'propos_session';
export const SESSION_TTL_SEC = 12 * 60 * 60; // 12시간

export function authMode(env = process.env) {
  const m = String(env.PROPOS_AUTH_MODE ?? 'off').trim().toLowerCase();
  return m === 'enforce' || m === 'log' ? m : 'off';
}

export function authConfigured(env = process.env) {
  return Boolean(env.PROPOS_ADMIN_PASSWORD) && String(env.PROPOS_SESSION_SECRET ?? '').length >= 16;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload, secret) => createHmac('sha256', secret).update(payload).digest('base64url');

/** 값이 같은지 시간 일정하게 비교 (해시로 길이를 맞춘 뒤 비교) */
export function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(input, env = process.env) {
  if (!env.PROPOS_ADMIN_PASSWORD || typeof input !== 'string' || !input) return false;
  return safeEqual(input, env.PROPOS_ADMIN_PASSWORD);
}

export function createSessionToken(env = process.env, nowMs = Date.now(), { role = 'admin', sub = null, ph = null } = {}) {
  const payload = b64u(JSON.stringify({ role, sub, ph, exp: Math.floor(nowMs / 1000) + SESSION_TTL_SEC }));
  return `${payload}.${sign(payload, env.PROPOS_SESSION_SECRET)}`;
}

/** 서명·만료를 확인하고 { role, sub, ph, exp } 를 돌려준다. 실패하면 null. (ph = 운영자 비밀번호 지문 — 재설정하면 옛 세션이 무효) */
export function parseSessionToken(token, env = process.env, nowMs = Date.now()) {
  if (typeof token !== 'string' || !env.PROPOS_SESSION_SECRET) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, sign(payload, env.PROPOS_SESSION_SECRET))) return null;
  try {
    const { role, sub, ph, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isFinite(exp) || exp * 1000 <= nowMs) return null;
    if (role === 'admin') return { role, sub: null, ph: null, exp };
    if (role === 'operator' && typeof sub === 'string' && sub && typeof ph === 'string' && ph) return { role, sub, ph, exp };
    return null;
  } catch {
    return null;
  }
}

export const verifySessionToken = (token, env = process.env, nowMs = Date.now()) => parseSessionToken(token, env, nowMs) !== null;

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** HttpOnly(스크립트가 못 읽음) + Secure + SameSite=Strict(다른 사이트가 보내는 요청에 안 실림) */
export function sessionCookie(token, { secure = true } = {}) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SEC}${secure ? '; Secure' : ''}`;
}
export function clearedCookie({ secure = true } = {}) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function getSession(req, env = process.env, nowMs = Date.now()) {
  return parseSessionToken(parseCookies(req?.headers?.cookie)[COOKIE_NAME], env, nowMs);
}

export function isAuthenticated(req, env = process.env, nowMs = Date.now()) {
  return getSession(req, env, nowMs) !== null;
}

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// enforce 인데 설정이 없으면 전부 거절 — 공통 선검사. 막았으면 true(응답까지 보냄).
function misconfigured(res, env) {
  if (authMode(env) === 'enforce' && !authConfigured(env)) {
    reply(res, 500, { error: '인증 설정이 완료되지 않았어요 (PROPOS_ADMIN_PASSWORD / PROPOS_SESSION_SECRET)' });
    return true;
  }
  return false;
}
const logUnauthed = (req, log) => log(`[auth:log] 로그인 없는 호출 ${req?.method ?? '?'} ${String(req?.url ?? '').split('?')[0]}`);

/**
 * 관리자 전용 엔드포인트의 문지기(스마트홈·CCTV·숙소 설정·계정 관리 등). 통과면 true, 막았으면 응답까지 보내고 false.
 *   로그인 없음 → 401, 운영자(숙소 제한 계정) → 403.   사용: if (!guardAdmin(req, res)) return;
 */
export function guardAdmin(req, res, env = process.env, nowMs = Date.now(), log = console.warn) {
  const mode = authMode(env);
  if (mode === 'off') return true;
  if (misconfigured(res, env)) return false;
  const session = authConfigured(env) ? getSession(req, env, nowMs) : null;
  if (session?.role === 'admin') return true;
  if (session) { reply(res, 403, { error: '관리자만 할 수 있어요', code: 'FORBIDDEN' }); return false; }
  if (mode === 'log') { logUnauthed(req, log); return true; }
  reply(res, 401, { error: '로그인이 필요해요', code: 'AUTH_REQUIRED' });
  return false;
}

/**
 * 계정 관리 같은 "절대 열려 있으면 안 되는" 곳의 문지기 — off/log 모드에서도 **진짜 관리자 세션**이 있어야 통과한다.
 * (일반 문지기는 켜기 전 단계에서 동작을 안 바꾸려고 off/log 를 통과시키지만, 계정 생성·재설정까지 열어 두면
 *  로그인을 켜기 전에 누구나 영구 계정을 만들 수 있다.) 로그인 설정이 없으면 503.
 */
export function requireAdminSession(req, res, env = process.env, nowMs = Date.now()) {
  if (!authConfigured(env)) {
    reply(res, 503, { error: '관리자 로그인이 설정되지 않아 계정을 관리할 수 없어요', code: 'AUTH_NOT_CONFIGURED' });
    return false;
  }
  const session = getSession(req, env, nowMs);
  if (session?.role === 'admin') return true;
  if (session) { reply(res, 403, { error: '관리자만 할 수 있어요', code: 'FORBIDDEN' }); return false; }
  reply(res, 401, { error: '로그인이 필요해요', code: 'AUTH_REQUIRED' });
  return false;
}

/**
 * 숙소 데이터를 내려주는 엔드포인트의 문지기. 먼저 "누구인지"를 확인하고 볼 수 있는 숙소 범위를 돌려준다.
 *   관리자 → ADMIN_SCOPE(전부) / 운영자 → 배정된 숙소만 / 로그인 없음·정지된 계정 → 401 후 null
 *   off·log 모드에서는 제한하지 않는다(ADMIN_SCOPE) — 켜기 전에는 동작이 바뀌지 않는다.
 *   사용: const scope = await requireScope(req, res, db); if (!scope) return;
 */
export async function requireScope(req, res, db, env = process.env, nowMs = Date.now(), log = console.warn) {
  const mode = authMode(env);
  if (mode === 'off') return ADMIN_SCOPE;
  if (misconfigured(res, env)) return null;
  const session = authConfigured(env) ? getSession(req, env, nowMs) : null;
  if (!session) {
    if (mode === 'log') { logUnauthed(req, log); return ADMIN_SCOPE; }
    reply(res, 401, { error: '로그인이 필요해요', code: 'AUTH_REQUIRED' });
    return null;
  }
  const scope = await resolveScope(session, db); // db 가 함수면 resolveScope 가 운영자 세션일 때만 호출한다(관리자는 연결을 만들지 않는다)
  if (!scope) { reply(res, 401, { error: '로그인이 필요해요', code: 'AUTH_REQUIRED' }); return null; } // 정지·삭제된 계정
  return scope;
}

// 로그인 시도 제한 — 서버리스 인스턴스별 메모리라 완전하지 않은 최선책 (인스턴스가 늘면 한도도 늘어남).
//  · 계정(이메일)별: 5회 실패 → 10분 잠금. 그 계정 로그인에 성공하면 그 계정 카운터만 지운다.
//  · IP 별: 20회 실패 → 10분 잠금. 다른 계정으로 로그인에 성공해도 **지우지 않는다**
//    (자기 계정으로 성공해 카운터를 비운 뒤 남의 계정을 계속 추측하는 우회 방지).
const attempts = new Map();
export const LOGIN_MAX_FAILS = 5;
export const LOGIN_MAX_FAILS_PER_IP = 20;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;
export function loginThrottled(key, nowMs = Date.now(), max = LOGIN_MAX_FAILS) {
  const rec = attempts.get(key);
  if (!rec || nowMs - rec.first > LOGIN_WINDOW_MS) return false;
  return rec.fails >= max;
}
export function recordLoginResult(key, ok, nowMs = Date.now()) {
  if (ok) { attempts.delete(key); return; }
  const rec = attempts.get(key);
  if (!rec || nowMs - rec.first > LOGIN_WINDOW_MS) attempts.set(key, { first: nowMs, fails: 1 });
  else rec.fails += 1;
}
export function _resetLoginAttempts() { attempts.clear(); }

/** /api/auth/* 처리: me / login / logout.  db 는 운영자 계정 로그인·정지 확인에만 쓴다(없으면 관리자 로그인만 가능). */
export async function handleAuthRoute(action, req, res, env = process.env, nowMs = Date.now(), db = null) {
  const mode = authMode(env);
  const secure = !/^http:\/\/localhost/.test(String(req?.headers?.origin ?? ''));
  if (action === 'me') {
    if (req.method !== 'GET') return reply(res, 405, { error: 'GET only' });
    const session = authConfigured(env) ? getSession(req, env, nowMs) : null;
    let scope = null;
    if (session) {
      try { scope = await resolveScope(session, db); } catch { scope = null; }
    }
    return reply(res, 200, {
      required: mode === 'enforce',
      mode,
      authenticated: scope !== null,
      role: scope ? session.role : null,
    });
  }
  if (req.method !== 'POST') return reply(res, 405, { error: 'POST only' });
  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearedCookie({ secure }));
    return reply(res, 200, { ok: true });
  }
  if (action === 'login') {
    if (!authConfigured(env)) return reply(res, 503, { error: '로그인이 아직 설정되지 않았어요' });
    const ip = String(req.headers?.['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* 빈 본문 취급 */ }

    // 이메일이 비어 있으면 슈퍼관리자(환경변수 비밀번호), 있으면 운영자(DB 계정)
    const wantsOperator = typeof body.email === 'string' && body.email.trim() !== '';
    const ipKey = `ip:${ip}`;
    const acctKey = `acct:${wantsOperator ? body.email.trim().toLowerCase().slice(0, 254) : '(admin)'}`;
    if (loginThrottled(ipKey, nowMs, LOGIN_MAX_FAILS_PER_IP) || loginThrottled(acctKey, nowMs, LOGIN_MAX_FAILS)) {
      return reply(res, 429, { error: '시도가 너무 많아요. 잠시 후 다시 해주세요.' });
    }
    let session = null;
    if (!wantsOperator) {
      if (checkPassword(body.password, env)) session = { role: 'admin', sub: null };
    } else if (db) {
      try {
        const op = await authenticateOperator(db, body.email, body.password);
        if (op) session = { role: 'operator', sub: op.id, ph: op.ph };
      } catch (err) {
        console.error('[auth] 운영자 로그인 조회 실패:', err.message);
        return reply(res, 503, { error: '지금은 로그인할 수 없어요. 잠시 후 다시 해주세요.' });
      }
    }
    recordLoginResult(acctKey, session !== null, nowMs);
    if (!session) recordLoginResult(ipKey, false, nowMs); // 성공해도 IP 카운터는 지우지 않는다
    if (!session) {
      await new Promise((r) => setTimeout(r, 400)); // 무차별 대입을 느리게
      return reply(res, 401, { error: '이메일 또는 비밀번호가 맞지 않아요' }); // 어느 쪽이 틀렸는지 알려주지 않는다
    }
    res.setHeader('Set-Cookie', sessionCookie(createSessionToken(env, nowMs, session), { secure }));
    return reply(res, 200, { ok: true, role: session.role });
  }
  return reply(res, 404, { error: 'Not found' });
}
