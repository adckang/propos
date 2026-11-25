/**
 * 감지 센서 사전 점검과 운영자에게 넘기기 (DEC-11·12·16)
 *  - 센서가 꺼진 것을 시간 간격으로 반복해 알리지 않는다. 퇴실·입실 하루 전·2시간 전에 미리 점검해 꺼져 있으면 운영자에게 알린다.
 *  - 그 시각에도 꺼져 있으면 확인 불가 문제(s141). 기기 제어는 하지 않는다.
 *  - Pi가 운영자에게 넘기는 것(사전 점검·퇴실 지연·입실 미감지·확인 불가)은 Slack + HA 앱 둘 다.
 * 이 파일은 실제 워처를 돌린다 — HA·서버 호출은 모두 가로챈다.
 */
import { TEST_DATA_DIR } from '../helpers/isolateDataDir.js';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { detectionSensors, duePrechecks, handoffAlertMessage, latestPresenceEvidence, offDetectionSensors, offEntryDetectionSensors,
  precheckAlertMessage, precheckEventTime, presenceActivitySources, upcomingTimes } from '../../src/domain/sensorHealthDomain.js';
import { request, event as apiEvent } from '../helpers/eventApiFixture.js';
import { countPeriodEvents } from '../../src/domain/reportingDomain.js';
import { buildIssueItems } from '../../src/domain/monthlyCalendarDomain.js';
import { OPERATOR_ALERT_EVENT_TYPES, OPERATOR_ALERT_LABELS } from '../../src/config/eventTypes.js';

const MIN = 60_000, HOUR = 60 * MIN;
const sensor = (state, { dc = 'motion', name = '현관 움직임' } = {}) => ({ state, attributes: { device_class: dc, friendly_name: name } });

describe('꺼진 감지 센서', () => {
  test('감지 센서는 binary_sensor 중 문·움직임뿐이고, 꺼짐은 unavailable — unknown은 고장이 아니다', () => {
    const map = {
      'binary_sensor.motion': sensor('unavailable'), 'binary_sensor.door': sensor('unknown', { dc: 'door', name: '현관문' }),
      'binary_sensor.smoke': sensor('unavailable', { dc: 'smoke' }), 'sensor.motion': sensor('unavailable'),
    };
    assert.deepEqual(detectionSensors(map).map(s => s.entityId), ['binary_sensor.door', 'binary_sensor.motion']);
    assert.deepEqual(offDetectionSensors(map), [{ entityId: 'binary_sensor.motion', role: 'motion', roleLabel: '움직임 센서', name: '현관 움직임' }]);
  });
  test('구역 상태를 아직 못 읽었으면 판단하지 않고, 읽었는데 문·움직임 센서가 없으면 확인할 수 없다', () => {
    assert.deepEqual(offDetectionSensors({}), []);
    assert.deepEqual(offDetectionSensors({ 'light.x': { state: 'on', attributes: {} } }).map(s => s.name), ['문·움직임 센서 없음']);
  });

  test('입실은 정상 문 센서와 스위치·조명·플러그·물리 버튼 중 하나가 있으면 움직임 센서를 대신할 수 있다', () => {
    const base = {
      'binary_sensor.motion': sensor('unavailable'),
      'binary_sensor.door': sensor('off', { dc: 'door', name: '현관문' }),
    };
    assert.deepEqual(offEntryDetectionSensors(base).map(s => s.entityId), ['binary_sensor.motion']);
    for (const [entityId, state] of [
      ['switch.wall', { state: 'off', attributes: { friendly_name: '욕실 스위치' } }],
      ['light.living', { state: 'off', attributes: { friendly_name: '거실 조명' } }],
      ['event.remote', { state: 'press', attributes: { device_class: 'button', friendly_name: '무선 버튼' } }],
    ]) {
      assert.deepEqual(offEntryDetectionSensors({ ...base, [entityId]: state }), [], entityId);
    }
  });

  test('사람 흔적은 사람 조작으로 생긴 가장 최근 스위치·조명·버튼 변경만 고른다', () => {
    const now = Date.parse('2026-11-23T06:00:00.000Z');
    const map = {
      'switch.wall': { state: 'off', last_changed: '2026-11-23T05:58:00.000Z', attributes: { friendly_name: '욕실 스위치' }, context: { user_id: null, parent_id: null } },
      'light.living': { state: 'on', last_changed: '2026-11-23T05:59:00.000Z', attributes: { friendly_name: '거실 조명' }, context: { user_id: 'operator', parent_id: null } },
      'event.remote': { state: 'press', last_changed: '2026-11-23T05:57:00.000Z', attributes: { device_class: 'button', friendly_name: '무선 버튼' }, context: { user_id: null, parent_id: null } },
      'sensor.energy': { state: '3.2', last_changed: '2026-11-23T05:59:30.000Z', attributes: { friendly_name: '전력량' } },
    };
    assert.deepEqual(presenceActivitySources(map).map(s => s.entityId), ['event.remote', 'light.living', 'switch.wall']);
    assert.deepEqual(latestPresenceEvidence(map, now), { at: Date.parse('2026-11-23T05:58:00.000Z'), name: '욕실 스위치', entityId: 'switch.wall' });
  });
});

