/**
 * s73 — Pi/로컬/Vercel 데이터 경계 계약 (2026-10-12)
 *
 * Pi는 Home Assistant 워처 메타데이터와 상태/이벤트를 제공하고, 예약·청소 일정은
 * Postgres API가 유일한 정본이다. 로컬 Vite는 같은 운영 API로 중계한다.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import '../helpers/isolateDataDir.js';
// 저장소 소스 계약을 읽는 테스트도 실제 data/를 건드리지 않는다는 공통 보증을 유지한다.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

describe('Pi watcher metadata store', () => {
  const src = read('server/propertiesStore.js');

  test('Pi 저장소는 예약/iCal 필드를 제거하고 워처 메타데이터만 반환한다', () => {
    assert.match(src, /function toWatcherProperty\(property\)/);
    assert.match(src, /id: id \|\| name/);
    assert.match(src, /watcherId: property\.watcherId \?\? property\.watcher_id \?\? null/);
    assert.match(src, /devices: property\.devices && typeof property\.devices === 'object'/);
    assert.doesNotMatch(src, /ical_url|airbnbIcalUrl|reservations|cleaning_jobs/);
  });

  test('PUT/GET 경계는 Pi 파일을 거쳐도 동일한 정규화 함수를 사용한다', () => {
    assert.match(src, /data\.map\(toWatcherProperty\)\.filter\(Boolean\)/);
    assert.match(src, /properties\.map\(toWatcherProperty\)\.filter\(Boolean\)/);
  });
});

describe('local Vite API routing', () => {
  const src = read('vite.config.mjs');

  test('숙소 메타데이터도 운영 API로 중계하며 로컬 워처를 시작하지 않는다', () => {
    assert.match(src, /'\/api': \{ target: 'https:\/\/www\.proposonline\.com'/);
    assert.doesNotMatch(src, /occupancyWatcher|startWatcher/);
  });

  test('로컬은 별도 cleaning handler나 DB 연결·토큰 설정을 읽지 않는다', () => {
    assert.doesNotMatch(src, /import\('\.\/api\/cleaning\/\[\.\.\.slug\]\.js'\)|POSTGRES_URL|GOOGLE_/);
  });
});

describe('Pi 오프라인 격리', () => {
  const src = read('api/properties.js');

  test('Pi URL이 없어도 GET은 빈 메타데이터로 응답해 DB 화면을 실패시키지 않는다', () => {
    assert.match(src, /if \(!WATCHER_URL\) \{\s*\n\s*if \(req\.method === 'GET'\) return sendJson\(res, 200, \[\]\);/);
  });
});

describe('Pi standalone watcher boundary', () => {
  const src = read('scripts/occupancy-watcher-standalone.mjs');

  test('standalone watcher는 숙소 예약을 직접 동기화하지 않는다', () => {
    assert.match(src, /watcher metadata|워처 메타데이터/);
    assert.doesNotMatch(src, /airbnbIcalUrl|googleCalIcalUrl|syncAirbnbReservations|property_reservations/);
  });
});
