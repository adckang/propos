'use strict';

/**
 * UC-001 기능 테스트 (S01 D-1 자동화)
 * 수용 기준: 시퀀스 다이어그램 propos-scenario01-sequence.uml 기준
 *
 * TC-F-001  정상 흐름 — 단일 숙소 전체 성공
 * TC-F-002  정상 흐름 — 복수 숙소 전체 성공
 * TC-F-003  실행 순서 검증 — setLockCode → sendMessage → activateScene
 * TC-F-004  대상 없음 — 익일 체크인 예약 없으면 빈 배열 반환
 * TC-F-005  예외: 도어락 등록 실패 → status=failed, 나머지 숙소 계속 처리
 * TC-F-006  예외: 메시지 발송 실패 → status=partial, 스마트홈은 계속 실행
 * TC-F-007  예외: 스마트홈 초기화 실패 → status=partial, pin/message는 성공
 * TC-F-008  알림 — 성공 시 info 알림 생성
 * TC-F-009  알림 — 도어락 실패 시 error 알림 생성
 * TC-F-010  알림 — 복수 실패 시 숙소별 독립 알림
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { runD1Automation } = require('../../src/application/checkinPreparationService.js');

// ============================================================
// 공통 픽스처
// ============================================================

const TODAY = '2026-03-27';

const BOOKINGS = [
  {
    propId:    'P-042',
    propName:  '해운대 오션뷰 펜트하우스',
    guestName: '김민준',
    guestId:   'guest_001',
    checkIn:   '2026-03-28T15:00:00',
    checkOut:  '2026-03-30T11:00:00',
    status:    'confirmed',
    pinRequired: true,
    wifi:      { ssid: 'ProposGuest_5G', pw: '1234567890' },
  },
  {
    propId:    'P-007',
    propName:  '강남 럭셔리 스위트',
    guestName: '이수진',
    guestId:   'guest_002',
    checkIn:   '2026-03-28T14:00:00',
    checkOut:  '2026-03-29T11:00:00',
    status:    'confirmed',
    pinRequired: true,
    wifi:      { ssid: 'ProposGuest_7', pw: 'abcde12345' },
  },
  // 오늘 체크인 (제외 대상)
  {
    propId:    'P-099',
    propName:  '제주 바다뷰',
    guestName: '박지호',
    guestId:   'guest_003',
    checkIn:   '2026-03-27T15:00:00',
    checkOut:  '2026-03-29T11:00:00',
    status:    'confirmed',
    pinRequired: true,
    wifi:      { ssid: 'Jeju_5G', pw: 'jeju1234' },
  },
];

/**
 * 모든 deps가 성공하는 기본 mock 생성
 */
function makeDeps(overrides = {}) {
  const calls = { setLockCode: [], sendMessage: [], activateScene: [], addAlert: [] };

  return {
    setLockCode:   overrides.setLockCode   ?? (async (id, code, name) => { calls.setLockCode.push({ id, code, name }); }),
    sendMessage:   overrides.sendMessage   ?? (async (guestId, text)  => { calls.sendMessage.push({ guestId, text }); }),
    activateScene: overrides.activateScene ?? (async (id)             => { calls.activateScene.push({ id }); }),
    addAlert:      overrides.addAlert      ?? ((alert)                => { calls.addAlert.push(alert); }),
    _calls: calls,
  };
}

// ============================================================
// TC-F-001  정상 흐름 — 단일 숙소 전체 성공
// ============================================================
describe('TC-F-001  정상 흐름 — 단일 숙소 전체 성공', () => {
  test('status=success, steps 모두 true', async () => {
    const deps = makeDeps();
    const results = await runD1Automation([BOOKINGS[0]], TODAY, deps);

    assert.equal(results.length, 1);
    assert.equal(results[0].propId,         'P-042');
    assert.equal(results[0].status,         'success');
    assert.equal(results[0].steps.pin,      true);
    assert.equal(results[0].steps.message,  true);
    assert.equal(results[0].steps.smartHome, true);
    assert.equal(results[0].error,          null);
  });
});

// ============================================================
// TC-F-002  정상 흐름 — 복수 숙소 전체 성공
// ============================================================
describe('TC-F-002  정상 흐름 — 복수 숙소 전체 성공', () => {
  test('익일 체크인 confirmed 숙소만 처리, 전체 success', async () => {
    const deps    = makeDeps();
    const results = await runD1Automation(BOOKINGS, TODAY, deps);

    // P-099는 오늘 체크인이므로 제외 → 2개만 처리
    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.status === 'success'));
    assert.ok(results.every(r => r.steps.pin && r.steps.message && r.steps.smartHome));
  });

  test('처리된 propId 목록이 P-042, P-007 이다', async () => {
    const deps    = makeDeps();
    const results = await runD1Automation(BOOKINGS, TODAY, deps);
    const ids     = results.map(r => r.propId);

    assert.ok(ids.includes('P-042'));
    assert.ok(ids.includes('P-007'));
    assert.ok(!ids.includes('P-099'));
  });
});