describe('사전 점검 시각 — 하루 전·2시간 전, 시작 시각과 무관하게 같은 규칙', () => {
  const checkout = Date.parse('2026-11-24T02:00:00.000Z'); // 11:00 KST
  const checkin = Date.parse('2026-11-24T00:00:00.000Z');  // 09:00 KST
  const times = upcomingTimes([{ checkIn: new Date(checkin), checkOut: new Date(checkout) }, null], checkin - 30 * HOUR);

  test('지금 예약과 미뤄 둔 다음 예약의 앞으로의 퇴실·입실', () => {
    assert.deepEqual(times.map(t => [t.phase, t.at]), [['checkin', checkin], ['checkout', checkout]]);
    assert.deepEqual(upcomingTimes([{ checkIn: new Date(checkin), checkOut: new Date(checkout) }], checkin + 1).map(t => t.phase), ['checkout'], '지난 시각은 없다');
  });

  test('하루 전 한 번, 2시간 전 한 번 — 그 사이·같은 단계엔 다시 하지 않는다', () => {
    let done = {};
    const at = now => { const r = duePrechecks({ times, done, now }); done = r.done; return r.due.map(d => `${d.phase}:${d.offsetLabel}`); };
    assert.deepEqual(at(checkin - 25 * HOUR), []);
    assert.deepEqual(at(checkin - 24 * HOUR), ['checkin:하루 전']);
    assert.deepEqual(at(checkin - 23 * HOUR), []);
    assert.deepEqual(at(checkout - 24 * HOUR), ['checkout:하루 전']);
    assert.deepEqual(at(checkin - 2 * HOUR), ['checkin:2시간 전']);
    assert.deepEqual(at(checkin - HOUR), []);
    assert.deepEqual(at(checkout - 2 * HOUR + 1), ['checkout:2시간 전']);
    assert.deepEqual(at(checkout - MIN), []);
  });

  test('워처가 꺼져 있어 하루 전 점검을 놓쳤으면 늦은 쪽(2시간 전) 한 번만', () => {
    const r = duePrechecks({ times, done: {}, now: checkin - HOUR });
    assert.deepEqual(r.due.map(d => `${d.phase}:${d.offsetLabel}`), ['checkin:2시간 전', 'checkout:하루 전']);
    assert.deepEqual(duePrechecks({ times, done: r.done, now: checkin - 30 * MIN }).due, []);
  });

  test('기록의 발생 시각 = 그 점검을 해야 했던 시각(+점검마다 고정 0~999ms) — 같은 주기의 두 점검이 DB 중복 방지에 걸리지 않는다', () => {
    const r = duePrechecks({ times, done: {}, now: checkin - HOUR });
    const [a, b] = r.due.map(precheckEventTime);
    assert.notEqual(a, b);
    assert.ok(a >= checkin - 2 * HOUR && a < checkin - 2 * HOUR + 1000);
    assert.ok(b >= checkout - 24 * HOUR && b < checkout - 24 * HOUR + 1000);
    assert.equal(precheckEventTime(r.due[0]), a, '다시 계산해도 같은 시각');
    // 입실 2시간 전 점검과 22시간 뒤 퇴실의 하루 전 점검은 같은 시각이다 — 고정 오프셋이 둘을 나눈다
    const same = upcomingTimes([{ checkIn: new Date(checkin), checkOut: new Date(checkin + 22 * HOUR) }], checkin - 3 * HOUR);
    const both = duePrechecks({ times: same, done: {}, now: checkin - 2 * HOUR }).due;
    assert.equal(both.length, 2);
    assert.equal(both[0].checkAt, both[1].checkAt);
    assert.notEqual(precheckEventTime(both[0]), precheckEventTime(both[1]));
  });

  test('한 점검 기록은 3일 뒤 버린다 — 저장 파일이 끝없이 커지지 않게', () => {
    const r = duePrechecks({ times: [], done: { old: checkin - 4 * 24 * HOUR, keep: checkin, broken: 'x' }, now: checkin });
    assert.deepEqual(Object.keys(r.done), ['keep']);
  });

  test('알림 문구는 한국 시각·단계·꺼진 센서·해 달라는 일을 담는다', () => {
    const { title, message } = precheckAlertMessage('파주201', { phase: 'checkout', at: checkout, offsetLabel: '2시간 전' },
      [{ entityId: 'binary_sensor.motion', roleLabel: '움직임 센서', name: '현관 움직임' }]);
    assert.equal(title, '[PROPOS] 파주201 감지 센서 점검');
    assert.equal(message, '11/24 11:00 퇴실 2시간 전 점검 — 꺼져 있는 센서: 움직임 센서(현관 움직임). 그대로면 퇴실을 확인할 수 없어요. 그 전에 확인해 주세요.');
  });
});

