/**
 * S04 도메인 단위 테스트 — 체크아웃 & 청소
 * node --test tests/unit/s04.domain.test.js
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  isCheckoutEvent,
  getCheckoutWindow,
  assignCleaner,
  buildChecklist,
  buildCheckoutAlert,
  buildCleanerAssignAlert,
} from "../../src/domain/checkoutDomain.js";

import { buildCheckoutThankYouMessage } from "../../src/domain/messageDomain.js";
import {
  makeCheckoutBooking,
  makeCheckoutEvent,
  makeCleaners,
} from "../helpers/checkoutFixtures.js";

// ============================================================
// 공통 픽스처
// ============================================================

const makeBooking = makeCheckoutBooking;
const makeEvent = makeCheckoutEvent;

// ============================================================
// checkoutDomain.getCheckoutWindow
// ============================================================
describe('checkoutDomain.getCheckoutWindow', () => {
  test('checkOut 2h 전 ~ 3h 후 시간창 반환', () => {
    // "2026-04-07T11:00:00" UTC → from=09:00, until=14:00
    const w = getCheckoutWindow('2026-04-07T11:00:00');
    assert.equal(w.from,  '09:00');
    assert.equal(w.until, '14:00');
  });

  test('checkOut 없으면 에러', () => {
    assert.throws(() => getCheckoutWindow(''), /required/);
  });

  test('잘못된 날짜 형식이면 에러', () => {
    assert.throws(() => getCheckoutWindow('not-a-date'), /invalid date/i);
  });

  test('from < until 이다', () => {
    const w = getCheckoutWindow('2026-04-07T14:00:00');
    const [fh, fm] = w.from.split(':').map(Number);
    const [uh, um] = w.until.split(':').map(Number);
    assert.ok(fh * 60 + fm < uh * 60 + um, 'from은 until보다 앞이어야 함');
  });
});

// ============================================================
// checkoutDomain.isCheckoutEvent
// ============================================================
describe('checkoutDomain.isCheckoutEvent — 정상 판별', () => {
  test('door_locked + occupied + 시간창 내 → true', () => {
    const result = isCheckoutEvent(makeEvent(), makeBooking(), '11:05');
    assert.equal(result, true);
  });

  test('manual_checkout 이벤트도 true', () => {
    const result = isCheckoutEvent(
      makeEvent({ event: 'manual_checkout' }),
      makeBooking(),
      '11:05'
    );
    assert.equal(result, true);
  });

  test('confirmed 상태도 true', () => {
    const result = isCheckoutEvent(
      makeEvent(),
      makeBooking({ status: 'confirmed' }),
      '11:05'
    );
    assert.equal(result, true);
  });
});

describe('checkoutDomain.isCheckoutEvent — false 케이스', () => {
  test('door_unlocked 이벤트 → false (체크아웃 아님)', () => {
    const result = isCheckoutEvent(makeEvent({ event: 'door_unlocked' }), makeBooking(), '11:05');
    assert.equal(result, false);
  });

  test('vacant 상태 예약 → false', () => {
    const result = isCheckoutEvent(makeEvent(), makeBooking({ status: 'vacant' }), '11:05');
    assert.equal(result, false);
  });

  test('시간창 밖 (너무 이름) → false', () => {
    // checkOut=11:00 → window=09:00~14:00
    // 08:00은 시간창 밖
    const result = isCheckoutEvent(makeEvent(), makeBooking(), '08:00');
    assert.equal(result, false);
  });

  test('시간창 밖 (너무 늦음) → false', () => {
    const result = isCheckoutEvent(makeEvent(), makeBooking(), '15:00');
    assert.equal(result, false);
  });

  test('window 경계값 from(09:00) 정확히 → true', () => {
    const result = isCheckoutEvent(makeEvent(), makeBooking(), '09:00');
    assert.equal(result, true);
  });

  test('window 경계값 until(14:00) 정확히 → true', () => {
    const result = isCheckoutEvent(makeEvent(), makeBooking(), '14:00');
    assert.equal(result, true);
  });
});

describe('checkoutDomain.isCheckoutEvent — 에러 케이스', () => {
  test('event 없으면 에러', () => {
    assert.throws(() => isCheckoutEvent(null, makeBooking(), '11:05'), /required/);
  });

  test('booking 없으면 에러', () => {
    assert.throws(() => isCheckoutEvent(makeEvent(), null, '11:05'), /required/);
  });

  test('now 없으면 에러', () => {
    assert.throws(() => isCheckoutEvent(makeEvent(), makeBooking(), ''), /required/);
  });
});

// ============================================================
// checkoutDomain.assignCleaner
// ============================================================
describe('checkoutDomain.assignCleaner — 정상 배정', () => {
  test('가용 청소팀 중 activeJobs 최소 선택', () => {
    // C-01(activeJobs=1), C-02(activeJobs=0) → C-02 선택
    const assignment = assignCleaner(makeCleaners(), 'P-042', '11:05');
    assert.equal(assignment.cleanerId, 'C-02');
    assert.equal(assignment.cleanerName, '이청소');
  });

  test('unavailable 청소팀은 제외됨 (C-03: available=false)', () => {
    const assignment = assignCleaner(makeCleaners(), 'P-042', '11:05');
    assert.notEqual(assignment.cleanerId, 'C-03');
  });

  test('estimatedArrival = checkoutTime + 30분', () => {
    const assignment = assignCleaner(makeCleaners(), 'P-042', '11:05');
    assert.equal(assignment.estimatedArrival, '11:35');
  });

  test('status = assigned', () => {
    const assignment = assignCleaner(makeCleaners(), 'P-042', '11:05');
    assert.equal(assignment.status, 'assigned');
  });

  test('propId 포함', () => {
    const assignment = assignCleaner(makeCleaners(), 'P-042', '11:05');
    assert.equal(assignment.propId, 'P-042');
  });

  test('자정 넘어가는 경우 처리 (23:45 + 30분 = 00:15)', () => {
    const assignment = assignCleaner(makeCleaners(), 'P-001', '23:45');
    assert.equal(assignment.estimatedArrival, '00:15');
  });
});

describe('checkoutDomain.assignCleaner — 에러 케이스', () => {
  test('가용 청소팀 없으면 에러', () => {
    const noAvail = [{ id: 'C-99', name: '없음', available: false, activeJobs: 0 }];
    assert.throws(() => assignCleaner(noAvail, 'P-042', '11:05'), /가용 청소팀 없음/);
  });

  test('cleaners 빈 배열이면 에러', () => {
    assert.throws(() => assignCleaner([], 'P-042', '11:05'), /required/);
  });

  test('propId 없으면 에러', () => {
    assert.throws(() => assignCleaner(makeCleaners(), '', '11:05'), /required/);
  });

  test('checkoutTime 없으면 에러', () => {
    assert.throws(() => assignCleaner(makeCleaners(), 'P-042', ''), /required/);
  });
});

// ============================================================
// checkoutDomain.buildChecklist
// ============================================================
describe('checkoutDomain.buildChecklist', () => {
  test('8개 항목 반환', () => {
    const items = buildChecklist('P-042');
    assert.equal(items.length, 8);
  });

  test('required 항목 6개', () => {
    const items = buildChecklist('P-042');
    const required = items.filter(i => i.priority === 'required');
    assert.equal(required.length, 6);
  });

  test('optional 항목 2개', () => {
    const items = buildChecklist('P-042');
    const optional = items.filter(i => i.priority === 'optional');
    assert.equal(optional.length, 2);
  });

  test('모든 항목 done=false로 초기화', () => {
    const items = buildChecklist('P-042');
    assert.ok(items.every(i => i.done === false), '초기값은 모두 false');
  });

  test('각 항목에 id, label, done, priority 포함', () => {
    const items = buildChecklist('P-042');
    for (const item of items) {
      assert.ok('id'       in item, 'id 없음');
      assert.ok('label'    in item, 'label 없음');
      assert.ok('done'     in item, 'done 없음');
      assert.ok('priority' in item, 'priority 없음');
    }
  });

  test('id에 propId 포함', () => {
    const items = buildChecklist('P-042');
    assert.ok(items.every(i => i.id.includes('P-042')));
  });

  test('propId 없으면 에러', () => {
    assert.throws(() => buildChecklist(''), /required/);
  });

  test('필수 항목: 도어락 PIN 초기화 확인 포함', () => {
    const items = buildChecklist('P-042');
    const pinItem = items.find(i => i.label.includes('PIN'));
    assert.ok(pinItem, 'PIN 초기화 항목 없음');
    assert.equal(pinItem.priority, 'required');
  });
});

// ============================================================
// checkoutDomain.buildCheckoutAlert
// ============================================================
describe('checkoutDomain.buildCheckoutAlert', () => {
  test('propId, guestName, checkoutTime 모두 포함', () => {
    const msg = buildCheckoutAlert('P-042', '김민준', '11:05');
    assert.ok(msg.includes('P-042'));
    assert.ok(msg.includes('김민준'));
    assert.ok(msg.includes('11:05'));
  });

  test('문자열 반환', () => {
    const msg = buildCheckoutAlert('P-042', '김민준', '11:05');
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 0);
  });

  test('propId 없으면 에러', () => {
    assert.throws(() => buildCheckoutAlert('', '김민준', '11:05'), /required/);
  });

  test('guestName 없으면 에러', () => {
    assert.throws(() => buildCheckoutAlert('P-042', '', '11:05'), /required/);
  });

  test('checkoutTime 없으면 에러', () => {
    assert.throws(() => buildCheckoutAlert('P-042', '김민준', ''), /required/);
  });
});

// ============================================================
// checkoutDomain.buildCleanerAssignAlert
// ============================================================
describe('checkoutDomain.buildCleanerAssignAlert', () => {
  const ASSIGNMENT = {
    propId:           'P-042',
    cleanerId:        'C-02',
    cleanerName:      '이청소',
    assignedAt:       '11:05',
    estimatedArrival: '11:35',
    status:           'assigned',
  };

  test('propId, cleanerName, estimatedArrival 모두 포함', () => {
    const msg = buildCleanerAssignAlert('P-042', ASSIGNMENT);
    assert.ok(msg.includes('P-042'));
    assert.ok(msg.includes('이청소'));
    assert.ok(msg.includes('11:35'));
  });

  test('문자열 반환', () => {
    const msg = buildCleanerAssignAlert('P-042', ASSIGNMENT);
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 0);
  });

  test('propId 없으면 에러', () => {
    assert.throws(() => buildCleanerAssignAlert('', ASSIGNMENT), /required/);
  });

  test('assignment 없으면 에러', () => {
    assert.throws(() => buildCleanerAssignAlert('P-042', null), /required/);
  });

  test('assignment.cleanerName 없으면 에러', () => {
    assert.throws(() => buildCleanerAssignAlert('P-042', { ...ASSIGNMENT, cleanerName: '' }), /required/);
  });

  test('assignment.estimatedArrival 없으면 에러', () => {
    assert.throws(() => buildCleanerAssignAlert('P-042', { ...ASSIGNMENT, estimatedArrival: '' }), /required/);
  });
});

// ============================================================
// messageDomain.buildCheckoutThankYouMessage
// ============================================================
describe('messageDomain.buildCheckoutThankYouMessage', () => {
  test('guestName 포함', () => {
    const msg = buildCheckoutThankYouMessage(makeBooking());
    assert.ok(msg.includes('김민준'));
  });

  test('propName 포함', () => {
    const msg = buildCheckoutThankYouMessage(makeBooking());
    assert.ok(msg.includes('해운대 오션뷰'));
  });

  test('퇴실 관련 문구 포함', () => {
    const msg = buildCheckoutThankYouMessage(makeBooking());
    assert.ok(msg.includes('퇴실') || msg.includes('감사'));
  });

  test('문자열 반환', () => {
    const msg = buildCheckoutThankYouMessage(makeBooking());
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 0);
  });

  test('booking 없으면 에러', () => {
    assert.throws(() => buildCheckoutThankYouMessage(null), /required/);
  });

  test('guestName 없으면 에러', () => {
    assert.throws(() => buildCheckoutThankYouMessage({ guestName: '' }), /required/);
  });

  test('propName 없어도 에러 안남', () => {
    assert.doesNotThrow(() =>
      buildCheckoutThankYouMessage({ guestName: '김민준' })
    );
  });
});
