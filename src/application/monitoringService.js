'use strict';

const { isAnomaly, buildAnomalyAlert, getDefaultThresholds } = require('../domain/sensorDomain.js');
const { buildReplyDraft }                                     = require('../domain/messageDomain.js');

/**
 * 단일 숙소 센서 1회 폴링 → 이상 감지 → 알림/상태 갱신
 *
 * 오케스트레이션 순서:
 *   1. deps.getSensorStates(propId)         → SensorReading 조회
 *   2. sensorDomain.isAnomaly()             → AnomalyResult 판별
 *   3. deps.updateReadings(propId, reading) → UI 센서 카드 갱신
 *   4. anomaly.isAnomaly === true 이면:
 *      → sensorDomain.buildAnomalyAlert()   → 알림 텍스트 생성
 *      → deps.addAlert({ type: severity })  → 알림 피드 추가
 *
 * @param {string}     propId
 * @param {Thresholds} thresholds
 * @param {Object}     deps
 * @param {Function}   deps.getSensorStates  - async (propId) => SensorReading
 * @param {Function}   deps.updateReadings   - (propId, reading) => void
 * @param {Function}   deps.addAlert         - (alert) => void
 * @returns {Promise<S03PollResult>}
 */
async function pollSensors(propId, thresholds, deps) {
  let reading = null;
  let anomaly = null;

  try {
    reading = await deps.getSensorStates(propId);

    anomaly = isAnomaly(reading, thresholds);

    deps.updateReadings(propId, reading);

    if (anomaly.isAnomaly) {
      const alertMsg = buildAnomalyAlert(propId, reading, anomaly);
      deps.addAlert({
        type: anomaly.severity === 'critical' ? 'error' : 'warn',
        prop: propId,
        msg:  alertMsg,
        time: reading.time || _nowHHMM(),
      });
    }

    return {
      propId,
      status:  anomaly.isAnomaly ? 'anomaly' : 'ok',
      reading,
      anomaly,
      error:   null,
    };
  } catch (err) {
    // 폴링 실패 시 warn 알림만 생성하고 stale 데이터 유지
    deps.addAlert({
      type: 'warn',
      prop: propId,
      msg:  `센서 폴링 실패 (${propId}): ${err.message} — 마지막 정상값 유지`,
      time: _nowHHMM(),
    });

    return {
      propId,
      status:  'error',
      reading: reading,
      anomaly: null,
      error:   err.message,
    };
  }
}

/**
 * 여러 숙소 일괄 폴링 (propIds 순차 처리)
 * 개별 실패는 error status로 기록 후 다음 숙소 계속 처리
 *
 * @param {string[]}   propIds
 * @param {Thresholds} thresholds
 * @param {Object}     deps
 * @returns {Promise<S03PollResult[]>}
 */
async function pollAll(propIds, thresholds, deps) {
  const results = [];

  for (const propId of propIds) {
    const result = await pollSensors(propId, thresholds, deps);
    results.push(result);
  }

  return results;
}

/**
 * 게스트 메시지 수신 → AI 답장 초안 생성 → UI에 전달
 *
 * @param {{ id: string, guestId: string, text: string, time: string }} msg
 * @param {Booking}  booking
 * @param {Object}   deps
 * @param {Function} deps.setDraft   - (propId, draftText) => void
 * @param {Function} deps.addAlert   - (alert) => void
 * @returns {void}
 */
function handleGuestMessage(msg, booking, deps) {
  if (!msg)     throw new Error('msg is required');
  if (!booking) throw new Error('booking is required');

  const draft = buildReplyDraft(msg.text, booking);

  deps.setDraft(booking.propId, draft);

  deps.addAlert({
    type: 'info',
    prop: booking.propId,
    msg:  `게스트 메시지 수신 → AI 답장 초안 생성 완료`,
    time: msg.time || _nowHHMM(),
  });
}

function _nowHHMM() {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' +
         d.getMinutes().toString().padStart(2, '0');
}

module.exports = { pollSensors, pollAll, handleGuestMessage };
