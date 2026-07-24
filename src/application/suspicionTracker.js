/**
 * SuspicionTracker — 의심(Suspicion) → 확신(Confirmation) 상태 관리 (Layer 2)
 *
 * SensorEventGenerator의 EXIT/ENTRY 이벤트 + 예약 정보 + 현재 상태를 받아
 * 상태 기계 이벤트를 생성하거나 의심 상태를 기록한다.
 *
 * 상태 전환 이벤트 (getNextRoomState 대상):
 *   check_out_detected, check_in_detected, cleaning_started, cleaning_finished
 *
 * Soft 이벤트 (ConfirmationManager 라우팅, 상태 전환 없음):
 *   checkout_confirmation_needed, early_checkin_suspected, no_show_suspected
 *
 * 설계 문서: docs/event-detection-design.md 섹션 4
 */

export class SuspicionTracker {
  // 퇴실 의심
  checkoutSuspectedAt = null;
  checkoutExitAt      = null;
  caseAFiredAt        = null;  // Late checkout 확인 메시지 발송 시각
  caseBFiredAt        = null;  // 조기 퇴실 확인 메시지 발송 시각

  // 체크인 의심
  checkinSuspectedAt  = null;
  noShowFiredAt       = null;

  // 청소 의심
  cleaningStartAt     = null;
  cleaningMotionStart = null;
  cleaningDoneAt      = null;

