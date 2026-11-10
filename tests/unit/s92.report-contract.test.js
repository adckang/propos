/**
 * s92 — 레포트 계약 (주간·월간·일간·시간 레포트가 지켜야 하는 공통 규칙)
 *
 * 리팩터링(레포트 모듈 일원화) 전에 "지금 동작"을 기간·화면 전체에 걸쳐 고정하는 안전망.
 * 소스 글자를 보는 대신 실제로 실행한다 —
 *   A. 기간 규칙: 모든 기간의 시제·이름·날짜 범위. 화면용·서버용 날짜 계산이 같은 답을 내는지.
 *   B. 서버 API: 기간마다 통계·상세(드릴다운)·캘린더·발견된 패턴이 열리는지. 데모/운영 경로가 같은 판정인지.
 *   C. 요약 문장: 모든 기간 × 대표 데이터의 정확한 문장, 시제별 공통 규칙.
 *   D. 화면 연결: 리스트뷰(주/일)·대시보드(월)·숙소 상세(일)가 레포트에 같은 숙소 범위·같은 요약 규칙·
 *      같은 "숙소 누르면 그 날짜로 이동" 동작을 넘기는지 — 실제 컴포넌트를 렌더링해서 확인.
 *
 * { todo } 로 표시한 테스트 = 지금은 틀려 있고 레포트 일원화 단계에서 고칠 것(실패해도 전체는 통과, 고치면 todo 해제).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getPeriodRange } from '../../src/domain/reportingDomain.js';
import { periodToDateRange, describePeriod, monthsAgoRange, periodForOffset, periodCapabilities } from '../../src/domain/periodDomain.js';
import { generateSummary, getMonthlyInsights, getPeriodInsights, getWeeklyInsights } from '../../src/application/reportingService.js';
import { getDemoStats } from '../../src/application/demoReportingService.js';
import { futureSummaryFor } from '../../src/domain/futureWeekDomain.js';
import { PROPERTIES } from '../../src/data/roomStateMockData.js';
import statsHandler from '../../api/stats.js';
import { callHandler } from '../helpers/apiHandler.js';
import { renderComponent, PROBE, visibleText } from '../helpers/renderComponent.js';
import { kst, withFrozenNow } from '../helpers/testTime.js';

const NOW = kst('2026-11-04T10:00'); // 수요일
const wall = date => (date ? new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 23) : null);

// ── A. 기간 규칙 ────────────────────────────────────────────────────────────
// [기간, 시제, 단위, 오프셋, 이름, 서버 범위 시작, 서버 범위 끝(포함)]
const PERIODS = [
  // 시간 단위도 끝은 포함 구간(-1ms). "다음 예정"은 지금(1분)을 지난 뒤부터 — 화면과 서버가 같은 구간 (2026-11-04 일원화)
  ['last_hour',     'past',   'hour',  -1, '지난 1시간', '2026-11-04T09:00:00.000', '2026-11-04T09:59:59.999'],
  ['next_hour',     'future', 'hour',   1, '다음 예정',  '2026-11-04T10:01:00.000', '2026-11-04T11:00:59.999'],
  ['yesterday',     'past',   'day',   -1, '어제',       '2026-11-03T00:00:00.000', '2026-11-03T23:59:59.999'],
  ['today',         'active', 'day',    0, '오늘',       '2026-11-04T00:00:00.000', '2026-11-04T23:59:59.999'],
  ['tomorrow',      'future', 'day',    1, '내일',       '2026-11-05T00:00:00.000', '2026-11-05T23:59:59.999'],
  ['days_ago_5',    'past',   'day',   -5, '5일 전',     '2026-10-30T00:00:00.000', '2026-10-30T23:59:59.999'],
  ['days_ahead_2',  'future', 'day',    2, '2일 뒤',     '2026-11-06T00:00:00.000', '2026-11-06T23:59:59.999'],
  ['last_week',     'past',   'week',  -1, '지난주',     '2026-10-26T00:00:00.000', '2026-11-01T23:59:59.999'],
  ['this_week',     'active', 'week',   0, '이번 주',    '2026-11-02T00:00:00.000', '2026-11-08T23:59:59.999'],
  ['next_week',     'future', 'week',   1, '다음 주',    '2026-11-09T00:00:00.000', '2026-11-15T23:59:59.999'],
  ['weeks_ago_2',   'past',   'week',  -2, '2주 전',     '2026-10-19T00:00:00.000', '2026-10-25T23:59:59.999'],
  ['weeks_ahead_2', 'future', 'week',   2, '2주 뒤',     '2026-11-16T00:00:00.000', '2026-11-22T23:59:59.999'],
  ['last_month',    'past',   'month', -1, '지난달',     '2026-10-01T00:00:00.000', '2026-10-31T23:59:59.999'],
  ['this_month',    'active', 'month',  0, '이번 달',    '2026-11-01T00:00:00.000', '2026-11-30T23:59:59.999'],
  ['next_month',    'future', 'month',  1, '다음 달',    '2026-12-01T00:00:00.000', '2026-12-31T23:59:59.999'],
];

describe('A. 기간 규칙 — 모든 기간의 시제·이름·날짜 범위', () => {
  for (const [period, tense, unit, offset, label, from, to] of PERIODS) {
    test(`${period}: ${label} (${tense}) ${from.slice(0, 10)} ~ ${to.slice(0, 10)}`, () => {
      const desc = describePeriod(period);
      assert.deepEqual([desc.tense, desc.unit, desc.offset, desc.label], [tense, unit, offset, label]);
      const range = getPeriodRange(period, NOW);
      assert.deepEqual([wall(range.from), wall(range.to)], [from, to]);
    });
  }

  test('지금(now)은 범위가 없다', () => {
    assert.equal(getPeriodRange('now', NOW), null);
    assert.equal(describePeriod('now').tense, 'now');
  });

  test('알 수 없는 기간은 이름이 없다 (월은 이름 있는 세 기간만 — months_ago_2 는 아직 없음)', () => {
    assert.equal(describePeriod('bogus'), null);
    assert.equal(describePeriod('months_ago_2'), null);
  });

  for (const [period] of PERIODS) {
    test(`화면용 범위 = 서버 범위 (끝만 배타/포함 차이): ${period}`, () => {
      const screen = periodToDateRange(period, NOW.getTime());
      const server = getPeriodRange(period, NOW);
      assert.ok(screen, `${period}: 화면용 범위 없음`);
      assert.equal(screen.from.getTime(), server.from.getTime());
      assert.equal(screen.to.getTime() - 1, server.to.getTime());
    });
  }

  test('기간 기능표: 운영·데모·화면이 쓰는 한 표 (periodCapabilities)', () => {
    for (const [period, stats, drilldown, calendar, insights] of CAPABILITIES) {
      const caps = periodCapabilities(period);
      assert.deepEqual([caps.stats, caps.drilldown, caps.calendar, Boolean(caps.insights)], [stats, drilldown, calendar, insights], period);
      if (insights) assert.equal(caps.insights, describePeriod(period).unit, period);
    }
  });

  test('패턴 분석의 "N개월 전" 범위 = 지난달/이번 달 범위', () => {
    for (const [n, period] of [[0, 'this_month'], [1, 'last_month']]) {
      const insight = monthsAgoRange(n, NOW.getTime());
      const server = getPeriodRange(period, NOW);
      assert.equal(insight.from.getTime(), server.from.getTime(), period);
      assert.equal(insight.to.getTime() - 1, server.to.getTime(), period);
    }
  });

  // 경계: 일요일 밤·월요일 새벽(주의 시작은 월요일 0시), 새해 첫날 아침(UTC 로는 아직 작년 12/31)
  const EDGES = [
    ['2026-11-08T23:30', 'this_week', '2026-11-02T00:00:00.000', '2026-11-08T23:59:59.999'],
    ['2026-11-09T00:10', 'this_week', '2026-11-09T00:00:00.000', '2026-11-15T23:59:59.999'],
    ['2027-01-01T08:00', 'this_week', '2026-12-28T00:00:00.000', '2027-01-03T23:59:59.999'],
    ['2027-01-01T08:00', 'last_month', '2026-12-01T00:00:00.000', '2026-12-31T23:59:59.999'],
    ['2027-01-01T08:00', 'this_month', '2027-01-01T00:00:00.000', '2027-01-31T23:59:59.999'],
    ['2027-01-01T08:00', 'yesterday', '2026-12-31T00:00:00.000', '2026-12-31T23:59:59.999'],
    ['2028-02-15T12:00', 'this_month', '2028-02-01T00:00:00.000', '2028-02-29T23:59:59.999'],
  ];
  for (const [at, period, from, to] of EDGES) {
    test(`경계 ${at} KST → ${period}`, () => {
      const range = getPeriodRange(period, kst(at));
      assert.deepEqual([wall(range.from), wall(range.to)], [from, to]);
    });
  }

  test('오프셋 → 기간 이름: 0·±1 은 표준 이름, 그 밖은 일반 이름', () => {
    assert.deepEqual(
      [-2, -1, 0, 1, 2].map(n => periodForOffset('week', n)),
      ['weeks_ago_2', 'last_week', 'this_week', 'next_week', 'weeks_ahead_2'],
    );
    assert.deepEqual(
      [-2, -1, 0, 1, 2].map(n => periodForOffset('day', n)),
      ['days_ago_2', 'yesterday', 'today', 'tomorrow', 'days_ahead_2'],
    );
  });
});

// ── B. 서버 API — 기간별로 무엇이 열리는가 ────────────────────────────────
// [기간, 통계, 상세(드릴다운), 캘린더, 발견된 패턴]
const CAPABILITIES = [
  ['now',           true,  false, false, false],
  ['last_hour',     true,  true,  false, false],
  ['next_hour',     true,  false, false, false],
  ['yesterday',     true,  true,  false, false],
  ['today',         true,  false, false, false],
  ['tomorrow',      true,  false, false, false],
  ['days_ago_5',    true,  true,  false, false],
  ['days_ahead_2',  true,  false, false, false],
  ['last_week',     true,  true,  false, true],
  ['this_week',     true,  true,  false, true],
  ['next_week',     true,  false, false, false],
  ['weeks_ago_2',   true,  true,  false, false],
  ['weeks_ahead_2', true,  false, false, false],
  ['last_month',    true,  true,  true,  true],
  ['this_month',    true,  true,  true,  true],
  ['next_month',    true,  false, true,  false],
  ['months_ago_2',  false, false, false, false],
  ['bogus',         false, false, false, false],
];
const DEMO = { PROPOS_DATA_PROFILE: 'demo' };
const REAL = { PROPOS_DATA_PROFILE: undefined };
// 운영 경로는 DB 에 닿지 않는 주소로 호출 — 받아들인 요청은 DB 단계에서 500, 거절은 그 전에 400
const accepted = status => status !== 400 && status !== 404;

describe('B. 서버 API — 기간별 통계·상세·캘린더·발견된 패턴 (데모와 운영이 같은 판정)', () => {
  for (const [period, stats, drilldown, calendar, insights] of CAPABILITIES) {
    test(`${period}: 통계 ${stats ? 'O' : 'X'} · 상세 ${drilldown ? 'O' : 'X'} · 캘린더 ${calendar ? 'O' : 'X'} · 패턴 ${insights ? 'O' : 'X'}`, async () => {
      const urls = {
        stats: `/api/stats?period=${period}`,
        drilldown: `/api/stats/drilldown?period=${period}&metric=cleaning_time`,
        calendar: `/api/stats/calendar?period=${period}`,
      };
      const expected = { stats, drilldown, calendar };
      for (const [kind, url] of Object.entries(urls)) {
        const demo = await callHandler(statsHandler, url, { env: DEMO });
        const real = await callHandler(statsHandler, url, { env: REAL });
        assert.equal(accepted(demo.status), expected[kind], `데모 ${kind} (${demo.status})`);
        assert.equal(accepted(real.status), expected[kind], `운영 ${kind} (${real.status})`);
      }
      if (stats) {
        const demo = await callHandler(statsHandler, urls.stats, { env: DEMO });
        assert.equal(Array.isArray(demo.json.insights), insights, '데모 응답의 발견된 패턴');
      }
    });
  }

  test('발견된 패턴 진입점: 열린 기간만, 분석이 실패해도 [] 로 통계 응답을 살린다', async () => {
    const failing = { query: async () => { throw new Error('db down'); } };
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      assert.deepEqual(await getPeriodInsights('last_month', { db: failing, now: NOW }), []);
      assert.deepEqual(await getPeriodInsights('this_week', { db: failing, now: NOW }), []);
    } finally {
      console.error = originalError;
    }
    assert.ok(logged.some(line => line.includes('getMonthlyInsights 실패')), '월간 실패 로그');
    assert.ok(logged.some(line => line.includes('getWeeklyInsights 실패')), '주간 실패 로그');
    const untouched = { query: async () => { throw new Error('호출되면 안 됨'); } };
    for (const period of ['next_month', 'weeks_ago_2', 'yesterday', 'now', 'bogus']) {
      assert.equal(await getPeriodInsights(period, { db: untouched, now: NOW }), null, period);
    }
  });

  test('운영 경로의 발견된 패턴: 열린 기간만 DB 를 조회한다', async () => {
    const queried = [];
    const db = { query: async () => { queried.push(true); return { rows: [] }; } };
    for (const [period, , , , insights] of CAPABILITIES.filter(([p]) => describePeriod(p))) {
      queried.length = 0;
      const unit = describePeriod(period).unit;
      const result = unit === 'week'
        ? await getWeeklyInsights(period, { db, now: NOW })
        : unit === 'month' ? await getMonthlyInsights(period, { db, now: NOW }) : [];
      assert.ok(Array.isArray(result), period);
      assert.equal(queried.length > 0, insights, `${period}: 조회 ${queried.length}회`);
    }
  });
});

// ── C. 요약 문장 ───────────────────────────────────────────────────────────
// 7개 운영 지표가 다 있는 기간(실패 10건) / 이벤트 몇 건만 있는 얕은 기간(노쇼 1건) / 아무 일 없는 기간
const OPS = {
  checkIns: 14, checkOuts: 12, anomalies: 3, energyWaste: 1, noShowSuspected: 1,
  vacantEnergyWaste: 3, vacantEnergyResolved: 3, preStayAttempts: 12, preStayOptimized: 11,
  cleaningFinished: 12, cleaningOnTime: 10, cleaningAssigned: 12, cleaningCreated: 12,
  postCheckoutEnergyWaste: 2, postCheckoutSecurityBreach: 1, postCleaningSecurityBreach: 1,
};
const SHALLOW = { checkIns: 3, checkOuts: 2, anomalies: 2, noShowSuspected: 1 };
const QUIET = { checkIns: 3, checkOuts: 2, anomalies: 0, noShowSuspected: 0 };
const NOSHOW = ' 노쇼 의심 1건 확인이 필요해요.';

// [기간, OPS 문장, SHALLOW 문장, QUIET 문장]
const SUMMARIES = [
  ['last_hour',     '지난 1시간 보통이에요 (실패 10건)', '지난 1시간 완벽해요 (실패 0건)', '지난 1시간 완벽해요 (실패 0건)'],
  ['yesterday',     `어제 보통이에요 (실패 10건)${NOSHOW}`, `어제 완벽해요 (실패 0건)${NOSHOW}`, '어제 완벽해요 (실패 0건)'],
  ['days_ago_5',    `5일 전 보통이에요 (실패 10건)${NOSHOW}`, `5일 전 완벽해요 (실패 0건)${NOSHOW}`, '5일 전 완벽해요 (실패 0건)'],
  ['last_week',     `지난주 보통이에요 (실패 10건)${NOSHOW}`, `지난주 완벽해요 (실패 0건)${NOSHOW}`, '지난주 완벽해요 (실패 0건)'],
  ['weeks_ago_2',   `2주 전 보통이에요 (실패 10건)${NOSHOW}`, `2주 전 완벽해요 (실패 0건)${NOSHOW}`, '2주 전 완벽해요 (실패 0건)'],
  ['last_month',    '지난달 보통이에요 (실패 10건)', '지난달 완벽해요 (실패 0건)', '지난달 완벽해요 (실패 0건)'],
  ['this_week',     '이번 주 보통이에요 (실패 10건)', '이번 주 완벽해요 (실패 0건)', '이번 주 완벽해요 (실패 0건)'],
  ['this_month',    '이번 달 보통이에요 (실패 10건)', '이번 달 완벽해요 (실패 0건)', '이번 달 완벽해요 (실패 0건)'],
  ['next_hour',     '1시간 내 체크인 14건 예정이에요.', '1시간 내 체크인 3건 예정이에요.', '1시간 내 체크인 3건 예정이에요.'],
  ['tomorrow',      '내일 체크인 14건 예정이에요.', '내일 체크인 3건 예정이에요.', '내일 체크인 3건 예정이에요.'],
  ['days_ahead_2',  '2일 뒤 체크인 14건 예정이에요.', '2일 뒤 체크인 3건 예정이에요.', '2일 뒤 체크인 3건 예정이에요.'],
  ['next_week',     '다음 주 체크인 14건 예정이에요.', '다음 주 체크인 3건 예정이에요.', '다음 주 체크인 3건 예정이에요.'],
  ['weeks_ahead_2', '2주 뒤 체크인 14건 예정이에요.', '2주 뒤 체크인 3건 예정이에요.', '2주 뒤 체크인 3건 예정이에요.'],
  ['next_month',    '다음 달 체크인 14건 예정이에요.', '다음 달 체크인 3건 예정이에요.', '다음 달 체크인 3건 예정이에요.'],
];

describe('C. 요약 문장 — 모든 기간의 정확한 문장', () => {
  for (const [period, ops, shallow, quiet] of SUMMARIES) {
    test(period, () => {
      assert.equal(generateSummary(period, OPS), ops);
      assert.equal(generateSummary(period, SHALLOW), shallow);
      assert.equal(generateSummary(period, QUIET), quiet);
    });
  }

  test('지금·오늘: 실시간 상태 문장', () => {
    const live = { occupied: 3, preStayReady: 1, vacant: 4, cleaning: 1, anomalyCount: 0, total: 9 };
    for (const period of ['now', 'today']) {
      assert.equal(generateSummary(period, live), '현재 9개 숙소 정상 운영 중이에요.');
      assert.equal(generateSummary(period, { ...live, anomalyCount: 2 }), '현재 이상 징후 2건이 확인됐어요. 바로 확인이 필요해요.');
    }
  });

  test('알 수 없는 기간은 빈 문장', () => {
    assert.equal(generateSummary('bogus', OPS), '');
  });

  test('시제 공통 규칙: 지난 기간이면 단위와 상관없이 노쇼 의심 안내가 붙는다 (지금은 지난달만 빠짐)',
    { todo: '3단계: 요약 문장 일원화' }, () => {
      for (const period of ['yesterday', 'last_week', 'weeks_ago_2', 'last_month']) {
        assert.ok(generateSummary(period, OPS).endsWith(NOSHOW), period);
      }
    });

  test('시제 공통 규칙: 진행 중·미래 기간엔 노쇼 안내가 붙지 않는다', () => {
    for (const period of ['this_week', 'this_month', 'tomorrow', 'next_week', 'next_month']) {
      assert.ok(!generateSummary(period, OPS).includes('노쇼'), period);
    }
  });

  test('데모 요약도 운영과 같은 규칙으로 만든다 (지금은 데모가 따로 만든 문장)', { todo: '3단계: 요약 문장 일원화' }, () => {
    for (const period of ['last_week', 'last_month', 'this_week', 'yesterday']) {
      const demo = getDemoStats(period, { now: NOW });
      assert.equal(demo.summary, generateSummary(period, demo.stats), period);
    }
  });
});

describe('명시적 DEMO의 예정 요약 — 같은 응답의 입실 통계값 사용', () => {
  for (const [scope, propertyIds] of [
    ['전체', null],
    ['일부 선택', PROPERTIES.slice(0, 3).map(property => property.id)],
    ['선택 없음', []],
  ]) {
    for (const period of ['next_hour', 'tomorrow', 'next_week']) {
      test(`${scope} / ${period}: 통계와 요약의 입실 건수가 일치한다`, () => {
        const result = getDemoStats(period, { propertyIds, now: NOW });
        const matched = result.summary.match(/체크인 (\d+)건/);
        assert.ok(matched, '기존 예정 문장 형식 유지');
        assert.equal(Number(matched[1]), result.stats.checkIns, '요약에 독립적으로 만든 입실 건수를 사용하지 않음');
        assert.equal(result.dataProfile, 'demo');
        assert.ok(result.summary.includes('예정이에요.'));
      });
    }
  }
});

// ── D. 화면 연결 — 세 화면이 레포트에 같은 규칙으로 연결되는가 ────────────
const REPORT_PANEL = 'src/components/v2/reporting/ReportPanel.jsx';
const SUMMARY_BANNER = 'src/components/v2/reporting/SummaryBanner.jsx';

function reportDoubles() {
  const hookCalls = [];
  const replace = {
    'src/hooks/useReportingStats.js': {
      useReportingStats: (period, ids) => {
        hookCalls.push({ period, ids });
        return { stats: { checkIns: 2 }, summary: '서버 요약', insights: [{ type: 'REPEAT', sentence: '패턴' }], loading: false };
      },
    },
    'src/hooks/useMonthlyCalendar.js': { useMonthlyCalendar: () => ({ data: null, loading: false, error: null }) },
    [REPORT_PANEL]: PROBE,
    [SUMMARY_BANNER]: PROBE,
  };
  return { hookCalls, replace };
}

const SAMPLE = PROPERTIES.slice(0, 3);
const SAMPLE_IDS = SAMPLE.map(p => p.id);
const daysAgo = n => new Date(Date.now() - n * 86_400_000);

/**
 * 레포트 연결 공통 판정 — 어느 화면이든:
 *  ① 통계 훅에 (기간, 보이는 숙소 id) ② 레포트 패널·실패 상세 목록에 같은 숙소 범위 ③ 미래 기간은 예약 기준 요약
 *  ④ 발견된 패턴을 요약 배너로 ⑤ 숙소를 누르면 그 숙소 + 그 날짜(오늘 기준 며칠 전)로 이동, 없는 숙소는 무시
 */
