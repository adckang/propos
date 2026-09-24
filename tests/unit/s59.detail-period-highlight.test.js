/**
 * s59 — PropertyDetailView 세로 타임라인에도 ListView(s58/D-022)와 같은 레포트 기간 하이라이트
 *
 * 사용자 요청 (2026-09-24): "디테일뷰에서도. 똑같이 레포트에 해당하는 기간을 타임라인에
 * 박스쳐줘. 리스트뷰에서 한거랑 똑같이" — ListView는 가로 타임라인 + 퍼센트 좌표
 * (periodToWindowHighlight, D-022)였지만, DetailView는 세로 타임라인 + 픽셀 좌표(hourPx)라
 * 좌표 계산 방식 자체는 다르다. 대신 "그 기간이 정확히 어느 날짜/시각인지"는 같은 도메인 함수
 * (periodToDateRange)를 재사용하고, 시제 색(TENSE_STYLE)과 오버레이 방식(테두리+옅은 배경+
 * pointerEvents:none+최상단)은 동일하게 맞춘다.
 *
 * 부가: DetailView는 일 모드(오늘/전날/내일) 외에 시 모드(−1h/지금/+1h)도 있는데, 기존
 * periodToDateRange가 'next_hour'는 처리하면서 'last_hour'는 처리하지 않아 "−1h" 하이라이트가
 * 비어 있었다. 이번에 'last_hour'도 추가해 대칭을 맞췄다.
 *
 * 레이어: L1 = 실제 함수 import(periodToDateRange) / L2 = 실제 소스 파일 계약.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { periodToDateRange, describePeriod } from '../../src/domain/periodDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const HOUR = 3_600_000;

// ══════════════════════════════════════════════════════════════════════════
// A. periodToDateRange('last_hour') — 새로 추가한 대칭 케이스 (L1)
// ══════════════════════════════════════════════════════════════════════════
describe('periodToDateRange — last_hour (next_hour과 대칭)', () => {
  const now = new Date('2026-09-24T12:00:00Z').getTime();

  test('last_hour = [지금-1시간, 지금)', () => {
    const range = periodToDateRange('last_hour', now);
    assert.ok(range);
    assert.equal(range.from.getTime(), now - HOUR);
    assert.equal(range.to.getTime(), now);
  });

  test('next_hour = [지금+1분, 지금+1시간+1분) — 기존 동작 그대로 유지', () => {
    const range = periodToDateRange('next_hour', now);
    assert.ok(range);
    assert.equal(range.from.getTime(), now + 60_000);
    assert.equal(range.to.getTime(), now + HOUR + 60_000);
  });

  test("'now'는 여전히 null — 순간이라 구간이 없고, ReportPanel도 이 기간엔 아무것도 안 보여준다", () => {
    assert.equal(periodToDateRange('now', now), null);
  });

  test('describePeriod(last_hour).tense === past (색상 매핑에 씀)', () => {
    assert.equal(describePeriod('last_hour').tense, 'past');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. PropertyDetailView 배선 (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('PropertyDetailView — 레포트 기간 하이라이트 박스 배선', () => {
  const src = read('src/components/v2/PropertyDetailView.jsx');

  test('periodToDateRange로 기간의 날짜 범위를 구하고, 레포트 패널과 같은 시제 색을 쓴다', () => {
    assert.match(src, /import \{ periodForOffset, periodToDateRange, describePeriod \} from '\.\.\/\.\.\/domain\/periodDomain\.js';/);
    assert.match(src, /import ReportPanel, \{ TENSE_STYLE \} from '\.\/reporting\/ReportPanel';/);
    assert.match(src, /const periodRange = useMemo\(\(\) => periodToDateRange\(statsPeriod\), \[statsPeriod\]\);/);
    assert.match(src, /const periodStyle = TENSE_STYLE\[periodTense\] \?\? TENSE_STYLE\.active;/);
  });

  test('세로 타임라인이라 좌표는 hourPx 기반 픽셀(top/height)로 계산한다 — ListView의 퍼센트 방식과 다름', () => {
    const start = src.indexOf('const periodHighlightPx = useMemo(');
    const end = src.indexOf('}, [periodRange, windowStart, hourPx, containerHeight]);');
    assert.ok(start > 0 && end > start);
    const block = src.slice(start, end);
    assert.match(block, /\/ 3600000\) \* hourPx/);
    assert.match(block, /if \(bottom <= top\) return null;/);
  });

  test('하이라이트 박스는 좌우 전체 폭(left:0,right:0)을 덮고, 가장 앞(zIndex)에 오버레이되며 클릭을 가로채지 않는다', () => {
    const start = src.indexOf('헤더~타임라인 전체 폭을 관통');
    const end = src.indexOf(')}', start);
    assert.ok(start > 0 && end > start);
    const block = src.slice(start, end);
    assert.match(block, /left: 0, right: 0,/);
    assert.match(block, /border: `2px solid \$\{periodStyle\.label\}`,/);
    assert.match(block, /zIndex: 40, pointerEvents: 'none',/);
  });

  test('현재 시각(지금) 마커보다 먼저 렌더링된다 — 지금 선이 하이라이트 박스 위에 그대로 보임', () => {
    const highlightIdx = src.indexOf('헤더~타임라인 전체 폭을 관통');
    const nowMarkerIdx = src.indexOf('현재 시각 마커 — 선');
    assert.ok(highlightIdx > 0 && nowMarkerIdx > 0 && highlightIdx < nowMarkerIdx);
  });

  test('기간이 창(±7일) 밖이면 아예 렌더링하지 않는다', () => {
    assert.match(src, /\{periodHighlightPx && \(/);
  });

  test('새 코드는 다크 색을 재사용하지 않는다', () => {
    const FORBIDDEN = ['#02080d', '#030f18', '#0a1f2e', '#00d4ff', '#00ff88'];
    for (const c of FORBIDDEN) assert.ok(!src.toLowerCase().includes(c), c);
  });
});