describe('운영자에게 넘기는 문구 (DEC-11)', () => {
  const checkOut = '2026-11-24T02:00:00.000Z', checkIn = '2026-11-24T06:00:00.000Z';
  test('퇴실 지연 — 청소 모드를 켜지 않았다는 것과 직접 켜 달라는 것', () => {
    assert.match(handoffAlertMessage('파주201', { type: 'late_checkout_detected', data: { checkOut } }).message, /^11\/24 11:00 퇴실이 확인되지 않아 청소 모드.*켜지 않았어요\. 확인 후 직접 켜 주세요\.$/);
  });
  test('입실 미감지 — 실제 기다린 시각까지와 기기 상태를 직접 확인해 달라는 것', () => {
    assert.equal(handoffAlertMessage('파주201', { type: 'checkin_not_detected', data: { checkIn, deadline: '2026-11-24T15:00:00.000Z' } }).message,
      '11/24 15:00 입실이 11/25 00:00까지 확인되지 않았어요. 기기 상태(에어컨·조명)를 직접 확인해 주세요.');
    assert.match(handoffAlertMessage('파주201', { type: 'checkin_not_detected', data: { checkIn: '2026-11-24T14:30:00.000Z', deadline: '2026-11-24T15:30:00.000Z' } }).message,
      /^11\/24 23:30 입실이 11\/25 00:30까지/, '밤늦은 입실은 입실 + 1시간까지');
  });
  test('확인 불가 — 입실이 확인되지 않은 체류의 퇴실', () => {
    assert.equal(handoffAlertMessage('파주201', { type: 'detection_unconfirmable', data: { phase: 'checkout', cause: 'not_entered', checkOut } }).message,
      '11/24 11:00 퇴실을 확인할 수 없어요(입실이 확인되지 않은 체류였어요). 청소 모드를 켜지 않았어요. 직접 확인하고 처리해 주세요.');
  });
  test('확인 불가 — 단계·이유·하지 않은 기기 제어·직접 처리', () => {
    const off = handoffAlertMessage('파주201', { type: 'detection_unconfirmable', data: { phase: 'checkout', cause: 'sensor_off', checkOut,
      sensors: [{ entityId: 'binary_sensor.motion', roleLabel: '움직임 센서', name: '현관 움직임' }] } });
    assert.deepEqual(off, { title: '[PROPOS] 파주201 퇴실 확인 불가',
      message: '11/24 11:00 퇴실을 확인할 수 없어요(꺼져 있는 센서: 움직임 센서(현관 움직임)). 청소 모드를 켜지 않았어요. 직접 확인하고 처리해 주세요.' });
    const down = handoffAlertMessage('파주201', { type: 'detection_unconfirmable', data: { phase: 'checkin', cause: 'not_observed', checkIn } });
    assert.equal(down.message, '11/24 15:00 입실을 확인할 수 없어요(그 시각에 감시가 멈춰 있었어요). 체류 기기 제어를 하지 않았어요. 직접 확인하고 처리해 주세요.');
  });
  test('퇴실 확인 불가 — 마지막 사람 흔적 시각과 기기 이름을 함께 준다', () => {
    const alert = handoffAlertMessage('파주201', { type: 'detection_unconfirmable', data: { phase: 'checkout', cause: 'sensor_off', checkOut,
      sensors: [{ entityId: 'binary_sensor.motion', roleLabel: '움직임 센서', name: '현관 움직임' }],
      lastPresence: { at: '2026-11-24T01:59:00.000Z', name: '거실 욕실 스위치', entityId: 'switch.bathroom' } } });
    assert.match(alert.message, /마지막 사람 흔적: 11\/24 10:59 거실 욕실 스위치\.$/);
  });
  test('넘기지 않는 종류는 문구가 없다', () => {
    assert.equal(handoffAlertMessage('파주201', { type: 'scheduled_checkout_reached', data: {} }), null);
  });
});