function assertReportWiring(view, { rendered, hookCalls, period, ids, scoped, navigates, onSelectProperty }) {
  assert.deepEqual(hookCalls.at(-1), { period, ids }, `${view}: 통계 훅 인자`);
  const panel = rendered.props(REPORT_PANEL).at(-1);
  assert.ok(panel, `${view}: 레포트 패널이 그려지지 않음`);
  assert.equal(panel.period, period, `${view}: 패널 기간`);
  assert.deepEqual(panel.propertyIds, ids, `${view}: 패널 숙소 범위`);
  assert.deepEqual(panel.properties.map(p => p.id), scoped.map(p => p.id), `${view}: 패널 숙소 목록`);
  const banner = rendered.props(SUMMARY_BANNER).at(-1);
  const expectedSummary = futureSummaryFor(period, scoped) || '서버 요약';
  assert.equal(banner.summary, expectedSummary, `${view}: 요약 문장`);
  assert.deepEqual(banner.insights, [{ type: 'REPEAT', sentence: '패턴' }], `${view}: 발견된 패턴을 요약 배너로`);
  // 실제 버그였음(2026-11-04, 레포트 부품 일원화로 수정): 리스트뷰·숙소 상세가 "실패 N건" 상세 목록에 숙소 범위를
  // 안 넘겨서 고르지 않은 숙소(상세는 다른 모든 숙소)의 실패까지 목록에 나왔다. 대시보드만 넘기고 있었다.
  assert.deepEqual(panel.drilldownPropertyIds, ids, `${view}: 실패 상세 목록 숙소 범위`);
  if (navigates) {
    assert.equal(typeof panel.onSelectRoom, 'function', `${view}: 패널 숙소 선택`);
    assert.equal(banner.onSelectRoom, panel.onSelectRoom, `${view}: 패널·패턴 팝업이 같은 이동 규칙`);
    onSelectProperty.calls.length = 0;
    panel.onSelectRoom(scoped[1].id, daysAgo(3).toISOString());
    panel.onSelectRoom('없는숙소', daysAgo(1).toISOString());
    panel.onSelectRoom(scoped[0].id);
    assert.deepEqual(onSelectProperty.calls.map(([p, offset]) => [p.id, offset]), [[scoped[1].id, -3], [scoped[0].id, null]],
      `${view}: 숙소 이동`);
  }
}

