/**
 * s66 — 모바일에서 운영 지표 표가 세로쓰기처럼 깨지던 문제 (D-030, 2026-09-28 사용자 지적)
 *
 * 원인 셋: ① 표의 한 줄(SharedMetricRow)이 모바일에서도 데스크톱의 고정 칸 폭(건수·성공률·배지·화살표)을 써서 라벨에 남는
 * 폭이 거의 없었다 ② 운영 지표 표(EventMatrixPanel)가 isMobile을 받고도 줄에 넘기지 않아 늘 데스크톱 칸이었다(진짜 버그)
 * ③ 진행 중 기간 레포트(ActiveHybridPanel)의 바깥 박스·표 박스 좌우 여백이 겹겹이 쌓였다.
 *
 * ACT-08 ⑦-6: 예전엔 세 파일의 스타일 글자만 검사했다. 이제 실제 부품을 모바일/데스크톱으로 서버 렌더링해 실제 HTML의
 * 칸 폭·여백을 비교한다.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PROBE, renderComponent } from '../helpers/renderComponent.js';

// 사용자가 처음 제시한 예시 숫자(s62와 같음) — 7개 지표 모두 측정 가능
const STATS = {
  preStayOptimized: 11, preStayAttempts: 12,
  checkOuts: 12, postCheckoutEnergyWaste: 2, postCheckoutSecurityBreach: 1,
  cleaningFinished: 12, vacantEnergyWaste: 3, postCleaningSecurityBreach: 1,
  cleaningOnTime: 10, cleaningAssigned: 12, cleaningCreated: 12,
};
const grids = html => [...html.matchAll(/grid-template-columns:([^;"]+)/g)].map(m => m[1].trim());
const gaps = html => [...html.matchAll(/column-gap:(\d+)px/g)].map(m => Number(m[1]));
const fixedWidth = template => (template.match(/(\d+)px/g) ?? []).reduce((sum, px) => sum + parseInt(px, 10), 0);
const firstPadding = html => html.match(/padding:([^;"]+)/)[1].trim();
const horizontal = padding => { const parts = padding.split(/\s+/).map(v => parseInt(v, 10)); return (parts[1] ?? parts[0]) + (parts[3] ?? parts[1] ?? parts[0]); };

const ROW = { label: '청소 담당자 배정', numerator: 11, denominator: 12 };

describe('actual SharedMetricRow — on mobile the label gets more room', () => {
  test('the mobile row keeps the label column flexible and gives the fixed columns less width and a smaller gap', async () => {
    const desktop = (await renderComponent('src/components/v2/reporting/SharedMetricRow.jsx', ROW)).html;
    const mobile = (await renderComponent('src/components/v2/reporting/SharedMetricRow.jsx', { ...ROW, isMobile: true })).html;
    const [d] = grids(desktop), [m] = grids(mobile);
    assert.ok(d.startsWith('1fr ') && m.startsWith('1fr '), 'the label column is the flexible one');
    assert.equal(m.split(/\s+/).length, d.split(/\s+/).length, 'same columns, so rows and header stay aligned');
    assert.ok(fixedWidth(m) < fixedWidth(d), `mobile fixed columns ${fixedWidth(m)}px < desktop ${fixedWidth(d)}px`);
    assert.ok(gaps(mobile)[0] < gaps(desktop)[0]);
  });
});

describe('actual EventMatrixPanel — passes the mobile layout to every row (the D-030 bug)', () => {
  async function panel(isMobile) {
    return (await renderComponent('src/components/v2/reporting/EventMatrixPanel.jsx', { stats: STATS, period: 'last_week', isMobile })).html;
  }

  test('on mobile the header and all 7 metric rows use the mobile columns; on desktop all use the desktop columns', async () => {
    const mobileRow = grids((await renderComponent('src/components/v2/reporting/SharedMetricRow.jsx', { ...ROW, isMobile: true })).html)[0];
    const desktopRow = grids((await renderComponent('src/components/v2/reporting/SharedMetricRow.jsx', ROW)).html)[0];
    for (const [isMobile, expected] of [[true, mobileRow], [false, desktopRow]]) {
      const used = grids(await panel(isMobile));
      assert.equal(used.length, 8, 'header + 7 metric rows');
      assert.deepEqual([...new Set(used)], [expected], `${isMobile ? 'mobile' : 'desktop'} columns everywhere`);
    }
  });

  test('on mobile the panel and the table box have smaller side padding', async () => {
    const pads = html => [...html.matchAll(/padding:([^;"]+)/g)].map(m => m[1].trim());
    const [mobileOuter] = pads(await panel(true)), [desktopOuter] = pads(await panel(false));
    assert.ok(horizontal(mobileOuter) < horizontal(desktopOuter), `${mobileOuter} vs ${desktopOuter}`);
    const box = html => pads(html).find(p => /^0 \d+px$/.test(p)); // 표를 감싸는 박스(위아래 0)
    assert.ok(horizontal(box(await panel(true))) < horizontal(box(await panel(false))));
  });
});

describe('actual ActiveHybridPanel — on mobile the outer box adds no side padding of its own', () => {
  test('mobile: no left/right padding on the outer box, and the completed-section table gets the mobile layout', async () => {
    const render = async isMobile => (await renderComponent('src/components/v2/reporting/ActiveHybridPanel.jsx',
      { stats: STATS, period: 'this_week', isMobile }, { replace: { 'src/components/v2/reporting/FutureMatrixPanel.jsx': PROBE } })).html;
    const mobile = await render(true), desktop = await render(false);
    assert.equal(horizontal(firstPadding(mobile)), 0, firstPadding(mobile));
    assert.ok(horizontal(firstPadding(desktop)) > 0);
    const mobileRow = grids((await renderComponent('src/components/v2/reporting/SharedMetricRow.jsx', { ...ROW, isMobile: true })).html)[0];
    assert.ok(grids(mobile).length > 0 && grids(mobile).every(g => g === mobileRow));
  });
});
