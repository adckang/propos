import {
  PREPARATION_POLICY as POLICY, deriveOptimizationTargets, evaluatePreparationEnvironment,
  preparationEntityIds, preparationLeadMs, preparationReservationKey,
} from '../domain/preStayOptimizationDomain.js';

/** Closed-loop controller. All effects are injected and tested against fake HA. */
export class PreStayOptimizationController {
  constructor(deps) {
    this.deps = deps;
    this.state = { run: null, lastStoppedAt: {} };
    this.serial = Promise.resolve();
    this.restarted = false;
  }
  snapshot() { return structuredClone(this.state); }
  restore(state) {
    this.state = structuredClone(state?.run ? state : { run: null });
    this.state.lastStoppedAt ??= {};
    this.restarted = this.state.run?.status === 'PREPARING';
  }
  _save() {
    try { return this.deps.save?.(this.snapshot()) !== false; }
    catch { return false; }
  }
  async _scope(settings, propertyId) {
    if (!this.deps.getAllowedEntities) return { allowed: null, fault: null };
    try {
      const allowed = await this.deps.getAllowedEntities(propertyId);
      if (!Array.isArray(allowed)) throw new Error('invalid area response');
      const foreign = preparationEntityIds(settings).some(entity => !allowed.includes(entity));
      return { allowed, fault: foreign ? 'environment_mapping_outside_property' : null };
    } catch { return { allowed: [], fault: 'property_area_cannot_be_verified' }; }
  }
  _event(type, extra = {}) {
    const run = this.state.run;
    return this.deps.emit(type, { preparationPolicy: POLICY.version, optimizationRunId: run.id, reservationKey: run.reservationKey,
      propertyId: run.propertyId, status: run.status, targets: run.targets, readings: run.readings ?? [], reason: run.reason ?? null, ...extra });
  }
  async _alert() {
    const run = this.state.run;
    if (run.alerted) return;
    try {
      await this.deps.alert({ runId: run.id, reason: run.reason, stopUnconfirmed: run.pendingOff.length > 0,
        propertyId: run.propertyId, operatorNotifyService: run.operatorNotifyService });
      run.alerted = true;
    } catch { run.alerted = false; }
    this._save();
  }
  async _stop() {
    const run = this.state.run;
    run.pendingOff = [...new Set([...run.pendingOff, ...run.controlled])];
    this._save(); // remember uncertain commands before attempting network calls
    await Promise.allSettled(run.pendingOff.map(entity => this.deps.callService(entity.split('.')[0], 'turn_off', { entity_id: entity })));
    try {
      const states = await this.deps.getStates(run.pendingOff);
      for (const entity of run.pendingOff) if (states[entity]?.state === 'off') this.state.lastStoppedAt[entity] = this.deps.now?.() ?? this.operationNow ?? Date.now();
      run.pendingOff = run.pendingOff.filter(entity => states[entity]?.state !== 'off');
    } catch { /* retain uncertain state; retry on every watchdog tick */ }
    run.controlled = run.controlled.filter(entity => run.pendingOff.includes(entity));
    this._save();
    return run.pendingOff.length === 0;
  }
  async _end(status, reason) {
    const run = this.state.run;
    run.status = status; run.reason = reason; run.holdSince = null;
    if (status === 'FAILED') {
      // Missing feedback can make even a device that was already on unsafe.
      // Stop this preparation's environmental equipment, never unrelated lights.
      const mapped = (run.settings?.rooms ?? []).flatMap(room => [room.climateEntity, room.humidifierEntity, room.dehumidifierEntity])
        .filter(entity => typeof entity === 'string' && /^(climate|humidifier)\.[a-z0-9_]+$/.test(entity)
          && (run.allowedEntities == null || run.allowedEntities.includes(entity)));
      run.controlled = [...new Set([...run.controlled, ...mapped])];
    }
    this._save();
    const stopped = await this._stop();
    if (!stopped) { run.status = 'FAILED'; run.reason = `${reason}:shutdown_unconfirmed`; }
    await this._event(run.status === 'CANCELLED' ? 'optimization_cancelled' : 'optimization_failed');
    if (run.status === 'FAILED') await this._alert();
    this._save();
  }
  tick(input) {
    const pending = this.serial.then(() => this._tick(input));
    this.serial = pending.catch(() => {});
    return pending;
  }
  async _tick({ config, roomState, now = Date.now() }) {
    this.operationNow = now;
    let run = this.state.run;
    const key = preparationReservationKey(config);
    if (run?.pendingOff?.length) {
      await this._stop();
      if (run.status === 'FAILED') await this._alert();
      if (run.pendingOff.length) return;
    }
    if (this.restarted && run?.status === 'PREPARING') {
      this.restarted = false;
      return this._end('FAILED', 'watcher_restarted_during_preparation');
    }
    if (run?.status === 'FAILED' && !run.alerted) await this._alert();
    const unfinishedReservation = run?.status === 'PREPARING' || (run?.status === 'COMPLETED' && run.arrivedAt == null && now < run.checkIn);
    if (unfinishedReservation && (key !== run.reservationKey || config?.dataOrigin === 'SIMULATED')) {
      await this._end('CANCELLED', key ? 'reservation_rescheduled' : 'reservation_cancelled');
      if (run.pendingOff.length) return;
    }
    if (!key || config?.dataOrigin === 'SIMULATED' || (run?.reservationKey === key && run.status !== 'PREPARING')) return;
    const settings = config.optimization ?? {};
    if (!run || run.reservationKey !== key) {
      if (roomState.mainStatus !== 'VACANT' || roomState.subStatus === 'MAINTENANCE') return;
      const checkIn = Date.parse(config.reservation.checkIn);
      // A missed scheduled time does not prove arrival. If cleaning ended late,
      // a still-current reservation may be prepared until actual entry is seen.
      const checkOut = Date.parse(config.reservation.checkOut ?? '');
      if (checkIn - now > 120 * 60_000 || (now >= checkIn && (!Number.isFinite(checkOut) || now >= checkOut))) return;
      let weather = null, states = {};
      const scope = await this._scope(settings, config.areaName);
      try { weather = await this.deps.getWeather?.(config); } catch { /* weather is advisory, indoor sensors are mandatory */ }
      const targets = deriveOptimizationTargets(weather);
      try { states = await this.deps.getStates(preparationEntityIds(settings).filter(entity => scope.allowed == null || scope.allowed.includes(entity))); } catch { /* evaluated as unavailable below */ }
      now = this.deps.now?.() ?? now;
      const assessment = evaluatePreparationEnvironment(settings, states, targets, now);
      if (checkIn - now > preparationLeadMs(targets, assessment)) return;
      run = this.state.run = {
        id: this.deps.createId(), propertyId: config.areaName, reservationKey: key, checkIn, status: 'PREPARING', startedAt: now,
        targets, settings: structuredClone(settings), allowedEntities: scope.allowed, operatorNotifyService: settings.operatorNotifyService,
        controlled: [], pendingOff: [], lastCommands: {}, holdSince: null, lastObservedAt: null,
        progressAt: now, bestScore: assessment.score, readings: [], noControlNeeded: true,
      };
      if (!this._save()) return this._end('FAILED', 'state_persistence_failed');
      await this._event('checkin_prep_time_reached');
      if (scope.fault) return this._end('FAILED', scope.fault);
      if (this.deps.checkOperatorChannel) {
        try { if (!await this.deps.checkOperatorChannel(settings.operatorNotifyService)) return this._end('FAILED', 'operator_notification_channel_unavailable'); }
        catch { return this._end('FAILED', 'operator_notification_channel_unavailable'); }
      } else if (!/^notify\.[a-z0-9_]+$/.test(settings.operatorNotifyService ?? '')) return this._end('FAILED', 'operator_notification_channel_missing');
    }
    if (now < run.startedAt || (run.lastObservedAt != null && now < run.lastObservedAt)) return this._end('FAILED', 'clock_moved_backwards');
    if (now - run.startedAt >= POLICY.maxRunMs) return this._end('FAILED', 'maximum_runtime_exceeded');
    let states;
    const scope = await this._scope(run.settings, run.propertyId);
    run.allowedEntities = scope.allowed;
    if (scope.fault) return this._end('FAILED', scope.fault);
    try { states = await this.deps.getStates(preparationEntityIds(run.settings)); }
    catch { return this._end('FAILED', 'critical_device_read_failed'); }
    now = this.deps.now?.() ?? now;
    if (now - run.startedAt >= POLICY.maxRunMs) return this._end('FAILED', 'maximum_runtime_exceeded');
    const assessment = evaluatePreparationEnvironment(run.settings, states, run.targets, now);
    run.readings = assessment.readings;
    // Any actuator we have commanded is critical until its off state is verified.
    const badDevice = run.controlled.find(entity => !states[entity] || ['unknown', 'unavailable'].includes(states[entity].state));
    if (assessment.faults.length || badDevice) return this._end('FAILED', assessment.faults[0] ?? `${badDevice}:device_unavailable`);
    if (!run.preflightPassed) {
      const alreadyOn = run.settings.rooms.flatMap(room => [room.climateEntity, room.humidifierEntity, room.dehumidifierEntity])
        .filter(entity => entity && states[entity]?.state !== 'off');
      run.controlled = [...new Set([...run.controlled, ...alreadyOn])];
    }
    if (run.lastObservedAt == null || now - run.lastObservedAt > POLICY.maxObservationGapMs || now < run.lastObservedAt) run.holdSince = null;
    run.lastObservedAt = now;
    if (assessment.score < run.bestScore - 0.2) { run.bestScore = assessment.score; run.progressAt = now; }
    if (!assessment.inTarget && now - run.progressAt >= POLICY.noProgressMs) return this._end('FAILED', 'environment_not_improving');
    const desiredEntities = new Set(assessment.commands.map(c => c.data.entity_id));
    // End unnecessary demand as each room reaches its band, while monitoring
    // every room for the full stable interval. No fixed cooling or area scenes.
    for (const entity of [...run.controlled]) {
      if (desiredEntities.has(entity)) continue;
      try {
        await this.deps.callService(entity.split('.')[0], 'turn_off', { entity_id: entity });
        const verified = await this.deps.getStates([entity]);
        if (verified[entity]?.state !== 'off') throw new Error('off_not_confirmed');
        this.state.lastStoppedAt[entity] = now;
        run.controlled = run.controlled.filter(id => id !== entity); delete run.lastCommands[entity];
      } catch { return this._end('FAILED', 'device_shutdown_failed'); }
    }
    for (const command of assessment.commands) {
      const entity = command.data.entity_id;
      const signature = JSON.stringify(assessment.commands.filter(c => c.data.entity_id === entity));
      if (run.lastCommands[entity] === signature) continue;
      if (run.lastCommands[entity] && command.domain === 'climate') {
        try {
          await this.deps.callService('climate', 'turn_off', { entity_id: entity });
          const verified = await this.deps.getStates([entity]);
          if (verified[entity]?.state !== 'off') throw new Error('off_not_confirmed');
          this.state.lastStoppedAt[entity] = now;
          run.controlled = run.controlled.filter(id => id !== entity); delete run.lastCommands[entity];
        } catch { return this._end('FAILED', 'device_shutdown_failed'); }
      }
      if (command.domain === 'climate' && now - (this.state.lastStoppedAt[entity] ?? -Infinity) < POLICY.minimumOffMs) continue;
      if (!run.controlled.includes(entity)) run.controlled.push(entity);
      run.noControlNeeded = false;
      if (!this._save()) return this._end('FAILED', 'state_persistence_failed');
      try {
        for (const action of assessment.commands.filter(c => c.data.entity_id === entity)) await this.deps.callService(action.domain, action.service, action.data);
        run.lastCommands[entity] = signature;
      } catch { return this._end('FAILED', 'environment_control_command_failed'); }
    }
    if (!run.preflightPassed) {
      run.preflightPassed = true;
      // Auxiliary lighting is not evidence of environmental success and cannot
      // run before the critical sensor/device/notification checks above.
      try { await this.deps.afterPreflight?.(config, run.allowedEntities); } catch { /* auxiliary failure does not invalidate temperature/humidity */ }
    }
    if (assessment.inTarget) {
      if (run.holdSince == null) run.holdSince = now;
      const currentSamples = run.readings.every(reading => now - reading.temperatureAt <= POLICY.maxObservationGapMs && now - reading.humidityAt <= POLICY.maxObservationGapMs);
      if (now - run.holdSince >= POLICY.stableMs && currentSamples) {
        if (!await this._stop()) return this._end('FAILED', 'completion_shutdown_unconfirmed');
        run.status = 'COMPLETED'; run.finishedAt = now;
        if (!this._save()) return this._end('FAILED', 'state_persistence_failed');
        await this._event('optimization_finished', { noControlNeeded: run.noControlNeeded, arrivedAt: run.arrivedAt ?? null });
      }
    } else run.holdSince = null;
    this._save();
  }
  async onLifecycleEvent(type, { config, now = Date.now() }) {
    this.operationNow = now;
    // Called inside the watcher's serialized cycle, never during a parallel tick.
    const run = this.state.run;
    if (type === 'check_in_detected') {
      if (!preparationReservationKey(config)) return;
      if (run?.reservationKey === preparationReservationKey(config)) { run.arrivedAt = now; this._save(); return; }
      if (run?.status === 'PREPARING') await this._end('CANCELLED', 'next_guest_arrived');
      if (run?.pendingOff?.length) { await this._alert(); return; }
      this.state.run = { id: this.deps.createId(), propertyId: config?.areaName, reservationKey: preparationReservationKey(config), status: 'SKIPPED',
        reason: 'guest_arrived_before_preparation', targets: null, controlled: [], pendingOff: [], arrivedAt: now };
      this._save();
      await this._event('optimization_skipped');
    } else if (['check_out_detected', 'cleaning_started', 'maintenance_required', 'maintenance_started'].includes(type) && run?.status === 'PREPARING') {
      await this._end('CANCELLED', 'room_no_longer_available_for_preparation');
    }
  }
  shutdown() {
    const pending = this.serial.then(async () => {
      if (this.state.run?.status === 'PREPARING') await this._end('FAILED', 'watcher_stopped_during_preparation');
      else if (this.state.run?.pendingOff?.length) await this._stop();
    });
    this.serial = pending.catch(() => {});
    return pending;
  }
}
