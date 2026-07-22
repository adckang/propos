import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { STATE_DEVICE_ACTIONS } from '../../src/domain/device-control/stateActions.js';
import { DEVICE_ROLE, ROLE_DOMAIN, CMD } from '../../src/domain/device-control/deviceRoles.js';

const VALID_ROLES = new Set(Object.values(DEVICE_ROLE));
const VALID_CMDS  = new Set(Object.values(CMD));
const ALL_STATUSES = ['OCCUPIED', 'CLEANING', 'PRE_STAY_READY', 'VACANT'];

describe('STATE_DEVICE_ACTIONS 구조', () => {
  test('4개 mainStatus 모두 정의되어 있다', () => {
    for (const s of ALL_STATUSES) {
      assert.ok(Array.isArray(STATE_DEVICE_ACTIONS[s]), `${s} 액션 배열 없음`);
      assert.ok(STATE_DEVICE_ACTIONS[s].length > 0, `${s} 액션이 비어있음`);
    }
  });

  test('모든 액션의 role이 유효한 DEVICE_ROLE이다', () => {
    for (const [status, actions] of Object.entries(STATE_DEVICE_ACTIONS)) {
      for (const action of actions) {
        assert.ok(VALID_ROLES.has(action.role), `${status}: 알 수 없는 역할 "${action.role}"`);
      }
    }
  });

  test('모든 액션의 cmd.type이 유효한 CMD이다', () => {
    for (const [status, actions] of Object.entries(STATE_DEVICE_ACTIONS)) {
      for (const action of actions) {
        assert.ok(VALID_CMDS.has(action.cmd.type), `${status}/${action.role}: 알 수 없는 커맨드 "${action.cmd.type}"`);
      }
    }
  });

  test('역할에 매핑된 도메인이 커맨드와 호환된다 (climate만 SET_TEMP)', () => {
    for (const [status, actions] of Object.entries(STATE_DEVICE_ACTIONS)) {
      for (const action of actions) {
        if (action.cmd.type === CMD.SET_TEMP) {
          assert.equal(ROLE_DOMAIN[action.role], 'climate',
            `${status}/${action.role}: SET_TEMP은 climate 도메인만 가능`);
        }
        if ([CMD.LOCK, CMD.UNLOCK].includes(action.cmd.type)) {
          assert.equal(ROLE_DOMAIN[action.role], 'lock',
            `${status}/${action.role}: LOCK/UNLOCK은 lock 도메인만 가능`);
        }
      }
    }
  });
});

describe('OCCUPIED 액션', () => {
  const actions = STATE_DEVICE_ACTIONS.OCCUPIED;

  test('AC_MAIN SET_TEMP 포함', () => {
    const ac = actions.find(a => a.role === DEVICE_ROLE.AC_MAIN);
    assert.ok(ac, 'AC_MAIN 액션 없음');
    assert.equal(ac.cmd.type, CMD.SET_TEMP);
    assert.ok(typeof ac.cmd.value === 'number', 'value가 숫자여야 함');
  });

  test('AC_MAIN SET_TEMP에 hvacMode가 있다 (꺼진 상태에서도 켜지도록)', () => {
    const ac = actions.find(a => a.role === DEVICE_ROLE.AC_MAIN);
    assert.ok(ac.cmd.hvacMode, 'hvacMode 없으면 에어컨이 꺼진 상태에서 켜지지 않음');
  });

  test('거실 조명 ON 포함', () => {
    const light = actions.find(a => a.role === DEVICE_ROLE.LIGHT_LIVING);
    assert.ok(light);
    assert.equal(light.cmd.type, CMD.ON);
  });
});