function recorder() {
  const fn = (...args) => { fn.calls.push(args); };
  fn.calls = [];
  return fn;
}

describe('D. 화면 연결 — 리스트뷰·대시보드·숙소 상세가 같은 레포트 규칙', () => {
  for (const [period, props] of [['this_week', {}], ['tomorrow', { initialDayOffset: 1 }], ['days_ago_3', { initialDayOffset: -3 }]]) {
    test(`리스트뷰 ${period}`, () => withFrozenNow(NOW, async () => {
      const { hookCalls, replace } = reportDoubles();
      const onSelectProperty = recorder();
      const rendered = await renderComponent('src/components/v2/PropertyListView.jsx',
        { properties: SAMPLE, onSelectProperty, ...props }, { replace });
      assertReportWiring('리스트뷰', { rendered, hookCalls, period, ids: SAMPLE_IDS, scoped: SAMPLE, navigates: true, onSelectProperty });
    }));
  }

  // 대시보드 화면 자체(MonthlyView) — 선택 숙소 범위를 손으로 넣지 않고 화면이 만든 값을 그대로 검증한다.
  // 서버 렌더링에선 기간 버튼을 누를 수 없어 첫 화면(이번 달)만; 지난달·다음달은 같은 부품(PeriodReport)에 기간만 바꿔 검증.
  test('대시보드 화면(이번 달): 전체 선택이어도 화면 숙소 id 를 명시해 레포트·캘린더에 넘긴다', () => withFrozenNow(NOW, async () => {
    const { hookCalls, replace } = reportDoubles();
    const calendarCalls = [];
    const onSelectProperty = recorder();
    const rendered = await renderComponent('src/components/v2/MonthlyView.jsx', { properties: SAMPLE, onSelectProperty }, {
      replace: {
        ...replace,
        'src/hooks/useMonthlyCalendar.js': { useMonthlyCalendar: (...args) => { calendarCalls.push(args); return { data: null, loading: false, error: null }; } },
        'src/components/v2/reporting/MonthlyCalendar.jsx': PROBE,
      },
    });
    assertReportWiring('대시보드', { rendered, hookCalls, period: 'this_month', ids: SAMPLE_IDS, scoped: SAMPLE, navigates: true, onSelectProperty });
    assert.deepEqual(calendarCalls.at(-1), ['this_month', SAMPLE_IDS], '캘린더도 같은 숙소 범위');
    const calendar = rendered.props('src/components/v2/reporting/MonthlyCalendar.jsx').at(-1);
    assert.deepEqual(calendar.scopedProperties.map(p => p.id), SAMPLE_IDS);
    assert.match(visibleText(rendered.html), /전체 3개 숙소/);
    assert.match(rendered.html, /data-testid="selected-property-report"/);
  }));

  for (const period of ['last_month', 'next_month']) {
    test(`대시보드 레포트 ${period} (같은 부품, 기간만 다름)`, () => withFrozenNow(NOW, async () => {
      const { hookCalls, replace } = reportDoubles();
      const onSelectProperty = recorder();
      const rendered = await renderComponent('src/components/v2/reporting/PeriodReport.jsx', {
        period, properties: SAMPLE, scopedProperties: SAMPLE, propertyIds: SAMPLE_IDS, noSelection: false,
        scopeBadge: { allSelected: true, selectedCount: 3, totalCount: 3 }, onSelectProperty,
      }, { replace });
      assertReportWiring('대시보드', { rendered, hookCalls, period, ids: SAMPLE_IDS, scoped: SAMPLE, navigates: true, onSelectProperty });
    }));
  }

  test('숙소를 하나도 안 고르면 안내만 보이고 통계를 부르지 않는다', () => withFrozenNow(NOW, async () => {
    const { hookCalls, replace } = reportDoubles();
    const rendered = await renderComponent('src/components/v2/reporting/PeriodReport.jsx', {
      period: 'last_month', properties: SAMPLE, scopedProperties: [], propertyIds: [], noSelection: true,
      scopeBadge: { allSelected: false, selectedCount: 0, totalCount: 3 },
    }, { replace });
    assert.equal(visibleText(rendered.html), '숙소를 선택해주세요');
    assert.equal(hookCalls.at(-1).period, null);
    assert.equal(rendered.props(REPORT_PANEL).length, 0);
  }));

  test('일부만 고르면 "N / M개 선택 · 선택 레포트"', () => withFrozenNow(NOW, async () => {
    const { replace } = reportDoubles();
    const rendered = await renderComponent('src/components/v2/reporting/PeriodReport.jsx', {
      period: 'last_month', properties: SAMPLE, scopedProperties: SAMPLE.slice(0, 2), propertyIds: SAMPLE_IDS.slice(0, 2),
      noSelection: false, scopeBadge: { allSelected: false, selectedCount: 2, totalCount: 3 },
    }, { replace });
    assert.match(visibleText(rendered.html), /2 \/ 3개 선택 선택 레포트/);
  }));

  test('숙소 상세 "오늘": 화면 고유 활동 요약·패널을 쓰고, 오늘 데이터가 올 때까지 요약을 기다린다', () => withFrozenNow(NOW, async () => {
    const { replace } = reportDoubles();
    const loadingCalendar = { ...replace, 'src/hooks/useMonthlyCalendar.js': { useMonthlyCalendar: () => ({ data: null, loading: true, error: null }) } };
    const waiting = await renderComponent('src/components/v2/PropertyDetailView.jsx', { property: SAMPLE[0], onBack() {} }, { replace: loadingCalendar });
    assert.equal(waiting.props(SUMMARY_BANNER).at(-1).loading, true, '오늘 데이터를 기다리는 동안 서버 요약을 먼저 보여주지 않음');
    const loaded = await renderComponent('src/components/v2/PropertyDetailView.jsx', { property: SAMPLE[0], onBack() {} }, {
      replace: { ...replace, 'src/hooks/useMonthlyCalendar.js': { useMonthlyCalendar: () => ({ data: { days: {} }, loading: false, error: null }) } },
    });
    assert.equal(loaded.props(SUMMARY_BANNER).at(-1).summary, '오늘 지금까지 문제 이벤트가 없어요.');
    assert.equal(loaded.props(REPORT_PANEL).length, 0, '오늘은 기간 레포트 패널 대신 활동 패널');
  }));

  for (const [period, offset] of [['yesterday', -1], ['days_ago_3', -3], ['tomorrow', 1]]) {
    test(`숙소 상세 ${period}`, () => withFrozenNow(NOW, async () => {
      const { hookCalls, replace } = reportDoubles();
      const property = SAMPLE[0];
      const rendered = await renderComponent('src/components/v2/PropertyDetailView.jsx',
        { property, initialDayOffset: offset, onBack() {} }, { replace });
      assertReportWiring('숙소 상세', { rendered, hookCalls, period, ids: [property.id], scoped: [property], navigates: false });
    }));
  }
});
