import { getHaState, getHaServices, renderHaTemplate, callHaService } from './haProxy.js';
import { fetchWeather } from './weatherService.js';
import { PREPARATION_POLICY } from '../src/domain/preStayOptimizationDomain.js';
import { hasOperatorAlertWebhook, notifyPreparationSafety } from './slackNotifier.js';

const weatherCache = new Map();
const requestOptions = () => ({ signal: AbortSignal.timeout(PREPARATION_POLICY.requestTimeoutMs) });

export async function getPreparationAreaEntities(areaName) {
  if (typeof areaName !== 'string' || !areaName) throw new Error('Property area is required');
  const raw = await renderHaTemplate(`{{ area_entities(${JSON.stringify(areaName)}) | list | tojson }}`, requestOptions());
  const entities = JSON.parse(raw);
  if (!Array.isArray(entities) || !entities.length) throw new Error('Property HA area is empty');
  return entities;
}

export async function checkOperatorChannel(service) {
  if (hasOperatorAlertWebhook()) return true;
  if (!/^notify\.[a-z0-9_]+$/.test(service ?? '')) return false;
  const services = await getHaServices(requestOptions());
  return services.some(group => group.domain === 'notify' && Object.hasOwn(group.services ?? {}, service.slice('notify.'.length)));
}

/** The HA weather entity must be explicitly tied to this property, never guessed. */
export async function getPreparationWeather(config) {
  const entity = config.optimization?.weatherEntity;
  if (typeof entity === 'string' && entity.startsWith('weather.')) {
    try {
      const state = await getHaState(entity, requestOptions());
      const attrs = state?.attributes ?? {};
      const at = Date.parse(state?.last_reported ?? state?.last_updated ?? '');
      let temp = attrs.temperature;
      if (attrs.temperature_unit === '°F') temp = (temp - 32) * 5 / 9;
      if (['°C', '°F'].includes(attrs.temperature_unit) && !['unknown', 'unavailable'].includes(state?.state) && Number.isFinite(temp) && Date.now() - at <= 90 * 60_000 && at <= Date.now() + 30_000) {
        return { temp, humidity: attrs.humidity ?? null, source: `ha:${entity}`, observedAt: new Date(at).toISOString() };
      }
    } catch { /* advisory weather can fall back to the existing regional API */ }
  }
  const location = config.optimization?.location;
  if (!config.district && !location) return null;
  const cacheKey = JSON.stringify([config.district, location ?? null]);
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 15 * 60_000) return cached.data;
  const result = await fetchWeather(config.district, process.env.PROPOS_KMA_API_KEY ?? null, { ...requestOptions(), location });
  if (!result.data) return null;
  const data = { ...result.data, retrievedAt: new Date().toISOString() };
  const at = Date.parse(data.observedAt ?? '');
  if (!Number.isFinite(at) || Date.now() - at > 90 * 60_000 || at > Date.now() + 30_000) return null;
  weatherCache.set(cacheKey, { data, at: Date.now() });
  return data;
}

/** A persistent HA notice is useful history, but is not mobile delivery proof. */
export async function alertPreparationFailure({ runId, propertyId, reason, stopUnconfirmed, operatorNotifyService }) {
  const message = `입실 준비 자동제어를 안전 중단했습니다. ${stopUnconfirmed ? '장치 꺼짐을 확인하지 못했으니 즉시 확인해 주세요.' : '센서와 장치 상태를 확인해 주세요.'} 원인: ${reason}`;
  const persistent = callHaService('persistent_notification', 'create', {
    title: `PROPOS ${propertyId ?? ''} 입실 준비 안전 중단`, message, notification_id: `propos_preparation_${runId}`,
  }, requestOptions());
  const mobile = /^notify\.[a-z0-9_]+$/.test(operatorNotifyService ?? '')
    ? callHaService('notify', operatorNotifyService.slice('notify.'.length), { title: `PROPOS ${propertyId ?? ''} 입실 준비 안전 중단`, message }, requestOptions())
    : Promise.reject(new Error('Operator mobile notification service is not configured'));
  const results = await Promise.allSettled([persistent, mobile, notifyPreparationSafety({ propertyId, message })]);
  const slackSent = results[2].status === 'fulfilled' && results[2].value.sent;
  if (results[1].status === 'rejected' && !slackSent) throw new Error('Operator notification delivery was not acknowledged');
}
