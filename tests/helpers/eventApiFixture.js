import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { parse } from '@babel/parser';
import * as validation from '../../src/domain/eventValidation.js';
import { insertEvent } from '../../src/infrastructure/eventRepository.js';
import { processEvent } from '../../src/application/eventService.js';
import { DATA_PROFILE } from '../../src/config/dataProfile.js';

const source = readFileSync(new URL('../../api/events/[...slug].js', import.meta.url), 'utf8');
const declarations = parse(source, { sourceType: 'module' }).program.body.map(node => node.declaration ?? node);
function actual(name, dependencies = {}) {
  const node = declarations.find(node => node.type === 'FunctionDeclaration' && node.id?.name === name);
  assert.ok(node, `Actual API function ${name} must exist`);
  return new Function(...Object.keys(dependencies), `return (${source.slice(node.start, node.end)});`)(...Object.values(dependencies));
}

export const event = {
  id: '123e4567-e89b-42d3-a456-426614174000', property_id: 'fixture-ingestion-property',
  type: 'check_in_detected', device_time: '2026-11-09T03:00:00.000Z',
};
export async function request(action, body, { duplicate = false, secret = 'fixture-key', serverSecret = 'fixture-key', demo = false, raw } = {}) {
  const calls = [], notices = [], cache = [];
  let allocations = 0;
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: sql.includes('INSERT INTO events') && !duplicate ? [{ id: params[0] }] : [] };
    },
    async end() { this.ended = true; },
  };
  const handler = actual('handler', {
    Pool: class { constructor() { allocations++; return db; } },
    process: { env: serverSecret == null ? {} : { PROPOS_PI_SECRET: serverSecret } }, DATA_PROFILE,
    resolveServerDataProfile: () => demo ? DATA_PROFILE.DEMO : DATA_PROFILE.HYBRID,
    readBody: actual('readBody'), sendJson: actual('sendJson'), ensureTable: actual('ensureTable'),
    randomUUID, ...validation, insertEvent, processEvent,
    kv: { async set(...args) { cache.push(args); }, async del(...args) { cache.push(args); } },
    notifyEvent: async (...args) => { notices.push(args); return { sent: true }; },
    requireScope: () => { throw new Error('Pi writes cannot depend on a browser session'); },
    console: { error() {} },
  });
  const req = Readable.from([Buffer.from(raw ?? JSON.stringify(body))]);
  Object.assign(req, { method: 'POST', url: `/api/events${action ? `/${action}` : ''}`, query: {}, headers: secret == null ? {} : { 'x-pi-secret': secret } });
  const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
  await handler(req, res);
  if (allocations) assert.equal(db.ended, true);
  return { res, calls, notices, cache, allocations };
}

