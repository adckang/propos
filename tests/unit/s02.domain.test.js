import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isCheckinEvent, getCheckinWindow } from "../../src/domain/checkinDomain.js";
import { buildCheckinConfirmMessage, buildPinLockoutAlert } from "../../src/domain/messageDomain.js";
import {
  makeCheckinBooking,
  makeDoorUnlockedEvent,
} from "../helpers/checkinFixtures.js";

// ============================================================
// 공통 픽스처
// ============================================================

const BOOKING_CONFIRMED = makeCheckinBooking({
  guestId: "guest_42",
  pinRequired: undefined,
  wifi: undefined,
});
const EVENT_CHECKIN = makeDoorUnlockedEvent();

// ============================================================
// checkinDomain.getCheckinWindow
// ============================================================
describe('checkinDomain.getCheckinWindow', () => {

  test('from = checkIn - 1시간', () => {
    const { from } = getCheckinWindow('2026-03-28T15:00:00');
    assert.equal(from, '14:00');
  });

  test('until = checkIn + 5시간', () => {
    const { until } = getCheckinWindow('2026-03-28T15:00:00');
    assert.equal(until, '20:00');
  });

  test('HH:MM 형식 문자열을 반환한다', () => {
    const { from, until } = getCheckinWindow('2026-03-28T09:30:00');
    assert.match(from,  /^\d{2}:\d{2}$/);
    assert.match(until, /^\d{2}:\d{2}$/);
  });

  test('자정 경계: 01:00 체크인 → from = 00:00', () => {
    const { from } = getCheckinWindow('2026-03-28T01:00:00');
    assert.equal(from, '00:00');
  });

  test('checkIn 없으면 에러', () => {
    assert.throws(() => getCheckinWindow(''), /required/);
  });

  test('잘못된 날짜 문자열이면 에러', () => {
    assert.throws(() => getCheckinWindow('not-a-date'), /Invalid/);
  });
});

// ============================================================
// checkinDomain.isCheckinEvent
// ============================================================
describe('checkinDomain.isCheckinEvent', () => {

  test('정상 체크인 이벤트 → true', () => {
    // checkIn 15:00 → window 14:00~20:00, now=15:12
    const result = isCheckinEvent(EVENT_CHECKIN, BOOKING_CONFIRMED, '15:12');
    assert.equal(result, true);
  });

  test('체크인 가능 시간창 시작(from) 정각 → true', () => {
    const result = isCheckinEvent(EVENT_CHECKIN, BOOKING_CONFIRMED, '14:00');
    assert.equal(result, true);
  });

  test('체크인 가능 시간창 종료(until) 정각 → true', () => {
    const result = isCheckinEvent(EVENT_CHECKIN, BOOKING_CONFIRMED, '20:00');
    assert.equal(result, true);
  });

  test('시간창 이전(13:59) → false', () => {
    const result = isCheckinEvent(EVENT_CHECKIN, BOOKING_CONFIRMED, '13:59');
    assert.equal(result, false);
  });

  test('시간창 이후(20:01) → false', () => {
    const result = isCheckinEvent(EVENT_CHECKIN, BOOKING_CONFIRMED, '20:01');
    assert.equal(result, false);
  });

  test('context가 guest_checkin이 아니면 → false', () => {
    const manualEvent = { ...EVENT_CHECKIN, context: 'manual' };
    const result = isCheckinEvent(manualEvent, BOOKING_CONFIRMED, '15:12');
    assert.equal(result, false);
  });

  test('context가 없으면 → false', () => {
    const noCtx = { ...EVENT_CHECKIN, context: undefined };
    const result = isCheckinEvent(noCtx, BOOKING_CONFIRMED, '15:12');
    assert.equal(result, false);
  });

  test('booking.status가 confirmed가 아니면 → false', () => {
    const pending = { ...BOOKING_CONFIRMED, status: 'pending' };
    const result = isCheckinEvent(EVENT_CHECKIN, pending, '15:12');
    assert.equal(result, false);
  });

  test('booking.status가 cancelled이면 → false', () => {
    const cancelled = { ...BOOKING_CONFIRMED, status: 'cancelled' };
    const result = isCheckinEvent(EVENT_CHECKIN, cancelled, '15:12');
    assert.equal(result, false);
  });

  test('haEvent 없으면 에러', () => {
    assert.throws(() => isCheckinEvent(null, BOOKING_CONFIRMED, '15:12'), /required/);
  });

  test('booking 없으면 에러', () => {
    assert.throws(() => isCheckinEvent(EVENT_CHECKIN, null, '15:12'), /required/);
  });

  test('now 없으면 에러', () => {
    assert.throws(() => isCheckinEvent(EVENT_CHECKIN, BOOKING_CONFIRMED, ''), /required/);
  });
});

