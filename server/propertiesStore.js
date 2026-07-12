/**
 * 숙소 설정 영구 저장 — Pi 파일시스템 기반
 * 저장 위치: data/properties-config.json (gitignore됨)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '..', 'data');
const PROPERTIES_FILE = join(DATA_DIR, 'properties-config.json');

function ensureDataDir() {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ok */ }
}

/**
 * 저장된 숙소 목록 반환
 * @returns {Array<object>}
 */
export function loadProperties() {
  try {
    const raw = readFileSync(PROPERTIES_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * 숙소 목록 저장
 * @param {Array<object>} properties
 */
export function saveProperties(properties) {
  ensureDataDir();
  writeFileSync(PROPERTIES_FILE, JSON.stringify(properties, null, 2));
}
