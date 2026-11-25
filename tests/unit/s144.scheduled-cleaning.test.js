/**
 * RF-52 (DEC-10·17) — 청소도 스케줄로
 *  - 서버가 보낸 청소 일정의 시작 시각에 청소 중, 끝 시각에 공실(상태 = 스케줄).
 *  - 실제 청소 시작·끝은 감지해 따로 기록한다(cleaning_activity_*) — 청소시간 준수(3시간) 지표는 실제 시각으로 잰다.
 *  - 배정된 청소 시간 동안 담당자가 들어온 것이 안 보이면 청소 미감지 + 운영자에게. 센서 꺼짐·감시 멈춤이면 확인 불가.
 *  - 기기: 일정 시작엔 기기 제어 없음. 끝엔 담당자가 나간 것을 봤을 때만 공실 기기 제어(잠금 포함) — 안에 있을 수 있으면 하지 않는다.
 *  - 그 퇴실의 청소 일정이 없으면 예전처럼 감지로 전환한다.
 */
import { TEST_DATA_DIR } from '../helpers/isolateDataDir.js';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SuspicionTracker } from '../../src/application/suspicionTracker.js';
import { getNextRoomState, isValidTransition } from '../../src/domain/room-state/roomStateDomain.js';
import { countPeriodEvents } from '../../src/domain/reportingDomain.js';
import { buildIssueItems } from '../../src/domain/monthlyCalendarDomain.js';
import { detectCleaningTimeFailures, detectPostCleaningFailures } from '../../src/domain/metricDrilldownDomain.js';
import { handoffAlertMessage } from '../../src/domain/sensorHealthDomain.js';
import { pickCurrentCleaning } from '../../src/domain/monitoringReservationDomain.js';

const MIN = 60_000, HOUR = 60 * MIN;
const CFG = {
  CHECKOUT_GRACE_MS: 20 * MIN, EARLY_CHECKOUT_QUIET_MS: 20 * MIN, CLEANING_SUSTAINED_MS: 20 * MIN,
  CLEANING_DONE_QUIET_MS: 10 * MIN, NO_SHOW_WINDOW_MS: 60 * MIN, NOISE_QUIET_DB: 40, AC_ON: 50,
};
const CHECK_OUT = Date.parse('2026-11-24T02:00:00.000Z'); // 11:00 KST
const START = CHECK_OUT, END = CHECK_OUT + 3 * HOUR;
const stay = { uid: 'stay-1', checkIn: new Date(CHECK_OUT - 20 * HOUR), checkOut: new Date(CHECK_OUT) };
const plan = (extra = {}) => ({ jobId: 'job-1', checkoutAt: new Date(CHECK_OUT).toISOString(), startAt: new Date(START).toISOString(),
  endAt: new Date(END).toISOString(), assigned: true, ...extra });
