import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_TOKEN = 'test-token';
const { getPreparationWeather, checkOperatorChannel, alertPreparationFailure } = await import('../../server/preparationAdapters.js');
const { fetchWeather } = await import('../../server/weatherService.js');
const originalFetch = global.fetch;
const previousWebhook = process.env.PROPOS_SLACK_WEBHOOK;
delete process.env.PROPOS_SLACK_WEBHOOK;
afterEach(() => { global.fetch = originalFetch; delete process.env.PROPOS_SLACK_WEBHOOK; });
after(() => { if (previousWebhook !== undefined) process.env.PROPOS_SLACK_WEBHOOK = previousWebhook; });
const response = data => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });

test('HA weather preserves 0°C and the source observation time', async () => {
  const observedAt = new Date(Date.now() - 20 * 60_000).toISOString();
  global.fetch = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    assert.match(url, /states\/weather\.fixture$/);
    return response({ state: 'cloudy', attributes: { temperature: 0, temperature_unit: '°C', humidity: 80 }, last_reported: observedAt });
  };
  const weather = await getPreparationWeather({ optimization: { weatherEntity: 'weather.fixture' } });
  assert.equal(weather.temp, 0); assert.equal(weather.observedAt, observedAt);
});

test('operator notification service must actually exist in HA before automatic control', async () => {
  global.fetch = async () => response([{ domain: 'notify', services: { mobile_app_operator: {} } }]);
  assert.equal(await checkOperatorChannel('notify.mobile_app_operator'), true);
  assert.equal(await checkOperatorChannel('notify.nonexistent'), false);
});

test('persistent notices alone cannot be mistaken for real-time operator delivery', async () => {
  global.fetch = async url => url.includes('/notify/') ? { ok: false, status: 500, text: async () => 'fixture error' } : response({});
  await assert.rejects(alertPreparationFailure({ runId: 'fixture', reason: 'sensor_lost', stopUnconfirmed: true, operatorNotifyService: 'notify.mobile_app_operator' }));
});

test('operator delivery still proceeds if creating a persistent HA notice fails', async () => {
  const calls = [];
  global.fetch = async url => { calls.push(url); return url.includes('/persistent_notification/') ? { ok: false, status: 500, text: async () => 'fixture error' } : response({}); };
  await alertPreparationFailure({ runId: 'fixture', reason: 'sensor_lost', stopUnconfirmed: false, operatorNotifyService: 'notify.mobile_app_operator' });
  assert.ok(calls.some(url => url.endsWith('/notify/mobile_app_operator')));
});

test('exact property coordinates avoid ambiguous district-name geocoding', async () => {
  const calls = [], time = new Date().toISOString();
  global.fetch = async url => { calls.push(url); return response({ current: { temperature_2m: 12, relative_humidity_2m: 65, time } }); };
  const result = await fetchWeather('ambiguous-fixture', null, { location: { name: 'fixture', latitude: 37.7, longitude: 126.7 } });
  assert.equal(result.data.temp, 12); assert.equal(result.data.observedAt, time);
  assert.equal(calls.length, 1); assert.ok(calls[0].includes('latitude=37.7'));
  assert.ok(!calls[0].includes('geocoding'));
});

test('invalid property coordinates are rejected before any external request', async () => {
  global.fetch = async () => { throw new Error('must not request'); };
  assert.equal((await fetchWeather('fixture', null, { location: { latitude: 999, longitude: 126 } })).status, 400);
});

test('stale regional weather cannot be restamped as a fresh observation', async () => {
  global.fetch = async () => response({ current: { temperature_2m: 12, relative_humidity_2m: 65, time: new Date(Date.now() - 3 * 60 * 60_000).toISOString() } });
  const weather = await getPreparationWeather({ optimization: { location: { name: 'stale-fixture', latitude: 37.71, longitude: 126.71 } } });
  assert.equal(weather, null);
});

test('an existing independent Slack channel can notify the operator when HA is unreachable', async () => {
  process.env.PROPOS_SLACK_WEBHOOK = 'https://hooks.slack.fixture/test';
  let sent = 0;
  global.fetch = async url => {
    if (!url.startsWith('https://hooks.slack.fixture/')) throw new Error('fixture HA outage');
    sent++; return response({});
  };
  assert.equal(await checkOperatorChannel(null), true);
  await alertPreparationFailure({ runId: 'fixture', propertyId: 'fixture-property', reason: 'critical_device_read_failed', stopUnconfirmed: true });
  assert.equal(sent, 1);
});
