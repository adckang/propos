/**
 * SuspicionTracker — 스케줄 안에서 기대한 일(퇴실·입실·청소)이 일어났는지 확인한다 (Layer 2)
 *
 * 상태 = 스케줄 (DEC-10, docs/room-state-machine.md 0절): 퇴실·입실 시각이 되면 상태를 바꾸고, 센서 감지는
 * "그 일이 실제로 일어났는가"만 본다. 감지되면 그때의 기기 제어를 자동으로 하고, 확인되지 않으면 문제로 남겨
 * 기기 제어·판정을 운영자에게 넘긴다 (DEC-11).
 *
 * 상태 전환 이벤트 (getNextRoomState 대상):
 *   scheduled_checkout_reached — 퇴실 시각. data.exitConfirmed = 이미 퇴실이 확인됨(그때 청소 모드 기기 제어)
 *   scheduled_checkin_reached  — 입실 시각. data.entryConfirmed = 이미 입실이 확인됨(그때 체류 기기 제어)
 *   scheduled_cleaning_started, scheduled_cleaning_finished — 청소 일정(서버가 보낸 시작·끝 시각, DEC-17)
 *   cleaning_started, cleaning_finished — 청소 일정이 없을 때만(감지로 전환, 예전 방식)
 *
 * 기록 이벤트 (상태 전환 없음, 실제 청소 시각 — 청소시간 준수 지표):
 *   cleaning_activity_started, cleaning_activity_finished
 *
 * 확인 이벤트 (상태 전환 없음, 워처가 그 순간의 기기 제어를 한다):
 *   checkout_confirmed — 퇴실 시각 뒤 유예 안에 퇴실 확인
 *   checkin_confirmed  — 입실 시각 뒤 입실 확인
 *   cleaning_vacant_confirmed — 청소 끝 시각 뒤 담당자가 나간 것을 확인(공실 기기 제어)
 *
 * 문제 이벤트 (상태 전환 없음, 문제·이상 건수에 포함, 운영자에게 넘김):
 *   late_checkout_detected  — 퇴실 시각 + 유예 시간까지 퇴실 미확인 (예약당 1건)
 *   checkin_not_detected    — 입실 날 자정까지 입실 미확인 (예약당 1건, DEC-16)
 *   cleaning_not_detected   — 배정된 청소 시간 동안 담당자가 들어온 것이 보이지 않음 (청소 1건에 1건, DEC-17)
 *   detection_unconfirmable — 그 시각에 감지 센서가 꺼져 있거나(sensor_off) 감시가 멈춰 있어(not_observed) 확인할 수 없음.
 *                             지연·미감지로 단정하지 않는다 (DEC-11·12)
 *
 * Soft 이벤트 (ConfirmationManager 라우팅, 상태 전환 없음):
 *   checkout_confirmation_needed, early_checkin_suspected
 *
 * 설계 문서: docs/event-detection-design.md 섹션 4
 */

const DAY_MS = 86_400_000;
const KST_MS = 9 * 3_600_000;
// 워처를 다시 켰을 때 이 시간 넘게 보지 못했으면, 그동안의 퇴실·입실을 놓쳤을 수 있다 (워처 시작은 HA 기록을 다시 읽지 않는다)
const OBSERVATION_GAP_MS = 10 * 60_000;
// 공실에서 입실 시각 전에 들어온 사람을 손님으로 보는 범위 — 입실 준비를 시작하는 때(2시간 전)와 같다. 그보다 이르면 운영자·청소일 수 있다
const EARLY_ENTRY_WINDOW_MS = 2 * 3_600_000;
const iso = ms => new Date(ms).toISOString();
const stayKey = (reservation, checkInMs) => `${reservation?.uid ?? ''}|${iso(checkInMs)}`;
// 청소 끝 시각이 지나도 담당자가 아직 안에 있을 수 있다 — 이만큼 더 나가는 것을 기다린 뒤, 못 보면 운영자에게 넘긴다
const VACANT_CONFIRM_GRACE_MS = 60 * 60_000;
const timeOf = value => {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
};
/** 서버가 보낸 청소 일정 { jobId, checkoutAt, startAt, endAt, assigned } → 쓸 수 있으면 숫자 시각으로 */
function cleaningPlan(cleaning) {
  if (!cleaning || typeof cleaning.jobId !== 'string' || !cleaning.jobId) return null;
  const startMs = timeOf(cleaning.startAt), endMs = timeOf(cleaning.endAt), checkoutMs = timeOf(cleaning.checkoutAt);
  if (startMs == null || endMs == null || checkoutMs == null || endMs <= startMs) return null;
  return { jobId: cleaning.jobId, checkoutAt: iso(checkoutMs), startMs, endMs, assigned: cleaning.assigned === true };
}

