/**
 * renderComponent — JSX 컴포넌트를 실제로 렌더링해서 "화면이 무엇을 보여주고 하위 부품에 무엇을 넘기는지"를
 * 검증하는 공용 도우미 (DOM 없이, node:test 에서).
 *
 * 왜: 레포트 화면 테스트 상당수가 "소스에 이 글자가 있다"(정규식)만 확인했다 — 동작이 틀려도 통과하고,
 * 이름만 바꾼 무해한 리팩터에는 깨진다. 이 도우미는 실제 컴포넌트를 실행한다.
 *
 * 동작: esbuild 로 진입 파일을 번들(react 는 프로젝트 것을 그대로 공유) → react-dom/server 로 렌더.
 * replace 로 특정 모듈을 대역으로 바꿀 수 있다 — 데이터 훅(fetch)을 고정값으로, 하위 부품을 "받은 props 기록"
 * 대역(PROBE)으로. 대역 모듈은 원래 모듈의 나머지 export(상수 등)를 그대로 유지한다.
 * 서버 렌더링이라 useEffect 는 돌지 않는다 — 효과로 가져오는 데이터는 replace 로 넣는다.
 *
 *   const { html, props } = await renderComponent('src/components/v2/reporting/SelectedPropertyReport.jsx', {...}, {
 *     replace: {
 *       'src/hooks/useReportingStats.js': { useReportingStats: () => ({ stats, summary, loading: false }) },
 *       'src/components/v2/reporting/ReportPanel.jsx': PROBE,
 *     },
 *   });
 *   props('src/components/v2/reporting/ReportPanel.jsx')  // → 그 부품이 받은 props 배열(렌더 순서)
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT_DIR = path.join(ROOT, 'node_modules', '.cache', 'propos-test-bundles');
const stripExt = file => file.replace(/\.(jsx|js|mjs)$/, '');
const keyOf = rel => stripExt(path.resolve(ROOT, rel));

/** 하위 부품 대역: 받은 props 를 기록하고 children 만 그린다 (감싸는 부품 안쪽도 계속 렌더링되게). */
export const PROBE = Object.freeze({ __probe: true });

const loaded = new Map();

async function bundle(entryRel, replace, stdinContents = null) {
  const replacedKeys = new Map(Object.entries(replace).map(([rel, spec]) => [keyOf(rel), { rel, spec }]));
  const signature = JSON.stringify([entryRel, stdinContents, [...replacedKeys.values()].map(({ rel, spec }) =>
    [rel, spec === PROBE ? 'PROBE' : Object.keys(spec).sort()])]);
  if (loaded.has(signature)) return loaded.get(signature);

  const plugin = {
    name: 'propos-test-replace',
    setup(b) {
      b.onResolve({ filter: /\?original$/ }, args => ({ path: args.path.replace(/\?original$/, ''), suffix: '?original' }));
      b.onLoad({ filter: /\.(jsx|js|mjs)$/ }, args => {
        if (args.suffix === '?original') return undefined;
        const hit = replacedKeys.get(stripExt(args.path));
        if (!hit) return undefined;
        const names = hit.spec === PROBE ? ['default'] : Object.keys(hit.spec);
        const registry = `globalThis.__proposRender.replace[${JSON.stringify(hit.rel)}]`;
        const lines = [`export * from ${JSON.stringify(`${args.path}?original`)};`];
        for (const name of names) {
          const fn = `function ${name === 'default' ? '__replacedDefault' : name}(...args) { return ${registry}[${JSON.stringify(name)}](...args); }`;
          lines.push(name === 'default' ? `export default ${fn}` : `export ${fn}`);
        }
        return { contents: lines.join('\n'), loader: 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };

  const result = await build({
    ...(stdinContents
      ? { stdin: { contents: stdinContents, resolveDir: ROOT, loader: 'jsx', sourcefile: 'hook-host.jsx' } }
      : { entryPoints: [path.resolve(ROOT, entryRel)] }),
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    packages: 'external', // node_modules 패키지는 번들하지 않는다 — react 를 테스트와 같은 인스턴스로 공유
    define: { 'import.meta.env': '{"MODE":"test","DEV":false,"PROD":false}' },
    plugins: [plugin],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${createHash('sha1').update(signature + code).digest('hex').slice(0, 16)}.mjs`);
  if (!existsSync(file)) writeFileSync(file, code);
  const mod = await import(pathToFileURL(file).href);
  loaded.set(signature, mod);
  return mod;
}

/**
 * @param {string} entryRel  프로젝트 루트 기준 컴포넌트 파일
 * @param {object} props
 * @param {{ replace?: Record<string, object>, exportName?: string, viewportWidth?: number }} [options]
 * @returns {Promise<{ html: string, props: (rel: string) => object[], mod: object }>}
 */
export async function renderComponent(entryRel, props = {}, { replace = {}, exportName = 'default', viewportWidth = 1280 } = {}) {
  const mod = await bundle(entryRel, replace);
  const recorded = new Map();
  const registry = {};
  for (const [rel, spec] of Object.entries(replace)) {
    if (spec === PROBE) {
      registry[rel] = {
        default: received => {
          if (!recorded.has(rel)) recorded.set(rel, []);
          recorded.get(rel).push(received);
          return createElement(Fragment, null, received?.children ?? null);
        },
      };
    } else {
      registry[rel] = spec;
    }
  }
  globalThis.__proposRender = { replace: registry };
  // 서버 렌더링엔 window 가 없다 — 화면 폭을 읽는 훅(useMobile 등)이 쓰는 최소한만 둔다 (기본 데스크톱 폭)
  const hadWindow = 'window' in globalThis;
  if (!hadWindow) {
    globalThis.window = { innerWidth: viewportWidth, innerHeight: 900, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  }
  try {
    const Component = mod[exportName];
    if (typeof Component !== 'function') throw new Error(`${entryRel} 에 ${exportName} export 가 없음`);
    const html = renderToStaticMarkup(createElement(Component, props));
    return { html, props: rel => recorded.get(rel) ?? [], mod };
  } finally {
    delete globalThis.__proposRender;
    if (!hadWindow) delete globalThis.window;
  }
}

/** 렌더 결과 HTML → 사람이 읽는 글자만 (태그 제거, 공백 정리). "화면에 무엇이 보이는가" 단언용. */
export function visibleText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

/**
 * React 훅을 한 번 실행하고 그 반환값을 돌려준다 (서버 렌더링 1회 — useEffect 는 돌지 않는다).
 *   const result = await renderHook('src/hooks/usePropertySelection.js', 'usePropertySelection', [properties]);
 */
export async function renderHook(hookRel, exportName, args = [], { replace = {} } = {}) {
  const host = `
    import { ${exportName} as hook } from ${JSON.stringify(path.resolve(ROOT, hookRel))};
    export default function HookHost({ args, onResult }) { onResult(hook(...args)); return null; }
  `;
  const mod = await bundle(`hook:${hookRel}#${exportName}`, replace, host);
  let result;
  globalThis.__proposRender = { replace: Object.fromEntries(Object.entries(replace).filter(([, spec]) => spec !== PROBE)) };
  try {
    renderToStaticMarkup(createElement(mod.default, { args, onResult: value => { result = value; } }));
  } finally {
    delete globalThis.__proposRender;
  }
  return result;
}
