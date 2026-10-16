// 운영자의 스마트홈·모니터링·CCTV 접근을 자기 숙소로 제한한다 (D-035). 순수 규칙 + 실제 핸들러 실행.
process.env.PROPOS_WATCHER_URL = 'http://pi.test';
process.env.PROPOS_WATCHER_URLS = JSON.stringify({ watcher1: 'http://pi.test' });
process.env.PROPOS_DATA_PROFILE = 'hybrid';

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorizeOperatorHa, areaEntitiesTemplate, isSafeAreaName, OPERATOR_BLOCKED_DOMAINS } from '../../server/auth/haScope.js';
import { createWatcherPropertyLookup, operatorMayUseWatcher, parseWatcherUrls, resolveWatcherUrl } from '../../server/auth/watcherScope.js';
import { validatePropertyName } from '../../src/domain/propertyIdentityDomain.js';
import { createSessionToken, COOKIE_NAME } from '../../server/auth/operatorAuth.js';
import { passwordFingerprint } from '../../server/auth/operatorAccounts.js';
import { _setAuthDbForTest } from '../../server/auth/authDb.js';

const AREAS = { '파주201': ['light.a', 'switch.b', 'sensor.temp', 'binary_sensor.door'], 'B숙소': ['light.other', 'lock.front'] };
const getAreaEntityIds = async (area) => AREAS[area] ?? [];
const scope = { all: false, propertyIds: ['파주201'] };
const ask = (input) => authorizeOperatorHa({ scope, getAreaEntityIds, ...input });

