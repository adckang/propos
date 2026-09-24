/**
 * s53 — 레포트 상세 목록의 숙소 이름 표시
 *
 * 사용자 요청 (2026-09-21): 레포트 패널에서 건수를 누르면 하단에 뜨는 "문제 있었던 숙소" 목록이
 * 숙소 이름 대신 P012 같은 ID를 보여준다 → 리스트 화면(ListView)에 표시되는 이름과 같게.
 *
 * 레이어: L1 = 실제 함수 import / L2 = 실제 소스 파일 계약(readFileSync).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { resolvePropertyName } from '../../src/domain/propertyNameDomain.js';
import { PROPERTIES } from '../../src/data/roomStateMockData.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ══════════════════════════════════════════════════════════════════════════
// A. resolvePropertyName — 리스트 화면 이름 우선
// ══════════════════════════════════════════════════════════════════════════
describe('resolvePropertyName', () => {
  const LIST = [{ id: 'P012', name: '개포 L호' }, { id: 'P013', name: '수서 M호' }];

  test('숙소 목록에 있으면 리스트 화면의 이름 (P012 → 개포 L호)', () => {
    assert.equal(resolvePropertyName(LIST, 'P012'), '개포 L호');
    assert.equal(resolvePropertyName(LIST, 'P013'), '수서 M호');
  });

  test('목록의 이름이 서버가 준 이름보다 우선한다', () => {
    assert.equal(resolvePropertyName(LIST, 'P012', 'DB에 저장된 이름'), '개포 L호');
  });

  test('목록에 없으면 서버가 준 이름, 그것도 없으면 ID', () => {
    assert.equal(resolvePropertyName(LIST, 'P999', '서버 이름'), '서버 이름');
    assert.equal(resolvePropertyName(LIST, 'P999'), 'P999');
    assert.equal(resolvePropertyName(LIST, 'P999', null), 'P999');
  });

  test('이름이 비어 있는 숙소는 서버 이름/ID 로 대체 (빈 글자를 보여주지 않는다)', () => {
    assert.equal(resolvePropertyName([{ id: 'P1', name: '' }], 'P1', '서버'), '서버');
    assert.equal(resolvePropertyName([{ id: 'P1' }], 'P1'), 'P1');
  });

  test('목록이 없거나 비어 있어도 안전 (ID 그대로)', () => {
    assert.equal(resolvePropertyName(undefined, 'P012'), 'P012');
    assert.equal(resolvePropertyName(null, 'P012'), 'P012');
    assert.equal(resolvePropertyName([], 'P012'), 'P012');
  });

  test('실제 목업 숙소 전부: ID → 리스트에 표시되는 이름', () => {
    for (const p of PROPERTIES) assert.equal(resolvePropertyName(PROPERTIES, p.id), p.name, p.id);
    assert.equal(resolvePropertyName(PROPERTIES, 'P012'), '개포 L호');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. 화면 배선 (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('지표 상세 목록 (DrilldownSheet)', () => {
  const src = read('src/components/v2/reporting/DrilldownSheet.jsx');

  test('숙소 이름 목록(properties)을 받는다', () => {
    assert.match(src, /onSelectRoom, properties = \[\]/);
  });

  test('항목에는 ID가 아니라 변환된 숙소 이름을 표시한다', () => {
    const row = read('src/components/v2/reporting/ViolationRow.jsx');
    // 행은 name 만 그린다 — property_id 를 글자로 출력하는 코드가 없어야 한다
    assert.ok(!/\{item\.property_id\}|\{property_id\}/.test(row), 'ViolationRow 가 property_id 를 그대로 출력함');
    assert.match(row, /\{name\}<\/span>/);
    assert.match(src, /<ViolationRow[\s\S]*?name=\{resolvePropertyName\(properties, item\.property_id\)\}/);
  });

  test('항목을 눌렀을 때 선택 콜백에는 ID 를 그대로 넘긴다 (상세 이동에 필요)', () => {
    assert.match(src, /onSelectRoom\?\.\(item\.property_id\)/);
  });
});

describe('숙소 이름 목록이 상세 목록까지 전달된다', () => {
  test('EventMatrixPanel → DrilldownSheet', () => {
    const src = read('src/components/v2/reporting/EventMatrixPanel.jsx');
    assert.match(src, /propertyIds, properties = \[\] \}/);
    assert.match(src, /properties=\{properties\}\s+onClose=\{\(\) => setDrilldown\(null\)\}/);
  });

  test('ReportPanel 과거 기간 → EventMatrixPanel', () => {
    const src = read('src/components/v2/reporting/ReportPanel.jsx');
    const line = src.split('\n').find(l => l.includes('<EventMatrixPanel'));
    assert.ok(line.includes('properties={properties}'), line);
  });

  test('ActiveHybridPanel 완료 섹션 → EventMatrixPanel', () => {
    const src = read('src/components/v2/reporting/ActiveHybridPanel.jsx');
    const start = src.indexOf('<EventMatrixPanel');
    assert.ok(src.slice(start, src.indexOf('/>', start)).includes('properties={properties}'));
  });

  test('FutureMatrixPanel 청소 배정 목록도 리스트 화면 이름 우선 (서버 이름은 보조)', () => {
    const src = read('src/components/v2/reporting/FutureMatrixPanel.jsx');
    assert.match(src, /name=\{resolvePropertyName\(properties, item\.property_id, item\.property_name\)\}/);
    assert.ok(!/\{item\.property_name \?\? item\.property_id\}/.test(src), 'ID/서버 이름을 직접 출력하는 코드가 남아 있음');
  });

  test('레포트 패널을 쓰는 모든 화면이 숙소 목록을 넘긴다', () => {
    for (const rel of [
      'src/components/v2/PropertyDetailView.jsx',
      'src/components/v2/reporting/SelectedPropertyReport.jsx',
    ]) {
      const src = read(rel);
      const start = src.indexOf('<ReportPanel');
      const tag = src.slice(start, src.indexOf('/>', start));
      assert.ok(/properties=/.test(tag), `${rel} 의 ReportPanel 에 properties 없음`);
    }
  });
});
