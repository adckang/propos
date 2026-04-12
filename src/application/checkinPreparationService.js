import { filterTomorrowCheckIns } from "../domain/bookingDomain.js";
import { generatePIN, calcExpiry } from "../domain/pinDomain.js";
import { buildWelcomeMessage } from "../domain/messageDomain.js";

function cloneResult(result) {
  return {
    ...result,
    steps: { ...result.steps },
    expiry: result.expiry ? { ...result.expiry } : result.expiry,
  };
}

function emitProgress(onProgress, results, currentResult) {
  if (typeof onProgress !== 'function') return;
  const snapshot = [
    ...results.map(cloneResult),
    ...(currentResult ? [cloneResult(currentResult)] : []),
  ];
  onProgress(snapshot);
}

/**
 * D-1 자동화 메인 진입점 (UC-001)
 *
 * 오케스트레이션 순서 (숙소별):
 *   1. filterTomorrowCheckIns  → 대상 숙소 확정
 *   2. generatePIN + calcExpiry → PIN 생성
 *   3. deps.setLockCode(...)   → HA 도어락 등록
 *   4. buildWelcomeMessage()   → 메시지 텍스트 생성
 *   5. deps.sendMessage(...)   → 게스트 메시지 발송
 *   6. deps.activateScene(...) → 스마트홈 초기화
 *   7. deps.addAlert(...)      → 완료 알림
 *
 * 개별 숙소 실패는 error 알림 후 다음 숙소 계속 처리.
 *
 * @param {Array}    allBookings
 * @param {string}   today       - "YYYY-MM-DD" (테스트 주입용)
 * @param {Object}   deps
 * @param {Function} deps.setLockCode    - async (entityId, code, name) => void
 * @param {Function} deps.activateScene  - async (entityId) => void
 * @param {Function} deps.sendMessage    - async (guestId, text) => void
 * @param {Function} deps.addAlert       - (alert) => void
 * @returns {Promise<Array>} D1Result[]
 */
export async function runD1Automation(allBookings, today, deps, options = {}) {
  const targets = filterTomorrowCheckIns(allBookings, today);
  const onProgress = options.onProgress;

  if (targets.length === 0) return [];

  const results = [];

  for (const booking of targets) {
    const result = {
      propId: booking.propId,
      propName: booking.propName ?? booking.propId,
      guestName: booking.guestName ?? "",
      status: 'success',
      steps:  { pin: false, message: false, smartHome: false },
      pin: null,
      expiry: null,
      welcomeMsg: null,
      sceneId: null,
      error:  null,
    };

    result.status = 'running';
    emitProgress(onProgress, results, result);

    // Step 1: PIN 생성
    const pin      = generatePIN();
    const expiry   = calcExpiry(booking.checkIn, booking.checkOut);
    const pinRecord = { pin, ...expiry, propId: booking.propId, guestName: booking.guestName };
    result.pin = pin;
    result.expiry = expiry;
    emitProgress(onProgress, results, result);

    // Step 2: 도어락 PIN 등록
    try {
      const entityId = `lock.front_door_${booking.propId.toLowerCase().replace('-', '_')}`;
      await deps.setLockCode(entityId, pin, `guest_${booking.guestName}`);
      result.steps.pin = true;
      emitProgress(onProgress, results, result);
    } catch (err) {
      result.status = 'failed';
      result.error  = `PIN 등록 실패: ${err.message}`;
      deps.addAlert({ type: 'error', prop: booking.propId, msg: result.error, time: _nowHHMM() });
      results.push(result);
      emitProgress(onProgress, results);
      continue;
    }

    // Step 3: 웰컴 메시지 발송
    try {
      const text = buildWelcomeMessage(booking, pinRecord);
      result.welcomeMsg = text;
      await deps.sendMessage(booking.guestId, text);
      result.steps.message = true;
      emitProgress(onProgress, results, result);
    } catch (err) {
      result.status = 'partial';
      result.error  = `메시지 발송 실패: ${err.message}`;
      deps.addAlert({ type: 'warn', prop: booking.propId, msg: result.error, time: _nowHHMM() });
      emitProgress(onProgress, results, result);
    }

    // Step 4: 스마트홈 초기화
    try {
      const sceneId = `scene.checkin_ready_${booking.propId.toLowerCase().replace('-', '_')}`;
      result.sceneId = sceneId;
      await deps.activateScene(sceneId);
      result.steps.smartHome = true;
      emitProgress(onProgress, results, result);
    } catch (err) {
      if (result.status === 'running') result.status = 'partial';
      result.error = `스마트홈 초기화 실패: ${err.message}`;
      deps.addAlert({ type: 'warn', prop: booking.propId, msg: result.error, time: _nowHHMM() });
      emitProgress(onProgress, results, result);
    }

    // Step 5: 완료 알림
    if (result.status === 'running') {
      result.status = 'success';
    }

    if (result.status === 'success') {
      deps.addAlert({
        type: 'info',
        prop: booking.propId,
        msg:  `D-1 자동화 완료 (PIN 발급·메시지·스마트홈)`,
        time: _nowHHMM(),
      });
    }

    results.push(result);
    emitProgress(onProgress, results);
  }

  return results;
}

function _nowHHMM() {
  const d = new Date();
  return d.getUTCHours().toString().padStart(2, '0') + ':' +
         d.getUTCMinutes().toString().padStart(2, '0');
}

export default { runD1Automation };
