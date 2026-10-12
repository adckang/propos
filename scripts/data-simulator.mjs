#!/usr/bin/env node
/**
 * PROPOS 데이터 시뮬레이터 CLI.
 *
 * 오프라인:
 *   node scripts/data-simulator.mjs check --fixture
 *   node scripts/data-simulator.mjs generate --synthetic --out /tmp/propos-sim.json
 *   node scripts/data-simulator.mjs check --file /tmp/propos-sim.json
 *
 * 운영/로컬 DB:
 *   node scripts/data-simulator.mjs check-db
 *   node scripts/data-simulator.mjs check-db --strict
 *
 * 검수 코어는 외부 모듈이 없는 src/data/dataSimulator.js에 있고, DB 모드는
 * 이미 프로젝트가 사용하는 pg 드라이버를 어댑터로만 불러온다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSimulatedDataset, generateSyntheticProperties, validateDataset } from '../src/data/dataSimulator.js';
import { PROPERTIES } from '../src/data/roomStateMockData.js';

function loadLocalEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, '');
    }
  } catch { /* DB 모드가 아니면 .env.local은 필요하지 않다. */ }
}

function parseArgs(argv) {
  const [first, ...rest] = argv;
  const command = first && !first.startsWith('--') ? first : 'check';
  const args = first && !first.startsWith('--') ? rest : argv;
  const options = { command, flags: new Set(), values: {} };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue !== undefined) options.values[key] = inlineValue;
    else if (args[i + 1] && !args[i + 1].startsWith('--')) options.values[key] = args[++i];
    else options.flags.add(key);
  }
  return options;
}

function printHelp() {
  console.log(`PROPOS 데이터 시뮬레이터

명령:
  check --fixture                 코드 fixture를 검수 (기본값)
  check --file <json>             JSON 행 집합을 검수
  check-db [--strict]             POSTGRES_URL의 현재 DB를 검수
  generate [--out <json>]         현재 fixture를 정규 행 집합으로 생성
  generate --synthetic             독립적인 결정적 숙소·예약 데이터 생성

공통:
  --json                          결과를 JSON으로 출력
  --strict                        warning도 실패로 처리
  --property-count <n>            synthetic 숙소 수 (기본 5)
  --reservations-per-property <n> synthetic 숙소별 예약 수 (기본 8)
`);
}

function readJsonFile(file) {
  return JSON.parse(readFileSync(resolve(file), 'utf8'));
}

async function readDatabaseDataset() {
  loadLocalEnv();
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL이 없습니다.');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    const query = async table => (await pool.query(`SELECT * FROM ${table}`)).rows;
    return {
      properties: await query('property_cleaning_config'),
      reservations: await query('property_reservations'),
      jobs: await query('cleaning_jobs'),
      events: await query('events'),
      notifs: await query('cleaning_notifs'),
      blockers: await query('property_calendar_blockers'),
      cleaners: await query('cleaners'),
    };
  } finally {
    await pool.end();
  }
}

function formatResult(result, label) {
  return {
    label,
    ok: result.ok,
    strictOk: result.strictOk,
    summary: result.summary,
    issues: result.issues,
    warnings: result.warnings,
  };
}

function printResult(result, options) {
  const output = formatResult(result, options.label);
  if (options.flags.has('json')) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  const state = options.strict ? result.strictOk : result.ok;
  console.log(`[data-simulator] ${options.label}: ${state ? 'PASS' : 'FAIL'}`);
  console.log(JSON.stringify(result.summary, null, 2));
  for (const item of [...result.issues, ...result.warnings]) {
    console.log(`${item.severity.toUpperCase()} ${item.code} ${item.table}/${item.key}: ${item.message}`);
  }
}

function exitFor(result, strict) {
  return (strict ? result.strictOk : result.ok) ? 0 : 1;
}

const options = parseArgs(process.argv.slice(2));
if (options.flags.has('help') || options.flags.has('h')) {
  printHelp();
  process.exit(0);
}

try {
  const strict = options.flags.has('strict');
  let result;

  if (options.command === 'generate') {
    const properties = options.flags.has('synthetic')
      ? generateSyntheticProperties({
        propertyCount: options.values['property-count'],
        reservationsPerProperty: options.values['reservations-per-property'],
        startDate: options.values['start-date'],
      })
      : PROPERTIES;
    const dataset = buildSimulatedDataset(properties, {
      seed: options.values.seed || 'propos-simulator-v1',
      sourceRef: options.values['source-ref'] || 'src/data/roomStateMockData.js',
    });
    result = validateDataset(dataset, { allowLegacyRealJobs: false });
    const outputFile = options.values.out;
    if (outputFile) writeFileSync(resolve(outputFile), `${JSON.stringify(dataset, null, 2)}\n`);
    if (options.flags.has('json')) {
      console.log(JSON.stringify({ dataset, validation: formatResult(result, 'generated') }, null, 2));
    } else {
      console.log(`[data-simulator] generated: ${result.ok ? 'PASS' : 'FAIL'}${outputFile ? ` → ${resolve(outputFile)}` : ''}`);
      console.log(JSON.stringify(result.summary, null, 2));
    }
    process.exit(exitFor(result, strict));
  }

  let dataset;
  let label;
  if (options.command === 'check-db' || options.flags.has('db')) {
    dataset = await readDatabaseDataset();
    label = 'database';
  } else if (options.values.file) {
    dataset = readJsonFile(options.values.file);
    label = options.values.file;
  } else if (options.flags.has('synthetic')) {
    dataset = buildSimulatedDataset(generateSyntheticProperties({
      propertyCount: options.values['property-count'],
      reservationsPerProperty: options.values['reservations-per-property'],
      startDate: options.values['start-date'],
    }));
    label = 'synthetic';
  } else {
    dataset = buildSimulatedDataset(PROPERTIES);
    label = 'fixture';
  }

  result = validateDataset(dataset, { allowLegacyRealJobs: options.values['allow-legacy-real-jobs'] !== 'false' });
  printResult(result, { ...options, label, strict });
  process.exit(exitFor(result, strict));
} catch (error) {
  console.error(`[data-simulator] ERROR: ${error.message}`);
  process.exit(1);
}
