async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

export async function callService(domain, service, data = {}) {
  return requestJson("/api/ha/service", {
    method: "POST",
    body: JSON.stringify({ domain, service, data }),
  });
}

export async function getState(entityId) {
  const payload = await requestJson(`/api/ha/state?entityId=${encodeURIComponent(entityId)}`);
  return payload.state ?? null;
}

export async function getStates(entityIds) {
  const payload = await requestJson("/api/ha/states", {
    method: "POST",
    body: JSON.stringify({ entityIds }),
  });
  return payload.states ?? {};
}

export async function renderTemplate(template) {
  const payload = await requestJson("/api/ha/template", {
    method: "POST",
    body: JSON.stringify({ template }),
  });
  return payload.result ?? "";
}

const SENSOR_CLASS_MAP = {
  temperature:    "temp",
  humidity:       "humidity",
  power:          "power",
  carbon_dioxide: "co2",
  sound_pressure: "noise",
};

const SKIP_DEVICE_CLASSES = new Set(['battery', 'tamper', 'problem', 'signal_strength']);
const SHOW_BINARY_CLASSES  = new Set(['door', 'motion', 'window', 'smoke', 'moisture']);

function trimSuffix(str, suffix) {
  return str.endsWith(suffix) ? str.slice(0, -suffix.length).trim() : str.trim();
}

function deriveDeviceLabel(entityId, friendly, domain, dc) {
  if (domain === 'switch' && entityId.endsWith('_switch_1'))
    return trimSuffix(friendly, 'Switch 1') + ' 팬';
  if (domain === 'switch' && entityId.endsWith('_switch_2'))
    return trimSuffix(friendly, 'Switch 2') + ' 조명';
  if (domain === 'light') {
    const idx = friendly.indexOf('Smart Bulb');
    return idx >= 0 ? friendly.slice(0, idx).trim() + '전등' : friendly;
  }
  if (dc === 'door')
    return trimSuffix(friendly, 'Door') + ' 도어';
  if (dc === 'motion')
    return friendly.replace('Human Motion Sensor', '').replace('Motion', '').trim() + ' 감지';
  return friendly;
}

function deviceIcon(domain, dc, entityId) {
  if (domain === 'light') return '💡';
  if (domain === 'binary_sensor' && dc === 'door') return '🚪';
  if (domain === 'binary_sensor' && dc === 'motion') return '👤';
  if (entityId.endsWith('_switch_1')) return '🌀';
  return '💡';
}

function classifyDevice(entityId, state) {
  if (!state) return null;
  const domain = entityId.split('.')[0];
  const dc = state.attributes?.device_class ?? '';
  const friendly = state.attributes?.friendly_name || entityId;

  if (SKIP_DEVICE_CLASSES.has(dc)) return null;
  if (['select', 'event', 'scene', 'sensor'].includes(domain)) return null;
  if (domain === 'binary_sensor' && !SHOW_BINARY_CLASSES.has(dc)) return null;
  if (!['light', 'switch', 'binary_sensor'].includes(domain)) return null;

  const stateVal = state.state;
  return {
    entityId,
    label: deriveDeviceLabel(entityId, friendly, domain, dc),
    icon: deviceIcon(domain, dc, entityId),
    domain,
    deviceClass: dc,
    state: stateVal,
    isOn: stateVal === 'on',
    isUnavailable: stateVal === 'unavailable',
  };
}

function extractRoomLabel(friendly) {
  return friendly
    .replace(/\s*T\s*&\s*H.*/i, '')
    .replace(/\s*온습도.*/i, '')
    .replace(/\s*(Temperature|Humidity).*$/i, '')
    .trim();
}

function processEntity(entityId, state, readings, devices, energyEntityIds) {
  if (!state) return;
  if (state.attributes?.state_class === 'total_increasing' && entityId.startsWith('sensor.')) {
    energyEntityIds.push(entityId);
    return;
  }
  const dc = state.attributes?.device_class;
  const sensorKey = SENSOR_CLASS_MAP[dc];
  if (sensorKey) {
    const val = Number.parseFloat(state.state);
    if (!Number.isNaN(val)) {
      const label = extractRoomLabel(state.attributes?.friendly_name || '');
      readings.push({ key: sensorKey, val, label });
      return;
    }
  }
  const device = classifyDevice(entityId, state);
  if (device) devices.push(device);
}