describe('Pi 입구 — 넘기는 것만 처음 저장될 때 Slack (DEC-16)', () => {
  test('넘기는 종류는 사전 점검·퇴실 지연·입실 미감지·청소 미감지·확인 불가 — 옛 30분 꺼짐은 아니다', () => {
    assert.deepEqual([...OPERATOR_ALERT_EVENT_TYPES].sort(),
      ['checkin_not_detected', 'cleaning_not_detected', 'detection_unconfirmable', 'late_checkout_detected', 'sensor_precheck_failed']);
  });
  for (const type of ['late_checkout_detected', 'checkin_not_detected', 'detection_unconfirmable', 'sensor_precheck_failed']) {
    test(`${type}: 처음 저장될 때 한 번, 재전송(DB 중복)에는 다시 보내지 않는다`, async () => {
      const sent = await request('write', { ...apiEvent, type, is_soft: type === 'sensor_precheck_failed' });
      assert.equal(sent.res.code, 200);
      assert.deepEqual(sent.notices.map(n => [n[1], n[2]]), [[apiEvent.property_id, type]]);
      assert.deepEqual((await request('write', { ...apiEvent, type }, { duplicate: true })).notices, []);
    });
  }
  test('다른 종류(전환·옛 센서 끊김)는 보내지 않는다', async () => {
    for (const type of ['scheduled_checkout_reached', 'scheduled_checkin_reached', 'sensor_offline_detected']) {
      assert.deepEqual((await request('write', { ...apiEvent, type })).notices, [], type);
    }
  });
  test('Slack이 실패해도 저장 응답은 성공 — Pi가 같은 기록을 다시 보내지 않게', async () => {
    const result = await request('write', { ...apiEvent, type: 'checkin_not_detected' }, { notifyFails: true });
    assert.equal(result.res.code, 200);
    assert.equal(result.res.body.inserted, true);
  });
  test('Slack 한 줄은 숙소 · 무엇이 안 됐고 무엇을 해 달라는지 · 링크 (기록 내용은 넣지 않는다)', async () => {
    const previousFetch = global.fetch, previousHook = process.env.PROPOS_SLACK_WEBHOOK;
    const bodies = [];
    process.env.PROPOS_SLACK_WEBHOOK = 'https://hooks.slack.test/x';
    global.fetch = async (url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true }; };
    try {
      const { notifyEvent } = await import(`../../server/slackNotifier.js?label=${Date.now()}`);
      await notifyEvent('11111111-1111-4111-8111-111111111111', '파주201', 'late_checkout_detected');
      await notifyEvent('11111111-1111-4111-8111-111111111112', '파주201', 'complaint_detected');
      assert.match(bodies[0].text, new RegExp(`^\\[파주201\\] ${OPERATOR_ALERT_LABELS.late_checkout_detected} → .*/events/11111111-1111-4111-8111-111111111111$`));
      assert.match(bodies[1].text, /^\[파주201\] complaint_detected → /);
    } finally { global.fetch = previousFetch; if (previousHook === undefined) delete process.env.PROPOS_SLACK_WEBHOOK; else process.env.PROPOS_SLACK_WEBHOOK = previousHook; }
  });
});

