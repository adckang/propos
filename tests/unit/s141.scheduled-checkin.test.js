/**
 * 입실도 퇴실과 같은 원칙 (DEC-10·11·16)
 *  - 입실 시각이 되면 체류로 바꾼다(스케줄). 센서는 "손님이 들어왔는가"만 본다.
 *  - 들어온 것이 확인되면 그때 체류 기기 제어(자동), 그날 자정까지 확인되지 않으면 입실 미감지 문제 + 운영자에게.
 *  - 그 시각에 감지 센서가 꺼져 있거나 감시가 멈춰 있었으면 미감지로 단정하지 않고 확인 불가 + 운영자에게.
 *  - 손님이 들어온 것이 확인되기 전엔 빈방이므로 체류 중 점검(에너지·환경·소음)을 하지 않는다(연기·문 열림은 한다).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SuspicionTracker } from '../../src/application/suspicionTracker.js';
import { OccupancyMonitor } from '../../src/application/occupancyMonitor.js';
import { getNextRoomState, isValidTransition } from '../../src/domain/room-state/roomStateDomain.js';

const MIN = 60_000, HOUR = 60 * MIN;
const CFG = {
  CHECKOUT_GRACE_MS: 20 * MIN, EARLY_CHECKOUT_QUIET_MS: 20 * MIN, CLEANING_SUSTAINED_MS: 20 * MIN,
  CLEANING_DONE_QUIET_MS: 10 * MIN, NO_SHOW_WINDOW_MS: 60 * MIN, NOISE_QUIET_DB: 40, AC_ON: 50,
};
const CHECK_IN = Date.parse('2026-11-24T06:00:00.000Z'); // 11-24 15:00 KST
const MIDNIGHT = Date.parse('2026-11-24T15:00:00.000Z'); // 11-25 00:00 KST
const stay = (extra = {}) => ({ uid: 'stay-1', checkIn: new Date(CHECK_IN), checkOut: new Date(CHECK_IN + 20 * HOUR), ...extra });
const OPTIMIZED = { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED' };
const OCCUPIED = { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' };
const none = { exit: false, exitAt: null, entry: false, entryAt: null };
const entered = { exit: false, exitAt: null, entry: true, entryAt: null };
const OFF = [{ entityId: 'binary_sensor.motion', roleLabel: '움직임 센서', name: '현관 움직임' }];
const run = (tracker, { roomState = OPTIMIZED, res = stay(), sensorResult = none, motionNow = false, now, sensorsOff = [],
  entrySensorsOff = sensorsOff, presenceEvidence = null }) =>
  tracker.evaluate({ sensorResult, roomState, reservation: res, motionNow, acPower: null, noiseLevel: null, now, cfg: CFG,
    sensorsOff, entrySensorsOff, presenceEvidence });
const types = events => events.map(e => e.type);

describe('상태 표 — 입실 시각 전환이 갈 수 있는 곳', () => {
  for (const key of ['VACANT/CLEANING_FINISHED', 'VACANT/ENERGY_WASTE', 'PRE_STAY_READY/OPTIMIZING', 'PRE_STAY_READY/OPTIMIZED',
    'PRE_STAY_READY/OPTIMIZATION_FAILED', 'CLEANING/CLEANING_PENDING', 'CLEANING/CLEANING_IN_PROGRESS']) {
    test(`${key} → 체류`, () => {
      const [mainStatus, subStatus] = key.split('/');
      assert.deepEqual(getNextRoomState({ mainStatus, subStatus }, 'scheduled_checkin_reached'), { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' });
    });
  }
  test('정비 중·체류 중에서는 갈 수 없다', () => {
    assert.equal(isValidTransition({ mainStatus: 'VACANT', subStatus: 'MAINTENANCE' }, 'scheduled_checkin_reached'), false);
    for (const subStatus of ['GOOD_CONDITION', 'ENERGY_WASTE', 'ISSUE_COMPLAINT', 'ISSUE_AND_ENERGY']) {
      assert.equal(isValidTransition({ mainStatus: 'OCCUPIED', subStatus }, 'scheduled_checkin_reached'), false, subStatus);
    }
  });
});

describe('입실 시각에 체류로 (스케줄)', () => {
  for (const roomState of [
    OPTIMIZED, { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING' }, { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZATION_FAILED' },
    { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' }, { mainStatus: 'VACANT', subStatus: 'ENERGY_WASTE' },
    { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING' }, { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' },
  ]) test(`${roomState.mainStatus}/${roomState.subStatus}`, () => {
    const t = new SuspicionTracker();
    assert.deepEqual(run(t, { roomState, now: CHECK_IN - 1 }), [], '입실 시각 전엔 그대로');
    const [event, ...rest] = run(t, { roomState, now: CHECK_IN });
    assert.equal(rest.length, 0);
    assert.deepEqual([event.type, event.timestamp, event.data.entryConfirmed, event.data.reservationUid], ['scheduled_checkin_reached', CHECK_IN, false, 'stay-1']);
    assert.deepEqual(run(t, { roomState, now: CHECK_IN + MIN }), [], '예약당 한 번');
  });

  test('정비 중(운영자가 정한 상태)·체류 중·예약 없음·퇴실까지 지난 예약은 바꾸지 않는다', () => {
    assert.deepEqual(run(new SuspicionTracker(), { roomState: { mainStatus: 'VACANT', subStatus: 'MAINTENANCE' }, now: CHECK_IN }), []);
    assert.deepEqual(run(new SuspicionTracker(), { roomState: OCCUPIED, now: CHECK_IN }), []);
    assert.deepEqual(run(new SuspicionTracker(), { res: null, now: CHECK_IN }), []);
    assert.deepEqual(run(new SuspicionTracker(), { roomState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' }, now: CHECK_IN + 21 * HOUR }), []);
  });

  test('입실 시각 전에 들어오면 조기 입실 알림, 입실 시각에는 이미 확인된 입실 — 기다리지 않는다', () => {
    const t = new SuspicionTracker();
    assert.deepEqual(types(run(t, { sensorResult: entered, motionNow: true, now: CHECK_IN - 30 * MIN })), ['early_checkin_suspected']);
    const [event] = run(t, { now: CHECK_IN });
    assert.equal(event.data.entryConfirmed, true);
    assert.equal(t.checkinWatch, null);
    assert.equal(t.stayEntryConfirmed, true);
    assert.deepEqual(run(t, { roomState: OCCUPIED, now: MIDNIGHT + 1 }), [], '확인된 입실은 미감지가 아니다');
  });

  test('입실 시각과 같은 판정에서 들어온 것이 보이면 확인된 입실', () => {
    const [event] = run(new SuspicionTracker(), { sensorResult: entered, motionNow: true, now: CHECK_IN });
    assert.equal(event.data.entryConfirmed, true);
  });
});

describe('입실 확인 — 그날 자정까지', () => {
  test('체류로 바뀐 뒤 들어오면 입실 확인 1건(그때 체류 기기 제어) — 그 뒤 미감지 없음', () => {
    const t = new SuspicionTracker();
    run(t, { now: CHECK_IN });
    assert.equal(t.stayEntryConfirmed, false);
    assert.deepEqual(run(t, { roomState: OCCUPIED, now: CHECK_IN + 4 * HOUR }), [], '손님이 늦게 오는 것은 흔하다');
    assert.deepEqual(types(run(t, { roomState: OCCUPIED, sensorResult: entered, motionNow: true, now: CHECK_IN + 5 * HOUR })), ['checkin_confirmed']);
    assert.equal(t.stayEntryConfirmed, true);
    assert.deepEqual(run(t, { roomState: OCCUPIED, now: MIDNIGHT + 1 }), []);
  });

  test('자정까지 들어온 것이 보이지 않으면 입실 미감지 1건 — 발생 시각은 입실 시각', () => {
    const t = new SuspicionTracker();
    run(t, { now: CHECK_IN });
    assert.deepEqual(run(t, { roomState: OCCUPIED, now: MIDNIGHT - 1 }), []);
    const events = run(t, { roomState: OCCUPIED, now: MIDNIGHT });
    assert.deepEqual(types(events), ['checkin_not_detected']);
    assert.equal(events[0].timestamp, CHECK_IN);
    assert.equal(events[0].data.reservationUid, 'stay-1');
    assert.deepEqual(run(t, { roomState: OCCUPIED, now: MIDNIGHT + HOUR }), [], '예약당 한 번');
    assert.equal(t.stayEntryConfirmed, false, '확인되지 않은 체류는 체류 중 점검을 계속 쉰다');
  });

  test('자정은 한국 날짜로 — 밤 11시 30분 입실은 자정이 아니라 입실 + 1시간까지 기다린다', () => {
    const late = Date.parse('2026-11-24T14:30:00.000Z'); // 23:30 KST
    const t = new SuspicionTracker();
    run(t, { res: stay({ checkIn: new Date(late) }), now: late });
    assert.deepEqual(run(t, { roomState: OCCUPIED, res: stay({ checkIn: new Date(late) }), now: late + 59 * MIN }), []);
    assert.deepEqual(types(run(t, { roomState: OCCUPIED, res: stay({ checkIn: new Date(late) }), now: late + 60 * MIN })), ['checkin_not_detected']);
  });

  test('기다리는 중에 예약이 취소되거나 입실 시각이 바뀌면 판정하지 않는다', () => {
    for (const changed of [null, stay({ uid: 'stay-2' }), stay({ checkIn: new Date(CHECK_IN + HOUR) })]) {
      const t = new SuspicionTracker();
      run(t, { now: CHECK_IN });
      run(t, { roomState: OCCUPIED, res: changed, now: CHECK_IN + MIN });
      assert.equal(t.checkinWatch, null);
      assert.deepEqual(types(run(t, { roomState: OCCUPIED, res: changed, now: MIDNIGHT })).filter(type => type === 'checkin_not_detected'), []);
    }
  });

  test('퇴실 시각이 되면 입실 기다림을 끝내고 체류 중 점검 쉬기도 끝낸다', () => {
    const t = new SuspicionTracker();
    const short = stay({ checkOut: new Date(CHECK_IN + 2 * HOUR) });
    run(t, { res: short, now: CHECK_IN });
    assert.deepEqual(types(run(t, { roomState: OCCUPIED, res: short, now: CHECK_IN + 2 * HOUR })).slice(0, 1), ['scheduled_checkout_reached']);
    assert.equal(t.checkinWatch, null);
    assert.equal(t.stayEntryConfirmed, true);
  });
});

describe('확인할 수 없으면 단정하지 않고 운영자에게 (DEC-11·12)', () => {
  test('입실 시각에 감지 센서가 꺼져 있으면 확인 불가 1건 — 그 뒤 미감지로 적지 않는다', () => {
    const t = new SuspicionTracker();
    const events = run(t, { now: CHECK_IN, sensorsOff: OFF });
    assert.deepEqual(types(events), ['scheduled_checkin_reached', 'detection_unconfirmable']);
    assert.deepEqual([events[1].timestamp, events[1].data.phase, events[1].data.cause], [CHECK_IN, 'checkin', 'sensor_off']);
    assert.deepEqual(events[1].data.sensors, [{ entityId: 'binary_sensor.motion', roleLabel: '움직임 센서', name: '현관 움직임' }]);
    assert.deepEqual(run(t, { roomState: OCCUPIED, now: MIDNIGHT }), []);
  });

  test('자정에 센서가 꺼져 있으면 미감지 대신 확인 불가', () => {
    const t = new SuspicionTracker();
    run(t, { now: CHECK_IN });
    const events = run(t, { roomState: OCCUPIED, now: MIDNIGHT, sensorsOff: OFF });
    assert.deepEqual(types(events), ['detection_unconfirmable']);
    assert.equal(events[0].data.cause, 'sensor_off');
  });

  test('자정이 지나 처음 판정하면(감시가 멈춰 있었음) 체류로 바꾸고 확인 불가(not_observed)', () => {
    const events = run(new SuspicionTracker(), { now: MIDNIGHT + HOUR });
    assert.deepEqual(types(events), ['scheduled_checkin_reached', 'detection_unconfirmable']);
    assert.equal(events[1].data.cause, 'not_observed');
  });

  test('퇴실 시각에 센서가 꺼져 있으면 퇴실 확인 불가 — 지연을 기다리지 않는다', () => {
    const t = new SuspicionTracker();
    const res = stay({ checkIn: new Date(CHECK_IN - 20 * HOUR), checkOut: new Date(CHECK_IN) });
    const events = run(t, { roomState: OCCUPIED, res, now: CHECK_IN, sensorsOff: OFF });
    assert.deepEqual(types(events), ['scheduled_checkout_reached', 'detection_unconfirmable']);
    assert.deepEqual([events[0].data.exitConfirmed, events[1].data.phase], [false, 'checkout']);
    assert.deepEqual(run(t, { roomState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING' }, res, now: CHECK_IN + 30 * MIN }), []);
  });

  test('퇴실 확인 불가에는 마지막 사람 흔적을 함께 넘긴다', () => {
    const t = new SuspicionTracker();
    const res = stay({ checkIn: new Date(CHECK_IN - 20 * HOUR), checkOut: new Date(CHECK_IN) });
    const events = run(t, { roomState: OCCUPIED, res, now: CHECK_IN, sensorsOff: OFF,
      presenceEvidence: { at: CHECK_IN - MIN, name: '거실 욕실 스위치', entityId: 'switch.bathroom' } });
    assert.deepEqual(events[1].data.lastPresence, {
      at: new Date(CHECK_IN - MIN).toISOString(), name: '거실 욕실 스위치', entityId: 'switch.bathroom',
    });

    const old = new SuspicionTracker();
    const oldEvents = run(old, { roomState: OCCUPIED, res, now: CHECK_IN, sensorsOff: OFF,
      presenceEvidence: { at: CHECK_IN - 21 * HOUR, name: '이전 체류 스위치', entityId: 'switch.old' } });
    assert.equal(oldEvents[1].data.lastPresence, undefined, '현재 체류 전의 오래된 흔적은 붙이지 않는다');
  });

  test('움직임 센서가 꺼져도 대체 사람 신호가 있으면 입실은 확인 불가로 끝내지 않고 기다린다', () => {
    const t = new SuspicionTracker();
    const events = run(t, { now: CHECK_IN, sensorsOff: OFF, entrySensorsOff: [] });
    assert.deepEqual(types(events), ['scheduled_checkin_reached']);
    assert.ok(t.checkinWatch);
  });

  test('센서가 꺼져 있으면 "움직임 없음"은 퇴실 확인이 아니다', () => {
    const t = new SuspicionTracker();
    const res = stay({ checkIn: new Date(CHECK_IN - 20 * HOUR), checkOut: new Date(CHECK_IN) });
    run(t, { roomState: OCCUPIED, res, sensorResult: { ...none, exit: true, exitAt: CHECK_IN - HOUR }, now: CHECK_IN - HOUR });
    const [transition] = run(t, { roomState: OCCUPIED, res, now: CHECK_IN, sensorsOff: OFF });
    assert.equal(transition.data.exitConfirmed, false);
  });

  test('유예 끝에 센서가 꺼져 있으면 퇴실 지연 대신 확인 불가', () => {
    const t = new SuspicionTracker();
    const res = stay({ checkIn: new Date(CHECK_IN - 20 * HOUR), checkOut: new Date(CHECK_IN) });
    run(t, { roomState: OCCUPIED, res, now: CHECK_IN });
    const events = run(t, { roomState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING' }, res, now: CHECK_IN + 20 * MIN, sensorsOff: OFF });
    assert.deepEqual(types(events), ['detection_unconfirmable']);
    assert.equal(events[0].timestamp, CHECK_IN);
  });
});

describe('재시작해도 이어진다', () => {
  test('저장한 기다림을 되살리면 자정 판정이 그대로 된다', () => {
    const t = new SuspicionTracker();
    run(t, { now: CHECK_IN });
    const saved = JSON.parse(JSON.stringify(t.snapshot()));
    const restarted = new SuspicionTracker();
    restarted.restore(saved);
    assert.equal(restarted.stayEntryConfirmed, false);
    assert.deepEqual(run(restarted, { roomState: OCCUPIED, now: CHECK_IN + MIN }), []);
    assert.deepEqual(types(run(restarted, { roomState: OCCUPIED, now: MIDNIGHT })), ['checkin_not_detected']);
  });

  test('깨진 저장값은 버린다', () => {
    const t = new SuspicionTracker();
    t.restore({ scheduledCheckinKey: 3, checkinWatch: { checkInMs: 'x', deadline: 1, data: {} }, lateCheckoutWatch: { checkOutMs: 1 }, stayEntryConfirmed: 'no' });
    assert.deepEqual([t.scheduledCheckinKey, t.checkinWatch, t.lateCheckoutWatch, t.stayEntryConfirmed], [null, null, null, true]);
    t.restore(null);
    t.restore('broken');
  });
});

describe('리뷰에서 찾은 경우들', () => {
  const CLEANING_PENDING = { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING' };
  const exited = { ...none, exit: true, exitAt: null };

  test('자정이 지나 늦게 들어와도 입실로 확인한다 — 문제 기록은 그대로, 체류 기기 제어·체류 중 점검을 다시 시작', () => {
    const t = new SuspicionTracker();
    run(t, { now: CHECK_IN });
    assert.deepEqual(types(run(t, { roomState: OCCUPIED, now: MIDNIGHT })), ['checkin_not_detected']);
    const [late] = run(t, { roomState: OCCUPIED, sensorResult: entered, motionNow: true, now: MIDNIGHT + 90 * MIN });
    assert.deepEqual([late.type, late.data.reservationUid], ['checkin_confirmed', 'stay-1']);
    assert.equal(t.stayEntryConfirmed, true);
    assert.deepEqual(run(t, { roomState: OCCUPIED, sensorResult: entered, motionNow: true, now: MIDNIGHT + 3 * HOUR }), [], '한 번만');
  });

  test('입실 시각에 센서가 꺼져 확인 불가였어도, 나중에 들어온 것이 보이면 입실로 확인한다', () => {
    const t = new SuspicionTracker();
    run(t, { now: CHECK_IN, sensorsOff: OFF });
    assert.deepEqual(types(run(t, { roomState: OCCUPIED, sensorResult: entered, motionNow: true, now: CHECK_IN + 2 * HOUR })), ['checkin_confirmed']);
  });

  test('입실이 끝내 확인되지 않은 체류는 퇴실이 안 보여도 퇴실 지연이 아니라 확인 불가(not_entered) — 유예 안에 나가는 게 보이면 청소 모드', () => {
    const out = stay({ checkOut: new Date(CHECK_IN + 20 * HOUR) });
    const checkOut = CHECK_IN + 20 * HOUR;
    const t = new SuspicionTracker();
    run(t, { res: out, now: CHECK_IN });
    run(t, { roomState: OCCUPIED, res: out, now: MIDNIGHT });
    assert.deepEqual(types(run(t, { roomState: OCCUPIED, res: out, now: checkOut })), ['scheduled_checkout_reached']);
    const [problem] = run(t, { roomState: CLEANING_PENDING, res: out, now: checkOut + 20 * MIN });
    assert.deepEqual([problem.type, problem.data.cause, problem.timestamp], ['detection_unconfirmable', 'not_entered', checkOut]);
    const seen = new SuspicionTracker();
    run(seen, { res: out, now: CHECK_IN });
    run(seen, { roomState: OCCUPIED, res: out, now: MIDNIGHT });
    run(seen, { roomState: OCCUPIED, res: out, now: checkOut });
    assert.deepEqual(types(run(seen, { roomState: CLEANING_PENDING, res: out, sensorResult: exited, now: checkOut + 5 * MIN })), ['checkout_confirmed']);
  });

  test('청소 중에 입실 시각이 되면 청소 담당자가 나가는 것을 본 뒤에 들어온 사람만 손님으로 본다', () => {
    const t = new SuspicionTracker();
    const [transition] = run(t, { roomState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' }, sensorResult: entered, motionNow: true, now: CHECK_IN });
    assert.equal(transition.data.entryConfirmed, false, '그 순간 안에서 움직인 사람은 청소 담당자일 수 있다');
    assert.deepEqual(run(t, { roomState: OCCUPIED, sensorResult: entered, motionNow: true, now: CHECK_IN + 10 * MIN }), [], '나가는 것을 보기 전의 입장은 세지 않는다');
    assert.deepEqual(run(t, { roomState: OCCUPIED, sensorResult: exited, now: CHECK_IN + 30 * MIN }), []);
    assert.deepEqual(types(run(t, { roomState: OCCUPIED, sensorResult: entered, motionNow: true, now: CHECK_IN + 2 * HOUR })), ['checkin_confirmed']);
  });

  test('청소 대기인데 누가 들어와 있으면(청소 담당자) 같은 규칙, 아무도 없으면 들어온 사람을 바로 손님으로 본다', () => {
    const busy = new SuspicionTracker();
    run(busy, { roomState: CLEANING_PENDING, sensorResult: entered, motionNow: true, now: CHECK_IN - 10 * MIN }); // 청소 담당자 입장
    run(busy, { roomState: CLEANING_PENDING, motionNow: true, now: CHECK_IN });
    assert.deepEqual(run(busy, { roomState: OCCUPIED, sensorResult: entered, motionNow: true, now: CHECK_IN + 10 * MIN }), []);
    const empty = new SuspicionTracker();
    run(empty, { roomState: CLEANING_PENDING, now: CHECK_IN });
    assert.deepEqual(types(run(empty, { roomState: OCCUPIED, sensorResult: entered, motionNow: true, now: CHECK_IN + 10 * MIN })), ['checkin_confirmed']);
  });

  test('기다리는 중에 운영자가 상태를 바꾸면(정비·청소 시작) 그 판단을 따른다 — 자정·유예 끝에 문제를 내지 않는다', () => {
    const t = new SuspicionTracker();
    run(t, { now: CHECK_IN });
    run(t, { roomState: { mainStatus: 'VACANT', subStatus: 'MAINTENANCE' }, now: CHECK_IN + 4 * HOUR });
    assert.deepEqual(run(t, { roomState: { mainStatus: 'VACANT', subStatus: 'MAINTENANCE' }, now: MIDNIGHT }), []);
    assert.equal(t.stayEntryConfirmed, true);
    const res = stay({ checkIn: new Date(CHECK_IN - 20 * HOUR), checkOut: new Date(CHECK_IN) });
    const c = new SuspicionTracker();
    run(c, { roomState: OCCUPIED, res, now: CHECK_IN });
    assert.deepEqual(run(c, { roomState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' }, res, now: CHECK_IN + 20 * MIN }), []);
  });

  test('공실이어도 입실 2시간 안에 들어오면 조기 입실 — 그보다 이르면 운영자·청소일 수 있어 세지 않는다', () => {
    const VACANT = { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' };
    const near = new SuspicionTracker();
    assert.deepEqual(types(run(near, { roomState: VACANT, sensorResult: entered, motionNow: true, now: CHECK_IN - 90 * MIN })), ['early_checkin_suspected']);
    assert.equal(run(near, { roomState: VACANT, now: CHECK_IN })[0].data.entryConfirmed, true);
    const far = new SuspicionTracker();
    assert.deepEqual(run(far, { roomState: VACANT, sensorResult: entered, motionNow: true, now: CHECK_IN - 3 * HOUR }), []);
    assert.equal(run(far, { roomState: VACANT, now: CHECK_IN })[0].data.entryConfirmed, false);
  });

  test('다른 체류 때 본 조기 입실은 이번 입실로 쓰지 않는다', () => {
    const t = new SuspicionTracker();
    run(t, { res: stay({ uid: 'stay-0' }), sensorResult: entered, motionNow: true, now: CHECK_IN - 30 * MIN });
    assert.equal(run(t, { now: CHECK_IN })[0].data.entryConfirmed, false);
  });

  test('워처가 오래 꺼져 있다 켜지면 되살린 기다림을 끝까지 판정하지 않는다 — 퇴실 지연·입실 미감지 대신 확인 불가(not_observed)', () => {
    const t = new SuspicionTracker();
    run(t, { now: CHECK_IN });
    const restarted = new SuspicionTracker();
    restarted.restore(JSON.parse(JSON.stringify(t.snapshot())));
    assert.deepEqual(run(restarted, { roomState: OCCUPIED, now: CHECK_IN + 3 * HOUR }), [], '그동안 들어왔을 수 있다');
    const [problem] = run(restarted, { roomState: OCCUPIED, now: MIDNIGHT });
    assert.deepEqual([problem.type, problem.data.cause], ['detection_unconfirmable', 'not_observed']);

    const res = stay({ checkIn: new Date(CHECK_IN - 20 * HOUR), checkOut: new Date(CHECK_IN) });
    const c = new SuspicionTracker();
    run(c, { roomState: OCCUPIED, res, now: CHECK_IN });
    const back = new SuspicionTracker();
    back.restore(JSON.parse(JSON.stringify(c.snapshot())));
    const [out] = run(back, { roomState: CLEANING_PENDING, res, now: CHECK_IN + HOUR });
    assert.deepEqual([out.type, out.data.cause], ['detection_unconfirmable', 'not_observed']);
  });

  test('저장된 시각이 없는 기다림도 끝까지 판정하지 않는다', () => {
    const t = new SuspicionTracker();
    run(t, { now: CHECK_IN });
    const { observedAt, ...saved } = JSON.parse(JSON.stringify(t.snapshot()));
    const restarted = new SuspicionTracker();
    restarted.restore(saved);
    assert.equal(types(run(restarted, { roomState: OCCUPIED, now: MIDNIGHT }))[0], 'detection_unconfirmable');
  });

  test('입실 시각 전에 들어온 것을 본 뒤 재시작해도 입실 시각엔 확인된 입실이다', () => {
    const t = new SuspicionTracker();
    run(t, { sensorResult: entered, motionNow: true, now: CHECK_IN - 90 * MIN });
    const restarted = new SuspicionTracker();
    restarted.restore(JSON.parse(JSON.stringify(t.snapshot())));
    const [event] = run(restarted, { now: CHECK_IN });
    assert.equal(event.data.entryConfirmed, true);
  });

  test('예약 번호가 없는 체류도 퇴실 처리 뒤 늦은 연장으로 다시 입실하지 않는다', () => {
    const noUid = { checkIn: new Date(CHECK_IN - 20 * HOUR), checkOut: new Date(CHECK_IN) };
    const t = new SuspicionTracker();
    run(t, { roomState: OCCUPIED, res: noUid, sensorResult: exited, now: CHECK_IN });
    const extended = { ...noUid, checkOut: new Date(CHECK_IN + 6 * HOUR) };
    assert.deepEqual(run(t, { roomState: CLEANING_PENDING, res: extended, now: CHECK_IN + HOUR }), []);
  });
});

describe('들어온 것이 확인되기 전엔 체류 중 점검을 쉰다', () => {
  const snap = overrides => ({
    acMode: null, acPower: 300, acTemp: null, acHumidity: null, smokeDetected: false, outdoorTemp: 15, outdoorHumidity: 50,
    indoorTemps: [{ val: 22, label: '거실' }], indoorHumidities: [{ val: 50, label: '거실' }],
    doorOpen: false, motionDetected: false, noiseLevel: null, outdoorTempSource: 'ha', ...overrides,
  });
  const call = (m, s, roomState, now) => m.process({ snap: s, roomState, reservation: stay(), now });

  test('입실 준비로 켜 둔 에어컨이 빈방에서 "체류 중 에너지 낭비"로 잡히지 않는다 — 연기는 그대로 잡는다', () => {
    const m = new OccupancyMonitor();
    call(m, snap(), OPTIMIZED, CHECK_IN);
    for (let t = 1; t <= 30; t++) assert.deepEqual(call(m, snap(), OCCUPIED, CHECK_IN + t * MIN).filter(e => e.type === 'energy_waste_detected'), []);
    assert.deepEqual(types(call(m, snap({ smokeDetected: true }), OCCUPIED, CHECK_IN + 31 * MIN)), ['complaint_detected']);
  });

  test('들어온 것이 확인된 뒤엔 다시 점검한다', () => {
    const m = new OccupancyMonitor();
    m.restore({ stayEntryConfirmed: true });
    const s = snap();
    call(m, snap({ motionDetected: true }), OCCUPIED, 0);
    let found = false;
    for (let t = 1; t <= 30 && !found; t++) found = call(m, s, OCCUPIED, t * MIN).some(e => e.type === 'energy_waste_detected');
    assert.ok(found);
  });
});
