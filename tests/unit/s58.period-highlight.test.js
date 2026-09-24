/**
 * s58 — ListView 타임라인에 "지금 레포트가 가리키는 구간"을 하이라이트 박스로 표시
 *
 * 사용자 요청 (2026-09-24): "Listview에서... 현재 레포트가 가리키는 기간이 어디인지
 * 직관적으로 타임라인에서 보이지가 않아... 레포트와 통일성있는 색으로 테두리를 치면...
 * 가장 forground로 맨위에 오버레이한 박스면 어떨까"
 * — 주/일 모드로 타임라인을 옮기면 레포트 패널(ReportPanel)이 그 위치에 맞는 기간을 보여주는데
 * (D-017), 정작 타임라인 위에는 그 기간이 정확히 어디부터 어디까지인지 표시가 없었다. 레포트
 * 패널과 같은 시제 색(과거=회색/진행중=초록/미래=파랑, ReportPanel.TENSE_STYLE)으로 테두리
 * 박스를 그려서, 헤더~숙소 목록 전체를 관통하는 최상단 오버레이로 보이게 한다.
 *
 * 레이어: L1 = 실제 함수 import(periodToWindowHighlight) / L2 = 실제 소스 파일 계약.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { periodToWindowHighlight, periodToDateRange } from '../../src/domain/periodDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const DAY = 86_400_000;

// ══════════════════════════════════════════════════════════════════════════
// A. periodToWindowHighlight (L1)
// ══════════════════════════════════════════════════════════════════════════
describe('periodToWindowHighlight — 기간이 타임라인 창의 어디를 차지하는지 퍼센트로', () => {
  const now = new Date('2026-09-24T11:00:00Z').getTime(); // KST 9/24 20:00
  // ListView(PropertyListView)의 실제 창 계산과 동일하게: 오늘(KST) 자정 기준 -6일 ~ +14일 = 총 20일
  const todayMidnight = periodToDateRange('today', now).from;

  test('오늘(today) — 일 모드 타임라인 창 안에서 정확히 1/20칸(하루)을 가리킨다', () => {
    const windowStart = new Date(todayMidnight.getTime() - 6 * DAY);
    const windowMs = 20 * DAY;
    const result = periodToWindowHighlight('today', windowStart, windowMs, now);
    assert.ok(result);
    // 오늘은 창의 7번째 칸(0-indexed 6번째) → left = 6/20*100 = 30%
    assert.ok(Math.abs(result.left - 30) < 0.01, `left=${result.left}`);
    assert.ok(Math.abs(result.width - 5) < 0.01, `width=${result.width}`); // 하루 = 1/20 = 5%
  });

  test('이번주(this_week) — 주 전체(7일)만큼 너비를 차지한다', () => {
    const windowStart = new Date(todayMidnight.getTime() - 6 * DAY);
    const windowMs = 20 * DAY;
    const result = periodToWindowHighlight('this_week', windowStart, windowMs, now);
    assert.ok(result);
    assert.ok(Math.abs(result.width - 35) < 0.01, `width=${result.width}`); // 7일 = 7/20 = 35%
  });

  test('창을 완전히 벗어난 기간은 null (안 그림)', () => {
    const windowStart = new Date(todayMidnight.getTime() - 6 * DAY);
    const windowMs = 20 * DAY;
    // 아주 먼 과거 — 창보다 한참 앞
    const result = periodToWindowHighlight('weeks_ago_100', windowStart, windowMs, now);
    assert.equal(result, null);
  });

  test('창에 절반만 걸치면 보이는 부분만큼만 [0,100] 범위로 잘린다', () => {
    // 창이 이번 주 중간(오늘)부터 시작하도록 설정 — this_week의 앞쪽 절반이 창 밖
    const windowStart = todayMidnight;
    const windowMs = 20 * DAY;
    const result = periodToWindowHighlight('this_week', windowStart, windowMs, now);
    assert.ok(result);
    assert.equal(result.left, 0); // 창 시작보다 앞선 부분은 0으로 클램프
    assert.ok(result.width > 0 && result.width < 35);
  });

  test('windowMs가 0이면 null (0으로 나누기 방지)', () => {
    const result = periodToWindowHighlight('today', new Date(now), 0, now);
    assert.equal(result, null);
  });

  test('알 수 없는 기간 문자열이면 null', () => {
    const result = periodToWindowHighlight('not_a_period', new Date(now), 20 * DAY, now);
    assert.equal(result, null);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. PropertyListView 배선 (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('PropertyListView — 레포트 기간 하이라이트 박스 배선', () => {
  const src = read('src/components/v2/PropertyListView.jsx');

  test('periodToWindowHighlight로 좌표를 계산한다 (컴포넌트 안에서 직접 퍼센트 계산 X)', () => {
    assert.match(src, /import \{ periodForOffset, periodToWindowHighlight, describePeriod \} from '\.\.\/\.\.\/domain\/periodDomain\.js';/);
    assert.match(src, /periodToWindowHighlight\(statsPeriod, windowStart, windowMs\)/);
  });

  test('레포트 패널과 같은 시제 색(TENSE_STYLE)을 그대로 쓴다 — 통일성', () => {
    assert.match(src, /import \{ TENSE_STYLE \} from '\.\/reporting\/ReportPanel';/);
    assert.match(src, /const periodStyle = TENSE_STYLE\[periodTense\] \?\? TENSE_STYLE\.active;/);
  });

  test('하이라이트 박스는 헤더~목록 전체를 관통(top:0, bottom:0)하고 가장 앞(zIndex)에 오버레이된다', () => {
    const start = src.indexOf('레포트 기간 하이라이트');
    const end = src.indexOf(')}', start);
    const block = src.slice(start, end);
    assert.match(block, /top: 0, bottom: 0,/);
    assert.match(block, /border: `2px solid \$\{periodStyle\.label\}`,/);
    assert.match(block, /zIndex: 25/);
  });

  test('클릭/드래그를 가로채지 않는다 (pointerEvents: none)', () => {
    const start = src.indexOf('레포트 기간 하이라이트');
    const end = src.indexOf(')}', start);
    const block = src.slice(start, end);
    assert.match(block, /pointerEvents: 'none'/);
  });

  test('기간이 창 밖이면(null) 아예 렌더링하지 않는다', () => {
    assert.match(src, /\{periodHighlight && \(/);
  });

  test('새 코드는 다크 색을 재사용하지 않는다', () => {
    const FORBIDDEN = ['#02080d', '#030f18', '#0a1f2e', '#00d4ff', '#00ff88'];
    for (const c of FORBIDDEN) assert.ok(!src.toLowerCase().includes(c), c);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. ReportPanel — TENSE_STYLE export (L2)
// ══════════════════════════════════════════════════════════════════════════
describe('ReportPanel — TENSE_STYLE을 다른 화면이 재사용할 수 있게 export', () => {
  const src = read('src/components/v2/reporting/ReportPanel.jsx');

  test('TENSE_STYLE이 export되어 있다', () => {
    assert.match(src, /export const TENSE_STYLE = \{/);
  });

  test('past/active/future 세 시제 모두 label 색을 갖는다', () => {
    assert.match(src, /past:\s*\{[^}]*label:\s*'#475569'/);
    assert.match(src, /active:\s*\{[^}]*label:\s*'#065f46'/);
    assert.match(src, /future:\s*\{[^}]*label:\s*'#1e40af'/);
  });
});
