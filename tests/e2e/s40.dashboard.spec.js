/**
 * s40 — DashboardView E2E 테스트
 *
 * E2E-001: 페이지 로드 → 대시보드 렌더 확인
 * E2E-002: 상태 카드 클릭 → 리스트 뷰 전환 확인
 * E2E-003: (HA 필요) 도어 토글 → 폴링 후 watcher 배지 갱신 확인
 *
 * 실행: npm run test:e2e
 * 서버: playwright.e2e.config.mjs 가 데모 프로필 전용 개발 서버(5174)를 자동 기동한다.
 *       E2E-003 을 고른 실행(RUN_LIVE_HA=1 + PROPOS_DATA_PROFILE=real)만 운영 연결 서버를 쓴다.
 */

import { test, expect } from '@playwright/test';
import { isProductionHost } from '../helpers/productionHosts.js';

const RUN_LIVE_HA  = process.env.RUN_LIVE_HA === '1';
const HA_BASE_URL  = process.env.PROPOS_HA_BASE_URL || '';
const HA_TOKEN     = process.env.PROPOS_HA_TOKEN || '';
const HA_AVAILABLE = RUN_LIVE_HA && !!(HA_BASE_URL && HA_TOKEN);
const REAL_DATA_PROFILE = process.env.PROPOS_DATA_PROFILE === 'real';
// playwright.e2e.config.mjs 와 같은 규칙 — 이 조합일 때만 개발 서버가 운영 API에 연결된다.
const LIVE_HA_RUN = RUN_LIVE_HA && REAL_DATA_PROFILE;

// 화면 시험(E2E-001·002·004)은 데모 서버에서만 돈다. 서버가 혹시 운영에 연결돼 있어도 쓰기·외부 전송이
// 나가지 않도록 브라우저 쪽에서도 막는다 — 운영 쪽 주소는 전부, 그 밖의 곳은 조회(GET)만 통과
// (개발 모드의 디버그 도구 eruda 를 CDN 에서 받는다). 실제 HA 시험(E2E-003)은 제외.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.startsWith('E2E-003')) return;
  test.skip(LIVE_HA_RUN, '실제 HA 시험 실행(운영 연결 서버)에서는 데모 화면 시험을 건너뜀');
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    const isLocal = LOCAL_HOSTS.includes(url.hostname);
    if (isProductionHost(url.hostname) || (!isLocal && request.method() !== 'GET')) {
      return route.fulfill({ status: 204, body: '' });
    }
    if (isLocal && url.pathname.startsWith('/api/') && request.method() !== 'GET') {
      return route.fulfill({ status: 403, json: { error: 'UI test is read-only' } });
    }
    return route.continue();
  });
});

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

  // D-026: 요약 문장이 캘린더의 "문제 N건" 배지 합계가 아니라 7개 운영 지표(달성률) 기준으로
  // 바뀌어서, 더 이상 이 둘이 같은 숫자를 말할 이유가 없다 — 그 cross-check는 제거.
  await report.getByText('자세히').click();
  await expect(report.getByText('이번 달 레포트')).toBeVisible();

  const tops = await Promise.all([monthFilter, report, propertySelect, calendar].map(locator =>
    locator.evaluate(element => element.getBoundingClientRect().top + window.scrollY)
  ));
  expect(tops[0] < tops[1] && tops[1] < tops[2] && tops[2] < tops[3]).toBeTruthy();

  await propertySelect.click();
  const menu = page.locator('[data-testid="property-multi-select-menu"]');
  await menu.getByRole('button', { name: 'ALL' }).click();
  await expect(propertySelect).toContainText('선택 없음');
  await menu.locator('button').nth(1).click();
  await expect(propertySelect).toContainText('1개 선택');
  const p001Calendar = await (await page.request.get('/api/stats/calendar?period=this_month&property_ids=P001')).json();
  const p001IssueTotal = Object.values(p001Calendar.days ?? {}).reduce((sum, day) => sum + Number(day.total ?? 0), 0);
  await expect.poll(() => calendar.getByRole('button', { name: /문제 \d+건/ }).evaluateAll(
    buttons => buttons.reduce((sum, button) => sum + Number(button.textContent), 0)
  )).toBe(p001IssueTotal);
  await expect(calendar.locator('[data-testid="calendar-state-bar"]').first()).toBeVisible();

  const p001Drilldown = await (await page.request.get('/api/stats/drilldown?period=this_month&metric=cleaning_time&property_ids=P001')).json();
  const p003Drilldown = await (await page.request.get('/api/stats/drilldown?period=this_month&metric=cleaning_time&property_ids=P003')).json();
  expect(p001Drilldown.failCount).toBe(0);
  expect(p003Drilldown.failCount).toBe(p003Drilldown.items.length);
  expect(p003Drilldown.items.every(item => item.property_id === 'P003')).toBeTruthy();
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
  const reservationMatch = nextReportText.match(/다음 달 .+?\(체크인 (\d+)건 · 체크아웃 (\d+)건\)/);
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
  const vacancyMatch = nextReportText.match(/공실률\s*(\d+)%/);
  expect(vacancyMatch).not.toBeNull();
  expect(Math.round(occupancyTotals.vacant / (occupancyTotals.occupied + occupancyTotals.vacant) * 100))
    .toBe(Number(vacancyMatch[1]));

  const cleaningTotal = await calendar.locator('[data-testid="future-cleaning-assigned"]').evaluateAll(nodes =>
    nodes.reduce((sum, node) => sum + Number(node.dataset.value), 0)
  ) + await calendar.locator('[data-testid="future-cleaning-unassigned"]').evaluateAll(nodes =>
    nodes.reduce((sum, node) => sum + Number(node.textContent.match(/(\d+)$/)?.[1] ?? 0), 0)
  );
  const reportCleaningCounts = await Promise.all(
    ['배정완료', '미배정'].map(async label => {
      const row = report.getByText(label, { exact: true }).locator('..');
      await expect(row).toContainText(/\d+건/);
      const valueText = await row.locator('span').nth(1).innerText();
      return Number(valueText.match(/(\d+)건/)?.[1]);
    })
  );
  const reportCleaningTotal = reportCleaningCounts.reduce((sum, count) => sum + count, 0);
  expect(cleaningTotal).toBe(reportCleaningTotal);

  const cleaningButton = calendar.getByRole('button', { name: /청소 (배정 완료|미배정) \d+/ }).first();
  await cleaningButton.click();
  await expect(page.getByRole('button', { name: '✕' })).toBeVisible();
});

