import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOptimizationTargets, measuredPreparationState, preparationReservationKey } from '../../src/domain/preStayOptimizationDomain.js';
import { PreStayOptimizationController } from '../../src/application/preStayOptimizationController.js';

const MIN = 60_000;
const start = Date.parse('2026-11-05T05:00:00Z');
const room = { id: 'living', temperatureEntity: 'sensor.living_temperature', humidityEntity: 'sensor.living_humidity', climateEntity: 'climate.living' };
const config = () => ({ areaName: 'test-property', district: 'test-district', reservation: { uid: 'booking-1', checkIn: new Date(start + 60 * MIN).toISOString() }, optimization: { rooms: [room], operatorNotifyService: 'notify.mobile_app_operator' } });

function fixture({ temperature = 29, humidity = 48, outdoor = 28, rooms = [room], restored } = {}) {
  let time = start;
  const states = {}, calls = [], events = [], alerts = [], saved = [];
  const put = (id, state, attributes = {}) => { states[id] = { entity_id: id, state: String(state), attributes, last_reported: new Date(time).toISOString() }; };
  const refresh = (temp = temperature, hum = humidity) => {
    for (const r of rooms) {
      put(r.temperatureEntity, temp, { unit_of_measurement: '°C' });
      put(r.humidityEntity, hum, { unit_of_measurement: '%' });
      if (r.climateEntity) put(r.climateEntity, 'off', { hvac_modes: ['off', 'cool', 'heat'], min_temp: 16, max_temp: 30, temperature_unit: '°C' });
      if (r.dehumidifierEntity) put(r.dehumidifierEntity, 'off', { device_class: 'dehumidifier' });
    }
  };
  refresh();
  const controller = new PreStayOptimizationController({
    getStates: async ids => Object.fromEntries(ids.map(id => [id, states[id] ?? null])),
    callService: async (domain, service, data) => {
      calls.push({ domain, service, data });
      if (service === 'turn_off' && states[data.entity_id]) states[data.entity_id].state = 'off';
    },
    getWeather: async () => ({ temp: outdoor, humidity: 70, source: 'fixture', observedAt: new Date(time).toISOString() }),
    emit: async (type, data) => events.push({ type, data, at: time }),
    alert: async data => alerts.push(data),
    save: state => saved.push(structuredClone(state)),
    createId: () => 'run-1',
  });
  if (restored) controller.restore(restored);
  let cfg = config(); cfg.optimization.rooms = rooms;
  let roomState = { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' };
  const tick = async (minutes = 0, temp, hum) => {
    time = start + minutes * MIN;
    if (temp !== undefined) refresh(temp, hum ?? humidity);
    return controller.tick({ config: cfg, roomState, now: time });
  };
  return { controller, states, calls, events, alerts, saved, put, refresh, tick, get cfg() { return cfg; }, set cfg(v) { cfg = v; }, set state(v) { roomState = v; } };
}

describe('Sensor preparation — actual controller, no external device writes', () => {
  test('outdoor conditions select bounded winter, mild and summer targets including zero', () => {
    assert.equal(deriveOptimizationTargets({ temp: 0 }).temperature.target, 21);
    assert.equal(deriveOptimizationTargets({ temp: 17 }).temperature.target, 23);
    assert.equal(deriveOptimizationTargets({ temp: 35 }).temperature.target, 25);
    assert.ok(deriveOptimizationTargets({ temp: 35, humidity: 90 }).humidity.max < 60);
  });

  test('20 minutes before check-in and successful command acknowledgements do not prove completion', async () => {
    const f = fixture();
    f.cfg.reservation.checkIn = new Date(start + 20 * MIN).toISOString();
    await f.tick();
    assert.ok(f.calls.some(c => c.service === 'set_temperature'));
    assert.equal(f.controller.snapshot().run.status, 'PREPARING');
    assert.ok(!f.events.some(e => e.type === 'optimization_finished'));
  });

  test('every selected living room and bedroom must stay within target for five continuous minutes', async () => {
    const bedroom = { ...room, id: 'bedroom', temperatureEntity: 'sensor.bed_temperature', humidityEntity: 'sensor.bed_humidity', climateEntity: 'climate.bed' };
    const f = fixture({ rooms: [room, bedroom] });
    await f.tick();
    for (let minute = 1; minute <= 5; minute++) {
      f.refresh(25, 48);
      f.put(bedroom.temperatureEntity, 29, { unit_of_measurement: '°C' });
      await f.tick(minute);
    }
    assert.ok(!f.events.some(e => e.type === 'optimization_finished'), 'a good average cannot conceal a hot bedroom');
    for (let minute = 6; minute <= 11; minute++) await f.tick(minute, 25, 48);
    assert.equal(f.events.filter(e => e.type === 'optimization_finished').length, 1);
    assert.equal(f.controller.snapshot().run.status, 'COMPLETED');
  });

  test('an excursion resets the continuous hold and repeated ticks emit completion only once', async () => {
    const f = fixture({ temperature: 25 });
    await f.tick(0, 25);
    await f.tick(1, 25);
    await f.tick(2, 29);
    for (let minute = 3; minute <= 7; minute++) await f.tick(minute, 25);
    assert.equal(f.events.filter(e => e.type === 'optimization_finished').length, 0);
    await f.tick(8, 25);
    await f.tick(9, 25);
    assert.equal(f.events.filter(e => e.type === 'optimization_finished').length, 1);
  });

  test('already suitable conditions need no climate start command but still need sustained measurement', async () => {
    const f = fixture({ temperature: 25 });
    for (let minute = 0; minute <= 5; minute++) await f.tick(minute, 25);
    assert.equal(f.calls.filter(c => c.service === 'set_temperature').length, 0);
    assert.equal(f.controller.snapshot().run.status, 'COMPLETED');
    assert.equal(f.events.at(-1).data.noControlNeeded, true);
  });

  test('missing critical sensor fails preflight before any climate start and alerts the operator', async () => {
    const f = fixture();
    delete f.states[room.humidityEntity];
    await f.tick();
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.ok(!f.calls.some(c => c.service === 'set_temperature'));
    assert.equal(f.alerts.length, 1);
    assert.ok(f.events.some(e => e.type === 'optimization_failed'));
  });

  test('optional lighting or power telemetry being absent does not invalidate environmental measurements', async () => {
    const f = fixture({ temperature: 25 });
    f.cfg.devices = { LIGHT_LIVING: 'light.unavailable' };
    for (let minute = 0; minute <= 5; minute++) await f.tick(minute, 25);
    assert.equal(f.controller.snapshot().run.status, 'COMPLETED');
  });

  test('critical sensor loss while running stops environmental actuators and never reports success', async () => {
    const f = fixture();
    await f.tick();
    f.put(room.temperatureEntity, 'unavailable');
    await f.tick(1);
    await f.tick(2);
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.ok(f.calls.some(c => c.service === 'turn_off' && c.data.entity_id === room.climateEntity));
    assert.equal(f.alerts.length, 1);
    assert.equal(f.events.filter(e => e.type === 'optimization_finished').length, 0);
  });

  test('stale, malformed and wrong-unit critical measurements are rejected', async () => {
    for (const bad of [
      { state: '25', attributes: { unit_of_measurement: '°C' }, last_reported: new Date(start - 6 * MIN).toISOString() },
      { state: '25junk', attributes: { unit_of_measurement: '°C' }, last_reported: new Date(start).toISOString() },
      { state: '25', attributes: { unit_of_measurement: 'W' }, last_reported: new Date(start).toISOString() },
    ]) {
      const f = fixture(); f.states[room.temperatureEntity] = bad;
      await f.tick();
      assert.equal(f.controller.snapshot().run.status, 'FAILED');
      assert.ok(!f.calls.some(c => c.service === 'set_temperature'));
    }
  });

  test('lack of humidity equipment does not silently turn a humidity failure into success', async () => {
    const f = fixture({ humidity: 80 });
    await f.tick();
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.ok(!f.events.some(e => e.type === 'optimization_finished'));
  });

  test('unsupported heating capability fails preflight instead of forcing cooling in winter', async () => {
    const f = fixture({ temperature: 16, outdoor: 0 });
    f.states[room.climateEntity].attributes.hvac_modes = ['off', 'cool'];
    await f.tick();
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.ok(!f.calls.some(c => c.service === 'set_temperature'));
  });

  test('early arrival does not stop an active preparation run', async () => {
    const f = fixture();
    await f.tick();
    f.state = { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' };
    await f.controller.onLifecycleEvent('check_in_detected', { config: f.cfg, now: start + MIN });
    for (let minute = 1; minute <= 6; minute++) await f.tick(minute, 25);
    assert.equal(f.controller.snapshot().run.status, 'COMPLETED');
    assert.equal(f.events.filter(e => e.type === 'optimization_finished').length, 1);
    assert.equal(f.events.filter(e => e.type === 'optimization_skipped').length, 0);
  });

  test('arrival immediately after cleaning without an attempt is skipped, not failed or successful', async () => {
    const f = fixture();
    await f.controller.onLifecycleEvent('check_in_detected', { config: f.cfg, now: start });
    assert.equal(f.controller.snapshot().run.status, 'SKIPPED');
    assert.equal(f.events.filter(e => e.type === 'optimization_skipped').length, 1);
    assert.equal(f.calls.length, 0);
  });

  test('cancellation stops control and records exclusion instead of failure', async () => {
    const f = fixture(); await f.tick();
    f.cfg.reservation = null;
    await f.tick(1);
    assert.equal(f.controller.snapshot().run.status, 'CANCELLED');
    assert.ok(f.calls.some(c => c.service === 'turn_off'));
    assert.ok(f.events.some(e => e.type === 'optimization_cancelled'));
  });

  test('an unobserved five-minute gap cannot be used as a stable hold', async () => {
    const f = fixture({ temperature: 25 }); await f.tick(0, 25);
    await f.tick(6, 25);
    assert.equal(f.controller.snapshot().run.status, 'PREPARING');
  });

  test('restarting with an active run fails safe and attempts shutdown before any restart', async () => {
    const first = fixture(); await first.tick();
    const f = fixture({ restored: first.controller.snapshot() });
    await f.tick(1);
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.ok(f.calls.some(c => c.service === 'turn_off'));
    assert.ok(!f.calls.some(c => c.service === 'set_temperature'));
  });

  test('control command failure stops every environmental device and records failure', async () => {
    const f = fixture();
    const call = f.controller.deps.callService;
    f.controller.deps.callService = async (...args) => { if (args[1] === 'set_temperature') throw new Error('fixture communication failure'); return call(...args); };
    await f.tick();
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.ok(f.calls.some(c => c.service === 'turn_off'));
    assert.equal(f.alerts.length, 1);
  });

  test('failed stop remains uncertain, retries and cannot automatically restart the failed run', async () => {
    const f = fixture(); await f.tick();
    f.controller.deps.callService = async () => { throw new Error('fixture network disconnected'); };
    f.put(room.climateEntity, 'cool'); f.put(room.temperatureEntity, 'unavailable');
    await f.tick(1);
    assert.deepEqual(f.controller.snapshot().run.pendingOff, [room.climateEntity]);
    assert.equal(f.alerts[0].stopUnconfirmed, true);
    await f.tick(2);
    f.put(room.climateEntity, 'off'); await f.tick(3);
    assert.deepEqual(f.controller.snapshot().run.pendingOff, []);
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
  });

  test('failed operator notification is retried; missing channel blocks preflight', async () => {
    const f = fixture(); let attempts = 0;
    f.controller.deps.alert = async () => { if (++attempts === 1) throw new Error('fixture push failure'); };
    f.controller.deps.checkOperatorChannel = async () => false;
    await f.tick(); await f.tick(1);
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.equal(attempts, 2); assert.equal(f.controller.snapshot().run.alerted, true);
    assert.ok(!f.calls.some(c => c.service === 'set_temperature'));
  });

  test('a device already on is stopped if preflight discovers a broken critical sensor', async () => {
    const f = fixture();
    f.put(room.climateEntity, 'heat', { hvac_modes: ['off', 'heat'] });
    delete f.states[room.temperatureEntity];
    await f.tick();
    assert.ok(f.calls.some(c => c.service === 'turn_off' && c.data.entity_id === room.climateEntity));
  });

  test('no environmental improvement and maximum runtime both have independent safety stops', async () => {
    for (const minutes of [20, 120]) {
      const f = fixture(); await f.tick();
      await f.tick(minutes, 29, 48);
      assert.equal(f.controller.snapshot().run.status, 'FAILED');
      assert.match(f.controller.snapshot().run.reason, minutes === 20 ? /not_improving/ : /maximum_runtime/);
      assert.ok(f.calls.some(c => c.service === 'turn_off'));
    }
  });

  test('clock moving backwards stops the run rather than extending its runtime', async () => {
    const f = fixture(); await f.tick(); await f.tick(-1, 29);
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.match(f.controller.snapshot().run.reason, /clock_moved_backwards/);
  });

  test('late cleaning can still start preparation for an unarrived guest during the booked stay', async () => {
    const f = fixture();
    f.cfg.reservation.checkIn = new Date(start - MIN).toISOString();
    f.cfg.reservation.checkOut = new Date(start + 24 * 60 * MIN).toISOString();
    await f.tick();
    assert.equal(f.controller.snapshot().run.status, 'PREPARING');
  });

  test('reservation rescheduling stops the old run and reevaluates a later preparation window', async () => {
    const f = fixture(); await f.tick();
    f.cfg.reservation.checkIn = new Date(start + 5 * 60 * MIN).toISOString();
    await f.tick(1);
    assert.equal(f.controller.snapshot().run.status, 'CANCELLED');
    assert.ok(f.calls.some(c => c.service === 'turn_off'));
  });

  test('SIMULATED property input never activates physical equipment', async () => {
    const f = fixture(); f.cfg.dataOrigin = 'SIMULATED'; await f.tick();
    assert.equal(f.calls.length, 0); assert.equal(f.events.length, 0);
  });

  test('normal shutdown stops active equipment before the process exits', async () => {
    const f = fixture(); await f.tick(); await f.controller.shutdown();
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.ok(f.calls.some(c => c.service === 'turn_off'));
  });

  test('the current UI uses only the matching real measured run, never another reservation or simulated property', () => {
    const cfg = config(), property = { reservation: cfg.reservation, dataOrigin: 'REAL' };
    const actual = { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZATION_FAILED' };
    const prep = { run: { reservationKey: preparationReservationKey(cfg) } };
    assert.deepEqual(measuredPreparationState(property, cfg.areaName, prep, actual), actual);
    assert.equal(measuredPreparationState(property, 'other-property', prep, actual), null);
    assert.equal(measuredPreparationState({ ...property, dataOrigin: 'SIMULATED' }, cfg.areaName, prep, actual), null);
    assert.equal(measuredPreparationState({ ...property, reservation: { ...cfg.reservation, uid: 'other-booking' } }, cfg.areaName, prep, actual), null);
  });

  test('another property climate device must never receive even a shutdown command during failed preflight', async () => {
    const f = fixture();
    f.controller.deps.getAllowedEntities = async () => [room.temperatureEntity, room.humidityEntity];
    await f.tick();
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.match(f.controller.snapshot().run.reason, /outside_property/);
    assert.equal(f.calls.length, 0, 'foreign equipment must not be started or stopped');
  });

  test('new guest arrival cannot erase an older unconfirmed safety shutdown', async () => {
    const f = fixture(); await f.tick();
    f.put(room.climateEntity, 'cool'); f.put(room.temperatureEntity, 'unavailable');
    f.controller.deps.callService = async () => { throw new Error('fixture stop failed'); };
    await f.tick(1);
    f.cfg.reservation.uid = 'new-booking';
    await f.controller.onLifecycleEvent('check_in_detected', { config: f.cfg, now: start + 2 * MIN });
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.deepEqual(f.controller.snapshot().run.pendingOff, [room.climateEntity]);
  });

  test('verified AC dry mode may reduce humidity but cannot keep cooling below the temperature band', async () => {
    const f = fixture({ temperature: 25, humidity: 75 });
    f.states[room.climateEntity].attributes.hvac_modes.push('dry');
    await f.tick();
    assert.ok(f.calls.some(c => c.service === 'set_hvac_mode' && c.data.hvac_mode === 'dry'));
    f.put(room.temperatureEntity, 24.2, { unit_of_measurement: '°C' });
    await f.tick(1);
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.ok(f.calls.some(c => c.service === 'turn_off'));
  });

  test('a cancelled booking is excluded even if preparation had finished before its guests arrived', async () => {
    const f = fixture({ temperature: 25 });
    for (let minute = 0; minute <= 5; minute++) await f.tick(minute, 25);
    assert.equal(f.controller.snapshot().run.status, 'COMPLETED');
    f.cfg.reservation = null; await f.tick(6);
    assert.equal(f.controller.snapshot().run.status, 'CANCELLED');
    assert.ok(f.events.some(e => e.type === 'optimization_cancelled'));
  });

  test('failed persistent state storage prevents environmental start and alerts instead of losing safety state', async () => {
    const f = fixture(); f.controller.deps.save = () => false;
    await f.tick();
    assert.equal(f.controller.snapshot().run.status, 'FAILED');
    assert.equal(f.controller.snapshot().run.reason, 'state_persistence_failed');
    assert.ok(!f.calls.some(c => c.service === 'set_temperature'));
    assert.equal(f.alerts.length, 1);
  });

  test('small fluctuations do not rapidly restart a stopped climate device', async () => {
    const f = fixture(); await f.tick(0, 29); await f.tick(1, 25);
    const started = f.calls.filter(c => c.service === 'set_temperature').length;
    await f.tick(2, 27);
    assert.equal(f.calls.filter(c => c.service === 'set_temperature').length, started);
    await f.tick(6, 27);
    assert.equal(f.calls.filter(c => c.service === 'set_temperature').length, started + 1);
  });
});