export class SuspicionTracker {
  // 퇴실
  checkoutSuspectedAt = null;
  checkoutExitAt      = null;
  caseBFiredAt        = null;  // 조기 퇴실 확인 메시지 발송 시각
  scheduledCheckoutKey = null; // 예정 퇴실 전환을 이미 낸 예약 (예약당 1회)
  lateCheckoutWatch    = null; // 전환 뒤 퇴실을 기다리는 중 { checkOutMs, deadline, leftBeforeCheckout, notEntered, unobserved, data }
  checkedOutStayKey    = null; // 퇴실 처리한 체류(예약 uid + 입실 시각) — 늦은 연장이 같은 체류를 다시 입실로 만들지 않게

  // 입실
  checkinSuspectedAt  = null;  // 입실 시각 전에 들어온 것을 본 시각
  checkinSuspectedKey = null;  // 그때의 체류(예약 uid + 입실 시각) — 다른 체류의 입실로 쓰지 않는다
  scheduledCheckinKey = null;  // 예정 입실 전환을 이미 낸 예약 (예약당 1회)
  checkinWatch        = null;  // 전환 뒤 입실을 기다리는 중 { checkInMs, deadline, needsExitFirst, unobserved, data }
  stayEntryConfirmed  = true;  // 지금 체류에서 손님이 들어온 것이 확인됐는가 — 아니면 체류 중 점검(에너지·환경·소음)을 하지 않는다
  stayData            = null;  // 지금 체류의 입실 기록(예약 uid·입실 시각) — 자정 뒤 늦게 들어와도 같은 입실로 확인한다

  // 마지막으로 판정한 시각. 저장했다 되살리면 첫 판정에서 끊긴 시간을 본다
  observedAt          = null;
  restoredObservedAt  = undefined; // 되살린 직후에만 값이 있다 (null = 저장된 시각 없음)

  // 청소 의심 (실제 청소 시작·끝 감지)
  cleaningStartAt     = null;
  cleaningMotionStart = null;
  cleaningDoneAt      = null;
  // 청소 일정(DEC-17): 일정대로 상태를 바꾸고 담당자가 보였는지 본다 { jobId, startMs, endMs, assigned, seen, sensorOffSeen, offSensors, unobserved, startedEmitted, data }
  cleaningWatch        = null;
  processedCleaningKey = null; // 일정 판정을 끝낸 청소
  entrySinceCheckout   = false; // 퇴실 처리 뒤 누가 들어온 것을 봤는가 — 청소 일정이 늦게 와도 그 전의 입장을 센다
  actualCleaning       = null; // 그 청소의 실제 시작·끝 감지 { jobId, phase: 'waiting'|'started'|'finished', expiresAt }