// ────────────────────────────────────────────────────────────────────────────
// E2E-003  (HA 필요) 도어 토글 → 워처 상태 API 갱신 확인
// ────────────────────────────────────────────────────────────────────────────
test('E2E-003 HA 도어 토글 → /api/monitoring/state lastEventAt 갱신', async ({ page }) => {
  test.skip(!HA_AVAILABLE || !REAL_DATA_PROFILE, 'RUN_LIVE_HA=1, real 프로필, HA 환경변수 필요');

  await page.goto('/');
  await expect(page.locator('[data-testid="dashboard-summary"]')).toBeVisible();

  // ⚠️ real 프로필의 개발 서버는 /api/monitoring/* 를 운영 API로 넘긴다 — 이 시험은 집의 실제 Pi 워처 감시 영역을
  // 몇 초간 'test room'으로 바꾸고 실제 HA의 input_boolean.propos_test_door 를 켜고 끈다.
  // 원래 config와 스위치 상태를 저장한 뒤 시험한다. 중간 실패가 나도 finally에서 둘 다 복원한다.
  const origState = await (await page.request.get('/api/monitoring/state')).json();
  const origConfig = origState.config;

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
  const getDoorState = async () => {
    const res = await fetch(`${HA_BASE_URL}/api/states/input_boolean.propos_test_door`, {
      headers: { Authorization: `Bearer ${HA_TOKEN}` },
    });
    assert.ok(res.ok, `시험 전 도어 상태 조회 성공 (HTTP ${res.status})`);
    return (await res.json()).state;
  };

  const originalDoorState = await getDoorState();
  assert.ok(['on', 'off'].includes(originalDoorState), `시험 전 도어 상태 확인 (${originalDoorState})`);

  // 복원은 둘 다 시도한 뒤에 확인한다 — finally 안에서 바로 던지면 하나가 실패할 때 나머지를 건너뛰고
  // 시험 본문의 원래 실패 원인도 가려진다.
  const restoreFailures = [];
  try {
    await page.request.post('/api/monitoring/config', { data: { areaName: 'test room' } });
    await page.waitForTimeout(2000); // 엔티티 맵 재구성 대기

    // false로 리셋 → debounce 완료 대기 → beforeAt 기록 → true로 토글 (state_changed 보장)
    assert.ok(await toggle(false), 'HA REST 도어 초기화 성공');
    await page.waitForTimeout(800);

    const beforeState = await (await page.request.get('/api/monitoring/state')).json();
    const beforeAt = beforeState.lastEventAt ?? 0;

    assert.ok(await toggle(true), 'HA REST 도어 토글 성공');

    // debounce(500ms) + 처리 여유 → 최대 5초 내에 lastEventAt 갱신 확인
    let afterState;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(300);
      const res = await page.request.get('/api/monitoring/state');
      afterState = await res.json();
      if (afterState.lastEventAt > beforeAt) break;
    }

    assert.ok(afterState?.lastEventAt > beforeAt, `워처 lastEventAt 갱신됨 (before: ${beforeAt}, after: ${afterState?.lastEventAt})`);
    assert.ok(afterState.wsConnected, 'HA WebSocket 연결 유지 중');
  } finally {
    const doorRestored = await toggle(originalDoorState === 'on').catch(() => false);
    if (!doorRestored) restoreFailures.push(`도어 상태(${originalDoorState})`);
    if (origConfig) {
      const restored = await page.request.post('/api/monitoring/config', { data: origConfig }).catch(() => null);
      if (!restored?.ok()) restoreFailures.push(`워처 설정(HTTP ${restored?.status() ?? '요청 실패'})`);
    }
    if (restoreFailures.length) console.error(`[E2E-003] 시험 뒤 복원 실패 — 직접 확인 필요: ${restoreFailures.join(', ')}`);
  }
  // 시험 본문이 통과했을 때만 여기 온다 — 복원 실패도 실패로 보고한다.
  assert.ok(restoreFailures.length === 0, `시험 뒤 원래 상태 복원 실패: ${restoreFailures.join(', ')}`);
});

// node:test 에서 assert를 import해야 한다면 Playwright test에서는 직접 사용 불가.
// 여기서는 간단히 JS assertion으로 대체.
const assert = {
  ok: (val, msg) => { if (!val) throw new Error(msg ?? 'Assertion failed'); },
};
