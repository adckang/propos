/**
 * s116 — 운영 API·청소 공용 모듈이 호출하는 함수는 모두 정의돼 있거나 가져와져 있어야 한다
 *
 * 사용자 상황(2026-11-12 리뷰에서 발견): 칸 열기를 공용 함수로 바꾸면서 화면 API 파일에 가져오기(import)를 빠뜨렸다. 단위 테스트는
 * 그 함수를 직접 끼워 넣어 실행해서 통과했지만, 운영에서는 운영자가 "발송"을 누르면 요청은 나가고 칸은 열리지 않았을 것이다
 * (호출하는 순간 "정의되지 않음" 오류). 파일을 불러올 때는 오류가 나지 않아 빌드·배포 점검도 통과한다.
 * 이 검사는 각 파일의 함수 호출을 하나씩 보고, 이름이 그 파일 안에서 정의·가져오기 되지 않았고 실행 환경 기본 함수도 아니면 실패한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;
const root = new URL('../../', import.meta.url);
const files = [
  'api/cleaning/[...slug].js', 'api/cron/[...slug].js', 'api/stats.js',
  ...readdirSync(new URL('server/cleaning/', root)).filter(f => f.endsWith('.js')).map(f => `server/cleaning/${f}`),
  'src/components/v2/CleaningProcessCheck.jsx', 'src/components/v2/CleaningManager.jsx',
  'src/domain/cleaningProcessCheckDomain.js', 'src/domain/cleaningDispatchRule.js',
];
// Node·Vercel 실행 환경이 기본으로 주는 이름
const GLOBALS = new Set(['fetch', 'console', 'Date', 'JSON', 'Promise', 'Number', 'String', 'Object', 'Array', 'Set', 'Map', 'WeakMap',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'URL', 'URLSearchParams',
  'Math', 'Boolean', 'Error', 'TypeError', 'RangeError', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Buffer',
  'structuredClone', 'RegExp', 'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder', 'Symbol', 'BigInt', 'queueMicrotask',
  'atob', 'btoa', 'Response', 'Request', 'Headers', 'crypto', 'require', 'Intl']);

for (const file of files) {
  test(`${file} — 호출하는 함수가 모두 정의·가져오기 돼 있다`, () => {
    const source = readFileSync(new URL(file, root), 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const unbound = new Set();
    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (callee.type !== 'Identifier') return;
        if (GLOBALS.has(callee.name) || path.scope.hasBinding(callee.name)) return;
        unbound.add(`${callee.name} (줄 ${callee.loc.start.line})`);
      },
    });
    assert.deepEqual([...unbound], [], `${file}: 정의·가져오기 없이 호출 — 운영에서 그 기능을 쓰는 순간 오류`);
  });
}
