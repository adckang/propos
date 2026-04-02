'use strict';

const { isCheckinEvent }                                         = require('../domain/checkinDomain.js');
const { buildCheckinConfirmMessage, buildPinLockoutAlert }       = require('../domain/messageDomain.js');

/**
 * 도어락 열림 이벤트 수신 → 체크인 판별 → 씬/채팅 자동화 (UC-002)
 *
 * 오케스트레이션 순서:
 *   1. allBookings에서 event.propId 예약 조회
 *   2. isCheckinEvent()          → 체크인 여부 판별 (false면 조기 종료)
 *   3. deps.activateScene(...)   → 체크인 웰컴 씬 실행
 *   4. buildCheckinConfirmMessage() → 입실 확인 메시지 텍스트 생성
 *   5. deps.openChannel(booking) → 게스트 채팅 채널 오픈
 *   6. deps.sendMessage(...)     → 입실 확인 메시지 발송
 *   7. deps.updateStatus(...)    → 숙소 상태 "occupied" 갱신
 *   8. deps.addAlert(...)        → 완료 알림
 *
 * @param {{ event: string, propId: string, time: string, context?: string }} haEvent
 * @param {Array}    allBookings
 * @param {Object}   deps
 * @param {Function} deps.activateScene  - async (entityId) => void
 * @param {Function} deps.openChannel    - async (booking) => void
 * @param {Function} deps.sendMessage    - async (guestId, text) => void
 * @param {Function} deps.updateStatus   - (propId, status) => void
 * @param {Function} deps.addAlert       - (alert) => void
 * @param {string}   [now]               - "HH:MM" (테스트 주입용)
 * @returns {Promise<S02Result|null>}    null = 체크인 이벤트 아님
 */
async function handleDoorUnlocked(haEvent, allBookings, deps, now) {
  const booking = (allBookings || []).find(b => b.propId === haEvent.propId);

  if (!booking) return null;

  const currentTime = now || _nowHHMM();

  if (!isCheckinEvent(haEvent, booking, currentTime)) return null;

  const result = {
    propId: booking.propId,
    status: 'success',
    steps:  { scene: false, channel: false, message: false },
    error:  null,
  };

  // Step 1: 체크인 웰컴 씬 실행
  try {
    const sceneId = `scene.checkin_welcome_${booking.propId.toLowerCase().replace('-', '_')}`;
    await deps.activateScene(sceneId);
    result.steps.scene = true;
  } catch (err) {
    result.status = 'failed';
    result.error  = `씬 실행 실패: ${err.message}`;
    deps.addAlert({ type: 'error', prop: booking.propId, msg: result.error, time: haEvent.time });
    return result;
  }

  // Step 2: 입실 확인 메시지 텍스트 생성 (time 누락 시 현재 시각으로 보완)
  const confirmText = buildCheckinConfirmMessage(booking, haEvent.time || _nowHHMM());

  // Step 3: 게스트 채팅 채널 오픈
  try {
    await deps.openChannel(booking);
    result.steps.channel = true;
  } catch (err) {
    result.status = 'partial';
    result.error  = `채팅 채널 오픈 실패: ${err.message}`;
    deps.addAlert({ type: 'warn', prop: booking.propId, msg: result.error, time: haEvent.time });
  }

  // Step 4: 입실 확인 메시지 발송
  try {
    await deps.sendMessage(booking.guestId, confirmText);
    result.steps.message = true;
  } catch (err) {
    if (result.status === 'success') result.status = 'partial';
    result.error = `메시지 발송 실패: ${err.message}`;
    deps.addAlert({ type: 'warn', prop: booking.propId, msg: result.error, time: haEvent.time });
  }

  // Step 5: 숙소 상태 갱신 + 완료 알림
  deps.updateStatus(booking.propId, 'occupied');

  if (result.status === 'success') {
    deps.addAlert({
      type: 'info',
      prop: booking.propId,
      msg:  `입실 감지 — ${booking.guestName}님 체크인 완료 (${haEvent.time})`,
      time: haEvent.time,
    });
  }

  return result;
}

/**
 * PIN 오류 3회 초과 이벤트 → 긴급 알림 생성
 *
 * @param {{ propId: string, failCount: number, time: string }} haEvent
 * @param {Object}   deps
 * @param {Function} deps.addAlert  - (alert) => void
 * @returns {void}
 */
function handlePinLockout(haEvent, deps) {
  const text = buildPinLockoutAlert(haEvent.propId, haEvent.failCount);
  deps.addAlert({
    type: 'error',
    prop: haEvent.propId,
    msg:  text,
    time: haEvent.time,
  });
}

function _nowHHMM() {
  const d = new Date();
  return d.getUTCHours().toString().padStart(2, '0') + ':' +
         d.getUTCMinutes().toString().padStart(2, '0');
}

module.exports = { handleDoorUnlocked, handlePinLockout };
