/**
 * apiHandler — Vercel 함수(api/*.js 의 default handler)를 가짜 req/res 로 직접 호출하는 공용 도우미.
 * 실제 핸들러 코드를 그대로 돌려 상태 코드·응답 본문을 단언한다.
 *
 * 안전장치: 실제 DB 에 닿지 않도록 POSTGRES_URL 을 닫힌 포트로 바꾸고, 인증은 끈 상태(off)로 호출한다.
 * 호출이 끝나면 환경변수를 원래대로 되돌린다.
 */
const UNREACHABLE_DB = 'postgres://nobody@127.0.0.1:1/none';

export async function callHandler(handler, url, { method = 'GET', body = undefined, query = undefined, env = {}, silent = true } = {}) {
  const saved = {};
  const nextEnv = { POSTGRES_URL: UNREACHABLE_DB, PROPOS_AUTH_MODE: 'off', ...env };
  for (const [key, value] of Object.entries(nextEnv)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const [, qs = ''] = url.split('?');
  // Vercel 처럼 같은 키가 반복되면 배열로 (property_ids=A&property_ids=B, 경로 슬러그 배열 등)
  const parsedQuery = query ?? [...new URLSearchParams(qs)].reduce((acc, [key, value]) => {
    acc[key] = key in acc ? [].concat(acc[key], value) : value;
    return acc;
  }, {});
  let status = 0;
  let json = null;
  const headers = {};
  const res = {
    status(code) { status = code; return this; },
    // Node 스타일(res.statusCode = 403; res.end(JSON))로 응답하는 핸들러도 같은 방식으로 읽는다
    get statusCode() { return status; },
    set statusCode(code) { status = code; },
    json(payload) { json = payload; return this; },
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(payload = '') {
      if (payload) { try { json = JSON.parse(payload); } catch { json = payload; } }
      return this;
    },
  };
  const originalError = console.error;
  if (silent) console.error = () => {};
  try {
    await handler({ method, url, query: parsedQuery, headers: {}, body }, res);
  } finally {
    console.error = originalError;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  return { status, json, headers };
}
