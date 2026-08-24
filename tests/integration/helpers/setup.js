/**
 * IT 공통 설정 — HA 연결 정보 확인
 *
 * 우선순위:
 *   1. 환경변수 PROPOS_HA_BASE_URL + PROPOS_HA_TOKEN (CI / Vercel)
 *   2. src/config/propos.config.json (로컬 개발)
 */

import CFG from '../../../src/config/privateConfig.js';

export const HA_BASE_URL = process.env.PROPOS_HA_BASE_URL || CFG?.ha?.baseUrl || '';
export const HA_TOKEN    = process.env.PROPOS_HA_TOKEN    || CFG?.ha?.token   || '';
export const HA_AVAILABLE = !!(HA_BASE_URL && HA_TOKEN);

export const wait = ms => new Promise(r => setTimeout(r, ms));
