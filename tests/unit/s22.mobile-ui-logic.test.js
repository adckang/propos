/**
 * s22 — 모바일 화면의 실제 구현 회귀 테스트
 *
 * 예전 테스트는 컴포넌트 안 계산을 테스트 파일에 다시 써서 검증했다. 그중 miniDays,
 * miniNowLeft, todaySegs는 운영 화면에서 이미 사라졌는데도 테스트 사본만 남아 있었다.
 * 여기서는 현행 화면과 훅을 직접 실행해 센서 경고, 현황 집계, 체류 이슈 우선순위,
 * 모바일 경계만 고정한다.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PROPERTIES } from '../../src/data/roomStateMockData.js';
import { PROBE, renderComponent, renderHook, visibleText } from '../helpers/renderComponent.js';

const quietReport = {
  'src/hooks/useReportingStats.js': {
    useReportingStats: () => ({ stats: null, summary: '', insights: [], loading: false }),
  },
  'src/hooks/useMonthlyCalendar.js': {
    useMonthlyCalendar: () => ({ data: null, loading: false, error: null }),
  },
};

const detailReplace = {
  ...quietReport,
  'src/components/v2/reporting/DetailViewFilter.jsx': PROBE,
  'src/components/v2/reporting/PeriodReport.jsx': PROBE,
  'src/components/v2/reporting/DailyActivityReportPanel.jsx': PROBE,
};

function propertyWithSensors(sensorReadings) {
  return {
    ...PROPERTIES[0],
    sensorReadings,
    sensors: undefined,
    haDevices: [],
    snapshotLog: [],
  };
}

async function renderDetail(sensorReadings) {
  return renderComponent('src/components/v2/PropertyDetailView.jsx', {
    property: propertyWithSensors(sensorReadings),
    onBack() {},
  }, { replace: detailReplace, viewportWidth: 375 });
}

function statusProperty(index, mainStatus, subStatus) {
  return {
    ...PROPERTIES[index % PROPERTIES.length],
    id: `S22-${index}`,
    name: `숙소-${index}`,
    isLive: true,
    currentState: { mainStatus, subStatus },
    reservations: [],
  };
}

describe('PropertyDetailView — 실제 센서 경고 판정', () => {
  test('모든 센서가 임계값 바로 아래면 이상 없음으로 렌더링한다', async () => {
    const { html } = await renderDetail([
      { key: 'temp', val: 26.9 },
      { key: 'humidity', val: 69 },
      { key: 'noise', val: 74 },
      { key: 'power', val: 1999 },
      { key: 'co2', val: 999 },
    ]);
    assert.match(visibleText(html), /실시간 센서 이상 없음 ✓/);
  });

  test('다섯 센서가 임계값과 같으면 모두 경고로 렌더링한다', async () => {
    const { html } = await renderDetail([
      { key: 'temp', val: 27 },
      { key: 'humidity', val: 70 },
      { key: 'noise', val: 75 },
      { key: 'power', val: 2000 },
      { key: 'co2', val: 1000 },
    ]);
    const text = visibleText(html);
    assert.match(text, /실시간 센서 ⚠ 5건/);
    assert.match(text, /온도가 27\.0°C로 높아요/);
    assert.match(text, /CO₂ 농도가 1000ppm으로 높아요/);
  });

  test('여러 이상값은 실제 미리보기 개수와 메시지에 반영된다', async () => {
    const { html } = await renderDetail([
      { key: 'temp', val: 30 },
      { key: 'co2', val: 1500 },
      { key: 'noise', val: 60 },
    ]);
    const text = visibleText(html);
    assert.match(text, /실시간 센서 ⚠ 2건/);
    assert.match(text, /온도가 30\.0°C로 높아요/);
    assert.match(text, /CO₂ 농도가 1500ppm으로 높아요/);
  });

  test('energy와 알 수 없는 센서 키는 큰 값이어도 경고로 세지 않는다', async () => {
    const { html } = await renderDetail([
      { key: 'energy', val: 99999 },
      { key: 'unknown_sensor', val: 999999 },
    ]);
    assert.match(visibleText(html), /실시간 센서 이상 없음 ✓/);
  });
});

describe('MonthlyView — 실제 현황 집계', () => {
  const properties = [
    statusProperty(0, 'OCCUPIED', 'GOOD_CONDITION'),
    statusProperty(1, 'OCCUPIED', 'ISSUE_COMPLAINT'),
    statusProperty(2, 'OCCUPIED', 'ENERGY_WASTE'),
    statusProperty(3, 'PRE_STAY_READY', 'OPTIMIZED'),
    statusProperty(4, 'CLEANING', 'CLEANING_PENDING'),
    statusProperty(5, 'VACANT', 'NO_RESERVATION'),
    statusProperty(6, 'VACANT', 'CLEANING_FINISHED'),
  ];

  test('전체와 네 가지 메인 상태 개수를 요약 버튼에 표시한다', async () => {
    const { html } = await renderComponent('src/components/v2/MonthlyView.jsx', { properties }, {
      replace: quietReport,
      viewportWidth: 375,
    });
    const text = visibleText(html);
    for (const expected of ['전체 7', '청소중 1', '입실전 1', '체류중 3', '공실 2']) {
      assert.match(text, new RegExp(expected));
    }
  });

  test('같은 메인 상태의 서로 다른 서브상태도 메인 개수에 함께 집계한다', async () => {
    const occupied = properties.slice(0, 3);
    const { html } = await renderComponent('src/components/v2/MonthlyView.jsx', { properties: occupied }, {
      replace: quietReport,
    });
    assert.match(visibleText(html), /전체 3 .*체류중 3/);
  });

  test('숙소가 없으면 전체와 각 상태가 모두 0이다', async () => {
    const { html } = await renderComponent('src/components/v2/MonthlyView.jsx', { properties: [] }, {
      replace: quietReport,
    });
    const text = visibleText(html);
    for (const expected of ['전체 0', '청소중 0', '입실전 0', '체류중 0', '공실 0']) {
      assert.match(text, new RegExp(expected));
    }
  });
});

describe('PropertyListView — 실제 체류 이슈 우선순위', () => {
  const listReplace = {
    ...quietReport,
    'src/components/v2/reporting/ListViewFilter.jsx': PROBE,
    'src/components/v2/reporting/PeriodReport.jsx': PROBE,
  };

  test('복합 이슈 → 민원 → 에너지 낭비 → 정상 순으로 렌더링한다', async () => {
    const properties = [
      statusProperty(0, 'OCCUPIED', 'GOOD_CONDITION'),
      statusProperty(1, 'OCCUPIED', 'ENERGY_WASTE'),
      statusProperty(2, 'OCCUPIED', 'ISSUE_COMPLAINT'),
      statusProperty(3, 'OCCUPIED', 'ISSUE_AND_ENERGY'),
    ];
    const { html } = await renderComponent('src/components/v2/PropertyListView.jsx', {
      properties,
      onSelectProperty() {},
    }, { replace: listReplace, viewportWidth: 375 });
    const text = visibleText(html);
    const names = ['숙소-3', '숙소-2', '숙소-1', '숙소-0'];
    const positions = names.map(name => text.indexOf(name));
    assert.ok(positions.every(position => position >= 0), `숙소명이 모두 보여야 함: ${text}`);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  });

  test('알 수 없는 체류 서브상태는 정의된 네 상태 뒤에 둔다', async () => {
    const properties = [
      statusProperty(0, 'OCCUPIED', 'UNKNOWN'),
      statusProperty(1, 'OCCUPIED', 'GOOD_CONDITION'),
    ];
    const { html } = await renderComponent('src/components/v2/PropertyListView.jsx', {
      properties,
      onSelectProperty() {},
    }, { replace: listReplace });
    const text = visibleText(html);
    assert.ok(text.indexOf('숙소-1') < text.indexOf('숙소-0'));
  });
});

describe('useMobile — 실제 훅의 초기 폭 경계', () => {
  for (const [width, breakpoint, expected] of [
    [375, undefined, true],
    [767, undefined, true],
    [768, undefined, false],
    [1280, undefined, false],
    [1023, 1024, true],
    [1024, 1024, false],
  ]) {
    test(`${width}px / 기준 ${breakpoint ?? 768}px → ${expected ? '모바일' : '데스크톱'}`, async () => {
      const args = breakpoint == null ? [] : [breakpoint];
      assert.equal(await renderHook('src/hooks/useMobile.js', 'useMobile', args, { viewportWidth: width }), expected);
    });
  }
});
