/**
 * s82 — 숙소 목록 API(GET /api/cleaning/properties)의 예약별 청소 상태(reservations[].cleaningStatus).
 *
 * 배경(2026-10-30): Airbnb iCal이 같은 예약을 다른 uid로 다시 내보내 예약 행이 중복되자, uid로만 청소 일정을
 * 찾던 디테일뷰가 한쪽을 "미배정"으로 보였다 → 체크아웃 날짜로 찾게 고쳤다.
 * RF-33(2026-11-18): 그 날짜가 UTC 날짜였다. 나머지 코드는 한국 날짜라, 숙소 체크아웃 시각을 바꾸면
 * 디테일뷰만 다른 결과를 냈다 → 한국 날짜로 통일.
 *
 * ACT-08 ⑦-1: 예전엔 소스 글자만 검사했다. 이제 실제 청소 API 핸들러를 실행해 그 핸들러가 보내는 SQL과
 * 응답을 확인한다(DB·외부 I/O만 가짜). 날짜 매칭의 실제 SQL 결과는 격리 DB 시험
 * tests/integration/s82.property-cleaning-status-sql.test.js 가 확인한다(PGlite 필요, CI 밖).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';

async function properties(t, rows) {
  const f = await cleaningDeclineFixture({ responses: [rows] });
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'all scripted DB results consumed');
      assert.deepEqual(f.unexpectedQueries, [], 'no hidden unexpected SQL');
      assert.deepEqual(f.blocked, [], 'no unmocked external I/O');
      assert.deepEqual(f.errors, [], 'no hidden handler errors');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  const cookie = 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' });
  const res = await f.invoke({ method: 'GET', url: '/api/cleaning/properties', headers: { cookie } });
  const lateral = f.queries[0]?.sql.match(/LEFT JOIN LATERAL \(([\s\S]*?)\) j ON true/)?.[1] ?? '';
  return { res, f, lateral };
}

describe('actual listProperties — reservation cleaning status lookup', () => {
  test('one query per request; reservations come back exactly as the database built them', async t => {
    const row = { property_id: 'p1', name: 'Fixture Stay', ical_configured: true,
      reservations: [{ uid: 'r1', checkOut: '2026-12-06T02:00:00Z', cleaningStatus: 'ASSIGNED', cleanerName: 'Fixture Cleaner' }] };
    const { res, f } = await properties(t, [row]);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, [row]);
    assert.equal(f.queries.length, 1);
  });

  test('the cleaning job is found by the checkout day in Korea, not by reservation uid or UTC day (RF-33)', async t => {
    const { lateral } = await properties(t, []);
    assert.match(lateral, /to_char\(cj\.checkout_at AT TIME ZONE 'Asia\/Seoul', 'YYYY-MM-DD'\)\s*=\s*to_char\(r\.check_out AT TIME ZONE 'Asia\/Seoul', 'YYYY-MM-DD'\)/);
    assert.doesNotMatch(lateral, /AT TIME ZONE 'UTC'/);
    assert.doesNotMatch(lateral, /cj\.reservation_uid\s*=\s*r\.reservation_uid/);
  });

  test('the lookup stays inside the same property and takes the most recently updated job', async t => {
    const { lateral } = await properties(t, []);
    assert.match(lateral, /cj\.property_id = r\.property_id/);
    assert.match(lateral, /ORDER BY cj\.updated_at DESC\s+LIMIT 1/);
  });

  test("each reservation still reports its own uid, the job status, cleaner and cleaning times", async t => {
    const { f } = await properties(t, []);
    const sql = f.queries[0].sql;
    for (const field of ["'uid', r.reservation_uid", "'cleaningStatus', j.status", "'cleanerName', c.name",
      "'cleaningAt', j.cleaning_start_at", "'cleaningEnd', j.cleaning_end_at"]) {
      assert.ok(sql.includes(field), field);
    }
  });
});
