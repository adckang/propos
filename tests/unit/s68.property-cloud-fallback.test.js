/**
 * s68 — propos.com에서 파주201이 안 보이던 문제 수정 (2026-09-29)
 *
 * 사용자 보고: "propos.com에선 파주201이 안 보여. 숙소 동기화 다시해도 이미 동일한 숙소가
 * 있다고 에러가 떠."
 *
 * 근본 원인 조사(프로덕션 DB 직접 조회, 읽기 전용):
 *   `property_cleaning_config`에 name="파주201"인 행이 3개(property_id가 전부 다름 —
 *   prop_1786259455129/paju201/prop_1783869222025) 있었고, D-016이 요구하는
 *   "property_id = 이름 그 자체"인 행은 하나도 없었다. `handoff-to-codex.md`(2026-09-19)에
 *   이미 "D-016 자동 이전이 실제 운영 DB에는 한 번도 실행된 적 없다"고 기록돼 있던 위험이
 *   실제로 터진 것 — 예견됐던 문제였다.
 *
 *   이 파일은 두 증상 중 "화면에 안 보임" 쪽의 코드 수정만 다룬다:
 *   RoomStateApp의 마운트 시 숙소 설정 로드는 Pi(`fetchProperties`, Cloudflare 터널 경유) →
 *   로컬 브라우저 캐시(localStorage) 순서로만 시도했다. 새 브라우저/기기에서 열면(로컬 캐시
 *   없음) + Pi가 안 잡히면(터널 문제 등) 숙소를 알 방법이 전혀 없었다. 클라우드 청소 DB
 *   (`property_cleaning_config`, Pi/터널과 무관하게 항상 인터넷 접속 가능)를 최후 폴백으로
 *   추가한다. ("이미 같은 숙소가 있다" 에러 쪽은 데이터 정리로 별도 해결 — 코드 버그 아님.)
 *
 * 레이어: L2 — 소스 계약 (RoomStateApp.jsx는 export되는 순수 함수가 없는 최상위 컴포넌트라
 * 이 세션의 기존 관례(s56/s64)와 동일하게 소스 검증으로 확인).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('RoomStateApp.jsx — 클라우드 청소 DB를 숙소 설정 로드의 최후 폴백으로 쓴다', () => {
  const src = read('src/components/v2/RoomStateApp.jsx');

  test('fetchCloudProperty가 /api/cleaning/properties를 호출하고, 실패해도 null로 안전하게 처리한다', () => {
    const start = src.indexOf('async function fetchCloudProperty');
    const end = src.indexOf('\n}', start);
    const block = src.slice(start, end);
    assert.match(block, /fetch\('\/api\/cleaning\/properties'\)/);
    assert.match(block, /catch \{\s*\n\s*return null;/);
  });

  test('여러 숙소가 등록돼 있으면 ical_url이 있는 행(실제 운영 중)을 우선한다', () => {
    const start = src.indexOf('async function fetchCloudProperty');
    const end = src.indexOf('\n}', start);
    const block = src.slice(start, end);
    assert.match(block, /rows\.find\(r => r\.ical_url\) \?\? rows\[0\]/);
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

  test('마운트 시 Pi도 못 찾고 로컬 캐시도 없을 때만(!cfg) 클라우드 폴백을 시도한다', () => {
    const start = src.indexOf('// 마운트 시 Pi에서 숙소 설정 로드');
    const end = src.indexOf('청소 DB 백필', start);
    const block = src.slice(start, end);
    assert.match(block, /let cfg = piCfg \?\? local;/);
    assert.match(block, /let cloudRow = null;/);
    assert.match(block, /if \(!cfg\) \{\s*\n\s*cloudRow = await fetchCloudProperty\(\);\s*\n\s*if \(cloudRow\) cfg = cloudRowToConfig\(cloudRow\);\s*\n\s*\}/);
    // 폴백 다음에도 여전히 !cfg 가드가 있어야 — 클라우드에도 등록된 게 없으면 여전히 조용히 종료
    assert.match(block, /if \(!cfg \|\| cancelled\) return;/);
  });

  test('클라우드 폴백으로 채운 cfg도 기존 D-016 식별자 정규화 경로를 그대로 탄다(전용 분기 불필요)', () => {
    // cloudRowToConfig가 id=property_id, name=name을 그대로 쓰므로 planPropertyIdentity가
    // previousId=null로 판정 — 별도 특별 처리 없이 기존 upsert 경로로 안전하게 합류한다.
    assert.match(src, /if \(cfg\.airbnbIcalUrl\) \{\s*\n\s*const plan = planPropertyIdentity\(cfg\);/);
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

  test('식별자 확인 전에 cloudRow를 이미 안 갖고 있으면(!cf 폴백을 안 탄 경우) 여기서 한 번 더 조회한다', () => {
    assert.match(block, /if \(!cloudRow\) cloudRow = await fetchCloudProperty\(\);/);
  });
});