async function sumDailyEnergy(entityIds) {
  if (entityIds.length === 0) return 0;
  const usages = await Promise.all(entityIds.map(getDailyEnergyKwh));
  return usages.filter(v => v !== null).reduce((a, b) => a + b, 0);
}

async function getDailyEnergyKwh(entityId) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const res = await requestJson(
    `/api/ha/history?entityId=${encodeURIComponent(entityId)}&start=${encodeURIComponent(midnight.toISOString())}`
  );
  const history = res.history ?? [];
  if (history.length < 2) return null;
  const first = Number.parseFloat(history[0].state);
  const last  = Number.parseFloat(history[history.length - 1].state);
  if (Number.isNaN(first) || Number.isNaN(last)) return null;
  return Math.max(0, Math.round((last - first) * 1000) / 1000);
}

const OUTDOOR_LABEL_RE = /현재|실외|외부|outdoor/i;

/**
 * Area 엔티티 states → 모니터링 스냅샷
 * OccupancyMonitor.process()가 요구하는 형태로 변환
 */
function buildMonitoringSnapshot(readings, devices, allStates) {
  const outdoorTemps = readings.filter(r => r.key === 'temp'     && OUTDOOR_LABEL_RE.test(r.label));
  const indoorTemps  = readings.filter(r => r.key === 'temp'     && !OUTDOOR_LABEL_RE.test(r.label));
  const outdoorHums  = readings.filter(r => r.key === 'humidity' && OUTDOOR_LABEL_RE.test(r.label));
  const indoorHums   = readings.filter(r => r.key === 'humidity' && !OUTDOOR_LABEL_RE.test(r.label));
  const powerReadings = readings.filter(r => r.key === 'power');

  // climate 엔티티 (에어컨) — processEntity에서 처리 안 됨, states에서 직접 추출
  const climateEntry = Object.entries(allStates).find(([id]) => id.startsWith('climate.'));
  const cs = climateEntry?.[1];

  const smokeDev     = devices.find(d => d.deviceClass === 'smoke');
  const doorDev      = devices.find(d => d.deviceClass === 'door');
  const motionDev    = devices.find(d => d.deviceClass === 'motion');
  const noiseReadings = readings.filter(r => r.key === 'noise');

  return {
    acMode:          cs?.state ?? null,
    acPower:         powerReadings.length ? powerReadings.reduce((s, r) => s + r.val, 0) : null,
    acTemp:          cs ? (Number.parseFloat(cs.attributes?.current_temperature) || null) : null,
    acHumidity:      cs ? (Number.parseFloat(cs.attributes?.current_humidity) || null) : null,
    smokeDetected:   smokeDev?.isOn ?? false,
    outdoorTemp:     outdoorTemps[0]?.val ?? null,
    outdoorHumidity: outdoorHums[0]?.val ?? null,
    indoorTemps,
    indoorHumidities: indoorHums,
    doorOpen:        doorDev?.isOn ?? null,
    motionDetected:  motionDev?.isOn ?? null,
    noiseLevel:      noiseReadings.length ? Math.max(...noiseReadings.map(r => r.val)) : null,
  };
}

/**
 * HA Area 이름 → { sensorReadings, devices, monitoringSnapshot }
 * sensorReadings: [{ key, val, label }]
 * devices: 조명·스위치·도어·모션·연기 상태 배열
 * monitoringSnapshot: OccupancyMonitor 입력 형태
 */
export async function getAreaData(areaName) {
  const raw = await renderTemplate(
    `{{ area_entities('${areaName}') | list | tojson }}`
  );
  let entityIds;
  try { entityIds = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(entityIds) || entityIds.length === 0) return null;

  const states = await getStates(entityIds);
  const readings = [];
  const devices = [];
  const energyEntityIds = [];

  for (const [entityId, state] of Object.entries(states)) {
    processEntity(entityId, state, readings, devices, energyEntityIds);
  }

  const totalEnergy = await sumDailyEnergy(energyEntityIds);
  if (totalEnergy > 0) readings.push({ key: 'energy', val: totalEnergy, label: '' });

  return {
    sensorReadings:     readings.length > 0 ? readings : null,
    devices,
    monitoringSnapshot: buildMonitoringSnapshot(readings, devices, states),
  };
}

export default { callService, getState, getStates, renderTemplate, getAreaData };
