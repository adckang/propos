'use strict';

/**
 * S04 기능 테스트 — 체크아웃 & 청소 자동화
 * node --test tests/functional/s04.functional.test.js
 *
 * TC-F-037 ~ TC-F-054
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { handleCheckout, completeChecklistItem, finalizeClean } = require('../../src/application/checkoutService.js');

// ─────────────────────────────────────────────
// 공통 픽스처 & Mock 빌더
// ─────────────────────────────────────────────

function makeBooking(overrides = {}) {
  return {
    propId:    'P-042',
    propName:  '해운대 오션뷰',
    guestName: '김민준',
    guestId:   'guest-001',
    checkIn:   '2026-04-05T15:00:00',
    checkOut:  '2026-04-07T11:00:00',  // window: 09:00~14:00 (로컬)
    status:    'occupied',
    wifi:      { ssid: 'PROPOS_GUEST', pw: 'pass1234' },
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    event:   'door_locked',
    propId:  'P-042',
    time:    '11:05',
    context: 'guest_checkout',
    ...overrides,
  };
}

function makeCleaners() {
  return [
    { id: 'C-01', name: '김청소', available: true,  activeJobs: 1, phone: '010-1111-0001' },
    { id: 'C-02', name: '이청소', available: true,  activeJobs: 0, phone: '010-1111-0002' },
    { id: 'C-03', name: '박청소', available: false, activeJobs: 0, phone: '010-1111-0003' },
  ];
}

function makeDeps(overrides = {}) {
  return {
    expirePin:           async () => {},
    addAlert:            () => {},
    updateStatus:        () => {},
    setAssignment:       () => {},
    setChecklist:        () => {},
    updateChecklistItem: () => {},
    sendMessage:         async () => {},
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// TC-F-037: 정상 체크아웃 전체 흐름
// ─────────────────────────────────────────────
describe('TC-F-037: 정상 체크아웃 — 전체 자동화 흐름', () => {
  test('status=success, steps 3개 모두 true, 알림 2개 생성', async () => {
    const alerts   = [];
    let pinExpired = false;
    let cleanerSet = null;
    let checklistSet = null;
    let statusUpdated = null;

    const deps = makeDeps({
      expirePin:     async () => { pinExpired = true; },
      addAlert:      (a) => alerts.push(a),
      setAssignment: (_, a) => { cleanerSet = a; },
      setChecklist:  (_, items) => { checklistSet = items; },
      updateStatus:  (_, s) => { statusUpdated = s; },
    });

    const result = await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(), deps, '11:05'
    );

    assert.equal(result.status, 'success');
    assert.equal(result.propId, 'P-042');
    assert.equal(result.error,  null);
    assert.equal(result.steps.pinExpired,      true);
    assert.equal(result.steps.cleanerAssigned, true);
    assert.equal(result.steps.checklistCreated, true);

    assert.equal(pinExpired, true, 'PIN 만료 호출되어야 함');
    assert.ok(cleanerSet,    '청소팀 배정 저장 되어야 함');
    assert.ok(checklistSet,  '체크리스트 저장 되어야 함');
    assert.equal(statusUpdated, 'cleaning', '숙소 상태 cleaning으로 변경');

    assert.equal(alerts.length, 2, '체크아웃 완료 + 청소 배정 알림 2개');
    assert.equal(alerts[0].type, 'info');
    assert.equal(alerts[1].type, 'info');
  });
});

// ─────────────────────────────────────────────
// TC-F-038: 체크아웃 시간창 내 판별
// ─────────────────────────────────────────────
describe('TC-F-038: 체크아웃 시간창 판별', () => {
  test('시간창 내(11:05) → success', async () => {
    const result = await handleCheckout(
      makeEvent({ time: '11:05' }), [makeBooking()], makeCleaners(), makeDeps(), '11:05'
    );
    assert.equal(result.status, 'success');
  });

  test('시간창 밖(08:00) → failed (체크아웃 이벤트 아님)', async () => {
    const result = await handleCheckout(
      makeEvent({ time: '08:00' }), [makeBooking()], makeCleaners(), makeDeps(), '08:00'
    );
    assert.equal(result.status, 'failed');
    assert.ok(result.error.includes('체크아웃 이벤트 아님'));
  });

  test('booking 없는 propId → failed', async () => {
    const result = await handleCheckout(
      makeEvent({ propId: 'P-999' }), [makeBooking()], makeCleaners(), makeDeps(), '11:05'
    );
    assert.equal(result.status, 'failed');
  });
});

// ─────────────────────────────────────────────
// TC-F-039: PIN 만료 처리
// ─────────────────────────────────────────────
describe('TC-F-039: PIN 만료 — expirePin 호출 검증', () => {
  test('expirePin에 entityId 전달됨', async () => {
    let calledEntityId = null;

    await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(),
      makeDeps({ expirePin: async (id) => { calledEntityId = id; } }),
      '11:05'
    );

    assert.ok(calledEntityId, 'entityId가 전달되어야 함');
    assert.ok(calledEntityId.includes('p_042') || calledEntityId.includes('P-042') || calledEntityId.includes('lock'), `entityId: ${calledEntityId}`);
  });

  test('expirePin 실패 → status=partial, error 알림 생성', async () => {
    const alerts = [];

    const result = await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(),
      makeDeps({
        expirePin: async () => { throw new Error('HA lock service unavailable'); },
        addAlert:  (a) => alerts.push(a),
      }),
      '11:05'
    );

    assert.equal(result.status, 'partial');
    assert.ok(result.error.includes('HA lock service unavailable'));
    const errorAlerts = alerts.filter(a => a.type === 'error');
    assert.ok(errorAlerts.length > 0, '에러 알림 생성되어야 함');
  });
});

// ─────────────────────────────────────────────
// TC-F-040: 청소팀 자동 배정
// ─────────────────────────────────────────────
describe('TC-F-040: 청소팀 자동 배정 — activeJobs 최소 선택', () => {
  test('가용 청소팀 중 activeJobs 최소 팀 배정됨', async () => {
    let savedAssignment = null;

    await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(),
      makeDeps({ setAssignment: (_, a) => { savedAssignment = a; } }),
      '11:05'
    );

    assert.ok(savedAssignment, '배정 저장되어야 함');
    assert.equal(savedAssignment.cleanerId, 'C-02', '가장 적은 activeJobs 청소팀 선택');
    assert.equal(savedAssignment.status, 'assigned');
  });

  test('청소팀 없으면 → partial', async () => {
    const alerts = [];
    const result = await handleCheckout(
      makeEvent(), [makeBooking()], [],
      makeDeps({ addAlert: (a) => alerts.push(a) }),
      '11:05'
    );
    assert.equal(result.status, 'partial');
  });
});

// ─────────────────────────────────────────────
// TC-F-041: 체크리스트 생성
// ─────────────────────────────────────────────
describe('TC-F-041: 체크리스트 생성 — 표준 8개 항목', () => {
  test('setChecklist에 8개 항목 전달됨', async () => {
    let savedItems = null;

    await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(),
      makeDeps({ setChecklist: (_, items) => { savedItems = items; } }),
      '11:05'
    );

    assert.ok(savedItems, '체크리스트 저장되어야 함');
    assert.equal(savedItems.length, 8);
    assert.ok(savedItems.every(i => i.done === false), '초기값 모두 false');
  });

  test('체크리스트 propId와 이벤트 propId 일치', async () => {
    let savedItems = null;

    await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(),
      makeDeps({ setChecklist: (_, items) => { savedItems = items; } }),
      '11:05'
    );

    assert.ok(savedItems.every(i => i.id.includes('P-042')));
  });
});

// ─────────────────────────────────────────────
// TC-F-042: 알림 내용 검증
// ─────────────────────────────────────────────
describe('TC-F-042: 알림 내용 검증', () => {
  test('첫 알림 = 체크아웃 완료 (guestName + propId 포함)', async () => {
    const alerts = [];

    await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(),
      makeDeps({ addAlert: (a) => alerts.push(a) }),
      '11:05'
    );

    assert.ok(alerts[0].msg.includes('P-042'), `알림: ${alerts[0].msg}`);
    assert.ok(alerts[0].msg.includes('김민준'), `알림: ${alerts[0].msg}`);
  });

  test('두 번째 알림 = 청소 배정 완료 (cleanerName 포함)', async () => {
    const alerts = [];

    await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(),
      makeDeps({ addAlert: (a) => alerts.push(a) }),
      '11:05'
    );

    assert.ok(alerts[1].msg.includes('이청소'), `알림: ${alerts[1].msg}`);
    assert.ok(alerts[1].msg.includes('P-042'), `알림: ${alerts[1].msg}`);
  });
});

// ─────────────────────────────────────────────
// TC-F-043: manual_checkout 이벤트 처리
// ─────────────────────────────────────────────
describe('TC-F-043: manual_checkout 이벤트도 처리됨', () => {
  test('manual_checkout + 시간창 내 → success', async () => {
    const result = await handleCheckout(
      makeEvent({ event: 'manual_checkout' }),
      [makeBooking()], makeCleaners(), makeDeps(), '11:05'
    );
    assert.equal(result.status, 'success');
  });
});

// ─────────────────────────────────────────────
// TC-F-044: 청소 항목 완료 처리
// ─────────────────────────────────────────────
describe('TC-F-044: completeChecklistItem — 항목 완료 처리', () => {
  test('updateChecklistItem(propId, itemId, true) 호출됨', () => {
    let called = null;

    completeChecklistItem('P-042', 'P-042-cl-01', {
      updateChecklistItem: (propId, itemId, done) => {
        called = { propId, itemId, done };
      },
    });

    assert.ok(called, 'updateChecklistItem 호출되어야 함');
    assert.equal(called.propId, 'P-042');
    assert.equal(called.itemId, 'P-042-cl-01');
    assert.equal(called.done,   true);
  });

  test('propId 없으면 에러', () => {
    assert.throws(
      () => completeChecklistItem('', 'item-1', makeDeps()),
      /required/
    );
  });

  test('itemId 없으면 에러', () => {
    assert.throws(
      () => completeChecklistItem('P-042', '', makeDeps()),
      /required/
    );
  });
});

// ─────────────────────────────────────────────
// TC-F-045: 전체 청소 완료 처리
// ─────────────────────────────────────────────
describe('TC-F-045: finalizeClean — 청소 완료 → vacant', () => {
  test('updateStatus(propId, "vacant") 호출됨', () => {
    let updatedStatus = null;

    finalizeClean('P-042', {
      updateStatus: (_, s) => { updatedStatus = s; },
      addAlert:     () => {},
    });

    assert.equal(updatedStatus, 'vacant');
  });

  test('info 알림 생성됨 (propId 포함)', () => {
    const alerts = [];

    finalizeClean('P-042', {
      updateStatus: () => {},
      addAlert:     (a) => alerts.push(a),
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'info');
    assert.ok(alerts[0].msg.includes('P-042'), `알림: ${alerts[0].msg}`);
  });

  test('propId 없으면 에러', () => {
    assert.throws(() => finalizeClean('', makeDeps()), /required/);
  });
});

// ─────────────────────────────────────────────
// TC-F-046: 감사 메시지 발송 (선택)
// ─────────────────────────────────────────────
describe('TC-F-046: 체크아웃 감사 메시지 발송', () => {
  test('sendMessage 제공 시 guestId로 발송됨', async () => {
    let sentGuestId = null;
    let sentText    = null;

    await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(),
      makeDeps({
        sendMessage: async (guestId, text) => {
          sentGuestId = guestId;
          sentText    = text;
        },
      }),
      '11:05'
    );

    assert.equal(sentGuestId, 'guest-001');
    assert.ok(sentText && sentText.includes('김민준'), `메시지: ${sentText}`);
  });

  test('sendMessage 실패해도 전체 status=success 유지', async () => {
    const result = await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(),
      makeDeps({
        sendMessage: async () => { throw new Error('메시지 채널 오류'); },
      }),
      '11:05'
    );

    assert.equal(result.status, 'success');
  });

  test('sendMessage 미제공 시 에러 없이 처리됨', async () => {
    const deps = makeDeps();
    delete deps.sendMessage;

    const result = await handleCheckout(
      makeEvent(), [makeBooking()], makeCleaners(), deps, '11:05'
    );

    assert.equal(result.status, 'success');
  });
});

// ─────────────────────────────────────────────
// TC-F-047: 인수 누락 예외
// ─────────────────────────────────────────────
describe('TC-F-047: handleCheckout — 인수 누락 예외', () => {
  test('event 없으면 에러', async () => {
    await assert.rejects(
      () => handleCheckout(null, [makeBooking()], makeCleaners(), makeDeps(), '11:05'),
      /required/
    );
  });

  test('allBookings 없으면 에러', async () => {
    await assert.rejects(
      () => handleCheckout(makeEvent(), null, makeCleaners(), makeDeps(), '11:05'),
      /required/
    );
  });

  test('cleaners 없으면 에러', async () => {
    await assert.rejects(
      () => handleCheckout(makeEvent(), [makeBooking()], null, makeDeps(), '11:05'),
      /required/
    );
  });
});
