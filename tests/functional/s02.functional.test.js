/**
 * UC-002 기능 테스트 (S02 체크인 당일 자동화)
 * 수용 기준: 시퀀스 다이어그램 propos-scenario02-sequence.uml 기준
 *
 * TC-F-011  정상 흐름 — 씬 실행 → 채팅 오픈 → 메시지 발송 → 상태 갱신 → 알림
 * TC-F-012  실행 순서 검증 — activateScene → openChannel → sendMessage 순
 * TC-F-013  체크인 시간창 외 도어락 열림 → null 반환, deps 미호출
 * TC-F-014  context가 guest_checkin 아닌 경우 → null 반환
 * TC-F-015  해당 propId 예약 없음 → null 반환
 * TC-F-016  예외: 씬 실행 실패 → status=failed, 이후 단계 미실행
 * TC-F-017  예외: 채팅 채널 오픈 실패 → status=partial, sendMessage는 계속 실행
 * TC-F-018  예외: 메시지 발송 실패 → status=partial, scene/channel=true
 * TC-F-019  알림 — 성공 시 info 알림, 게스트 이름 + 입실 시각 포함
 * TC-F-020  알림 — 씬 실패 시 error 알림, info 없음
 * TC-F-021  handlePinLockout — error 알림 생성, propId/failCount 포함
 * TC-F-022  updateStatus — 성공 시 "occupied"로 호출됨
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { handleDoorUnlocked, handlePinLockout } from "../../src/application/checkinService.js";
import {
  makeCheckinBooking,
  makeDoorUnlockedEvent,
} from "../helpers/checkinFixtures.js";

// ============================================================
// 공통 픽스처
// ============================================================

const BOOKINGS = [
  makeCheckinBooking({ pinRequired: undefined, wifi: undefined }),
  makeCheckinBooking({
    propId: "P-007",
    propName: "강남 럭셔리 스위트",
    guestName: "이수진",
    guestId: "guest_002",
    checkIn: "2026-03-28T14:00:00",
    checkOut: "2026-03-29T11:00:00",
    status: "pending",
    pinRequired: undefined,
    wifi: undefined,
  }),
];

// checkIn 15:00 → window 14:00~20:00
const EVENT_CHECKIN = makeDoorUnlockedEvent();

const NOW_VALID   = '15:12';  // 시간창 내
const NOW_OUTSIDE = '13:00';  // 시간창 외

/**
 * 모든 deps가 성공하는 기본 mock 생성
 */
function makeDeps(overrides = {}) {
  const calls = {
    activateScene: [],
    openChannel:   [],
    sendMessage:   [],
    updateStatus:  [],
    addAlert:      [],
  };

  return {
    activateScene: overrides.activateScene ?? (async (id)            => { calls.activateScene.push({ id }); }),
    openChannel:   overrides.openChannel   ?? (async (booking)       => { calls.openChannel.push({ booking }); }),
    sendMessage:   overrides.sendMessage   ?? (async (guestId, text) => { calls.sendMessage.push({ guestId, text }); }),
    updateStatus:  overrides.updateStatus  ?? ((propId, status)      => { calls.updateStatus.push({ propId, status }); }),
    addAlert:      overrides.addAlert      ?? ((alert)               => { calls.addAlert.push(alert); }),
    _calls: calls,
  };
}

// ============================================================
// TC-F-011  정상 흐름 — 단일 숙소 전체 성공
// ============================================================
describe('TC-F-011  정상 흐름 — 전체 성공', () => {
  test('status=success, steps 모두 true', async () => {
    const deps   = makeDeps();
    const result = await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(result.propId,        'P-042');
    assert.equal(result.status,        'success');
    assert.equal(result.steps.scene,   true);
    assert.equal(result.steps.channel, true);
    assert.equal(result.steps.message, true);
    assert.equal(result.error,         null);
  });

  test('activateScene, openChannel, sendMessage, updateStatus 각 1회 호출', async () => {
    const deps = makeDeps();
    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(deps._calls.activateScene.length, 1);
    assert.equal(deps._calls.openChannel.length,   1);
    assert.equal(deps._calls.sendMessage.length,   1);
    assert.equal(deps._calls.updateStatus.length,  1);
  });
});

// ============================================================
// TC-F-012  실행 순서 검증
// ============================================================
describe('TC-F-012  실행 순서 검증', () => {
  test('activateScene → openChannel → sendMessage 순으로 호출된다', async () => {
    const order = [];
    const deps  = makeDeps({
      activateScene: async () => { order.push('activateScene'); },
      openChannel:   async () => { order.push('openChannel'); },
      sendMessage:   async () => { order.push('sendMessage'); },
    });

    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(order[0], 'activateScene');
    assert.equal(order[1], 'openChannel');
    assert.equal(order[2], 'sendMessage');
  });

  test('activateScene에 올바른 씬 ID가 전달된다', async () => {
    const deps = makeDeps();
    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    const { id } = deps._calls.activateScene[0];
    assert.ok(id.startsWith('scene.checkin_welcome_'));
    assert.ok(id.includes('p_042'));
  });

  test('sendMessage에 게스트 ID와 게스트 이름이 포함된 텍스트가 전달된다', async () => {
    const deps = makeDeps();
    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    const { guestId, text } = deps._calls.sendMessage[0];
    assert.equal(guestId, 'guest_001');
    assert.ok(text.includes('김민준'));
  });

  test('openChannel에 booking 객체가 전달된다', async () => {
    const deps = makeDeps();
    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    const { booking } = deps._calls.openChannel[0];
    assert.equal(booking.propId, 'P-042');
  });
});

