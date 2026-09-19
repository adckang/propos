/**
 * 테스트가 실제 운영 기록(data/monitoring-*.json, snapshotLog.json, properties-config.json)을
 * 덮어쓰지 않도록 저장 폴더를 임시 폴더로 바꾼다.
 *
 * 감시 프로그램·숙소 저장소는 가져오는 순간 저장 위치를 정하므로, 이 파일을 반드시 그 모듈보다 먼저 import 한다.
 *   import '../helpers/isolateDataDir.js';
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 이미 지정돼 있어도 항상 새 임시 폴더로 — 테스트는 어떤 경우에도 실제 폴더를 쓰면 안 된다
export const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'propos-test-data-'));
process.env.PROPOS_DATA_DIR = TEST_DATA_DIR;
