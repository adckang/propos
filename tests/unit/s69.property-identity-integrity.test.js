/**
 * s69 — 숙소 정보 저장 구조의 "정본 하나 + 나머지는 읽기전용 참조" 무결성 점검 (2026-09-29)
 *
 * 배경: s68에서 고친 "propos.com에 파주201이 안 보임" 버그를 계기로, 사용자가 저장 구조
 * 전체를 마스터/슬레이브 관점(정본은 한 곳, 나머지는 값 수정 없이 참조만 하는지)으로
 * 다시 검토해 달라고 요청. 점검 결과 발견한 3가지 구조적 결함과 그 수정:
 *
 *   1. [식별자 무결성] property_cleaning_config.name에 DB 레벨 UNIQUE 제약이 없었다 —
 *      "이름 중복 금지"가 애플리케이션의 check-then-act(저장 전 SELECT)로만 지켜지고
 *      있어 동시 요청 경쟁이나 그 코드를 거치지 않는 실수엔 무방비였다. 실제로 이 결함
 *      때문에(정확히는, 이 제약이 생기기 전 시절 코드가 남긴 잔재로) "파주201"이라는
 *      이름이 서로 다른 3개 property_id로 중복 등록돼 있던 사고가 있었다(별도로 정리 완료).
 *      → DB에 UNIQUE(name) 제약 추가 + 서버가 그 제약 위반(23505)을 친절한 409로 변환.
 *
 *   2. [하이어라키 위반 — 쓰기 주체 중복] 숙소 이름을 바꿀 수 있는 화면이 두 곳
 *      (대시보드 ⚙설정 / 청소관리 "숙소" 탭)이었는데, 청소관리 쪽은 이름을 바꿔도
 *      D-016 이전(rename) 절차를 전혀 타지 않아 property_id와 name이 서로 어긋날 수
 *      있었다. → 청소관리 화면의 이름 입력을 읽기 전용으로 바꿔, 식별자 변경은
 *      대시보드 설정 한 곳(만)에서만 일어나게 통일.
 *
 *   3. [하이어라키 위반 — 정본을 슬레이브가 덮어씀] 앱을 열 때마다(마운트 시) 이 브라우저의
 *      캐시값(체크아웃시각/청소시간/iCal)을 Postgres에 무조건 다시 써넣고 있었다 —
 *      Postgres가 정본(D-014)인데, 청소관리 화면에서 방금 바꾼 값이 다음 접속 때 이
 *      캐시-재기록 때문에 조용히 되돌아갈 수 있었다. → 이미 이 이름으로 정규 등록돼
 *      있고 옮길 이력도 없으면(previousId 없음) 쓰지 않고, 대신 Postgres 값을 읽어와
 *      캐시 쪽을 갱신한다(정본→슬레이브 한 방향만 허용). 이 항목의 테스트는 s68에 있음
 *      (같은 마운트 효과를 다루므로 파일을 분리하지 않고 이어서 검증).
 *
 * 레이어: L2 — 소스 계약 + 스키마 파일 검증.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('DB 스키마 — property_cleaning_config.name UNIQUE 제약 (무결성 최후 방어선)', () => {
  test('schema-cleaning.sql(신규 설치용 정본 스키마)에 UNIQUE가 박혀있다', () => {
    const schema = read('data/schema-cleaning.sql');
    const start = schema.indexOf('CREATE TABLE IF NOT EXISTS property_cleaning_config');
    const end = schema.indexOf(');', start);
    const block = schema.slice(start, end);
    assert.match(block, /name\s+TEXT NOT NULL UNIQUE/);
  });

  test('기존 운영 DB용 ALTER 마이그레이션 스크립트가 존재하고 같은 제약을 추가한다', () => {
    const mig = read('data/migrate-property-name-unique.sql');
    assert.match(mig, /ALTER TABLE property_cleaning_config\s*\n\s*ADD CONSTRAINT property_cleaning_config_name_unique UNIQUE \(name\);/);
  });
});

describe('api/cleaning/[...slug].js — upsertProperty가 UNIQUE(name) 위반을 친절한 409로 바꾼다', () => {
  const src = read('api/cleaning/[...slug].js');
  const start = src.indexOf('async function upsertProperty');
  const end = src.indexOf('\nasync function runFollowupChecks');
  const block = src.slice(start, end);

  test('INSERT를 try/catch로 감싸 23505(unique_violation)를 잡는다', () => {
    assert.match(block, /let rows;\s*\n\s*try \{/);
    assert.match(block, /\} catch \(err\) \{/);
    assert.match(block, /err\.code === "23505" && err\.constraint === "property_cleaning_config_name_unique"/);
  });

  test('그 경우 409 NAME_TAKEN으로 응답하고, 그 외 오류는 그대로 다시 던진다(throw err)', () => {
    const catchStart = block.indexOf('} catch (err) {');
    const catchBlock = block.slice(catchStart);
    assert.match(catchBlock, /sendJson\(res, 409, \{ error: `이미 같은 이름의 숙소가 있어요`, code: "NAME_TAKEN" \}\)/);
    assert.match(catchBlock, /\n\s*throw err;\s*\n\s*\}/);
  });

  test('이 방어선은 기존 저장-전 SELECT 중복검사(check-then-act, 경쟁 상태 있음) 다음에 오는 2차 방어다', () => {
    // 기존 검사가 여전히 남아있어야 함 — 이번 수정은 "대신"이 아니라 "추가" 방어
    assert.match(block, /SELECT property_id FROM property_cleaning_config WHERE name = \$1 AND property_id <> ALL\(\$2::text\[\]\)/);
    const selectIdx = block.indexOf('SELECT property_id FROM property_cleaning_config WHERE name');
    const catchIdx = block.indexOf('err.code === "23505"');
    assert.ok(selectIdx < catchIdx, 'SELECT 검사가 코드상 INSERT try/catch보다 먼저 나와야 함');
  });
});

describe('CleaningManager.jsx — "숙소" 탭(PropertyPanel)은 이름을 더 이상 수정할 수 없다', () => {
  const src = read('src/components/v2/CleaningManager.jsx');
  const start = src.indexOf('function PropertyPanel(');
  const end = src.indexOf('\n// ── ', start + 10);
  const block = src.slice(start, end);

  test('숙소 이름 입력칸에 onChange/set(\'name\', ...) 핸들러가 없다 (읽기 전용)', () => {
    assert.ok(!/set\('name',/.test(block), '이름 필드에 편집 핸들러가 남아있으면 안 됨(D-016 위반 재발 경로)');
    assert.match(block, /숙소 이름[\s\S]{0,120}변경은 대시보드/, '읽기 전용 안내 문구가 있어야 함');
  });

  test('저장 시 form.name을 그대로 보내되(서버 필수 필드), 화면에서 바뀔 수는 없다', () => {
    // handleSave가 여전히 ...form(=name 포함)을 보낸다 — name이 서버 필수라 빼면 400.
    // 다만 위 테스트가 확인하듯 form.name은 useEffect가 불러온 값 그대로만 바뀌고
    // 사용자가 직접 편집할 방법이 없으므로 no-op으로 안전하다.
    const saveStart = block.indexOf('async function handleSave');
    const saveEnd = block.indexOf('\n  async function handleSync', saveStart);
    const saveBlock = block.slice(saveStart, saveEnd);
    assert.match(saveBlock, /\.\.\.form,/);
  });
});