// ============================================================
// TC-F-003  실행 순서 검증 — setLockCode → sendMessage → activateScene
// ============================================================
describe('TC-F-003  실행 순서 검증', () => {
  test('setLockCode → sendMessage → activateScene 순서로 호출된다', async () => {
    const order = [];
    const deps  = makeDeps({
      setLockCode:   async () => { order.push('setLockCode'); },
      sendMessage:   async () => { order.push('sendMessage'); },
      activateScene: async () => { order.push('activateScene'); },
    });

    await runD1Automation([BOOKINGS[0]], TODAY, deps);

    assert.equal(order[0], 'setLockCode');
    assert.equal(order[1], 'sendMessage');
    assert.equal(order[2], 'activateScene');
  });

  test('setLockCode에 6자리 PIN이 전달된다', async () => {
    const deps = makeDeps();
    await runD1Automation([BOOKINGS[0]], TODAY, deps);

    const { code } = deps._calls.setLockCode[0];
    assert.match(code, /^\d{6}$/);
  });

  test('sendMessage에 게스트 이름과 PIN이 포함된 텍스트가 전달된다', async () => {
    const deps = makeDeps();
    await runD1Automation([BOOKINGS[0]], TODAY, deps);

    const { guestId, text } = deps._calls.sendMessage[0];
    assert.equal(guestId, 'guest_001');
    assert.ok(text.includes('김민준'));
    assert.match(text, /\d{6}/);  // PIN 포함
  });

  test('activateScene에 올바른 씬 ID가 전달된다', async () => {
    const deps = makeDeps();
    await runD1Automation([BOOKINGS[0]], TODAY, deps);

    const { id } = deps._calls.activateScene[0];
    assert.ok(id.startsWith('scene.checkin_ready_'));
  });
});

// ============================================================
// TC-F-004  대상 없음
// ============================================================
describe('TC-F-004  대상 없음 — 익일 체크인 예약 없음', () => {
  test('빈 배열 반환, deps 미호출', async () => {
    const deps    = makeDeps();
    const results = await runD1Automation(BOOKINGS, '2026-03-30', deps);

    assert.deepEqual(results, []);
    assert.equal(deps._calls.setLockCode.length,   0);
    assert.equal(deps._calls.sendMessage.length,   0);
    assert.equal(deps._calls.activateScene.length, 0);
  });

  test('전체 예약 빈 배열이어도 에러 없이 빈 배열 반환', async () => {
    const deps    = makeDeps();
    const results = await runD1Automation([], TODAY, deps);

    assert.deepEqual(results, []);
  });
});

// ============================================================
// TC-F-005  예외: 도어락 등록 실패
// ============================================================
describe('TC-F-005  예외 — 도어락 등록 실패', () => {
  test('해당 숙소 status=failed, sendMessage/activateScene 미호출', async () => {
    const deps = makeDeps({
      setLockCode: async () => { throw new Error('HA 503 Service Unavailable'); },
    });

    const results = await runD1Automation([BOOKINGS[0]], TODAY, deps);

    assert.equal(results[0].status,           'failed');
    assert.equal(results[0].steps.pin,        false);
    assert.equal(results[0].steps.message,    false);
    assert.equal(results[0].steps.smartHome,  false);
    assert.ok(results[0].error.includes('PIN 등록 실패'));
    assert.equal(deps._calls.sendMessage.length,   0);
    assert.equal(deps._calls.activateScene.length, 0);
  });

  test('첫 번째 숙소 실패해도 두 번째 숙소는 정상 처리된다', async () => {
    let callCount = 0;
    const deps    = makeDeps({
      setLockCode: async () => {
        callCount++;
        if (callCount === 1) throw new Error('timeout');
      },
    });

    const results = await runD1Automation(BOOKINGS.slice(0, 2), TODAY, deps);

    assert.equal(results.length,   2);
    assert.equal(results[0].status, 'failed');
    assert.equal(results[1].status, 'success');
  });
});

