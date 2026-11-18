/**
 * s60 — 목록 화면(ListView) 배치: [상태 필터] → [네비게이터] → [레포트] → [타임라인의 레포트 기간 박스] (D-024, 2026-09-24)
 *
 * 사용자 제안: 네비게이터를 레포트 위로 올리면 레포트 패널 바로 아래에 타임라인의 하이라이트 박스가 이어져 "이 조작 → 이
 * 레포트 → 저 구간"이 위에서 아래로 한 흐름으로 읽힌다(그 전엔 네비게이터가 레포트와 타임라인 사이에 끼어 있었다).
 *
 * ACT-08 ⑦-6: 예전엔 PropertyListView.jsx 소스에서 글자 위치만 비교했다. 이제 실제 목록 화면을 서버 렌더링으로 그려
 * 실제 HTML에서 순서를 본다(네비게이터·레포트만 표식 부품으로 바꿈). 네비게이터 위치에 따라 레포트 기간이 바뀌는
 * 연결은 s92가 실제 화면으로 확인한다(이번주·내일·3일 전).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { PROPERTIES } from '../../src/data/roomStateMockData.js';
import { renderComponent } from '../helpers/renderComponent.js';

const SAMPLE = PROPERTIES.slice(0, 3).map(p => ({ ...p, snapshotLog: [], haDevices: [] }));

async function renderList({ viewportWidth = 1280, ...props } = {}) {
  const nav = [], report = [];
  const marker = (name, calls) => ({ default: received => { calls.push(received); return createElement('div', { 'data-probe': name }); } });
  const { html } = await renderComponent('src/components/v2/PropertyListView.jsx', { properties: SAMPLE, onSelectProperty() {}, ...props }, {
    replace: {
      'src/components/v2/reporting/ListViewFilter.jsx': marker('navigator', nav),
      'src/components/v2/reporting/PeriodReport.jsx': marker('report', report),
    },
    viewportWidth,
  });
  return { html, nav, report };
}
function positions(html) {
  return {
    filterBar: html.indexOf('>전체 '),
    navigator: html.indexOf('data-probe="navigator"'),
    report: html.indexOf('data-probe="report"'),
    highlight: html.search(/border:2px solid #[0-9a-f]{6};[^"]*z-index:25/),
  };
}

describe('actual PropertyListView — the navigator sits between the status filter and the report, the report right above the timeline box', () => {
  for (const [label, viewportWidth] of [['desktop', 1280], ['mobile', 375]]) {
    test(`${label}: status filter → navigator → report → report-period box, each once`, async () => {
      const { html } = await renderList({ viewportWidth });
      const p = positions(html);
      for (const [k, v] of Object.entries(p)) assert.ok(v >= 0, `${k} not rendered`);
      assert.ok(p.filterBar < p.navigator && p.navigator < p.report && p.report < p.highlight, JSON.stringify(p));
      assert.equal(html.split('data-probe="navigator"').length - 1, 1, 'one navigator only — none left between the report and the timeline');
      // 레포트와 타임라인 박스 사이에는 다른 화면 블록이 없다(바로 이어지는 타임라인 래퍼의 첫 표시들만)
      const between = html.slice(p.report, p.highlight);
      assert.ok(!between.includes('<button'), 'no controls between the report and the timeline box');
    });
  }

  test('the navigator still controls the timeline: it gets the position, mode, screen size and both setters', async () => {
    for (const [props, offset, mode, isMobile] of [[{}, 0, 'week', false], [{ initialDayOffset: 2, viewportWidth: 375 }, 2, 'day', true]]) {
      const { nav, report } = await renderList(props);
      assert.equal(nav.length, 1);
      const n = nav[0];
      assert.deepEqual([n.windowOffset, n.mode, n.isMobile], [offset, mode, isMobile]);
      assert.equal(typeof n.onOffsetChange, 'function'); assert.equal(typeof n.onModeChange, 'function');
      assert.equal(report[0].isMobile, isMobile);
    }
  });
});
