/**
 * SuspicionTracker — 의심(Suspicion) → 확신(Confirmation) 상태 관리 (Layer 2)
 *
 * SensorEventGenerator의 EXIT/ENTRY 이벤트 + 예약 정보 + 현재 상태를 받아
 * 상태 기계 이벤트를 생성하거나 의심 상태를 기록한다.
 *
 * 상태 전환 이벤트 (getNextRoomState 대상):
 *   scheduled_checkout_reached, check_in_detected, cleaning_started, cleaning_finished
 *
 * 문제 이벤트 (상태 전환 없음, 문제·이상 건수에 포함):
 *   late_checkout_detected — 예정 체크아웃 + 유예 시간까지 실제 퇴실 미확인 (예약당 1건)
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
  caseBFiredAt        = null;  // 조기 퇴실 확인 메시지 발송 시각
  scheduledCheckoutKey = null; // 예정 체크아웃 전환을 이미 낸 예약 (예약당 1회)
  lateCheckoutWatch    = null; // 전환 뒤 실제 퇴실을 기다리는 중인 예약 { checkOutMs, deadline, leftBeforeCheckout, data }

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
      // 예약과 퇴실 시각이 같을 때만 같은 퇴실이다 — 같은 예약이라도 퇴실 시각이 바뀌면(연장) 다시 전환한다
      const checkoutKey = checkOutMs !== null
        ? `${reservation?.uid ?? ''}|${new Date(checkOutMs).toISOString()}`
        : null;

      // ENTRY → 퇴실 의심 취소 (나갔다가 다시 들어옴)
      if (entry && this.checkoutSuspectedAt !== null) {
        this._resetCheckout();
      }

      // 예약 시각이 객실 상태의 기준이다. 실제 퇴실 확인은 상태 전환을 늦추지 않는다.
      // 퇴실이 아직 확인되지 않았으면 유예 시간(CHECKOUT_GRACE_MS) 동안 EXIT를 더 기다린다 —
      // EXIT는 문이 닫히고 몇 분 조용해야 확정되므로, 정시에 나간 손님도 전환 순간에는 미확인일 수 있다.
      // 전환 조건은 퇴실 시각뿐이다. 들고 있는 예약이 아직 시작 전(퇴실도 미래)인 체류는 따로 바로잡지 않는다 —
      // 체류 중 재시작은 상태·기기를 건드리지 않는다(s103).
      if (checkOutMs !== null && now >= checkOutMs && checkoutKey !== this.scheduledCheckoutKey) {
        const leftBeforeCheckout = this.checkoutSuspectedAt !== null;
        const confirmedExit = exit || (leftBeforeCheckout && !motionNow);
        const data = { reservationUid: reservation?.uid ?? null, checkOut: new Date(checkOutMs).toISOString() };
        events.push({
          type: 'scheduled_checkout_reached',
          reason: confirmedExit
            ? `예정 체크아웃 시각 도래 — 퇴실 확인 (${_fmtTime(exitAt ?? this.checkoutExitAt)})`
            : '예정 체크아웃 시각 도래 — 청소 대기 상태로 전환',
          timestamp: checkOutMs,
          data,
        });
        this.scheduledCheckoutKey = checkoutKey;
        // 유예 시간이 이미 지난 뒤 처음 판정하면(워처가 꺼져 있다 켜짐 — 시작 때는 놓친 센서 기록을 다시 읽지 않는다)
        // 그 사이 퇴실을 보지 못한 것이므로 퇴실 지연으로 판정하지 않는다.
        const deadline = checkOutMs + cfg.CHECKOUT_GRACE_MS;
        this.lateCheckoutWatch = confirmedExit || now >= deadline
          ? null
          : { checkOutMs, deadline, leftBeforeCheckout, data };
        this._resetCheckout();
      } else if (exit && checkOutMs !== null && now < checkOutMs && this.checkoutSuspectedAt === null) {
        this.checkoutSuspectedAt = now;
        this.checkoutExitAt      = exitAt ?? now;
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

    // ── 퇴실 지연 판정 — 전환 뒤(청소 대기)에도 유예 시간 동안 실제 퇴실을 기다린다 ──
    // 예약당 한 번만 낸다. 발생 시각은 예정 체크아웃 시각이다.
    const watch = this.lateCheckoutWatch;
    // 유예 중에 같은 예약의 퇴실 시각이 뒤로 바뀌면(연장이 늦게 도착) 지연이 아니다
    const extendedLater = watch?.data.reservationUid != null && reservation?.uid != null
      && String(reservation.uid) === String(watch.data.reservationUid)
      && checkOutMs !== null && checkOutMs > watch.checkOutMs;
    if (watch) {
      if (entry) watch.leftBeforeCheckout = false;
      if (extendedLater || exit || (watch.leftBeforeCheckout && !motionNow)) {
        this.lateCheckoutWatch = null;
      } else if (now >= watch.deadline) {
        events.push({
          type: 'late_checkout_detected',
          reason: `예정 체크아웃 후 ${Math.round(cfg.CHECKOUT_GRACE_MS / 60_000)}분 안에 실제 퇴실이 확인되지 않음`,
          timestamp: watch.checkOutMs,
          data: watch.data,
        });
        this.lateCheckoutWatch = null;
      }
    }

    // ── PRE_STAY_READY: 체크인 감지 + 조기 체크인 + 노쇼 ────────────────────
    const waitingAfterCleaning = main === 'VACANT' && ['CLEANING_FINISHED', 'ENERGY_WASTE'].includes(sub)
      && checkInMs !== null && now >= checkInMs;
    if ((main === 'PRE_STAY_READY' && ['OPTIMIZED', 'OPTIMIZING', 'OPTIMIZATION_FAILED'].includes(sub)) || waitingAfterCleaning) {
      let checkinFired = false;

      // 버그 fix: 조기 체크인 후 checkIn 시각 도래 → check_in_detected
      if (this.checkinSuspectedAt !== null
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
          events.push({
            type:   'check_in_detected',
            reason: '체크인 확인 — 도어 이벤트 후 입실 감지',
            timestamp: now,
          });
          this._resetCheckin();
          checkinFired = true;
          // Preparation continues independently after arrival; never delay
          // occupancy merely because environmental preparation is unfinished.
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