describe('HA 규칙 — 자기 숙소 영역 안에서만', () => {
  test('템플릿: 영역 기기 목록을 묻는 정해진 문자열만, 나머지 질문은 전부 거절', async () => {
    assert.equal((await ask({ action: 'template', body: { template: areaEntitiesTemplate('파주201') } })).ok, true);
    for (const template of [
      areaEntitiesTemplate('B숙소'),                                  // 남의 숙소
      '{{ states | tojson }}',                                       // 모든 상태
      `${areaEntitiesTemplate('파주201')} {{ states }}`,              // 덧붙이기
      "{{ area_entities('파주201') | list | tojson }}{{ 1 }}",
      undefined, 123, '',
    ]) assert.equal((await ask({ action: 'template', body: { template } })).ok, false, String(template));
  });
  test('템플릿 주입: 따옴표·중괄호가 든 영역 이름은 아예 안전하지 않은 이름으로 취급', async () => {
    for (const bad of ["a')}} {{ x", 'a"b', 'a\\b', 'a{b', 'a\nb', '', 'x'.repeat(61)]) assert.equal(isSafeAreaName(bad), false, bad);
    assert.equal(isSafeAreaName('파주201'), true);
    const evil = { all: false, propertyIds: ["x') | list | tojson }}{{ states | tojson }}{{ ('"] };
    assert.equal((await authorizeOperatorHa({ scope: evil, action: 'template', body: { template: areaEntitiesTemplate(evil.propertyIds[0]) }, getAreaEntityIds })).ok, false);
  });
  test('상태·이력: 자기 영역 기기만', async () => {
    const start = '2026-10-16T00:00:00.000Z';
    for (const action of ['state', 'history']) {
      assert.equal((await ask({ action, query: { entityId: 'light.a', start } })).ok, true, action);
      for (const entityId of ['light.other', 'lock.front', undefined, ['light.a']]) assert.equal((await ask({ action, query: { entityId, start } })).ok, false, `${action} ${entityId}`);
    }
  });
  test('상태 목록: 모두 자기 영역 기기여야 하고, 하나라도 섞이면 전체 거절 / 200개 초과 거절', async () => {
    assert.equal((await ask({ action: 'states', body: { entityIds: ['light.a', 'sensor.temp'] } })).ok, true);
    assert.equal((await ask({ action: 'states', body: { entityIds: ['light.a', 'light.other'] } })).ok, false);
    assert.equal((await ask({ action: 'states', body: { entityIds: 'light.a' } })).ok, false);
    assert.equal((await ask({ action: 'states', body: { entityIds: Array(5001).fill('light.a') } })).ok, false); // 상식적 상한
    assert.equal((await ask({ action: 'states', body: {} })).ok, false);
  });
  test('모든 기기 목록(all-states)은 운영자에게 항상 거절', async () => {
    assert.equal((await ask({ action: 'all-states' })).ok, false);
  });
  test('제어: 자기 기기, 기기 자신의 도메인(또는 homeassistant) 서비스만', async () => {
    const ok = (domain, service, data) => ask({ action: 'service', body: { domain, service, data } });
    assert.equal((await ok('light', 'turn_on', { entity_id: 'light.a', brightness: 200 })).ok, true);
    assert.equal((await ok('switch', 'turn_off', { entity_id: ['switch.b'] })).ok, true);
    assert.equal((await ok('homeassistant', 'turn_off', { entity_id: 'light.a' })).ok, true);
    assert.equal((await ok('light', 'turn_on', { entity_id: 'light.other' })).ok, false);          // 남의 기기
    assert.equal((await ok('light', 'turn_on', { entity_id: ['light.a', 'light.other'] })).ok, false); // 하나라도 섞이면
    assert.equal((await ok('notify', 'send_message', { entity_id: 'light.a' })).ok, false);        // 기기와 무관한 서비스
    assert.equal((await ok('script', 'turn_on', { entity_id: 'light.a' })).ok, false);
    assert.equal((await ok('switch', 'turn_on', { entity_id: 'light.a' })).ok, false);             // 도메인 불일치
    assert.equal((await ok('light', 'turn_on', {})).ok, false);                                    // 대상 없음
    assert.equal((await ok('light', 'turn_on', { entity_id: 'all' })).ok, false);                  // 'all'
    assert.equal((await ok('light', 'turn_on', { entity_id: [] })).ok, false);
    assert.equal((await ok('light', 'turn_on', { entity_id: 'light.a', device_id: 'x' })).ok, false); // 대상 우회 키
    assert.equal((await ok('light', 'turn_on', { entity_id: 'light.a', label_id: 'x' })).ok, false);
    assert.equal((await ok('light', 'turn_on', { entity_id: 'light.a', floor_id: 'x' })).ok, false);
    assert.equal((await ok('Light', 'turn_on', { entity_id: 'light.a' })).ok, false);              // 형식 위반
    assert.equal((await ok('light', 'turn_on', null)).ok, false);
    assert.equal((await ask({ action: 'service', body: null })).ok, false);
  });
  test('★ 영역 전체 켜기/끄기(area_id)는 운영자에게 거절 — 화면의 자동화(퇴실 감지 시 전체 끄기·입실 준비 시 전체 켜기)를 열려 있는 아무 운영자 탭이 실행하지 못하게', async () => {
    const call = (domain, service, data) => ask({ action: 'service', body: { domain, service, data } });
    for (const data of [{ area_id: '파주201' }, { area_id: ['파주201'] }, { area_id: 'B숙소' }, { area_id: '파주201', entity_id: 'light.a' }]) {
      assert.equal((await call('homeassistant', 'turn_off', data)).ok, false, JSON.stringify(data));
      assert.equal((await call('homeassistant', 'turn_on', data)).ok, false, JSON.stringify(data));
    }
    assert.equal((await call('light', 'turn_off', { area_id: '파주201' })).ok, false);
  });
  test('다른 기기 참조 우회: 대문자·쉼표 목록·객체 키로 숨겨도 막는다 / 숫자 문자열은 기기로 오인하지 않는다', async () => {
    const mp = { all: false, propertyIds: ['파주201'] };
    const get = async (a) => (a === '파주201' ? ['light.a', 'media_player.tv'] : ['media_player.other']);
    const call = (data) => authorizeOperatorHa({ scope: mp, action: 'service', getAreaEntityIds: get, body: { domain: 'media_player', service: 'join', data } });
    assert.equal((await call({ entity_id: 'media_player.tv', group_members: ['media_player.tv'] })).ok, true);
    assert.equal((await call({ entity_id: 'media_player.tv', group_members: ['MEDIA_PLAYER.OTHER'] })).ok, false);       // 대문자
    assert.equal((await call({ entity_id: 'media_player.tv', group_members: ' Media_Player.Other ' })).ok, false);        // 공백·대소문자
    assert.equal((await call({ entity_id: 'media_player.tv', group_members: 'media_player.tv, media_player.other' })).ok, false); // 쉼표 목록
    assert.equal((await call({ entity_id: 'media_player.tv', entities: { 'media_player.other': 'on' } })).ok, false);     // 객체 키
    assert.equal((await call({ entity_id: 'media_player.tv', transition: '1.5', volume_level: 0.5 })).ok, true);          // 숫자는 기기가 아니다
  });
  test('상태 조회: 영역 기기가 200개를 넘어도(화면은 영역 전체를 한 번에 묻는다) 전부 내 영역 기기면 허용', async () => {
    const big = Array.from({ length: 300 }, (_, i) => `sensor.s${i}`);
    const r = await authorizeOperatorHa({ scope, action: 'states', body: { entityIds: big }, getAreaEntityIds: async () => big });
    assert.equal(r.ok, true);
    const mixed = await authorizeOperatorHa({ scope, action: 'states', body: { entityIds: [...big, 'light.other'] }, getAreaEntityIds: async () => big });
    assert.equal(mixed.ok, false);
  });
  test('배정이 없는 운영자·관리자 범위 입력·모르는 동작은 거절', async () => {
    const none = { all: false, propertyIds: [] };
    for (const action of ['template', 'state', 'states', 'service', 'history']) assert.equal((await authorizeOperatorHa({ scope: none, action, getAreaEntityIds })).ok, false, action);
    assert.equal((await authorizeOperatorHa({ scope: { all: true }, action: 'state', query: { entityId: 'light.a' }, getAreaEntityIds })).ok, false); // 관리자는 이 함수를 거치지 않는다
    assert.equal((await ask({ action: 'delete-everything' })).ok, false);
  });
  test('HA 가 영역 조회에 실패해 빈 목록을 돌려주면 아무것도 허용되지 않는다(안전한 쪽)', async () => {
    const down = async () => [];
    assert.equal((await authorizeOperatorHa({ scope, action: 'state', query: { entityId: 'light.a' }, getAreaEntityIds: down })).ok, false);
  });
  test('차단 도메인: script·automation·scene 은 기본 차단(기기가 아니라 다른 숙소 기기까지 움직일 수 있는 묶음), 도어락 등 기기는 사용자 결정으로 열려 있다 — 바꾸는 자리가 한 곳', async () => {
    assert.deepEqual([...OPERATOR_BLOCKED_DOMAINS].sort(), ['automation', 'scene', 'script']);
    const get = async () => ['script.reset_all', 'scene.night', 'automation.leave', 'lock.front', 'light.a'];
    const call = (domain, service, entity_id) => authorizeOperatorHa({ scope, action: 'service', getAreaEntityIds: get, body: { domain, service, data: { entity_id } } });
    for (const [d, sv, id] of [['script', 'turn_on', 'script.reset_all'], ['scene', 'turn_on', 'scene.night'], ['automation', 'trigger', 'automation.leave']]) {
      assert.equal((await call(d, sv, id)).ok, false, id);
    }
    assert.equal((await call('light', 'turn_on', 'light.a')).ok, true);
    assert.equal((await call('lock', 'unlock', 'lock.front')).ok, true, '도어락은 사용자 결정(모든 기기 제어)으로 열려 있다 — 막으려면 OPERATOR_BLOCKED_DOMAINS 에 추가');
  });
  test('★ 다른 기기 참조 검사는 공백 정의에 의존하지 않는다: U+001C 같은 문자로 감싼 id 도, 문장 속 id 도 잡는다 (HA 는 Python strip 으로 정리한다)', async () => {
    const mp = { all: false, propertyIds: ['파주201'] };
    const get = async (a) => (a === '파주201' ? ['group.x', 'light.a'] : ['light.other']);
    const call = (data) => authorizeOperatorHa({ scope: mp, action: 'service', getAreaEntityIds: get, body: { domain: 'group', service: 'set', data } });
    for (const sneaky of ['\u001clight.other', 'light.other\u0085', '\u001flight.other\u001e', 'a,\u001clight.other', 'x light.other y', 'LIGHT.OTHER']) {
      assert.equal((await call({ entity_id: 'group.x', entities: sneaky })).ok, false, JSON.stringify(sneaky));
    }
    assert.equal((await call({ entity_id: 'group.x', entities: 'light.a' })).ok, true);
    assert.equal((await call({ entity_id: 'group.x', brightness: 100, transition: '1.5' })).ok, true);
  });
  test('이력 조회: start 는 ISO 시각이어야 한다 (쿼리 조작용 값을 거절)', async () => {
    const h = (start) => ask({ action: 'history', query: { entityId: 'light.a', start } });
    assert.equal((await h('2026-10-16T00:00:00.000Z')).ok, true);
    assert.equal((await h('2026-10-16T00:00:00+09:00')).ok, true);
    for (const bad of ['2026-01-01&entityId=lock.other', '2026-01-01', 'x', undefined, ['2026-01-01T00:00:00Z'], '2026-01-01T00:00:00Z&a=b']) assert.equal((await h(bad)).ok, false, String(bad));
  });
  test('homeassistant 도메인은 켜기/끄기/토글만 — 설정 재로드·엔티티 갱신 등은 연동 전체에 영향이라 거절', async () => {
    const ha = (service) => ask({ action: 'service', body: { domain: 'homeassistant', service, data: { entity_id: 'light.a' } } });
    for (const service of ['turn_on', 'turn_off', 'toggle']) assert.equal((await ha(service)).ok, true, service);
    for (const service of ['reload_config_entry', 'update_entity', 'restart', 'reload_all', 'set_location']) assert.equal((await ha(service)).ok, false, service);
  });
  test('data 안에 다른 기기를 가리키는 값이 숨어 있으면 거절 (group_members 같은 필드로 우회 방지)', async () => {
    const call = (data) => ask({ action: 'service', body: { domain: 'light', service: 'turn_on', data } });
    assert.equal((await call({ entity_id: 'light.a', brightness: 100, rgb_color: [255, 0, 0], effect: 'rainbow' })).ok, true);
    assert.equal((await call({ entity_id: 'light.a', group_members: ['light.other'] })).ok, false);
    assert.equal((await call({ entity_id: 'light.a', nested: { deep: { x: 'switch.other' } } })).ok, false);
    assert.equal((await call({ entity_id: 'light.a', also: 'sensor.temp' })).ok, true); // 같은 숙소 기기를 가리키는 건 허용
    assert.equal((await call({ entity_id: 'light.a', deep: { a: { b: { c: { d: { e: { f: { g: 'light.a' } } } } } } } })).ok, false); // 너무 깊은 구조는 거절
  });
  test('JSON 본문이 null·배열·문자열이어도 예외 없이 거절/정상 처리', async () => {
    for (const body of [null, [], 'str', 5, undefined]) {
      for (const action of ['template', 'states', 'service', 'state', 'history']) {
        const r = await authorizeOperatorHa({ scope, action, body, query: null, getAreaEntityIds });
        assert.equal(r.ok, false, `${action} ${JSON.stringify(body)}`);
      }
    }
  });
  test('HA 영역 조회가 실패하면 예외가 올라간다(빈 목록으로 오해해 "내 기기가 아님"으로 거절하지 않는다)', async () => {
    const boom = async () => { throw new Error('HA timeout'); };
    await assert.rejects(authorizeOperatorHa({ scope, action: 'state', query: { entityId: 'light.a' }, getAreaEntityIds: boom }), /HA timeout/);
    // 영역 전체 지정은 어떤 경우에도 거절이라 HA 를 조회하지 않고 판단한다(HA 가 느려도 즉시 거절)
    let looked = 0;
    const r = await authorizeOperatorHa({ scope, action: 'service', body: { domain: 'homeassistant', service: 'turn_off', data: { area_id: '파주201' } }, getAreaEntityIds: async () => { looked += 1; return []; } });
    assert.equal(r.ok, false);
    assert.equal(looked, 0);
  });
  test('영역 조회는 숙소 수만큼 병렬로 (순차로 기다리지 않는다)', async () => {
    let running = 0; let peak = 0;
    const slow = async () => { running += 1; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 10)); running -= 1; return ['light.a']; };
    const many = { all: false, propertyIds: ['a', 'b', 'c', 'd'] };
    await authorizeOperatorHa({ scope: many, action: 'state', query: { entityId: 'light.a' }, getAreaEntityIds: slow });
    assert.equal(peak, 4);
  });
  test('화면·서버가 같은 템플릿 함수를 쓴다 (한쪽만 바뀌어 운영자 화면에서만 기기가 사라지는 일 방지)', () => {
    const client = readFileSync(new URL('../../src/infrastructure/haBrowserClient.js', import.meta.url), 'utf8');
    assert.match(client, /import \{ areaEntitiesTemplate \} from "\.\.\/domain\/haAreaTemplate\.js"/);
    assert.match(client, /renderTemplate\(areaEntitiesTemplate\(areaName\)\)/);
    assert.ok(!/area_entities\(/.test(client), '화면에 템플릿 문자열을 따로 두지 않는다');
    const server = readFileSync(new URL('../../server/auth/haScope.js', import.meta.url), 'utf8');
    assert.match(server, /from '\.\.\/\.\.\/src\/domain\/haAreaTemplate\.js'/);
    assert.equal(areaEntitiesTemplate('파주201'), "{{ area_entities('파주201') | list | tojson }}");
  });
  test('이미 저장된 이름은 그대로 허용한다 — 규칙이 생기기 전 숙소의 다른 설정 저장을 막지 않는다(새로 만들거나 이름을 바꿀 때만 적용)', () => {
    assert.equal(validatePropertyName("Joe's 201").ok, false);
    assert.equal(validatePropertyName("Joe's 201", { unchangedFrom: "Joe's 201" }).ok, true);
    assert.equal(validatePropertyName("Joe's 202", { unchangedFrom: "Joe's 201" }).ok, false); // 이름을 바꾸면 적용
    assert.equal(validatePropertyName('a,b', { unchangedFrom: 'a,b' }).ok, false);              // 다른 규칙(쉼표)은 grandfather 대상이 아니다
    assert.equal(validatePropertyName('x'.repeat(61), { unchangedFrom: 'x'.repeat(61) }).ok, false);
  });
  test('숙소 이름 규칙이 HA 영역 이름 검사와 같다: 따옴표·역슬래시·중괄호가 든 이름은 만들 수 없다', () => {
    for (const name of ["O'Brien 2호", 'A"B', 'a\\b', 'a{b', 'a}b']) {
      assert.equal(validatePropertyName(name).ok, false, name);
      assert.equal(isSafeAreaName(name), false, name);
    }
    for (const name of ['파주201', '개포 L호', 'Seoul-12', '정상 이름']) {
      assert.equal(validatePropertyName(name).ok, true, name);
      assert.equal(isSafeAreaName(name), true, name);
    }
  });
});

