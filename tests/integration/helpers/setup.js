/**
 * HA 통합시험 연결 설정. RUN_LIVE_HA=1로 실제 연결 시험을 선택한다.
 *
 * 우선순위:
 *   1. 환경변수 PROPOS_HA_BASE_URL + PROPOS_HA_TOKEN (CI / Vercel)
 *   2. src/config/propos.config.json
 */

const runLive = process.env.RUN_LIVE_HA === '1';
const config = runLive ? (await import('../../../src/config/privateConfig.js')).default : null;

export const HA_BASE_URL = runLive ? process.env.PROPOS_HA_BASE_URL || config?.ha?.baseUrl || '' : 'http://ha.fixture.invalid';
export const HA_TOKEN = runLive ? process.env.PROPOS_HA_TOKEN || config?.ha?.token || '' : 'fixture-token';
export const HA_AVAILABLE = runLive && !!(HA_BASE_URL && HA_TOKEN);

process.env.PROPOS_HA_BASE_URL = HA_BASE_URL;
process.env.PROPOS_HA_WS_URL = runLive
  ? process.env.PROPOS_HA_WS_URL || config?.ha?.wsUrl || HA_BASE_URL.replace(/^http/, 'ws') + '/api/websocket'
  : 'ws://ha.fixture.invalid/api/websocket';
process.env.PROPOS_HA_TOKEN = HA_TOKEN;
process.env.PROPOS_PI_SECRET = '';
delete process.env.PROPOS_SLACK_WEBHOOK;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (!HA_AVAILABLE || new URL(url).origin !== new URL(HA_BASE_URL).origin) {
    throw new Error('External request blocked by HA integration test isolation');
  }
  return originalFetch(url, options);
};

export const wait = ms => new Promise(r => setTimeout(r, ms));
