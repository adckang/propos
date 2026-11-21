/**
 * RF-28 — 감지 필수 센서(문·움직임)가 30분 넘게 꺼지면 문제 이벤트 1건 + 운영자 알림, 돌아오면 해소 이벤트(DEC-08).
 * 객실 상태는 바꾸지 않는다. 배경: 파주201 현관 움직임 센서가 10-30부터 꺼져 있었는데 아무 알림이 없었다.
 */
import { TEST_DATA_DIR } from '../helpers/isolateDataDir.js';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { detectionSensors, evaluateSensorOffline, pendingOperatorAlerts, sanitizeSensorTracking, sensorEventOffsetMs, sensorOfflineAlertMessage } from '../../src/domain/sensorHealthDomain.js';
import { request, event as apiEvent } from '../helpers/eventApiFixture.js';
import { countPeriodEvents } from '../../src/domain/reportingDomain.js';
import { buildIssueItems } from '../../src/domain/monthlyCalendarDomain.js';

const MIN = 60_000;
const T0 = Date.parse('2026-11-21T01:00:00.000Z');
const sensor = (state, changedAt, { dc = 'motion', name = '현관 움직임' } = {}) => ({
  state, last_changed: new Date(changedAt).toISOString(), attributes: { device_class: dc, friendly_name: name },
});
const types = events => events.map(event => event.type);
const OFF = sensorEventOffsetMs('binary_sensor.motion'); // 센서마다 고정된 0~999ms

function run(steps, { tracked = {} } = {}) {
  const out = [];
  for (const [now, stateMap] of steps) {
    const result = evaluateSensorOffline({ stateMap, tracked, now, mainStatus: 'OCCUPIED' });
    tracked = result.tracked;
    out.push(...result.events);
  }
  return { events: out, tracked };
}

