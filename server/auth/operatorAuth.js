/**
 * 운영자 인증 (D-033) — 운영자 1명이 비밀번호로 로그인하면 서명된 쿠키를 받는다.
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

export function createSessionToken(env = process.env, nowMs = Date.now()) {
  const payload = b64u(JSON.stringify({ role: 'operator', exp: Math.floor(nowMs / 1000) + SESSION_TTL_SEC }));
  return `${payload}.${sign(payload, env.PROPOS_SESSION_SECRET)}`;
}

export function verifySessionToken(token, env = process.env, nowMs = Date.now()) {
  if (typeof token !== 'string' || !env.PROPOS_SESSION_SECRET) return false;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return false;
  if (!safeEqual(sig, sign(payload, env.PROPOS_SESSION_SECRET))) return false;
  try {
    const { role, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return role === 'operator' && Number.isFinite(exp) && exp * 1000 > nowMs;
  } catch {
    return false;
  }
}

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

export function isAuthenticated(req, env = process.env, nowMs = Date.now()) {
  return verifySessionToken(parseCookies(req?.headers?.cookie)[COOKIE_NAME], env, nowMs);
}

function deny(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * 운영자 전용 엔드포인트의 문지기. 통과면 true, 막았으면 응답까지 보내고 false.
 * 사용: if (!guardOperator(req, res)) return;
 */
export function guardOperator(req, res, env = process.env, nowMs = Date.now(), log = console.warn) {
  const mode = authMode(env);
  if (mode === 'off') return true;
  if (mode === 'enforce' && !authConfigured(env)) {
    deny(res, 500, { error: '인증 설정이 완료되지 않았어요 (PROPOS_ADMIN_PASSWORD / PROPOS_SESSION_SECRET)' });
    return false;
  }
  if (authConfigured(env) && isAuthenticated(req, env, nowMs)) return true;
  if (mode === 'log') {
    log(`[auth:log] 로그인 없는 호출 ${req?.method ?? '?'} ${String(req?.url ?? '').split('?')[0]}`);
    return true;
  }
  deny(res, 401, { error: '로그인이 필요해요', code: 'AUTH_REQUIRED' });
  return false;
}

// 로그인 시도 제한 — 서버리스 인스턴스별 메모리라 완전하지 않은 최선책 (인스턴스가 늘면 한도도 늘어남)
const attempts = new Map();
export const LOGIN_MAX_FAILS = 5;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;
export function loginThrottled(key, nowMs = Date.now()) {
  const rec = attempts.get(key);
  if (!rec || nowMs - rec.first > LOGIN_WINDOW_MS) return false;
  return rec.fails >= LOGIN_MAX_FAILS;
}
export function recordLoginResult(key, ok, nowMs = Date.now()) {
  if (ok) { attempts.delete(key); return; }
  const rec = attempts.get(key);
  if (!rec || nowMs - rec.first > LOGIN_WINDOW_MS) attempts.set(key, { first: nowMs, fails: 1 });
  else rec.fails += 1;
}
export function _resetLoginAttempts() { attempts.clear(); }

/** /api/auth/* 처리: me / login / logout */
export async function handleAuthRoute(action, req, res, env = process.env, nowMs = Date.now()) {
  const mode = authMode(env);
  const secure = !/^http:\/\/localhost/.test(String(req?.headers?.origin ?? ''));
  if (action === 'me') {
    if (req.method !== 'GET') return deny(res, 405, { error: 'GET only' });
    return deny(res, 200, {
      required: mode === 'enforce',
      mode,
      authenticated: authConfigured(env) && isAuthenticated(req, env, nowMs),
    });
  }
  if (req.method !== 'POST') return deny(res, 405, { error: 'POST only' });
  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearedCookie({ secure }));
    return deny(res, 200, { ok: true });
  }
  if (action === 'login') {
    if (!authConfigured(env)) return deny(res, 503, { error: '로그인이 아직 설정되지 않았어요' });
    const ip = String(req.headers?.['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
    if (loginThrottled(ip, nowMs)) return deny(res, 429, { error: '시도가 너무 많아요. 잠시 후 다시 해주세요.' });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* 빈 본문 취급 */ }
    const ok = checkPassword(body.password, env);
    recordLoginResult(ip, ok, nowMs);
    if (!ok) {
      await new Promise((r) => setTimeout(r, 400)); // 무차별 대입을 느리게
      return deny(res, 401, { error: '비밀번호가 맞지 않아요' });
    }
    res.setHeader('Set-Cookie', sessionCookie(createSessionToken(env, nowMs), { secure }));
    return deny(res, 200, { ok: true });
  }
  return deny(res, 404, { error: 'Not found' });
}
