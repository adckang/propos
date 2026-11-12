/**
 * s114 — 새 청소 작업의 첫 요청 시각(RF-12 운영 DB 검수에서 발견)
 *
 * 사용자 시나리오: 12월·내년 9월 퇴실의 청소 작업이 10월 12일에 만들어졌는데, 다음 날 저녁 담당자들에게 바로 청소 요청이
 * 나갔다. 아무도 몇 달 뒤 일을 받지 않아 "배정 실패 — 수동 처리 필요"가 됐고, 화면엔 한 달 넘게 남은 퇴실이 수동 배정으로 보인다.
 * 원인: 그날 쓴 백필 스크립트가 발송 시각(dispatch_after)을 비워 DB 기본값(지금)이 들어갔다. 관리자 일괄 등록 API(jobs/sync)도 같다.
 * 기준: 동기화와 같은 규칙 하나 — 청소 시작이 14일 안이면 바로, 그보다 멀면 시작 14일 전에 요청한다.
 * (월간 크론은 다음 달 작업만 만들고 바로 다음 단계에서 발송 일정을 따로 잡는 설계, 시뮬레이션 시드는 외부 발송 대상이 아니다.)
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import * as dispatchModule from '../../server/cleaning/_dispatch.js';
import { reservationUidOf } from '../../server/cleaning/_reservationSync.js';

const { calcCleaningTimes, toKstDateKey } = dispatchModule;
const planJobDispatch = (...args) => {
  assert.equal(typeof dispatchModule.planJobDispatch, 'function', 'planJobDispatch 가 없다');
  return dispatchModule.planJobDispatch(...args);
};
const DAY = 86_400_000;
const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const handlerSource = read('api/cleaning/[...slug].js');
const handlerAst = parse(handlerSource, { sourceType: 'module' });

function load(name, deps) {
  const node = handlerAst.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  assert.ok(node, `${name} 없음`);
  return new Function(...Object.keys(deps), `return (${handlerSource.slice(node.start, node.end)});`)(...Object.values(deps));
}

/** 오늘(KST)부터 days 일 뒤의 날짜 'YYYY-MM-DD' */
function kstDay(days) {
  return new Date(Date.now() + 9 * 3_600_000 + days * DAY).toISOString().slice(0, 10);
}

describe('planJobDispatch — 출처와 첫 요청 시각 규칙', () => {
  const now = new Date('2026-10-12T12:18:50.000Z');

  test('실제 사고 사례: 내년 9월 퇴실을 10/12에 만들면 시작 14일 전에 요청한다(바로 보내지 않는다)', () => {
    const start = new Date('2027-09-20T02:00:00.000Z');
    const plan = planJobDispatch(start, now);
    assert.equal(plan.source, 'MONTHLY_BATCH');
    assert.equal(plan.dispatchAfter.toISOString(), '2027-09-06T02:00:00.000Z');
  });

  test('딱 14일 남았으면 바로(SHORT_NOTICE), 1분이라도 더 남았으면 시작 14일 전', () => {
    const exactly = new Date(now.getTime() + 14 * DAY);
    assert.deepEqual(planJobDispatch(exactly, now), { source: 'SHORT_NOTICE', dispatchAfter: now });
    const later = new Date(now.getTime() + 14 * DAY + 60_000);
    const plan = planJobDispatch(later, now);
    assert.equal(plan.source, 'MONTHLY_BATCH');
    assert.equal(plan.dispatchAfter.getTime(), now.getTime() + 60_000);
  });

  test('이미 지난 시작이면 바로(기존과 같음), 숫자·문자열 시각도 받는다', () => {
    assert.equal(planJobDispatch(new Date(now.getTime() - DAY), now).source, 'SHORT_NOTICE');
    const plan = planJobDispatch('2026-12-13T02:00:00.000Z', now.getTime());
    assert.equal(plan.source, 'MONTHLY_BATCH');
    assert.equal(plan.dispatchAfter.toISOString(), '2026-11-29T02:00:00.000Z');
  });

  test('MONTHLY_BATCH 의 요청 시각은 언제나 "지금" 이후다(먼 퇴실을 바로 보내는 일이 없다)', () => {
    for (const days of [14.01, 15, 30, 60, 200, 400]) {
      const plan = planJobDispatch(new Date(now.getTime() + days * DAY), now);
      assert.equal(plan.source, 'MONTHLY_BATCH');
      assert.ok(plan.dispatchAfter.getTime() > now.getTime(), `${days}일 뒤`);
    }
  });
});

