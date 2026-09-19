/**
 * s45 — 레포트 집계 범위·모수 감사 TC (2026-09-19 감사 결과 기반)
 *
 * 배경: ListView에서 숙소를 1개 / 복수 / 전체 / 해제로 바꿀 때 과거·현재·미래 레포트 숫자가
 *       일관되지 않는다는 제보 → 코드·UI·서버 로직 전수 검수 후 결함을 TC로 고정.
 *
 * 표기 규칙
 *   - 정상 동작을 지키는 회귀 가드: 일반 test (지금도 PASS)
 *   - 감사에서 확인된 결함은 수정 전까지 bug('R#', ...) → node:test `todo` 로 두었고, 전부 수정되어 일반 test 로 승격됨
 *       · 새 결함을 고정할 때 bug() 를 쓰면 `npm test` 는 통과하고,
 *         `AUDIT_STRICT=1 node --test tests/unit/s45.report-scope-audit.test.js` 로 실제 실패를 확인할 수 있다
 *
 * 레이어 (feedback_tc_coverage_design)
 *   L1 = 실제 함수 import / L2 = 실제 소스 파일 계약(readFileSync). 로직 재구현(L0) 금지.
 *
 * 결함 ID / 상태
 *   R1  [수정] useReportingStats: 실제 응답이 전부 0이면 DEMO 수치로 대체 (증상의 원인)
 *   R2  [수정] DetailView/Dashboard ReportPanel에 properties 미전달 + this_month 미지원
 *   R3  [수정] ActiveHybridPanel이 propertyIds 미전달 → 이번주 청소 배정이 선택 무시
 *   R4  [수정] now/today: 2개 이상 선택 시 KV 전체를 집계 (선택 무시)
 *   R5  [수정] now/today: 현재 상태를 이벤트 기록에서 계산 — 5분 만료로 숙소가 사라지고 이상·입실전이 안 잡히던 문제 해소 (s48)
 *   R6  [수정] cleaningOnTime/cleaningCreated/Assigned 주입 (이벤트 페어링 + cleaning_jobs)
 *   R8  [수정] FutureMatrixPanel: stale 응답 경쟁 + 훅이 early return 뒤에 위치
 *   R9  [수정] 이상(anomaly) 판정 기준 통일 / TodayStatusPanel 입실전·모수 표시
 *   R15 [수정] 미래 기간 요약 문장을 예약(iCal) 기준으로 클라이언트에서 계산 (서버 이벤트 기반은 항상 "예약 없음")
 *   R7  [수정] 이번 주/이번 달 [예정] = 지금 ~ 기간 끝 (periodToRemainingRange)
 *   R11 [수정] periodToDateRange 를 KST 자정 경계로 통일 + api/cleaning 복제 제거 + futureWeekDomain 일 인덱스 KST
 *   R12 [수정] 목업 fixture: reservations[] 가 현재 체류를 포함하도록 정규화
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { getStatsForPeriod } from '../../src/application/reportingService.js';
import { countCurrentStats, countPeriodEvents, getPeriodRange } from '../../src/domain/reportingDomain.js';
import { periodToDateRange } from '../../src/domain/periodDomain.js';
import { getOccupancyIssues } from '../../src/domain/futureReportDomain.js';
import { PROPERTIES } from '../../src/data/roomStateMockData.js';
import { makeStateDb } from '../helpers/stateEventsFixtures.js';

const STRICT = process.env.AUDIT_STRICT === '1';
const bug = (id, reason) => (STRICT ? {} : { todo: `[${id}] ${reason}` });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 소스에서 `<Tag ... />` 첫 self-closing 엘리먼트 텍스트를 추출 (predicate로 여러 개 중 선택) */
function jsxElement(src, tag, predicate = () => true) {
  let from = 0;
  while (true) {
    const start = src.indexOf(`<${tag}`, from);
    if (start < 0) return null;
    const end = src.indexOf('/>', start);
    const text = src.slice(start, end + 2);
    if (predicate(text)) return text;
    from = start + 1;
  }
}

const subsets = (arr) => {
  const out = [];
  for (let mask = 1; mask < (1 << arr.length); mask++) out.push(arr.filter((_, i) => mask & (1 << i)));
  return out;
};

