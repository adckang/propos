/**
 * s43 — 복수 숙소 stats 필터링 TC
 *
 * 검증 항목:
 *   A. parsePropertyIds  — src/application/statsQueryParser.js
 *      API query 파라미터 → propertyIds[] 변환 (순수 함수)
 *
 *   B. queryEvents (multi-property) — src/infrastructure/eventRepository.js
 *      null / 단건 string[] / 복수 string[] / 빈 배열 케이스
 *      mock db.query로 SQL 구조 검증
 *
 *   C. getStatsForPeriod (propertyIds 전달) — src/application/reportingService.js
 *      event-based 경로: propertyIds가 queryEvents로 올바르게 전달되는지
 *      집계 정확성: 선택된 숙소 이벤트만 카운트되는지
 *
 * 구현 전 전 그룹 FAIL. 구현 후 전부 PASS.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parsePropertyIds }  from '../../src/application/statsQueryParser.js';
import { queryEvents }       from '../../src/infrastructure/eventRepository.js';
import { getStatsForPeriod } from '../../src/application/reportingService.js';

// ══════════════════════════════════════════════════════════════════════════
// A. parsePropertyIds
//    계약:
//      - {} or { property_ids: '' } → null  (선택 없음 = 전체)
//      - { property_id: 'p1' }      → ['p1']  (하위 호환)
//      - { property_ids: 'p1,p2' }  → ['p1','p2']
//      - property_ids 가 있으면 property_id 무시
//      - 공백 trim, 빈 세그먼트 제거
// ══════════════════════════════════════════════════════════════════════════

describe('parsePropertyIds — null 반환 케이스', () => {

  test('파라미터 없음 → null', () => {
    assert.equal(parsePropertyIds({}), null);
  });

  test('property_ids="" (빈 문자열) → null', () => {
    assert.equal(parsePropertyIds({ property_ids: '' }), null);
  });

  test('property_ids="  " (공백만) → null', () => {
    assert.equal(parsePropertyIds({ property_ids: '   ' }), null);
  });

  test('property_ids=",,," (빈 세그먼트만) → null', () => {
    assert.equal(parsePropertyIds({ property_ids: ',,,' }), null);
  });
});

describe('parsePropertyIds — 하위 호환 (property_id 단건)', () => {

  test('{ property_id: "paju1" } → ["paju1"]', () => {
    assert.deepEqual(parsePropertyIds({ property_id: 'paju1' }), ['paju1']);
  });

  test('반환값이 배열임 (string 아님)', () => {
    const result = parsePropertyIds({ property_id: 'paju1' });
    assert.ok(Array.isArray(result));
  });
});

describe('parsePropertyIds — property_ids 복수', () => {

  test('단건 "paju1" → ["paju1"]', () => {
    assert.deepEqual(parsePropertyIds({ property_ids: 'paju1' }), ['paju1']);
  });

  test('"paju1,paju2" → ["paju1","paju2"]', () => {
    assert.deepEqual(parsePropertyIds({ property_ids: 'paju1,paju2' }), ['paju1', 'paju2']);
  });

  test('공백 포함 " paju1 , paju2 " → trim 후 ["paju1","paju2"]', () => {
    assert.deepEqual(parsePropertyIds({ property_ids: ' paju1 , paju2 ' }), ['paju1', 'paju2']);
  });

  test('빈 세그먼트 "paju1,,paju2" → ["paju1","paju2"]', () => {
    assert.deepEqual(parsePropertyIds({ property_ids: 'paju1,,paju2' }), ['paju1', 'paju2']);
  });

  test('property_id와 property_ids 동시 → property_ids 우선', () => {
    const result = parsePropertyIds({ property_id: 'old', property_ids: 'new1,new2' });
    assert.deepEqual(result, ['new1', 'new2']);
  });

  test('property_ids="" + property_id="p1" → null (빈 property_ids가 property_id 무효화)', () => {
    // property_ids 키가 존재하면 property_id는 무시된다.
    // property_ids가 빈 문자열이면 null — property_id 폴백 없음.
    assert.equal(parsePropertyIds({ property_id: 'p1', property_ids: '' }), null);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. queryEvents — mock db로 SQL 구조 검증
//    계약:
//      - null         → property 필터 없음 (전체 조회)
//      - ['p1']       → WHERE property_id = ANY($1), params[0]=['p1']
//      - ['p1','p2']  → WHERE property_id = ANY($1), params[0]=['p1','p2']
//      - []           → DB 호출 없이 [] 반환 (빈 선택 = 빈 결과)
// ══════════════════════════════════════════════════════════════════════════

const RANGE = {
  from: new Date('2026-09-07T00:00:00.000Z'),
  to:   new Date('2026-09-14T00:00:00.000Z'),
};

function makeMockDb(rows = []) {
  const calls = [];
  const db = {
    query: (sql, params) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows });
    },
    _calls: calls,
  };
  return db;
}

describe('queryEvents — propertyIds=null (전체 조회)', () => {

  test('DB 호출 1회, SQL에 property 필터 없음', async () => {
    const db = makeMockDb([]);
    await queryEvents(db, RANGE, null);
    assert.equal(db._calls.length, 1);
    assert.ok(!db._calls[0].sql.includes('ANY'), 'ANY 필터가 있으면 안 됨');
    assert.ok(!db._calls[0].sql.includes('property_id ='), 'property_id = 필터가 있으면 안 됨');
  });

  test('range.from, range.to가 파라미터에 포함됨', async () => {
    const db = makeMockDb([]);
    await queryEvents(db, RANGE, null);
    const params = db._calls[0].params;
    assert.ok(params.includes(RANGE.from), 'range.from 없음');
    assert.ok(params.includes(RANGE.to),   'range.to 없음');
  });
});

describe('queryEvents — propertyIds 단건 배열 ["paju1"]', () => {

  test('SQL에 ANY 필터 포함', async () => {
    const db = makeMockDb([]);
    await queryEvents(db, RANGE, ['paju1']);
    assert.ok(db._calls[0].sql.includes('ANY'), 'ANY 없음');
  });

  test('파라미터 첫 번째 인자 = ["paju1"]', async () => {
    const db = makeMockDb([]);
    await queryEvents(db, RANGE, ['paju1']);
    assert.deepEqual(db._calls[0].params[0], ['paju1']);
  });

  test('range.from = params[1], range.to = params[2]', async () => {
    const db = makeMockDb([]);
    await queryEvents(db, RANGE, ['paju1']);
    const p = db._calls[0].params;
    assert.deepEqual(p[1], RANGE.from, 'params[1] != range.from');
    assert.deepEqual(p[2], RANGE.to,   'params[2] != range.to');
  });
});

describe('queryEvents — propertyIds 복수 배열 ["paju1","paju2"]', () => {

  test('SQL에 ANY 필터 포함', async () => {
    const db = makeMockDb([]);
    await queryEvents(db, RANGE, ['paju1', 'paju2']);
    assert.ok(db._calls[0].sql.includes('ANY'), 'ANY 없음');
  });

  test('파라미터 첫 번째 인자 = ["paju1","paju2"]', async () => {
    const db = makeMockDb([]);
    await queryEvents(db, RANGE, ['paju1', 'paju2']);
    assert.deepEqual(db._calls[0].params[0], ['paju1', 'paju2']);
  });

  test('rows 반환 정상', async () => {
    const fixture = [{ id: 'e1', property_id: 'paju1', type: 'check_in_detected' }];
    const db = makeMockDb(fixture);
    const result = await queryEvents(db, RANGE, ['paju1', 'paju2']);
    assert.deepEqual(result, fixture);
  });
});

describe('queryEvents — propertyIds=[] (빈 배열)', () => {

  test('DB 호출 없이 빈 배열 반환', async () => {
    const db = makeMockDb([{ id: 'should-not-appear' }]);
    const result = await queryEvents(db, RANGE, []);
    assert.deepEqual(result, []);
    assert.equal(db._calls.length, 0, 'DB 호출이 있으면 안 됨');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. getStatsForPeriod — propertyIds 전달 및 집계 정확성
//    event-based 경로 (last_week — KV 미사용)
//
//    계약:
//      - propertyIds=['paju1'] → paju1 이벤트만 집계
//      - propertyIds=['paju1','paju2'] → 두 숙소 이벤트 합산
//      - propertyIds=null → 전체 집계 (기존 동작)
// ══════════════════════════════════════════════════════════════════════════

// 픽스처 이벤트
const PAJU1_EVENTS = [
  { property_id: 'paju1', type: 'check_out_detected',  is_soft: false },
  { property_id: 'paju1', type: 'check_out_detected',  is_soft: false },
  { property_id: 'paju1', type: 'check_in_detected',   is_soft: false },
];
const PAJU2_EVENTS = [
  { property_id: 'paju2', type: 'check_out_detected',  is_soft: false },
  { property_id: 'paju2', type: 'check_in_detected',   is_soft: false },
];
const ALL_EVENTS = [...PAJU1_EVENTS, ...PAJU2_EVENTS];

function makeEventDb(eventsByPropertyIds) {
  return {
    query: (_sql, params) => {
      // params[0] = propertyIds array or undefined (all)
      const ids = Array.isArray(params?.[0]) ? params[0] : null;
      const rows = ids
        ? ALL_EVENTS.filter(e => ids.includes(e.property_id))
        : ALL_EVENTS;
      return Promise.resolve({ rows });
    },
  };
}

// KV stub — last_week은 KV 불사용이므로 빈 stub
const STUB_KV = { keys: async () => [], get: async () => null };

describe('getStatsForPeriod — propertyIds 집계 검증', () => {

  test('propertyIds=null → 전체 이벤트 집계 (checkOuts=3)', async () => {
    const db = makeEventDb(null);
    const { stats } = await getStatsForPeriod('last_week', { db, kv: STUB_KV, propertyIds: null });
    assert.equal(stats.checkOuts, 3); // paju1(2) + paju2(1)
  });

  test('propertyIds=["paju1"] → paju1 이벤트만 집계 (checkOuts=2)', async () => {
    const db = makeEventDb(['paju1']);
    const { stats } = await getStatsForPeriod('last_week', { db, kv: STUB_KV, propertyIds: ['paju1'] });
    assert.equal(stats.checkOuts, 2);
  });

  test('propertyIds=["paju2"] → paju2 이벤트만 집계 (checkOuts=1)', async () => {
    const db = makeEventDb(['paju2']);
    const { stats } = await getStatsForPeriod('last_week', { db, kv: STUB_KV, propertyIds: ['paju2'] });
    assert.equal(stats.checkOuts, 1);
  });

  test('propertyIds=["paju1","paju2"] → 합산 (checkOuts=3, checkIns=2)', async () => {
    const db = makeEventDb(['paju1', 'paju2']);
    const { stats } = await getStatsForPeriod('last_week', { db, kv: STUB_KV, propertyIds: ['paju1', 'paju2'] });
    assert.equal(stats.checkOuts, 3);
    assert.equal(stats.checkIns,  2);
  });

  test('propertyIds=[] → stats 전 항목 0 (빈 선택)', async () => {
    const db = makeEventDb([]);
    const { stats } = await getStatsForPeriod('last_week', { db, kv: STUB_KV, propertyIds: [] });
    assert.equal(stats.checkOuts, 0);
    assert.equal(stats.checkIns,  0);
  });
});