  /**
   * @param {object} p
   * @param {{ exit, exitAt, entry, entryAt }} p.sensorResult
   * @param {{ mainStatus, subStatus }} p.roomState
   * @param {{ checkIn?: Date, checkOut?: Date }|null} p.reservation
   * @param {boolean} p.motionNow
   * @param {number|null} p.acPower   - W 단위, null=센서 없음
   * @param {number|null} p.noiseLevel - dB 단위, null=센서 없음
   * @param {number} p.now
   * @param {object} p.cfg
   */
  evaluate({ sensorResult, roomState, reservation, motionNow, acPower, noiseLevel, now, cfg }) {
    const events = [];
    const { exit, exitAt, entry } = sensorResult;
    const main      = roomState?.mainStatus;
    const sub       = roomState?.subStatus;
    const checkOutMs = reservation?.checkOut?.getTime() ?? null;
    const checkInMs  = reservation?.checkIn?.getTime()  ?? null;

    // ── OCCUPIED: 퇴실 감지 ──────────────────────────────────────────────────
    if (main === 'OCCUPIED') {
      let checkoutFired = false;

      // ENTRY → 퇴실 의심 취소
      if (entry && this.checkoutSuspectedAt !== null) {
        this._resetCheckout();
      }

      // EXIT 처리
      if (exit) {
        if (checkOutMs !== null && now >= checkOutMs) {
          events.push({
            type: 'check_out_detected',
            reason: `퇴실 확인 — 체크아웃 시각 경과 후 EXIT 감지 (퇴실: ${_fmtTime(exitAt)})`,
            timestamp: now,
          });
          this._resetCheckout();
          checkoutFired = true;
        } else if (this.checkoutSuspectedAt === null) {
          this.checkoutSuspectedAt = now;
          this.checkoutExitAt      = exitAt ?? now;
        }
      }

      // 의심 상태 + checkOut 도래 + 모션 없음 → check_out_detected
      if (!checkoutFired && this.checkoutSuspectedAt !== null && checkOutMs !== null
          && now >= checkOutMs && !motionNow) {
        const minBefore = Math.round((checkOutMs - this.checkoutSuspectedAt) / 60_000);
        events.push({
          type: 'check_out_detected',
          reason: `퇴실 확인 — 체크아웃 ${minBefore}분 전 퇴실 감지 후 체크아웃 시각 도래`,
          timestamp: now,
        });
        this._resetCheckout();
        checkoutFired = true;
      }

      // 의심 만료
      if (!checkoutFired && this.checkoutSuspectedAt !== null && checkOutMs !== null
          && now > checkOutMs + cfg.SUSPICION_EXPIRE_MS) {
        this._resetCheckout();
      }

      // [Soft] Case A — Late Checkout: checkOut + GRACE 경과 + 점유 징후
      if (!checkoutFired && checkOutMs !== null && now > checkOutMs + cfg.CHECKOUT_GRACE_MS
          && this.caseAFiredAt === null) {
        const hasOccupiedSignal = motionNow
          || (acPower  !== null && acPower  > cfg.AC_ON)
          || (noiseLevel !== null && noiseLevel > cfg.NOISE_QUIET_DB);
        if (hasOccupiedSignal) {
          events.push({
            type:       'checkout_confirmation_needed',
            subType:    'late_checkout',
            reason:     '체크아웃 시각 경과 후 점유 징후 감지 — 게스트 퇴실 여부 확인 필요',
            recipients: ['guest'],
            timestamp:  now,
          });
          this.caseAFiredAt = now;
        }
      }

      // [Soft] Case B — Early Checkout: EXIT + EARLY_CHECKOUT_QUIET 경과 + 방 비어있음
      if (this.checkoutSuspectedAt !== null && checkOutMs !== null && now < checkOutMs
          && this.caseBFiredAt === null) {
        const quietElapsed = now - this.checkoutSuspectedAt;
        const isQuiet = !motionNow
          && (acPower   === null || acPower   < cfg.AC_ON)
          && (noiseLevel === null || noiseLevel < cfg.NOISE_QUIET_DB);
        if (isQuiet && quietElapsed >= cfg.EARLY_CHECKOUT_QUIET_MS) {
          events.push({
            type:       'checkout_confirmation_needed',
            subType:    'early_checkout',
            reason:     '체크아웃 시각 전 퇴실 징후 — 조용한 방 유지 중 (청소팀 조기 배정 가능)',
            recipients: ['guest'],
            timestamp:  now,
          });
          this.caseBFiredAt = now;
        }
      }
    }

    // ── PRE_STAY_READY: 체크인 감지 + 조기 체크인 + 노쇼 ────────────────────
    if (main === 'PRE_STAY_READY' && (sub === 'OPTIMIZED' || sub === 'OPTIMIZING')) {
      let checkinFired = false;

      // 버그 fix: 조기 체크인 후 checkIn 시각 도래 → check_in_detected
      if (sub === 'OPTIMIZED' && this.checkinSuspectedAt !== null
          && checkInMs !== null && now >= checkInMs) {
        events.push({
          type:   'check_in_detected',
          reason: '조기 체크인 확인 — 체크인 시각 도래',
          timestamp: now,
        });
        this._resetCheckin();
        checkinFired = true;
      } else if (entry) {
        if (checkInMs === null || now >= checkInMs) {
          if (sub === 'OPTIMIZED') {
            events.push({
              type:   'check_in_detected',
              reason: '체크인 확인 — 도어 이벤트 후 입실 감지',
              timestamp: now,
            });
            this._resetCheckin();
          }
          // OPTIMIZING: check_in_detected 발화 안함 (state machine 전환 불가)
        } else if (this.checkinSuspectedAt === null) {
          // [Soft] early_checkin_suspected: checkIn 시각 이전 ENTRY
          this.checkinSuspectedAt = now;
          const minsLeft = Math.round((checkInMs - now) / 60_000);
          events.push({
            type:       'early_checkin_suspected',
            reason:     `조기 체크인 감지 — 예약 체크인까지 ${minsLeft}분 남음`,
            recipients: ['guest'],
            timestamp:  now,
          });
        }
      }

      // [Soft] no_show_suspected: max(checkIn + NO_SHOW_WINDOW, 당일 자정) 초과 + ENTRY 없음
      if (!checkinFired && checkInMs !== null && this.noShowFiredAt === null && this.checkinSuspectedAt === null) {
        const threshold = Math.max(checkInMs + cfg.NO_SHOW_WINDOW_MS, _midnightAfter(checkInMs));
        if (now >= threshold) {
          events.push({
            type:       'no_show_suspected',
            reason:     '체크인 예정 시각 경과 후 입실 감지 없음 — 노쇼 가능성',
            recipients: ['guest', 'host'],
            timestamp:  now,
          });
          this.noShowFiredAt = now;
        }
      }
    }

    // ── CLEANING/CLEANING_PENDING: 청소 시작 감지 ─────────────────────────────
    if (main === 'CLEANING' && sub === 'CLEANING_PENDING') {
      if (entry && this.cleaningStartAt === null) {
        this.cleaningStartAt     = now;
        this.cleaningMotionStart = now;
      }
      if (this.cleaningStartAt !== null) {
        if (motionNow) {
          const sustainedMs = now - (this.cleaningMotionStart ?? now);
          if (sustainedMs >= cfg.CLEANING_SUSTAINED_MS) {
            events.push({
              type:   'cleaning_started',
              reason: `청소 시작 확인 — ${Math.round(sustainedMs / 60_000)}분 활동 지속`,
              timestamp: now,
            });
            this._resetCleaningStart();
          }
        } else if (exit) {
          const stayedMs = now - this.cleaningStartAt;
          if (stayedMs < cfg.CLEANING_SUSTAINED_MS) this._resetCleaningStart();
        }
      }
    }

    // ── CLEANING/CLEANING_IN_PROGRESS: 청소 완료 감지 ────────────────────────
    if (main === 'CLEANING' && sub === 'CLEANING_IN_PROGRESS') {
      if (entry && this.cleaningDoneAt !== null) this._resetCleaningDone();
      if (exit && this.cleaningDoneAt === null) this.cleaningDoneAt = now;
      if (this.cleaningDoneAt !== null && !motionNow) {
        const quietMs = now - this.cleaningDoneAt;
        if (quietMs >= cfg.CLEANING_DONE_QUIET_MS) {
          events.push({
            type:   'cleaning_finished',
            reason: `청소 완료 확인 — 퇴장 후 ${Math.round(quietMs / 60_000)}분 조용`,
            timestamp: now,
          });
          this._resetCleaningDone();
        }
      }
    }

    return events;
  }

  _resetCheckout() {
    this.checkoutSuspectedAt = null;
    this.checkoutExitAt      = null;
    this.caseAFiredAt        = null;
    this.caseBFiredAt        = null;
  }
  _resetCheckin() {
    this.checkinSuspectedAt = null;
    this.noShowFiredAt      = null;
  }
  _resetCleaningStart() { this.cleaningStartAt = null; this.cleaningMotionStart = null; }
  _resetCleaningDone()  { this.cleaningDoneAt  = null; }
}

function _fmtTime(ts) {
  if (ts == null) return '?';
  return new Date(ts).toLocaleTimeString('ko-KR');
}

function _midnightAfter(checkInMs) {
  const d = new Date(checkInMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}
