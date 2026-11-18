// ACT-08 ⑦-5: executes the actual RoomStateApp (and its internal SettingsModal) from RoomStateApp.jsx.
// Replaced: React's hook shell, the child screens (MonthlyView/PropertyListView/PropertyDetailView/
// CleaningManager — recorded as elements, not rendered), HA/weather/monitoring clients, Toast, timers,
// localStorage and HTTP. The app's own loading, selection, sync and save logic is not copied.
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const entry = resolve(root, 'src/components/v2/RoomStateApp.jsx');
const KEY = '__roomStateAppFixture';
const bundles = new Map();

export const reply = (status, body) => ({
  ok: status >= 200 && status < 300, status, statusText: `fixture ${status}`,
  json: async () => body, text: async () => JSON.stringify(body),
});

function createHooks() {
  const same = (a, b) => a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    index: 0, states: [], callbacks: [], effects: [],
    useState(initial) {
      const i = this.index++;
      if (!(i in this.states)) this.states[i] = typeof initial === 'function' ? initial() : initial;
      return [this.states[i], value => { this.states[i] = typeof value === 'function' ? value(this.states[i]) : value; }];
    },
    useCallback(fn, deps) {
      const i = this.index++;
      if (!this.callbacks[i] || !same(this.callbacks[i].deps, deps)) this.callbacks[i] = { fn, deps };
      return this.callbacks[i].fn;
    },
    useEffect(effect, deps) {
      const i = this.index++;
      const prev = this.effects[i];
      if (!prev || deps === undefined || !same(prev.deps, deps)) {
        prev?.cleanup?.();
        this.effects[i] = { deps, cleanup: effect() };
      }
    },
    unmount() { for (const e of this.effects) e?.cleanup?.(); this.effects = []; },
  };
}

async function compiled(profile) {
  if (!bundles.has(profile)) {
    const g = `globalThis[${JSON.stringify(KEY)}]`;
    const stubs = {
      react: `export const useState=v=>${g}.hooks.useState(v); export const useEffect=(e,d)=>${g}.hooks.useEffect(e,d);
        export const useCallback=(f,d)=>${g}.hooks.useCallback(f,d);`,
      'react/jsx-runtime': `export const Fragment=Symbol.for('fixture.fragment');
        export const jsx=(type,props,key)=>({type,props:key===undefined?props:{...props,key}}); export const jsxs=jsx;`,
      './MonthlyView': `export default function MonthlyView(){return null;}`,
      './PropertyListView': `export default function PropertyListView(){return null;}`,
      './PropertyDetailView': `export default function PropertyDetailView(){return null;}`,
      './CleaningManager': `export default function CleaningManager(){return null;}`,
      '../../infrastructure/haBrowserClient': `export async function getAreaData(name){${g}.areaCalls.push(name);return null;} export default {getAreaData};`,
      '../../infrastructure/weatherClient': `export async function getWeatherByDistrict(){return null;}`,
      '../../infrastructure/monitoringClient.js': `export async function requestMonitoringEvent(...a){${g}.monitoringEvents.push(a);return {roomState:null};}`,
      '../../utils/toast': `export default {show:(...a)=>${g}.toasts.push(a)};`,
    };
    const result = await build({
      entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', logLevel: 'silent',
      define: { 'import.meta.env.VITE_PROPOS_DATA_PROFILE': JSON.stringify(profile) },
      plugins: [{ name: 'room-state-app-io', setup(b) {
        b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'rsa-io' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'rsa-io' }, args => ({ contents: stubs[args.path], loader: 'js' }));
        b.onLoad({ filter: /RoomStateApp\.jsx$/ }, args => ({
          contents: readFileSync(args.path, 'utf8') + '\nexport { SettingsModal as __SettingsModal };', loader: 'jsx' }));
      } }],
    });
    // 브라우저 전역(fetch·타이머·localStorage)은 묶은 모듈 안에서만 가짜로 — 시험 실행기의 전역은 건드리지 않는다
    const prelude = `const fetch=(...a)=>${g}.fetch(...a); const setInterval=(...a)=>${g}.setInterval(...a);
      const clearInterval=(...a)=>${g}.clearInterval(...a); const localStorage=${g}.localStorage;\n`;
    bundles.set(profile, prelude + result.outputFiles[0].text);
  }
  return import('data:text/javascript;base64,' + Buffer.from(bundles.get(profile) + `\n// ${randomUUID()}`).toString('base64'));
}

/**
 * @param {object} options
 * @param {(call) => object} options.route  가짜 서버: {url, method, body, cache} → reply(...) 또는 Error
 * @param {object} [options.storage]        localStorage 초기값
 */
export async function roomStateAppFixture({ route, storage = {}, profile = 'hybrid' } = {}) {
  const calls = [], toasts = [], intervals = [], areaCalls = [], monitoringEvents = [];
  const store = new Map(Object.entries(storage));
  const io = {
    hooks: null, toasts, areaCalls, monitoringEvents,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } },
    setInterval: (fn, ms) => { intervals.push({ fn, ms, cleared: false }); return intervals.length; },
    clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    async fetch(url, options = {}) {
      const call = { url: String(url), method: options.method ?? 'GET', cache: options.cache,
        body: options.body ? JSON.parse(options.body) : undefined };
      calls.push(call);
      const result = route(call);
      if (result instanceof Error) throw result;
      if (!result) throw new Error(`Unexpected app request: ${call.method} ${call.url}`);
      return result;
    },
  };
  if (globalThis[KEY]) throw new Error('roomStateAppFixture: one app at a time');
  globalThis[KEY] = io;
  const mod = await compiled(profile);
  const app = createHooks(), modal = createHooks();
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
  const fixture = {
    calls, toasts, intervals, areaCalls, store,
    render() { io.hooks = app; app.index = 0; return mod.default({ onBack: () => {} }); },
    /** 렌더 → 비동기 작업 → 다시 렌더를 반복해 화면이 더 바뀌지 않을 때까지 */
    async settle(rounds = 6) { let tree; for (let i = 0; i < rounds; i++) { tree = fixture.render(); await flush(); } return fixture.render(); },
    renderModal(props) { io.hooks = modal; modal.index = 0; return mod.__SettingsModal(props); },
    flush,
    restore() { app.unmount(); modal.unmount(); delete globalThis[KEY]; },
  };
  return fixture;
}

export function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (node == null || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
export const findElement = (tree, name) => nodes(tree).find(n => typeof n.type === 'function' && n.type.name === name) ?? null;
export const text = (node) => {
  const walk = n => Array.isArray(n) ? n.flatMap(walk) : n == null || typeof n === 'boolean' ? [] : typeof n !== 'object' ? [String(n)] : walk(n.props?.children);
  return walk(node).join(' ').replace(/\s+/g, ' ').trim();
};
