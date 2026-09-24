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

  // 상태 카드는 기본 접힘 → 자세히 버튼으로 펼침
  await expect(page.locator('[data-testid="status-cards"]')).not.toBeVisible();
  const statusDetailsToggle = page.locator('[data-testid="status-details-toggle"]');
  await expect(statusDetailsToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(statusDetailsToggle).toHaveAttribute('aria-label', '상태 상세 펼치기');
  await statusDetailsToggle.click();
  await expect(statusDetailsToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(statusDetailsToggle).toHaveAttribute('aria-label', '상태 상세 접기');
  await expect(page.locator('[data-testid="status-cards"]')).toBeVisible();
  for (const status of ['OCCUPIED', 'PRE_STAY_READY', 'CLEANING', 'VACANT']) {
    await expect(page.locator(`[data-testid="status-card-${status}"]`)).toBeVisible();
  }

  // 상태 필터 문구 끝의 카운트는 숫자여야 함
  const occupiedText = await page.locator('[data-testid="count-occupied"]').textContent();
  assert.ok(/\d+$/.test(occupiedText?.trim() ?? ''), `체류중 카운트가 숫자여야 함 (받음: ${occupiedText})`);

  expect(pageErrors).toEqual([]);
});

// ────────────────────────────────────────────────────────────────────────────
// E2E-002  상태 카드 클릭 → 리스트 뷰 전환
// ────────────────────────────────────────────────────────────────────────────
test('E2E-002 OCCUPIED 카드 클릭 → 리스트 뷰 전환', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid="status-details-toggle"]').click();
  await expect(page.locator('[data-testid="status-card-OCCUPIED"]')).toBeVisible();

  await page.locator('[data-testid="status-card-OCCUPIED"]').click();

  // 리스트 뷰에는 "← 대시보드" 또는 "뒤로" 버튼이 생긴다
  await expect(
    page.getByRole('button', { name: /← (대시보드|뒤로)/ }).first()
  ).toBeVisible({ timeout: 3000 });
});