describe('CLEANING 액션', () => {
  const actions = STATE_DEVICE_ACTIONS.CLEANING;

  test('AC_MAIN OFF 포함', () => {
    const ac = actions.find(a => a.role === DEVICE_ROLE.AC_MAIN);
    assert.ok(ac);
    assert.equal(ac.cmd.type, CMD.OFF);
  });

  test('조명 4곳 모두 ON 포함', () => {
    const lights = [
      DEVICE_ROLE.LIGHT_LIVING,
      DEVICE_ROLE.LIGHT_BEDROOM,
      DEVICE_ROLE.LIGHT_BATHROOM,
      DEVICE_ROLE.LIGHT_ENTRANCE,
    ];
    for (const role of lights) {
      const a = actions.find(x => x.role === role);
      assert.ok(a, `${role} 액션 없음`);
      assert.equal(a.cmd.type, CMD.ON);
      assert.equal(a.cmd.brightness, 100, `${role} brightness가 100이어야 함`);
    }
  });

  test('환기팬 ON 포함', () => {
    const fan = actions.find(a => a.role === DEVICE_ROLE.FAN_VENTILATION);
    assert.ok(fan);
    assert.equal(fan.cmd.type, CMD.ON);
  });
});

describe('PRE_STAY_READY 액션', () => {
  const actions = STATE_DEVICE_ACTIONS.PRE_STAY_READY;

  test('AC_MAIN SET_TEMP 포함', () => {
    const ac = actions.find(a => a.role === DEVICE_ROLE.AC_MAIN);
    assert.ok(ac);
    assert.equal(ac.cmd.type, CMD.SET_TEMP);
  });

  test('AC_MAIN에 hvacMode 있다 (꺼진 상태에서 예냉 시작)', () => {
    const ac = actions.find(a => a.role === DEVICE_ROLE.AC_MAIN);
    assert.ok(ac.cmd.hvacMode, 'hvacMode 없으면 꺼진 에어컨이 켜지지 않음');
  });

  test('PRE_STAY_READY 온도가 OCCUPIED보다 낮거나 같다 (예냉)', () => {
    const preTemp = STATE_DEVICE_ACTIONS.PRE_STAY_READY.find(a => a.role === DEVICE_ROLE.AC_MAIN).cmd.value;
    const occTemp = STATE_DEVICE_ACTIONS.OCCUPIED.find(a => a.role === DEVICE_ROLE.AC_MAIN).cmd.value;
    assert.ok(preTemp <= occTemp, `PRE(${preTemp}) > OCCUPIED(${occTemp}): 예냉 온도가 더 높으면 무의미`);
  });
});

describe('VACANT 액션', () => {
  const actions = STATE_DEVICE_ACTIONS.VACANT;

  test('AC_MAIN OFF 포함', () => {
    const ac = actions.find(a => a.role === DEVICE_ROLE.AC_MAIN);
    assert.ok(ac);
    assert.equal(ac.cmd.type, CMD.OFF);
  });

  test('LOCK_ENTRANCE LOCK 포함 (퇴실 후 도어락 잠금)', () => {
    const lock = actions.find(a => a.role === DEVICE_ROLE.LOCK_ENTRANCE);
    assert.ok(lock, 'LOCK_ENTRANCE 액션 없음');
    assert.equal(lock.cmd.type, CMD.LOCK);
  });

  test('모든 조명 OFF 포함', () => {
    const lights = [
      DEVICE_ROLE.LIGHT_LIVING,
      DEVICE_ROLE.LIGHT_BEDROOM,
      DEVICE_ROLE.LIGHT_BATHROOM,
      DEVICE_ROLE.LIGHT_ENTRANCE,
    ];
    for (const role of lights) {
      const a = actions.find(x => x.role === role);
      assert.ok(a, `${role} OFF 액션 없음`);
      assert.equal(a.cmd.type, CMD.OFF);
    }
  });

  test('PLUG_TV OFF 포함', () => {
    const plug = actions.find(a => a.role === DEVICE_ROLE.PLUG_TV);
    assert.ok(plug);
    assert.equal(plug.cmd.type, CMD.OFF);
  });
});
