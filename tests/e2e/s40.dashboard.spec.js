/**
 * s40 — DashboardView E2E 테스트
 *
 * E2E-001: 페이지 로드 → 대시보드 렌더 확인
 * E2E-002: 상태 카드 클릭 → 리스트 뷰 전환 확인
 * E2E-003: (HA 필요) 도어 토글 → 폴링 후 watcher 배지 갱신 확인
 *
 * 실행: npm run test:e2e
 * 전제: npm run dev 가 port 5173에서 실행 중이어야 함 (playwright가 자동 기동)
 */

import { test, expect } from '@playwright/test';
import CFG from '../../src/config/privateConfig.js';

const HA_BASE_URL  = process.env.PROPOS_HA_BASE_URL || CFG?.ha?.baseUrl || '';
const HA_TOKEN     = process.env.PROPOS_HA_TOKEN    || CFG?.ha?.token   || '';
const HA_AVAILABLE = !!(HA_BASE_URL && HA_TOKEN);

// ────────────────────────────────────────────────────────────────────────────
// E2E-001  페이지 로드 → DashboardView 렌더
// ────────────────────────────────────────────────────────────────────────────
test('E2E-001 대시보드 페이지 로드', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto('/');

  // 헤더 타이틀
  await expect(page.getByText('현황 대시보드')).toBeVisible();

  // 요약 배너 — data-testid
  await expect(page.locator('[data-testid="dashboard-summary"]')).toBeVisible();

  // 상태 카드 4개 존재
  await expect(page.locator('[data-testid="status-cards"]')).toBeVisible();
  for (const status of ['OCCUPIED', 'PRE_STAY_READY', 'CLEANING', 'VACANT']) {
    await expect(page.locator(`[data-testid="status-card-${status}"]`)).toBeVisible();
  }

  // 카운트 배지 — 숫자여야 함
  const occupiedText = await page.locator('[data-testid="count-occupied"]').textContent();
  assert.ok(/^\d+$/.test(occupiedText?.trim() ?? ''), `체류중 카운트가 숫자여야 함 (받음: ${occupiedText})`);

  expect(pageErrors).toEqual([]);
});

// ────────────────────────────────────────────────────────────────────────────
// E2E-002  상태 카드 클릭 → 리스트 뷰 전환
// ────────────────────────────────────────────────────────────────────────────
test('E2E-002 OCCUPIED 카드 클릭 → 리스트 뷰 전환', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="status-card-OCCUPIED"]')).toBeVisible();

  await page.locator('[data-testid="status-card-OCCUPIED"]').click();

  // 리스트 뷰에는 "← 대시보드" 또는 "뒤로" 버튼이 생긴다
  await expect(
    page.getByRole('button', { name: /← (대시보드|뒤로)/ }).first()
  ).toBeVisible({ timeout: 3000 });
});

// ────────────────────────────────────────────────────────────────────────────
// E2E-003  (HA 필요) 도어 토글 → 워처 상태 API 갱신 확인
// ────────────────────────────────────────────────────────────────────────────
test('E2E-003 HA 도어 토글 → /api/monitoring/state lastEventAt 갱신', async ({ page }) => {
  test.skip(!HA_AVAILABLE, 'PROPOS_HA_BASE_URL / PROPOS_HA_TOKEN 미설정');

  await page.goto('/');
  await expect(page.locator('[data-testid="dashboard-summary"]')).toBeVisible();

  // 원래 config 저장 후 test room으로 교체
  const origState = await (await page.request.get('/api/monitoring/state')).json();
  const origConfig = origState.config;
  await page.request.post('/api/monitoring/config', {
    data: { areaName: 'test room' },
  });
  // 엔티티 맵 재구성 대기
  await page.waitForTimeout(2000);

  // HA REST 헬퍼
  const toggle = async (value) => {
    const service = value ? 'turn_on' : 'turn_off';
    const res = await fetch(`${HA_BASE_URL}/api/services/input_boolean/${service}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: 'input_boolean.propos_test_door' }),
    });
    return res.ok;
  };

  // false로 리셋 → debounce 완료 대기 → beforeAt 기록 → true로 토글 (state_changed 보장)
  await toggle(false);
  await page.waitForTimeout(800);

  const beforeState = await (await page.request.get('/api/monitoring/state')).json();
  const beforeAt = beforeState.lastEventAt ?? 0;

  const toggled = await toggle(true);
  assert.ok(toggled, 'HA REST 도어 토글 성공');

  // debounce(500ms) + 처리 여유 → 최대 5초 내에 lastEventAt 갱신 확인
  let afterState;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(300);
    const res = await page.request.get('/api/monitoring/state');
    afterState = await res.json();
    if (afterState.lastEventAt > beforeAt) break;
  }

  assert.ok(afterState.lastEventAt > beforeAt, `워처 lastEventAt 갱신됨 (before: ${beforeAt}, after: ${afterState.lastEventAt})`);
  assert.ok(afterState.wsConnected, 'HA WebSocket 연결 유지 중');

  await toggle(false).catch(() => {});

  // 원래 config 복원
  if (origConfig?.areaName) {
    await page.request.post('/api/monitoring/config', { data: origConfig }).catch(() => {});
  }
});

// node:test 에서 assert를 import해야 한다면 Playwright test에서는 직접 사용 불가.
// 여기서는 간단히 JS assertion으로 대체.
const assert = {
  ok: (val, msg) => { if (!val) throw new Error(msg ?? 'Assertion failed'); },
};
