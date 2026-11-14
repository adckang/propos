import '../helpers/isolateDataDir.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from '@babel/parser';

const root = new URL('../../', import.meta.url).pathname;
const setupUrl = new URL('../integration/helpers/setup.js', import.meta.url).href;
const watcherUrl = new URL('../integration/helpers/watcherHelper.js', import.meta.url).href;
const haHelperUrl = new URL('../integration/helpers/haHelper.js', import.meta.url).href;

test('통합 워처 helper는 상속받은 저장 경로와 운영 인증값을 격리한다', () => {
  const canary = mkdtempSync(join(tmpdir(), 'propos-integration-canary-'));
  const files = ['monitoring-state.json', 'monitoring-config.json'];
  const sentinel = JSON.stringify({ testCanary: true });
  for (const file of files) writeFileSync(join(canary, file), sentinel);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const {readFileSync} = await import('node:fs');
    const {join} = await import('node:path');
    globalThis.fetch = async () => { throw new Error('Unexpected network blocked by canary'); };
    const helper = await import(${JSON.stringify(watcherUrl)});
    const setup = await import(${JSON.stringify(setupUrl)});
    let piWrites = 0;
    globalThis.fetch = async url => {
      const path = new URL(url).pathname;
      if (path === '/api/events/write') piWrites++;
      return {ok:true,text:async()=>'[]',json:async()=>({inserted:true})};
    };
    helper.setRoomState({mainStatus:'VACANT',subStatus:'CLEANING_FINISHED'});
    helper.setMonitoringConfig({areaName:'fixture-property',reservation:null});
    await new Promise(resolve=>setTimeout(resolve,30));
    const watcher = await import(${JSON.stringify(new URL('../../server/occupancyWatcher.js', import.meta.url).href)});
    await watcher.dispatchMonitoringEvent({type:'maintenance_started',propertyId:'fixture-property'});
    helper.stopWatcher();
    console.log('__ISOLATION_RESULT__'+JSON.stringify({
      isolated:process.env.PROPOS_DATA_DIR!==${JSON.stringify(canary)},
      live:setup.HA_AVAILABLE,
      piSecretPresent:!!process.env.PROPOS_PI_SECRET,
      slackPresent:!!process.env.PROPOS_SLACK_WEBHOOK,
      piWrites,
      canariesIntact:${JSON.stringify(files)}.every(file=>readFileSync(join(${JSON.stringify(canary)},file),'utf8')===${JSON.stringify(sentinel)})
    }));
  `], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, RUN_LIVE_HA: '0', PROPOS_DATA_DIR: canary,
      PROPOS_HA_BASE_URL: 'http://ha.fixture.invalid', PROPOS_HA_WS_URL: 'ws://ha.fixture.invalid/api/websocket',
      PROPOS_HA_TOKEN: 'fixture-token', PROPOS_PI_SECRET: 'fixture-pi-secret', PROPOS_SLACK_WEBHOOK: 'https://slack.fixture.invalid/test' },
  });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split('\n').find(line => line.startsWith('__ISOLATION_RESULT__'));
  assert.ok(line, 'Child process must report isolation results');
  assert.deepEqual(JSON.parse(line.slice('__ISOLATION_RESULT__'.length)), {
    isolated: true, live: false, piSecretPresent: false, slackPresent: false, piWrites: 0, canariesIntact: true,
  });
  for (const file of files) assert.equal(readFileSync(join(canary, file), 'utf8'), sentinel);
});

for (const enabled of [false, true]) test(`HA 통합시험은 명시적 실행값과 대상 호스트를 확인한다 — live=${enabled}`, () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const assert = (await import('node:assert/strict')).default;
    let calls=0;
    globalThis.fetch=async()=>{calls++;return {ok:true};};
    const setup=await import(${JSON.stringify(setupUrl)});
    assert.equal(setup.HA_AVAILABLE,${enabled});
    await assert.rejects(fetch('https://proposonline.com/api/events/write',{method:'POST'}));
    await assert.rejects(fetch('https://slack.fixture.invalid/test',{method:'POST'}));
    assert.equal(calls,0);
    if(${enabled}){
      await fetch(setup.HA_BASE_URL+'/api/');
      assert.equal(calls,1);
    }else{
      await assert.rejects(fetch(setup.HA_BASE_URL+'/api/'));
      assert.equal(calls,0);
    }
  `], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, RUN_LIVE_HA: enabled ? '1' : '0',
      PROPOS_HA_BASE_URL: 'http://ha.fixture.invalid', PROPOS_HA_WS_URL: 'ws://ha.fixture.invalid/api/websocket', PROPOS_HA_TOKEN: 'fixture-token' },
  });
  assert.equal(result.status, 0, result.stderr);
});

