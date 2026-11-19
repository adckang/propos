/**
 * playwright.e2e.config.mjs — E2E 테스트 설정
 *
 * 전용 개발 서버(port 5174)를 띄워 시험한다. 실행:  npm run test:e2e
 *
 * 화면 시험(E2E-001·002·004)은 데모 데이터(PROPOS_DATA_PROFILE=demo)로만 돈다.
 * 개발 서버의 기본 프로필(hybrid)은 /api 를 운영(www.proposonline.com)으로 넘기므로, 그대로 쓰면
 * 대시보드가 열릴 때마다 운영 iCal 동기화(POST /api/cleaning/ical-sync) 같은 요청이 나간다.
 *
 * HA 연결이 필요한 E2E-003은 RUN_LIVE_HA=1, PROPOS_DATA_PROFILE=real,
 * PROPOS_HA_BASE_URL + PROPOS_HA_TOKEN을 모두 명시해야 실행된다
 * (실제 Pi 워처 설정과 집 HA 시험 스위치를 잠깐 바꾸고 되돌린다). 이때만 서버가 운영에 연결되고
 * 화면 시험은 건너뛴다.
 */

import { defineConfig } from '@playwright/test';

const LIVE_HA_RUN = process.env.RUN_LIVE_HA === '1' && process.env.PROPOS_DATA_PROFILE === 'real';
// 평소 띄워 두는 개발 서버(5173, 운영 연결)를 재사용하지 않도록 전용 포트를 쓰고 재사용하지 않는다 —
// 포트가 이미 쓰이고 있으면 시험이 시작되지 않는다(엉뚱한 서버로 시험하는 것보다 안전).
const PORT = 5174;

export default defineConfig({
  testDir:        './tests/e2e',
  // 같은 폴더의 s37.live-connectivity.test.js는 node:test 기반 외부 연결 시험이다.
  // import 방식이 다른 파일을 Playwright가 수집하지 않도록 spec 파일만 받는다.
  testMatch:      '**/*.spec.js',
  timeout:        20000,
  retries:        0,
  workers:        1,           // E2E-003이 실제 워처 설정을 바꾸므로 병렬 실행 금지
  use: {
    baseURL:      `http://127.0.0.1:${PORT}`,
    headless:     true,
    screenshot:   'only-on-failure',
    video:        'off',
  },
  webServer: {
    command:              `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    url:                  `http://127.0.0.1:${PORT}`,
    env:                  { PROPOS_DATA_PROFILE: LIVE_HA_RUN ? 'real' : 'demo' },
    reuseExistingServer:  false,
    timeout:              30000,
  },
});
