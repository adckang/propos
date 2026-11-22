// Loads actual mobile TypeScript/TSX and API code. SDK, native UI shell,
// storage, HTTP, Pool and Slack are replaced; app business logic is not copied.
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
export const TOKEN_KEY = '@propos/fcm_token';
export const PENDING_KEY = '@propos/fcm_token_pending';
export const WORKER_ID = '11111111-1111-4111-8111-111111111111';
export const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

export async function workerFcmFixture({ stored = 'fixture-old', token = 'fixture-new', storage, answer, db, storageFailure, slack, probe, initialNotification = null } = {}) {
  const saved = { fetch: globalThis.fetch, profile: process.env.PROPOS_DATA_PROFILE };
  const key = '__workerFcmFixture_' + randomUUID().replaceAll('-', '');
  const values = storage ?? new Map(stored ? [[TOKEN_KEY, stored]] : []);
  const listeners = new Set(), foregroundListeners = new Set(), openedListeners = new Set();
  const calls = [], writes = [], slackCalls = [];
  const ui = {
    alerts: [], links: [], navigationCalls: [], componentCalls: [], effects: [], hookStates: [], hookIndex: 0,
    navigationReady: true, readyRepeats: 1,
    navigationRef: {
      isReady: () => ui.navigationReady,
      navigate: (screen, params) => { ui.navigationCalls.push({ screen, params }); },
    },
    navigation: { navigate: (screen, params) => { ui.navigationCalls.push({ screen, params }); } },
    useState(initial) {
      const index = this.hookIndex++;
      if (!(index in this.hookStates)) this.hookStates[index] = typeof initial === 'function' ? initial() : initial;
      return [this.hookStates[index], value => {
        this.hookStates[index] = typeof value === 'function' ? value(this.hookStates[index]) : value;
      }];
    },
    useEffect(effect) {
      const cleanup = effect();
      if (typeof cleanup === 'function') this.effects.push(cleanup);
    },
    native(type, props = {}) { return { type, props }; },
    createElement(type, props, ...children) {
      const next = { ...(props ?? {}), ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) };
      if (typeof type === 'function') {
        this.componentCalls.push({ name: type.name, props: next });
        return type(next);
      }
      return this.native(type, next);
    },
    ready(onReady) { for (let i = 0; i < this.readyRepeats; i++) onReady?.(); },
    render(Component, props = {}) { this.hookIndex = 0; return Component(props); },
    cleanup() { for (const fn of this.effects.splice(0)) fn(); },
  };
  const probeCalls = [];
  const io = {
    db, permission: 1, token, initialNotification, ui, probeCalls,
    async probeToken(...args) {
      probeCalls.push(args);
      if (probe) return probe(...args);
      throw new Error('Unexpected FCM probe blocked');
    },
    async postSlack(...args) {
      slackCalls.push(args);
      if (slack) return slack(...args);
      throw new Error('Unexpected Slack request blocked');
    },
    storage: {
      async getItem(k) { return values.get(k) ?? null; },
      async setItem(k, v) { storageFailure?.('set', k, v); writes.push({ key: k, value: v }); values.set(k, v); },
      async removeItem(k) { storageFailure?.('remove', k); writes.push({ key: k }); values.delete(k); },
    },
    sdk: {
      async requestPermission() { return io.permission; }, async getToken() { return io.token; },
      onTokenRefresh(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      onMessage(fn) { foregroundListeners.add(fn); return () => foregroundListeners.delete(fn); },
      onNotificationOpenedApp(fn) { openedListeners.add(fn); return () => openedListeners.delete(fn); },
      setBackgroundMessageHandler(fn) { io.backgroundHandler = fn; },
      async getInitialNotification() { return io.initialNotification; },
    },
  };
  globalThis[key] = io;
  process.env.PROPOS_DATA_PROFILE = 'hybrid';
  const stubs = {
    '@react-native-firebase/messaging': `const m=()=>globalThis[${JSON.stringify(key)}].sdk; m.AuthorizationStatus={AUTHORIZED:1,PROVISIONAL:2}; export default m;`,
    '@react-native-async-storage/async-storage': `export default globalThis[${JSON.stringify(key)}].storage;`,
    '@react-native-firebase/auth': `const auth=()=>({signInWithPhoneNumber:async()=>({confirm:async()=>({})})}); export default auth;`,
    react: `
      const ui=globalThis[${JSON.stringify(key)}].ui;
      export const createElement=(...args)=>ui.createElement(...args);
      export const useState=(value)=>ui.useState(value);
      export const useEffect=(effect)=>ui.useEffect(effect);
      export const useRef=(value)=>({current:value});
      export default {createElement};`,
    'react-native': `
      const io=globalThis[${JSON.stringify(key)}], native=(name)=>(props)=>io.ui.native(name,props);
      export const View=native('View'), Text=native('Text'), TextInput=native('TextInput'), TouchableOpacity=native('TouchableOpacity'), ActivityIndicator=native('ActivityIndicator'), KeyboardAvoidingView=native('KeyboardAvoidingView');
      export const StyleSheet={create:value=>value};
      export const Platform={OS:'android'};
      export const Linking={openURL:url=>{io.ui.links.push(url);return Promise.resolve();}};
      export const Alert={alert:(title,message,actions)=>io.ui.alerts.push({title,message,actions})};`,
    '@react-navigation/native': `
      const ui=globalThis[${JSON.stringify(key)}].ui;
      export const createNavigationContainerRef=()=>ui.navigationRef;
      export const NavigationContainer=props=>{ui.ready(props.onReady);return ui.native('NavigationContainer',props);};
      export const useNavigation=()=>ui.navigation;`,
    '@react-navigation/native-stack': `
      const ui=globalThis[${JSON.stringify(key)}].ui, native=name=>props=>ui.native(name,props);
      export const createNativeStackNavigator=()=>({Navigator:native('Stack.Navigator'),Screen:native('Stack.Screen')});`,
    'react-native-webview': `const ui=globalThis[${JSON.stringify(key)}].ui; export const WebView=props=>ui.native('WebView',props);`,
    pg: `export class Pool { constructor(){return globalThis[${JSON.stringify(key)}].db;} }`,
    '../../server/cleaning/_dispatch.js': `export const postSlack=(...a)=>globalThis[${JSON.stringify(key)}].postSlack(...a);`,
    '../../server/cleaning/_push.js': `export const probeToken=(...a)=>globalThis[${JSON.stringify(key)}].probeToken(...a);`,
  };
  async function load(relative) {
    const bundle = await build({ entryPoints: [resolve(root, relative)], bundle: true, write: false, platform: 'node', format: 'esm',
      logLevel: 'silent', plugins: [{ name: 'worker-fixture-io', setup(b) {
        b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture-io' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture-io' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      } }] });
    return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + `\n// ${randomUUID()}`).toString('base64'));
  }
  let server;
  async function invoke(method, body, headers = {}, {
    rawBody, resource = 'token', query = { slug: resource }, url = `/api/workers/${resource}`,
  } = {}) {
    server ??= (await load('api/workers/[...slug].js')).default;
    const req = { method, query, url, headers,
      async *[Symbol.asyncIterator]() {
        if (rawBody !== undefined) yield Buffer.from(rawBody);
        else if (body) yield Buffer.from(JSON.stringify(body));
      } };
    const res = { code: 200, body: null, headers: {}, status(n) { this.code = n; return this; },
      json(body) { this.body = body; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await server(req, res); return res;
  }
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    const call = { url: String(url), method: options.method ?? 'GET', body, headers: options.headers ?? {}, signal: options.signal };
    calls.push(call);
    if (answer) return answer(call, calls.length);
    if (call.url !== 'https://www.proposonline.com/api/workers/token') throw new Error('Unexpected external request blocked');
    if (db) {
      const headers = Object.fromEntries(Object.entries(call.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const res = await invoke(call.method, body, headers); return response(res.code, res.body);
    }
    return response(200, call.method === 'GET' ? { ok: true, worker_id: WORKER_ID } : { ok: true });
  };
  return { values, calls, writes, slackCalls, probeCalls, io, invoke, loadApi: () => load('worker-app/src/services/api.ts'),
    loadClient: () => load('worker-app/src/services/fcm.ts'),
    loadApp: () => load('worker-app/App.tsx'),
    loadNavigation: () => load('worker-app/src/navigation/index.tsx'),
    loadHome: () => load('worker-app/src/screens/HomeScreen.tsx'),
    loadJob: () => load('worker-app/src/screens/JobScreen.tsx'),
    render: (Component, props) => ui.render(Component, props),
    async emitToken(value) { io.token = value; return Promise.all([...listeners].map(fn => fn(value))); },
    async emitForeground(message) { return Promise.all([...foregroundListeners].map(fn => fn(message))); },
    async emitOpened(message) { return Promise.all([...openedListeners].map(fn => fn(message))); },
    cleanupEffects: () => ui.cleanup(),
    restore() {
      globalThis.fetch = saved.fetch; delete globalThis[key];
      if (saved.profile === undefined) delete process.env.PROPOS_DATA_PROFILE; else process.env.PROPOS_DATA_PROFILE = saved.profile;
    } };
}