// ============================================================
// TC-F-013  체크인 시간창 외
// ============================================================
describe('TC-F-013  체크인 시간창 외 도어락 열림', () => {
  test('null 반환', async () => {
    const deps   = makeDeps();
    const result = await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_OUTSIDE);

    assert.equal(result, null);
  });

  test('deps 미호출', async () => {
    const deps = makeDeps();
    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_OUTSIDE);

    assert.equal(deps._calls.activateScene.length, 0);
    assert.equal(deps._calls.openChannel.length,   0);
    assert.equal(deps._calls.sendMessage.length,   0);
    assert.equal(deps._calls.addAlert.length,      0);
  });
});

// ============================================================
// TC-F-014  context가 guest_checkin 아닌 경우
// ============================================================
describe('TC-F-014  context가 guest_checkin 아닌 경우', () => {
  test('null 반환, deps 미호출', async () => {
    const manualEvent = { ...EVENT_CHECKIN, context: 'manual' };
    const deps        = makeDeps();
    const result      = await handleDoorUnlocked(manualEvent, BOOKINGS, deps, NOW_VALID);

    assert.equal(result, null);
    assert.equal(deps._calls.activateScene.length, 0);
  });
});

// ============================================================
// TC-F-015  해당 propId 예약 없음
// ============================================================
describe('TC-F-015  예약 없는 propId', () => {
  test('null 반환', async () => {
    const unknownEvent = { ...EVENT_CHECKIN, propId: 'P-999' };
    const deps         = makeDeps();
    const result       = await handleDoorUnlocked(unknownEvent, BOOKINGS, deps, NOW_VALID);

    assert.equal(result, null);
  });

  test('allBookings 빈 배열이면 null 반환', async () => {
    const deps   = makeDeps();
    const result = await handleDoorUnlocked(EVENT_CHECKIN, [], deps, NOW_VALID);

    assert.equal(result, null);
  });
});

// ============================================================
// TC-F-016  예외: 씬 실행 실패
// ============================================================
describe('TC-F-016  예외 — 씬 실행 실패', () => {
  test('status=failed, steps 모두 false', async () => {
    const deps = makeDeps({
      activateScene: async () => { throw new Error('HA 503'); },
    });

    const result = await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(result.status,        'failed');
    assert.equal(result.steps.scene,   false);
    assert.equal(result.steps.channel, false);
    assert.equal(result.steps.message, false);
    assert.ok(result.error.includes('씬 실행 실패'));
  });

  test('씬 실패 후 openChannel, sendMessage 미호출', async () => {
    const deps = makeDeps({
      activateScene: async () => { throw new Error('timeout'); },
    });

    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(deps._calls.openChannel.length,  0);
    assert.equal(deps._calls.sendMessage.length,  0);
  });
});

// ============================================================
// TC-F-017  예외: 채팅 채널 오픈 실패
// ============================================================
describe('TC-F-017  예외 — 채팅 채널 오픈 실패', () => {
  test('status=partial, scene=true, channel=false', async () => {
    const deps = makeDeps({
      openChannel: async () => { throw new Error('채널 서비스 오류'); },
    });

    const result = await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(result.status,        'partial');
    assert.equal(result.steps.scene,   true);
    assert.equal(result.steps.channel, false);
    assert.ok(result.error.includes('채팅 채널 오픈 실패'));
  });

  test('채널 오픈 실패 후에도 sendMessage는 계속 호출된다', async () => {
    const deps = makeDeps({
      openChannel: async () => { throw new Error('timeout'); },
    });

    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(deps._calls.sendMessage.length, 1);
  });
});

// ============================================================
// TC-F-018  예외: 메시지 발송 실패
// ============================================================
describe('TC-F-018  예외 — 메시지 발송 실패', () => {
  test('status=partial, scene/channel=true, message=false', async () => {
    const deps = makeDeps({
      sendMessage: async () => { throw new Error('메시지 채널 오류'); },
    });

    const result = await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(result.status,        'partial');
    assert.equal(result.steps.scene,   true);
    assert.equal(result.steps.channel, true);
    assert.equal(result.steps.message, false);
    assert.ok(result.error.includes('메시지 발송 실패'));
  });
});

