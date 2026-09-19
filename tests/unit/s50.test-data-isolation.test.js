/**
 * s50 — 테스트가 실제 운영 기록(data/)을 덮어쓰지 않는다
 *
 * 배경 (2026-09-19): 감시 프로그램 테스트(s20)가 실제 data/monitoring-config.json · monitoring-state.json 을
 * 그대로 덮어써서, 사용자가 실제 숙소 달력에서 받아온 예약 정보가 {"areaName":"test","reservation":null} 로 지워지고
 * 방 상태가 공실로 되돌아갔다. 테스트를 돌릴 때마다 운영 중인 개발 서버의 기록이 오염됐다.
 *
 * 계약
 *   1. 감시 프로그램·숙소 저장소는 저장 폴더를 PROPOS_DATA_DIR 로 바꿀 수 있다 (기본값은 그대로 data/)
 *   2. 폴더를 바꾸면 실제 data/ 는 조금도 변하지 않는다 (별도 프로세스로 실측 — L1)
 *   3. 이 모듈들을 가져오는 모든 테스트는 격리 헬퍼를 먼저 가져온다 (앞으로 추가될 테스트 포함 — L2)
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { TEST_DATA_DIR } from '../helpers/isolateDataDir.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REAL_DATA = path.join(ROOT, 'data');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const hashOf = (file) => existsSync(file) ? createHash('sha1').update(readFileSync(file)).digest('hex') : 'MISSING';
const REAL_FILES = ['monitoring-state.json', 'monitoring-config.json', 'snapshotLog.json', 'properties-config.json']
  .map(f => path.join(REAL_DATA, f));

describe('격리 헬퍼', () => {
  test('테스트 저장 폴더는 시스템 임시 폴더 아래이고 실제 data/ 가 아니다', () => {
    assert.ok(TEST_DATA_DIR.startsWith(tmpdir()), TEST_DATA_DIR);
    assert.notEqual(path.resolve(TEST_DATA_DIR), path.resolve(REAL_DATA));
    assert.equal(process.env.PROPOS_DATA_DIR, TEST_DATA_DIR);
  });
});

describe('저장 폴더 설정 (L2 — 소스 계약)', () => {
  for (const file of ['server/occupancyWatcher.js', 'server/propertiesStore.js']) {
    test(`${file}: PROPOS_DATA_DIR 로 저장 폴더를 바꿀 수 있다`, () => {
      assert.match(read(file), /process\.env\.PROPOS_DATA_DIR\s*\|\|\s*join\(__dir,\s*'\.\.',\s*'data'\)/);
    });
  }
});

describe('폴더를 바꾸면 실제 data/ 는 변하지 않는다 (L1 — 별도 프로세스로 실측)', () => {
  test('감시 상태·숙소 설정을 저장해도 실제 파일 내용은 그대로, 임시 폴더에만 기록', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'propos-isolation-check-'));
    const before = REAL_FILES.map(hashOf);
    try {
      const script = `
        const w = await import(${JSON.stringify(path.join(ROOT, 'server/occupancyWatcher.js'))});
        w.setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
        const s = await import(${JSON.stringify(path.join(ROOT, 'server/propertiesStore.js'))});
        s.saveProperties([{ id: 'isolation-check' }]);
      `;
      execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, PROPOS_DATA_DIR: tmp },
        stdio: 'pipe',
        timeout: 20000,
      });

      // 임시 폴더에는 기록됨
      assert.ok(readdirSync(tmp).includes('monitoring-state.json'), '감시 상태가 임시 폴더에 없음');
      assert.ok(readdirSync(tmp).includes('properties-config.json'), '숙소 설정이 임시 폴더에 없음');
      // 실제 폴더는 그대로
      assert.deepEqual(REAL_FILES.map(hashOf), before, '실제 data/ 파일이 바뀌었음');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('격리 헬퍼 사용 강제 (L2 — 모든 테스트 파일)', () => {
  const dirs = ['tests/unit', 'tests/functional', 'tests/integration'];
  const files = dirs.flatMap(d => {
    const abs = path.join(ROOT, d);
    return existsSync(abs) ? readdirSync(abs).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`) : [];
  });
  const TOUCHES_DATA = /occupancyWatcher|propertiesStore/;

  test('감시 프로그램/숙소 저장소를 가져오는 테스트를 하나 이상 찾는다 (가드 자체 검증)', () => {
    const users = files.filter(f => f !== 'tests/unit/s50.test-data-isolation.test.js' && TOUCHES_DATA.test(read(f)));
    assert.ok(users.length >= 1);
  });

  for (const f of files) {
    if (f === 'tests/unit/s50.test-data-isolation.test.js') continue;
    const src = read(f);
    if (!TOUCHES_DATA.test(src)) continue;
    test(`${f}: 저장 폴더 격리 헬퍼를 먼저 가져온다`, () => {
      const helperAt = src.indexOf('isolateDataDir');
      const moduleAt = src.search(TOUCHES_DATA);
      assert.ok(helperAt >= 0, '격리 헬퍼(../helpers/isolateDataDir.js)를 가져오지 않음');
      assert.ok(helperAt < moduleAt, '격리 헬퍼가 감시 프로그램/저장소보다 먼저 가져와져야 함');
    });
  }
});
