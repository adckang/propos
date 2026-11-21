// s133 — 운영 응답의 CSP(콘텐츠 보안 정책, vercel.json). Report-Only 관찰 뒤 2026-11-21 RF-47에서 차단으로 전환.
// 실제 브라우저에서 정책대로 열리고 막히는지·모든 화면이 위반 0 인지는 smoke(tests/smoke/app.smoke.spec.js)가 같은 정책을
// 차단 모드로 걸고 확인한다. 여기서는 npm test 에서 바로 보이는 것만: 정책의 뼈대와, 빌드된 화면에 인라인 스크립트가 없는지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { productionCsp, parseCsp } from '../helpers/cspPolicy.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('모든 경로에 차단 CSP가 하나 붙는다', () => {
  const { key } = productionCsp();
  assert.equal(key, 'Content-Security-Policy');
});

test('스크립트는 같은 사이트와 Clarity 만 — 인라인·eval·와일드카드 출처를 열지 않는다', () => {
  const policy = parseCsp(productionCsp().value);
  assert.deepEqual(policy['script-src'], ["'self'", 'https://*.clarity.ms', 'https://c.bing.com']);
  assert.deepEqual(policy['default-src'], ["'self'"]);
  for (const [name, sources] of Object.entries(policy)) {
    for (const loose of ['*', 'https:', 'http:', "'unsafe-eval'"]) assert.ok(!sources.includes(loose), `${name} ${loose}`);
    if (name !== 'style-src') assert.ok(!sources.includes("'unsafe-inline'"), `${name} 'unsafe-inline' — 인라인 허용은 스타일만`);
  }
});

test('플러그인·base 바꿔치기·다른 사이트에 끼워 넣기·다른 곳으로 폼 보내기를 막는다', () => {
  const policy = parseCsp(productionCsp().value);
  assert.deepEqual(policy['object-src'], ["'none'"]);
  assert.deepEqual(policy['frame-ancestors'], ["'none'"]);
  assert.deepEqual(policy['base-uri'], ["'self'"]);
  assert.deepEqual(policy['form-action'], ["'self'"]);
});

test('화면 진입 HTML(소스·빌드)에는 인라인 스크립트가 없다 — 정책이 인라인 스크립트를 막으므로', () => {
  for (const file of ['index.html', 'dist/index.html']) {
    const html = readFileSync(ROOT + file, 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length > 0, file);
    for (const [, attrs, body] of scripts) {
      assert.match(attrs, /\bsrc=/, `${file}: src 없는 <script>`);
      assert.equal(body.trim(), '', `${file}: <script> 안에 코드`);
    }
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${file}: onclick 같은 인라인 이벤트 속성`);
  }
});
