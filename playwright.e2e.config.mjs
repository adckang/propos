/**
 * playwright.e2e.config.mjs — E2E 테스트 설정
 *
 * npm run dev (port 5173) 대상. 워처 + Vite HMR 포함된 개발 서버를 사용한다.
 * 실행:  npm run test:e2e
 *
 * HA 연결이 필요한 E2E-003은 PROPOS_HA_BASE_URL + PROPOS_HA_TOKEN 환경변수가
 * 없으면 자동 스킵된다.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:        './tests/e2e',
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