describe('워처(모니터링·CCTV) 범위', () => {
  const properties = [
    { id: '파주201', watcherId: 'watcher1', devices: {}, sourceUrl: 'http://pi.test' },
    { id: 'B숙소', watcherId: 'watcher2', sourceUrl: 'http://pi-b.test' },
    { id: 'C숙소', watcherId: null, sourceUrl: 'http://pi.test' },
    { id: 'D숙소', sourceUrl: 'http://pi.test' },
    null, 'garbage',
  ];
  const mine = { all: false, propertyIds: ['파주201'] };
  test('★ 이름표만 맞으면 안 된다: 우리가 호출할 주소가 그 숙소를 보고한 워처와 같아야 한다 (기본 Pi 로 폴백돼 남의 CCTV 가 보이는 우회 차단)', () => {
    const resolve = (map, def) => (id) => map[id] ?? def ?? null;
    // 정상: 주소 맵이 watcher1 → 파주201 을 보고한 Pi
    assert.equal(operatorMayUseWatcher(mine, properties, 'watcher1', resolve({ watcher1: 'http://pi.test' })), true);
    // 맵 없이 기본 Pi 하나만 쓰는 구성: 기본 Pi 가 파주201 을 보고했으면 허용
    assert.equal(operatorMayUseWatcher(mine, properties, 'watcher1', resolve({}, 'http://pi.test/')), true);
    // 우회: B숙소 운영자, 이름표 watcher2 는 맞지만 주소 맵에 watcher2 가 없어 기본 Pi(파주201 의 Pi)로 폴백
    const bOnly = { all: false, propertyIds: ['B숙소'] };
    assert.equal(operatorMayUseWatcher(bOnly, properties, 'watcher2', resolve({}, 'http://pi.test')), false);
    assert.equal(operatorMayUseWatcher(bOnly, properties, 'watcher2', resolve({ watcher2: 'http://pi-b.test' })), true);
    // 남의 이름표, 형식 오류, 주소 없음
    assert.equal(operatorMayUseWatcher(mine, properties, 'watcher2', resolve({ watcher2: 'http://pi-b.test' })), false);
    for (const bad of [undefined, null, '', 5, ['watcher1']]) assert.equal(operatorMayUseWatcher(mine, properties, bad, resolve({ watcher1: 'http://pi.test' })), false, String(bad));
    assert.equal(operatorMayUseWatcher(mine, properties, 'watcher1', () => null), false);
  });
  test('★ 워처 하나가 여러 숙소를 맡으면(설정 창이 새 숙소에 watcher1 을 미리 채운다) 범위 밖 숙소가 함께 있는 워처는 거절 — 다른 숙소의 CCTV·상태가 섞여 보이지 않게', () => {
    const shared = [
      { id: '파주201', watcherId: 'watcher1', sourceUrl: 'http://pi.test' },
      { id: 'B숙소', watcherId: 'watcher1', sourceUrl: 'http://pi.test' },
    ];
    const resolve = () => 'http://pi.test';
    assert.equal(operatorMayUseWatcher({ all: false, propertyIds: ['B숙소'] }, shared, 'watcher1', resolve), false);
    assert.equal(operatorMayUseWatcher({ all: false, propertyIds: ['파주201'] }, shared, 'watcher1', resolve), false);
    assert.equal(operatorMayUseWatcher({ all: false, propertyIds: ['파주201', 'B숙소'] }, shared, 'watcher1', resolve), true); // 둘 다 맡은 운영자는 허용
    // 같은 이름표라도 다른 Pi 가 보고한 숙소는 다른 워처다 — 섞이지 않는다
    const separate = [
      { id: '파주201', watcherId: 'watcher1', sourceUrl: 'http://pi.test' },
      { id: 'B숙소', watcherId: 'watcher1', sourceUrl: 'http://pi-b.test' },
    ];
    assert.equal(operatorMayUseWatcher({ all: false, propertyIds: ['파주201'] }, separate, 'watcher1', resolve), true);
  });
  test('★ fetch 가 동기적으로 예외를 던져도 진행 중 표시가 영원히 남지 않아 워처가 회복되면 다시 조회된다', async () => {
    let throwSync = true; let calls = 0; let t = 0;
    const fetchImpl = (url) => { calls += 1; if (throwSync) throw new Error('sync boom'); return Promise.resolve({ ok: true, json: async () => [{ id: 'A', watcherId: 'w1' }] }); };
    const lookup = createWatcherPropertyLookup({ getUrls: () => ['http://x'], fetchImpl, ttlMs: 1000, failBackoffMs: 100, staleMs: 10_000, now: () => t, log: () => {} });
    assert.deepEqual(await lookup(), []);
    throwSync = false; t = 5000;
    assert.equal((await lookup()).length, 1, '회복된 워처는 다시 조회돼 목록에 나타나야 한다');
    assert.ok(calls >= 2);
  });
  test('워처 주소 해석: 맵 → 없는 이름은 기본 워처로 폴백 → 아무것도 없으면 null (호출 시점의 환경을 읽는다)', () => {
    const env = { PROPOS_WATCHER_URLS: '{"w1":"http://a"}', PROPOS_WATCHER_URL: 'http://def' };
    assert.equal(resolveWatcherUrl('w1', env), 'http://a');
    assert.equal(resolveWatcherUrl('nope', env), 'http://def');
    assert.equal(resolveWatcherUrl(null, env), 'http://def');
    assert.equal(resolveWatcherUrl('w1', {}), null);
    for (const proto of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(resolveWatcherUrl(proto, env), 'http://def', proto); // 상속 멤버를 주소로 쓰지 않는다
    assert.equal(resolveWatcherUrl('w1', { PROPOS_WATCHER_URLS: '{"w1":123}', PROPOS_WATCHER_URL: 'http://def' }), 'http://def'); // 문자열이 아닌 값은 무시
  });
  test('워처 주소 파싱: 맵+기본, 중복 제거, 잘못된 JSON 은 빈 값', () => {
    const r = parseWatcherUrls({ PROPOS_WATCHER_URLS: '{"a":"http://x","b":"http://x","c":"http://y"}', PROPOS_WATCHER_URL: 'http://z' });
    assert.deepEqual(r.all.sort(), ['http://x', 'http://y', 'http://z']);
    assert.deepEqual(parseWatcherUrls({ PROPOS_WATCHER_URLS: '{bad' }).all, []);
  });
  test('조회기: 보고한 주소를 붙이고, 워처별로 캐시하며, 동시 요청은 하나로 합친다', async () => {
    let calls = 0; let t = 0;
    const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => [{ id: 'A', watcherId: 'w1' }] }; };
    const lookup = createWatcherPropertyLookup({ getUrls: () => ['http://one', 'http://two/'], fetchImpl, ttlMs: 1000, now: () => t });
    assert.deepEqual((await lookup()).map((p) => p.sourceUrl).sort(), ['http://one', 'http://two']);
    const n = calls; await lookup();
    assert.equal(calls, n, '캐시 안에서는 다시 묻지 않는다');
    t = 2000; await lookup();
    assert.ok(calls > n, '캐시가 지나면 다시 묻는다');
    let slowCalls = 0;
    const slow = createWatcherPropertyLookup({ getUrls: () => ['http://one'], fetchImpl: async () => { slowCalls += 1; await new Promise((r) => setTimeout(r, 15)); return { ok: true, json: async () => [{ id: 'A', watcherId: 'w1' }] }; }, ttlMs: 60_000 });
    await Promise.all([slow(), slow(), slow(), slow()]);
    assert.equal(slowCalls, 1, '동시에 온 요청은 진행 중인 조회 하나를 같이 기다린다');
  });
  test('★ 워처 하나가 죽어도 나머지는 캐시를 쓴다 (죽은 워처 때문에 모든 요청이 매번 5초씩 기다리지 않는다) + 실패는 기록하고 잠시 다시 묻지 않는다', async () => {
    const calls = { ok: 0, down: 0 }; let t = 0; const logs = [];
    const fetchImpl = async (url) => {
      if (url.startsWith('http://down')) { calls.down += 1; throw new Error('offline'); }
      calls.ok += 1; return { ok: true, json: async () => [{ id: 'A', watcherId: 'w1' }] };
    };
    const lookup = createWatcherPropertyLookup({ getUrls: () => ['http://ok', 'http://down'], fetchImpl, ttlMs: 60_000, failBackoffMs: 15_000, now: () => t, log: (m) => logs.push(m) });
    assert.equal((await lookup()).length, 1);
    for (let i = 0; i < 5; i++) { t += 1000; await lookup(); }
    assert.equal(calls.ok, 1, '정상 워처는 캐시 — 다시 묻지 않는다');
    assert.equal(calls.down, 1, '실패한 워처도 backoff 동안은 다시 묻지 않는다');
    assert.ok(logs.some((m) => m.includes('http://down')), '실패를 조용히 삼키지 않는다');
    t += 20_000; await lookup();
    assert.equal(calls.down, 2, 'backoff 가 지나면 다시 시도한다');
  });
  test('워처가 잠시 실패하면 마지막 성공 목록을 제한된 시간(staleMs) 안에서만 임시로 쓰고, 그 뒤엔 목록에서 뺀다(안 보이는 쪽이 안전)', async () => {
    let fail = false; let t = 0;
    const fetchImpl = async () => { if (fail) throw new Error('down'); return { ok: true, json: async () => [{ id: 'A', watcherId: 'w1' }] }; };
    const lookup = createWatcherPropertyLookup({ getUrls: () => ['http://x'], fetchImpl, ttlMs: 1000, failBackoffMs: 100, staleMs: 10_000, now: () => t, log: () => {} });
    assert.equal((await lookup()).length, 1);
    fail = true; t = 2000;
    assert.equal((await lookup()).length, 1, '최근 성공 목록을 임시로 사용');
    t = 20_000;
    assert.equal((await lookup()).length, 0, '너무 오래된 목록은 쓰지 않는다');
  });
});

