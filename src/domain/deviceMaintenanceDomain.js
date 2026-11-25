const HOUR = 60 * 60_000;

export const DEVICE_MAINTENANCE_HOURS = Object.freeze([1, 4, 24]);

function entityId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
/** 숙소 설정에 명시적으로 매핑된 HA 엔티티만 오프라인 감시 대상으로 쓴다. */
export function configuredDeviceEntities(deviceMap = {}) {
  if (!deviceMap || typeof deviceMap !== 'object' || Array.isArray(deviceMap)) return [];
  const ids = Object.values(deviceMap)
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .map(entityId)
    .filter(Boolean);
  return [...new Set(ids)].sort();
}

/**
 * 정기 재시작·펌웨어 작업 예외는 영구 플래그가 아니라 종료 시각으로 저장한다.
 * 이미 끝났거나 현재 매핑에서 빠진 엔티티는 자동으로 버린다.
 */
export function normalizeDeviceMaintenanceUntil(raw, deviceMap = {}, now = Date.now()) {
  const allowed = new Set(configuredDeviceEntities(deviceMap));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const normalized = {};
  for (const [rawId, value] of Object.entries(raw)) {
    const id = entityId(rawId);
    const until = Date.parse(value);
    if (!id || !allowed.has(id) || !Number.isFinite(until) || until <= now) continue;
    normalized[id] = new Date(until).toISOString();
  }
  return normalized;
}

export function setDeviceMaintenanceHours(raw, deviceMap, targetEntityId, hours, now = Date.now()) {
  const normalized = normalizeDeviceMaintenanceUntil(raw, deviceMap, now);
  const target = entityId(targetEntityId);
  if (!target || !configuredDeviceEntities(deviceMap).includes(target)) {
    throw new Error('점검 제외 기기가 현재 숙소 기기 매핑에 없습니다');
  }
  if (!DEVICE_MAINTENANCE_HOURS.includes(hours)) throw new Error('점검 제외 시간이 올바르지 않습니다');
  normalized[target] = new Date(now + hours * HOUR).toISOString();
  return normalized;
}

/** HA 상태를 오프라인 판정기의 보수적인 관측값으로 바꾼다. */
export function buildDeviceAvailability(stateMap = {}, deviceMap = {}, maintenanceUntil = {}, now = Date.now()) {
  const excluded = normalizeDeviceMaintenanceUntil(maintenanceUntil, deviceMap, now);
  return configuredDeviceEntities(deviceMap).map(id => {
    const state = stateMap?.[id];
    const name = state?.attributes?.friendly_name || id;
    if (excluded[id]) return { entityId: id, name, status: 'excluded' };
    if (!state || state.state == null || state.state === 'unknown') return { entityId: id, name, status: 'unknown' };
    return { entityId: id, name, status: state.state === 'unavailable' ? 'offline' : 'online' };
  });
}