test('E2E-004 월간 필터·숙소 복수선택·날짜 상세가 함께 동작한다', async ({ page }) => {
  await page.goto('/');

  const report = page.locator('[data-testid="selected-property-report"]');
  const monthFilter = page.locator('[data-testid="monthly-view-filter"]');
  const propertySelect = page.locator('[data-testid="property-multi-select-toggle"]');
  const calendar = page.locator('[data-testid="monthly-calendar"]');
  await expect(report).toBeVisible();
  await expect(monthFilter).toBeVisible();
  await expect(propertySelect).toContainText('ALL');
  await expect(calendar).toBeVisible();

  const allIssueTotal = await calendar.getByRole('button', { name: /문제 \d+건/ }).evaluateAll(
    buttons => buttons.reduce((sum, button) => sum + Number(button.textContent), 0)
  );
  const allSummary = await report.innerText();
  expect(Number(allSummary.match(/운영 문제 (\d+)건/)?.[1])).toBe(allIssueTotal);

  await report.getByText('자세히').click();
  await expect(report.getByText('이번 달 레포트')).toBeVisible();

  const tops = await Promise.all([report, monthFilter, propertySelect, calendar].map(locator =>
    locator.evaluate(element => element.getBoundingClientRect().top + window.scrollY)
  ));
  expect(tops[0] < tops[1] && tops[1] < tops[2] && tops[2] < tops[3]).toBeTruthy();

  await propertySelect.click();
  const menu = page.locator('[data-testid="property-multi-select-menu"]');
  await menu.getByRole('button', { name: 'ALL' }).click();
  await expect(propertySelect).toContainText('선택 없음');
  await menu.locator('button').nth(1).click();
  await expect(propertySelect).toContainText('1개 선택');
  await expect(report).toContainText('운영 문제 1건');
  const oneIssueTotal = await calendar.getByRole('button', { name: /문제 \d+건/ }).evaluateAll(
    buttons => buttons.reduce((sum, button) => sum + Number(button.textContent), 0)
  );
  expect(oneIssueTotal).toBe(1);
  await expect(calendar.locator('[data-testid="calendar-state-bar"]').first()).toBeVisible();

  const p001Drilldown = await (await page.request.get('/api/stats/drilldown?period=this_month&metric=cleaning_time&property_ids=P001')).json();
  const p003Drilldown = await (await page.request.get('/api/stats/drilldown?period=this_month&metric=cleaning_time&property_ids=P003')).json();
  expect(p001Drilldown.failCount).toBe(0);
  expect(p003Drilldown.failCount).toBe(1);
  expect(p003Drilldown.items.map(item => item.property_id)).toEqual(['P003']);
  await menu.getByRole('button', { name: 'ALL' }).click();
  await expect(propertySelect).toContainText('ALL');

  await page.getByRole('button', { name: '지난달' }).click();
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  await expect(calendar.getByRole('heading')).toHaveText(`${lastMonth.getFullYear()}년 ${lastMonth.getMonth() + 1}월`);

  const issueButton = calendar.getByRole('button', { name: /문제 \d+건/ }).first();
  await expect(issueButton).toBeVisible();
  await issueButton.click();
  await expect(page.getByText(/문제 \d+건/).last()).toBeVisible();
  await page.getByRole('button', { name: '✕' }).click();

  await page.getByRole('button', { name: '다음달' }).click();
  await expect(calendar.locator('[data-testid="future-occupancy-count"]').first()).toBeVisible();
  await expect(calendar.getByRole('button', { name: /문제 \d+건/ })).toHaveCount(0);
  await report.getByText('자세히').click();
  const nextReportToggle = report.getByRole('button', { name: /다음 달 레포트/ });
  if (!await report.getByText('점유 예측').isVisible()) await nextReportToggle.click();
  await expect(report.getByText('점유 예측')).toBeVisible();

  const nextReportText = (await report.innerText()).replace(/\s+/g, ' ');
  const reservationMatch = nextReportText.match(/다음 달 체크인 (\d+)건, 체크아웃 (\d+)건/);
  const movementTotals = await calendar.locator('[data-testid="future-movement-count"]').evaluateAll(nodes =>
    nodes.reduce((totals, node) => ({
      checkIns: totals.checkIns + Number(node.dataset.checkins),
      checkOuts: totals.checkOuts + Number(node.dataset.checkouts),
    }), { checkIns: 0, checkOuts: 0 })
  );
  expect(movementTotals).toEqual({
    checkIns: Number(reservationMatch?.[1]),
    checkOuts: Number(reservationMatch?.[2]),
  });

  const occupancyTotals = await calendar.locator('[data-testid="future-occupancy-count"]').evaluateAll(nodes =>
    nodes.reduce((totals, node) => ({
      occupied: totals.occupied + Number(node.dataset.occupied),
      vacant: totals.vacant + Number(node.dataset.vacant),
    }), { occupied: 0, vacant: 0 })
  );
  expect(occupancyTotals.occupied).toBe(Number(nextReportText.match(/체류 예정\s*\d+숙소 · (\d+)박/)?.[1]));
  expect(occupancyTotals.vacant).toBe(Number(nextReportText.match(/공실 예정\s*\d+숙소 · (\d+)박/)?.[1]));

  const cleaningTotal = await calendar.locator('[data-testid="future-cleaning-count"]').evaluateAll(nodes =>
    nodes.reduce((sum, node) => sum + Number(node.dataset.count), 0)
  );
  const reportCleaningCounts = await Promise.all(
    ['배정완료', '배정 요청 필요', '배정 요청중', '배정 실패'].map(async label => {
      const row = report.getByText(label, { exact: true }).locator('..');
      await expect(row).toContainText(/\d+건/);
      const valueText = await row.locator('span').nth(1).innerText();
      return Number(valueText.match(/(\d+)건/)?.[1]);
    })
  );
  const reportCleaningTotal = reportCleaningCounts.reduce((sum, count) => sum + count, 0);
  expect(cleaningTotal).toBe(reportCleaningTotal);

  const cleaningButton = calendar.getByRole('button', { name: /청소 \d+건/ }).first();
  await cleaningButton.click();
  await expect(page.getByText(/청소 예정 \d+건/).last()).toBeVisible();
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