const liveTestSource = readFileSync(new URL('../integration/s30.watcher-ha.test.js', import.meta.url), 'utf8');
const liveSuite = parse(liveTestSource, { sourceType: 'module' }).program.body.find(node =>
  node.expression?.callee?.name === 'describe' && node.expression.arguments[0]?.value?.startsWith('IT-002'));
assert.ok(liveSuite, 'Actual IT-002 suite must exist');
const liveTest = liveSuite.expression.arguments.at(-1).body.body.find(node => node.expression?.callee?.name === 'test');
assert.ok(liveTest, 'Actual switch test must exist');
const callback = liveTest.expression.arguments.at(-1);
const liveTestBody = liveTestSource.slice(callback.start, callback.end);

for (const initial of ['on', 'off']) {
  for (const fails of [false, true]) {
    test(`실장치 시험의 실제 본문은 원래 상태를 finally에서 복원한다 — ${initial}, failure=${fails}`, () => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const assert = (await import('node:assert/strict')).default;
        let state = ${JSON.stringify(initial)};
        const commands = [];
        globalThis.fetch = async (url, options = {}) => {
          const target = new URL(url);
          assert.equal(target.origin, 'http://ha.fixture.invalid');
          if (target.pathname === '/api/states/input_boolean.propos_test_door') {
            return {ok:true, json:async()=>({state})};
          }
          const body = JSON.parse(options.body);
          assert.equal(body.entity_id, 'input_boolean.propos_test_door');
          assert.ok(['/api/services/input_boolean/turn_on', '/api/services/input_boolean/turn_off'].includes(target.pathname));
          state = target.pathname.endsWith('/turn_on') ? 'on' : 'off';
          commands.push(state);
          return {ok:true, json:async()=>({})};
        };
        const ha = await import(${JSON.stringify(haHelperUrl)});
        const waitForWatcherState = async () => {
          if (${fails}) throw new Error('fixture monitoring failure');
          return {lastEventAt:2, lastError:null};
        };
        const exercise = new Function('assert', 'getEntityState', 'setInputBoolean', 'waitForEntityState', 'getMonitoringState', 'waitForWatcherState',
          'return (' + ${JSON.stringify(liveTestBody)} + ');')(assert, ha.getEntityState, ha.setInputBoolean, ha.waitForEntityState,
            ()=>({lastEventAt:1}), waitForWatcherState);
        if (${fails}) await assert.rejects(exercise(), /fixture monitoring failure/);
        else await exercise();
        assert.equal(state, ${JSON.stringify(initial)});
        assert.deepEqual(commands, ${JSON.stringify(initial === 'on' ? ['off', 'on'] : ['on', 'off'])});
      `], {
        cwd: root, encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, RUN_LIVE_HA: '1', PROPOS_HA_BASE_URL: 'http://ha.fixture.invalid',
          PROPOS_HA_WS_URL: 'ws://ha.fixture.invalid/api/websocket', PROPOS_HA_TOKEN: 'fixture-token' },
      });
      assert.equal(result.status, 0, result.stderr);
    });
  }
}