// ───────── 실제 핸들러 실행 ─────────
const SECRET = 's'.repeat(32);
const HASH = `scrypt$${'a'.repeat(32)}$${'b'.repeat(64)}`;
const PH = passwordFingerprint(HASH);
const ENV_KEYS = ['PROPOS_AUTH_MODE', 'PROPOS_ADMIN_PASSWORD', 'PROPOS_SESSION_SECRET'];
let saved;
beforeEach(() => { saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); process.env.PROPOS_AUTH_MODE = 'enforce'; process.env.PROPOS_ADMIN_PASSWORD = 'admin-pass-123'; process.env.PROPOS_SESSION_SECRET = SECRET; });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } _setAuthDbForTest(null); });
const adminCookie = () => `${COOKIE_NAME}=${createSessionToken({ PROPOS_SESSION_SECRET: SECRET })}`;
const opCookie = () => `${COOKIE_NAME}=${createSessionToken({ PROPOS_SESSION_SECRET: SECRET }, Date.now(), { role: 'operator', sub: 'op-1', ph: PH })}`;
const fakeDb = (props = ['파주201']) => ({ async query(sql) { if (sql.includes('FROM operators o LEFT JOIN operator_properties')) return { rows: [{ active: true, password_hash: HASH, property_ids: props }] }; throw new Error(`예상 못 한 SQL ${sql}`); } });
const mkRes = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { if (b) { try { this.body = JSON.parse(b); } catch { this.body = b; } } }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } });
const mkReq = ({ method = 'GET', url, query = {}, body, cookie }) => ({ method, url, query, headers: cookie ? { cookie } : {}, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } });
// 실제 서비스(HA·워처)로 나가는 요청은 전부 여기서 가로채 기록한다 — 테스트가 집의 Home Assistant 를 건드리지 않게
let outbound; let realFetch;
const stubFetch = (reply) => { outbound = []; realFetch = globalThis.fetch; globalThis.fetch = async (url, init) => { outbound.push({ url: String(url), method: init?.method ?? 'GET' }); return reply(String(url), init); }; };
const restoreFetch = () => { globalThis.fetch = realFetch; };
const jsonReply = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => 'application/json' }, arrayBuffer: async () => new ArrayBuffer(0) });