// ============================================================
// TC-F-019  알림 — 성공 시 info 알림
// ============================================================
describe('TC-F-019  알림 — 성공 시 info 알림', () => {
  test('info 알림 1개 생성, prop=P-042', async () => {
    const deps = makeDeps();
    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    const infoAlerts = deps._calls.addAlert.filter(a => a.type === 'info');
    assert.equal(infoAlerts.length, 1);
    assert.equal(infoAlerts[0].prop, 'P-042');
  });

  test('info 알림 메시지에 게스트 이름이 포함된다', async () => {
    const deps = makeDeps();
    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    const alert = deps._calls.addAlert.find(a => a.type === 'info');
    assert.ok(alert.msg.includes('김민준'));
  });

  test('info 알림 메시지에 입실 시각이 포함된다', async () => {
    const deps = makeDeps();
    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    const alert = deps._calls.addAlert.find(a => a.type === 'info');
    assert.ok(alert.msg.includes('15:12'));
  });
});

// ============================================================
// TC-F-020  알림 — 씬 실패 시 error 알림
// ============================================================
describe('TC-F-020  알림 — 씬 실패 시 error 알림', () => {
  test('error 알림 1개 생성, info 없음', async () => {
    const deps = makeDeps({
      activateScene: async () => { throw new Error('timeout'); },
    });

    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    const errorAlerts = deps._calls.addAlert.filter(a => a.type === 'error');
    const infoAlerts  = deps._calls.addAlert.filter(a => a.type === 'info');
    assert.equal(errorAlerts.length, 1);
    assert.equal(infoAlerts.length,  0);
  });
});

// ============================================================
// TC-F-021  handlePinLockout — error 알림 생성
// ============================================================
describe('TC-F-021  handlePinLockout', () => {
  const LOCKOUT_EVENT = { propId: 'P-042', failCount: 3, time: '15:05' };

  test('error 알림 1개 생성', () => {
    const deps = makeDeps();
    handlePinLockout(LOCKOUT_EVENT, deps);

    const errAlerts = deps._calls.addAlert.filter(a => a.type === 'error');
    assert.equal(errAlerts.length, 1);
  });

  test('알림에 propId가 포함된다', () => {
    const deps = makeDeps();
    handlePinLockout(LOCKOUT_EVENT, deps);

    const alert = deps._calls.addAlert[0];
    assert.equal(alert.prop, 'P-042');
    assert.ok(alert.msg.includes('P-042'));
  });

  test('알림에 failCount(3)가 포함된다', () => {
    const deps = makeDeps();
    handlePinLockout(LOCKOUT_EVENT, deps);

    const alert = deps._calls.addAlert[0];
    assert.ok(alert.msg.includes('3'));
  });

  test('알림 time이 이벤트 time과 일치한다', () => {
    const deps = makeDeps();
    handlePinLockout(LOCKOUT_EVENT, deps);

    assert.equal(deps._calls.addAlert[0].time, '15:05');
  });
});

// ============================================================
// TC-F-022  updateStatus — "occupied"로 호출됨
// ============================================================
describe('TC-F-022  updateStatus', () => {
  test('성공 시 propId + "occupied"로 호출된다', async () => {
    const deps = makeDeps();
    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(deps._calls.updateStatus[0].propId, 'P-042');
    assert.equal(deps._calls.updateStatus[0].status, 'occupied');
  });

  test('씬 실패 시 updateStatus 미호출', async () => {
    const deps = makeDeps({
      activateScene: async () => { throw new Error('timeout'); },
    });

    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(deps._calls.updateStatus.length, 0);
  });

  test('partial(메시지 실패)이어도 updateStatus는 호출된다', async () => {
    const deps = makeDeps({
      sendMessage: async () => { throw new Error('timeout'); },
    });

    await handleDoorUnlocked(EVENT_CHECKIN, BOOKINGS, deps, NOW_VALID);

    assert.equal(deps._calls.updateStatus.length, 1);
    assert.equal(deps._calls.updateStatus[0].status, 'occupied');
  });
});

// ============================================================
// TC-F-023  haEvent.time 누락 — 현재 시각으로 대체 (버그 수정 검증)
// ============================================================
describe('TC-F-023  haEvent.time 누락 시 fallback', () => {
  test('time이 없어도 정상 처리된다 (예외 없음)', async () => {
    const noTimeEvent = { ...EVENT_CHECKIN, time: undefined };
    const deps = makeDeps();
    await assert.doesNotReject(() => handleDoorUnlocked(noTimeEvent, BOOKINGS, deps, NOW_VALID));
  });

  test('time이 없어도 sendMessage에 텍스트가 전달된다', async () => {
    const noTimeEvent = { ...EVENT_CHECKIN, time: undefined };
    const deps = makeDeps();
    await handleDoorUnlocked(noTimeEvent, BOOKINGS, deps, NOW_VALID);

    assert.equal(deps._calls.sendMessage.length, 1);
    assert.equal(typeof deps._calls.sendMessage[0].text, 'string');
    assert.ok(deps._calls.sendMessage[0].text.length > 0);
  });

  test('time이 없어도 updateStatus, addAlert는 호출된다', async () => {
    const noTimeEvent = { ...EVENT_CHECKIN, time: undefined };
    const deps = makeDeps();
    await handleDoorUnlocked(noTimeEvent, BOOKINGS, deps, NOW_VALID);

    assert.equal(deps._calls.updateStatus.length, 1);
    const infoAlerts = deps._calls.addAlert.filter(a => a.type === 'info');
    assert.equal(infoAlerts.length, 1);
  });
});
