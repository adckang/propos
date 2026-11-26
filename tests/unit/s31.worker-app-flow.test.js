/**
 * ACT-08 단계 ⑥-5 — Worker App 흐름의 실제 구현 계약.
 * 앱 TypeScript/TSX는 실제 모듈을 실행하고 SDK·네이티브 UI·HTTP만 가짜 I/O로 격리한다.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_KEY, response, workerFcmFixture } from '../helpers/workerFcmFixture.js';

async function actualWorkerApp(t, options = {}) {
  const f = await workerFcmFixture(options);
  t.after(() => {
    try {
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  return f;
}

const payload = {
  jobId: 'fixture-job', token: 'fixture-decline-token', calendarUrl: 'https://calendar.example/fixture',
  hostPhone: '01012345678', title: '청소 요청', body: 'Fixture Property',
};
const remoteMessage = {
  data: { jobId: payload.jobId, token: payload.token, calendarUrl: payload.calendarUrl, hostPhone: payload.hostPhone },
  notification: { title: payload.title, body: payload.body },
};
const historyRequest = {
  id: 'fixture-request', propertyName: 'Fixture Property', cleaningAt: '2026-12-06 11:00',
  calendarPath: '/c/fixture-property', declineToken: null,
};

function children(node) {
  if (!node || typeof node !== 'object') return [];
  const value = node.props?.children;
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function textContent(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return children(node).map(textContent).join('');
}
function findNode(node, predicate) {
  if (node && typeof node === 'object' && predicate(node)) return node;
  for (const child of children(node)) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}
function findNodes(node, predicate, found = []) {
  if (node && typeof node === 'object' && predicate(node)) found.push(node);
  for (const child of children(node)) findNodes(child, predicate, found);
  return found;
}
function press(tree, label) {
  const button = findNode(tree, node => node.type === 'TouchableOpacity' && textContent(node).includes(label));
  assert.ok(button, `button not found: ${label}`);
  return button.props.onPress();
}
async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

describe('actual Worker App API client', () => {
  test('declineJob calls the production path with format=api and returns its success receipt', async t => {
    const f = await actualWorkerApp(t, { answer: () => response(200, { ok: true, message: '거절 처리 완료' }) });
    const { declineJob } = await f.loadApi();
    assert.deepEqual(await declineJob('ABC123'), { ok: true, message: '거절 처리 완료' });
    assert.deepEqual(f.calls, [{
      url: 'https://www.proposonline.com/api/cleaning/d?token=ABC123&format=api',
      method: 'GET', body: undefined, headers: {}, signal: undefined,
    }]);
  });

  test('declineJob preserves the current non-2xx boundary without copying a server message', async t => {
    const f = await actualWorkerApp(t, { answer: () => response(409, { ok: false, message: '이미 처리된 링크입니다.' }) });
    const { declineJob } = await f.loadApi();
    assert.deepEqual(await declineJob(payload.token), { ok: false });
  });

  test('declineJob lets a network failure reach the screen error boundary', async t => {
    const f = await actualWorkerApp(t, { answer: () => { throw new Error('fixture network failure'); } });
    const { declineJob } = await f.loadApi();
    await assert.rejects(declineJob(payload.token), /fixture network failure/);
  });

  test('registerWorker sends the entered identity unchanged; server normalization remains server-owned', async t => {
    const receipt = { ok: true, worker: { id: 'fixture-worker', active: false }, message: '승인 대기' };
    const f = await actualWorkerApp(t, { answer: () => response(200, receipt) });
    const { registerWorker } = await f.loadApi();
    assert.deepEqual(await registerWorker('+82 10-1234-5678', 'USER@EXAMPLE.COM ', 'fixture-fcm'), receipt);
    assert.deepEqual(f.calls[0], {
      url: 'https://www.proposonline.com/api/workers/register', method: 'POST',
      body: { phone: '+82 10-1234-5678', email: 'USER@EXAMPLE.COM ', fcm_token: 'fixture-fcm' },
      headers: { 'Content-Type': 'application/json' }, signal: undefined,
    });
  });

  test('registerWorker exposes the server registration reason', async t => {
    const f = await actualWorkerApp(t, { answer: () => response(503, { error: 'unavailable' }) });
    const { registerWorker } = await f.loadApi();
    await assert.rejects(registerWorker('01012345678', 'user@example.com', 'fixture-fcm'), /unavailable/);
  });

  test('sendHeartbeat posts the stored token and intentionally swallows a network failure', async t => {
    const f = await actualWorkerApp(t, { answer: () => { throw new Error('fixture offline'); } });
    const { sendHeartbeat } = await f.loadApi();
    await assert.doesNotReject(sendHeartbeat('fixture-fcm'));
    assert.deepEqual(f.calls[0], {
      url: 'https://www.proposonline.com/api/workers/heartbeat', method: 'POST',
      body: { fcm_token: 'fixture-fcm' }, headers: { 'Content-Type': 'application/json' }, signal: undefined,
    });
  });
});

describe('actual Worker App registration screen', () => {
  test('submits the entered phone and email without an OTP step', async t => {
    const f = await actualWorkerApp(t);
    const { default: RegistrationScreen } = await f.loadRegistration();
    const completed = [];
    const props = { onComplete: async (phone, email) => completed.push({ phone, email }) };
    let tree = f.render(RegistrationScreen, props);
    assert.equal(textContent(tree).includes('인증번호'), false);
    const inputs = findNodes(tree, node => node.type === 'TextInput');
    assert.equal(inputs.length, 2);
    inputs[0].props.onChangeText('010 1234 5678');
    inputs[1].props.onChangeText('WORKER@EXAMPLE.INVALID ');
    tree = f.render(RegistrationScreen, props);
    await press(tree, '등록하기');
    assert.deepEqual(completed, [{ phone: '010-1234-5678', email: 'worker@example.invalid' }]);
  });
});

describe('actual Worker App FCM mapping', () => {
  test('getInitialNotification returns null when the SDK has no opening message', async t => {
    const f = await actualWorkerApp(t);
    const { getInitialNotification } = await f.loadClient();
    assert.equal(await getInitialNotification(), null);
  });

  test('getInitialNotification maps the SDK data and current empty fallbacks', async t => {
    const f = await actualWorkerApp(t, { initialNotification: {
      data: { jobId: 'fixture-job', token: 'fixture-token' }, notification: { title: 'Fixture title' },
    } });
    const { getInitialNotification } = await f.loadClient();
    assert.deepEqual(await getInitialNotification(), {
      jobId: 'fixture-job', token: 'fixture-token', calendarUrl: '', hostPhone: '', title: 'Fixture title', body: '',
    });
  });

  test('onForegroundMessage maps the live SDK message and unsubscribe detaches it', async t => {
    const f = await actualWorkerApp(t);
    const { onForegroundMessage } = await f.loadClient();
    const received = [];
    const unsubscribe = onForegroundMessage(value => received.push(value));
    await f.emitForeground(remoteMessage);
    unsubscribe();
    await f.emitForeground(remoteMessage);
    assert.deepEqual(received, [payload]);
  });
});

describe('actual Worker App navigation and Home screen', () => {
  test('App registration initializes FCM, posts the entered identity, and persists registration', async t => {
    const receipt = { ok: true, worker: { id: 'fixture-worker', active: false }, message: '승인 대기' };
    const f = await actualWorkerApp(t, { stored: null, token: 'fixture-app-token', answer: () => response(200, receipt) });
    const { default: App } = await f.loadApp();
    f.render(App);
    await flushPromises();
    f.io.ui.componentCalls.length = 0;
    f.render(App);
    const registration = f.io.ui.componentCalls.find(call => typeof call.props.onComplete === 'function');
    assert.ok(registration, 'actual App must render its registration screen');
    await registration.props.onComplete('010-1234-5678', 'USER@EXAMPLE.COM');
    assert.deepEqual(f.calls[0].body, {
      phone: '010-1234-5678', email: 'USER@EXAMPLE.COM', fcm_token: 'fixture-app-token',
    });
    assert.equal(f.values.get(TOKEN_KEY), 'fixture-app-token');
    assert.equal(f.values.get('@propos/registered'), 'true');
  });

  test('App registration stops before HTTP and persistence when FCM permission is denied', async t => {
    const f = await actualWorkerApp(t, { stored: null });
    f.io.permission = 0;
    const { default: App } = await f.loadApp();
    f.render(App);
    await flushPromises();
    f.io.ui.componentCalls.length = 0;
    f.render(App);
    const registration = f.io.ui.componentCalls.find(call => typeof call.props.onComplete === 'function');
    assert.ok(registration, 'actual App must render its registration screen');
    await registration.props.onComplete('010-1234-5678', 'user@example.com');
    assert.deepEqual(f.calls, []);
    assert.equal(f.values.has('@propos/registered'), false);
  });

  test('Navigation handles one cold-start payload only once even if ready repeats', async t => {
    const f = await actualWorkerApp(t);
    f.io.ui.readyRepeats = 2;
    const { default: Navigation } = await f.loadNavigation();
    f.render(Navigation, { initialPayload: payload });
    assert.deepEqual(f.io.ui.navigationCalls, [{ screen: 'Job', params: { payload } }]);
  });

  test('Navigation does not route without a payload or before its ref is ready', async t => {
    const f = await actualWorkerApp(t);
    const { default: Navigation } = await f.loadNavigation();
    f.render(Navigation, { initialPayload: null });
    f.io.ui.navigationReady = false;
    f.render(Navigation, { initialPayload: payload });
    assert.deepEqual(f.io.ui.navigationCalls, []);
  });

  test('HomeScreen heartbeats the stored token and maps foreground/opened notifications', async t => {
    const f = await actualWorkerApp(t, { stored: 'fixture-stored-token', answer: () => response(200, { ok: true }) });
    const { default: HomeScreen } = await f.loadHome();
    f.render(HomeScreen);
    await flushPromises();
    assert.deepEqual(f.calls.filter(call => call.url.endsWith('/heartbeat')), [{
      url: 'https://www.proposonline.com/api/workers/heartbeat', method: 'POST',
      body: { fcm_token: 'fixture-stored-token' }, headers: { 'Content-Type': 'application/json' }, signal: undefined,
    }]);
    await f.emitForeground(remoteMessage);
    await f.emitOpened(remoteMessage);
    assert.deepEqual(f.io.ui.navigationCalls, [
      { screen: 'Job', params: { payload } }, { screen: 'Job', params: { payload } },
    ]);
  });

  test('HomeScreen can reopen a server-side request without receiving a push', async t => {
    let requests = [];
    const f = await actualWorkerApp(t, { answer: call => response(200, call.url.endsWith('/requests')
      ? { ok: true, requests } : { ok: true }) });
    const { default: HomeScreen } = await f.loadHome();
    f.render(HomeScreen);
    await flushPromises();
    const received = f.calls.find(call => call.url.endsWith('/requests'));
    assert.equal(received.method, 'GET');
    assert.equal(received.headers.Authorization, 'Bearer fixture-old');
    requests = [historyRequest];
    f.emitAppState('active');
    await flushPromises();
    const tree = f.render(HomeScreen);
    assert.match(textContent(tree), /Fixture Property2026-12-06 11:00/);
    press(tree, 'Fixture Property');
    assert.deepEqual(f.io.ui.navigationCalls, [{ screen: 'Job', params: { request: historyRequest } }]);
  });

  test('HomeScreen skips heartbeat without a stored token and removes both message listeners', async t => {
    const f = await actualWorkerApp(t, { stored: null });
    const { default: HomeScreen } = await f.loadHome();
    f.render(HomeScreen);
    await flushPromises();
    f.cleanupEffects();
    await f.emitForeground(remoteMessage);
    await f.emitOpened(remoteMessage);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.io.ui.navigationCalls, []);
    assert.equal(f.values.has(TOKEN_KEY), false);
  });
});

describe('actual Worker App Job screen', () => {
  test('History opens the existing reservation calendar and has no booking state', async t => {
    const f = await actualWorkerApp(t);
    const { default: JobScreen } = await f.loadJob();
    const props = { route: { params: { request: historyRequest } }, navigation: { goBack() {} } };
    const tree = f.render(JobScreen, props);
    assert.doesNotMatch(textContent(tree), /선점|배정|거절/);
    await press(tree, '예약 캘린더 열기');
    const calendar = findNode(f.render(JobScreen, props), node => node.type === 'WebView');
    assert.equal(calendar.props.source.uri, 'https://www.proposonline.com/c/fixture-property');
    assert.equal(f.calls.length, 0);
  });

  test('A decline from history uses the guarded path', async t => {
    const f = await actualWorkerApp(t, { answer: () => response(200, { ok: true }) });
    const { default: JobScreen } = await f.loadJob();
    const props = { route: { params: { request: { ...historyRequest, declineToken: 'OPEN01' } } }, navigation: { goBack() {} } };
    press(f.render(JobScreen, props), '거절');
    await f.io.ui.alerts[0].actions[1].onPress();
    assert.equal(f.calls[0].url, 'https://www.proposonline.com/api/cleaning/d?token=OPEN01&format=api&source=history');
  });

  test('a confirmed successful decline switches to the actual completed state', async t => {
    const f = await actualWorkerApp(t, { answer: () => response(200, { ok: true, message: '거절 처리 완료' }) });
    const { default: JobScreen } = await f.loadJob();
    const props = { route: { params: { payload } }, navigation: { goBack() {} } };
    const tree = f.render(JobScreen, props);
    press(tree, '✕ 거절');
    assert.deepEqual(f.io.ui.alerts[0]?.title, '거절 확인');
    await f.io.ui.alerts[0].actions[1].onPress();
    assert.match(textContent(f.render(JobScreen, props)), /거절 완료/);
    assert.equal(f.calls[0].url, `https://www.proposonline.com/api/cleaning/d?token=${payload.token}&format=api`);
  });

  test('a non-2xx decline displays the screen fallback because the API client returns no message', async t => {
    const f = await actualWorkerApp(t, { answer: () => response(409, { ok: false, message: 'server detail' }) });
    const { default: JobScreen } = await f.loadJob();
    const tree = f.render(JobScreen, { route: { params: { payload } }, navigation: { goBack() {} } });
    press(tree, '✕ 거절');
    await f.io.ui.alerts[0].actions[1].onPress();
    assert.deepEqual(f.io.ui.alerts[1], {
      title: '처리 불가', message: '이미 처리된 요청이거나 연결 오류입니다.', actions: undefined,
    });
  });

  test('a decline network failure displays the actual generic error boundary', async t => {
    const f = await actualWorkerApp(t, { answer: () => { throw new Error('fixture network failure'); } });
    const { default: JobScreen } = await f.loadJob();
    const tree = f.render(JobScreen, { route: { params: { payload } }, navigation: { goBack() {} } });
    press(tree, '✕ 거절');
    await f.io.ui.alerts[0].actions[1].onPress();
    assert.deepEqual(f.io.ui.alerts[1], {
      title: '오류', message: '처리 중 문제가 발생했습니다. 다시 시도해주세요.', actions: undefined,
    });
  });
});
