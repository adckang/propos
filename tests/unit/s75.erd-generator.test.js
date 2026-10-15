import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, cardinality, renderPlantUml, renderDrawio, CATALOG_SQL } from '../../scripts/lib/erdModel.mjs';

// 픽스처: parent(id PK) ← child(parent_id NOT NULL) / opt(parent_id NULL, UNIQUE) / link(a,b 복합 UQ → 연결 테이블)
const col = (table, column, type, not_null) => ({ table, column, type, not_null });
const catalog = {
  columns: [
    col('parent', 'id', 'text', true), col('parent', 'name', 'text', true),
    col('child', 'id', 'uuid', true), col('child', 'parent_id', 'text', true), col('child', 'memo', 'text', false),
    col('opt', 'id', 'uuid', true), col('opt', 'parent_id', 'text', false),
    col('other', 'id', 'uuid', true),
    col('link', 'id', 'uuid', true), col('link', 'child_id', 'uuid', true), col('link', 'other_id', 'uuid', true),
    col('orphan', 'k', 'text', true), col('orphan', 'parent_id', 'text', true),
  ],
  constraints: [
    { table: 'parent', name: 'parent_pkey', contype: 'p', cols: ['id'] },
    { table: 'child', name: 'child_pkey', contype: 'p', cols: ['id'] },
    { table: 'child', name: 'child_fk', contype: 'f', cols: ['parent_id'], ref_table: 'parent', ref_cols: ['id'], on_update: 'c', on_delete: 'a', deferrable: false, validated: true },
    { table: 'opt', name: 'opt_pkey', contype: 'p', cols: ['id'] },
    { table: 'opt', name: 'opt_fk', contype: 'f', cols: ['parent_id'], ref_table: 'parent', ref_cols: ['id'], on_update: 'a', on_delete: 'c', deferrable: true, validated: false },
    { table: 'opt', name: 'opt_uq', contype: 'u', cols: ['parent_id'] },
    { table: 'other', name: 'other_pkey', contype: 'p', cols: ['id'] },
    { table: 'link', name: 'link_pkey', contype: 'p', cols: ['id'] },
    { table: 'link', name: 'link_uq', contype: 'u', cols: ['child_id', 'other_id'] },
    { table: 'link', name: 'link_fk1', contype: 'f', cols: ['child_id'], ref_table: 'child', ref_cols: ['id'], on_update: 'a', on_delete: 'a', deferrable: false, validated: true },
    { table: 'link', name: 'link_fk2', contype: 'f', cols: ['other_id'], ref_table: 'other', ref_cols: ['id'], on_update: 'a', on_delete: 'a', deferrable: false, validated: true },
  ],
  uniqueIndexes: [],
};
const cfg = (row, col_) => ({ label: '', color: '#fff', row, col: col_ });
const config = {
  tables: { parent: cfg(0, 0), child: cfg(1, 0), opt: cfg(1, 1), other: cfg(1, 2), link: cfg(2, 0), orphan: cfg(3, 0) },
  logicalRelations: [{ from: 'parent', fromCols: ['id'], to: 'orphan', toCols: ['parent_id'], note: 'FK 없음' }],
};
const model = buildModel(catalog, config);
const fk = (t, name) => model.tables.get(t).fks.find((f) => f.name === name);

