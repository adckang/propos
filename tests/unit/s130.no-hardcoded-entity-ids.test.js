// s130 — 화면·로직 코드는 실제 기기 ID(HA entity_id)를 직접 쓰지 않고 공개 설정(src/config/publicConfig.js)에서 읽는다.
// CLAUDE.md 절대 규칙 "entity ID 하드코딩 금지". v1 숙소 화면이 TV방 조명·작은 스탠드 ID를 직접 적고 있었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// publicConfig.js 는 Vite 방식으로 이 JSON 을 그대로 내보낸다(Node 에서는 JSON import 속성이 필요해 직접 읽는다)
const publicConfig = JSON.parse(readFileSync(join(ROOT, 'src/config/propos.public.json'), 'utf8'));
assert.match(readFileSync(join(ROOT, 'src/config/publicConfig.js'), 'utf8'), /import publicConfig from "\.\/propos\.public\.json"/);
const SRC = join(ROOT, 'src');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return path === join(SRC, 'config') ? [] : sourceFiles(path);
    return /\.(js|jsx|mjs)$/.test(name) ? [path] : [];
  });
}

test('v1 화면이 쓰는 기기는 모두 공개 설정에 이름이 있다', () => {
  for (const key of ['tvLight', 'tvPlug', 'smallStand']) {
    assert.match(String(publicConfig.entities?.[key] ?? ''), /^[a-z_]+\.[a-z0-9_]+$/, `entities.${key}`);
  }
});

test('설정에 있는 기기 ID는 src/config 밖의 코드에 직접 적히지 않는다', () => {
  const ids = Object.values(publicConfig.entities).filter(value => typeof value === 'string' && value);
  const found = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const id of ids) if (text.includes(id)) found.push(`${relative(ROOT, file)}: ${id}`);
  }
  assert.deepEqual(found, []);
});