describe('레포트·달력', () => {
  test('입실 시각 전환은 입실 1건, 입실 미감지·확인 불가는 문제·이상 1건씩, 사전 점검은 건수에 더하지 않는다', () => {
    const stats = countPeriodEvents([
      { type: 'scheduled_checkin_reached' }, { type: 'checkin_not_detected' }, { type: 'detection_unconfirmable' }, { type: 'sensor_precheck_failed' },
    ]);
    assert.deepEqual([stats.checkIns, stats.checkinNotDetected, stats.detectionUnconfirmable, stats.anomalies], [1, 1, 1, 2]);
  });
  test('달력 문제 목록: 입실 미감지는 체류 단계, 확인 불가는 단계별 이름 — 사전 점검은 문제가 아니다', () => {
    const items = buildIssueItems([
      { property_id: 'P', type: 'checkin_not_detected', device_time: '2026-11-24T06:00:00.000Z', data: {} },
      { property_id: 'P', type: 'detection_unconfirmable', device_time: '2026-11-24T02:00:00.000Z', data: { phase: 'checkout' } },
      { property_id: 'P', type: 'detection_unconfirmable', device_time: '2026-11-24T06:00:00.001Z', data: { phase: 'checkin' } },
      { property_id: 'P', type: 'sensor_precheck_failed', device_time: '2026-11-24T01:00:00.000Z', data: {} },
    ]);
    assert.deepEqual(items.map(item => [item.label, item.category]).sort(), [
      ['입실 미감지', 'OCCUPIED'], ['입실 확인 불가', 'OCCUPIED'], ['퇴실 확인 불가', 'CLEANING'],
    ]);
  });
  test('옛 기록(감지 센서 30분 끊김)은 그대로 보이고 센다', () => {
    assert.equal(countPeriodEvents([{ type: 'sensor_offline_detected' }]).anomalies, 1);
    assert.equal(buildIssueItems([{ property_id: 'P', type: 'sensor_offline_detected', device_time: '2026-11-21T01:30:00.000Z', data: { mainStatus: 'OCCUPIED' } }])[0].label, '감지 센서 연결 끊김');
  });
});

// ── 워처 전체 실행 — HA·서버 호출은 모두 가로챈다 ──────────────────────────────
process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_WS_URL = 'ws://ha.test/api/websocket';
process.env.PROPOS_HA_TOKEN = 'fixture-token';
process.env.PROPOS_PI_SECRET = 'fixture-key';
process.env.PROPOS_EVENT_API_URL = 'https://events.fixture.invalid/api/events/write';