describe('ERD 생성기 — 카디널리티는 규칙으로 도출', () => {
  test('NOT NULL FK + 유니크 없음 → 부모 1 : 자식 N', () => {
    const c = cardinality(model, fk('child', 'child_fk'));
    assert.deepEqual([c.parentSym, c.childSym], ['||', 'o{']);
  });
  test('nullable FK + 그 칼럼 UNIQUE → 0..1 : 0..1 (선택적 1:1)', () => {
    const c = cardinality(model, fk('opt', 'opt_fk'));
    assert.deepEqual([c.parentSym, c.childSym], ['|o', 'o|']);
  });
  test('연결 테이블: 부모 2개를 가리키고 FK 칼럼 합집합이 복합 유니크', () => {
    assert.equal(model.tables.get('link').isJunction, true);
    assert.equal(model.tables.get('child').isJunction, false);
  });
  test('논리 관계는 logical 로 표시, 진짜 FK 와 구분', () => {
    assert.equal(model.tables.get('orphan').fks[0].logical, true);
  });
  test('config 와 DB 가 어긋나면 경고', () => {
    const m = buildModel(catalog, { tables: { parent: cfg(0, 0), ghost: cfg(0, 1) }, logicalRelations: [] });
    assert.ok(m.warnings.some((w) => w.includes('config 에 없는 테이블: child')));
    assert.ok(m.warnings.some((w) => w.includes('DB 에 없는 테이블: ghost')));
  });
  test('논리 관계가 진짜 FK 로 대체되면 안내', () => {
    const withFk = { ...catalog, constraints: [...catalog.constraints, { table: 'orphan', name: 'o_fk', contype: 'f', cols: ['parent_id'], ref_table: 'parent', ref_cols: ['id'], on_update: 'a', on_delete: 'a', deferrable: false, validated: true }] };
    assert.ok(buildModel(withFk, config).warnings.some((w) => w.includes('실제 FK')));
  });
});

describe('ERD 생성기 — 출력', () => {
  const uml = renderPlantUml(model, { detail: 'summary' });
  const full = renderPlantUml(model, { detail: 'full' });

  test('배치 규칙: 부모보다 아래 행이면 down, 같은 행이면 right', () => {
    assert.match(uml, /parent \|\|-down-o\{ child/);
    assert.match(uml, /child \|\|-down-o\{ link/);
  });
  test('논리 관계는 점선', () => assert.match(uml, /parent \|\|\.down\.o\{ orphan/));
  test('요약은 키 칼럼만, 전체는 모든 칼럼', () => {
    assert.ok(!uml.includes('memo : text'));
    assert.ok(full.includes('memo : text'));
  });
  test('요약에도 PK·FK·UQ 표식이 있다', () => {
    assert.match(uml, /\* id : uuid {2}● PK/);
    assert.match(uml, /◆ FK → parent/);
    assert.match(uml, /◇ UQ/);
  });
  test('규칙 문구: 전체는 ON UPDATE 표기, 요약은 예외(삭제연쇄·지연·미검증)만', () => {
    assert.match(full, /ON UPDATE CASCADE/);
    assert.ok(!uml.includes('ON UPDATE CASCADE'));
    assert.match(uml, /ON DELETE CASCADE · DEFERRABLE · NOT VALID/);
  });
  test('"…" 로 시작 (".." 로 시작하면 PlantUML 이 구분선으로 해석)', () => {
    assert.ok(!/^\s+\.\. 그 밖의/m.test(uml));
  });
  test('같은 입력 → 같은 출력 (드리프트 검사 가능)', () => {
    assert.equal(renderPlantUml(model, { detail: 'summary' }), uml);
  });
  test('draw.io: 유효한 구조, 엣지가 상자 id 에 연결, 논리 관계는 dashed', () => {
    const x = renderDrawio(model, { detail: 'summary' });
    assert.match(x, /<mxfile/);
    assert.match(x, /source="t_parent" target="t_child"/);
    assert.match(x, /dashed=1/);
    const ids = [...x.matchAll(/ id="(t_\w+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('ERD 생성기 — 카탈로그 SQL 계약', () => {
  test('읽기 전용 (SELECT 만)', () => {
    for (const sql of Object.values(CATALOG_SQL)) assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i.test(sql));
  });
  test('칼럼 배열은 text[] 로 캐스팅 (pg 가 name[] 을 문자열로 돌려주는 문제)', () => {
    assert.match(CATALOG_SQL.constraints, /attname::text/);
  });
});