const OCCUPIED = { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' };
const PENDING = { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING' };
const IN_PROGRESS = { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' };
const VACANT = { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' };
const none = { exit: false, exitAt: null, entry: false, entryAt: null };
const entered = { ...none, entry: true };
const exited = { ...none, exit: true };
const OFF = [{ entityId: 'binary_sensor.motion', roleLabel: '움직임 센서', name: '현관 움직임' }];
const types = events => events.map(e => e.type);
const run = (t, { roomState = PENDING, sensorResult = none, motionNow = false, now, cleaning = plan(), sensorsOff = [], res = stay }) =>
  t.evaluate({ sensorResult, roomState, reservation: res, motionNow, acPower: null, noiseLevel: null, now, cfg: CFG, sensorsOff, cleaning });

/** 퇴실을 처리한 감시기(퇴실 확인됨) */
function afterCheckout() {
  const t = new SuspicionTracker();
  run(t, { roomState: OCCUPIED, sensorResult: exited, now: CHECK_OUT });
  return t;
}
/** 담당자가 들어와 20분 움직였다 — 실제 청소 시작 */
function cleanerWorks(t, at) {
  run(t, { sensorResult: entered, motionNow: true, now: at });
  return run(t, { motionNow: true, now: at + 20 * MIN });
}

describe('상태는 청소 일정대로', () => {
  test('시작 시각에 청소 중, 끝 시각에 공실 — 각각 한 번, 발생 시각은 일정 시각', () => {
    const t = afterCheckout();
    const [started] = run(t, { now: START });
    assert.deepEqual([started.type, started.timestamp, started.data.jobId], ['scheduled_cleaning_started', START, 'job-1']);
    assert.deepEqual(run(t, { roomState: IN_PROGRESS, now: START + HOUR }), []);
    const finished = run(t, { roomState: IN_PROGRESS, sensorResult: entered, now: END - HOUR }); // 담당자 입장
    assert.deepEqual(finished, []);
    const end = run(t, { roomState: IN_PROGRESS, now: END });
    assert.deepEqual(end.map(e => [e.type, e.timestamp]), [['scheduled_cleaning_finished', END]], '담당자가 들어온 것을 봤으니 미감지 아님');
    assert.deepEqual(run(t, { roomState: VACANT, now: END + MIN }), [], '한 번만');
  });

  test('상태 표: 청소 대기 → 청소 중 → 공실', () => {
    assert.deepEqual(getNextRoomState(PENDING, 'scheduled_cleaning_started'), IN_PROGRESS);
    assert.deepEqual(getNextRoomState(IN_PROGRESS, 'scheduled_cleaning_finished'), VACANT);
    assert.equal(isValidTransition(PENDING, 'scheduled_cleaning_finished'), false);
  });

  test('감시가 늦게 시작해 시작·끝이 다 지났으면 시작·끝을 순서대로 한 번에', () => {
    const t = afterCheckout();
    assert.deepEqual(types(run(t, { sensorResult: entered, now: END + MIN })).slice(0, 2), ['scheduled_cleaning_started', 'scheduled_cleaning_finished']);
  });
});

describe('실제 청소 시각은 따로 기록 — 상태를 바꾸지 않는다', () => {
  test('담당자가 들어와 20분 움직이면 실제 시작, 나가서 10분 조용하면 실제 끝 — 끝 시각에 공실 기기 제어 가능', () => {
    const t = afterCheckout();
    run(t, { now: START });
    assert.deepEqual(types(cleanerWorks(t, START + 10 * MIN)), ['cleaning_activity_started']);
    run(t, { roomState: IN_PROGRESS, sensorResult: exited, now: START + 2 * HOUR });
    const [done] = run(t, { roomState: IN_PROGRESS, now: START + 2 * HOUR + 10 * MIN });
    assert.deepEqual([done.type, done.data.jobId], ['cleaning_activity_finished', 'job-1']);
    const [end] = run(t, { roomState: IN_PROGRESS, now: END });
    assert.deepEqual([end.type, end.data.vacantConfirmed], ['scheduled_cleaning_finished', true]);
  });

  test('끝 시각에 담당자가 아직 안에 있으면 공실 기기 제어를 하지 않고, 나가는 것을 보면 그때 한다 — 문제는 아니다', () => {
    const t = afterCheckout();
    run(t, { now: START });
    cleanerWorks(t, END - HOUR);
    const end = run(t, { roomState: IN_PROGRESS, motionNow: true, now: END });
    assert.deepEqual(end.map(e => [e.type, e.data.vacantConfirmed]), [['scheduled_cleaning_finished', false]]);
    run(t, { roomState: VACANT, sensorResult: exited, now: END + 30 * MIN });
    assert.deepEqual(types(run(t, { roomState: VACANT, now: END + 40 * MIN })), ['cleaning_activity_finished', 'cleaning_vacant_confirmed']);
  });
});

describe('담당자 미감지 (DEC-17)', () => {
  test('배정된 청소에 아무도 안 들어오면 끝 시각에 청소 미감지 1건 — 발생 시각은 시작 시각, 공실 기기 제어 없음', () => {
    const t = afterCheckout();
    run(t, { now: START });
    const events = run(t, { roomState: IN_PROGRESS, now: END });
    assert.deepEqual(events.map(e => [e.type, e.timestamp]), [['scheduled_cleaning_finished', END], ['cleaning_not_detected', START]]);
    assert.equal(events[0].data.vacantConfirmed, false);
    assert.equal(events[1].data.jobId, 'job-1');
  });

  test('담당자가 배정되지 않은 청소는 판정하지 않는다 — 이미 청소 미배정으로 남는다', () => {
    const t = afterCheckout();
    run(t, { now: START, cleaning: plan({ assigned: false }) });
    assert.deepEqual(types(run(t, { roomState: IN_PROGRESS, now: END, cleaning: plan({ assigned: false }) })), ['scheduled_cleaning_finished']);
  });

  test('퇴실 뒤 일정이 오기 전에 들어온 것도 센다', () => {
    const t = afterCheckout();
    run(t, { sensorResult: entered, now: CHECK_OUT + MIN, cleaning: null });
    run(t, { now: START + 5 * MIN });
    assert.deepEqual(types(run(t, { roomState: IN_PROGRESS, now: END })), ['scheduled_cleaning_finished']);
  });

  test('청소 시간 중 센서가 한 번이라도 꺼졌으면 미감지로 단정하지 않고 확인 불가(그때 꺼진 센서)', () => {
    const t = afterCheckout();
    run(t, { now: START });
    run(t, { roomState: IN_PROGRESS, now: START + HOUR, sensorsOff: OFF });
    const [, problem] = run(t, { roomState: IN_PROGRESS, now: END });
    assert.deepEqual([problem.type, problem.data.phase, problem.data.cause], ['detection_unconfirmable', 'cleaning', 'sensor_off']);
    assert.deepEqual(problem.data.sensors.map(s => s.name), ['현관 움직임']);
  });

  test('워처가 오래 꺼져 있다 켜지면 확인 불가(not_observed)', () => {
    const t = afterCheckout();
    run(t, { now: START });
    const back = new SuspicionTracker();
    back.restore(JSON.parse(JSON.stringify(t.snapshot())));
    const [, problem] = run(back, { roomState: IN_PROGRESS, now: END });
    assert.deepEqual([problem.type, problem.data.cause], ['detection_unconfirmable', 'not_observed']);
  });

  test('운영자가 청소 완료를 누르면(공실로 바뀜) 판정하지 않고, 청소 시작을 누르면 담당자를 본 것으로 센다', () => {
    const done = afterCheckout();
    run(done, { now: START });
    done.noteManualCleaning('cleaning_finished');
    assert.deepEqual(run(done, { roomState: VACANT, now: END }), []);
    const started = afterCheckout();
    run(started, { now: START });
    started.noteManualCleaning('cleaning_started');
    assert.deepEqual(types(run(started, { roomState: IN_PROGRESS, now: END })), ['scheduled_cleaning_finished']);
  });

  test('시작 시각보다 한참 뒤에야 기다리기 시작했으면(워처가 꺼져 있었음) 미감지 대신 확인 불가(not_observed)', () => {
    const t = afterCheckout();
    const events = run(t, { now: END });
    assert.deepEqual(types(events), ['scheduled_cleaning_started', 'scheduled_cleaning_finished', 'detection_unconfirmable']);
    assert.deepEqual([events[2].data.cause, events[2].timestamp], ['not_observed', END], '확인 불가는 끝 시각 — 퇴실 확인 불가와 겹치지 않게');
  });

  test('운영자가 청소 시작을 누른 뒤 실제 끝만 보여도 미감지가 아니다', () => {
    const t = afterCheckout();
    run(t, { now: START });
    t.noteManualCleaning('cleaning_started');
    run(t, { roomState: IN_PROGRESS, sensorResult: exited, now: START + HOUR });
    assert.deepEqual(types(run(t, { roomState: IN_PROGRESS, now: START + HOUR + 10 * MIN })), ['cleaning_activity_finished']);
    assert.deepEqual(types(run(t, { roomState: IN_PROGRESS, now: END })), ['scheduled_cleaning_finished']);
  });

  test('나갔던 담당자가 끝 시각 전에 다시 들어오면 공실 기기 제어를 하지 않는다', () => {
    const t = afterCheckout();
    run(t, { now: START });
    cleanerWorks(t, START + 10 * MIN);
    run(t, { roomState: IN_PROGRESS, sensorResult: exited, now: START + HOUR });
    run(t, { roomState: IN_PROGRESS, now: START + HOUR + 10 * MIN });
    run(t, { roomState: IN_PROGRESS, sensorResult: entered, motionNow: true, now: END - 20 * MIN });
    const [end] = run(t, { roomState: IN_PROGRESS, motionNow: true, now: END });
    assert.equal(end.data.vacantConfirmed, false);
  });

  test('끝 시각 뒤 1시간 안에 담당자가 나가는 것을 못 보면 공실 기기 제어를 하지 않은 채 운영자에게 넘긴다', () => {
    const t = afterCheckout();
    run(t, { now: START });
    cleanerWorks(t, START + 10 * MIN);
    run(t, { roomState: IN_PROGRESS, motionNow: true, now: END });
    assert.deepEqual(run(t, { roomState: VACANT, motionNow: true, now: END + 59 * MIN }), []);
    const [problem] = run(t, { roomState: VACANT, now: END + HOUR });
    assert.deepEqual([problem.type, problem.data.phase, problem.data.cause, problem.timestamp], ['detection_unconfirmable', 'cleaning', 'exit_not_seen', END + HOUR]);
    assert.deepEqual(run(t, { roomState: VACANT, sensorResult: exited, now: END + 2 * HOUR }), [], '넘긴 뒤엔 자동으로 하지 않는다');
  });

  test('운영자가 다른 상태로 바꾸면(정비 등) 그 판단을 따른다 — 끝 시각에 판정하지 않는다', () => {
    const t = afterCheckout();
    run(t, { now: START });
    run(t, { roomState: { mainStatus: 'VACANT', subStatus: 'MAINTENANCE' }, now: START + HOUR });
    assert.deepEqual(run(t, { roomState: { mainStatus: 'VACANT', subStatus: 'MAINTENANCE' }, now: END }), []);
  });

  test('청소 중에 담당자가 안에 있는 채 입실 시각이 되면, 나가는 것을 본 뒤에 들어온 사람만 손님', () => {
    const t = afterCheckout();
    run(t, { now: START });
    cleanerWorks(t, START + 10 * MIN);
    const res = { uid: 'stay-2', checkIn: new Date(START + 30 * MIN), checkOut: new Date(START + 24 * HOUR) };
    const [checkin] = run(t, { roomState: PENDING, res, motionNow: true, now: START + 30 * MIN });
    assert.deepEqual([checkin.type, checkin.data.entryConfirmed], ['scheduled_checkin_reached', false]);
    assert.equal(t.checkinWatch.needsExitFirst, true);
  });
});

describe('일정이 없으면 예전처럼 감지로 전환', () => {
  for (const [label, cleaning] of [['일정 없음', null], ['다른 퇴실의 일정', plan({ checkoutAt: new Date(CHECK_OUT + 24 * HOUR).toISOString() })], ['끝이 시작보다 빠른 일정', plan({ endAt: new Date(START - MIN).toISOString() })]]) {
    test(label, () => {
      const t = afterCheckout();
      run(t, { sensorResult: entered, motionNow: true, now: START, cleaning });
      assert.deepEqual(types(run(t, { motionNow: true, now: START + 20 * MIN, cleaning })), ['cleaning_started']);
      run(t, { roomState: IN_PROGRESS, sensorResult: exited, now: START + HOUR, cleaning });
      assert.deepEqual(types(run(t, { roomState: IN_PROGRESS, now: START + HOUR + 10 * MIN, cleaning })), ['cleaning_finished']);
    });
  }
});

describe('재시작해도 이어진다', () => {
  test('저장한 일정 판정을 되살리면 끝 시각 판정이 그대로 된다(짧게 꺼졌으면)', () => {
    const t = afterCheckout();
    run(t, { now: START });
    cleanerWorks(t, START + 10 * MIN);
    const back = new SuspicionTracker();
    back.restore(JSON.parse(JSON.stringify(t.snapshot())));
    run(back, { roomState: IN_PROGRESS, motionNow: true, now: START + 31 * MIN });
    assert.deepEqual(types(run(back, { roomState: IN_PROGRESS, motionNow: true, now: END })), ['scheduled_cleaning_finished'], '담당자를 봤으니 문제 없음');
  });
  test('깨진 저장값은 버린다', () => {
    const t = new SuspicionTracker();
    t.restore({ cleaningWatch: { jobId: 'x', startMs: 'a' }, actualCleaning: { jobId: 'x', phase: 'weird', expiresAt: 1 } });
    assert.deepEqual([t.cleaningWatch, t.actualCleaning], [null, null]);
  });
});

describe('서버가 보낼 청소 일정 고르기', () => {
  const now = new Date(CHECK_OUT - HOUR);
  const row = (id, startMs, endMs, status = 'ASSIGNED') => ({ id, checkout_at: new Date(startMs).toISOString(), cleaning_start_at: new Date(startMs).toISOString(),
    cleaning_end_at: endMs == null ? null : new Date(endMs).toISOString(), status });
  test('끝나지 않은 것 중 가장 이른 것, 끝이 비면 소요 시간으로, 배정 완료·완료만 배정으로', () => {
    assert.equal(pickCurrentCleaning([row('late', START + 24 * HOUR, null)], now, 2, new Date(START).toISOString()), null, '보내는 예약의 퇴실에 딸린 청소만');
    assert.deepEqual(pickCurrentCleaning([row('late', START + 24 * HOUR, null, 'PENDING'), row('past', START - 5 * HOUR, START - 2 * HOUR), row('now', START, null)], now, 2), {
      jobId: 'now', checkoutAt: new Date(START).toISOString(), startAt: new Date(START).toISOString(), endAt: new Date(START + 2 * HOUR).toISOString(), assigned: true,
    });
    assert.equal(pickCurrentCleaning([row('c', START, END, 'CANCELLED')], now).assigned, false);
    assert.equal(pickCurrentCleaning([row('done', START - 5 * HOUR, START - 2 * HOUR)], now), null);
    assert.equal(pickCurrentCleaning([], now), null);
  });
});

describe('레포트·달력·문구', () => {
  test('청소시간 준수는 실제 청소 시각으로 잰다 — 일정 전환은 세지 않는다', () => {
    const at = ms => ms;
    const events = [
      { property_id: 'P', type: 'scheduled_cleaning_started', device_time: at(START) },
      { property_id: 'P', type: 'cleaning_activity_started', device_time: at(START + 20 * MIN) },
      { property_id: 'P', type: 'scheduled_cleaning_finished', device_time: at(END) },
      { property_id: 'P', type: 'cleaning_activity_finished', device_time: at(START + 4 * HOUR) },
    ];
    const [failure] = detectCleaningTimeFailures(events);
    assert.equal(Math.round(failure.detail.duration_hours * 60), 220, '실제 3시간 40분');
    const stats = countPeriodEvents(events.map(({ type }) => ({ type })));
    assert.equal(stats.cleaningFinished, 1, '공실이 된 횟수 = 일정의 끝 1번 — 실제 청소 끝 기록은 같은 청소를 두 번 세지 않게 넣지 않는다');
  });
  test('담당자를 못 봤어도 일정이 끝나면 공실이 된 1번으로 센다 — 빈방 지표의 분모가 빠지지 않게', () => {
    const stats = countPeriodEvents([{ type: 'scheduled_cleaning_finished' }, { type: 'post_cleaning_security_breach_detected' }]);
    assert.deepEqual([stats.cleaningFinished, stats.postCleaningSecurityBreach], [1, 1]);
  });

  test('짝짓기는 시간 순서로 시작 → 그 뒤 첫 끝 — 같은 청소의 두 번째 끝·끝을 못 본 시작이 다음 짝을 밀지 않는다', () => {
    const day = 24 * HOUR;
    const failures = detectCleaningTimeFailures([
      { property_id: 'P', type: 'cleaning_activity_started', device_time: START },
      { property_id: 'P', type: 'cleaning_activity_finished', device_time: START + 2 * HOUR },
      { property_id: 'P', type: 'cleaning_finished', device_time: START + 2 * HOUR + 20 * MIN }, // 운영자 완료 — 같은 청소
      { property_id: 'P', type: 'cleaning_activity_started', device_time: START + day },         // 끝을 못 본 시작
      { property_id: 'P', type: 'cleaning_started', device_time: START + 2 * day },
      { property_id: 'P', type: 'cleaning_activity_finished', device_time: START + 2 * day + 4 * HOUR },
    ]);
    assert.deepEqual(failures.map(f => Math.round(f.detail.duration_hours)), [4], '셋째 날 4시간만 초과 — 첫날 2시간, 둘째 날은 측정 안 함');
  });

  test('청소 후 지표의 기준 시각은 실제 청소 끝', () => {
    const [item] = detectPostCleaningFailures([
      { property_id: 'P', type: 'cleaning_activity_finished', device_time: START + HOUR },
      { property_id: 'P', type: 'post_cleaning_security_breach_detected', device_time: START + 2 * HOUR },
    ], 'post_cleaning_security_breach_detected');
    assert.equal(item.detail.anchor_at, new Date(START + HOUR).toISOString());
  });
  test('청소 미감지는 문제·이상 1건, 달력엔 청소 문제 "청소 미감지"·"청소 확인 불가"', () => {
    assert.equal(countPeriodEvents([{ type: 'cleaning_not_detected' }]).anomalies, 1);
    const items = buildIssueItems([
      { property_id: 'P', type: 'cleaning_not_detected', device_time: '2026-11-24T02:00:00.000Z', data: {} },
      { property_id: 'P', type: 'detection_unconfirmable', device_time: '2026-11-24T02:00:00.001Z', data: { phase: 'cleaning' } },
    ]);
    assert.deepEqual(items.map(i => [i.label, i.category]), [['청소 미감지', 'CLEANING'], ['청소 확인 불가', 'CLEANING']]);
  });
  test('운영자에게 넘기는 문구', () => {
    const startAt = new Date(START).toISOString();
    assert.equal(handoffAlertMessage('파주201', { type: 'cleaning_not_detected', data: { startAt } }).message,
      '11/24 11:00 청소 시간 동안 담당자가 들어온 것이 보이지 않았어요. 공실 기기 제어(끄기·잠금)를 하지 않았어요. 청소가 됐는지 직접 확인해 주세요.');
    assert.equal(handoffAlertMessage('파주201', { type: 'detection_unconfirmable', data: { phase: 'cleaning', cause: 'not_observed', startAt } }).message,
      '11/24 11:00 청소를 확인할 수 없어요(그 시각에 감시가 멈춰 있었어요). 공실 기기 제어(끄기·잠금)를 하지 않았어요. 직접 확인하고 처리해 주세요.');
    assert.match(handoffAlertMessage('파주201', { type: 'detection_unconfirmable', data: { phase: 'cleaning', cause: 'exit_not_seen', startAt } }).message,
      /\(청소 담당자가 나간 것을 보지 못했어요\)\. 공실 기기 제어/);
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

async function cleaningWatcher({ start, checkOut, states }) {
  const previousFetch = global.fetch, previousWs = global.WebSocket, previousDir = process.env.PROPOS_DATA_DIR;
  const folder = mkdtempSync(join(TEST_DATA_DIR, 'cleaning-'));
  process.env.PROPOS_DATA_DIR = folder;
  const services = [];
  global.WebSocket = class { static OPEN = 1; readyState = 1; addEventListener() {} close() {} };
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/api/events/write')) return { ok: false, status: 503, json: async () => ({}) };
    assert.ok(href.startsWith('http://ha.test/'), 'Tests must never call external services');
    const current = states();
    if (href.endsWith('/api/template')) return { ok: true, text: async () => JSON.stringify(Object.keys(current)) };
    if (href.includes('/api/services/')) { services.push({ service: href.split('/api/services/')[1], body: JSON.parse(options.body ?? '{}') }); return { ok: true, json: async () => ([]) }; }
    const entity = href.split('/api/states/')[1];
    return { ok: true, json: async () => ({ entity_id: entity, ...current[entity] }) };
  };
  const cleaning = { jobId: 'job-w', checkoutAt: new Date(checkOut).toISOString(), startAt: new Date(start).toISOString(), endAt: new Date(start + 3 * HOUR).toISOString(), assigned: true };
  writeFileSync(join(folder, 'monitoring-state.json'), JSON.stringify({ roomState: PENDING,
    monitor: { scheduledCheckoutKey: `stay-1|${new Date(checkOut).toISOString()}`, observedAt: Date.now() } }));
  writeFileSync(join(folder, 'monitoring-config.json'), JSON.stringify({ areaName: 'fixture-cleaning', dataOrigin: 'SIMULATED',
    devices: { LIGHT_LIVING: 'light.fixture_living', LOCK_ENTRANCE: 'lock.fixture_entrance', FAN_VENTILATION: 'fan.fixture_vent' },
    optimization: { operatorNotifyService: 'notify.mobile_app_operator' }, cleaning, reservation: null }));
  const watcher = await import(`../../server/occupancyWatcher.js?cleaning=${++sequence}`);
  return {
    watcher, services, folder,
    outbox: () => JSON.parse(readFileSync(join(folder, 'monitoring-state.json'), 'utf8')).preparationOutbox ?? [],
    cleanup() { watcher.stopWatcher(); global.fetch = previousFetch; global.WebSocket = previousWs; process.env.PROPOS_DATA_DIR = previousDir; },
  };
}

describe('워처 — 실제 청소 시각은 서버에 기록만 한다', () => {
  test('담당자가 들어와 20분 움직이면 실제 청소 시작이 서버로 간다 — 상태는 일정대로 둔다', async () => {
    const realNow = Date.now;
    const base = realNow(); let time = base, doorOpen = false, motion = false;
    const states = () => ({
      'binary_sensor.entrance_door': { state: doorOpen ? 'on' : 'off', attributes: { device_class: 'door', friendly_name: '현관문' } },
      'binary_sensor.entrance_motion': { state: motion ? 'on' : 'off', attributes: { device_class: 'motion', friendly_name: '현관 움직임' } },
    });
    const f = await cleaningWatcher({ start: base + 2 * HOUR, checkOut: base - 30 * MIN, states });
    Date.now = () => time;
    try {
      f.watcher.startWatcher();
      await until(() => f.watcher.getMonitoringState().roomState.mainStatus === 'CLEANING');
      for (let minute = 1; minute <= 26; minute++) {
        time = base + minute * MIN;
        doorOpen = minute === 1; motion = minute >= 3;
        f.watcher.setMonitoringConfig({});
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      await until(() => f.outbox().some(e => e.type === 'cleaning_activity_started'));
      const [record] = f.outbox().filter(e => e.type === 'cleaning_activity_started');
      assert.deepEqual([record.is_soft, record.data.jobId], [false, 'job-w']);
      assert.deepEqual(f.watcher.getMonitoringState().roomState, PENDING, '실제 청소 시작은 상태를 바꾸지 않는다 — 일정 시작 전이다');
    } finally { Date.now = realNow; f.cleanup(); }
  });
});

describe('워처 — 청소 일정 시작·끝에 기기를 함부로 건드리지 않는다', () => {
  test('시작엔 기기 제어 없음, 아무도 안 온 채 끝나면 공실로 바꾸되 공실 기기 제어(잠금 포함) 없이 청소 미감지 + 운영자 알림', async () => {
    const previousFetch = global.fetch, previousWs = global.WebSocket, previousDir = process.env.PROPOS_DATA_DIR, realNow = Date.now;
    const folder = mkdtempSync(join(TEST_DATA_DIR, 'cleaning-'));
    process.env.PROPOS_DATA_DIR = folder;
    const services = [];
    const states = { 'binary_sensor.entrance_motion': { state: 'off', attributes: { device_class: 'motion', friendly_name: '현관 움직임' } },
      'binary_sensor.entrance_door': { state: 'off', attributes: { device_class: 'door', friendly_name: '현관문' } } };
    global.WebSocket = class { static OPEN = 1; readyState = 1; addEventListener() {} close() {} };
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      if (href.endsWith('/api/events/write')) return { ok: false, status: 503, json: async () => ({}) };
      assert.ok(href.startsWith('http://ha.test/'), 'Tests must never call external services');
      if (href.endsWith('/api/template')) return { ok: true, text: async () => JSON.stringify(Object.keys(states)) };
      if (href.includes('/api/services/')) { services.push({ service: href.split('/api/services/')[1], body: JSON.parse(options.body ?? '{}') }); return { ok: true, json: async () => ([]) }; }
      const entity = href.split('/api/states/')[1];
      return { ok: true, json: async () => ({ entity_id: entity, ...states[entity] }) };
    };
    const start = realNow() - MIN, checkOut = start - 30 * MIN;
    const cleaning = { jobId: 'job-w', checkoutAt: new Date(checkOut).toISOString(), startAt: new Date(start).toISOString(), endAt: new Date(start + 3 * HOUR).toISOString(), assigned: true };
    writeFileSync(join(folder, 'monitoring-state.json'), JSON.stringify({ roomState: PENDING,
      monitor: { scheduledCheckoutKey: `stay-1|${new Date(checkOut).toISOString()}`, observedAt: realNow() } }));
    writeFileSync(join(folder, 'monitoring-config.json'), JSON.stringify({ areaName: 'fixture-cleaning', dataOrigin: 'SIMULATED',
      devices: { LIGHT_LIVING: 'light.fixture_living', LOCK_ENTRANCE: 'lock.fixture_entrance', FAN_VENTILATION: 'fan.fixture_vent' },
      optimization: { operatorNotifyService: 'notify.mobile_app_operator' }, cleaning, reservation: null }));
    const watcher = await import(`../../server/occupancyWatcher.js?cleaning=${++sequence}`);
    const outbox = () => JSON.parse(readFileSync(join(folder, 'monitoring-state.json'), 'utf8')).preparationOutbox ?? [];
    const deviceCalls = () => services.filter(call => /^(light|fan|switch|climate|lock)\//.test(call.service));
    try {
      watcher.startWatcher();
      await until(() => watcher.getMonitoringState().roomState.subStatus === 'CLEANING_IN_PROGRESS');
      assert.ok(outbox().some(e => e.type === 'scheduled_cleaning_started' && e.device_time === start));
      assert.deepEqual(deviceCalls(), [], '일정 시작엔 기기 제어 없음');
      Date.now = () => realNow() + 3 * HOUR;
      watcher.setMonitoringConfig({});
      await until(() => watcher.getMonitoringState().roomState.mainStatus === 'VACANT');
      await until(() => outbox().some(e => e.type === 'cleaning_not_detected'));
      assert.deepEqual(deviceCalls(), [], '담당자가 나간 것을 못 봤으니 끄기·잠금을 하지 않는다');
      await until(() => services.some(call => call.service === 'notify/mobile_app_operator' && /청소 미감지/.test(call.body.title)));
    } finally {
      Date.now = realNow; watcher.stopWatcher();
      global.fetch = previousFetch; global.WebSocket = previousWs; process.env.PROPOS_DATA_DIR = previousDir;
    }
  });
});