describe('RF-28 판정 규칙', () => {
  test('감지 필수 센서는 binary_sensor 중 문·움직임뿐이다', () => {
    const list = detectionSensors({
      'binary_sensor.motion': sensor('on', T0),
      'binary_sensor.door': sensor('off', T0, { dc: 'door', name: '현관문' }),
      'binary_sensor.smoke': sensor('unavailable', T0, { dc: 'smoke' }),
      'sensor.motion_like': sensor('unavailable', T0),
      'binary_sensor.no_class': { state: 'unavailable', attributes: {} },
    });
    assert.deepEqual(list.map(s => [s.entityId, s.role]), [['binary_sensor.door', 'door'], ['binary_sensor.motion', 'motion']]);
  });

  test('30분 넘게 꺼지면 1건 — 발생 시각은 꺼진 시각 + 30분(+센서 고정 오프셋), 반복 판정해도 다시 내지 않는다', () => {
    const off = { 'binary_sensor.motion': sensor('unavailable', T0) };
    const { events, tracked } = run([[T0 + 29 * MIN, off], [T0 + 30 * MIN, off], [T0 + 90 * MIN, off]]);
    assert.deepEqual(types(events), ['sensor_offline_detected']);
    assert.equal(events[0].timestamp, T0 + 30 * MIN + OFF);
    assert.ok(OFF >= 0 && OFF < 1000);
    assert.equal(events[0].data.entityId, 'binary_sensor.motion');
    assert.equal(events[0].data.role, 'motion');
    assert.equal(events[0].data.offlineSince, new Date(T0).toISOString());
    assert.equal(events[0].data.mainStatus, 'OCCUPIED');
    assert.equal(tracked['binary_sensor.motion'].reportedAt, T0 + 30 * MIN + OFF);
    assert.equal(tracked['binary_sensor.motion'].alertedAt, null, '보고와 알림은 따로 기록한다');
  });

  test('이미 오래 꺼져 있던 센서는 처음 본 판정에서 바로 1건 (10-30부터 꺼진 파주201 사례)', () => {
    const since = Date.parse('2026-10-30T05:00:00.000Z');
    const { events } = run([[T0, { 'binary_sensor.motion': sensor('unavailable', since) }]]);
    assert.deepEqual(types(events), ['sensor_offline_detected']);
    assert.equal(events[0].timestamp, since + 30 * MIN + OFF);
  });

  test('30분 안에 돌아오면 기록하지 않는다 (정기 재시작·업데이트)', () => {
    const { events, tracked } = run([
      [T0 + MIN, { 'binary_sensor.motion': sensor('unavailable', T0) }],
      [T0 + 20 * MIN, { 'binary_sensor.motion': sensor('off', T0 + 20 * MIN) }],
      [T0 + 60 * MIN, { 'binary_sensor.motion': sensor('off', T0 + 20 * MIN) }],
    ]);
    assert.deepEqual(events, []);
    assert.deepEqual(tracked, {});
  });

  test('unknown만으로는 꺼짐이 아니다 — 값이 바뀔 때만 보고하는 센서는 HA 재시작 뒤 한동안 unknown이다', () => {
    const { events, tracked } = run([[T0 + 2 * 60 * MIN, { 'binary_sensor.motion': sensor('unknown', T0) }]]);
    assert.deepEqual(events, []);
    assert.deepEqual(tracked, {});
  });

  test('꺼진 뒤 unknown을 거쳐도 이어진 끊김이고, 처음 꺼진 시각부터 센다', () => {
    const { events } = run([
      [T0 + MIN, { 'binary_sensor.motion': sensor('unavailable', T0) }],
      [T0 + 20 * MIN, { 'binary_sensor.motion': sensor('unknown', T0 + 20 * MIN) }],
      [T0 + 25 * MIN, { 'binary_sensor.motion': sensor('unavailable', T0 + 25 * MIN) }],
      [T0 + 31 * MIN, { 'binary_sensor.motion': sensor('unavailable', T0 + 25 * MIN) }],
    ]);
    assert.deepEqual(types(events), ['sensor_offline_detected']);
    assert.equal(events[0].timestamp, T0 + 30 * MIN + OFF);
  });

  test('저장된 추적 상태의 깨진 항목은 버린다 — 판정이 멈추지 않는다', () => {
    assert.deepEqual(sanitizeSensorTracking([]), {});
    assert.deepEqual(sanitizeSensorTracking({ a: null, b: { offlineSince: 'x' }, c: { offlineSince: 1, reportedAt: 'y' }, d: { offlineSince: 1, reportedAt: 2, role: 'door', name: 'D' } }),
      { d: { offlineSince: 1, reportedAt: 2, alertedAt: null, role: 'door', name: 'D' } });
    const broken = { 'binary_sensor.motion': { offlineSince: undefined, reportedAt: T0 } };
    const result = evaluateSensorOffline({ stateMap: { 'binary_sensor.motion': sensor('off', T0) }, tracked: broken, now: T0 });
    assert.deepEqual(result.events, [], '깨진 항목으로 엉터리 해소 이벤트를 내지 않는다');
    assert.deepEqual(result.tracked, {});
  });

  test('숙소 구역 기기 목록에서 빠진 센서는 추적만 지운다(복구를 본 게 아니므로 해소 이벤트 없음)', () => {
    const tracked = { 'binary_sensor.old': { offlineSince: T0, reportedAt: T0 + 30 * MIN, role: 'motion', name: 'old' } };
    const kept = evaluateSensorOffline({ stateMap: {}, tracked, now: T0 + 60 * MIN, knownEntityIds: new Set() });
    assert.deepEqual(Object.keys(kept.tracked), ['binary_sensor.old'], '목록을 못 읽었으면(빈 목록) 지우지 않는다');
    const dropped = evaluateSensorOffline({ stateMap: {}, tracked, now: T0 + 60 * MIN, knownEntityIds: new Set(['binary_sensor.new']) });
    assert.deepEqual(dropped.tracked, {});
    assert.deepEqual(dropped.events, []);
    assert.deepEqual(dropped.dropped, ['binary_sensor.old'], '워처가 그 센서의 알림창 알림을 지울 수 있게 알려 준다');
    assert.equal(dropped.changed, true);
  });

  test('알린 센서가 돌아오면 해소 1건 — 발생 시각은 돌아온 시각', () => {
    const { events, tracked } = run([
      [T0 + 31 * MIN, { 'binary_sensor.motion': sensor('unavailable', T0) }],
      [T0 + 50 * MIN, { 'binary_sensor.motion': sensor('off', T0 + 45 * MIN) }],
      [T0 + 51 * MIN, { 'binary_sensor.motion': sensor('off', T0 + 45 * MIN) }],
    ]);
    assert.deepEqual(types(events), ['sensor_offline_detected', 'sensor_offline_resolved']);
    assert.equal(events[1].timestamp, T0 + 45 * MIN + OFF);
    assert.equal(events[1].data.detectedAt, new Date(events[0].timestamp).toISOString(), '끊김 이벤트의 발생 시각');
    assert.deepEqual(tracked, {});
  });

  test('구역 상태에서 잠깐 사라져도 추적을 지우지 않는다 — 다시 보여도 중복 알림이 없다', () => {
    const off = { 'binary_sensor.motion': sensor('unavailable', T0) };
    const { events } = run([[T0 + 31 * MIN, off], [T0 + 32 * MIN, {}], [T0 + 33 * MIN, off]]);
    assert.deepEqual(types(events), ['sensor_offline_detected']);
  });

  test('두 센서가 같은 순간 꺼져도 둘 다 남는다 — 발생 시각을 1ms 밀어 DB 중복 방지에 걸리지 않게', () => {
    const { events } = run([[T0 + 31 * MIN, {
      'binary_sensor.door': sensor('unavailable', T0, { dc: 'door', name: '현관문' }),
      'binary_sensor.motion': sensor('unavailable', T0),
    }]]);
    assert.deepEqual(events.map(e => e.data.entityId), ['binary_sensor.door', 'binary_sensor.motion']);
    assert.equal(new Set(events.map(e => e.timestamp)).size, 2);
  });

  test('센서 고정 오프셋까지 같은 두 센서도 같은 판정 안에서는 1ms 밀어 둘 다 남긴다', () => {
    assert.equal(sensorEventOffsetMs('binary_sensor.motion_29'), sensorEventOffsetMs('binary_sensor.motion_32'));
    const { events } = run([[T0 + 31 * MIN, {
      'binary_sensor.motion_29': sensor('unavailable', T0), 'binary_sensor.motion_32': sensor('unavailable', T0),
    }]]);
    assert.equal(events.length, 2);
    assert.equal(new Set(events.map(e => e.timestamp)).size, 2);
  });

  test('두 센서가 같은 순간 돌아와도 판정이 나뉘면(다시 처리) 시각이 겹치지 않는다', () => {
    const door = { 'binary_sensor.door': { offlineSince: T0, reportedAt: T0 + 30 * MIN, alertedAt: T0, role: 'door', name: '현관문' } };
    const motion = { 'binary_sensor.motion': { offlineSince: T0, reportedAt: T0 + 30 * MIN + 1, alertedAt: T0, role: 'motion', name: '현관 움직임' } };
    const back = T0 + 60 * MIN;
    const a = evaluateSensorOffline({ stateMap: { 'binary_sensor.door': sensor('off', back, { dc: 'door', name: '현관문' }) }, tracked: door, now: back });
    const b = evaluateSensorOffline({ stateMap: { 'binary_sensor.motion': sensor('off', back) }, tracked: motion, now: back });
    assert.notEqual(a.events[0].timestamp, b.events[0].timestamp);
  });

  test('보고했지만 아직 알리지 않은 끊김만 알림 대상이다', () => {
    const tracked = {
      'binary_sensor.a': { offlineSince: T0, reportedAt: T0 + 30 * MIN, alertedAt: null, role: 'motion', name: 'A' },
      'binary_sensor.b': { offlineSince: T0, reportedAt: T0 + 30 * MIN, alertedAt: T0 + 31 * MIN, role: 'door', name: 'B' },
      'binary_sensor.c': { offlineSince: T0, reportedAt: null, alertedAt: null, role: 'motion', name: 'C' },
    };
    const due = pendingOperatorAlerts(tracked);
    assert.deepEqual(due.map(alert => alert.entityId), ['binary_sensor.a']);
    assert.match(sensorOfflineAlertMessage('파주201', due[0]).message, /움직임 센서 "A"/);
  });

  test('알림 문구는 숙소·센서·꺼진 시각(한국 시각)·영향을 담는다', () => {
    const [event] = run([[T0 + 31 * MIN, { 'binary_sensor.motion': sensor('unavailable', T0) }]]).events;
    const { title, message } = sensorOfflineAlertMessage('파주201', event);
    assert.equal(title, 'PROPOS 파주201 감지 센서 연결 끊김');
    assert.match(message, /움직임 센서 "현관 움직임"/);
    assert.match(message, / 11\/21 10:00부터 30분 넘게/);
    assert.match(message, /입실·퇴실 자동 감지/);
  });
});

