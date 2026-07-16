/**
 * SensorEventGenerator — 원시 센서 → EXIT/ENTRY 시맨틱 이벤트 변환 (Layer 1)
 *
 * EXIT (나감): ① 문 열리기 전 N분 이내 모션 → ② 문 열림→닫힘 → ③ N분간 모션 없음
 * ENTRY(들어옴): ① 문 열림→닫힘 → ② 모션 감지 → ③ 모션 N분 지속
 *
 * 설계 문서: docs/event-detection-design.md
 * 임계값:    src/config/monitoringThresholds.js
 */

export class SensorEventGenerator {
  // 도어 추적
  _prevDoorOpen       = false;
  _doorOpenAt         = null;        // 문 열린 시각 (rising edge)
  _motionBeforeDoor   = false;       // 문 열리기 전 모션 있었는지 (EXIT 조건 ①)

  // 모션 추적
  _lastMotionAt       = null;        // 마지막 모션 감지 시각
  _noMotionAt         = null;        // 모션 없어진 시각

  // EXIT 추적
  _exitPendingAt      = null;        // EXIT 후보: 해당 문닫힘 시각

  // ENTRY 추적
  _entryPendingAt         = null;    // ENTRY 후보: 해당 문닫힘 시각
  _firstMotionAfterClose  = null;    // 문닫힘 후 첫 모션 시각

  /**
   * 매 폴링(30초)마다 호출. 스냅샷을 받아 EXIT/ENTRY 이벤트를 반환.
   *
   * @param {object} snap - 센서 스냅샷 { doorOpen: boolean, motionDetected: boolean }
   * @param {number} now  - Date.now()
   * @param {{ EXIT_LOOKBACK_MS, EXIT_NO_MOTION_MS, ENTRY_SUSTAINED_MS }} cfg
   * @returns {{ exit: boolean, exitAt: number|null, entry: boolean, entryAt: number|null }}
   */
  update(snap, now, cfg) {
    const result    = { exit: false, exitAt: null, entry: false, entryAt: null };
    const doorNow   = !!snap.doorOpen;
    const motionNow = !!snap.motionDetected;

    // ── 문 전환 감지 (rising/falling edge) ─────────────────────────────────
    const doorRising  = doorNow  && !this._prevDoorOpen;   // 닫힘 → 열림
    const doorFalling = !doorNow && this._prevDoorOpen;    // 열림 → 닫힘

    if (doorRising) {
      this._doorOpenAt = now;
      // 문 열리기 직전 모션이 있었는지 (EXIT 조건 ①)
      this._motionBeforeDoor = (
        this._lastMotionAt !== null &&
        now - this._lastMotionAt <= cfg.EXIT_LOOKBACK_MS
      );
      // 새 도어 사이클 → ENTRY 추적 초기화
      this._entryPendingAt        = null;
      this._firstMotionAfterClose = null;
    }

    if (doorFalling) {
      // EXIT 후보: 문 열리기 전 모션 있었음
      if (this._motionBeforeDoor) {
        this._exitPendingAt = now;
      }
      // ENTRY 후보: 문 닫혔으니 모션 대기 시작
      this._entryPendingAt        = now;
      this._firstMotionAfterClose = null;
    }

    // ── 모션 추적 ──────────────────────────────────────────────────────────
    if (motionNow) {
      this._lastMotionAt = now;
      this._noMotionAt   = null;

      // ENTRY: 문닫힘 후 첫 모션 기록
      if (this._entryPendingAt !== null && this._firstMotionAfterClose === null) {
        this._firstMotionAfterClose = now;
      }

      // EXIT 취소: 모션 재감지 (나갔다가 돌아옴)
      if (this._exitPendingAt !== null) {
        this._exitPendingAt    = null;
        this._motionBeforeDoor = false;
      }
    } else {
      if (this._noMotionAt === null) this._noMotionAt = now;
    }

    // ── EXIT 확인: exitPending + 문닫힘 후 N분간 모션 없음 ─────────────────
    if (this._exitPendingAt !== null && !motionNow && this._noMotionAt !== null) {
      // 문닫힘과 모션중단 중 더 늦은 시각부터 카운트
      const quietSince = Math.max(this._noMotionAt, this._exitPendingAt);
      if (now - quietSince >= cfg.EXIT_NO_MOTION_MS) {
        result.exit        = true;
        result.exitAt      = this._exitPendingAt;
        this._exitPendingAt = null;
      }
    }

    // ── ENTRY 확인: 문닫힘 후 첫 모션 + N분 지속 ────────────────────────────
    if (this._firstMotionAfterClose !== null) {
      if (motionNow) {
        const sustainedMs = now - this._firstMotionAfterClose;
        if (sustainedMs >= cfg.ENTRY_SUSTAINED_MS) {
          result.entry             = true;
          result.entryAt           = this._entryPendingAt;
          this._entryPendingAt     = null;
          this._firstMotionAfterClose = null;
        }
      } else {
        // 모션이 끊겼고 EXIT_NO_MOTION 시간 지남 → ENTRY 취소 (잠깐 들어왔다 나감)
        if (this._noMotionAt !== null && now - this._noMotionAt >= cfg.EXIT_NO_MOTION_MS) {
          this._firstMotionAfterClose = null;
          this._entryPendingAt        = null;
        }
      }
    }

    this._prevDoorOpen = doorNow;
    return result;
  }
}
