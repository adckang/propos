// Executes an actual internal panel from CleaningManager.jsx (default:
// WorkerApprovalPanel; ACT-08 ⑦-2 also renders PropertyPanel). React's
// hook/runtime shell, Toast and HTTP are replaced; panel logic is not copied.
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const entry = resolve(root, 'src/components/v2/CleaningManager.jsx');

export const approvalResponse = (status, body, contentType = 'application/json') => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `fixture ${status}`,
  headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
  json: async () => body,
  text: async () => typeof body === 'string' ? body : JSON.stringify(body),
});

export async function cleaningApprovalFixture({ replies = [], panel = 'WorkerApprovalPanel', props = {} } = {}) {
  if (!/^[A-Za-z_]\w*$/.test(panel)) throw new Error(`Invalid panel name: ${panel}`);
  const key = '__cleaningApprovalFixture_' + randomUUID().replaceAll('-', '');
  const pending = [...replies];
  const calls = [], toasts = [];
  const savedFetch = globalThis.fetch;
  const sameDeps = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
  const ui = {
    hookIndex: 0, states: [], callbacks: [], effects: [],
    useState(initial) {
      const index = this.hookIndex++;
      if (!(index in this.states)) this.states[index] = typeof initial === 'function' ? initial() : initial;
      return [this.states[index], value => {
        this.states[index] = typeof value === 'function' ? value(this.states[index]) : value;
      }];
    },
    useCallback(callback, deps) {
      const index = this.hookIndex++;
      const stored = this.callbacks[index];
      if (!stored || !sameDeps(stored.deps, deps)) this.callbacks[index] = { callback, deps };
      return this.callbacks[index].callback;
    },
    useEffect(effect, deps) {
      const index = this.hookIndex++;
      const stored = this.effects[index];
      if (!stored || !sameDeps(stored.deps, deps)) {
        stored?.cleanup?.();
        this.effects[index] = { deps, cleanup: effect() };
      }
    },
    element(type, props, keyValue) {
      const next = { ...(props ?? {}) };
      if (keyValue !== undefined) next.key = keyValue;
      return typeof type === 'function' ? type(next) : { type, props: next };
    },
    render(Component) { this.hookIndex = 0; return Component(); },
    cleanup() {
      for (const effect of this.effects) effect?.cleanup?.();
      this.effects = [];
    },
  };
  globalThis[key] = { ui, toasts };
  globalThis.fetch = async (url, options = {}) => {
    const call = {
      url: String(url), method: options.method ?? 'GET',
      body: options.body ? JSON.parse(options.body) : undefined,
      headers: options.headers ?? {},
    };
    calls.push(call);
    if (!pending.length) throw new Error(`Unexpected approval HTTP request: ${call.method} ${call.url}`);
    const next = pending.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(call, calls.length) : next;
  };
  const stubs = {
    react: `const ui=globalThis[${JSON.stringify(key)}].ui;
      export const useState=value=>ui.useState(value);
      export const useCallback=(callback,deps)=>ui.useCallback(callback,deps);
      export const useEffect=(effect,deps)=>ui.useEffect(effect,deps);`,
    'react/jsx-runtime': `const ui=globalThis[${JSON.stringify(key)}].ui;
      export const Fragment=Symbol.for('fixture.fragment');
      export const jsx=(type,props,key)=>ui.element(type,props,key);
      export const jsxs=jsx;`,
    '../../utils/toast': `export default {show:(...args)=>globalThis[${JSON.stringify(key)}].toasts.push(args)};`,
    './CleaningProcessCheck.jsx': `export default function CleaningProcessCheck(){return null;} export function Line(){return null;}`,
  };
  try {
    const bundle = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm',
      jsx: 'automatic', logLevel: 'silent', plugins: [{ name: 'approval-fixture', setup(b) {
        b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path)
          ? { path: args.path, namespace: 'approval-io' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'approval-io' }, args => ({ contents: stubs[args.path], loader: 'js' }));
        b.onLoad({ filter: /CleaningManager\.jsx$/ }, args => ({
          contents: readFileSync(args.path, 'utf8') + `\nexport { ${panel} as __Panel };`, loader: 'jsx',
        }));
      } }] });
    const mod = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + `\n// ${randomUUID()}`).toString('base64'));
    return {
      calls, toasts, ui,
      get pendingReplies() { return pending.length; },
      render: () => ui.render(() => mod.__Panel(props)),
      async flush() {
        await new Promise(resolveNow => setImmediate(resolveNow));
        await new Promise(resolveNow => setImmediate(resolveNow));
      },
      restore() { ui.cleanup(); globalThis.fetch = savedFetch; delete globalThis[key]; },
    };
  } catch (error) {
    globalThis.fetch = savedFetch; delete globalThis[key]; throw error;
  }
}
