import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

// haProxy를 mock하기 위해 global.fetch를 제어한다
let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

// haProxy는 PROPOS_HA_BASE_URL, PROPOS_HA_TOKEN 환경변수를 읽는다
// 테스트에서는 fetch를 가로채므로 실제 URL·토큰 불필요
process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_TOKEN    = 'test-token';

const { executeStateActions } = await import('../../server/deviceActionExecutor.js');

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────
function mockFetch(handler) {
  global.fetch = async (url, opts) => {
    const result = handler(url, opts);
    return {
      ok: true,
      status: 200,
      async json() { return result ?? {}; },
      async text() { return JSON.stringify(result ?? {}); },
    };
  };
}

function capturingFetch() {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, async json() { return {}; }, async text() { return '{}'; } };
  };
  return calls;
}

function failingFetch(message = 'HA 오류') {
  global.fetch = async () => ({
    ok: false,
    status: 500,
    async text() { return message; },
  });
}

// ── 기본 동작 ─────────────────────────────────────────────────────────────────
describe('executeStateActions — 기본', () => {
  test('알 수 없는 mainStatus → executed/skipped 모두 빈 배열', async () => {
    mockFetch(() => ({}));
    const result = await executeStateActions('UNKNOWN_STATUS', {});
    assert.deepEqual(result, { executed: [], skipped: [] });
  });

  test('deviceMap이 비어있으면 모든 액션이 skipped(매핑 없음)', async () => {
    mockFetch(() => ({}));
    const result = await executeStateActions('VACANT', {});
    assert.equal(result.executed.length, 0);
    assert.ok(result.skipped.length > 0);
    assert.ok(result.skipped.every(s => s.reason === '매핑 없음'));
  });

  test('null 매핑된 역할은 건너뜀', async () => {
    mockFetch(() => ({}));
    const result = await executeStateActions('VACANT', { AC_MAIN: null });
    const acSkip = result.skipped.find(s => s.role === 'AC_MAIN');
    assert.ok(acSkip, 'null 매핑은 skipped에 포함되어야 함');
  });
});

// ── HA 호출 검증 ──────────────────────────────────────────────────────────────
describe('executeStateActions — VACANT HA 호출', () => {
  test('LIGHT_LIVING 매핑 시 light.turn_off 호출', async () => {
    const calls = capturingFetch();
    await executeStateActions('VACANT', { LIGHT_LIVING: 'light.test_living' });
    const call = calls.find(c => c.url.includes('light/turn_off'));
    assert.ok(call, 'light/turn_off 호출 없음');
    assert.equal(call.body.entity_id, 'light.test_living');
  });

  test('LOCK_ENTRANCE 매핑 시 lock.lock 호출', async () => {
    const calls = capturingFetch();
    await executeStateActions('VACANT', { LOCK_ENTRANCE: 'lock.test_door' });
    const call = calls.find(c => c.url.includes('lock/lock'));
    assert.ok(call, 'lock/lock 호출 없음');
    assert.equal(call.body.entity_id, 'lock.test_door');
  });

  test('PLUG_TV 매핑 시 switch.turn_off 호출', async () => {
    const calls = capturingFetch();
    await executeStateActions('VACANT', { PLUG_TV: 'switch.test_tv' });
    const call = calls.find(c => c.url.includes('switch/turn_off'));
    assert.ok(call);
    assert.equal(call.body.entity_id, 'switch.test_tv');
  });
});

describe('executeStateActions — OCCUPIED HA 호출', () => {
  test('AC_MAIN 매핑 시 climate.set_temperature 호출', async () => {
    const calls = capturingFetch();
    await executeStateActions('OCCUPIED', { AC_MAIN: 'climate.test_ac' });
    const call = calls.find(c => c.url.includes('climate/set_temperature'));
    assert.ok(call, 'climate/set_temperature 호출 없음');
    assert.equal(call.body.entity_id, 'climate.test_ac');
    assert.ok(typeof call.body.temperature === 'number');
  });

  test('AC_MAIN SET_TEMP에 hvac_mode 포함 (꺼진 에어컨 켜기)', async () => {
    const calls = capturingFetch();
    await executeStateActions('OCCUPIED', { AC_MAIN: 'climate.test_ac' });
    const call = calls.find(c => c.url.includes('climate/set_temperature'));
    assert.ok(call.body.hvac_mode, 'hvac_mode 없으면 꺼진 에어컨이 켜지지 않음');
  });

  test('LIGHT_LIVING 매핑 시 light.turn_on + brightness_pct 포함', async () => {
    const calls = capturingFetch();
    await executeStateActions('OCCUPIED', { LIGHT_LIVING: 'light.test_living' });
    const call = calls.find(c => c.url.includes('light/turn_on'));
    assert.ok(call);
    assert.ok(call.body.brightness_pct != null, 'brightness_pct 없음');
  });
});

