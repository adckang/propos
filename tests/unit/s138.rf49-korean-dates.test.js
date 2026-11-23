/**
 * RF-49 (DEC-14) — 사람에게 보이는 청소 날짜는 한국 날짜 하나의 규칙.
 * 국제 표준시(UTC) 날짜를 자르면 한국 시각 0~9시에 시작하는 청소가 하루 앞 날짜로 보인다.
 * 동작은 s11·s13·s30이 확인하고, 이 파일은 화면이 열릴 때 도는 후속 처리(runFollowupChecks)처럼 동작 시험이 없는 곳까지 막는다.
 * 담당자가 "그날" 다른 청소가 있는지 비교하는 세 곳은 양쪽이 같은 기준이어야 해서 따로 다룬다(RF-51).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

for (const path of ['api/cleaning/[...slug].js', 'api/cron/[...slug].js', 'server/cleaning/_dispatch.js']) {
  test(`${path}: 청소 시작 날짜를 UTC로 자르지 않는다`, () => {
    assert.doesNotMatch(read(path), /(cleaning_start_at|expiration\))\)\.toISOString\(\)\.(slice|substring|split)\(/);
  });
}

test('화면이 열릴 때 도는 후속 처리의 "배정 실패" 알림도 한국 날짜', () => {
  const api = read('api/cleaning/[...slug].js');
  const block = api.slice(api.indexOf('async function runFollowupChecks'), api.indexOf('async function listJobs'));
  assert.match(block, /const date = toKstDateKey\(job\.cleaning_start_at\);\s*await postSlack\(/);
});