describe('실제 핸들러: /api/ha', () => {
  let mod;
  beforeEach(async () => { mod = await import('../../api/ha/[...slug].js'); _setAuthDbForTest(fakeDb()); mod._setAreaLookupForTest(getAreaEntityIds); stubFetch(() => jsonReply({ state: 'on' })); });
  afterEach(() => { mod._setAreaLookupForTest(null); restoreFetch(); });
  // Vercel 은 slug 를 배열로 준다 — 배열 경로를 그대로 쓴다
  const call = async ({ slug, query, ...opts }) => { const res = mkRes(); await mod.default(mkReq({ url: `/api/ha/${slug}`, ...opts, query: { slug: [slug], ...(query ?? {}) } }), res); return res; };
  const haCalls = () => outbound.filter((o) => /\/api\/(states|services|template|history)/.test(o.url));

  test('로그인 없으면 401, 서비스로 나가는 요청 없음', async () => {
    assert.equal((await call({ slug: 'state', query: { entityId: 'light.a' } })).statusCode, 401);
    assert.equal(haCalls().length, 0);
  });
  test('운영자: 남의 기기·all-states·임의 템플릿·남의 기기 제어는 403 이고 HA 로 나가는 요청이 0건', async () => {
    const cookie = opCookie();
    assert.equal((await call({ slug: 'state', query: { entityId: 'light.other' }, cookie })).statusCode, 403);
    assert.equal((await call({ slug: 'all-states', cookie })).statusCode, 403);
    assert.equal((await call({ slug: 'template', method: 'POST', body: { template: '{{ states | tojson }}' }, cookie })).statusCode, 403);
    assert.equal((await call({ slug: 'service', method: 'POST', body: { domain: 'light', service: 'turn_on', data: { entity_id: 'light.other' } }, cookie })).statusCode, 403);
    assert.equal((await call({ slug: 'service', method: 'POST', body: { domain: 'homeassistant', service: 'turn_off', data: { area_id: 'B숙소' } }, cookie })).statusCode, 403);
    assert.equal((await call({ slug: 'service', method: 'POST', body: { domain: 'homeassistant', service: 'turn_off', data: { area_id: '파주201' } }, cookie })).statusCode, 403); // 자기 영역 전체도 자동화용이라 운영자에겐 거절
    assert.equal((await call({ slug: 'service', method: 'POST', body: { domain: 'homeassistant', service: 'reload_config_entry', data: { entity_id: 'light.a' } }, cookie })).statusCode, 403);
    assert.equal(haCalls().length, 0, '거절된 요청은 HA 에 닿지 않는다');
  });
  test('운영자: 자기 숙소 요청은 통과해 HA 로 실제 요청이 나간다', async () => {
    const cookie = opCookie();
    for (const opts of [
      { slug: 'state', query: { entityId: 'light.a' } },
      { slug: 'template', method: 'POST', body: { template: areaEntitiesTemplate('파주201') } },
      { slug: 'states', method: 'POST', body: { entityIds: ['light.a'] } },
      { slug: 'service', method: 'POST', body: { domain: 'light', service: 'turn_on', data: { entity_id: 'light.a' } } },
      { slug: 'service', method: 'POST', body: { domain: 'homeassistant', service: 'turn_off', data: { entity_id: 'light.a' } } },
    ]) {
      const before = haCalls().length;
      const r = await call({ ...opts, cookie });
      assert.ok(![401, 403].includes(r.statusCode), `${opts.slug} → ${r.statusCode}`);
      assert.ok(haCalls().length > before, `${opts.slug}: HA 로 요청이 나가야 함`);
    }
  });
  test('★ 이력 조회 우회 차단: start 에 "&entityId=남의기기" 를 섞어도 검사가 본 값과 실제 조회 값이 같다', async () => {
    const cookie = opCookie();
    // (1) start 에 섞은 경우 — 인증 단계에서 형식 오류로 거절
    const smuggled = await call({ slug: 'history', query: { entityId: 'light.a', start: '2026-01-01T00:00:00Z&entityId=lock.other' }, cookie });
    assert.equal(smuggled.statusCode, 403);
    assert.equal(haCalls().length, 0);
    // (2) 정상 요청은 통과하고, HA 로 나가는 URL 의 entityId 는 정확히 검사한 값 하나뿐이다
    const ok = await call({ slug: 'history', query: { entityId: 'light.a', start: '2026-01-01T00:00:00Z' }, cookie });
    assert.ok(![401, 403].includes(ok.statusCode), String(ok.statusCode));
    const urls = haCalls().map((o) => o.url);
    assert.ok(urls.length >= 1);
    for (const u of urls) { const q = new URL(u).searchParams; assert.deepEqual(q.getAll('entityId').length <= 1, true); assert.ok(!u.includes('lock.other')); }
  });
  test('핸들러가 쿼리를 다시 해석해도 entityId 를 덮어쓸 수 없다 (핸들러 단독 검증: 인코딩 + 고정 키)', async () => {
    const { handleVercelHistory } = await import('../../server/haApiHandlers.js');
    outbound.length = 0;
    const res = mkRes();
    // 공격자는 start 를 entityId 보다 앞에 둔다 — 옛 코드는 이어붙인 문자열에서 먼저 나온 entityId(=남의 기기)를 썼다
    await handleVercelHistory({ query: { slug: 'history', start: '2026-01-01T00:00:00Z&entityId=lock.other', entityId: 'light.a' } }, res);
    const hist = outbound.find((o) => /\/api\/history\//.test(o.url));
    assert.ok(hist, '이력 요청이 HA 로 나가야 한다');
    assert.equal(new URL(hist.url).searchParams.get('filter_entity_id'), 'light.a'); // 검사가 본 기기가 그대로 조회된다
    assert.ok(!/filter_entity_id=lock/.test(hist.url));
  });
  test('본문이 null 이어도 500 이 아니라 403 (예외 없이 처리)', async () => {
    const r = await call({ slug: 'template', method: 'POST', body: null, cookie: opCookie() });
    assert.equal(r.statusCode, 403);
  });
  test('HA 영역 조회가 실패하면 403(권한 문제처럼 보임)이 아니라 503 이고, 실패는 캐시되지 않아 다음 요청은 정상', async () => {
    let fail = true;
    mod._setAreaLookupForTest(async (area) => { if (fail) throw new Error('HA timeout'); return getAreaEntityIds(area); });
    const cookie = opCookie();
    const first = await call({ slug: 'state', query: { entityId: 'light.a' }, cookie });
    assert.equal(first.statusCode, 503);
    assert.equal(first.body.code, 'HA_UNAVAILABLE');
    fail = false;
    const second = await call({ slug: 'state', query: { entityId: 'light.a' }, cookie });
    assert.ok(![401, 403, 503].includes(second.statusCode), String(second.statusCode));
  });
  test('★ HA 가 응답하지 않아도(멈춤) 제한 시간 안에 503 으로 끝난다 — 플랫폼이 먼저 끊어 504 가 되지 않게', async () => {
    mod._setAreaLookupForTest(null);       // 실제 조회 함수 사용
    mod._setAreaTimeoutForTest(40);
    restoreFetch(); stubFetch(() => new Promise(() => {})); // 영원히 응답하지 않는 HA
    const t0 = Date.now();
    const r = await call({ slug: 'state', query: { entityId: 'light.a' }, cookie: opCookie() });
    mod._setAreaTimeoutForTest(null);
    assert.equal(r.statusCode, 503);
    assert.equal(r.body.code, 'HA_UNAVAILABLE');
    assert.ok(Date.now() - t0 < 2000);
  });
  test('배정이 없는 운영자는 어떤 요청도 403', async () => {
    _setAuthDbForTest(fakeDb([]));
    assert.equal((await call({ slug: 'state', query: { entityId: 'light.a' }, cookie: opCookie() })).statusCode, 403);
    assert.equal(haCalls().length, 0);
  });
  test('관리자는 제한 없음(남의 기기도 통과)', async () => {
    const r = await call({ slug: 'state', query: { entityId: 'light.other' }, cookie: adminCookie() });
    assert.ok(![401, 403].includes(r.statusCode), String(r.statusCode));
    assert.ok(haCalls().length >= 1);
  });
  test('off 모드: 기존 동작 그대로(로그인 없이 통과, DB 연결도 만들지 않는다)', async () => {
    process.env.PROPOS_AUTH_MODE = 'off';
    _setAuthDbForTest({ query() { throw new Error('off 모드에서 DB 를 쓰면 안 된다'); } });
    const r = await call({ slug: 'state', query: { entityId: 'light.other' } });
    assert.ok(![401, 403].includes(r.statusCode), String(r.statusCode));
  });
  test('관리자 세션은 DB 를 건드리지 않는다 (필요할 때만 연결)', async () => {
    _setAuthDbForTest({ query() { throw new Error('관리자 요청에서 DB 를 쓰면 안 된다'); } });
    const r = await call({ slug: 'state', query: { entityId: 'light.a' }, cookie: adminCookie() });
    assert.ok(![401, 403, 503].includes(r.statusCode), String(r.statusCode));
  });
});

describe('실제 핸들러: /api/properties (워처 메타데이터)', () => {
  let mod;
  const PI = [{ id: '파주201', name: '파주201', watcherId: 'watcher1', devices: { light: 'light.a' } }, { id: 'B숙소', name: 'B', watcherId: 'watcher2', devices: {} }];
  beforeEach(async () => { mod = await import('../../api/properties.js'); _setAuthDbForTest(fakeDb()); stubFetch(() => jsonReply(PI)); });
  afterEach(() => { restoreFetch(); });
  const call = async (opts) => { const res = mkRes(); await mod.default(mkReq({ url: '/api/properties', ...opts }), res); return res; };

  test('운영자: 자기 숙소 메타데이터만 (남의 숙소·워처는 목록에 없다)', async () => {
    const r = await call({ cookie: opCookie() });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body.map((p) => p.id), ['파주201']);
  });
  test('운영자: 워처가 오류를 돌려주거나 연결이 실패해도 상세를 내려주지 않는다', async () => {
    restoreFetch(); stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: 'internal secret detail http://192.168.1.5' }) }));
    const r = await call({ cookie: opCookie() });
    assert.deepEqual([r.statusCode, r.body], [200, []]);
    restoreFetch(); stubFetch(() => { throw new Error('connect ECONNREFUSED http://192.168.1.5:3001'); });
    const r2 = await call({ cookie: opCookie() });
    assert.equal(r2.statusCode, 502);
    assert.ok(!JSON.stringify(r2.body).includes('192.168'), JSON.stringify(r2.body));
    const admin = await call({ cookie: adminCookie() });
    assert.ok(JSON.stringify(admin.body).includes('ECONNREFUSED'), '관리자에게는 원인을 보여 준다');
  });
  test('관리자: 전체, 로그인 없음: 401', async () => {
    assert.equal((await call({ cookie: adminCookie() })).body.length, 2);
    assert.equal((await call({})).statusCode, 401);
  });
  test('저장(PUT)은 관리자만 — 운영자 403, 익명 401', async () => {
    assert.equal((await call({ method: 'PUT', body: [], cookie: opCookie() })).statusCode, 403);
    assert.equal((await call({ method: 'PUT', body: [] })).statusCode, 401);
  });
});

