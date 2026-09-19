/**
 * s46 — ListView 숙소 선택 → 레포트 집계 범위 TC
 *
 * 검증 대상: src/domain/selectionScopeDomain.js (실제 함수 import — L1)
 *   A. deriveSelectionScope   — 전체 / 1개 / 복수 / 해제(없음) 판정과 propertyIds 계약
 *   B. toggleAllSelection     — ALL 체크박스 토글
 *   C. syncSelectionWithProperties — 숙소 목록 갱신 시 선택 유지 규칙
 *      (회귀: 전체 해제 후 목록이 새 참조로 갱신돼도 다시 전체 선택되면 안 됨)
 *   D. PropertyListView 배선 (L2 — 소스 계약): 도메인 함수를 실제로 사용하는가
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  deriveSelectionScope,
  toggleAllSelection,
  syncSelectionWithProperties,
} from '../../src/domain/selectionScopeDomain.js';

const ALL = ['P1', 'P2', 'P3', 'P4'];

// ══════════════════════════════════════════════════════════════════════════
// A. deriveSelectionScope
// ══════════════════════════════════════════════════════════════════════════
describe('deriveSelectionScope — 전체 선택', () => {
  test('전부 선택 → mode all, propertyIds null (필터 없음)', () => {
    const s = deriveSelectionScope(new Set(ALL), ALL);
    assert.equal(s.mode, 'all');
    assert.equal(s.propertyIds, null);
    assert.equal(s.selectedCount, 4);
    assert.equal(s.totalCount, 4);
  });

  test('배열 입력도 Set과 동일하게 처리', () => {
    assert.equal(deriveSelectionScope(ALL, ALL).mode, 'all');
  });
});

describe('deriveSelectionScope — 1개 선택', () => {
  test('1개 → mode partial, propertyIds [id]', () => {
    const s = deriveSelectionScope(new Set(['P2']), ALL);
    assert.equal(s.mode, 'partial');
    assert.deepEqual(s.propertyIds, ['P2']);
    assert.equal(s.selectedCount, 1);
  });
});

describe('deriveSelectionScope — 복수 선택', () => {
  test('2개/3개 → partial, 선택한 숙소만 포함', () => {
    assert.deepEqual(deriveSelectionScope(new Set(['P1', 'P3']), ALL).propertyIds, ['P1', 'P3']);
    assert.deepEqual(deriveSelectionScope(new Set(['P1', 'P2', 'P4']), ALL).propertyIds, ['P1', 'P2', 'P4']);
  });

  test('선택 순서와 무관하게 propertyIds는 목록(allIds) 순서 — 같은 선택은 같은 키', () => {
    const a = deriveSelectionScope(new Set(['P3', 'P1']), ALL).propertyIds;
    const b = deriveSelectionScope(new Set(['P1', 'P3']), ALL).propertyIds;
    assert.deepEqual(a, b);
    assert.equal(a.join(','), b.join(','));
  });

  test('전체보다 1개 적으면 partial (all 아님)', () => {
    assert.equal(deriveSelectionScope(new Set(['P1', 'P2', 'P3']), ALL).mode, 'partial');
  });
});

describe('deriveSelectionScope — 선택 해제(없음)', () => {
  test('빈 선택 → mode none, propertyIds [] (전체로 복귀하면 안 됨)', () => {
    const s = deriveSelectionScope(new Set(), ALL);
    assert.equal(s.mode, 'none');
    assert.deepEqual(s.propertyIds, []);
    assert.equal(s.selectedCount, 0);
  });

  test('숙소 목록이 비어 있어도 none', () => {
    assert.equal(deriveSelectionScope(new Set(), []).mode, 'none');
  });
});

describe('deriveSelectionScope — 사라진 숙소(stale ID) 방어', () => {
  test('목록에 없는 ID만 선택돼 있으면 none', () => {
    const s = deriveSelectionScope(new Set(['GONE']), ALL);
    assert.equal(s.mode, 'none');
    assert.deepEqual(s.propertyIds, []);
  });

  test('stale ID가 섞여 개수가 같아도 전체로 오판하지 않음', () => {
    // 개수(4)만 비교하면 all로 오판 — 유효 선택은 3개뿐
    const s = deriveSelectionScope(new Set(['P1', 'P2', 'P3', 'GONE']), ALL);
    assert.equal(s.mode, 'partial');
    assert.deepEqual(s.propertyIds, ['P1', 'P2', 'P3']);
    assert.equal(s.selectedCount, 3);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. toggleAllSelection
// ══════════════════════════════════════════════════════════════════════════
describe('toggleAllSelection — ALL 체크박스', () => {
  test('all → 전체 해제', () => {
    assert.equal(toggleAllSelection('all', ALL).size, 0);
  });

  test('none → 전체 선택', () => {
    assert.deepEqual([...toggleAllSelection('none', ALL)], ALL);
  });

  test('partial → 전체 선택', () => {
    assert.deepEqual([...toggleAllSelection('partial', ALL)], ALL);
  });

  test('all → none → all 왕복', () => {
    let sel = new Set(ALL);
    sel = toggleAllSelection(deriveSelectionScope(sel, ALL).mode, ALL);
    assert.equal(deriveSelectionScope(sel, ALL).mode, 'none');
    sel = toggleAllSelection(deriveSelectionScope(sel, ALL).mode, ALL);
    assert.equal(deriveSelectionScope(sel, ALL).mode, 'all');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. syncSelectionWithProperties
// ══════════════════════════════════════════════════════════════════════════
describe('syncSelectionWithProperties — 사용자 선택 유지 (회귀)', () => {
  test('전체 해제 후 같은 목록이 새 참조로 갱신돼도 선택은 비어 있다', () => {
    const known = new Set(ALL);
    const selected = new Set(); // 사용자가 전체 해제
    const next = syncSelectionWithProperties(selected, known, [...ALL]);
    assert.equal(next.size, 0);
  });

  test('일부만 해제한 상태도 목록 갱신 시 그대로 유지', () => {
    const known = new Set(ALL);
    const selected = new Set(['P1', 'P2']);
    const next = syncSelectionWithProperties(selected, known, [...ALL]);
    assert.deepEqual([...next].sort(), ['P1', 'P2']);
  });

  test('변경이 없으면 입력 Set과 같은 참조 반환 (재렌더 루프 방지)', () => {
    const known = new Set(ALL);
    const selected = new Set(['P1', 'P3']);
    assert.equal(syncSelectionWithProperties(selected, known, [...ALL]), selected);
  });
});

describe('syncSelectionWithProperties — 신규/삭제 숙소', () => {
  test('처음 보는 숙소(iCal 동기화 후 LIVE_001)는 자동 선택', () => {
    const known = new Set(ALL);
    const selected = new Set(ALL);
    const next = syncSelectionWithProperties(selected, known, ['LIVE_001', ...ALL]);
    assert.ok(next.has('LIVE_001'));
    assert.equal(next.size, 5);
  });

  test('전체 해제 상태에서 신규 숙소가 오면 신규만 선택 (기존 숙소는 해제 유지)', () => {
    const known = new Set(ALL);
    const next = syncSelectionWithProperties(new Set(), known, ['LIVE_001', ...ALL]);
    assert.deepEqual([...next], ['LIVE_001']);
  });

  test('사라진 숙소는 선택에서 제거', () => {
    const known = new Set(ALL);
    const next = syncSelectionWithProperties(new Set(['P1', 'P4']), known, ['P1', 'P2', 'P3']);
    assert.deepEqual([...next], ['P1']);
  });

  test('한번 알려진 숙소는 목록에서 빠졌다 돌아와도 신규가 아님을 known으로 판단 (호출자가 known 관리)', () => {
    // known에 P4가 남아 있으면 돌아온 P4는 자동 선택되지 않는다
    const known = new Set(ALL);
    const next = syncSelectionWithProperties(new Set(['P1']), known, ['P1', 'P4']);
    assert.deepEqual([...next], ['P1']);
  });
});

describe('시나리오 — 전체 → 1개 → 복수 → 해제 → 전체 (범위 전이)', () => {
  test('propertyIds 가 각 단계에서 계약대로 전이', () => {
    let sel = new Set(ALL);
    const modeOf = () => deriveSelectionScope(sel, ALL);

    assert.equal(modeOf().propertyIds, null);                       // 전체

    sel = toggleAllSelection(modeOf().mode, ALL);                   // 전체 해제
    assert.deepEqual(modeOf().propertyIds, []);

    sel.add('P2');                                                  // 1개
    assert.deepEqual(modeOf().propertyIds, ['P2']);

    sel.add('P4');                                                  // 2개
    assert.deepEqual(modeOf().propertyIds, ['P2', 'P4']);

    sel.add('P1');                                                  // 3개
    assert.deepEqual(modeOf().propertyIds, ['P1', 'P2', 'P4']);

    sel.add('P3');                                                  // 4개 = 전체
    assert.equal(modeOf().propertyIds, null);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. PropertyListView 배선 (L2 — 소스 계약)
// ══════════════════════════════════════════════════════════════════════════
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const listViewSrc = readFileSync(path.join(ROOT, 'src/components/v2/PropertyListView.jsx'), 'utf8');

describe('PropertyListView — selectionScopeDomain 배선', () => {
  test('selectionScopeDomain 함수 3종을 import한다', () => {
    assert.match(listViewSrc, /from '\.\.\/\.\.\/domain\/selectionScopeDomain\.js'/);
    for (const fn of ['deriveSelectionScope', 'toggleAllSelection', 'syncSelectionWithProperties']) {
      assert.ok(listViewSrc.includes(fn), `${fn} 미사용`);
    }
  });

  test('propertyIds는 scope.propertyIds에서 온다 (인라인 재계산 금지)', () => {
    assert.match(listViewSrc, /statsPropertyIds\s*=\s*scope\.propertyIds/);
    assert.ok(!/selectedRooms\.size\s*===\s*properties\.length/.test(listViewSrc),
      '개수 비교로 전체 여부를 판단하는 인라인 로직이 남아 있음');
  });

  test('선택 없음이면 useReportingStats에 period=null 전달 (fetch 스킵, 전체로 복귀 금지)', () => {
    assert.match(listViewSrc, /useReportingStats\(\s*noSelection\s*\?\s*null\s*:\s*statsPeriod/);
  });
});