describe('RF-28 Pi 입구 — 운영자 Slack 링크', () => {
  const offline = { ...apiEvent, type: 'sensor_offline_detected', data: { entityId: 'binary_sensor.motion' } };
  test('센서 끊김은 처음 저장될 때 Slack 링크를 한 번 보낸다', async () => {
    const result = await request('write', offline);
    assert.equal(result.res.code, 200);
    assert.equal(result.notices.length, 1);
    assert.equal(result.notices[0][1], apiEvent.property_id);
    assert.equal(result.notices[0][2], 'sensor_offline_detected');
  });
  test('재전송(DB 중복)·복구·다른 종류는 보내지 않는다', async () => {
    assert.deepEqual((await request('write', offline, { duplicate: true })).notices, []);
    assert.deepEqual((await request('write', { ...offline, type: 'sensor_offline_resolved' })).notices, []);
    assert.deepEqual((await request('write', { ...apiEvent, type: 'late_checkout_detected' })).notices, []);
  });
  test('Slack이 실패해도 저장 응답은 성공 — Pi가 같은 이벤트를 다시 보내지 않게', async () => {
    const result = await request('write', offline, { notifyFails: true });
    assert.equal(result.res.code, 200);
    assert.equal(result.res.body.inserted, true);
  });
});

describe('RF-28 레포트·달력', () => {
  test('끊김은 이상 1건, 복구는 건수에 더하지 않는다', () => {
    const stats = countPeriodEvents([{ type: 'sensor_offline_detected' }, { type: 'sensor_offline_resolved' }]);
    assert.equal(stats.anomalies, 1);
    assert.equal(stats.sensorOffline, 1);
  });

  test('달력 문제 목록: 꺼진 순간의 객실 상태로 구분하고, 같은 센서의 복구만 해소로 짝짓는다', () => {
    const at = iso => new Date(iso).toISOString();
    const items = buildIssueItems([
      { property_id: 'P', type: 'sensor_offline_detected', device_time: at('2026-11-21T01:30:00Z'), data: { entityId: 'binary_sensor.motion', mainStatus: 'OCCUPIED' } },
      { property_id: 'P', type: 'sensor_offline_detected', device_time: at('2026-11-21T01:31:00Z'), data: { entityId: 'binary_sensor.door', mainStatus: 'CLEANING' } },
      { property_id: 'P', type: 'sensor_offline_resolved', device_time: at('2026-11-21T02:00:00Z'), data: { entityId: 'binary_sensor.door' } },
      { property_id: 'P', type: 'sensor_offline_detected', device_time: at('2026-11-21T03:00:00Z'), data: {} },
    ]);
    assert.deepEqual(items.map(item => [item.label, item.category, item.resolved_at]), [
      ['감지 센서 연결 끊김', 'OCCUPIED', null],
      ['감지 센서 연결 끊김', 'CLEANING', at('2026-11-21T02:00:00Z')],
      ['감지 센서 연결 끊김', 'VACANT', null],
    ]);
  });

  test('대상 기기가 없는 기존 문제의 해소 짝짓기는 그대로다', () => {
    const items = buildIssueItems([
      { property_id: 'P', type: 'complaint_detected', device_time: '2026-11-21T01:00:00.000Z' },
      { property_id: 'P', type: 'complaint_resolved', device_time: '2026-11-21T01:20:00.000Z' },
    ]);
    assert.equal(items[0].resolved_at, '2026-11-21T01:20:00.000Z');
  });
});