let sequence = 0;
async function until(predicate) {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(predicate(), 'Expected watcher condition within 500ms');
}
async function watcherFixture(haStates, folder = mkdtempSync(join(TEST_DATA_DIR, 'precheck-')), { writesOk = false } = {}) {
  const previousFetch = global.fetch, previousWs = global.WebSocket, previousDir = process.env.PROPOS_DATA_DIR;
  process.env.PROPOS_DATA_DIR = folder;
  const services = [];
  global.WebSocket = class { static OPEN = 1; readyState = 1; addEventListener() {} close() {} };
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/api/events/write')) {
      return writesOk ? { ok: true, status: 200, json: async () => ({ inserted: true, id: 'fixture' }) } : { ok: false, status: 503, json: async () => ({}) };
    }
    assert.ok(href.startsWith('http://ha.test/'), 'Tests must never call external services');
    if (href.endsWith('/api/template')) return { ok: true, text: async () => JSON.stringify(Object.keys(haStates)) };
    if (href.includes('/api/services/')) {
      services.push({ service: href.split('/api/services/')[1], body: JSON.parse(options.body ?? '{}') });
      return { ok: true, json: async () => ([]) };
    }
    const entity = href.split('/api/states/')[1];
    return { ok: true, json: async () => ({ entity_id: entity, ...haStates[entity] }) };
  };
  const watcher = await import(`../../server/occupancyWatcher.js?precheck=${++sequence}`);
  return {
    watcher, services, folder,
    outbox: () => JSON.parse(readFileSync(join(folder, 'monitoring-state.json'), 'utf8')).preparationOutbox ?? [],
    cleanup() { watcher.stopWatcher(); global.fetch = previousFetch; global.WebSocket = previousWs; process.env.PROPOS_DATA_DIR = previousDir; },
  };
}
const OCCUPIED = { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' };
const VACANT = { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' };
const stay = (uid, checkInMs, checkOutMs) => ({ uid, checkIn: new Date(checkInMs).toISOString(), checkOut: new Date(checkOutMs).toISOString() });
const ofType = (events, type) => events.filter(event => event.type === type);
const DEVICES = { LIGHT_LIVING: 'light.fixture_living', LIGHT_ENTRANCE: 'light.fixture_entrance', FAN_VENTILATION: 'fan.fixture_vent' };
const deviceCalls = services => services.filter(call => /^(light|fan|switch|climate)\//.test(call.service));

describe('워처 — 사전 점검', () => {
  test('퇴실 2시간 안에 움직임 센서가 꺼져 있으면 미리 알림 1건(Slack용 기록 + HA 앱) — 상태는 그대로, 반복·재시작해도 다시 하지 않는다', async () => {
    const states = { 'binary_sensor.entrance_motion': sensor('unavailable'), 'binary_sensor.entrance_door': sensor('off', { dc: 'door', name: '현관문' }) };
    const f = await watcherFixture(states);
    try {
      const checkOut = Date.now() + HOUR;
      f.watcher.setRoomState(OCCUPIED);
      f.watcher.setMonitoringConfig({ areaName: 'fixture-precheck', reservation: stay('stay-1', Date.now() - 20 * HOUR, checkOut),
        optimization: { operatorNotifyService: 'notify.mobile_app_operator' } });
      await until(() => ofType(f.outbox(), 'sensor_precheck_failed').length === 1);
      const [event] = ofType(f.outbox(), 'sensor_precheck_failed');
      assert.equal(event.is_soft, true, '문제가 아니라 미리 알림');
      assert.deepEqual([event.property_id, event.data.phase, event.data.offset, event.data.at], ['fixture-precheck', 'checkout', 'h2', new Date(checkOut).toISOString()]);
      assert.ok(event.device_time >= checkOut - 2 * HOUR && event.device_time < checkOut - 2 * HOUR + 1000, '발생 시각 = 2시간 전 점검 시각');
      assert.deepEqual(event.data.sensors.map(s => s.entityId), ['binary_sensor.entrance_motion']);
      await until(() => f.services.length === 2);
      assert.deepEqual(f.services.map(call => call.service).sort(), ['notify/mobile_app_operator', 'persistent_notification/create']);
      assert.match(f.services[0].body.message, /퇴실 2시간 전 점검 — 꺼져 있는 센서: 움직임 센서\(현관 움직임\)/);
      assert.deepEqual(f.watcher.getMonitoringState().roomState, OCCUPIED);
      f.watcher.setMonitoringConfig({});
      f.watcher.setMonitoringConfig({});
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(ofType(f.outbox(), 'sensor_precheck_failed').length, 1);
      assert.equal(f.services.length, 2);
    } finally { f.cleanup(); }
    const again = await watcherFixture(states, f.folder);
    try {
      again.watcher.startWatcher();
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(ofType(again.outbox(), 'sensor_precheck_failed').length, 1, '재시작해도 같은 점검을 다시 하지 않는다');
      assert.equal(again.services.filter(call => call.service === 'notify/mobile_app_operator').length, 0);
    } finally { again.cleanup(); }
  });

  test('센서가 모두 켜져 있으면 아무것도 보내지 않는다', async () => {
    const f = await watcherFixture({ 'binary_sensor.entrance_motion': sensor('off') });
    try {
      f.watcher.setRoomState(OCCUPIED);
      f.watcher.setMonitoringConfig({ areaName: 'fixture-precheck', reservation: stay('stay-1', Date.now() - 20 * HOUR, Date.now() + HOUR),
        optimization: { operatorNotifyService: 'notify.mobile_app_operator' } });
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(ofType(f.outbox(), 'sensor_precheck_failed').length, 0);
      assert.deepEqual(f.services.filter(call => call.service.startsWith('notify/')), []);
    } finally { f.cleanup(); }
  });
});

describe('워처 — 확인되지 않으면 기기 제어를 하지 않고 넘긴다 (DEC-11)', () => {
  test('퇴실 시각에 센서가 꺼져 있으면: 청소 대기로 전환, 청소 모드 기기 제어 없음, 확인 불가 문제 + 운영자 알림', async () => {
    const f = await watcherFixture({ 'binary_sensor.entrance_motion': sensor('unavailable') });
    try {
      const checkOut = Date.now() - MIN;
      f.watcher.setRoomState(OCCUPIED);
      f.watcher.setMonitoringConfig({ areaName: 'fixture-handoff', devices: DEVICES, reservation: stay('stay-1', checkOut - 20 * HOUR, checkOut),
        optimization: { operatorNotifyService: 'notify.mobile_app_operator' } });
      await until(() => ofType(f.outbox(), 'detection_unconfirmable').length === 1);
      assert.equal(f.watcher.getMonitoringState().roomState.mainStatus, 'CLEANING', '상태는 스케줄대로');
      const [problem] = ofType(f.outbox(), 'detection_unconfirmable');
      assert.deepEqual([problem.device_time, problem.is_soft, problem.data.phase, problem.data.cause], [checkOut, false, 'checkout', 'sensor_off']);
      await until(() => f.services.some(call => call.service === 'notify/mobile_app_operator' && /퇴실 확인 불가/.test(call.body.title)));
      const notice = f.services.find(call => call.service === 'persistent_notification/create' && /퇴실 확인 불가/.test(call.body.title));
      assert.equal(notice.body.notification_id, `propos_detection_unconfirmable_checkout_${checkOut}`, '알림창 항목은 단계별로 — 청소 확인 불가가 퇴실 것을 덮어쓰지 않게');
      assert.deepEqual(deviceCalls(f.services), [], '청소 모드(조명·환기)를 켜지 않는다');
    } finally { f.cleanup(); }
  });

  test('입실 시각에 들어온 것이 보이지 않으면: 체류로 전환, 체류 기기 제어 없음(확인될 때까지)', async () => {
    const f = await watcherFixture({ 'binary_sensor.entrance_motion': sensor('off'), 'binary_sensor.entrance_door': sensor('off', { dc: 'door', name: '현관문' }) });
    try {
      const checkIn = Date.now() - MIN;
      f.watcher.setRoomState(VACANT);
      // 입실 준비는 끈다(SIMULATED) — 이 시험은 체류 기기 제어와 판정 상태 저장만 본다
      f.watcher.setMonitoringConfig({ areaName: 'fixture-handoff', dataOrigin: 'SIMULATED', devices: DEVICES, reservation: stay('stay-1', checkIn, checkIn + 20 * HOUR) });
      await until(() => f.watcher.getMonitoringState().roomState.mainStatus === 'OCCUPIED');
      const transition = ofType(f.outbox(), 'scheduled_checkin_reached');
      assert.equal(transition.length, 1);
      assert.deepEqual([transition[0].device_time, transition[0].data.entryConfirmed], [checkIn, false]);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.deepEqual(deviceCalls(f.services), [], '손님이 오기 전엔 조명·TV를 켜지 않는다');
      assert.equal(JSON.parse(readFileSync(join(f.folder, 'monitoring-state.json'), 'utf8')).monitor.stayEntryConfirmed, false, '재시작해도 이어지게 저장');
    } finally { f.cleanup(); }
  });

  test('손님을 기다리는 동안엔 일이 없어도 2분마다 "마지막으로 본 시각"을 저장한다 — 재시작 뒤 끊긴 시간을 바로 알게', async () => {
    const realNow = Date.now;
    const f = await watcherFixture({ 'binary_sensor.entrance_motion': sensor('off'), 'binary_sensor.entrance_door': sensor('off', { dc: 'door', name: '현관문' }) },
      undefined, { writesOk: true });
    const saved = () => JSON.parse(readFileSync(join(f.folder, 'monitoring-state.json'), 'utf8'));
    try {
      const checkIn = Date.now() - MIN;
      f.watcher.setRoomState(VACANT);
      f.watcher.setMonitoringConfig({ areaName: 'fixture-wait', dataOrigin: 'SIMULATED', reservation: stay('stay-1', checkIn, checkIn + 4 * HOUR) });
      await until(() => f.watcher.getMonitoringState().roomState.mainStatus === 'OCCUPIED' && saved().preparationOutbox.length === 0);
      const first = saved().monitor.observedAt;
      for (const minutes of [1, 3]) {
        Date.now = () => realNow() + minutes * MIN;
        f.watcher.setMonitoringConfig({});
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      assert.ok(saved().monitor.observedAt >= first + 3 * MIN - 1000, '3분 뒤의 판정 시각이 저장됐다');
    } finally { Date.now = realNow; f.cleanup(); }
  });

  test('체류로 바뀐 뒤 손님이 들어온 것이 확인되면 그때 체류 기기 제어를 한다 (감지되면 자동)', async () => {
    const previousNow = Date.now;
    const base = Date.now(); let time = base, doorOpen = false, motion = false;
    const states = () => ({
      'binary_sensor.entrance_door': sensor(doorOpen ? 'on' : 'off', { dc: 'door', name: '현관문' }),
      'binary_sensor.entrance_motion': sensor(motion ? 'on' : 'off'),
    });
    const f = await watcherFixture(new Proxy({}, { get: (_, key) => states()[key], ownKeys: () => Object.keys(states()),
      getOwnPropertyDescriptor: (_, key) => ({ enumerable: true, configurable: true, value: states()[key] }) }));
    Date.now = () => time;
    try {
      const cfg = { areaName: 'fixture-handoff', devices: DEVICES, reservation: stay('stay-1', base - MIN, base + 20 * HOUR) };
      f.watcher.setRoomState(VACANT);
      f.watcher.setMonitoringConfig(cfg);
      await until(() => f.watcher.getMonitoringState().roomState.mainStatus === 'OCCUPIED');
      assert.deepEqual(deviceCalls(f.services), []);
      for (let minute = 1; minute <= 6; minute++) {
        time = base + minute * MIN;
        doorOpen = minute === 1; motion = minute >= 3;
        f.watcher.setMonitoringConfig(cfg);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await until(() => f.watcher.getMonitoringState().eventLog.some(e => e.type === 'checkin_confirmed'));
      assert.deepEqual(deviceCalls(f.services).map(call => call.service).sort(), ['light/turn_on', 'light/turn_on']);
      assert.deepEqual(deviceCalls(f.services).map(call => call.body.entity_id).sort(), ['light.fixture_entrance', 'light.fixture_living']);
    } finally { Date.now = previousNow; f.cleanup(); }
  });

  test('움직임 센서가 꺼져 있어도 문 뒤 벽 스위치 조작으로 입실을 확인한다', async () => {
    const previousNow = Date.now;
    const base = Date.now(); let time = base, doorOpen = false, wallOn = false;
    const changed = { door: base - 10 * MIN, wall: base - 10 * MIN };
    const states = () => ({
      'binary_sensor.entrance_door': { ...sensor(doorOpen ? 'on' : 'off', { dc: 'door', name: '현관문' }), last_changed: new Date(changed.door).toISOString() },
      'binary_sensor.entrance_motion': sensor('unavailable'),
      'switch.bathroom_wall': { state: wallOn ? 'on' : 'off', last_changed: new Date(changed.wall).toISOString(),
        attributes: { friendly_name: '거실 욕실 스위치' }, context: { user_id: null, parent_id: null } },
    });
    const f = await watcherFixture(new Proxy({}, { get: (_, key) => states()[key], ownKeys: () => Object.keys(states()),
      getOwnPropertyDescriptor: (_, key) => ({ enumerable: true, configurable: true, value: states()[key] }) }));
    Date.now = () => time;
    try {
      const cfg = { areaName: 'fixture-handoff', dataOrigin: 'SIMULATED', devices: DEVICES,
        reservation: stay('stay-1', base - MIN, base + 20 * HOUR) };
      f.watcher.setRoomState(VACANT);
      f.watcher.setMonitoringConfig(cfg);
      await until(() => f.watcher.getMonitoringState().roomState.mainStatus === 'OCCUPIED');
      assert.equal(ofType(f.outbox(), 'detection_unconfirmable').length, 0, '입실은 대체 사람 신호가 있어 확인 불가가 아니다');

      time = base + MIN; doorOpen = true; changed.door = time;
      f.watcher.setMonitoringConfig(cfg); await new Promise(resolve => setTimeout(resolve, 25));
      time = base + 2 * MIN; doorOpen = false; changed.door = time;
      f.watcher.setMonitoringConfig(cfg); await new Promise(resolve => setTimeout(resolve, 25));
      time = base + 3 * MIN; wallOn = true; changed.wall = time;
      f.watcher.setMonitoringConfig(cfg);

      await until(() => f.watcher.getMonitoringState().eventLog.some(e => e.type === 'checkin_confirmed'));
      assert.deepEqual(deviceCalls(f.services).map(call => call.body.entity_id).sort(), ['light.fixture_entrance', 'light.fixture_living']);
    } finally { Date.now = previousNow; f.cleanup(); }
  });
});