describe('실제 핸들러: /api/monitoring 과 /api/camera/snapshot', () => {
  let mon; let cam;
  const PROPS = [{ id: '파주201', watcherId: 'watcher1', sourceUrl: 'http://pi.test' }, { id: 'B숙소', watcherId: 'watcher2', sourceUrl: 'http://pi-b.test' }];
  const lookup = async () => PROPS;
  beforeEach(async () => {
    mon = await import('../../api/monitoring/[...slug].js'); cam = await import('../../api/camera/snapshot.js');
    mon._setForTest({ db: fakeDb(), lookup });
    stubFetch(() => ({ ...jsonReply({ ok: true }), headers: { get: () => 'image/jpeg' } }));
  });
  afterEach(() => { mon._setForTest(); cam._setForTest(); restoreFetch(); });
  const callMon = async ({ query, slug = 'state', ...opts }) => { const res = mkRes(); await mon.default(mkReq({ url: `/api/monitoring/${slug}`, ...opts, query: { slug: [slug], ...(query ?? {}) } }), res); return res; };
  const callCam = async ({ query, ...opts }) => { cam._setForTest({ db: fakeDb(), lookup }); const res = mkRes(); await cam.default(mkReq({ url: '/api/camera/snapshot', ...opts, query: { path: '/local/snapshots/x.jpg', ...(query ?? {}) } }), res); return res; };

  test('모니터링: 운영자는 자기 워처의 상태 조회(GET)만', async () => {
    const cookie = opCookie();
    assert.equal((await callMon({ query: { watcherId: 'watcher1' }, cookie })).statusCode, 200);
    assert.equal((await callMon({ query: { watcherId: 'watcher2' }, cookie })).statusCode, 403); // 남의 워처
    assert.equal((await callMon({ cookie })).statusCode, 403);                                  // 워처 미지정
    assert.equal((await callMon({ method: 'PUT', query: { watcherId: 'watcher1' }, body: {}, cookie })).statusCode, 403);
    assert.equal((await callMon({ method: 'POST', query: { watcherId: 'watcher1' }, body: {}, cookie })).statusCode, 403);
    assert.equal((await callMon({ slug: 'config', method: 'POST', query: { watcherId: 'watcher1' }, body: {}, cookie })).statusCode, 403); // 설정 전송은 관리자 전용
  });
  test('★ 모니터링: 이름표는 맞지만 그 이름의 주소가 기본 Pi(다른 숙소) 로 폴백되면 거절', async () => {
    // B숙소 운영자, watcher2 이름표는 B 소유. 주소 맵에는 watcher2 가 없어 기본 Pi(http://pi.test = 파주201 의 Pi)로 폴백된다.
    _setAuthDbForTest(fakeDb(['B숙소']));
    const r = await callMon({ query: { watcherId: 'watcher2' }, cookie: opCookie() });
    assert.equal(r.statusCode, 403);
    assert.equal(outbound.filter((o) => o.url.includes('/api/monitoring')).length, 0, '워처로 나가는 요청이 없어야 한다');
  });
  test('모니터링: 워처가 오류를 돌려주거나 연결이 실패해도 운영자에게 상세를 주지 않는다 / 관리자에게는 그대로', async () => {
    restoreFetch(); stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: 'stack trace /srv/pi/app.js:12' }) }));
    const op = await callMon({ query: { watcherId: 'watcher1' }, cookie: opCookie() });
    assert.equal(op.statusCode, 502);
    assert.ok(!JSON.stringify(op.body).includes('/srv/pi'));
    const admin = await callMon({ query: { watcherId: 'watcher1' }, cookie: adminCookie() });
    assert.equal(admin.statusCode, 500);
    restoreFetch(); stubFetch(() => { throw new Error('connect ECONNREFUSED http://192.168.1.5:3001'); });
    const op2 = await callMon({ query: { watcherId: 'watcher1' }, cookie: opCookie() });
    assert.ok(!JSON.stringify(op2.body).includes('192.168'));
  });
  test('모니터링: 관리자는 전부, 익명은 401', async () => {
    assert.equal((await callMon({ query: { watcherId: 'watcher2' }, cookie: adminCookie() })).statusCode, 200);
    assert.equal((await callMon({ query: { watcherId: 'watcher1' } })).statusCode, 401);
  });
  test('CCTV: 운영자는 자기 워처의 스냅샷만, 워처 미지정·남의 워처는 403', async () => {
    const cookie = opCookie();
    assert.equal((await callCam({ query: { watcherId: 'watcher1' }, cookie })).statusCode, 200);
    assert.equal((await callCam({ query: { watcherId: 'watcher2' }, cookie })).statusCode, 403);
    assert.equal((await callCam({ cookie })).statusCode, 403);
  });
  test('★ CCTV: 이름표는 맞지만 주소가 기본 Pi 로 폴백되면 거절(남의 CCTV 차단), 워처로 나가는 요청 없음', async () => {
    _setAuthDbForTest(fakeDb(['B숙소']));
    cam._setForTest({ db: fakeDb(['B숙소']), lookup });
    const res = mkRes();
    await cam.default(mkReq({ url: '/api/camera/snapshot', query: { path: '/local/snapshots/x.jpg', watcherId: 'watcher2' }, cookie: opCookie() }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(outbound.filter((o) => o.url.includes('/api/camera')).length, 0);
  });
  test('CCTV: 응답은 공용 캐시에 남지 않는다 (private, 쿠키별) — 로그아웃·정지 뒤 24시간 남던 문제', async () => {
    const r = await callCam({ query: { watcherId: 'watcher1' }, cookie: opCookie() });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['Cache-Control'], /^private, max-age=300$/);
    assert.ok(!/public/.test(r.headers['Cache-Control']));
    assert.equal(r.headers.Vary, 'Cookie');
  });
  test('CCTV: 경로 검사(스냅샷 폴더 밖·상위 경로)는 운영자 허용 뒤에도 그대로 400', async () => {
    const cookie = opCookie();
    assert.equal((await callCam({ query: { watcherId: 'watcher1', path: '/etc/passwd' }, cookie })).statusCode, 400);
    assert.equal((await callCam({ query: { watcherId: 'watcher1', path: '/local/snapshots/../secret' }, cookie })).statusCode, 400);
  });
  test('CCTV: 관리자는 전부, 익명은 401', async () => {
    assert.equal((await callCam({ query: { watcherId: 'watcher2' }, cookie: adminCookie() })).statusCode, 200);
    assert.equal((await callCam({ query: { watcherId: 'watcher1' } })).statusCode, 401);
  });
});

