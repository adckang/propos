/**
 * S14 OccupancyMonitor 단위 테스트
 * node --test tests/unit/s14.occupancy-monitor.test.js
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { OccupancyMonitor } from '../../src/application/occupancyMonitor.js';

const MIN = 60_000;

// ── 상태 상수 ──────────────────────────────────────────────────────────────
const VACANT      = { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED' };
const GOOD        = { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' };
const ENERGY      = { mainStatus: 'OCCUPIED', subStatus: 'ENERGY_WASTE' };
const COMPLAINT   = { mainStatus: 'OCCUPIED', subStatus: 'ISSUE_COMPLAINT' };

// ── 기본 스냅샷 팩토리 ─────────────────────────────────────────────────────
function snap(overrides = {}) {
  return {
    acMode: null, acPower: null, acTemp: null, acHumidity: null,
    smokeDetected: false,
    outdoorTemp: 15, outdoorHumidity: 50,
    indoorTemps:       [{ val: 22, label: '거실' }],
    indoorHumidities:  [{ val: 50, label: '거실' }],
    doorOpen: false, motionDetected: true,
    noiseLevel: null,
    outdoorTempSource: 'ha',
    ...overrides,
  };
}

const PRE_STAY_OPTIMIZING = { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING' };
const PRE_STAY_OPTIMIZED  = { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED' };

function reservation(checkOutMs) {
  return { checkOut: new Date(checkOutMs) };
}

// ── 헬퍼: process 한 번 호출 ──────────────────────────────────────────────
function call(m, s, roomState, res = null, now = 0) {
  return m.process({ snap: s, roomState, reservation: res, now });
}

// ============================================================
// 기본 동작
// ============================================================
describe('기본 동작', () => {
  test('VACANT 상태에서는 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    assert.deepEqual(call(m, snap(), VACANT), []);
  });

  test('OCCUPIED 정상 상태 + 이상 없음 → 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    assert.deepEqual(call(m, snap(), GOOD), []);
  });
});

// ============================================================
// 연기 감지
// ============================================================
describe('연기 감지', () => {
  test('smokeDetected ON → complaint_detected (smoke, CRITICAL)', () => {
    const m = new OccupancyMonitor();
    const events = call(m, snap({ smokeDetected: true }), GOOD);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'complaint_detected');
    assert.equal(events[0].subType, 'smoke');
    assert.equal(events[0].severity, 'CRITICAL');
  });

  test('연기 ON 후 OFF → complaint_resolved', () => {
    const m = new OccupancyMonitor();
    call(m, snap({ smokeDetected: true }), GOOD, null, 0);
    const events = call(m, snap({ smokeDetected: false }), COMPLAINT, null, 1000);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'complaint_resolved');
    assert.equal(events[0].subType, 'smoke');
  });

  test('연기 OFF 상태 유지 → 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    assert.deepEqual(call(m, snap({ smokeDetected: false }), GOOD), []);
  });
});

// ============================================================
// 환경 이상 (온습도)
// ============================================================
describe('환경 이상', () => {
  test('여름 고온(29°C) 3분 이전 → 아직 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    const s = snap({ outdoorTemp: 25, indoorTemps: [{ val: 29, label: '거실' }] });
    call(m, s, GOOD, null, 0);
    const events = call(m, s, GOOD, null, 2 * MIN);
    assert.equal(events.filter(e => e.type === 'complaint_detected').length, 0);
  });

  test('여름 고온(29°C) 3분 지속 → complaint_detected (environment)', () => {
    const m = new OccupancyMonitor();
    const s = snap({ outdoorTemp: 25, indoorTemps: [{ val: 29, label: '거실' }] });
    call(m, s, GOOD, null, 0);
    call(m, s, GOOD, null, 1 * MIN);
    call(m, s, GOOD, null, 2 * MIN);
    const events = call(m, s, GOOD, null, 3 * MIN + 1);
    const ev = events.find(e => e.type === 'complaint_detected' && e.subType === 'environment');
    assert.ok(ev, 'environment 이벤트 있어야 함');
  });

  test('여름 과습(70%) 3분 지속 → complaint_detected', () => {
    const m = new OccupancyMonitor();
    const s = snap({ outdoorTemp: 25, indoorHumidities: [{ val: 70, label: '거실' }] });
    call(m, s, GOOD, null, 0);
    call(m, s, GOOD, null, MIN);
    call(m, s, GOOD, null, 2 * MIN);
    const events = call(m, s, GOOD, null, 3 * MIN + 1);
    assert.ok(events.some(e => e.type === 'complaint_detected' && e.subType === 'environment'));
  });

  test('겨울 저온(15°C) 3분 지속 → complaint_detected', () => {
    const m = new OccupancyMonitor();
    const s = snap({ outdoorTemp: 5, indoorTemps: [{ val: 15, label: '거실' }] });
    call(m, s, GOOD, null, 0);
    call(m, s, GOOD, null, MIN);
    call(m, s, GOOD, null, 2 * MIN);
    const events = call(m, s, GOOD, null, 3 * MIN + 1);
    assert.ok(events.some(e => e.type === 'complaint_detected' && e.subType === 'environment'));
  });

  test('이슈 후 정상 5분 지속 → complaint_resolved', () => {
    const m = new OccupancyMonitor();
    const hot  = snap({ outdoorTemp: 25, indoorTemps: [{ val: 29, label: '거실' }] });
    const norm = snap({ outdoorTemp: 25, indoorTemps: [{ val: 23, label: '거실' }] });
    // 이슈 감지 유발
    call(m, hot, GOOD,      null, 0);
    call(m, hot, GOOD,      null, 3 * MIN + 1);
    // 정상 복귀 후 5분
    call(m, norm, COMPLAINT, null, 3 * MIN + 2);
    call(m, norm, COMPLAINT, null, 4 * MIN + 2);
    call(m, norm, COMPLAINT, null, 5 * MIN + 2);
    const events = call(m, norm, COMPLAINT, null, 8 * MIN + 3);
    assert.ok(events.some(e => e.type === 'complaint_resolved'));
  });
});

// ============================================================
// 에너지 낭비 — 전력 센서 있음
// ============================================================
describe('에너지 낭비 (전력 센서)', () => {
  test('모션 있음 + AC 가동 → 에너지 낭비 아님', () => {
    const m = new OccupancyMonitor();
    const s = snap({ motionDetected: true, acPower: 300 });
    for (let t = 0; t <= 20 * MIN; t += MIN) call(m, s, GOOD, null, t);
    const events = call(m, s, GOOD, null, 21 * MIN);
    assert.equal(events.filter(e => e.type === 'energy_waste_detected').length, 0);
  });

  test('모션 없음 15분 + AC 가동 3분 지속 → energy_waste_detected', () => {
    const m = new OccupancyMonitor();
    const withMotion    = snap({ motionDetected: true,  acPower: 300 });
    const withoutMotion = snap({ motionDetected: false, acPower: 300 });

    call(m, withMotion,    GOOD, null, 0);
    call(m, withoutMotion, GOOD, null, 1);          // noMotionStart=1

    // 15분 후: 외출 확정
    call(m, withoutMotion, GOOD, null, 15 * MIN + 1);

    // 추가 3분 지속 → energy_waste_detected
    call(m, withoutMotion, GOOD, null, 16 * MIN + 1);
    call(m, withoutMotion, GOOD, null, 17 * MIN + 1);
    const events = call(m, withoutMotion, GOOD, null, 18 * MIN + 2);
    assert.ok(events.some(e => e.type === 'energy_waste_detected'), 'energy_waste_detected 있어야 함');
  });

  test('고전력(600W) 3분 지속 → energy_waste_detected', () => {
    const m = new OccupancyMonitor();
    const s = snap({ acPower: 600 }); // > AC_HIGH(500)
    call(m, s, GOOD, null, 0);
    call(m, s, GOOD, null, MIN);
    call(m, s, GOOD, null, 2 * MIN);
    const events = call(m, s, GOOD, null, 3 * MIN + 1);
    assert.ok(events.some(e => e.type === 'energy_waste_detected'));
  });

  test('에너지낭비 해소 5분 지속 → energy_waste_resolved', () => {
    const m = new OccupancyMonitor();
    const waste  = snap({ acPower: 600 });
    const normal = snap({ acPower: 10 });
    // 낭비 감지
    call(m, waste, GOOD,   null, 0);
    call(m, waste, GOOD,   null, 3 * MIN + 1);
    // 정상 복귀 5분 지속
    call(m, normal, ENERGY, null, 3 * MIN + 2);
    call(m, normal, ENERGY, null, 4 * MIN + 2);
    call(m, normal, ENERGY, null, 5 * MIN + 2);
    call(m, normal, ENERGY, null, 7 * MIN + 2);
    const events = call(m, normal, ENERGY, null, 8 * MIN + 3);
    assert.ok(events.some(e => e.type === 'energy_waste_resolved'));
  });
});

// ============================================================
// 에너지 낭비 — 전력 센서 없음 (fallback)
// ============================================================
describe('에너지 낭비 (fallback 추정)', () => {
  test('여름 + 실내(17°C) << 실외(30°C) 3분 → energy_waste_detected (추정)', () => {
    const m = new OccupancyMonitor();
    // outdoorTemp=30 → summer / indoorTemp=17 < SUM_TEMP_MIN(21) / diff=13 > FALLBACK_SUMMER_DIFF(4)
    const s = snap({ outdoorTemp: 30, indoorTemps: [{ val: 17, label: '거실' }], acPower: null });
    call(m, s, GOOD, null, 0);
    call(m, s, GOOD, null, MIN);
    call(m, s, GOOD, null, 2 * MIN);
    const events = call(m, s, GOOD, null, 3 * MIN + 1);
    const ev = events.find(e => e.type === 'energy_waste_detected');
    assert.ok(ev, 'energy_waste_detected 있어야 함');
    assert.ok(ev.reason.startsWith('⚠'), '추정 모드 표시 있어야 함');
  });

  test('겨울 + 실내(33°C) >> 실외(5°C) 3분 → energy_waste_detected (추정)', () => {
    const m = new OccupancyMonitor();
    // outdoorTemp=5 → winter / indoorTemp=33 > WIN_TEMP_MAX(26) / diff=28 > FALLBACK_WINTER_DIFF(6)
    const s = snap({ outdoorTemp: 5, indoorTemps: [{ val: 33, label: '거실' }], acPower: null });
    call(m, s, GOOD, null, 0);
    call(m, s, GOOD, null, MIN);
    call(m, s, GOOD, null, 2 * MIN);
    const events = call(m, s, GOOD, null, 3 * MIN + 1);
    const ev = events.find(e => e.type === 'energy_waste_detected');
    assert.ok(ev, 'energy_waste_detected 있어야 함');
    assert.ok(ev.reason.startsWith('⚠'), '추정 모드 표시 있어야 함');
  });

  test('전력센서 없음 + 정상 온도차 → 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    const s = snap({ outdoorTemp: 25, indoorTemps: [{ val: 23, label: '거실' }], acPower: null });
    for (let t = 0; t <= 5 * MIN; t += MIN) call(m, s, GOOD, null, t);
    const events = call(m, s, GOOD, null, 6 * MIN);
    assert.equal(events.filter(e => e.type === 'energy_waste_detected').length, 0);
  });
});

// ============================================================
// 장시간 문 열림
// ============================================================
describe('장시간 문 열림', () => {
  test('문 열림 15분 이전 → 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    const s = snap({ doorOpen: true });
    call(m, s, GOOD, null, 0);
    const events = call(m, s, GOOD, null, 14 * MIN);
    assert.equal(events.filter(e => e.subType === 'door_open').length, 0);
  });

  test('문 열림 15분 지속 → complaint_detected (door_open)', () => {
    const m = new OccupancyMonitor();
    const s = snap({ doorOpen: true });
    call(m, s, GOOD, null, 0);
    call(m, s, GOOD, null, 7 * MIN);
    const events = call(m, s, GOOD, null, 15 * MIN + 1);
    assert.ok(events.some(e => e.type === 'complaint_detected' && e.subType === 'door_open'));
  });

  test('문 닫혀 있으면 doorOpen이 null이어도 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    const s = snap({ doorOpen: false });
    for (let t = 0; t <= 30 * MIN; t += MIN) call(m, s, GOOD, null, t);
    const events = call(m, s, GOOD, null, 31 * MIN);
    assert.equal(events.filter(e => e.subType === 'door_open').length, 0);
  });
});

// ============================================================
// 퇴실 감지
// ============================================================
describe('퇴실 감지', () => {
  test('유예 기간(20분) 이내 → 퇴실 감지 없음', () => {
    const baseNow = 0;
    const m = new OccupancyMonitor();
    const res = reservation(baseNow + 1);          // 지금 바로 체크아웃 시각

    call(m, snap({ motionDetected: false }), GOOD, res, 0);
    const events = call(m, snap({ motionDetected: false }), GOOD, res, 15 * MIN);
    assert.equal(events.filter(e => e.type === 'check_out_detected').length, 0);
  });

  test('유예 후 모션 없음 15분 → check_out_detected', () => {
    const baseNow = 0;
    const m = new OccupancyMonitor();
    const res = reservation(baseNow + 1);

    // t=0: 모션 있음 (초기 상태 리셋)
    call(m, snap({ motionDetected: true }),  GOOD, res, 0);
    // t=1: 모션 없어짐 → noMotionStart=1
    call(m, snap({ motionDetected: false }), GOOD, res, 1);
    // 유예 20분 + 모션없음 15분 = 35분 이후 감지
    const events = call(m, snap({ motionDetected: false }), GOOD, res, 35 * MIN + 2);
    assert.ok(events.some(e => e.type === 'check_out_detected'), 'check_out_detected 있어야 함');
  });

  test('모션 있으면 유예 후에도 퇴실 감지 안 됨', () => {
    const baseNow = 0;
    const m = new OccupancyMonitor();
    const res = reservation(baseNow + 1);

    // 모션 유지
    for (let t = 0; t <= 40 * MIN; t += 5 * MIN)
      call(m, snap({ motionDetected: true }), GOOD, res, t);

    const events = call(m, snap({ motionDetected: true }), GOOD, res, 40 * MIN + 1);
    assert.equal(events.filter(e => e.type === 'check_out_detected').length, 0);
  });

  test('예약 없으면 퇴실 감지 없음', () => {
    const m = new OccupancyMonitor();
    call(m, snap({ motionDetected: false }), GOOD, null, 0);
    const events = call(m, snap({ motionDetected: false }), GOOD, null, 60 * MIN);
    assert.equal(events.filter(e => e.type === 'check_out_detected').length, 0);
  });
});

// ============================================================
// 소음 민원 (슬라이딩 윈도우 10분, 가중치 점수)
// ============================================================
describe('소음 민원 감지', () => {
  test('소음 없음(50dB) → 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    const events = call(m, snap({ noiseLevel: 50 }), GOOD, null, 0);
    assert.deepEqual(events.filter(e => e.subType === 'noise'), []);
  });

  test('CRITICAL(90dB) 1회 → score 8 → complaint_detected (CRITICAL)', () => {
    const m = new OccupancyMonitor();
    const events = call(m, snap({ noiseLevel: 90 }), GOOD, null, 0);
    const ev = events.find(e => e.type === 'complaint_detected' && e.subType === 'noise');
    assert.ok(ev, 'complaint_detected(noise) 이벤트 없음');
    assert.equal(ev.severity, 'CRITICAL');
  });

  test('HIGH(80dB) 3회 → score 9 → complaint_detected (HIGH)', () => {
    const m = new OccupancyMonitor();
    // 3회 모두 10분 윈도우 안
    call(m, snap({ noiseLevel: 80 }), GOOD, null, 0);
    call(m, snap({ noiseLevel: 80 }), GOOD, null, 30_000);
    const events = call(m, snap({ noiseLevel: 80 }), GOOD, null, 60_000);
    const ev = events.find(e => e.type === 'complaint_detected' && e.subType === 'noise');
    assert.ok(ev, 'complaint_detected(noise) 이벤트 없음');
    assert.equal(ev.severity, 'HIGH');
  });

  test('WARN(70dB) 8회 → score 8 → complaint_detected (WARN)', () => {
    const m = new OccupancyMonitor();
    let events = [];
    for (let i = 0; i < 8; i++) {
      events = call(m, snap({ noiseLevel: 70 }), GOOD, null, i * 30_000);
    }
    const ev = events.find(e => e.type === 'complaint_detected' && e.subType === 'noise');
    assert.ok(ev, 'complaint_detected(noise) 이벤트 없음');
    assert.equal(ev.severity, 'WARN');
  });

  test('임계값 미달(7점) → 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    // HIGH(80dB) 2회 = score 6 → 미달
    call(m, snap({ noiseLevel: 80 }), GOOD, null, 0);
    const events = call(m, snap({ noiseLevel: 80 }), GOOD, null, 30_000);
    assert.deepEqual(events.filter(e => e.subType === 'noise'), []);
  });

  test('소음 감지 후 10분간 침묵 → complaint_resolved', () => {
    const m = new OccupancyMonitor();
    // t=0: CRITICAL(90dB) → complaint_detected (noisy 항목이 윈도우에 들어옴)
    call(m, snap({ noiseLevel: 90 }), GOOD, null, 0);
    // t=10min+1ms: 노이즈 항목이 윈도우 밖으로 밀려남 → score=0 → 침묵 타이머 시작
    call(m, snap({ noiseLevel: 50 }), COMPLAINT, null, 10 * 60_000 + 1);
    // t=20min+1ms: 침묵 10분 경과 → complaint_resolved
    const events = call(m, snap({ noiseLevel: 50 }), COMPLAINT, null, 20 * 60_000 + 1);
    const ev = events.find(e => e.type === 'complaint_resolved' && e.subType === 'noise');
    assert.ok(ev, 'complaint_resolved(noise) 이벤트 없음');
  });

  test('ISSUE_COMPLAINT 상태에서 소음 재발 → 이벤트 없음 (중복 방지)', () => {
    const m = new OccupancyMonitor();
    const events = call(m, snap({ noiseLevel: 90 }), COMPLAINT, null, 0);
    assert.deepEqual(events.filter(e => e.type === 'complaint_detected' && e.subType === 'noise'), []);
  });

  test('10분 윈도우 밖 측정값은 점수에서 제외된다', () => {
    const m = new OccupancyMonitor();
    // HIGH(80dB) 3회를 11분 간격으로 → 첫 측정값이 윈도우 밖으로 밀려남
    call(m, snap({ noiseLevel: 80 }), GOOD, null, 0);
    call(m, snap({ noiseLevel: 80 }), GOOD, null, 11 * 60_000);
    const events = call(m, snap({ noiseLevel: 80 }), GOOD, null, 22 * 60_000);
    // 윈도우(10분) 안에 2회만 남음 → score 6 → 미달
    assert.deepEqual(events.filter(e => e.subType === 'noise'), []);
  });
});

// ============================================================
// 체크인 감지 (PRE_STAY_READY/OPTIMIZED → check_in_detected)
// ============================================================
describe('체크인 감지', () => {
  test('PRE_STAY_READY/OPTIMIZED + 모션 감지 → check_in_detected', () => {
    const m = new OccupancyMonitor();
    const events = call(m, snap({ motionDetected: true }), PRE_STAY_OPTIMIZED, null, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'check_in_detected');
  });

  test('PRE_STAY_READY/OPTIMIZED + 도어 열림 → check_in_detected', () => {
    const m = new OccupancyMonitor();
    const events = call(m, snap({ motionDetected: false, doorOpen: true }), PRE_STAY_OPTIMIZED, null, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'check_in_detected');
  });

  test('PRE_STAY_READY/OPTIMIZED + 모션·도어 없음 → 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    const events = call(m, snap({ motionDetected: false, doorOpen: false }), PRE_STAY_OPTIMIZED, null, 0);
    assert.deepEqual(events, []);
  });

  test('PRE_STAY_READY/OPTIMIZING 상태에서는 모션 감지해도 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    const events = call(m, snap({ motionDetected: true }), PRE_STAY_OPTIMIZING, null, 0);
    assert.deepEqual(events, []);
  });
});

// ============================================================
// 복합 시나리오
// ============================================================
describe('복합 시나리오', () => {
  test('VACANT 상태에서는 모션·도어 추적만, 이벤트 없음', () => {
    const m = new OccupancyMonitor();
    const s = snap({ smokeDetected: true, acPower: 600, doorOpen: true, motionDetected: false });
    const events = call(m, s, VACANT);
    assert.deepEqual(events, []);
  });

  test('동일 타임스탬프 연속 호출 — 타이머 중복 발화 없음', () => {
    const m = new OccupancyMonitor();
    const s = snap({ smokeDetected: true });
    const e1 = call(m, s, GOOD, null, 0);
    const e2 = call(m, s, COMPLAINT, null, 0);  // smoke already lastSmoke=true, no re-fire
    assert.equal(e1.filter(e => e.type === 'complaint_detected').length, 1);
    assert.equal(e2.filter(e => e.type === 'complaint_detected').length, 0);
  });
});