describe('관리자 일괄 등록(jobs/sync) — 실제 핸들러 실행', () => {
  async function runSyncJobs(checkouts) {
    const inserts = [];
    const deps = {
      db: { query: async (sql, params) => {
        if (sql.includes('INSERT INTO cleaning_jobs')) { inserts.push({ sql, params }); return { rowCount: 1, rows: [] }; }
        if (sql.includes('DELETE FROM property_calendar_blockers')) return { rows: [] };
        throw new Error(`예상하지 못한 쿼리: ${sql.slice(0, 60)}`);
      } },
      readBody: async () => ({ property_id: '파주201', checkouts }),
      sendJson: (res, code, body) => res.status(code).json(body),
      getPropertyConfig: async () => ({ property_id: '파주201', checkout_hour: 11, cleaning_duration_hours: 2.5, data_origin: 'REAL', google_calendar_id: null }),
      calcCleaningTimes, planJobDispatch,
      getGoogleToken: async () => 'token', kv: {}, deleteBlockerEvent: async () => {},
      console: { error() {} },
    };
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    const before = Date.now();
    await load('syncJobs', deps)({ method: 'POST' }, res);
    return { res, inserts, before, after: Date.now() };
  }

  const dispatchParam = insert => {
    const columns = /\(([^)]*)\)\s*VALUES/.exec(insert.sql)[1].split(',').map(s => s.trim());
    const index = columns.indexOf('dispatch_after');
    assert.ok(index >= 0, 'INSERT 에 dispatch_after 가 없다 — DB 기본값(지금)이 들어가 다음 크론이 바로 보낸다');
    return new Date(insert.params[index]);
  };

  test('200일 뒤 퇴실: 시작 14일 전에 요청하도록 저장한다', async () => {
    const date = kstDay(200);
    const { res, inserts } = await runSyncJobs([{ date, uid: 'uid-far' }]);
    assert.equal(res.code, 200);
    assert.equal(inserts.length, 1);
    const start = calcCleaningTimes(date, 11, 2.5).cleaning_start_at;
    assert.equal(dispatchParam(inserts[0]).toISOString(), new Date(start.getTime() - 14 * DAY).toISOString());
    assert.ok(inserts[0].params.includes('MONTHLY_BATCH'));
  });

  test('지난 퇴실: 작업을 만들지 않고(블로커도 그대로) 건너뛴 건수로 센다', async () => {
    const { res, inserts } = await runSyncJobs([{ date: kstDay(-2), uid: 'uid-past' }, { date: kstDay(30), uid: 'uid-next' }]);
    assert.equal(res.code, 200);
    assert.deepEqual({ created: res.body.created, skipped: res.body.skipped }, { created: 1, skipped: 1 });
    assert.equal(inserts.length, 1);
    assert.ok(inserts[0].params.includes('uid-next'));
  });

  test('3일 뒤 퇴실: 바로 요청(SHORT_NOTICE)', async () => {
    const { inserts, before, after } = await runSyncJobs([{ date: kstDay(3), uid: 'uid-near' }]);
    const at = dispatchParam(inserts[0]).getTime();
    assert.ok(at >= before - 1000 && at <= after + 1000, '지금 요청');
    assert.ok(inserts[0].params.includes('SHORT_NOTICE'));
  });
});