// ============================================================
// messageDomain.buildCheckinConfirmMessage
// ============================================================
describe('messageDomain.buildCheckinConfirmMessage', () => {

  test('게스트 이름이 포함된다', () => {
    const msg = buildCheckinConfirmMessage(BOOKING_CONFIRMED, '15:12');
    assert.ok(msg.includes('김민준'));
  });

  test('실제 입실 시각이 포함된다', () => {
    const msg = buildCheckinConfirmMessage(BOOKING_CONFIRMED, '15:12');
    assert.ok(msg.includes('15:12'));
  });

  test('체크아웃 날짜가 포함된다', () => {
    const msg = buildCheckinConfirmMessage(BOOKING_CONFIRMED, '15:12');
    assert.ok(msg.includes('2026-03-30'));
  });

  test('문자열을 반환한다', () => {
    const msg = buildCheckinConfirmMessage(BOOKING_CONFIRMED, '15:12');
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 0);
  });

  test('checkOut 없어도 에러 없이 동작한다', () => {
    const noCheckout = { ...BOOKING_CONFIRMED, checkOut: null };
    assert.doesNotThrow(() => buildCheckinConfirmMessage(noCheckout, '15:12'));
  });

  test('booking 없으면 에러', () => {
    assert.throws(() => buildCheckinConfirmMessage(null, '15:12'), /required/);
  });

  test('actualCheckInTime 없으면 에러', () => {
    assert.throws(() => buildCheckinConfirmMessage(BOOKING_CONFIRMED, ''), /required/);
  });

  test('guestName 없으면 에러', () => {
    const noName = { ...BOOKING_CONFIRMED, guestName: '' };
    assert.throws(() => buildCheckinConfirmMessage(noName, '15:12'), /required/);
  });
});

// ============================================================
// messageDomain.buildPinLockoutAlert
// ============================================================
describe('messageDomain.buildPinLockoutAlert', () => {

  test('propId가 포함된다', () => {
    const msg = buildPinLockoutAlert('P-042', 3);
    assert.ok(msg.includes('P-042'));
  });

  test('오류 횟수가 포함된다', () => {
    const msg = buildPinLockoutAlert('P-042', 3);
    assert.ok(msg.includes('3'));
  });

  test('문자열을 반환한다', () => {
    const msg = buildPinLockoutAlert('P-042', 3);
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 0);
  });

  test('propId 없으면 에러', () => {
    assert.throws(() => buildPinLockoutAlert('', 3), /required/);
  });

  test('failCount 없으면 에러', () => {
    assert.throws(() => buildPinLockoutAlert('P-042', null), /required/);
  });

  test('failCount가 음수이면 에러', () => {
    assert.throws(() => buildPinLockoutAlert('P-042', -1), /non-negative/);
  });

  test('failCount가 숫자가 아니면 에러', () => {
    assert.throws(() => buildPinLockoutAlert('P-042', 'three'), /non-negative/);
  });

  test('failCount가 0이어도 동작한다', () => {
    assert.doesNotThrow(() => buildPinLockoutAlert('P-042', 0));
  });
});