// ══════════════════════════════════════════════════════════════════════════
// G1. now / today — 선택 범위 (R4, R5)
// ══════════════════════════════════════════════════════════════════════════
// 현재 상태는 이벤트 기록에서 계산한다 (임시 저장소 5분 만료 문제 해소) — 숙소별 이벤트 기록으로 장면을 만든다
const HISTORIES = {
  A: ['check_in_detected'],                          // 체류중
  B: ['cleaning_finished'],                          // 공실
  C: ['check_out_detected'],                         // 청소 대기
  D: ['check_in_detected', 'complaint_detected'],    // 체류중 + 민원
};
const EMPTY_DB = makeStateDb({});
const LIVE_FIELDS = ['occupied', 'preStayReady', 'vacant', 'cleaning', 'anomalyCount', 'total'];

for (const period of ['now', 'today']) {
  describe(`getStatsForPeriod(${period}) — 선택 범위`, () => {
    const run = (ids) => getStatsForPeriod(period, { db: makeStateDb(HISTORIES), propertyIds: ids });

    test('1개 선택 → 그 숙소만', async () => {
      const { stats } = await run(['A']);
      assert.equal(stats.total, 1);
      assert.equal(stats.occupied, 1);
    });

    test('선택 없음(null=전체) → 기록이 있는 4개 숙소 전체', async () => {
      const { stats } = await run(null);
      assert.equal(stats.total, 4);
    });

    test('빈 선택([]) → 전 항목 0', async () => {
      const { stats } = await run([]);
      for (const f of LIVE_FIELDS) assert.equal(stats[f], 0, f);
    });

    test('2개 선택 → 선택한 2개만 집계', async () => {
      const { stats } = await run(['A', 'B']);
      assert.equal(stats.total, 2);
      assert.equal(stats.occupied, 1);
      assert.equal(stats.vacant, 1);
    });

    test('3개 선택 → 선택한 3개만 집계', async () => {
      const { stats } = await run(['A', 'B', 'C']);
      assert.equal(stats.total, 3);
      assert.equal(stats.cleaning, 1);
    });

    test('선택하지 않은 숙소의 이상(anomaly)은 포함되지 않는다', async () => {
      const { stats } = await run(['A', 'B']); // D(민원)는 미선택
      assert.equal(stats.anomalyCount, 0);
    });

    test('합산성: 모든 부분집합에서 개별 합 == 복수 선택 결과', async () => {
      const ids = ['A', 'B', 'C', 'D'];
      const single = {};
      for (const id of ids) single[id] = (await run([id])).stats;
      const bad = [];
      for (const subset of subsets(ids)) {
        const multi = (await run(subset)).stats;
        for (const f of LIVE_FIELDS) {
          const sum = subset.reduce((s, id) => s + single[id][f], 0);
          if (multi[f] !== sum) bad.push(`${subset.join('+')}.${f}: 합 ${sum} ≠ 복수 ${multi[f]}`);
        }
      }
      assert.deepEqual(bad, []);
    });

    test('여러 숙소를 골라도, 몇 시간이 지나 임시 메모가 비었어도 기록으로 상태가 복원된다', async () => {
      const { stats } = await getStatsForPeriod(period, { db: makeStateDb({ A: HISTORIES.A, B: HISTORIES.B }), propertyIds: ['A', 'B'] });
      assert.equal(stats.total, 2);
      assert.equal(stats.vacant, 1);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// G2. 기간 이벤트 합산성 (회귀 가드 — 과거/이번주 지표는 개별 합과 같아야 함)
// ══════════════════════════════════════════════════════════════════════════
describe('getStatsForPeriod(last_week) — 복수 선택 합산성', () => {
  const TYPES = [
    'check_in_detected', 'check_out_detected', 'complaint_detected', 'energy_waste_detected',
    'vacant_energy_waste_detected', 'vacant_energy_waste_resolved', 'no_show_suspected',
    'early_checkin_suspected', 'checkout_confirmation_needed', 'checkin_prep_time_reached',
    'optimization_finished', 'cleaning_finished', 'post_checkout_energy_waste_detected',
    'post_checkout_security_breach_detected', 'post_cleaning_security_breach_detected',
  ];
  const IDS = ['X', 'Y', 'Z'];
  const ALL_EVENTS = IDS.flatMap((pid, seed) =>
    TYPES.flatMap((type, i) => Array.from({ length: (i + seed) % 3 }, () => ({ property_id: pid, type }))));

  const db = {
    query: (_sql, params) => {
      const ids = Array.isArray(params?.[0]) ? params[0] : null;
      return Promise.resolve({ rows: ids ? ALL_EVENTS.filter(e => ids.includes(e.property_id)) : ALL_EVENTS });
    },
  };
  const run = (ids) => getStatsForPeriod('last_week', { db, propertyIds: ids }).then(r => r.stats);

  test('모든 부분집합: 모든 지표 필드가 개별 합과 일치', async () => {
    const single = {};
    for (const id of IDS) single[id] = await run([id]);
    const fields = Object.keys(single.X);
    const bad = [];
    for (const subset of subsets(IDS)) {
      const multi = await run(subset);
      for (const f of fields) {
        const sum = subset.reduce((s, id) => s + single[id][f], 0);
        if (multi[f] !== sum) bad.push(`${subset.join('+')}.${f}: 합 ${sum} ≠ 복수 ${multi[f]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('전체(null) == 3개 전부 선택', async () => {
    assert.deepEqual(await run(null), await run(IDS));
  });

  test('countPeriodEvents 는 이벤트 분할에 대해 가법적', () => {
    const whole = countPeriodEvents(ALL_EVENTS);
    const parts = IDS.map(id => countPeriodEvents(ALL_EVENTS.filter(e => e.property_id === id)));
    for (const f of Object.keys(whole)) {
      assert.equal(parts.reduce((s, p) => s + p[f], 0), whole[f], f);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// G3. 현재 상태 모수·이상 판정 (R9)
// ══════════════════════════════════════════════════════════════════════════
describe('countCurrentStats — 모수 불변식', () => {
  const MIX = [
    { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION' },
    { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_COMPLAINT' },
    { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED' },
    { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED' },
    { mainStatus: 'VACANT',         subStatus: 'ENERGY_WASTE' },
    { mainStatus: 'CLEANING',       subStatus: 'CLEANING_PENDING' },
  ];

  test('체류중 + 입실전 + 공실 + 청소중 == total (누락·중복 없음)', () => {
    const s = countCurrentStats(MIX);
    assert.equal(s.occupied + s.preStayReady + s.vacant + s.cleaning, s.total);
    assert.equal(s.total, MIX.length);
  });

  test('빈 목록 → 전부 0', () => {
    const s = countCurrentStats([]);
    for (const f of LIVE_FIELDS) assert.equal(s[f], 0, f);
  });
});

describe('이상(anomaly) 판정 기준 일관성', () => {
  const room = (id, mainStatus, subStatus) => ({ id, currentState: { mainStatus, subStatus } });
  const ROOMS = [
    room('1', 'OCCUPIED', 'GOOD_CONDITION'),
    room('2', 'OCCUPIED', 'ISSUE_COMPLAINT'),
    room('3', 'OCCUPIED', 'ISSUE_AND_ENERGY'),
    room('4', 'OCCUPIED', 'ENERGY_WASTE'),
    room('5', 'VACANT',   'ENERGY_WASTE'),
  ];

  test('현재 레포트 anomalyCount == 체류중 이상 숙소 수(getOccupancyIssues) == 리스트 긴급 표시 기준', () => {
    const live   = countCurrentStats(ROOMS.map(r => r.currentState));
    const issues = getOccupancyIssues(ROOMS);
    assert.equal(live.anomalyCount, issues.issueCount);
  });
});

describe('TodayStatusPanel — 표시 항목 (L2)', () => {
  const src = read('src/components/v2/reporting/TodayStatusPanel.jsx');

  test('체류중·공실·청소중·이상감지 4행 표시 (회귀 가드)', () => {
    for (const label of ['체류중', '공실', '청소중', '이상감지']) assert.ok(src.includes(label), label);
  });

  test('입실전(preStayReady)도 표시해 행 합계가 total과 맞아야 한다', () => {
    assert.ok(src.includes('preStayReady'));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// G4. 청소 지표 주입 (R6)
// ══════════════════════════════════════════════════════════════════════════
describe('getStatsForPeriod — 청소 지표 6·7 주입 (R6)', () => {
  const H = 3_600_000;
  const t0 = new Date('2026-09-10T01:00:00Z');
  const at = (h) => new Date(t0.getTime() + h * H);
  const EVENTS = [
    { property_id: 'X', type: 'cleaning_started',  device_time: at(0) },
    { property_id: 'X', type: 'cleaning_finished', device_time: at(2) },   // 2h — 준수
    { property_id: 'X', type: 'check_out_detected', device_time: at(0) },
    { property_id: 'Y', type: 'cleaning_started',  device_time: at(0) },
    { property_id: 'Y', type: 'cleaning_finished', device_time: at(4) },   // 4h — 초과
    { property_id: 'Y', type: 'check_out_detected', device_time: at(0) },
  ];

  /** SQL 텍스트로 라우팅하는 DB 목: cleaning_jobs 질의 vs events 질의 */
  function makeDb({ events = EVENTS, jobs = { created: '3', assigned: '2' } } = {}) {
    const calls = [];
    return {
      calls,
      query: async (sql, params) => {
        const isJobs = /FROM cleaning_jobs/.test(sql);
        calls.push({ isJobs, params });
        if (!isJobs) return { rows: events };
        if (jobs instanceof Error) throw jobs;
        return { rows: [jobs] };
      },
    };
  }
  const NOW = new Date('2026-09-12T03:00:00Z');
  const run = (period, { db = makeDb(), ids = null } = {}) =>
    getStatsForPeriod(period, { db, propertyIds: ids, now: NOW }).then(r => r.stats);

  test('cleaningFinished = 완료 이벤트 수 (회귀 가드)', async () => {
    assert.equal((await run('last_week')).cleaningFinished, 2);
  });

  test('cleaningOnTime = 3시간 이내 완료 건수 (2h 준수 1건 / 4h 초과 1건)', async () => {
    assert.equal((await run('last_week')).cleaningOnTime, 1);
  });

  test('시작 이벤트가 없는 완료는 감점하지 않는다 (드릴다운 실패 목록과 같은 기준)', async () => {
    const events = [
      { property_id: 'X', type: 'cleaning_finished', device_time: at(2) },
      { property_id: 'Y', type: 'cleaning_finished', device_time: at(9) },
    ];
    const s = await run('last_week', { db: makeDb({ events }) });
    assert.equal(s.cleaningFinished, 2);
    assert.equal(s.cleaningOnTime, 2);
  });

  test('cleaningOnTime 는 cleaningFinished 를 넘지 않는다 (불변식)', async () => {
    const s = await run('last_week');
    assert.ok(s.cleaningOnTime <= s.cleaningFinished);
  });

  test('cleaningCreated / cleaningAssigned 는 cleaning_jobs 집계값', async () => {
    const s = await run('last_week');
    assert.equal(s.cleaningCreated, 3);
    assert.equal(s.cleaningAssigned, 2);
  });

  test('cleaning_jobs 질의는 선택 숙소로 필터되고 기간 끝은 현재를 넘지 않는다', async () => {
    const db = makeDb();
    await run('this_week', { db, ids: ['X', 'Y'] });
    const jobsCall = db.calls.find(c => c.isJobs);
    assert.ok(jobsCall, 'cleaning_jobs 질의가 없음');
    assert.deepEqual(jobsCall.params[2], ['X', 'Y']);
    assert.ok(jobsCall.params[1].getTime() <= NOW.getTime(), '아직 오지 않은 체크아웃까지 세면 안 됨');
  });

  test('빈 선택([])은 cleaning_jobs 를 조회하지 않고 0', async () => {
    const db = makeDb();
    const s = await run('last_week', { db, ids: [] });
    assert.equal(db.calls.filter(c => c.isJobs).length, 0);
    assert.equal(s.cleaningCreated, 0);
    assert.equal(s.cleaningAssigned, 0);
  });

  test('미래 기간(next_week/tomorrow)은 cleaning_jobs 를 조회하지 않는다', async () => {
    for (const period of ['next_week', 'tomorrow', 'next_month', 'next_hour']) {
      const db = makeDb();
      await run(period, { db });
      assert.equal(db.calls.filter(c => c.isJobs).length, 0, period);
    }
  });

  test('cleaning_jobs 조회가 실패해도 나머지 지표는 정상 반환, 지표 7만 null(해당 없음)', async () => {
    const orig = console.error; console.error = () => {};
    try {
      const s = await run('last_week', { db: makeDb({ jobs: new Error('relation "cleaning_jobs" does not exist') }) });
      assert.equal(s.cleaningCreated, null);
      assert.equal(s.cleaningAssigned, null);
      assert.equal(s.checkOuts, 2);
      assert.equal(s.cleaningOnTime, 1);
    } finally { console.error = orig; }
  });

  test('지표 7: EventMatrixPanel 이 체크아웃 수로 분모를 대체하지 않는다 (L2)', () => {
    const src = read('src/components/v2/reporting/EventMatrixPanel.jsx');
    assert.ok(!/cleaningCreated\s*\?\?\s*checkOuts/.test(src));
    assert.ok(!/cleaningAssigned\s*\?\?\s*0/.test(src));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// G5. 컴포넌트 배선 계약 (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('useReportingStats — DEMO 대체 금지 (R1)', () => {
  const src = read('src/hooks/useReportingStats.js');
  const thenStart = src.indexOf('.then(data');
  const catchStart = src.indexOf('.catch(', thenStart);
  const successBlock = src.slice(thenStart, catchStart);

  test('성공 응답 처리 블록을 찾을 수 있다 (가드 자체 검증)', () => {
    assert.ok(thenStart > 0 && catchStart > thenStart);
    assert.ok(successBlock.includes('data.stats'));
  });

  test('성공 응답이면 값이 전부 0이어도 DEMO_STATS로 대체하지 않는다', () => {
    assert.ok(!/DEMO_STATS|isEmptyStats|useDemo/.test(successBlock));
  });
});

describe('미래 패널 → 선택 범위 전달 (R2, R3)', () => {
  test('PropertyListView → ReportPanel: 필터된 properties + propertyIds 전달 (회귀 가드)', () => {
    const el = jsxElement(read('src/components/v2/PropertyListView.jsx'), 'ReportPanel');
    assert.ok(el.includes('properties='), 'properties');
    assert.ok(el.includes('propertyIds={statsPropertyIds}'), 'propertyIds');
  });

  test('ReportPanel → FutureMatrixPanel: propertyIds 전달 (회귀 가드)', () => {
    const el = jsxElement(read('src/components/v2/reporting/ReportPanel.jsx'), 'FutureMatrixPanel');
    assert.ok(el.includes('propertyIds={propertyIds}'));
  });

  test('ReportPanel → ActiveHybridPanel(이번주): propertyIds 전달', () => {
    const el = jsxElement(read('src/components/v2/reporting/ReportPanel.jsx'), 'ActiveHybridPanel');
    assert.ok(el.includes('propertyIds={propertyIds}'));
  });

  test('ActiveHybridPanel → FutureMatrixPanel: propertyIds 전달', () => {
    const src = read('src/components/v2/reporting/ActiveHybridPanel.jsx');
    const el = jsxElement(src, 'FutureMatrixPanel');
    assert.ok(el.includes('propertyIds={propertyIds}'));
  });

  test('DetailView → ReportPanel: 이 숙소의 properties 와 propertyIds 전달', () => {
    const el = jsxElement(read('src/components/v2/PropertyDetailView.jsx'), 'ReportPanel');
    assert.ok(el.includes('properties='), 'properties');
    assert.ok(el.includes('propertyIds='), 'propertyIds');
  });

  test('Dashboard → 이번 달 ReportPanel: properties 전달', () => {
    const el = jsxElement(read('src/components/v2/DashboardView.jsx'), 'ReportPanel', t => t.includes('this_month'));
    assert.ok(el.includes('properties='));
  });

  test('this_month 기간 범위를 계산할 수 있다 (Dashboard 이번 달 [예정])', () => {
    assert.notEqual(periodToDateRange('this_month'), null);
  });
});

describe('FutureMatrixPanel — 청소 통계 요청/렌더 (L2)', () => {
  const src = read('src/components/v2/reporting/FutureMatrixPanel.jsx');

  test('선택 숙소를 property_ids 로 청소 통계 API에 전달 (회귀 가드)', () => {
    assert.ok(src.includes("params.set('property_ids'"));
    assert.ok(src.includes('/api/cleaning/stats?'));
  });

  test('선택 변경 중 늦게 도착한 이전 응답이 최신 값을 덮어쓰지 않는다', () => {
    const start = src.indexOf('useEffect(');
    const end = src.indexOf('[period, idsKey]', start);
    const block = src.slice(start, end);
    assert.ok(/cancelled|AbortController|signal|ignore/i.test(block));
  });

  test('모든 훅은 조건부 early return 보다 앞에 위치 (Rules of Hooks)', () => {
    const early = src.indexOf('if (!stats) return null');
    const lastHook = src.lastIndexOf('useMemo(');
    assert.ok(early === -1 || early > lastHook);
  });
});

describe('[예정] 구간 배선 — 지금 ~ 기간 끝 (R7, L2)', () => {
  test('FutureMatrixPanel 은 periodToRemainingRange 로 구간을 계산한다 (주 전체 범위 함수 직접 사용 금지)', () => {
    const src = read('src/components/v2/reporting/FutureMatrixPanel.jsx');
    assert.ok(src.includes('periodToRemainingRange'));
    assert.ok(!/periodToDateRange/.test(src));
  });

  test('cleaning stats API 도 같은 함수로 구간을 계산한다 (클라이언트·서버 불일치 방지)', () => {
    const src = read('api/cleaning/[...slug].js');
    assert.ok(src.includes('periodToRemainingRange'));
    assert.ok(!/periodToDateRange/.test(src));
  });

  test('이번 주/이번 달 [예정] 섹션 라벨에 범위("지금부터")를 명시', () => {
    const src = read('src/components/v2/reporting/ActiveHybridPanel.jsx');
    assert.ok(src.includes('지금부터 일요일까지'));
    assert.ok(src.includes('지금부터 월말까지'));
  });
});

describe('미래 기간 요약 문장 배선 (R15, L2)', () => {
  test('ListView: 미래 기간 요약은 선택 숙소의 예약으로 계산해 SummaryBanner 에 전달', () => {
    const src = read('src/components/v2/PropertyListView.jsx');
    assert.match(src, /futureSummaryFor\(statsPeriod,\s*scopedProperties\)\s*\|\|\s*summary/);
    assert.ok(src.includes('<SummaryBanner summary={displaySummary}'));
  });

  test('DetailView: 이 숙소의 예약으로 계산', () => {
    const src = read('src/components/v2/PropertyDetailView.jsx');
    assert.match(src, /futureSummaryFor\(statsPeriod,\s*\[property\]\)\s*\|\|\s*summary/);
    assert.ok(src.includes('<SummaryBanner summary={displaySummary}'));
  });
});

describe('cleaning stats API — 선택 숙소 필터 (L2)', () => {
  const src = read('api/cleaning/[...slug].js');

  test('property_ids 를 받아 property_id = ANY 로 필터 (회귀 가드)', () => {
    assert.ok(src.includes('property_ids'));
    assert.ok(/property_id\s*=\s*ANY\(\$3::text\[\]\)/.test(src));
  });

  test('기간 계산은 도메인 함수를 재사용 (중복 구현 금지)', () => {
    assert.ok(!/function periodToDateRange/.test(src));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// G6. 기간 경계 일관성 (R11)
// ══════════════════════════════════════════════════════════════════════════
describe('기간 경계: periodToDateRange(레포트 미래 패널·청소 API) vs getPeriodRange(이벤트 집계)', () => {
  const REFS = [
    '2026-09-16T03:00:00Z',  // 수 12:00 KST
    '2026-09-13T14:30:00Z',  // 일 23:30 KST
    '2026-09-13T15:30:00Z',  // 월 00:30 KST
  ];

  for (const period of ['this_week', 'last_week', 'next_week', 'tomorrow']) {
    test(`${period}: 시작·끝 경계가 같은 KST 자정 기준`, () => {
      const bad = [];
      for (const iso of REFS) {
        const ref = new Date(iso);
        const a = getPeriodRange(period, ref);                 // KST 00:00 ~ 23:59:59.999
        const b = periodToDateRange(period, ref.getTime());    // [from, to) 배타 끝
        if (a.from.getTime() !== b.from.getTime())     bad.push(`${iso} from: ${b.from.toISOString()} ≠ ${a.from.toISOString()}`);
        if (a.to.getTime()   !== b.to.getTime() - 1)   bad.push(`${iso} to: ${new Date(b.to.getTime() - 1).toISOString()} ≠ ${a.to.toISOString()}`);
      }
      assert.deepEqual(bad, []);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// G7. 목업 fixture 계약 (R12)
// ══════════════════════════════════════════════════════════════════════════
describe('목업 숙소 fixture — reservations[] 는 현재 체류를 포함한 전체 목록', () => {
  // 실데이터(buildLiveProperty)의 reservations 는 과거·현재·미래 전체.
  // futureWeekDomain 은 reservations[] 만 보므로, 현재 체류가 빠지면 이번주/다음주 점유·체크아웃이 과소 집계된다.
  test('모든 숙소의 reservation(현재/다음 예약)이 reservations[] 에 존재', () => {
    const missing = PROPERTIES
      .filter(p => p.reservation)
      .filter(p => !(p.reservations ?? []).some(r =>
        r.checkIn.getTime() === p.reservation.checkIn.getTime() &&
        r.checkOut.getTime() === p.reservation.checkOut.getTime()))
      .map(p => `${p.id}(${p.currentState.mainStatus})`);
    assert.deepEqual(missing, []);
  });
});
