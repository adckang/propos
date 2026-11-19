/**
 * playwright.e2e.config.mjs — E2E 테스트 설정
 *
 * npm run dev (port 5173) 대상. 워처 + Vite HMR 포함된 개발 서버를 사용한다.
 * 실행:  npm run test:e2e
 *
 * HA 연결이 필요한 E2E-003은 RUN_LIVE_HA=1, PROPOS_DATA_PROFILE=real,
 * PROPOS_HA_BASE_URL + PROPOS_HA_TOKEN을 모두 명시해야 실행된다
 * (실제 Pi 워처 설정과 집 HA 시험 스위치를 잠깐 바꾸고 되돌린다).
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:        './tests/e2e',
  // 같은 폴더의 s37.live-connectivity.test.js는 node:test 기반 외부 연결 시험이다.
  // import 방식이 다른 파일을 Playwright가 수집하지 않도록 spec 파일만 받는다.
  testMatch:      '**/*.spec.js',
  timeout:        20000,
  retries:        0,
  workers:        1,           // 워처 모듈 싱글턴 — 병렬 실행 금지
  use: {
    baseURL:      'http://127.0.0.1:5173',
    headless:     true,
    screenshot:   'only-on-failure',
    video:        'off',
  },
  webServer: {
    command:              'npm run dev -- --host 127.0.0.1 --port 5173',
    url:                  'http://127.0.0.1:5173',
    reuseExistingServer:  true,
    timeout:              30000,
  },
});
