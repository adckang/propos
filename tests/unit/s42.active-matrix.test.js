/**
 * s42 — ActiveMatrixPanel 뼈대 TC
 *
 * 검증 항목:
 *   A. periodToDateRange — src/domain/periodDomain.js
 *      this_week / last_week 지원 + 3주 연속성
 *      (기존 api/cleaning/[...slug].js 내부 함수를 추출·export)
 *
 *   B. splitActiveStats — src/domain/activeWeekDomain.js
 *      this_week 통합 stats → { pastStats, futureStats } 분리
 *      pastStats: EventMatrixPanel이 쓰는 과거 필드
 *      futureStats: FutureMatrixPanel이 쓰는 { checkIns }
 *
 * 고정 타임스탬프 (결정론적 테스트):
 *   WED: 2026-09-09 14:00 KST = 2026-09-09 05:00 UTC  (수요일)
 *   MON: 2026-09-07 14:00 KST = 2026-09-07 05:00 UTC  (월요일)
 *   SUN: 2026-09-13 14:00 KST = 2026-09-13 05:00 UTC  (일요일 — 주의 마지막 날)
 *
 * 시작 시 A, B 그룹 전부 FAIL (모듈 없음).
 * 구현 후 전부 PASS.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { periodToDateRange, periodToRemainingRange } from '../../src/domain/periodDomain.js';
import { splitActiveStats }   from '../../src/domain/activeWeekDomain.js';

// ── 고정 타임스탬프 ────────────────────────────────────────────────────────
const WED = new Date('2026-09-09T05:00:00Z').getTime(); // 수 14:00 KST
const MON = new Date('2026-09-07T05:00:00Z').getTime(); // 월 14:00 KST
const SUN = new Date('2026-09-13T05:00:00Z').getTime(); // 일 14:00 KST

// ══════════════════════════════════════════════════════════════════════════
// A. periodToDateRange
//    이미 구현된 next_week / tomorrow는 회귀 확인용.
//    신규: this_week / last_week.
//    핵심 불변식: last_week.to === this_week.from === next_week.from - 7days
// ══════════════════════════════════════════════════════════════════════════

describe('periodToDateRange — this_week', () => {

  test('수요일: from=이번 월요일(2026-09-07), to=다음 월요일(2026-09-14)', () => {
    const r = periodToDateRange('this_week', WED);
    assert.equal(r.from.toISOString(), '2026-09-06T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-09-13T15:00:00.000Z');
  });

  test('월요일: from=오늘(2026-09-07), to=다음 월요일(2026-09-14)', () => {
    const r = periodToDateRange('this_week', MON);
    assert.equal(r.from.toISOString(), '2026-09-06T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-09-13T15:00:00.000Z');
  });

  test('일요일(주 마지막): from=6일 전 월요일(2026-09-07), to=내일 월요일(2026-09-14)', () => {
    const r = periodToDateRange('this_week', SUN);
    assert.equal(r.from.toISOString(), '2026-09-06T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-09-13T15:00:00.000Z');
  });

  test('from < to 항상', () => {
    for (const now of [WED, MON, SUN]) {
      const r = periodToDateRange('this_week', now);
      assert.ok(r.from < r.to, `from < to 실패 (now=${now})`);
    }
  });

  test('기간 길이 = 정확히 7일', () => {
    const r = periodToDateRange('this_week', WED);
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    assert.equal(r.to.getTime() - r.from.getTime(), SEVEN_DAYS_MS);
  });
});

describe('periodToDateRange — last_week', () => {

  test('수요일: from=지난 월요일(2026-08-31), to=이번 월요일(2026-09-07)', () => {
    const r = periodToDateRange('last_week', WED);
    assert.equal(r.from.toISOString(), '2026-08-30T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-09-06T15:00:00.000Z');
  });

  test('일요일: from=2주 전 월요일(2026-08-31), to=지난 월요일(2026-09-07)', () => {
    // 일요일(2026-09-13)의 last_week = 2026-08-31(Mon) ~ 2026-09-07(Mon)
    const r = periodToDateRange('last_week', SUN);
    assert.equal(r.from.toISOString(), '2026-08-30T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-09-06T15:00:00.000Z');
  });

  test('월요일: from=지난 월요일(2026-08-31), to=이번 월요일(2026-09-07)', () => {
    const r = periodToDateRange('last_week', MON);
    assert.equal(r.from.toISOString(), '2026-08-30T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-09-06T15:00:00.000Z');
  });

  test('기간 길이 = 정확히 7일', () => {
    const r = periodToDateRange('last_week', WED);
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    assert.equal(r.to.getTime() - r.from.getTime(), SEVEN_DAYS_MS);
  });
});

describe('periodToDateRange — 3주 연속성 (last / this / next)', () => {

  test('last_week.to === this_week.from (빈틈 없음)', () => {
    const last = periodToDateRange('last_week', WED);
    const curr = periodToDateRange('this_week', WED);
    assert.equal(last.to.getTime(), curr.from.getTime());
  });

  test('this_week.to === next_week.from (빈틈 없음)', () => {
    const curr = periodToDateRange('this_week', WED);
    const next = periodToDateRange('next_week', WED);
    assert.equal(curr.to.getTime(), next.from.getTime());
  });

  test('일요일 기준으로도 3주 연속성 유지', () => {
    const last = periodToDateRange('last_week', SUN);
    const curr = periodToDateRange('this_week', SUN);
    const next = periodToDateRange('next_week', SUN);
    assert.equal(last.to.getTime(), curr.from.getTime(), 'last.to !== curr.from');
    assert.equal(curr.to.getTime(), next.from.getTime(), 'curr.to !== next.from');
  });
});

describe('periodToDateRange — 기존 지원 회귀 (tomorrow / next_week)', () => {

  test('tomorrow: from=내일, to=모레', () => {
    const r = periodToDateRange('tomorrow', WED);
    // WED = 2026-09-09 KST → tomorrow = 2026-09-10
    assert.equal(r.from.toISOString(), '2026-09-09T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-09-10T15:00:00.000Z');
  });

  test('next_week(수): from=2026-09-14(다음 월), to=2026-09-21', () => {
    const r = periodToDateRange('next_week', WED);
    assert.equal(r.from.toISOString(), '2026-09-13T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-09-20T15:00:00.000Z');
  });

  test('지원 안 되는 period → null', () => {
    assert.equal(periodToDateRange('now', WED), null);
    assert.equal(periodToDateRange('this_week_invalid', WED), null);
  });
});

describe('periodToDateRange — this_month / next_month (KST 월 경계)', () => {
  test('this_month(9월 중순): 9/1 00:00 KST ~ 10/1 00:00 KST', () => {
    const r = periodToDateRange('this_month', WED);
    assert.equal(r.from.toISOString(), '2026-08-31T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-09-30T15:00:00.000Z');
  });

  test('KST 자정 직후(UTC 8/31 15:30 = KST 9/1 00:30) → 9월', () => {
    const r = periodToDateRange('this_month', new Date('2026-08-31T15:30:00Z').getTime());
    assert.equal(r.from.toISOString(), '2026-08-31T15:00:00.000Z');
  });

  test('KST 자정 직전(UTC 8/31 14:30 = KST 8/31 23:30) → 8월', () => {
    const r = periodToDateRange('this_month', new Date('2026-08-31T14:30:00Z').getTime());
    assert.equal(r.from.toISOString(), '2026-07-31T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-08-31T15:00:00.000Z');
  });

  test('this_month.to === next_month.from (빈틈 없음)', () => {
    assert.equal(
      periodToDateRange('this_month', WED).to.getTime(),
      periodToDateRange('next_month', WED).from.getTime(),
    );
  });

  test('12월 next_month → 다음 해 1월 (연도 경계)', () => {
    const r = periodToDateRange('next_month', new Date('2026-12-10T03:00:00Z').getTime());
    assert.equal(r.from.toISOString(), '2026-12-31T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2027-01-31T15:00:00.000Z');
  });
});

describe('periodToRemainingRange — [예정] 구간 (지금 ~ 기간 끝)', () => {
  test('this_week(수 14:00 KST): from = 지금, to = 다음 월요일 00:00 KST', () => {
    const r = periodToRemainingRange('this_week', WED);
    assert.equal(r.from.getTime(), WED);
    assert.equal(r.to.toISOString(), '2026-09-13T15:00:00.000Z');
  });

  test('this_month: from = 지금, to = 다음 달 1일 00:00 KST', () => {
    const r = periodToRemainingRange('this_month', WED);
    assert.equal(r.from.getTime(), WED);
    assert.equal(r.to.toISOString(), '2026-09-30T15:00:00.000Z');
  });

  test('진행 중 기간의 [예정] 끝은 전체 기간의 끝과 같다 (기간 끝을 넘지 않음)', () => {
    for (const p of ['this_week', 'this_month']) {
      assert.equal(periodToRemainingRange(p, WED).to.getTime(), periodToDateRange(p, WED).to.getTime(), p);
    }
  });

  test('미래 기간은 기간 전체 그대로 (tomorrow / next_week / next_month)', () => {
    for (const p of ['tomorrow', 'next_week', 'next_month']) {
      const a = periodToRemainingRange(p, WED), b = periodToDateRange(p, WED);
      assert.equal(a.from.getTime(), b.from.getTime(), p);
      assert.equal(a.to.getTime(),   b.to.getTime(),   p);
    }
  });

  test('과거 기간(last_week)은 자르지 않는다', () => {
    assert.equal(periodToRemainingRange('last_week', WED).from.getTime(), periodToDateRange('last_week', WED).from.getTime());
  });

  test('지원하지 않는 기간 → null', () => {
    assert.equal(periodToRemainingRange('now', WED), null);
    assert.equal(periodToRemainingRange('bogus', WED), null);
  });

  test('일요일 밤에도 구간이 뒤집히지 않는다 (from <= to)', () => {
    const sunNight = new Date('2026-09-13T14:00:00Z').getTime(); // 일 23:00 KST
    const r = periodToRemainingRange('this_week', sunNight);
    assert.ok(r.from.getTime() < r.to.getTime());
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. splitActiveStats
//    this_week 통합 stats → { pastStats, futureStats } 분리
//
//    계약:
//      - pastStats:   EventMatrixPanel이 쓰는 과거 지표 필드 전체
//      - futureStats: FutureMatrixPanel이 쓰는 { checkIns }
//      - checkIns 는 pastStats에 없어야 한다
//      - checkIns 가 없을 경우 futureStats.checkIns = null (undefined 아님)
// ══════════════════════════════════════════════════════════════════════════

// 이번 주 통합 stats 예시 — EventMatrixPanel 필드 + checkIns(남은 체크인)
const ACTIVE_STATS = {
  checkOuts:                  6,
  preStayAttempts:            6,
  preStayOptimized:           5,
  cleaningFinished:           6,
  cleaningOnTime:             5,
  cleaningAssigned:           5,
  cleaningCreated:            6,
  vacantEnergyWaste:          1,
  postCheckoutEnergyWaste:    1,
  postCheckoutSecurityBreach: 0,
  postCleaningSecurityBreach: 0,
  checkIns:                   8,  // ← 남은 체크인 예정 수 (FutureMatrixPanel용)
};

describe('splitActiveStats — 정상 분리', () => {

  test('futureStats.checkIns === 8 (원본 값 그대로)', () => {
    const { futureStats } = splitActiveStats(ACTIVE_STATS);
    assert.equal(futureStats.checkIns, 8);
  });

  test('pastStats에 checkIns 없음', () => {
    const { pastStats } = splitActiveStats(ACTIVE_STATS);
    assert.ok(!('checkIns' in pastStats), 'pastStats에 checkIns가 있으면 안 됨');
  });

  test('pastStats에 EventMatrixPanel 필드 전부 존재', () => {
    const { pastStats } = splitActiveStats(ACTIVE_STATS);
    const REQUIRED = [
      'checkOuts', 'preStayAttempts', 'preStayOptimized',
      'cleaningFinished', 'cleaningOnTime',
      'cleaningAssigned', 'cleaningCreated',
      'vacantEnergyWaste', 'postCheckoutEnergyWaste',
      'postCheckoutSecurityBreach', 'postCleaningSecurityBreach',
    ];
    for (const field of REQUIRED) {
      assert.ok(field in pastStats, `pastStats에 ${field} 없음`);
    }
  });

  test('futureStats에 과거 필드 없음 (checkIns 외 포함 금지)', () => {
    const { futureStats } = splitActiveStats(ACTIVE_STATS);
    const PAST_FIELDS = ['checkOuts', 'cleaningFinished', 'preStayAttempts'];
    for (const field of PAST_FIELDS) {
      assert.ok(!(field in futureStats), `futureStats에 과거 필드 ${field} 있으면 안 됨`);
    }
  });

  test('pastStats 필드 값 변경 없음 (원본 보존)', () => {
    const { pastStats } = splitActiveStats(ACTIVE_STATS);
    assert.equal(pastStats.checkOuts, 6);
    assert.equal(pastStats.cleaningOnTime, 5);
    assert.equal(pastStats.postCheckoutEnergyWaste, 1);
  });
});

describe('splitActiveStats — 경계값', () => {

  test('null 입력 → { pastStats: null, futureStats: null }', () => {
    const r = splitActiveStats(null);
    assert.equal(r.pastStats,   null);
    assert.equal(r.futureStats, null);
  });

  test('undefined 입력 → { pastStats: null, futureStats: null }', () => {
    const r = splitActiveStats(undefined);
    assert.equal(r.pastStats,   null);
    assert.equal(r.futureStats, null);
  });

  test('checkIns=0 → futureStats.checkIns=0 (0을 null로 변환하면 안 됨)', () => {
    const { futureStats } = splitActiveStats({ ...ACTIVE_STATS, checkIns: 0 });
    assert.equal(futureStats.checkIns, 0);
  });

  test('checkIns 없음 → futureStats.checkIns=null (undefined 아님)', () => {
    const noCheckIns = { ...ACTIVE_STATS };
    delete noCheckIns.checkIns;
    const { futureStats } = splitActiveStats(noCheckIns);
    assert.equal(futureStats.checkIns, null);
    assert.notEqual(futureStats.checkIns, undefined);
  });

  test('원본 객체 변경 없음 (불변성)', () => {
    const input = { ...ACTIVE_STATS };
    const before = JSON.stringify(input);
    splitActiveStats(input);
    assert.equal(JSON.stringify(input), before);
  });
});

describe('splitActiveStats — 미지 필드 처리', () => {

  test('알 수 없는 추가 필드는 pastStats에 포함 (미래 확장 허용)', () => {
    const withExtra = { ...ACTIVE_STATS, anomalyCount: 3, newField: 'x' };
    const { pastStats } = splitActiveStats(withExtra);
    assert.equal(pastStats.anomalyCount, 3);
    assert.equal(pastStats.newField, 'x');
  });
});
