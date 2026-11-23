/**
 * s146 — RF-54: 데모의 청소 관리 탭(직원 승인·청소자·청소 일정)은 영어 오류 대신 안내 줄
 * (사용자 결정 2026-11-24, DEC-20 ③과 같은 방식)
 *
 * 데모 API는 담당자·일정 조회를 403("demo profile is read-only")으로 막는다. 그 세 탭은
 * 데모에서 불러오기를 하지 않고 회색 안내 줄을 보인다. 숙소 설정 탭은 데모에서도 동작하므로 그대로.
 *
 * 실제 CleaningManager를 묶어 서버 렌더링한다(효과·요청은 실행되지 않는다 — 첫 화면에 무엇이 그려지는지만 본다).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(ROOT, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NOTICE = '데모에서는 이 화면을 쓸 수 없어요';
let CleaningManager;

before(async () => {
  const out = await build({
    entryPoints: [join(ROOT, 'src/components/v2/CleaningManager.jsx')],
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime'],
  });
  // react 를 저장소의 node_modules 에서 찾도록 저장소 안에 임시로 쓰고 바로 지운다
  const tmp = join(ROOT, `node_modules/.s146-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(tmp, out.outputFiles[0].text);
  globalThis.window ??= globalThis; // toast.js 가 불러올 때 window.Toast 를 단다
  try { ({ default: CleaningManager } = await import(pathToFileURL(tmp).href)); } finally { unlinkSync(tmp); }
});

const render = (props) => renderToStaticMarkup(React.createElement(CleaningManager, { syncConfig: null, onBack() {}, onDataChanged() {}, ...props }));

describe('RF-54 데모 청소 관리 탭 안내', () => {
  test('데모에서 처음 열리는 탭(청소자)은 목록 대신 안내 줄을 그린다', () => {
    const html = render({ demo: true });
    assert.ok(html.includes(NOTICE), '안내 줄이 없음');
    assert.ok(!html.includes('청소자 목록'), '데모인데 청소자 목록 화면을 그림(불러오기 실패 토스트가 뜬다)');
  });

  test('데모가 아니면 안내 줄 없이 원래 청소자 목록을 그린다', () => {
    const html = render({ demo: false });
    assert.ok(!html.includes(NOTICE));
    assert.ok(html.includes('청소자 목록'));
  });

  test('막는 탭은 직원 승인·청소자·청소 일정 셋 — 숙소 설정·절차 점검은 포함하지 않는다', () => {
    const src = readFileSync(join(ROOT, 'src/components/v2/CleaningManager.jsx'), 'utf8');
    assert.match(src, /const DEMO_BLOCKED_TABS = new Set\(\['approval', 'cleaners', 'jobs'\]\);/);
    // 세 패널은 데모 분기의 "아닐 때" 쪽에서만 그려진다
    const branch = src.slice(src.indexOf('{demo && DEMO_BLOCKED_TABS.has(tab) ? ('));
    assert.ok(branch.length > 0 && src.includes('{demo && DEMO_BLOCKED_TABS.has(tab) ? ('), '데모 분기 없음');
    const elseAt = branch.indexOf(') : (');
    for (const panel of ['<WorkerApprovalPanel />', '<CleanersPanel />', '<JobsPanel />']) {
      assert.ok(branch.indexOf(panel) > elseAt, `${panel} 이 데모 분기 밖에 있음`);
    }
  });

  test('안내 줄은 절차 점검과 같은 부품(Line, info)이다', () => {
    const check = readFileSync(join(ROOT, 'src/components/v2/CleaningProcessCheck.jsx'), 'utf8');
    assert.match(check, /export function Line\(/);
    const src = readFileSync(join(ROOT, 'src/components/v2/CleaningManager.jsx'), 'utf8');
    assert.match(src, /import CleaningProcessCheck, \{ Line \} from '\.\/CleaningProcessCheck\.jsx';/);
    assert.match(src, new RegExp(`<Line level="info" title="${NOTICE}"`));
  });
});
