/**
 * Pi 워처 메타데이터 영구 저장 — Pi 파일시스템 기반
 * 저장 위치: data/properties-config.json (gitignore됨)
 * 예약·iCal·청소 일정은 저장하지 않는다. 정본은 Postgres다.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PROPOS_DATA_DIR || join(__dir, '..', 'data');
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
    return Array.isArray(data) ? data.map(toWatcherProperty).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function toWatcherProperty(property) {
  if (!property || typeof property !== 'object') return null;
  const id = String(property.id ?? property.property_id ?? '').trim();
  const name = String(property.name ?? id).trim();
  if (!id && !name) return null;
  return {
    id: id || name,
    name: name || id,
    district: String(property.district ?? '').trim(),
    watcherId: property.watcherId ?? property.watcher_id ?? null,
    devices: property.devices && typeof property.devices === 'object' ? property.devices : {},
  };
}

/**
 * 숙소 목록 저장
 * @param {Array<object>} properties
 */
export function saveProperties(properties) {
  ensureDataDir();
  const normalized = Array.isArray(properties) ? properties.map(toWatcherProperty).filter(Boolean) : [];
  writeFileSync(PROPERTIES_FILE, JSON.stringify(normalized, null, 2));
}