// ── 워처 전체 실행 — HA·서버 호출은 모두 가로챈다 ──────────────────────────────
process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_WS_URL = 'ws://ha.test/api/websocket';
process.env.PROPOS_HA_TOKEN = 'fixture-token';
process.env.PROPOS_PI_SECRET = 'fixture-key';

let sequence = 0;
async function until(predicate) {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(predicate(), 'Expected watcher condition within 500ms');
}

async function watcherFixture(haStates) {
  const previousFetch = global.fetch, previousWs = global.WebSocket, previousDir = process.env.PROPOS_DATA_DIR;
  const folder = mkdtempSync(join(TEST_DATA_DIR, 'rf28-'));
  process.env.PROPOS_DATA_DIR = folder;
  const services = [];
  global.WebSocket = class { static OPEN = 1; readyState = 1; addEventListener() {} close() {} };
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/api/events/write')) return { ok: false, status: 503, json: async () => ({}) };
    assert.ok(href.startsWith('http://ha.test/'), 'Tests must never call external services');
    if (href.endsWith('/api/template')) return { ok: true, text: async () => JSON.stringify(Object.keys(haStates)) };
    if (href.includes('/api/services/')) {
      services.push({ service: href.split('/api/services/')[1], body: JSON.parse(options.body ?? '{}') });
      return { ok: true, json: async () => ([]) };
    }
    const entity = href.split('/api/states/')[1];
    return { ok: true, json: async () => ({ entity_id: entity, ...haStates[entity] }) };
  };
  const load = () => import(`../../server/occupancyWatcher.js?rf28=${++sequence}`);
  const watcher = await load();
  return {
    watcher, services, load, folder,
    outbox: () => JSON.parse(readFileSync(join(folder, 'monitoring-state.json'), 'utf8')).preparationOutbox ?? [],
    stored: () => JSON.parse(readFileSync(join(folder, 'monitoring-state.json'), 'utf8')),
    cleanup(modules = [watcher]) { for (const m of modules) m.stopWatcher(); global.fetch = previousFetch; global.WebSocket = previousWs; process.env.PROPOS_DATA_DIR = previousDir; },
  };
}
const OCCUPIED = { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' };
const ofOffline = events => events.filter(event => event.type.startsWith('sensor_offline'));

describe('RF-28 워처 — 문제 이벤트·운영자 알림', () => {
  test('오래 꺼진 움직임 센서 → 문제 1건(상태 그대로) + HA 알림창·운영자 휴대폰 알림, 판정을 반복해도 다시 알리지 않는다', async () => {
    const offlineSince = Date.now() - 3 * 60 * MIN;
    const states = {
      'binary_sensor.entrance_motion': sensor('unavailable', offlineSince, { name: '현관 움직임' }),
      'binary_sensor.entrance_door': sensor('off', Date.now() - MIN, { dc: 'door', name: '현관문' }),
    };
    const f = await watcherFixture(states);
    try {
      f.watcher.setRoomState(OCCUPIED);
      f.watcher.setMonitoringConfig({ areaName: 'fixture-rf28', reservation: null, optimization: { operatorNotifyService: 'notify.mobile_app_operator' } });
      await until(() => ofOffline(f.outbox()).length === 1);
      const [event] = ofOffline(f.outbox());
      assert.equal(event.type, 'sensor_offline_detected');
      assert.equal(event.device_time, offlineSince + 30 * MIN + sensorEventOffsetMs('binary_sensor.entrance_motion'));
      assert.equal(event.is_soft, false);
      assert.equal(event.property_id, 'fixture-rf28');
      assert.equal(event.data.entityId, 'binary_sensor.entrance_motion');
      assert.equal(event.data.mainStatus, 'OCCUPIED');
      assert.deepEqual(f.watcher.getMonitoringState().roomState, OCCUPIED, '객실 상태는 바꾸지 않는다');
      await until(() => f.services.length === 2);
      assert.deepEqual(f.services.map(call => call.service).sort(), ['notify/mobile_app_operator', 'persistent_notification/create']);
      assert.match(f.services.find(call => call.service === 'notify/mobile_app_operator').body.message, /현관 움직임/);

      f.watcher.setMonitoringConfig({});
      f.watcher.setMonitoringConfig({});
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(ofOffline(f.outbox()).length, 1);
      assert.equal(f.services.length, 2, '같은 끊김을 다시 알리지 않는다');
    } finally { f.cleanup(); }
  });

  test('워처를 다시 켜도(상태 파일 유지) 같은 끊김을 다시 알리지 않고, 센서가 돌아오면 해소만 보낸다', async () => {
    const offlineSince = Date.now() - 3 * 60 * MIN;
    const states = { 'binary_sensor.entrance_motion': sensor('unavailable', offlineSince, { name: '현관 움직임' }) };
    const f = await watcherFixture(states);
    const modules = [f.watcher];
    try {
      f.watcher.setRoomState(OCCUPIED);
      f.watcher.setMonitoringConfig({ areaName: 'fixture-rf28', reservation: null });
      await until(() => ofOffline(f.outbox()).length === 1);
      await until(() => f.services.length === 1);
      assert.equal(f.services[0].service, 'persistent_notification/create', '휴대폰 알림 설정이 없으면 HA 알림창만');
      f.watcher.stopWatcher();

      const restarted = await f.load();
      modules.push(restarted);
      restarted.startWatcher();
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(ofOffline(f.outbox()).length, 1, '재시작 뒤에도 문제는 1건');
      assert.equal(f.services.filter(call => call.service === 'persistent_notification/create').length, 1);

      states['binary_sensor.entrance_motion'] = sensor('off', Date.now() - MIN, { name: '현관 움직임' });
      restarted.setMonitoringConfig({});
      await until(() => ofOffline(f.outbox()).length === 2);
      const resolved = ofOffline(f.outbox())[1];
      assert.equal(resolved.type, 'sensor_offline_resolved');
      assert.equal(resolved.data.entityId, 'binary_sensor.entrance_motion');
      assert.deepEqual(f.stored().sensorHealth, {});
      assert.equal(f.services.filter(call => call.service.startsWith('notify/')).length, 0, '복구는 휴대폰으로 알리지 않는다');
      await until(() => f.services.some(call => call.service === 'persistent_notification/dismiss'));
      assert.equal(f.services.find(call => call.service === 'persistent_notification/dismiss').body.notification_id,
        f.services.find(call => call.service === 'persistent_notification/create').body.notification_id, '복구되면 HA 알림창의 끊김 알림을 지운다');
    } finally { f.cleanup(modules); }
  });
});

// ── HA 재연결 뒤 놓친 기록 다시 처리 ───────────────────────────────────────────
async function waitFor(predicate, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.ok(predicate(), `Expected watcher condition within ${ms}ms`);
}

async function replayFixture({ current, history }) {
  const previousFetch = global.fetch, previousWs = global.WebSocket, previousDir = process.env.PROPOS_DATA_DIR;
  const folder = mkdtempSync(join(TEST_DATA_DIR, 'rf28-replay-'));
  process.env.PROPOS_DATA_DIR = folder;
  writeFileSync(join(folder, 'monitoring-config.json'), JSON.stringify({ areaName: 'fixture-rf28-replay', reservation: null,
    optimization: { operatorNotifyService: 'notify.mobile_app_operator' } }));
  writeFileSync(join(folder, 'monitoring-state.json'), JSON.stringify({ roomState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' } }));
  const sockets = [], services = [];
  let states = current.before;
  global.WebSocket = class {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.listeners = {}; sockets.push(this); }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    send() {}
    close() { this.readyState = 3; }
    emit(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn(event); }
  };
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/api/events/write')) return { ok: false, status: 503, json: async () => ({}) };
    assert.ok(href.startsWith('http://ha.test/'), 'Tests must never call external services');
    if (href.endsWith('/api/template')) return { ok: true, text: async () => JSON.stringify(Object.keys(states)) };
    if (href.includes('/api/services/')) { services.push({ service: href.split('/api/services/')[1], body: JSON.parse(options.body ?? '{}') }); return { ok: true, json: async () => [] }; }
    if (href.includes('/api/history/period/')) {
      const entity = decodeURIComponent(href.split('filter_entity_id=')[1]);
      return { ok: true, json: async () => [(history[entity] ?? []).map(state => ({ entity_id: entity, ...state }))] };
    }
    const entity = href.split('/api/states/')[1];
    return { ok: true, json: async () => ({ entity_id: entity, ...states[entity] }) };
  };
  const watcher = await import(`../../server/occupancyWatcher.js?rf28-replay=${++sequence}`);
  watcher.startWatcher();
  await waitFor(() => sockets.length === 1);
  await new Promise(resolve => setTimeout(resolve, 30));
  states = current.after;
  sockets[0].emit('close', { code: 1006 }); // 끊김 → 1초 뒤 재연결 → 놓친 기록 다시 처리
  return {
    watcher, services,
    outbox: () => JSON.parse(readFileSync(join(folder, 'monitoring-state.json'), 'utf8')).preparationOutbox ?? [],
    cleanup() { watcher.stopWatcher(); global.fetch = previousFetch; global.WebSocket = previousWs; process.env.PROPOS_DATA_DIR = previousDir; },
  };
}

describe('RF-28 워처 — 재시작 뒤 알림 이어 보내기·정리', () => {
  test('보고했지만 알리기 전에 꺼진 워처는 다시 켜질 때 한 번 알리고, 그 뒤 재시작에는 다시 알리지 않는다', async () => {
    const offlineSince = Date.now() - 3 * 60 * MIN;
    const states = { 'binary_sensor.entrance_motion': sensor('unavailable', offlineSince, { name: '현관 움직임' }) };
    const f = await watcherFixture(states);
    const modules = [f.watcher];
    try {
      f.watcher.stopWatcher();
      writeFileSync(join(f.folder, 'monitoring-config.json'), JSON.stringify({ areaName: 'fixture-rf28', reservation: null,
        optimization: { operatorNotifyService: 'notify.mobile_app_operator' } }));
      writeFileSync(join(f.folder, 'monitoring-state.json'), JSON.stringify({ roomState: OCCUPIED, sensorHealth: {
        'binary_sensor.entrance_motion': { offlineSince, reportedAt: offlineSince + 30 * MIN, alertedAt: null, role: 'motion', name: '현관 움직임' },
        'binary_sensor.removed_motion': { offlineSince, reportedAt: offlineSince + 30 * MIN, alertedAt: offlineSince + 31 * MIN, role: 'motion', name: '옛 센서' },
      } }));
      const first = await f.load();
      modules.push(first);
      first.startWatcher();
      await until(() => f.services.some(call => call.service === 'notify/mobile_app_operator'));
      await until(() => f.services.some(call => call.service === 'persistent_notification/dismiss'));
      assert.equal(f.services.find(call => call.service === 'persistent_notification/dismiss').body.notification_id,
        'propos_sensor_offline_binary_sensor.removed_motion', '구역에서 빠진 센서의 알림창 알림을 지운다');
      assert.equal(ofOffline(f.outbox()).length, 0, '이미 보고한 끊김은 이벤트를 다시 보내지 않는다');
      assert.deepEqual(Object.keys(f.stored().sensorHealth), ['binary_sensor.entrance_motion']);
      assert.ok(Number.isFinite(f.stored().sensorHealth['binary_sensor.entrance_motion'].alertedAt));
      first.stopWatcher();

      const second = await f.load();
      modules.push(second);
      second.startWatcher();
      await new Promise(resolve => setTimeout(resolve, 60));
      assert.equal(f.services.filter(call => call.service === 'notify/mobile_app_operator').length, 1);
    } finally { f.cleanup(modules); }
  });
});

describe('RF-28 워처 — 다시 처리 중의 알림', () => {
  const motion = (state, at) => sensor(state, at, { name: '현관 움직임' });
  const door = (state, at) => sensor(state, at, { dc: 'door', name: '현관문' });

  test('끊긴 동안 꺼졌다 이미 돌아온 센서는 기록만 남기고 휴대폰을 울리지 않는다', async () => {
    const now = Date.now();
    const f = await replayFixture({
      current: {
        before: { 'binary_sensor.motion': motion('off', now - 2 * 60 * MIN), 'binary_sensor.door': door('off', now - 2 * 60 * MIN) },
        after: { 'binary_sensor.motion': motion('off', now - 10 * MIN), 'binary_sensor.door': door('off', now - 20 * MIN) },
      },
      history: {
        'binary_sensor.motion': [motion('unavailable', now - 60 * MIN), motion('off', now - 10 * MIN)],
        'binary_sensor.door': [door('on', now - 21 * MIN), door('off', now - 20 * MIN)],
      },
    });
    try {
      await waitFor(() => ofOffline(f.outbox()).length === 2);
      assert.deepEqual(ofOffline(f.outbox()).map(event => event.type), ['sensor_offline_detected', 'sensor_offline_resolved']);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(f.services.filter(call => call.service === 'notify/mobile_app_operator').length, 0);
      assert.equal(f.services.filter(call => call.service === 'persistent_notification/create').length, 0);
    } finally { f.cleanup(); }
  });

  test('다시 처리가 끝난 뒤에도 꺼져 있으면 그때 한 번 알린다', async () => {
    const now = Date.now();
    const f = await replayFixture({
      current: {
        before: { 'binary_sensor.motion': motion('off', now - 2 * 60 * MIN), 'binary_sensor.door': door('off', now - 2 * 60 * MIN) },
        after: { 'binary_sensor.motion': motion('unavailable', now - 60 * MIN), 'binary_sensor.door': door('off', now - 20 * MIN) },
      },
      history: {
        'binary_sensor.motion': [motion('unavailable', now - 60 * MIN)],
        'binary_sensor.door': [door('on', now - 21 * MIN), door('off', now - 20 * MIN)],
      },
    });
    try {
      await waitFor(() => f.services.some(call => call.service === 'notify/mobile_app_operator'));
      assert.deepEqual(ofOffline(f.outbox()).map(event => event.type), ['sensor_offline_detected']);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(f.services.filter(call => call.service === 'notify/mobile_app_operator').length, 1);
    } finally { f.cleanup(); }
  });
});