describe('executeStateActions — CLEANING HA 호출', () => {
  test('AC_MAIN 매핑 시 climate.turn_off 호출', async () => {
    const calls = capturingFetch();
    await executeStateActions('CLEANING', { AC_MAIN: 'climate.test_ac' });
    const call = calls.find(c => c.url.includes('climate/turn_off'));
    assert.ok(call, 'climate/turn_off 호출 없음');
  });

  test('FAN_VENTILATION 매핑 시 switch.turn_on 호출', async () => {
    const calls = capturingFetch();
    await executeStateActions('CLEANING', { FAN_VENTILATION: 'switch.test_fan' });
    const call = calls.find(c => c.url.includes('switch/turn_on'));
    assert.ok(call);
    assert.equal(call.body.entity_id, 'switch.test_fan');
  });

  test('조명 brightness_pct: 100으로 호출', async () => {
    const calls = capturingFetch();
    await executeStateActions('CLEANING', { LIGHT_LIVING: 'light.test_living' });
    const call = calls.find(c => c.url.includes('light/turn_on'));
    assert.ok(call);
    assert.equal(call.body.brightness_pct, 100);
  });
});

describe('executeStateActions — PRE_STAY_READY HA 호출', () => {
  test('AC_MAIN SET_TEMP + hvac_mode 포함 (예냉 시작)', async () => {
    const calls = capturingFetch();
    await executeStateActions('PRE_STAY_READY', { AC_MAIN: 'climate.test_ac' });
    const call = calls.find(c => c.url.includes('climate/set_temperature'));
    assert.ok(call, 'climate/set_temperature 호출 없음');
    assert.ok(call.body.hvac_mode, 'hvac_mode 없으면 꺼진 에어컨이 켜지지 않음');
  });
});

// ── 복수 entity_id ────────────────────────────────────────────────────────────
describe('executeStateActions — 복수 entity_id', () => {
  test('배열로 매핑된 역할은 각 entity_id마다 HA 호출', async () => {
    const calls = capturingFetch();
    await executeStateActions('VACANT', {
      LIGHT_LIVING: ['light.ceiling', 'light.floor_lamp'],
    });
    const lightCalls = calls.filter(c => c.url.includes('light/turn_off'));
    assert.equal(lightCalls.length, 2, '2개 조명 각각 호출되어야 함');
    const entityIds = lightCalls.map(c => c.body.entity_id);
    assert.ok(entityIds.includes('light.ceiling'));
    assert.ok(entityIds.includes('light.floor_lamp'));
  });

  test('배열 내 null은 무시됨', async () => {
    const calls = capturingFetch();
    await executeStateActions('VACANT', {
      LIGHT_LIVING: ['light.ceiling', null, 'light.floor_lamp'],
    });
    const lightCalls = calls.filter(c => c.url.includes('light/turn_off'));
    assert.equal(lightCalls.length, 2);
  });
});

// ── 에러 처리 ─────────────────────────────────────────────────────────────────
describe('executeStateActions — 에러 처리', () => {
  test('HA 호출 실패 시 해당 역할이 skipped에 포함되고 다음 액션 계속 실행', async () => {
    let callCount = 0;
    global.fetch = async (url) => {
      callCount++;
      if (url.includes('climate')) {
        return { ok: false, status: 500, async text() { return 'HA 에러'; } };
      }
      return { ok: true, status: 200, async json() { return {}; }, async text() { return '{}'; } };
    };

    const result = await executeStateActions('VACANT', {
      AC_MAIN:      'climate.test_ac',
      LIGHT_LIVING: 'light.test_living',
    });

    assert.ok(result.skipped.some(s => s.role === 'AC_MAIN'), 'AC_MAIN이 skipped에 없음');
    assert.ok(result.executed.some(e => e.role === 'LIGHT_LIVING'), '실패 후 다음 액션 계속해야 함');
  });

  test('executed는 성공한 것만, skipped는 실패/미매핑만 포함', async () => {
    const calls = capturingFetch();
    const result = await executeStateActions('VACANT', {
      LIGHT_LIVING: 'light.test_living',
      // 나머지 역할은 미매핑
    });
    assert.equal(result.executed.length, 1);
    assert.equal(result.executed[0].role, 'LIGHT_LIVING');
    assert.ok(result.skipped.length > 0);
  });
});

// ── executed / skipped 형태 ───────────────────────────────────────────────────
describe('executeStateActions — 반환값 형태', () => {
  test('executed 항목에 role, entityId, cmd 포함', async () => {
    const calls = capturingFetch();
    const result = await executeStateActions('VACANT', { LIGHT_LIVING: 'light.test' });
    const item = result.executed.find(e => e.role === 'LIGHT_LIVING');
    assert.ok(item);
    assert.equal(item.entityId, 'light.test');
    assert.ok(item.cmd);
  });

  test('skipped(미매핑) 항목에 role, reason 포함', async () => {
    mockFetch(() => ({}));
    const result = await executeStateActions('VACANT', {});
    const item = result.skipped[0];
    assert.ok(item.role);
    assert.ok(item.reason);
  });
});
