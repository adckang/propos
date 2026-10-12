/**
 * s68 — 실제 캘린더 입력 경로 일원화 계약 (2026-10-12)
 *
 * Postgres(property_cleaning_config + property_reservations + cleaning_jobs)가 예약과
 * 청소 일정의 정본이고, 브라우저는 서버 동기화 API를 호출한 뒤 DB를 읽는다. Pi는
 * 워처 메타데이터만 제공한다. 이 테스트는 두 환경(local/Vercel)이 같은 경로를 쓰는지
 * 소스 계약으로 고정한다.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('RoomStateApp.jsx — Postgres 정본과 단일 서버 iCal 동기화 경로', () => {
  const src = read('src/components/v2/RoomStateApp.jsx');

  test('fetchCloudProperties가 캐시를 우회해 운영 DB 숙소 행을 읽는다', () => {
    const start = src.indexOf('async function fetchCloudProperties');
    const end = src.indexOf('\n}', start);
    const block = src.slice(start, end);
    assert.match(block, /fetch\('\/api\/cleaning\/properties', \{ cache: 'no-store' \}\)/);
    assert.match(block, /catch \{\s*\n\s*return \[\];/);
  });

  test('마운트 시 REAL 행만 사용하고 정규 ID+iCal 행을 최우선 선택한다', () => {
    const start = src.indexOf('const realRows = cloudRows.filter');
    const end = src.indexOf('const piCfg =', start);
    const block = src.slice(start, end);
    assert.match(block, /cloudRows\.filter\(row => row\.data_origin === 'REAL'\)/);
    assert.match(block, /realRows\.find\(row => row\.property_id === row\.name && row\.ical_url\)/);
    assert.match(block, /\?\? realRows\.find\(row => row\.ical_url\)/);
    assert.match(block, /\?\? realRows\.find\(row => row\.property_id === row\.name\)/);
  });

  test('cloudRowToConfig가 property_cleaning_config 컬럼을 로컬 설정 모양으로 옮긴다', () => {
    const start = src.indexOf('function cloudRowToConfig');
    const end = src.indexOf('\n}', start);
    const block = src.slice(start, end);
    assert.match(block, /id:\s*row\.property_id/);
    assert.match(block, /name:\s*row\.name/);
    assert.match(block, /airbnbIcalUrl:\s*row\.ical_url \|\| ''/);
    assert.match(block, /checkOutHour:\s*row\.checkout_hour \?\? 11/);
    assert.match(block, /cleaningDurationHours:\s*row\.cleaning_duration_hours \?\? 2\.5/);
  });

  test('Pi 메타데이터는 DB 정본 행과 ID/이름으로만 결합한다', () => {
    const start = src.indexOf('const piCfg =');
    const end = src.indexOf('const cloudRow =', start);
    const block = src.slice(start, end);
    assert.match(block, /list\.find\(item => item\.id === canonicalReal\.property_id \|\| item\.name === canonicalReal\.name\)/);
  });

  test('최초 화면은 마지막 DB 행을 즉시 표시하고, 원본 동기화 실패로 숙소를 숨기지 않는다', () => {
    const start = src.indexOf('const cloudRow = canonicalReal ?? null;');
    const end = src.indexOf('// 청소 DB 백필', start);
    const block = src.slice(start, end);
    assert.match(block, /setLiveProperty\(cloudRowToLiveProperty\(canonicalReal\)\)/);
  });

  test('runSync는 브라우저 iCal 파서가 아니라 서버 API를 호출하고 DB를 다시 읽는다', () => {
    const start = src.indexOf('const runSync = useCallback');
    const end = src.indexOf('\n  }, [refreshDbProperties]);', start);
    const block = src.slice(start, end);
    assert.match(block, /fetch\('\/api\/cleaning\/ical-sync'/);
    assert.match(block, /body: JSON\.stringify\(\{ property_id: canonicalPropertyId\(cfg\) \}\)/);
    assert.match(block, /const cloudRows = await refreshDbProperties\(\);/);
    assert.match(block, /cloudRowToLiveProperty\(row\)/);
    assert.doesNotMatch(src, /syncAirbnbReservations|syncGoogleCalendarSlots/);
  });

  test('Pi PUT에는 워처 메타데이터만 포함하고 iCal/예약 값을 보내지 않는다', () => {
    const start = src.indexOf('async function putProperties');
    const end = src.indexOf('\n}', start);
    const block = src.slice(start, end);
    assert.match(block, /id: property\.id/);
    assert.match(block, /watcherId: property\.watcherId/);
    assert.doesNotMatch(block, /airbnbIcalUrl|googleCalIcalUrl|reservations/);
  });

  test('서버 기본값 불러오기는 DB 청소설정과 Pi 워처 메타데이터를 함께 합친다', () => {
    const start = src.indexOf('async function handleLoadServer');
    const end = src.indexOf('\n  }\n\n  return (', start);
    const block = src.slice(start, end);
    assert.match(block, /Promise\.all\(\[fetchCloudProperties\(\), fetchProperties\(\)\]\)/);
    assert.match(block, /devices: watcher\?\.devices \?\? saved\.devices/);
  });
});

describe('RoomStateApp.jsx — 마운트 시 이미 정규 등록된 숙소는 Postgres 값을 덮어쓰지 않는다 (무결성 점검, 2026-09-29)', () => {
  const src = read('src/components/v2/RoomStateApp.jsx');
  const start = src.indexOf('if (cfg.airbnbIcalUrl) {');
  const end = src.indexOf('\n      }\n\n      // Pi/이전 결과가 로컬 캐시와 다르면 갱신');
  const block = src.slice(start, end);

  // 배경: Postgres(property_cleaning_config)가 정본(D-014)인데, 이 마운트 효과는
  // previousId가 없어도(=이미 정규 상태여도) 매번 이 브라우저의 캐시값(checkOutHour 등)을
  // registerProperty로 그대로 밀어넣고 있었다. 청소 관리 화면(PropertyPanel, B)이 같은
  // 필드(checkout_hour/cleaning_duration_hours/ical_url)를 Postgres에 직접 저장해도,
  // 다음에 이 화면을 열면 그 값이 조용히 되돌아갔다 — "정본은 한 곳, 나머지는 읽기전용
  // 참조"가 지켜지지 않던 구조적 결함.

  test('이미 이 이름으로 등록돼 있고(cloudRow) 옮길 이력도 없으면 registerProperty를 부르지 않는다', () => {
    assert.match(block, /const alreadyCanonical = cloudRow\?\.property_id === plan\.config\.id;/);
    assert.match(block, /if \(alreadyCanonical && !plan\.previousId\) \{/);
  });

  test('그 경우엔 캐시가 아니라 Postgres(cloudRow)의 청소설정 값을 cfg에 반영한다', () => {
    const ifBlockStart = block.indexOf('if (alreadyCanonical && !plan.previousId) {');
    const ifBlockEnd = block.indexOf('} else {', ifBlockStart);
    const ifBlock = block.slice(ifBlockStart, ifBlockEnd);
    assert.match(ifBlock, /checkOutHour:\s*cloudRow\.checkout_hour \?\? plan\.config\.checkOutHour/);
    assert.match(ifBlock, /cleaningDurationHours:\s*cloudRow\.cleaning_duration_hours \?\? plan\.config\.cleaningDurationHours/);
    assert.match(ifBlock, /airbnbIcalUrl:\s*cloudRow\.ical_url \|\| plan\.config\.airbnbIcalUrl/);
  });

  test('아직 등록 안 됐거나(cloudRow 없음) 실제 이전이 필요하면(previousId) 여전히 registerProperty를 부른다', () => {
    const elseStart = block.indexOf('} else {');
    const elseBlock = block.slice(elseStart);
    assert.match(elseBlock, /const res = await registerProperty\(plan\.config, plan\.previousId\)\.catch\(\(\) => null\);/);
  });

  test('정본 행이 없으면 마운트에서 조용히 종료하고 로컬 캐시를 정본으로 사용하지 않는다', () => {
    assert.match(src, /if \(!cfg \|\| cancelled\) return;/);
    assert.doesNotMatch(src, /fetchCloudProperty/);
  });
});
