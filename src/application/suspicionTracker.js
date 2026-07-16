/**
 * SuspicionTracker — 의심(Suspicion) → 확신(Confirmation) 상태 관리 (Layer 2)
 *
 * SensorEventGenerator의 EXIT/ENTRY 이벤트 + 예약 정보 + 현재 상태를 받아
 * 상태 기계 이벤트를 생성하거나 의심 상태를 기록한다.
 *
 * 반환 이벤트 (getNextRoomState 대상):
 *   check_out_detected, check_in_detected, cleaning_started, cleaning_finished
 *
 * 설계 문서: docs/event-detection-design.md 섹션 4
 */

export class SuspicionTracker {
  // 퇴실 의심
  checkoutSuspectedAt = null;  // EXIT 감지 시각 (checkOut 전)
  checkoutExitAt      = null;  // 실제 EXIT 발생 시각

  // 체크인 의심 (조기 체크인)
  checkinSuspectedAt  = null;

  // 청소 시작 의심
  cleaningStartAt     = null;
  cleaningMotionStart = null;  // 모션 지속 카운트 시작 시각

  // 청소 완료 의심
  cleaningDoneAt      = null;  // EXIT 감지 시각 (CLEANING_IN_PROGRESS 에서)

  /**
   * @param {object} p
   * @param {{ exit: boolean, exitAt: number|null, entry: boolean, entryAt: number|null }} p.sensorResult
   * @param {{ mainStatus: string, subStatus: string }} p.roomState
   * @param {{ checkIn?: Date, checkOut?: Date }|null} p.reservation
   * @param {boolean} p.motionNow  - 현재 폴링 시점 모션 여부
   * @param {number}  p.now
   * @param {{ CHECKOUT_GRACE_MS, SUSPICION_EXPIRE_MS, CLEANING_SUSTAINED_MS, CLEANING_DONE_QUIET_MS, NO_SHOW_WINDOW_MS }} p.cfg
   * @returns {{ type: string, reason: string, timestamp: number }[]}
   */
  evaluate({ sensorResult, roomState, reservation, motionNow, now, cfg }) {
    const events = [];
    const { exit, exitAt, entry } = sensorResult;
    const main = roomState?.mainStatus;
    const sub  = roomState?.subStatus;
    const checkOutMs = reservation?.checkOut?.getTime() ?? null;
    const checkInMs  = reservation?.checkIn?.getTime()  ?? null;

    // ── OCCUPIED: 퇴실 감지 ──────────────────────────────────────────────────
    if (main === 'OCCUPIED') {
      let checkoutFired = false;

      // ENTRY 감지 → 퇴실 의심 취소 (나갔다가 돌아옴)
      if (entry && this.checkoutSuspectedAt !== null) {
        this._resetCheckout();
      }

      // EXIT 감지 처리
      if (exit) {
        if (checkOutMs !== null && now >= checkOutMs) {
          // Case 1: 체크아웃 시각 이미 경과 → 즉시 확신
          events.push({
            type: 'check_out_detected',
            reason: `퇴실 확인 — 체크아웃 시각 경과 후 EXIT 감지 (퇴실: ${_fmtTime(exitAt)})`,
            timestamp: now,
          });
          this._resetCheckout();
          checkoutFired = true;
        } else if (this.checkoutSuspectedAt === null) {
          // Case 2: 체크아웃 시각 미경과 → 의심 기록 (상태 변경 없음)
          this.checkoutSuspectedAt = now;
          this.checkoutExitAt      = exitAt ?? now;
        }
      }

      // 의심 상태 + 체크아웃 시각 도래 + 모션 없음 → 확신
      if (
        !checkoutFired &&
        this.checkoutSuspectedAt !== null &&
        checkOutMs !== null &&
        now >= checkOutMs &&
        !motionNow
      ) {
        const minBefore = Math.round((checkOutMs - this.checkoutSuspectedAt) / 60_000);
        events.push({
          type: 'check_out_detected',
          reason: `퇴실 확인 — 체크아웃 ${minBefore}분 전 퇴실 감지 후 체크아웃 시각 도래`,
          timestamp: now,
        });
        this._resetCheckout();
        checkoutFired = true;
      }

      // 의심 만료: checkOut + EXPIRE 이후에도 확신 못함 → 취소 (메시지 발송은 미래 구현)
      if (
        !checkoutFired &&
        this.checkoutSuspectedAt !== null &&
        checkOutMs !== null &&
        now > checkOutMs + cfg.SUSPICION_EXPIRE_MS
      ) {
        this._resetCheckout();
      }
    }

    // ── PRE_STAY_READY/OPTIMIZED: 체크인 감지 ────────────────────────────────
    if (main === 'PRE_STAY_READY' && sub === 'OPTIMIZED') {
      if (entry) {
        if (checkInMs === null || now >= checkInMs) {
          // 체크인 시각 이후 (또는 시각 정보 없음) → 즉시 확신
          events.push({
            type: 'check_in_detected',
            reason: '체크인 확인 — 도어 이벤트 후 입실 감지',
            timestamp: now,
          });
          this._resetCheckin();
        } else if (this.checkinSuspectedAt === null) {
          // 체크인 시각 이전 → 조기 체크인 의심 기록 (미래: 운영자 알림)
          this.checkinSuspectedAt = now;
        }
      }
    }

    // ── CLEANING/CLEANING_PENDING: 청소 시작 감지 ─────────────────────────────
    if (main === 'CLEANING' && sub === 'CLEANING_PENDING') {
      // ENTRY 감지 → 청소팀 입실 의심 기록
      if (entry && this.cleaningStartAt === null) {
        this.cleaningStartAt     = now;
        this.cleaningMotionStart = now;
      }

      if (this.cleaningStartAt !== null) {
        if (motionNow) {
          const sustainedMs = now - (this.cleaningMotionStart ?? now);
          if (sustainedMs >= cfg.CLEANING_SUSTAINED_MS) {
            events.push({
              type: 'cleaning_started',
              reason: `청소 시작 확인 — ${Math.round(sustainedMs / 60_000)}분 활동 지속`,
              timestamp: now,
            });
            this._resetCleaningStart();
          }
        } else if (exit) {
          // 너무 짧은 체류 → 청소팀 아님, 의심 취소
          const stayedMs = now - this.cleaningStartAt;
          if (stayedMs < cfg.CLEANING_SUSTAINED_MS) {
            this._resetCleaningStart();
          }
        }
      }
    }

    // ── CLEANING/CLEANING_IN_PROGRESS: 청소 완료 감지 ────────────────────────
    if (main === 'CLEANING' && sub === 'CLEANING_IN_PROGRESS') {
      // ENTRY → 청소 완료 의심 취소 (재입실)
      if (entry && this.cleaningDoneAt !== null) {
        this._resetCleaningDone();
      }

      // EXIT → 의심 기록
      if (exit && this.cleaningDoneAt === null) {
        this.cleaningDoneAt = now;
      }

      // 의심 + N분 조용 → 확신
      if (this.cleaningDoneAt !== null && !motionNow) {
        const quietMs = now - this.cleaningDoneAt;
        if (quietMs >= cfg.CLEANING_DONE_QUIET_MS) {
          events.push({
            type: 'cleaning_finished',
            reason: `청소 완료 확인 — 퇴장 후 ${Math.round(quietMs / 60_000)}분 조용`,
            timestamp: now,
          });
          this._resetCleaningDone();
        }
      }
    }

    return events;
  }

  _resetCheckout()      { this.checkoutSuspectedAt = null; this.checkoutExitAt = null; }
  _resetCheckin()       { this.checkinSuspectedAt = null; }
  _resetCleaningStart() { this.cleaningStartAt = null; this.cleaningMotionStart = null; }
  _resetCleaningDone()  { this.cleaningDoneAt = null; }
}

function _fmtTime(ts) {
  if (ts == null) return '?';
  return new Date(ts).toLocaleTimeString('ko-KR');
}
