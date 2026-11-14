import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Execute the actual CLI in a child. Replace only DB/filesystem I/O and fixture
// input, so no configured database, secret file or external service is touched.
const stubs = {
  pg: `const s=globalThis.__seedTest;
    const query=async(scope,sql)=>{
      const op=sql.trim().split(/\\s+/).slice(0,3).join(' ');
      s.calls.push({scope,op});
      if(s.mode==='write-failure' && /INSERT INTO cleaning_jobs/.test(sql)) throw new Error('fixture write failure');
      if(s.mode==='rollback-failure' && (/INSERT INTO cleaning_jobs/.test(sql)||sql==='ROLLBACK')) throw new Error('fixture DB failure');
      if(s.mode==='commit-failure' && sql==='COMMIT') throw new Error('fixture commit failure');
      if(/SELECT property_id/.test(sql) && s.mode==='real-conflict') return {rows:[{property_id:'SIM_001',name:'Fixture',data_origin:'REAL'}]};
      return {rows:[]};
    };
    const client={query:(sql)=>query('client',sql),release(error){s.releases.push(Boolean(error));s.order.push('release');}};
    export default {Pool:class {
      constructor(){s.pools++;}
      async query(sql){return query('pool',sql);}
      async connect(){s.connects++; if(s.mode==='connect-failure')throw new Error('fixture connect failure');return client;}
      async end(){s.ends++;s.order.push('end');}
    }};`,
  'node:fs': `export function readFileSync(){throw new Error('fixture: environment files are blocked');}`,
  '../src/data/roomStateMockData.js': `export const PROPERTIES=[{id:'SIM_001',name:'Fixture',reservations:[{checkIn:'2026-11-01T06:00:00Z',checkOut:'2026-11-03T02:00:00Z'}]}];`,
};
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../../scripts/seed-simulated-data.mjs', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'seed-io-fixture', setup(b) {
    b.onResolve({filter: /.*/}, args => Object.hasOwn(stubs,args.path) ? {path:args.path,namespace:'seed-fixture'} : undefined);
    b.onLoad({filter: /.*/,namespace:'seed-fixture'}, args => ({contents:stubs[args.path],loader:'js'}));
  }}],
});
function run(mode = 'success', apply = true) {
  const prelude = `globalThis.__seedTest={mode:${JSON.stringify(mode)},calls:[],pools:0,connects:0,releases:[],ends:0,order:[]};
    globalThis.fetch=async()=>{throw new Error('External requests blocked');};
    process.on('exit',()=>console.log('__SEED_TEST__'+JSON.stringify(globalThis.__seedTest)));\n`;
  const child = spawnSync(process.execPath,['--input-type=module','-',...(apply?['--apply']:[])],{
    input:prelude+compiled.outputFiles[0].text,encoding:'utf8',timeout:15000,
    env:{POSTGRES_URL:'postgres://fixture.invalid/blocked'},
  });
  assert.ifError(child.error);
  const line = child.stdout.split('\n').find(s=>s.startsWith('__SEED_TEST__'));
  assert.ok(line,child.stderr);
  return {exit:child.status,...JSON.parse(line.slice('__SEED_TEST__'.length))};
}
function pinned(s) {
  assert.equal(s.connects,1,'one dedicated transaction client');
  assert.ok(s.calls.length>0);
  assert.ok(s.calls.every(call=>call.scope==='client'),'every SQL statement must use that client');
  assert.deepEqual(s.order,['release','end']);
  assert.equal(s.ends,1);
}

describe('SIMULATED seed actual CLI transaction',()=>{
  test('all writes and COMMIT stay on the acquired connection',()=>{
    const s=run(); assert.equal(s.exit,0);pinned(s);
    assert.equal(s.calls[0].op,'BEGIN');assert.equal(s.calls.at(-1).op,'COMMIT');
    assert.equal(s.calls.some(c=>c.op==='ROLLBACK'),false);
    assert.deepEqual(s.releases,[false]);
  });
  test('a failed job write rolls back on the same connection before release',()=>{
    const s=run('write-failure');assert.equal(s.exit,1);pinned(s);
    assert.equal(s.calls.at(-1).op,'ROLLBACK');
    assert.equal(s.calls.some(c=>c.op==='COMMIT'||c.op==='INSERT INTO events'),false);
  });
  test('REAL property conflict rolls back before any INSERT',()=>{
    const s=run('real-conflict');assert.equal(s.exit,1);pinned(s);
    assert.equal(s.calls.at(-1).op,'ROLLBACK');
    assert.equal(s.calls.some(c=>c.op.startsWith('INSERT')),false);
  });
  test('connection acquisition failure still closes the pool',()=>{
    const s=run('connect-failure');assert.equal(s.exit,1);
    assert.equal(s.connects,1);assert.deepEqual(s.calls,[]);assert.deepEqual(s.releases,[]);
    assert.equal(s.ends,1);
  });
  test('commit failure attempts rollback before cleanup',()=>{
    const s=run('commit-failure');assert.equal(s.exit,1);pinned(s);
    assert.deepEqual(s.calls.slice(-2).map(c=>c.op),['COMMIT','ROLLBACK']);
  });
  test('failed rollback discards the connection and still closes the pool',()=>{
    const s=run('rollback-failure');assert.equal(s.exit,1);pinned(s);
    assert.deepEqual(s.releases,[true]);
  });
  test('dry-run never opens a database connection',()=>{
    const s=run('success',false);assert.equal(s.exit,0);
    assert.equal(s.pools,0);assert.equal(s.connects,0);assert.deepEqual(s.calls,[]);
  });
});
