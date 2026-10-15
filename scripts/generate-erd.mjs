/**
 * 운영 DB 카탈로그(읽기 전용) → ERD 생성
 *
 *   npm run erd            myPlantUML/ 에 .uml(요약·전체) + .drawio(요약·전체) 생성
 *   npm run erd -- --png   PlantUML PNG 도 생성 (PLANTUML_JAR=/path/plantuml.jar, java 필요)
 *   npm run erd:check      커밋된 .uml 이 현재 DB 와 같은지 비교 (다르면 종료코드 1)
 *
 * 설명·색·배치는 scripts/erd.config.json 에서 조정. 구조는 DB 에서만 온다.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildModel, renderPlantUml, renderDrawio, CATALOG_SQL } from './lib/erdModel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'myPlantUML');
const args = new Set(process.argv.slice(2));

for (const line of (() => { try { return readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n'); } catch { return []; } })()) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL 없음 (.env.local 또는 환경변수)');

const config = JSON.parse(readFileSync(path.join(ROOT, 'scripts/erd.config.json'), 'utf8'));
const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
let catalog;
try {
  const q = async (sql) => (await pool.query(sql, [config.schema ?? 'public'])).rows;
  catalog = { columns: await q(CATALOG_SQL.columns), constraints: await q(CATALOG_SQL.constraints), uniqueIndexes: await q(CATALOG_SQL.uniqueIndexes) };
} finally {
  await pool.end();
}

const model = buildModel(catalog, config);
for (const w of model.warnings) console.warn(`WARNING ${w}`);

const files = {
  'propos-db-erd.uml': renderPlantUml(model, { detail: 'summary' }),
  'propos-db-erd-full.uml': renderPlantUml(model, { detail: 'full' }),
  'propos-db-erd.drawio': renderDrawio(model, { detail: 'summary' }),
  'propos-db-erd-full.drawio': renderDrawio(model, { detail: 'full' }),
};

if (args.has('--check')) {
  // .drawio 는 사람이 위치를 옮겨 저장할 수 있으므로 비교 대상은 .uml(구조 정본)만
  const stale = Object.keys(files).filter((f) => f.endsWith('.uml')).filter((f) => {
    const p = path.join(OUT, f);
    return !existsSync(p) || readFileSync(p, 'utf8') !== files[f];
  });
  if (stale.length) { console.error(`ERD 가 DB 와 다릅니다: ${stale.join(', ')} — npm run erd 로 재생성하세요`); process.exit(1); }
  console.log('ERD 가 현재 DB 와 일치합니다.');
  process.exit(0);
}

for (const [name, text] of Object.entries(files)) {
  // .drawio 는 사람이 옮긴 위치를 보호: 이미 있으면 --force-drawio 없이는 덮어쓰지 않는다
  const p = path.join(OUT, name);
  if (name.endsWith('.drawio') && existsSync(p) && !args.has('--force-drawio')) {
    writeFileSync(p.replace(/\.drawio$/, '.generated.drawio'), text);
    console.log(`보존: ${name} (손댄 위치 유지) — 새 구조는 ${name.replace(/\.drawio$/, '.generated.drawio')}`);
    continue;
  }
  writeFileSync(p, text);
  console.log(`생성: myPlantUML/${name}`);
}

if (args.has('--png')) {
  const jar = process.env.PLANTUML_JAR;
  if (!jar) throw new Error('--png 는 PLANTUML_JAR 환경변수가 필요합니다');
  for (const f of ['propos-db-erd.uml', 'propos-db-erd-full.uml']) {
    execFileSync('java', ['-jar', jar, '-tpng', '-charset', 'UTF-8', '-o', OUT, path.join(OUT, f)], { stdio: 'inherit' });
  }
}