// ============================================================
// TC-F-006  예외: 메시지 발송 실패
// ============================================================
describe('TC-F-006  예외 — 메시지 발송 실패', () => {
  test('status=partial, steps.pin=true, steps.message=false', async () => {
    const deps = makeDeps({
      sendMessage: async () => { throw new Error('메시지 채널 연결 오류'); },
    });

    const results = await runD1Automation([BOOKINGS[0]], TODAY, deps);

    assert.equal(results[0].status,          'partial');
    assert.equal(results[0].steps.pin,       true);
    assert.equal(results[0].steps.message,   false);
    assert.ok(results[0].error.includes('메시지 발송 실패'));
  });

  test('메시지 실패 후에도 activateScene은 호출된다', async () => {
    const deps = makeDeps({
      sendMessage: async () => { throw new Error('timeout'); },
    });

    await runD1Automation([BOOKINGS[0]], TODAY, deps);

    assert.equal(deps._calls.activateScene.length, 1);
  });
});

// ============================================================
// TC-F-007  예외: 스마트홈 초기화 실패
// ============================================================
describe('TC-F-007  예외 — 스마트홈 초기화 실패', () => {
  test('status=partial, pin/message=true, smartHome=false', async () => {
    const deps = makeDeps({
      activateScene: async () => { throw new Error('HA 씬 없음'); },
    });

    const results = await runD1Automation([BOOKINGS[0]], TODAY, deps);

    assert.equal(results[0].status,           'partial');
    assert.equal(results[0].steps.pin,        true);
    assert.equal(results[0].steps.message,    true);
    assert.equal(results[0].steps.smartHome,  false);
    assert.ok(results[0].error.includes('스마트홈 초기화 실패'));
  });
});

// ============================================================
// TC-F-008  알림 — 성공 시 info 알림
// ============================================================
describe('TC-F-008  알림 — 성공 시 info 알림 생성', () => {
  test('성공 숙소 처리 후 info 알림이 1개 생성된다', async () => {
    const deps = makeDeps();
    await runD1Automation([BOOKINGS[0]], TODAY, deps);

    const infoAlerts = deps._calls.addAlert.filter(a => a.type === 'info');
    assert.equal(infoAlerts.length, 1);
    assert.equal(infoAlerts[0].prop, 'P-042');
  });

  test('info 알림 메시지에 D-1 자동화 완료 문구가 포함된다', async () => {
    const deps = makeDeps();
    await runD1Automation([BOOKINGS[0]], TODAY, deps);

    const alert = deps._calls.addAlert.find(a => a.type === 'info');
    assert.ok(alert.msg.includes('D-1 자동화 완료'));
  });
});

// ============================================================
// TC-F-009  알림 — 도어락 실패 시 error 알림
// ============================================================
describe('TC-F-009  알림 — 도어락 실패 시 error 알림', () => {
  test('error 알림이 1개 생성된다', async () => {
    const deps = makeDeps({
      setLockCode: async () => { throw new Error('timeout'); },
    });

    await runD1Automation([BOOKINGS[0]], TODAY, deps);

    const errAlerts = deps._calls.addAlert.filter(a => a.type === 'error');
    assert.equal(errAlerts.length, 1);
    assert.equal(errAlerts[0].prop, 'P-042');
  });

  test('info 알림은 생성되지 않는다', async () => {
    const deps = makeDeps({
      setLockCode: async () => { throw new Error('timeout'); },
    });

    await runD1Automation([BOOKINGS[0]], TODAY, deps);

    const infoAlerts = deps._calls.addAlert.filter(a => a.type === 'info');
    assert.equal(infoAlerts.length, 0);
  });
});

// ============================================================
// TC-F-010  알림 — 복수 실패 시 숙소별 독립 알림
// ============================================================
describe('TC-F-010  알림 — 복수 숙소 독립 알림', () => {
  test('2개 숙소 성공 시 info 알림 2개 생성', async () => {
    const deps = makeDeps();
    await runD1Automation(BOOKINGS.slice(0, 2), TODAY, deps);

    const infoAlerts = deps._calls.addAlert.filter(a => a.type === 'info');
    assert.equal(infoAlerts.length, 2);
  });

  test('1성공 1실패 시 info 1개 + error 1개', async () => {
    let callCount = 0;
    const deps    = makeDeps({
      setLockCode: async () => {
        callCount++;
        if (callCount === 2) throw new Error('timeout');
      },
    });

    await runD1Automation(BOOKINGS.slice(0, 2), TODAY, deps);

    const infoAlerts  = deps._calls.addAlert.filter(a => a.type === 'info');
    const errorAlerts = deps._calls.addAlert.filter(a => a.type === 'error');
    assert.equal(infoAlerts.length,  1);
    assert.equal(errorAlerts.length, 1);
  });
});
