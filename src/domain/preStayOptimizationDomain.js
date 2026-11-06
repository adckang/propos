/** Sensor preparation policy. Pure functions: no HA, clock, persistence or network. */
export const PREPARATION_POLICY = Object.freeze({
  version: 'sensor-v1', stableMs: 5 * 60_000, sensorMaxAgeMs: 5 * 60_000,
  maxObservationGapMs: 90_000, maxRunMs: 120 * 60_000, noProgressMs: 20 * 60_000,
  pollMs: 30_000, requestTimeoutMs: 10_000,
  minimumOffMs: 5 * 60_000,
});

/** Operational defaults, not a claim of an ASHRAE comfort calculation. */
export function deriveOptimizationTargets(weather) {
  const outdoor = typeof weather?.temp === 'number' && Number.isFinite(weather.temp) ? weather.temp : null;
  const cold = outdoor != null && outdoor <= 10;
  const hot = outdoor != null && outdoor >= 25;
  const target = cold ? 21 : hot ? 25 : 23;
  return {
    temperature: { min: target - 1, max: target + 1, target },
    humidity: { min: cold ? 35 : 40, max: cold ? 50 : 55, target: weather?.humidity >= 80 ? 45 : 50 },
    weather: { temp: outdoor, humidity: weather?.humidity ?? null, source: weather?.source ?? 'unavailable', observedAt: weather?.observedAt ?? null },
  };
}

export function preparationEntityIds(settings = {}) {
  return [...new Set((Array.isArray(settings.rooms) ? settings.rooms : []).flatMap(r =>
    [r.temperatureEntity, r.humidityEntity, r.climateEntity, r.humidifierEntity, r.dehumidifierEntity]).filter(Boolean))];
}

function validRooms(settings) {
  const rooms = settings?.rooms;
  if (!Array.isArray(rooms) || !rooms.length) return false;
  return rooms.every(r => r && typeof r.id === 'string' && r.id && /^sensor\./.test(r.temperatureEntity) && /^sensor\./.test(r.humidityEntity))
    && new Set(rooms.map(r => r.id)).size === rooms.length
    && new Set(rooms.flatMap(r => [r.temperatureEntity, r.humidityEntity])).size === rooms.length * 2;
}

function available(state) {
  return state && state.state != null && !['unavailable', 'unknown', ''].includes(String(state.state));
}

function measurement(state, kind, now) {
  if (!available(state)) return null;
  const raw = String(state.state).trim();
  if (!raw || !Number.isFinite(Number(raw))) return null;
  const at = Date.parse(state.last_reported ?? state.last_updated ?? '');
  if (!Number.isFinite(at) || at > now + 30_000 || now - at > PREPARATION_POLICY.sensorMaxAgeMs) return null;
  const unit = state.attributes?.unit_of_measurement;
  let value = Number(raw);
  if (kind === 'temperature') {
    if (unit === '°F') value = (value - 32) * 5 / 9;
    else if (unit !== '°C') return null;
    if (value < -30 || value > 60) return null;
  } else if (unit !== '%' || value < 0 || value > 100) return null;
  return { value, at };
}

