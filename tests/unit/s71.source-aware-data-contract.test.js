import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => readFileSync(path.join(ROOT, file), 'utf8');

describe('source-aware data contract', () => {
  test('reservation/job/event tables carry origin and traceability fields', () => {
    const migration = read('data/migrate-source-aware-data.sql');
    for (const field of ['data_origin', 'source_system', 'source_ref']) {
      assert.match(migration, new RegExp(field));
    }
    assert.match(migration, /CREATE TABLE IF NOT EXISTS property_reservations/);
    assert.match(migration, /UNIQUE \(property_id, reservation_uid\)/);
    assert.match(migration, /property_reservations_property_fk/);
    assert.match(migration, /cleaning_jobs_property_fk/);
    assert.match(migration, /cleaning_jobs_reservation_fk/);
  });

  test('seed contract writes only SIMULATED rows and keeps REAL rows untouched', () => {
    const seed = read('scripts/seed-simulated-data.mjs');
    assert.match(seed, /data_origin = 'SIMULATED'/);
    assert.match(seed, /VALUES \([^\n]*'SIMULATED'/);
    assert.match(seed, /REAL 행과 관계없는 데이터는 건드리지 않는다/);
    assert.match(seed, /cleaning_notifs는 생성하지 않는다/);
    assert.match(seed, /비파괴 upsert-only/);
    assert.match(seed, /data_origin !== 'SIMULATED'/);
    assert.match(seed, /FOR UPDATE/);
    assert.doesNotMatch(seed, /NODE_TLS_REJECT_UNAUTHORIZED/);
  });

  test('operational dispatch paths select REAL jobs only', () => {
    const cron = read('api/cron/[...slug].js');
    const cleaning = read('api/cleaning/[...slug].js');
    assert.ok((cron.match(/data_origin\s*=\s*'REAL'/g) ?? []).length >= 4);
    assert.match(cleaning, /시뮬레이션 일정은 외부 배정 발송을 하지 않습니다/);
    assert.match(cleaning, /data_origin='REAL'/);
  });
});
