'use strict';

const {
  isCheckoutEvent,
  assignCleaner,
  buildChecklist,
  buildCheckoutAlert,
  buildCleanerAssignAlert,
} = require('../domain/checkoutDomain.js');

const { buildCheckoutThankYouMessage } = require('../domain/messageDomain.js');

/**
 * 퇴실 이벤트 수신 → 체크아웃 판별 → PIN 만료 → 청소팀 배정 → 체크리스트 생성
 *
 * 오케스트레이션 순서:
 *   1. allBookings에서 event.propId 예약 조회
 *   2. isCheckoutEvent() → 체크아웃 여부 판별
 *   3. deps.expirePin() → PIN 즉시 만료
 *   4. buildCheckoutAlert() + deps.addAlert() → 체크아웃 완료 알림
 *   5. assignCleaner() → 청소팀 배정
 *   6. buildChecklist() → 체크리스트 생성
 *   7. deps.setAssignment() + deps.setChecklist() → 저장
 *   8. deps.updateStatus("cleaning") → 숙소 상태 갱신
 *   9. buildCleanerAssignAlert() + deps.addAlert() → 청소 배정 알림
 *
 * @param {{ event: string, propId: string, time: string }} event
 * @param {Array}    allBookings  - 전체 예약 목록
 * @param {Array}    cleaners     - 청소팀 목록
 * @param {Object}   deps
 * @param {Function} deps.expirePin       - async (entityId) => void
 * @param {Function} deps.addAlert        - (alert) => void
 * @param {Function} deps.updateStatus    - (propId, status) => void
 * @param {Function} deps.setAssignment   - (propId, assignment) => void
 * @param {Function} deps.setChecklist    - (propId, items) => void
 * @param {Function} [deps.sendMessage]   - async (guestId, text) => void (선택)
 * @param {string}   [now]               - "HH:MM" (테스트 주입용)
 * @returns {Promise<{ propId, status, steps, error }>}
 */
async function handleCheckout(event, allBookings, cleaners, deps, now) {
  if (!event)       throw new Error('event is required');
  if (!allBookings) throw new Error('allBookings is required');
  if (!cleaners)    throw new Error('cleaners is required');

  const propId   = event.propId;
  const booking  = allBookings.find(b => b.propId === propId);
  const nowStr   = now || _nowHHMM();

  const steps = { pinExpired: false, cleanerAssigned: false, checklistCreated: false };

  // 체크아웃 이벤트 아니면 조기 종료
  if (!booking || !isCheckoutEvent(event, booking, nowStr)) {
    return { propId, status: 'failed', steps, error: '체크아웃 이벤트 아님' };
  }

  const checkoutTime = event.time || nowStr;

  try {
    // Step 3: PIN 즉시 만료
    const entityId = `lock.front_door_${propId.toLowerCase().replace('-', '_')}`;
    await deps.expirePin(entityId);
    steps.pinExpired = true;

    // Step 4: 체크아웃 완료 알림
    const checkoutAlertMsg = buildCheckoutAlert(propId, booking.guestName, checkoutTime);
    deps.addAlert({ type: 'info', prop: propId, msg: checkoutAlertMsg, time: checkoutTime });

    // Step 5: 청소팀 배정
    const assignment = assignCleaner(cleaners, propId, checkoutTime);
    steps.cleanerAssigned = true;

    // Step 6: 체크리스트 생성
    const checklistItems = buildChecklist(propId);
    steps.checklistCreated = true;

    // Step 7: 저장
    deps.setAssignment(propId, assignment);
    deps.setChecklist(propId, checklistItems);

    // Step 8: 숙소 상태 갱신
    deps.updateStatus(propId, 'cleaning');

    // Step 9: 청소 배정 완료 알림
    const cleanerAlertMsg = buildCleanerAssignAlert(propId, assignment);
    deps.addAlert({ type: 'info', prop: propId, msg: cleanerAlertMsg, time: checkoutTime });

    // 체크아웃 감사 메시지 발송 (선택)
    if (deps.sendMessage && booking.guestId) {
      const thankYou = buildCheckoutThankYouMessage(booking);
      try {
        await deps.sendMessage(booking.guestId, thankYou);
      } catch (_) {
        // 메시지 발송 실패는 전체 흐름 중단하지 않음
      }
    }

    return { propId, status: 'success', steps, error: null };
  } catch (err) {
    deps.addAlert({
      type: 'error',
      prop: propId,
      msg:  `체크아웃 자동화 오류 (${propId}): ${err.message}`,
      time: checkoutTime,
    });
    return { propId, status: 'partial', steps, error: err.message };
  }
}

/**
 * 청소 항목 완료 처리
 * @param {string}   propId
 * @param {string}   itemId
 * @param {Object}   deps
 * @param {Function} deps.updateChecklistItem - (propId, itemId, done) => void
 * @returns {void}
 */
function completeChecklistItem(propId, itemId, deps) {
  if (!propId) throw new Error('propId is required');
  if (!itemId) throw new Error('itemId is required');

  deps.updateChecklistItem(propId, itemId, true);
}

/**
 * 전체 청소 완료 → 숙소 상태 "vacant"으로 변경
 * @param {string}   propId
 * @param {Object}   deps
 * @param {Function} deps.updateStatus - (propId, status) => void
 * @param {Function} deps.addAlert     - (alert) => void
 * @returns {void}
 */
function finalizeClean(propId, deps) {
  if (!propId) throw new Error('propId is required');

  deps.updateStatus(propId, 'vacant');
  deps.addAlert({
    type: 'info',
    prop: propId,
    msg:  `${propId} 청소 완료 — 숙소 준비 완료`,
    time: _nowHHMM(),
  });
}

function _nowHHMM() {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' +
         d.getMinutes().toString().padStart(2, '0');
}

module.exports = { handleCheckout, completeChecklistItem, finalizeClean };
