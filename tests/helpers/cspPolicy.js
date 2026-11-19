// 운영 응답의 CSP(콘텐츠 보안 정책) — 정본은 vercel.json 의 "/(.*)" 헤더 하나다.
// 화면 시험(smoke)이 같은 정책을 읽어 미리보기 서버 응답에 붙이므로, 정책을 바꾸면 시험도 그 정책으로 돈다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VERCEL_JSON = fileURLToPath(new URL('../../vercel.json', import.meta.url));
export const CSP_HEADER_KEYS = ['Content-Security-Policy', 'Content-Security-Policy-Report-Only'];

/** @returns {{ key: string, value: string }} vercel.json 에서 모든 경로("/(.*)")에 붙는 CSP 헤더 */
export function productionCsp() {
  const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8'));
  const found = (config.headers ?? [])
    .filter(rule => rule.source === '/(.*)')
    .flatMap(rule => rule.headers ?? [])
    .filter(header => CSP_HEADER_KEYS.includes(header.key));
  if (found.length !== 1) throw new Error(`vercel.json 의 "/(.*)" CSP 헤더는 하나여야 한다 (지금 ${found.length}개)`);
  return found[0];
}

/** "a b; c d" → { a: ['b'], c: ['d'] } */
export function parseCsp(value) {
  return Object.fromEntries(value.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const [name, ...sources] = part.split(/\s+/);
    return [name.toLowerCase(), sources];
  }));
}