/** All configured guest rooms must pass; an average must never hide a bad room. */
export function evaluatePreparationEnvironment(settings, states, targets, now) {
  const faults = [], readings = [], commands = [];
  if (!validRooms(settings)) return { faults: ['room_sensor_mapping_missing_or_invalid'], readings, commands, inTarget: false, score: Infinity };
  for (const room of settings.rooms) {
    for (const entity of [room.climateEntity, room.humidifierEntity, room.dehumidifierEntity].filter(Boolean)) {
      if (!available(states[entity])) faults.push(`${room.id}:environment_device_unavailable`);
    }
    const temp = measurement(states[room.temperatureEntity], 'temperature', now);
    const hum = measurement(states[room.humidityEntity], 'humidity', now);
    if (!temp) faults.push(`${room.id}:temperature_unavailable_or_stale`);
    if (!hum) faults.push(`${room.id}:humidity_unavailable_or_stale`);
    if (!temp || !hum) continue;
    const t = temp.value, h = hum.value;
    readings.push({ roomId: room.id, temperature: t, humidity: h, temperatureAt: temp.at, humidityAt: hum.at });
    const mode = t < targets.temperature.min ? 'heat' : t > targets.temperature.max ? 'cool' : null;
    if (mode) {
      const entity = room.climateEntity, climate = states[entity];
      if (!/^climate\./.test(entity) || !available(climate) || !climate.attributes?.hvac_modes?.includes(mode)) {
        faults.push(`${room.id}:${mode}_device_unavailable_or_unsupported`);
      } else {
        const unit = climate.attributes.temperature_unit ?? room.climateTemperatureUnit;
        const value = unit === '°F' ? targets.temperature.target * 9 / 5 + 32 : targets.temperature.target;
        const min = climate.attributes.min_temp, max = climate.attributes.max_temp;
        if (!['°C', '°F'].includes(unit) || (min != null && value < min) || (max != null && value > max)) faults.push(`${room.id}:unsupported_temperature_target`);
        else commands.push({ domain: 'climate', service: 'set_temperature', data: { entity_id: entity, temperature: value, hvac_mode: mode } });
      }
    }
    if (h < targets.humidity.min || h > targets.humidity.max) {
      const dry = h > targets.humidity.max;
      const entity = dry ? room.dehumidifierEntity : room.humidifierEntity;
      const device = states[entity];
      const climate = states[room.climateEntity];
      const canDry = dry && !entity && available(climate) && climate.attributes?.hvac_modes?.includes('dry')
        && t > targets.temperature.min + 0.5 && mode !== 'heat';
      if (canDry) {
        // Cooling already removes moisture; after temperature settles, dry mode
        // is allowed only while there is room above the lower temperature bound.
        if (mode !== 'cool') commands.push({ domain: 'climate', service: 'set_hvac_mode', data: { entity_id: room.climateEntity, hvac_mode: 'dry' } });
      } else if (!/^humidifier\./.test(entity) || !available(device) || (dry && device.attributes?.device_class !== 'dehumidifier') || (!dry && device.attributes?.device_class === 'dehumidifier')) {
        faults.push(`${room.id}:${dry ? 'dehumidifier' : 'humidifier'}_unavailable`);
      } else {
        commands.push({ domain: 'humidifier', service: 'set_humidity', data: { entity_id: entity, humidity: targets.humidity.target } });
        commands.push({ domain: 'humidifier', service: 'turn_on', data: { entity_id: entity } });
      }
    }
  }
  // One physical actuator cannot receive conflicting commands for separate rooms.
  const thermal = commands.filter(c => c.service === 'set_temperature');
  for (const command of thermal) if (thermal.some(other => other.data.entity_id === command.data.entity_id && other.data.hvac_mode !== command.data.hvac_mode)) faults.push('conflicting_shared_climate_device');
  const score = readings.reduce((max, r) => Math.max(max,
    targets.temperature.min - r.temperature, r.temperature - targets.temperature.max,
    (targets.humidity.min - r.humidity) / 10, (r.humidity - targets.humidity.max) / 10), 0);
  return { faults, readings, commands: commands.filter((c, i) => commands.findIndex(other => JSON.stringify(other) === JSON.stringify(c)) === i), inTarget: !faults.length && score === 0, score };
}

export function preparationLeadMs(targets, assessment) {
  const outdoor = targets.weather.temp;
  if ((outdoor != null && (outdoor <= 0 || outdoor >= 35)) || (Number.isFinite(assessment.score) && assessment.score >= 6)) return 120 * 60_000;
  return (assessment.score >= 3 ? 90 : 60) * 60_000;
}

export function preparationReservationKey(config) {
  if (typeof config?.areaName !== 'string' || !config.areaName.trim()) return null;
  const r = config?.reservation;
  if (r?.status === 'CANCELLED') return null;
  const checkIn = Date.parse(r?.checkIn ?? '');
  if (!Number.isFinite(checkIn)) return null;
  return JSON.stringify([config.areaName, r.uid ?? null, checkIn]);
}

/** Forecast bars stay forecasts; the current status uses the matching measured run. */
export function measuredPreparationState(property, areaName, preparation, roomState) {
  if (property?.dataOrigin === 'SIMULATED' || !preparation?.run || !roomState?.mainStatus) return null;
  const key = preparationReservationKey({ areaName, reservation: property?.reservation });
  return key && preparation.run.reservationKey === key ? { ...roomState } : null;
}
