import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const properties = [{id:'SIM_seed_fixture',name:'Seed fixture',reservations:[{
  checkIn:'2026-11-01T06:00:00Z',checkOut:'2026-11-03T02:00:00Z',
}]}];
async function actualSeed(pool, failJobs = false) {
  const calls = [];
  const key = '__seedSql_' + randomUUID().replaceAll('-','');
  const io = {exitCode:0,exit(){throw new Error('Unexpected process exit');},pool:{
    async query(){throw new Error('SQL must use a dedicated client');},
    async connect(){
      const client = await pool.connect();
      return {async query(sql,args){
        calls.push(sql.trim().split(/\s+/).slice(0,3).join(' '));
        if(failJobs && /INSERT INTO cleaning_jobs/.test(sql)) throw new Error('fixture write failure');
        return client.query(sql,args);
      },release(error){calls.push('release');client.release(error);}};
    },
    async end(){calls.push('end');},
  }};
  globalThis[key] = io;
  const stubs = {
    pg:`export default {Pool:class {constructor(){return globalThis.${key}.pool}}};`,
    'node:fs':`export function readFileSync(){throw new Error('Secret files blocked');}`,
    '../src/data/roomStateMockData.js':`export const PROPERTIES=${JSON.stringify(properties)};`,
  };
  try {
    const bundle = await build({entryPoints:[fileURLToPath(new URL('../../scripts/seed-simulated-data.mjs',import.meta.url))],
      bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',
      define:{'process.argv':JSON.stringify(['node','seed','--apply']),'process.env.POSTGRES_URL':'"fixture://blocked"',
        'process.exitCode':`globalThis.${key}.exitCode`,'process.exit':`globalThis.${key}.exit`},
      plugins:[{name:'seed-sql-io',setup(b){
        b.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'seed-sql'}:undefined);
        b.onLoad({filter:/.*/,namespace:'seed-sql'},args=>({contents:stubs[args.path],loader:'js'}));
      }}],
    });
    await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+`\n// ${key}`).toString('base64'));
    return {exitCode:io.exitCode,calls};
  } finally {delete globalThis[key];}
}

test('SIMULATED seed — actual CLI and isolated SQL transaction', {skip:!enabled}, async t=>{
  const fixture = await createCleaningSqlFixture();
  const db = fixture.pool;
  try {
    const schema = readFileSync(new URL('../../data/schema.sql',import.meta.url),'utf8');
    await fixture.engine.exec(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS events')));
    const snapshot = async () => {
      const {rows} = await db.query(`SELECT 'properties' AS table_name,count(*)::int AS n FROM property_cleaning_config
        UNION ALL SELECT 'reservations',count(*)::int FROM property_reservations
        UNION ALL SELECT 'jobs',count(*)::int FROM cleaning_jobs
        UNION ALL SELECT 'events',count(*)::int FROM events ORDER BY table_name`);
      return rows;
    };
    await t.test('failure after property/reservation writes rolls both back',async()=>{
      const before = await snapshot();
      const result = await actualSeed(db,true);
      assert.equal(result.exitCode,1);
      assert.deepEqual(result.calls.slice(-3),['ROLLBACK','release','end']);
      assert.deepEqual(await snapshot(),before);
    });
    await t.test('success and repeated apply preserve all keys and existing REAL rows',async()=>{
      const before = await db.query(`SELECT * FROM cleaning_jobs WHERE data_origin='REAL' ORDER BY id`);
      const first = await actualSeed(db);
      assert.equal(first.exitCode,0);
      assert.deepEqual(first.calls.slice(-3),['COMMIT','release','end']);
      const jobs = await db.query(`SELECT * FROM cleaning_jobs WHERE property_id='SIM_seed_fixture'`);
      assert.equal(jobs.rows.length,1);
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM property_reservations WHERE property_id='SIM_seed_fixture'`)).rows[0].n,1);
      assert.ok((await db.query(`SELECT count(*)::int AS n FROM events WHERE property_id='SIM_seed_fixture'`)).rows[0].n>=2);
      const counts = await snapshot();
      assert.equal((await actualSeed(db)).exitCode,0);
      assert.deepEqual(await snapshot(),counts);
      assert.deepEqual((await db.query(`SELECT id FROM cleaning_jobs WHERE property_id='SIM_seed_fixture'`)).rows.map(r=>r.id),jobs.rows.map(r=>r.id));
      assert.deepEqual((await db.query(`SELECT * FROM cleaning_jobs WHERE data_origin='REAL' ORDER BY id`)).rows,before.rows);
    });
  } finally {await fixture.close();}
});
