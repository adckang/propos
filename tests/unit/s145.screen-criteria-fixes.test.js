/**
 * s145 — 화면 기준 4건 (사용자 결정 2026-11-23, 네 건 모두 추천안)
 *
 *   ① 안심지수 칸 색 = 요약 등급과 같은 기준 (90 이상 초록 · 75 이상 주황 · 75 미만 빨강)
 *      — 72점이면 칸은 주황인데 요약 배너는 "불안정해요"로 빨갛던 모순을 없앤다.
 *   ② 레포트·캘린더 목록에서 숙소를 누르면 그 날짜(퇴실 날짜·칸 날짜)로 상세가 열린다 (D-028과 같은 방식)
 *   ③ 데모에서 청소 관리 › 절차 점검은 영어 오류 대신 안내 줄
 *   ④ 앱으로 등록해 이름이 없는 담당자는 목록에 "이름 없음"
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { safetyIndexTone, summarizeOperationalMetrics, computeSafetyIndex } from '../../src/domain/operationalMetricsDomain.js';
import { isUrgentSummary } from '../../src/domain/reportSummaryDomain.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// 측정 가능한 지표가 "게스트 맞이 준비" 하나뿐인 기간 — 안심지수 = n점
const statsWithScore = (n) => ({ preStayOptimized: n, preStayAttempts: 100, cleaningCreated: 0, cleaningAssigned: 0 });

// 소스에서 `{marker` 로 시작하는 JSX 블록 하나를 잘라 낸다 (다음 형제 블록 앞까지)
function blockAfter(src, marker, endMarker = '\n      )}') {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `블록을 찾지 못함: ${marker}`);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, `블록 끝을 찾지 못함: ${marker}`);
  return src.slice(start, end);
}

describe('① 안심지수 칸 색 단계 — 요약 등급과 같은 기준', () => {
  test('경계값: 90 이상 good · 75 이상 fair · 75 미만 poor · 점수 없음 null', () => {
    assert.equal(safetyIndexTone(100), 'good');
    assert.equal(safetyIndexTone(90), 'good');
    assert.equal(safetyIndexTone(89), 'fair');
    assert.equal(safetyIndexTone(75), 'fair');
    assert.equal(safetyIndexTone(74), 'poor');
    assert.equal(safetyIndexTone(72), 'poor', '72점은 요약이 "불안정해요"(빨강)이므로 칸도 빨강');
    assert.equal(safetyIndexTone(0), 'poor');
    assert.equal(safetyIndexTone(null), null);
  });

  test('0~100점 전부에서 칸 색과 실제 요약 문장이 같은 말을 한다 (빨강 ⇔ 빨간 배너, 초록 ⇔ 양호·완벽)', () => {
    for (let n = 0; n <= 100; n++) {
      const stats = statsWithScore(n);
      const { score } = computeSafetyIndex(stats);
      assert.equal(score, n);
      const summary = summarizeOperationalMetrics('last_month', stats);
      const tone = safetyIndexTone(score);
      assert.equal(tone === 'poor', isUrgentSummary(summary), `${n}점: 칸 ${tone} / 요약 "${summary}"`);
      assert.equal(tone === 'good', /양호해요|완벽해요/.test(summary), `${n}점: 칸 ${tone} / 요약 "${summary}"`);
    }
  });

  test('EventMatrixPanel 안심지수 칸은 safetyIndexTone 으로 색을 정하고, 행 색 기준(90/70)을 빌려 쓰지 않는다', () => {
    const src = read('src/components/v2/reporting/EventMatrixPanel.jsx');
    assert.match(src, /import \{[^}]*safetyIndexTone[^}]*\} from '..\/..\/..\/domain\/operationalMetricsDomain\.js'/);
    assert.match(src, /safetyIndexTone\(avgScore\)/);
    assert.ok(!/avgScore >= 70/.test(src), '안심지수 칸에 70점 기준이 남아 있음');
    assert.ok(!/pctColor\(avgScore\)/.test(src), '안심지수 칸이 행 색 함수(90/70)를 그대로 씀');
  });
});

describe('② 목록에서 숙소를 누르면 그 날짜로 상세가 열린다', () => {
  const future = read('src/components/v2/reporting/FutureMatrixPanel.jsx');

  for (const label of ['수동배정 필요', '배정 요청중', '청소 계획 없음', '퇴실 없는 청소']) {
    test(`레포트 "${label}" 목록 → 그 건의 퇴실 시각을 함께 넘긴다`, () => {
      const block = blockAfter(future, `metricLabel="${label}"`);
      assert.match(block, /onSelectRoom\?\.\(item\.property_id, item\.checkout_at\)/);
    });
  }

  test('받는 쪽(PeriodReport)은 두 번째 인자를 날짜 오프셋으로 바꿔 상세에 넘긴다 (기존 D-028 경로)', () => {
    const src = read('src/components/v2/reporting/PeriodReport.jsx');
    assert.match(src, /\(propertyId, occurredAt\) =>/);
    assert.match(src, /kstDayOffsetFromToday\(toKstDateKey\(occurredAt\)\)/);
    assert.match(src, /onSelectProperty\(property, dayOffset\)/);
  });

  const calendar = read('src/components/v2/reporting/MonthlyCalendar.jsx');

  test('캘린더 팝업의 숙소 선택 함수는 칸 날짜를 받아 날짜 오프셋으로 넘긴다', () => {
    // 같은 문장이 IssueRow에도 있으므로 이 함수 몸통 안에서만 본다
    const fn = blockAfter(calendar, 'const selectPropertyById = (propertyId, dayKey) => {', '\n  };');
    assert.match(fn, /onSelectProperty\?\.\(property, dayKey \? kstDayOffsetFromToday\(dayKey\) : null\)/);
  });

  test('캘린더 미래 칸 팝업(입실·퇴실·배정완료·청소 계획 없음·요청중·수동배정·퇴실 없는 청소)은 모두 그 칸 날짜를 넘긴다', () => {
    const calls = [...calendar.matchAll(/selectPropertyById\(([^)]*)\)/g)].map(m => m[1]);
    assert.ok(calls.length >= 7, `호출 ${calls.length}곳`);
    for (const args of calls) assert.match(args, /, futurePopup\.day$/, `날짜 없이 부르는 곳: selectPropertyById(${args})`);
  });

  test('캘린더 지난 칸 "문제" 팝업도 그 칸 날짜로 연다', () => {
    assert.match(calendar, /<IssueRow[\s\S]*?dayKey=\{selectedDay\}/);
    const row = blockAfter(calendar, 'function IssueRow({ item, properties, onSelectProperty, showProperty, dayKey }) {', '\n}\n');
    assert.match(row, /onSelectProperty\?\.\(property, dayKey \? kstDayOffsetFromToday\(dayKey\) : null\)/);
  });
});

describe('③ 데모에서 절차 점검 — 영어 오류 대신 안내 줄', () => {
  const check = read('src/components/v2/CleaningProcessCheck.jsx');

  test('demo 이면 처음 불러오기(로그인 확인·숙소 조회) 전에 멈춘다', () => {
    assert.match(check, /export default function CleaningProcessCheck\(\{ apiFetch, demo = false \}\)/);
    const effect = blockAfter(check, 'useEffect(() => {\n    (async () => {', "/api/cleaning/properties'");
    const guard = effect.indexOf('if (demo) return;');
    assert.ok(guard >= 0, 'demo 가드 없음');
    assert.ok(guard < effect.indexOf("apiFetch('/api/auth/me')"), 'demo 가드가 첫 요청보다 뒤에 있음');
    assert.match(check, /\}, \[apiFetch, demo\]\);/);
  });

  test('demo 이면 관리자 전용 안내와 같은 회색(info) 줄로 안내한다', () => {
    assert.match(check, /if \(demo\) \{\n\s+return <Line level="info" title="데모에서는 절차 점검을 쓸 수 없어요"/);
  });

  test('데모 여부는 앱(RoomStateApp) → 청소 관리(CleaningManager) → 절차 점검으로 전달된다', () => {
    const app = read('src/components/v2/RoomStateApp.jsx');
    assert.match(blockAfter(app, '<CleaningManager', '/>'), /demo=\{USE_DEMO_DATA\}/);
    const manager = read('src/components/v2/CleaningManager.jsx');
    assert.match(manager, /export default function CleaningManager\(\{ syncConfig, onBack, onDataChanged, demo = false \}\)/);
    assert.match(manager, /<CleaningProcessCheck apiFetch=\{apiFetch\} demo=\{demo\} \/>/);
  });
});

describe('④ 이름 없는 담당자 → "이름 없음"', () => {
  test('청소 관리 › 담당자 목록의 이름 칸은 비어 있으면 "이름 없음"', () => {
    const src = read('src/components/v2/CleaningManager.jsx');
    assert.match(src, /<div style=\{\{ fontWeight: 700, fontSize: 14, color: '#1a202c' \}\}>\{c\.name \|\| '이름 없음'\}<\/div>/);
    assert.ok(!/color: '#1a202c' \}\}>\{c\.name\}<\/div>/.test(src), '이름을 그대로 찍는 칸이 남아 있음');
  });
});
