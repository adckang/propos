/**
 * S15 SensorEventGenerator 단위 테스트
 * node --test tests/unit/s15.sensor-event.test.js
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SensorEventGenerator } from '../../src/application/sensorEventGenerator.js';

const MIN = 60_000;

const CFG = {
  EXIT_LOOKBACK_MS:   10 * MIN,
  EXIT_NO_MOTION_MS:   5 * MIN,
  ENTRY_SUSTAINED_MS:  3 * MIN,
};

function gen() { return new SensorEventGenerator(); }

function snap(doorOpen, motionDetected) {
  return { doorOpen: !!doorOpen, motionDetected: !!motionDetected };
}

// ============================================================
// EXIT 감지
// ============================================================
describe('EXIT 감지', () => {
  test('정상 퇴실 시퀀스: 모션→문열림닫힘→5분 모션없음 → exit=true', () => {
    const g = gen();
    // t=0: 모션 ON
    g.update(snap(false, true), 0, CFG);
    // t=1min: 문 열림 (rising)
    g.update(snap(true, false), 1 * MIN, CFG);
    // t=2min: 문 닫힘 (falling) → exitPendingAt=2min
    g.update(snap(false, false), 2 * MIN, CFG);
    // t=4min: 모션 없음 지속
    g.update(snap(false, false), 4 * MIN, CFG);
    // t=7min: 문닫힘(2min)+5min = 7min → exit 확정
    const result = g.update(snap(false, false), 7 * MIN + 1, CFG);
    assert.equal(result.exit, true, 'exit=true 이어야 함');
    assert.ok(result.exitAt !== null, 'exitAt이 있어야 함');
  });

  test('EXIT 조건①: 모션 없이 문열림닫힘 → exit 없음 (아무도 없었음)', () => {
    const g = gen();
    // 모션 없이 문이 열렸다 닫힘
    g.update(snap(false, false), 0, CFG);
    g.update(snap(true,  false), 1 * MIN, CFG);
    g.update(snap(false, false), 2 * MIN, CFG);
    const result = g.update(snap(false, false), 8 * MIN, CFG);
    assert.equal(result.exit, false, 'exit=false 이어야 함 (모션 없이 문만 열림닫힘)');
  });

  test('EXIT 취소: 문닫힘 후 모션 재감지 → exit 없음', () => {
    const g = gen();
    g.update(snap(false, true),  0, CFG);         // 모션 ON
    g.update(snap(true,  false), 1 * MIN, CFG);   // 문 열림
    g.update(snap(false, false), 2 * MIN, CFG);   // 문 닫힘 → exitPending
    g.update(snap(false, true),  3 * MIN, CFG);   // 모션 재감지 → EXIT 취소!
    const result = g.update(snap(false, false), 8 * MIN, CFG);
    assert.equal(result.exit, false, 'exit=false 이어야 함 (복귀로 취소됨)');
  });

  test('EXIT_LOOKBACK 초과: 모션이 10분 전 → motionBeforeDoor=false → exit 없음', () => {
    const g = gen();
    g.update(snap(false, true),  0, CFG);          // t=0: 모션 ON
    g.update(snap(false, false), 1 * MIN, CFG);    // t=1: 모션 OFF
    // t=12min: EXIT_LOOKBACK(10min) 초과 후 문 열림
    g.update(snap(true,  false), 12 * MIN, CFG);   // 12min - 0 = 12min > 10min → motionBeforeDoor=false
    g.update(snap(false, false), 13 * MIN, CFG);   // 문 닫힘 → exitPendingAt은 설정 안 됨
    const result = g.update(snap(false, false), 19 * MIN, CFG);
    assert.equal(result.exit, false, 'exit=false 이어야 함 (lookback 초과)');
  });

  test('EXIT 5분 미만 → 아직 exit 없음', () => {
    const g = gen();
    g.update(snap(false, true),  0, CFG);
    g.update(snap(true,  false), 1 * MIN, CFG);
    g.update(snap(false, false), 2 * MIN, CFG);
    const result = g.update(snap(false, false), 6 * MIN - 1, CFG);  // 4min < 5min
    assert.equal(result.exit, false);
  });
});

// ============================================================
// ENTRY 감지
// ============================================================
describe('ENTRY 감지', () => {
  test('정상 입실 시퀀스: 문열림닫힘→모션→3분 지속 → entry=true', () => {
    const g = gen();
    // t=0: 문 열림
    g.update(snap(true,  false), 0, CFG);
    // t=1min: 문 닫힘 → entryPendingAt=1min
    g.update(snap(false, false), 1 * MIN, CFG);
    // t=1min+1: 모션 감지 → firstMotionAfterClose=1min+1
    g.update(snap(false, true),  1 * MIN + 1, CFG);
    // t=4min+2: 모션 3분 지속 → entry 확정
    const result = g.update(snap(false, true), 4 * MIN + 2, CFG);
    assert.equal(result.entry, true, 'entry=true 이어야 함');
    assert.ok(result.entryAt !== null, 'entryAt이 있어야 함');
  });

  test('ENTRY 취소: 모션이 3분 전에 끊기면 entry 없음', () => {
    const g = gen();
    g.update(snap(true,  false), 0, CFG);          // 문 열림
    g.update(snap(false, false), 1 * MIN, CFG);    // 문 닫힘
    g.update(snap(false, true),  1 * MIN + 1, CFG);// 모션 감지
    g.update(snap(false, false), 2 * MIN, CFG);    // 모션 끊김
    // 5분 지나면 ENTRY 취소
    const result = g.update(snap(false, false), 7 * MIN, CFG);
    assert.equal(result.entry, false, 'entry=false 이어야 함 (모션 끊겨서 취소)');
  });

  test('문 열림만, 닫힘 없음 → entry 없음', () => {
    const g = gen();
    g.update(snap(true, false), 0, CFG);   // 문 열림 (문이 계속 열려있음)
    const result = g.update(snap(true, true), 5 * MIN, CFG);
    assert.equal(result.entry, false, 'entry=false 이어야 함 (문닫힘 없음)');
  });

  test('문닫힘 후 모션 없음 → entry 없음 (아무도 안 들어옴)', () => {
    const g = gen();
    g.update(snap(true,  false), 0, CFG);
    g.update(snap(false, false), 1 * MIN, CFG);
    const result = g.update(snap(false, false), 10 * MIN, CFG);
    assert.equal(result.entry, false, 'entry=false 이어야 함');
  });

  test('ENTRY 3분 미만 → 아직 entry 없음', () => {
    const g = gen();
    g.update(snap(true,  false), 0, CFG);
    g.update(snap(false, false), 1 * MIN, CFG);
    g.update(snap(false, true),  1 * MIN + 1, CFG);
    const result = g.update(snap(false, true), 3 * MIN, CFG);  // 2min < 3min
    assert.equal(result.entry, false);
  });
});

// ============================================================
// EXIT 후 재입실 시퀀스
// ============================================================
describe('EXIT 후 재입실', () => {
  test('EXIT 확정 후 새 ENTRY → 두 이벤트 모두 독립적으로 감지', () => {
    const g = gen();

    // EXIT 시퀀스
    g.update(snap(false, true),  0, CFG);
    g.update(snap(true,  false), 1 * MIN, CFG);
    const r1 = g.update(snap(false, false), 2 * MIN, CFG);
    // ...5분 기다림...
    const exitResult = g.update(snap(false, false), 7 * MIN + 1, CFG);
    assert.equal(exitResult.exit, true, '첫 번째 EXIT');

    // 새 ENTRY 시퀀스 시작
    g.update(snap(true,  false), 10 * MIN, CFG);
    g.update(snap(false, false), 11 * MIN, CFG);
    g.update(snap(false, true),  11 * MIN + 1, CFG);
    const entryResult = g.update(snap(false, true), 14 * MIN + 2, CFG);
    assert.equal(entryResult.entry, true, '재입실 ENTRY');
  });
});

// ============================================================
// 에지 케이스
// ============================================================
describe('에지 케이스', () => {
  test('초기 상태 — 아무 이벤트 없음', () => {
    const g = gen();
    const result = g.update(snap(false, false), 0, CFG);
    assert.equal(result.exit, false);
    assert.equal(result.entry, false);
  });

  test('doorOpen=true 여러 폴링 후 닫힘 → 한 번만 falling edge', () => {
    const g = gen();
    g.update(snap(true, true),  0, CFG);         // 문 열림 시작 (모션 있음)
    g.update(snap(true, true),  30_000, CFG);    // 문 아직 열림
    g.update(snap(true, false), 60_000, CFG);    // 모션 없어짐
    // 문 닫힘
    const result = g.update(snap(false, false), 2 * MIN, CFG);
    // exitPendingAt=2min, 아직 5분 안지남
    assert.equal(result.exit, false, '5분 지나지 않아 exit 없음');
    assert.equal(result.entry, false);
  });
});
