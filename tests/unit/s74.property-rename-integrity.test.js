import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renamePropertyId, RENAMED_TABLES } from '../../src/infrastructure/propertyRenameRepository.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => readFileSync(path.join(ROOT, file), 'utf8');

function fakeDb({ rowsByTable }) {
  const log = [];
  return {
    log,
    async connect() {
      return {
        release() {},
        async query(sql, params) {
          log.push(sql.trim().split('\n')[0]);
          if (/unnest/.test(sql)) return { rows: RENAMED_TABLES.map(n => ({ table_name: n })) };
          const count = sql.match(/SELECT COUNT\(\*\)::int AS n FROM (\w+)/);
          if (count) return { rows: [{ n: rowsByTable[count[1]] ?? 0 }] };
          if (/SELECT 1 FROM property_cleaning_config/.test(sql)) return { rows: [] };
          return { rows: [], rowCount: 0 }; // CASCADE 가 먼저 옮겼다고 가정: 이후 UPDATE 는 0행
        },
      };
    },
  };
}

describe('property rename integrity (D-031 후속)', () => {
  test('예약 테이블이 이전 대상에 포함되고 레지스트리가 먼저 바뀐다', () => {
    assert.ok(RENAMED_TABLES.includes('property_reservations'));
    assert.equal(RENAMED_TABLES[0], 'property_cleaning_config');
  });

  test('CASCADE 로 UPDATE rowCount 가 0이어도 사전 집계 기준으로 moved 를 보고한다', async () => {
    const db = fakeDb({ rowsByTable: { property_cleaning_config: 1, property_reservations: 4, cleaning_jobs: 3 } });
    const res = await renamePropertyId(db, '구이름', '새이름');
    assert.equal(res.moved.property_reservations, 4);
    assert.equal(res.moved.cleaning_jobs, 3);
  });

  test('FK 는 ON UPDATE CASCADE (스키마·마이그레이션 모두)', () => {
    const schema = read('data/schema-cleaning.sql');
    assert.equal((schema.match(/ON UPDATE CASCADE/g) || []).length, 3);
    const mig = read('data/migrate-property-fk-cascade.sql');
    for (const name of ['property_reservations_property_fk', 'cleaning_jobs_property_fk', 'cleaning_jobs_reservation_fk',
      'property_calendar_blockers_property_fk', 'events_property_fk']) {
      assert.match(mig, new RegExp(name));
    }
    assert.match(read('data/migrate-source-aware-data.sql'), /ON UPDATE CASCADE NOT VALID/);
    // 복합 FK 는 CASCADE 순서 때문에 검사를 미뤄야 하고, 레거시 고아 uid 는 보존 후 비운다
    assert.match(mig, /cleaning_jobs_reservation_fk[^\n]*DEFERRABLE INITIALLY DEFERRED/);
    assert.match(schema, /ON UPDATE CASCADE\s+DEFERRABLE INITIALLY DEFERRED/);
    assert.match(mig, /legacy_reservation_uid:/);
    // 기존 source_ref 가 있어도 uid 를 잃지 않도록 이어붙여야 한다 (COALESCE(source_ref, …) 는 uid 를 버린다)
    assert.match(mig, /COALESCE\(j\.source_ref \|\| ' \| ', ''\) \|\| 'legacy_reservation_uid:'/);
  });
});

describe('monthly_summaries 폐기 (D-032 후속)', () => {
  test('이름 변경 대상·스키마에 더 이상 없고, 폐기 마이그레이션은 행이 있으면 중단한다', () => {
    assert.ok(!RENAMED_TABLES.includes('monthly_summaries'));
    assert.ok(!/monthly_summaries/.test(read('data/schema.sql')));
    const mig = read('data/migrate-drop-monthly-summaries.sql');
    assert.match(mig, /RAISE EXCEPTION/);
    assert.ok(!/DROP TABLE[^;]*CASCADE/i.test(mig), 'CASCADE 로 의존 객체를 같이 지우면 안 됨');
  });
});