describe('코드 계약 (리뷰 반영)', () => {
  const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  test('화면: 서버가 거절한 자동화에 "종료 중/실행 중" 성공 토스트를 띄우지 않는다 (호출이 성공한 뒤에만 안내)', () => {
    const r = read('src/components/v2/RoomStateApp.jsx');
    assert.match(r, /callService\('homeassistant', 'turn_off', \{ area_id: syncConfig\.name \}\)\s*\.then\(\(\) => Toast\.show\('퇴실 확인/);
    assert.match(r, /callService\('homeassistant', 'turn_on', \{ area_id: syncConfig\.name \}\)\s*\.then\(\(\) => Toast\.show\('입실 준비/);
  });
  test('공용 DB 풀: 연결 오류 리스너가 있고, 접속 주소가 없으면 localhost 로 붙지 않고 명시적으로 실패한다', () => {
    const d = read('server/auth/authDb.js');
    assert.match(d, /pool\.on\('error'/);
    assert.match(d, /if \(!process\.env\.POSTGRES_URL\) throw/);
  });
  test('HA 영역 조회: 제한 시간에 실제 요청을 취소(AbortSignal)하고 시간 경쟁도 함께 쓴다 / renderHaTemplate 가 신호를 받는다', () => {
    const h = read('api/ha/[...slug].js');
    assert.match(h, /signal: AbortSignal\.timeout\(AREA_LOOKUP_TIMEOUT_MS\)/);
    assert.match(h, /withTimeout\(renderHaTemplate\(/);
    assert.match(read('server/haProxy.js'), /renderHaTemplate\(template, \{ signal \} = \{\}\)/);
  });
  test('모니터링·CCTV: 값싼 형식 검사(워처 id 문자열)를 워처 목록 조회보다 먼저 한다 / CCTV path 는 문자열로 강제', () => {
    const m = read('api/monitoring/[...slug].js');
    assert.ok(m.indexOf('typeof wantedWatcher !== "string"') < m.indexOf('await watcherLookup()'));
    const c = read('api/camera/snapshot.js');
    assert.ok(c.indexOf("typeof watcherId !== 'string'") < c.indexOf('await watcherLookup()'));
    assert.match(c, /typeof req\.query\?\.path === 'string'/);
  });
  test('서버 숙소 저장: 이미 저장된 이름이면 HA 템플릿 금지 문자 규칙을 적용하지 않는다', () => {
    assert.match(read('api/cleaning/[...slug].js'), /validatePropertyName\(name, \{ unchangedFrom: savedRow\?\.name \}\)/);
  });
});

describe('실제 핸들러: 입력 방어', () => {
  let cam;
  beforeEach(async () => { cam = await import('../../api/camera/snapshot.js'); _setAuthDbForTest(fakeDb()); stubFetch(() => ({ ...jsonReply({}), headers: { get: () => 'image/jpeg' } })); });
  afterEach(() => { cam._setForTest(); restoreFetch(); });
  test('CCTV: path 를 두 번 보내 배열이 돼도 500 이 아니라 400', async () => {
    cam._setForTest({ db: fakeDb(), lookup: async () => [{ id: '파주201', watcherId: 'watcher1', sourceUrl: 'http://pi.test' }] });
    const res = mkRes();
    await cam.default(mkReq({ url: '/api/camera/snapshot', query: { watcherId: 'watcher1', path: ['/local/snapshots/a.jpg', 'b'] }, cookie: opCookie() }), res);
    assert.equal(res.statusCode, 400);
  });
  test('CCTV·모니터링: 워처 id 가 없는 운영자 요청은 워처 목록 조회까지 가지 않고 거절', async () => {
    let lookups = 0;
    const lookup = async () => { lookups += 1; return []; };
    cam._setForTest({ db: fakeDb(), lookup });
    const res = mkRes();
    await cam.default(mkReq({ url: '/api/camera/snapshot', query: { path: '/local/snapshots/a.jpg' }, cookie: opCookie() }), res);
    assert.equal(res.statusCode, 403);
    const mon = await import('../../api/monitoring/[...slug].js');
    mon._setForTest({ db: fakeDb(), lookup });
    const res2 = mkRes();
    await mon.default(mkReq({ url: '/api/monitoring/state', query: { slug: ['state'] }, cookie: opCookie() }), res2);
    mon._setForTest();
    assert.equal(res2.statusCode, 403);
    assert.equal(lookups, 0);
  });
});