describe('iCal 동기화 — 실제 핸들러 실행(같은 규칙을 쓰는지)', () => {
  async function runSync(checkOutDates) {
    const inserts = [];
    const reservations = checkOutDates.map((date, i) => ({
      uid: `uid-${i}`, guestName: null, platform: 'Airbnb',
      checkIn: new Date(new Date(`${date}T15:00:00+09:00`).getTime() - 2 * DAY),
      checkOut: new Date(`${date}T11:00:00+09:00`),
    }));
    const deps = {
      db: { query: async (sql, params) => {
        if (sql.includes('FROM property_cleaning_config')) {
          return { rows: [{ property_id: '파주201', name: '파주201', ical_url: 'https://example.invalid/ical', checkout_hour: 11, cleaning_duration_hours: 2.5 }] };
        }
        if (sql.includes('SELECT NOW()')) return { rows: [{ now: new Date() }] };
        if (sql.includes('INSERT INTO property_reservations')) return { rowCount: 1, rows: [] };
        if (sql.includes('INSERT INTO cleaning_jobs')) { inserts.push({ sql, params }); return { rowCount: 0, rows: [] }; }
        if (sql.includes('DELETE FROM property_calendar_blockers')) return { rows: [] };
        throw new Error(`예상하지 못한 쿼리: ${sql.slice(0, 60)}`);
      } },
      getGoogleToken: async () => null, kv: {},
      fetch: async () => ({ ok: true, text: async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR' }),
      parseVEvents: () => [], airbnbEventsToReservations: () => reservations,
      reservationUidOf, retireAfterSync: async () => ({}), isCompleteCalendar: () => true,
      alertGoneCheckouts: async () => {}, goneAlertDeps: {},
      toKstDateKey, calcCleaningTimes, planJobDispatch,
      deleteBlockerEvent: async () => {}, advanceJob: async () => {}, postSlack: async () => true,
      console: { error() {} },
    };
    await load('syncAllPropertiesIcal', deps)(deps.db);
    return inserts;
  }

  test('먼 퇴실은 시작 14일 전, 가까운 퇴실은 바로 — planJobDispatch 와 같은 값', async () => {
    const far = kstDay(90);
    const near = kstDay(2);
    const inserts = await runSync([far, near]);
    assert.equal(inserts.length, 2);
    const columns = /\(([^)]*)\)\s*VALUES/.exec(inserts[0].sql)[1].split(',').map(s => s.trim());
    const at = insert => new Date(insert.params[columns.indexOf('dispatch_after') - (columns.length - insert.params.length)]);
    const farStart = calcCleaningTimes(far, 11, 2.5).cleaning_start_at;
    assert.equal(at(inserts[0]).toISOString(), new Date(farStart.getTime() - 14 * DAY).toISOString());
    assert.ok(inserts[0].params.includes('MONTHLY_BATCH'));
    assert.ok(inserts[1].params.includes('SHORT_NOTICE'));
    assert.ok(Math.abs(at(inserts[1]).getTime() - Date.now()) < 5000);
  });
});

describe('소스 계약 — 작업을 만드는 모든 곳', () => {
  test('동기화·관리자 일괄 등록은 planJobDispatch 를 쓰고 14일 규칙을 따로 두지 않는다', () => {
    for (const name of ['syncAllPropertiesIcal', 'syncJobs']) {
      const node = handlerAst.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
      const body = handlerSource.slice(node.start, node.end);
      assert.ok(/planJobDispatch\(/.test(body), `${name}: 공통 규칙 사용`);
      assert.ok(!/<=\s*14\s*\?/.test(body), `${name}: 14일 규칙을 따로 두지 않는다`);
      assert.ok(/dispatch_after/.test(body), `${name}: 발송 시각 저장`);
    }
  });

  test('백필 스크립트도 같은 규칙으로 발송 시각을 저장한다', () => {
    const script = read('scripts/backfill-real-reservations.mjs');
    assert.ok(/import \{[^}]*planJobDispatch[^}]*\} from '\.\.\/server\/cleaning\/_dispatch\.js'/.test(script), '공통 규칙 import');
    assert.ok(/planJobDispatch\(/.test(script), '공통 규칙 사용');
    const insert = /INSERT INTO cleaning_jobs\s*\(([^)]*)\)/.exec(script)[1];
    assert.ok(/dispatch_after/.test(insert), '발송 시각 저장');
    assert.ok(!/<=\s*14\b/.test(script), '14일 규칙을 따로 두지 않는다');
  });

  test('백필: 지난 퇴실은 새 작업을 만들지 않고 이미 있는 작업의 추적 필드만 보강, 앞으로의 퇴실은 KST 날짜로 만든다', () => {
    const script = read('scripts/backfill-real-reservations.mjs');
    const jobInsertAt = script.indexOf('INSERT INTO cleaning_jobs');
    const past = /if \(reservation\.checkOut\.getTime\(\) < Date\.now\(\)\) \{([\s\S]*?)\n {6}\}/.exec(script);
    assert.ok(past && past.index < jobInsertAt, '작업을 만들기 전에 지난 퇴실을 따로 처리한다');
    assert.ok(past.index > script.indexOf('INSERT INTO property_reservations'), '예약 기록은 지난 것도 그대로 저장한다');
    const branch = past[1];
    assert.ok(!/INSERT/.test(branch), '지난 퇴실에 새 작업을 만들지 않는다');
    assert.ok(/UPDATE cleaning_jobs/.test(branch) && /reservation_uid=COALESCE\(reservation_uid, \$3\)/.test(branch)
      && /source_ref=COALESCE\(source_ref, \$4\)/.test(branch), '이미 있는 작업은 upsert 와 같은 값으로 보강(레거시로 잘못 찍히지 않게)');
    assert.ok(/WHERE property_id=\$1 AND checkout_at=\$2/.test(branch) && /continue;/.test(branch));
    assert.ok(/const date = toKstDateKey\(reservation\.checkOut\);/.test(script), 'KST 날짜');
    assert.ok(!/toISOString\(\)\.slice\(0, 10\)/.test(script), 'UTC 날짜를 쓰지 않는다');
  });

  test('크론은 청소 시작이 이미 지난 "요청 전" 작업을 발송하지 않는다(어떤 경로로 만들어졌든 마지막 확인)', () => {
    const cron = read('api/cron/[...slug].js');
    const ast = parse(cron, { sourceType: 'module' });
    const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'handleCleaningFollowup');
    const body = cron.slice(node.start, node.end);
    const ready = /const \{ rows: readyJobs \} = await db\.query\(\s*`([^`]*)`/.exec(body);
    assert.ok(ready, 'readyJobs 조회');
    assert.ok(/status = 'PENDING'/.test(ready[1]) && /dispatch_after <= NOW\(\)/.test(ready[1]));
    assert.ok(/cleaning_start_at > NOW\(\)/.test(ready[1]), '시작이 지난 작업 제외');
  });

  test('cleaning_jobs 를 만드는 곳은 발송 시각을 정하거나, 따로 정하는 이유가 있는 곳뿐이다', () => {
    const sites = {
      'api/cleaning/[...slug].js': read('api/cleaning/[...slug].js'),
      'api/cron/[...slug].js': read('api/cron/[...slug].js'),
      'scripts/backfill-real-reservations.mjs': read('scripts/backfill-real-reservations.mjs'),
      'scripts/seed-simulated-data.mjs': read('scripts/seed-simulated-data.mjs'),
    };
    // 이유가 있는 예외: 월간 크론은 다음 달 작업만 만들고 같은 실행의 [4] 단계가 발송 일정을 잡는다 / 시드는 SIMULATED(외부 발송 없음)
    const exempt = { 'api/cron/[...slug].js': /\[4\] 다음 달 PENDING job → dispatch_after 설정/, 'scripts/seed-simulated-data.mjs': /SIMULATED/ };
    let count = 0;
    for (const [file, text] of Object.entries(sites)) {
      for (const match of text.matchAll(/INSERT INTO cleaning_jobs\s*\(([^)]*)\)/g)) {
        count++;
        if (/dispatch_after/.test(match[1])) continue;
        assert.ok(exempt[file], `${file}: 발송 시각 없이 작업을 만든다`);
        assert.ok(exempt[file].test(text), `${file}: 예외 이유가 코드에 남아 있어야 한다`);
      }
    }
    assert.equal(count, 5, '작업을 만드는 곳이 늘거나 줄면 이 목록을 다시 확인한다');
  });
});
