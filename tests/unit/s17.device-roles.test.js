import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_ROLE, ROLE_DOMAIN, CMD } from '../../src/domain/device-control/deviceRoles.js';

describe('DEVICE_ROLE', () => {
  test('모든 값이 자기 자신 키와 동일한 문자열이다', () => {
    for (const [key, val] of Object.entries(DEVICE_ROLE)) {
      assert.equal(val, key);
    }
  });

  test('동결(freeze)되어 있다', () => {
    assert.ok(Object.isFrozen(DEVICE_ROLE));
  });

  test('9개 역할이 정의되어 있다', () => {
    assert.equal(Object.keys(DEVICE_ROLE).length, 9);
  });
});

describe('ROLE_DOMAIN', () => {
  test('모든 DEVICE_ROLE이 도메인을 가진다', () => {
    for (const role of Object.values(DEVICE_ROLE)) {
      assert.ok(ROLE_DOMAIN[role], `${role}의 도메인이 없음`);
    }
  });

  test('도메인 값은 유효한 HA 도메인 중 하나다', () => {
    const validDomains = new Set(['climate', 'light', 'switch', 'lock', 'fan']);
    for (const [role, domain] of Object.entries(ROLE_DOMAIN)) {
      assert.ok(validDomains.has(domain), `${role}: 알 수 없는 도메인 "${domain}"`);
    }
  });

  test('AC_MAIN → climate', () => assert.equal(ROLE_DOMAIN.AC_MAIN, 'climate'));
  test('LIGHT_LIVING → light', () => assert.equal(ROLE_DOMAIN.LIGHT_LIVING, 'light'));
  test('PLUG_TV → switch', () => assert.equal(ROLE_DOMAIN.PLUG_TV, 'switch'));
  test('FAN_VENTILATION → switch', () => assert.equal(ROLE_DOMAIN.FAN_VENTILATION, 'switch'));
  test('LOCK_ENTRANCE → lock', () => assert.equal(ROLE_DOMAIN.LOCK_ENTRANCE, 'lock'));
});

describe('CMD', () => {
  test('동결되어 있다', () => {
    assert.ok(Object.isFrozen(CMD));
  });

  test('5개 커맨드가 정의되어 있다', () => {
    assert.equal(Object.keys(CMD).length, 5);
  });

  test('ON / OFF / SET_TEMP / LOCK / UNLOCK 포함', () => {
    assert.ok(CMD.ON);
    assert.ok(CMD.OFF);
    assert.ok(CMD.SET_TEMP);
    assert.ok(CMD.LOCK);
    assert.ok(CMD.UNLOCK);
  });
});
