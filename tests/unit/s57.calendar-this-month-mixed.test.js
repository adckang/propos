/**
 * s57 — 대시보드 캘린더 "이번달"에서 지금 이후 날짜는 "다음달"과 같은 포맷으로
 *
 * 사용자 요청 (2026-09-24): "Dashboard의 이번달 캘린더에서 지금 이후의 값은 다음달캘린더의 포멧으로
 * 보여줘야지." — 이번달 탭에서 오늘 이전(지난 날짜)은 기존처럼 "문제" 배지, 오늘(포함)부터 월말까지는
 * 다음달과 똑같이 체류/공실/입실/퇴실/청소배정 포맷(D-020)을 보여준다. 지난달·다음달은 그대로(전체
 * 한 포맷)이고, 이번달만 칸 단위로 두 포맷이 섞인다.
 *
 * 레이어: L1 = 실제 함수 import / L2 = 실제 소스 파일 계약(readFileSync).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { periodToRemainingRange } from '../../src/domain/periodDomain.js';
import { buildFutureCalendarDays } from '../../src/domain/monthlyCalendarDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ══════════════════════════════════════════════════════════════════════════
// A. 전제 — periodToRemainingRange('this_month')는 "지금 ~ 월말"이라 이번달의
//    미래 포맷 데이터가 정확히 "오늘부터"만 채워진다 (이미 구현된 함수의 계약을 재확인)
// ══════════════════════════════════════════════════════════════════════════
describe('전제: this_month의 남은 구간은 "지금"부터', () => {
  test('this_month remaining range의 시작은 오늘 자정이 아니라 지금 이 순간', () => {
    const now = new Date('2026-09-24T11:20:00Z'); // KST 9/24 20:20
    const range = periodToRemainingRange('this_month', now.getTime());
    assert.equal(range.from.getTime(), now.getTime()); // "지금"부터, 오늘 자정부터가 아님
  });

  test('buildFutureCalendarDays에 this_month 남은 구간을 주면 오늘 날짜도 포함된다 (시각과 무관)', () => {
    const now = new Date('2026-09-24T11:20:00Z'); // KST 9/24 20:20 — 하루가 거의 끝나갈 때도
    const range = periodToRemainingRange('this_month', now.getTime());
    const properties = [{ id: 'A', name: 'A', reservations: [] }];
    const days = buildFutureCalendarDays(properties, range, []);
    assert.ok('2026-09-24' in days, '오늘 날짜가 미래 포맷 데이터에 없음');
    assert.ok(!('2026-09-23' in days), '어제는 포함되면 안 됨 (지난 날짜는 문제 배지 몫)');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. MonthlyCalendar 배선 (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('MonthlyCalendar — 이번달은 칸 단위로 지난 날짜(문제 배지)/오늘 이후(다음달 포맷)가 섞인다', () => {
  const src = read('src/components/v2/reporting/MonthlyCalendar.jsx');

  test('cellIsFuture — 날짜 키를 오늘과 문자열 비교해서 판단한다 (YYYY-MM-DD라 사전식 비교 = 날짜 비교)', () => {
    assert.match(src, /const cellIsFuture = \(cell\) => cell\.key >= nowMarker\.dateKey;/);
  });

  test('needsFutureData — 이번달과 다음달 둘 다 미래 데이터를 가져온다 (지난달은 안 가져옴)', () => {
    assert.match(src, /const needsFutureData = statsPeriod === 'this_month' \|\| statsPeriod === 'next_month';/);
  });

  test('미래 포맷 블록은 statsPeriod가 아니라 그 칸이 미래인지로 켜진다 (다음달 전용 조건이 아님)', () => {
    assert.match(src, /\{cell\.inMonth && futureDay && cellIsFuture\(cell\) && \(\(\) => \{/);
    // "isFutureMonth && cell.inMonth" 같은, 탭 전체를 기준으로 켜던 옛 조건은 없어야 한다
    assert.ok(!/isFutureMonth/.test(src), '탭 전체 기준(isFutureMonth)이 아직 남아 있음 — 칸 단위(cellIsFuture) 로 바뀌어야 함');
  });

  test('"문제" 배지는 그 칸이 미래가 아닐 때만 (오늘·이후엔 안 뜸)', () => {
    assert.match(src, /\{!cellIsFuture\(cell\) && dayData\?\.total > 0 && \(/);
  });

  test('미래 데이터 조회 기간은 statsPeriod 그대로 사용한다 (이번달이면 this_month로 요청 — next_month로 고정되지 않음)', () => {
    assert.match(src, /const params = new URLSearchParams\(\{ period: statsPeriod, items: 'true' \}\);/);
    assert.ok(!/period: 'next_month'/.test(src), "청소 배정 조회가 여전히 next_month로 고정돼 있음");
  });

  test('미래 구간(futureRange)도 statsPeriod로 계산한다 (this_month면 지금~월말, next_month면 월 전체)', () => {
    assert.match(src, /\(\) => \(needsFutureData \? periodToRemainingRange\(statsPeriod\) : null\)/);
  });

  test('지난달은 미래 데이터를 아예 안 가져온다 (needsFutureData가 false)', () => {
    assert.match(src, /if \(!needsFutureData \|\| noSelection\) \{/);
  });

  test('숙소 하나만 선택했을 때(gantt 막대) 이번달은 지난 실제 기록 + 오늘 이후 예약 예측을 이어 붙인다', () => {
    const start = src.indexOf('const stateSegments = useMemo(');
    const end = src.indexOf('}, [singleProperty, statsPeriod');
    const block = src.slice(start, end);
    assert.match(block, /if \(statsPeriod === 'next_month'\) return buildFutureReservationSegments\(singleProperty, futureRange\);/);
    assert.match(block, /if \(statsPeriod === 'this_month' && futureRange\) \{/);
    assert.match(block, /return \[\.\.\.past, \.\.\.buildFutureReservationSegments\(singleProperty, futureRange\)\];/);
  });

  test('로딩·에러 상태도 이번달·다음달은 두 데이터 소스를 함께 본다', () => {
    assert.match(src, /const displayLoading = needsFutureData \? \(loading \|\| futureCleaning\.loading\) : loading;/);
    assert.match(src, /const displayError = needsFutureData \? \(error \|\| futureCleaning\.error\) : error;/);
  });

  test('칸 높이는 숙소 하나 선택 또는 미래 데이터가 필요한 달(이번달·다음달)일 때 더 크다', () => {
    assert.match(src, /minHeight: singleProperty \|\| needsFutureData \? \(isMobile \? 86 : 112\) : \(isMobile \? 68 : 100\)/);
  });

  test('훅은 모두 조건부 early return(if (noSelection) return) 보다 앞에 있다 (Rules of Hooks)', () => {
    const early = src.indexOf('if (noSelection) {');
    assert.ok(early > 0);
    const lastHook = Math.max(
      src.lastIndexOf('useMemo('),
      src.lastIndexOf('useState('),
      src.lastIndexOf('useEffect('),
    );
    assert.ok(lastHook < early, '훅이 early return 뒤에 있음');
  });

  test('새 코드는 다크 색을 재사용하지 않는다', () => {
    const FORBIDDEN = ['#02080d', '#030f18', '#0a1f2e', '#00d4ff', '#00ff88'];
    for (const c of FORBIDDEN) assert.ok(!src.toLowerCase().includes(c), c);
  });
});