  /**
   * @param {object} p
   * @param {{ exit, exitAt, entry, entryAt }} p.sensorResult
   * @param {{ mainStatus, subStatus }} p.roomState
   * @param {{ uid?: string, checkIn?: Date, checkOut?: Date }|null} p.reservation
   * @param {boolean} p.motionNow
   * @param {number|null} p.acPower   - W 단위, null=센서 없음
   * @param {number|null} p.noiseLevel - dB 단위, null=센서 없음
   * @param {number} p.now
   * @param {object} p.cfg
   * @param {object[]} [p.sensorsOff] - 지금 꺼져 있는 감지 센서(문·움직임). 있으면 그 순간 퇴실·입실을 확인할 수 없다
   * @param {object|null} [p.cleaning] - 서버가 보낸 청소 일정 { jobId, checkoutAt, startAt, endAt, assigned }
   */
  evaluate({ sensorResult, roomState, reservation, motionNow, acPower, noiseLevel, now, cfg, sensorsOff = [], cleaning = null }) {
    const events = [];
    const { exit, exitAt, entry } = sensorResult;
    const main      = roomState?.mainStatus;
    const sub       = roomState?.subStatus;
    const checkOutMs = reservation?.checkOut?.getTime() ?? null;
    const checkInMs  = reservation?.checkIn?.getTime()  ?? null;
    const sensorOff  = sensorsOff.length > 0;
    // 센서가 꺼져 있으면 "움직임 없음"은 확인이 아니다
    const quietRoom  = !motionNow && !sensorOff;
    const phaseLabel = phase => ({ checkout: '퇴실', checkin: '입실', cleaning: '청소' }[phase]);
    const UNCONFIRMABLE_REASON = {
      sensor_off: (phase, off) => `${phaseLabel(phase)} 시각에 감지 센서가 꺼져 있어 확인할 수 없음 (${off.map(s => s.name).join(', ')})`,
      not_observed: phase => `${phaseLabel(phase)} 시각 전후에 감시가 멈춰 있어 확인할 수 없음`,
      not_entered: () => '입실이 확인되지 않은 체류라 퇴실을 확인할 수 없음',
      exit_not_seen: () => '청소 담당자가 나간 것을 확인하지 못해 공실 기기 제어를 하지 않음',
    };
    const sensorRefs = list => list.map(s => ({ entityId: s.entityId, roleLabel: s.roleLabel, name: s.name }));
    const unconfirmable = (phase, at, data, cause, offSensors = sensorsOff) => ({
      type: 'detection_unconfirmable',
      reason: UNCONFIRMABLE_REASON[cause](phase, offSensors),
      timestamp: at,
      data: { ...data, phase, cause, ...(cause === 'sensor_off' ? { sensors: sensorRefs(offSensors) } : {}) },
    });

    // 되살린 기다림이 있는데 워처가 꺼져 있던 동안을 보지 못했으면, 그 기다림은 끝까지 판정할 수 없다
    if (this.restoredObservedAt !== undefined) {
      const gap = this.restoredObservedAt == null || now - this.restoredObservedAt > OBSERVATION_GAP_MS;
      if (gap && this.lateCheckoutWatch) this.lateCheckoutWatch.unobserved = true;
      if (gap && this.checkinWatch) this.checkinWatch.unobserved = true;
      if (gap && this.cleaningWatch) this.cleaningWatch.unobserved = true;
      this.restoredObservedAt = undefined;
    }
    this.observedAt = Math.max(this.observedAt ?? now, now);

    let justCheckedOut = false, justCheckedIn = false;

    // ── OCCUPIED: 퇴실 시각 ──────────────────────────────────────────────────
    if (main === 'OCCUPIED') {
      // 예약과 퇴실 시각이 같을 때만 같은 퇴실이다 — 같은 예약이라도 퇴실 시각이 바뀌면(연장) 다시 전환한다
      const checkoutKey = checkOutMs !== null
        ? `${reservation?.uid ?? ''}|${iso(checkOutMs)}`
        : null;

      // ENTRY → 퇴실 의심 취소 (나갔다가 다시 들어옴)
      if (entry && this.checkoutSuspectedAt !== null) {
        this._resetCheckout();
      }

      // 퇴실 시각이 객실 상태의 기준이다. 퇴실이 아직 확인되지 않았으면 유예 시간(CHECKOUT_GRACE_MS) 동안 EXIT를 더 기다린다 —
      // EXIT는 문이 닫히고 몇 분 조용해야 확정되므로, 정시에 나간 손님도 전환 순간에는 미확인일 수 있다.
      // 들고 있는 예약이 아직 시작 전(퇴실도 미래)인 체류는 따로 바로잡지 않는다 — 체류 중 재시작은 상태·기기를 건드리지 않는다(s103).
      if (checkOutMs !== null && now >= checkOutMs && checkoutKey !== this.scheduledCheckoutKey) {
        const leftBeforeCheckout = this.checkoutSuspectedAt !== null;
        const exitConfirmed = !!exit || (leftBeforeCheckout && quietRoom);
        const data = { reservationUid: reservation?.uid ?? null, checkOut: iso(checkOutMs) };
        events.push({
          type: 'scheduled_checkout_reached',
          reason: exitConfirmed
            ? `예정 체크아웃 시각 도래 — 퇴실 확인 (${_fmtTime(exitAt ?? this.checkoutExitAt)})`
            : '예정 체크아웃 시각 도래 — 청소 대기 상태로 전환',
          timestamp: checkOutMs,
          data: { ...data, exitConfirmed },
        });
        this.scheduledCheckoutKey = checkoutKey;
        justCheckedOut = true;
        this.entrySinceCheckout = false;
        if (checkInMs !== null) this.checkedOutStayKey = stayKey(reservation, checkInMs);
        // 입실이 끝내 확인되지 않은 체류(노쇼일 수 있다)는 퇴실이 보이지 않아도 퇴실 지연이 아니다
        const notEntered = !this.stayEntryConfirmed;
        this.checkinWatch = null;
        this.stayEntryConfirmed = true;
        this.stayData = null;
        const deadline = checkOutMs + cfg.CHECKOUT_GRACE_MS;
        this.lateCheckoutWatch = null;
        if (exitConfirmed) { /* 청소 모드는 전환과 함께 */ }
        else if (sensorOff) events.push(unconfirmable('checkout', checkOutMs, data, 'sensor_off'));
        // 유예 시간이 이미 지난 뒤 처음 판정하면(워처가 꺼져 있다 켜짐) 그 사이를 보지 못한 것 — 지연으로 단정하지 않는다
        else if (now >= deadline) events.push(unconfirmable('checkout', checkOutMs, data, 'not_observed'));
        else this.lateCheckoutWatch = { checkOutMs, deadline, leftBeforeCheckout, notEntered, unobserved: false, data };
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

    // ── 퇴실 확인 — 전환 뒤(청소 대기)에도 유예 시간 동안 실제 퇴실을 기다린다 ──
    // 그사이 운영자가 상태를 바꿨으면(청소 시작·정비 등) 그 판단을 따른다 — 기다림을 끝내고 판정하지 않는다
    if (this.lateCheckoutWatch && !justCheckedOut && !(main === 'CLEANING' && sub === 'CLEANING_PENDING')) this.lateCheckoutWatch = null;
    const watch = this.lateCheckoutWatch;
    // 유예 중에 같은 예약의 퇴실 시각이 뒤로 바뀌면(연장이 늦게 도착) 지연이 아니다
    const extendedLater = watch?.data.reservationUid != null && reservation?.uid != null
      && String(reservation.uid) === String(watch.data.reservationUid)
      && checkOutMs !== null && checkOutMs > watch.checkOutMs;
    if (watch) {
      if (entry) watch.leftBeforeCheckout = false;
      if (extendedLater) {
        this.lateCheckoutWatch = null;
      } else if (exit || (watch.leftBeforeCheckout && quietRoom)) {
        events.push({ type: 'checkout_confirmed', reason: '퇴실 확인 — 청소 모드 기기 제어', timestamp: now, data: watch.data });
        this.lateCheckoutWatch = null;
      } else if (now >= watch.deadline) {
        // 그 순간 센서가 꺼져 있거나, 기다리는 동안 감시가 멈췄거나, 입실이 확인되지 않은 체류면 지연으로 단정하지 않는다
        const cause = sensorOff ? 'sensor_off' : watch.unobserved ? 'not_observed' : watch.notEntered ? 'not_entered' : null;
        events.push(cause ? unconfirmable('checkout', watch.checkOutMs, watch.data, cause) : {
          type: 'late_checkout_detected',
          reason: `예정 체크아웃 후 ${Math.round(cfg.CHECKOUT_GRACE_MS / 60_000)}분 안에 실제 퇴실이 확인되지 않음`,
          timestamp: watch.checkOutMs,
          data: watch.data,
        });
        this.lateCheckoutWatch = null;
      }
    }

    // ── 입실 시각 — 공실·입실 준비·청소 중 어디서든 입실 시각이 되면 체류로 (청소 정비 중은 운영자가 정한 상태라 제외) ──
    const checkinEligible = main === 'PRE_STAY_READY' || main === 'CLEANING' || (main === 'VACANT' && sub !== 'MAINTENANCE');
    const stayNotOver = checkOutMs === null || now < checkOutMs;
    // 이미 퇴실 처리한 체류가 늦게 연장돼 퇴실 시각이 뒤로 가도 새 입실이 아니다 (같은 체류를 두 번 입실로 세지 않는다)
    const checkedOutAlready = checkInMs !== null && this.checkedOutStayKey === stayKey(reservation, checkInMs);
    if (checkinEligible && checkInMs !== null && stayNotOver && !checkedOutAlready) {
      const checkinKey = stayKey(reservation, checkInMs);
      if (now < checkInMs) {
        // [Soft] 입실 시각 전에 들어옴 — 입실 시각이 되면 이미 확인된 입실로 본다 (입실 준비 중, 또는 2시간 안의 공실)
        const earlyWindow = main === 'PRE_STAY_READY'
          || (main === 'VACANT' && sub !== 'MAINTENANCE' && checkInMs - now <= EARLY_ENTRY_WINDOW_MS);
        if (entry && earlyWindow && this.checkinSuspectedKey !== checkinKey) {
          this.checkinSuspectedAt = now;
          this.checkinSuspectedKey = checkinKey;
          events.push({
            type:       'early_checkin_suspected',
            reason:     `조기 체크인 감지 — 예약 체크인까지 ${Math.round((checkInMs - now) / 60_000)}분 남음`,
            recipients: ['guest'],
            timestamp:  now,
          });
        }
      } else if (checkinKey !== this.scheduledCheckinKey) {
        // 청소 중(또는 청소 대기인데 누가 들어와 있음)에 입실 시각이 되면 안에 있는 사람은 청소 담당자일 수 있다 —
        // 누가 나가는 것을 본 뒤에 들어온 것만 손님으로 본다
        const fromCleaning = main === 'CLEANING'
          && (sub === 'CLEANING_IN_PROGRESS' || this.cleaningStartAt !== null || this.actualCleaning?.phase === 'started');
        const earlyEntry = this.checkinSuspectedAt !== null && this.checkinSuspectedKey === checkinKey;
        const entryConfirmed = !fromCleaning && (earlyEntry || !!entry);
        const deadline = Math.max(checkInMs + cfg.NO_SHOW_WINDOW_MS, _kstMidnightAfter(checkInMs));
        const data = { reservationUid: reservation?.uid ?? null, checkIn: iso(checkInMs), deadline: iso(deadline) };
        events.push({
          type: 'scheduled_checkin_reached',
          reason: entryConfirmed ? '예정 체크인 시각 도래 — 입실 확인' : '예정 체크인 시각 도래 — 체류 상태로 전환',
          timestamp: checkInMs,
          data: { ...data, entryConfirmed },
        });
        this.scheduledCheckinKey = checkinKey;
        justCheckedIn = true;
        this.checkinWatch = null;
        this.stayEntryConfirmed = entryConfirmed;
        this.stayData = data;
        // DEC-16: 그날(한국 날짜) 자정까지 기다린다 — 손님은 입실 시각보다 몇 시간 늦게 오는 일이 흔하다
        if (entryConfirmed) { /* 체류 기기 제어는 전환과 함께 */ }
        else if (sensorOff) events.push(unconfirmable('checkin', checkInMs, data, 'sensor_off'));
        else if (now >= deadline) events.push(unconfirmable('checkin', checkInMs, data, 'not_observed'));
        else this.checkinWatch = { checkInMs, deadline, needsExitFirst: fromCleaning, unobserved: false, data };
        this._resetCheckin();
      }
    }

    // ── 입실 확인 — 전환 뒤(체류) 그날 자정까지 손님이 들어오는지 본다 ──
    // 체류가 아닌 상태로 바뀌었으면(운영자의 정비 등) 체류가 끝난 것 — 기다림·체류 기록을 끝낸다
    if (main !== 'OCCUPIED' && !justCheckedIn) {
      this.checkinWatch = null;
      this.stayEntryConfirmed = true;
      this.stayData = null;
    }
    const cw = this.checkinWatch;
    if (cw) {
      // 기다리는 중에 예약이 취소되거나 다른 예약·다른 입실 시각으로 바뀌면 판정하지 않는다
      const sameStay = reservation?.checkIn != null && checkInMs === cw.checkInMs
        && String(reservation?.uid ?? '') === String(cw.data.reservationUid ?? '');
      if (!sameStay) {
        this.checkinWatch = null;
      } else if (cw.needsExitFirst && exit) {
        cw.needsExitFirst = false; // 청소 담당자가 나갔다 — 이제 들어오는 사람은 손님으로 본다
      } else if (entry && !cw.needsExitFirst) {
        events.push({ type: 'checkin_confirmed', reason: '입실 확인 — 체류 기기 제어', timestamp: now, data: cw.data });
        this.checkinWatch = null;
        this.stayEntryConfirmed = true;
      } else if (now >= cw.deadline) {
        const cause = sensorOff ? 'sensor_off' : cw.unobserved ? 'not_observed' : null;
        events.push(cause ? unconfirmable('checkin', cw.checkInMs, cw.data, cause) : {
          type: 'checkin_not_detected',
          reason: '입실 날 자정까지 입실이 확인되지 않음',
          timestamp: cw.checkInMs,
          data: cw.data,
        });
        this.checkinWatch = null;
      }
    }

    // ── 기다림이 끝난 뒤(자정 뒤·확인 불가) 늦게 들어와도 입실로 확인한다 — 문제 기록은 그대로 남는다 ──
    if (main === 'OCCUPIED' && !this.stayEntryConfirmed && !this.checkinWatch && entry && this.stayData) {
      events.push({ type: 'checkin_confirmed', reason: '늦은 입실 확인 — 체류 기기 제어', timestamp: now, data: this.stayData });
      this.stayEntryConfirmed = true;
    }

    // ── 청소 — 일정이 있으면 상태는 일정대로(DEC-10·17), 감지는 실제 청소 기록과 담당자 미감지 판정에만 쓴다 ──
    // 이 퇴실의 청소 일정일 때만 쓴다(서버가 보낸 청소의 퇴실 시각 = 처리한 퇴실 시각). 아니면 예전처럼 감지로 전환한다
    const plan = cleaningPlan(cleaning);
    const lastCheckout = this.scheduledCheckoutKey?.split('|')[1] ?? null;
    if (main === 'CLEANING' && entry) this.entrySinceCheckout = true;
    if (main === 'CLEANING' && plan && plan.checkoutAt === lastCheckout && !this.cleaningWatch && this.processedCleaningKey !== plan.jobId) {
      const data = { jobId: plan.jobId, checkoutAt: plan.checkoutAt, startAt: iso(plan.startMs), endAt: iso(plan.endMs) };
      // 시작 시각보다 한참 뒤에야 기다리기 시작했으면(워처가 꺼져 있었음) 그 사이를 보지 못했다
      const unobserved = !this.entrySinceCheckout && now - plan.startMs > OBSERVATION_GAP_MS;
      this.cleaningWatch = { ...plan, seen: this.entrySinceCheckout, sensorOffSeen: false, offSensors: [], unobserved, startedEmitted: false, data };
      this.actualCleaning = { jobId: plan.jobId, phase: 'waiting', expiresAt: plan.endMs + VACANT_CONFIRM_GRACE_MS, endMs: plan.endMs, data };
      this._resetCleaningStart(); this._resetCleaningDone();
    }

    const cl = this.cleaningWatch;
    if (cl) {
      if (main !== 'CLEANING' && !justCheckedOut) {
        // 운영자가 상태를 바꿨다(청소 완료·정비 등) — 그 판단을 따른다, 판정하지 않는다
        this.processedCleaningKey = cl.jobId;
        this.cleaningWatch = null;
      } else {
        if (entry) cl.seen = true;
        if (sensorOff) { cl.sensorOffSeen = true; cl.offSensors = sensorsOff; }
        if (!cl.startedEmitted && now >= cl.startMs) {
          events.push({ type: 'scheduled_cleaning_started', reason: '청소 일정 시작 — 청소 중으로 전환', timestamp: cl.startMs, data: cl.data });
          cl.startedEmitted = true;
        }
        if (now >= cl.endMs) {
          // 담당자가 나간 것을 봤을 때만 공실 기기 제어(전체 끄기·잠금)를 한다 — 안에 있을 수 있으면 하지 않는다(DEC-11)
          const vacantConfirmed = this.actualCleaning?.phase === 'finished';
          events.push({ type: 'scheduled_cleaning_finished', reason: '청소 일정 끝 — 공실로 전환', timestamp: cl.endMs, data: { ...cl.data, vacantConfirmed } });
          // 담당자를 봤다 = 들어온 것을 봤거나, 실제 청소가 시작됐다(운영자가 시작을 누른 것 포함)
          if (cl.assigned && !cl.seen && (this.actualCleaning?.phase ?? 'waiting') === 'waiting') {
            const cause = cl.sensorOffSeen || sensorOff ? 'sensor_off' : cl.unobserved ? 'not_observed' : null;
            // 확인 불가의 발생 시각은 끝 시각 — 퇴실 확인 불가(퇴실 시각 = 보통 청소 시작 시각)와 DB 중복 방지에서 겹치지 않게
            events.push(cause
              ? unconfirmable('cleaning', cl.endMs, cl.data, cause, cl.sensorOffSeen ? cl.offSensors : sensorsOff)
              : { type: 'cleaning_not_detected', reason: '배정된 청소 시간 동안 담당자가 들어온 것이 보이지 않음', timestamp: cl.startMs, data: cl.data });
          }
          this.processedCleaningKey = cl.jobId;
          this.cleaningWatch = null;
        }
      }
    }

    // ── 실제 청소 시작·끝 감지 (청소시간 준수 지표) — 일정이 있으면 기록만, 없으면 예전처럼 전환 ──
    const ac = this.actualCleaning;
    if (ac) {
      const roomForCleaning = main === 'CLEANING' || (main === 'VACANT' && sub === 'CLEANING_FINISHED');
      if (!roomForCleaning || now >= ac.expiresAt) {
        // 끝 시각이 지나 공실이 됐는데 안에 있던 담당자가 나가는 것을 끝내 못 봤다 — 공실 기기 제어(끄기·잠금)를 하지 않은 채다
        if (roomForCleaning && main === 'VACANT' && ac.phase === 'started') {
          events.push(unconfirmable('cleaning', ac.expiresAt, ac.data ?? { jobId: ac.jobId }, 'exit_not_seen'));
        }
        this.actualCleaning = null;
        this._resetCleaningStart(); this._resetCleaningDone();
      } else if (ac.phase === 'finished' && entry && main === 'CLEANING') {
        // 나갔던 담당자가 끝 시각 전에 다시 들어왔다 — 아직 안에 있으니 공실 기기 제어를 하지 않는다
        ac.phase = 'started';
        this._resetCleaningDone();
      } else if (ac.phase === 'waiting') {
        const started = this._detectCleaningStart({ entry, exit, motionNow, now, cfg });
        if (started) {
          events.push({ type: 'cleaning_activity_started', reason: `실제 청소 시작 — ${Math.round(started / 60_000)}분 활동 지속`, timestamp: now, data: { jobId: ac.jobId } });
          ac.phase = 'started';
          if (this.cleaningWatch) this.cleaningWatch.seen = true;
        }
      } else if (ac.phase === 'started') {
        const quiet = this._detectCleaningDone({ entry, exit, motionNow, now, cfg });
        if (quiet) {
          events.push({ type: 'cleaning_activity_finished', reason: `실제 청소 끝 — 퇴장 후 ${Math.round(quiet / 60_000)}분 조용`, timestamp: now, data: { jobId: ac.jobId } });
          ac.phase = 'finished';
          // 청소 끝 시각이 지난 뒤에 나갔으면 그때 공실 기기 제어를 한다
          if (main === 'VACANT') events.push({ type: 'cleaning_vacant_confirmed', reason: '청소 담당자 퇴장 확인 — 공실 기기 제어', timestamp: now, data: { jobId: ac.jobId } });
        }
      }
    } else if (main === 'CLEANING' && !this.cleaningWatch) {
      // 청소 일정이 없다 — 예전처럼 감지로 전환한다
      if (sub === 'CLEANING_PENDING') {
        const started = this._detectCleaningStart({ entry, exit, motionNow, now, cfg });
        if (started) events.push({ type: 'cleaning_started', reason: `청소 시작 확인 — ${Math.round(started / 60_000)}분 활동 지속`, timestamp: now });
      } else if (sub === 'CLEANING_IN_PROGRESS') {
        const quiet = this._detectCleaningDone({ entry, exit, motionNow, now, cfg });
        if (quiet) events.push({ type: 'cleaning_finished', reason: `청소 완료 확인 — 퇴장 후 ${Math.round(quiet / 60_000)}분 조용`, timestamp: now });
      }
    }

    return events;
  }

  /** 재시작해도 이어지도록 저장할 판정 상태 (퇴실·입실 확인 대기) */
  snapshot() {
    return {
      scheduledCheckoutKey: this.scheduledCheckoutKey, lateCheckoutWatch: this.lateCheckoutWatch, checkedOutStayKey: this.checkedOutStayKey,
      scheduledCheckinKey: this.scheduledCheckinKey, checkinWatch: this.checkinWatch,
      checkinSuspectedAt: this.checkinSuspectedAt, checkinSuspectedKey: this.checkinSuspectedKey,
      stayEntryConfirmed: this.stayEntryConfirmed, stayData: this.stayData, observedAt: this.observedAt,
      cleaningWatch: this.cleaningWatch, processedCleaningKey: this.processedCleaningKey, entrySinceCheckout: this.entrySinceCheckout,
      actualCleaning: this.actualCleaning,
    };
  }

  /** 퇴실·입실을 기다리는 중인가 — 기다리는 동안엔 워처가 판정 상태를 자주 저장한다 */
  get hasOpenWait() { return this.lateCheckoutWatch !== null || this.checkinWatch !== null || this.cleaningWatch !== null; }
  /** 입실 시각에 센서가 정상이었고 손님을 아직 기다리는 중 — 빈방이 확실한 동안만 입실 준비를 할 수 있다 */
  get awaitingArrival() { return this.checkinWatch !== null; }

  /** 저장된 판정 상태 중 쓸 수 있는 것만 되살린다 — 깨진 값 하나가 감시를 멈추지 않게 */
  restore(raw) {
    if (!raw || typeof raw !== 'object') return;
    const isKey = value => typeof value === 'string' && value.length > 0;
    const watchOk = (w, timeKey) => w && typeof w === 'object' && Number.isFinite(w[timeKey]) && Number.isFinite(w.deadline)
      && w.data && typeof w.data === 'object';
    const flag = value => value === true;
    if (isKey(raw.scheduledCheckoutKey)) this.scheduledCheckoutKey = raw.scheduledCheckoutKey;
    if (isKey(raw.checkedOutStayKey)) this.checkedOutStayKey = raw.checkedOutStayKey;
    if (isKey(raw.scheduledCheckinKey)) this.scheduledCheckinKey = raw.scheduledCheckinKey;
    if (watchOk(raw.lateCheckoutWatch, 'checkOutMs')) {
      const w = raw.lateCheckoutWatch;
      this.lateCheckoutWatch = { ...w, leftBeforeCheckout: flag(w.leftBeforeCheckout), notEntered: flag(w.notEntered), unobserved: flag(w.unobserved) };
    }
    if (watchOk(raw.checkinWatch, 'checkInMs')) {
      const w = raw.checkinWatch;
      this.checkinWatch = { ...w, needsExitFirst: flag(w.needsExitFirst), unobserved: flag(w.unobserved) };
    }
    if (Number.isFinite(raw.checkinSuspectedAt) && isKey(raw.checkinSuspectedKey)) {
      this.checkinSuspectedAt = raw.checkinSuspectedAt;
      this.checkinSuspectedKey = raw.checkinSuspectedKey;
    }
    if (typeof raw.stayEntryConfirmed === 'boolean') this.stayEntryConfirmed = raw.stayEntryConfirmed;
    if (raw.stayData && typeof raw.stayData === 'object') this.stayData = { ...raw.stayData };
    const cw = raw.cleaningWatch;
    if (cw && typeof cw === 'object' && isKey(cw.jobId) && Number.isFinite(cw.startMs) && Number.isFinite(cw.endMs) && cw.data && typeof cw.data === 'object') {
      this.cleaningWatch = { ...cw, assigned: flag(cw.assigned), seen: flag(cw.seen), sensorOffSeen: flag(cw.sensorOffSeen),
        offSensors: Array.isArray(cw.offSensors) ? cw.offSensors : [], unobserved: flag(cw.unobserved), startedEmitted: flag(cw.startedEmitted) };
    }
    if (isKey(raw.processedCleaningKey)) this.processedCleaningKey = raw.processedCleaningKey;
    this.entrySinceCheckout = flag(raw.entrySinceCheckout);
    const ac = raw.actualCleaning;
    if (ac && typeof ac === 'object' && isKey(ac.jobId) && ['waiting', 'started', 'finished'].includes(ac.phase) && Number.isFinite(ac.expiresAt)) {
      this.actualCleaning = { jobId: ac.jobId, phase: ac.phase, expiresAt: ac.expiresAt,
        ...(Number.isFinite(ac.endMs) ? { endMs: ac.endMs } : {}), ...(ac.data && typeof ac.data === 'object' ? { data: { ...ac.data } } : {}) };
    }
    // 저장된 시각이 없거나 깨졌으면 끊긴 동안을 알 수 없다 — 되살린 기다림은 끝까지 판정하지 않는다
    this.restoredObservedAt = Number.isFinite(raw.observedAt) ? raw.observedAt : null;
  }

  _resetCheckout() {
    this.checkoutSuspectedAt = null;
    this.checkoutExitAt      = null;
    this.caseBFiredAt        = null;
  }
  _resetCheckin() {
    this.checkinSuspectedAt = null;
    this.checkinSuspectedKey = null;
  }
  _resetCleaningStart() { this.cleaningStartAt = null; this.cleaningMotionStart = null; }
  _resetCleaningDone()  { this.cleaningDoneAt  = null; }

  /** 사람이 들어와(ENTRY) 움직임이 CLEANING_SUSTAINED_MS 이어지면 청소 시작 — 이어진 시간을, 아니면 null */
  _detectCleaningStart({ entry, exit, motionNow, now, cfg }) {
    if (entry && this.cleaningStartAt === null) { this.cleaningStartAt = now; this.cleaningMotionStart = now; }
    if (this.cleaningStartAt === null) return null;
    if (motionNow) {
      const sustainedMs = now - (this.cleaningMotionStart ?? now);
      if (sustainedMs >= cfg.CLEANING_SUSTAINED_MS) { this._resetCleaningStart(); return sustainedMs; }
    } else if (exit && now - this.cleaningStartAt < cfg.CLEANING_SUSTAINED_MS) {
      this._resetCleaningStart();
    }
    return null;
  }

  /** 나간 뒤(EXIT) CLEANING_DONE_QUIET_MS 조용하면 청소 끝 — 조용했던 시간을, 아니면 null */
  _detectCleaningDone({ entry, exit, motionNow, now, cfg }) {
    if (entry && this.cleaningDoneAt !== null) this._resetCleaningDone();
    if (exit && this.cleaningDoneAt === null) this.cleaningDoneAt = now;
    if (this.cleaningDoneAt === null || motionNow) return null;
    const quietMs = now - this.cleaningDoneAt;
    if (quietMs < cfg.CLEANING_DONE_QUIET_MS) return null;
    this._resetCleaningDone();
    return quietMs;
  }

  /** 운영자가 화면에서 청소 시작·완료를 눌렀다 — 실제 청소 기록으로 보고, 일정 판정을 그에 맞춘다 */
  noteManualCleaning(type) {
    if (type === 'cleaning_started') {
      if (this.actualCleaning?.phase === 'waiting') { this.actualCleaning.phase = 'started'; this._resetCleaningStart(); }
    } else if (type === 'cleaning_finished') {
      if (this.cleaningWatch) { this.processedCleaningKey = this.cleaningWatch.jobId; this.cleaningWatch = null; }
      this.actualCleaning = null;
      this._resetCleaningStart(); this._resetCleaningDone();
    }
  }
}

function _fmtTime(ts) {
  if (ts == null) return '?';
  return new Date(ts).toLocaleTimeString('ko-KR');
}

/** 그 시각의 한국 날짜 다음 날 0시 */
function _kstMidnightAfter(ms) {
  const kstDayStart = Math.floor((ms + KST_MS) / DAY_MS) * DAY_MS;
  return kstDayStart + DAY_MS - KST_MS;
}
