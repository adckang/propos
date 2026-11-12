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

// 예약 가져오기는 화면 API·정기 작업이 같이 쓰는 공용 모듈(RF-20)
const icalSyncSource = read('server/cleaning/_icalSync.js');
const icalSyncAst = parse(icalSyncSource, { sourceType: 'module' });
function exportedFunctionNode(ast, name) {
  return ast.program.body.find(n => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'FunctionDeclaration'
    && n.declaration.id?.name === name)?.declaration;
}
function loadSync(deps) {
  const node = exportedFunctionNode(icalSyncAst, 'syncAllPropertiesIcal');
  assert.ok(node, 'syncAllPropertiesIcal 없음');
  // 전체(syncAllPropertiesIcal) + 숙소 하나(syncOneProperty) 를 함께 — 모듈 끝까지가 두 함수다
  const body = icalSyncSource.slice(node.start);
  return new Function(...Object.keys(deps), `${body}\nreturn syncAllPropertiesIcal;`)(...Object.values(deps));
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
    const inserts = [], opened = [];
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
      kv: {}, openCleaningSlot: async (_db, { date }) => { opened.push(date); return true; },
      console: { error() {} },
    };
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    const before = Date.now();
    await load('syncJobs', deps)({ method: 'POST' }, res);
    return { res, inserts, opened, before, after: Date.now() };
  }

  const dispatchParam = insert => {
    const columns = /\(([^)]*)\)\s*VALUES/.exec(insert.sql)[1].split(',').map(s => s.trim());
    const index = columns.indexOf('dispatch_after');
    assert.ok(index >= 0, 'INSERT 에 dispatch_after 가 없다 — DB 기본값(지금)이 들어가 다음 크론이 바로 보낸다');
    return new Date(insert.params[index]);
  };

  test('200일 뒤 퇴실: 시작 14일 전에 요청하도록 저장한다', async () => {
    const date = kstDay(200);
    const { res, inserts, opened } = await runSyncJobs([{ date, uid: 'uid-far' }]);
    assert.equal(res.code, 200);
    assert.equal(inserts.length, 1);
    const start = calcCleaningTimes(date, 11, 2.5).cleaning_start_at;
    assert.equal(dispatchParam(inserts[0]).toISOString(), new Date(start.getTime() - 14 * DAY).toISOString());
    assert.ok(inserts[0].params.includes('MONTHLY_BATCH'));
    assert.deepEqual(opened, [], '먼 일정의 칸은 요청 날 열린다(DEC-07) — 지금 열지 않는다');
  });

  test('지난 퇴실: 작업을 만들지 않고(블로커도 그대로) 건너뛴 건수로 센다', async () => {
    const { res, inserts } = await runSyncJobs([{ date: kstDay(-2), uid: 'uid-past' }, { date: kstDay(30), uid: 'uid-next' }]);
    assert.equal(res.code, 200);
    assert.deepEqual({ created: res.body.created, skipped: res.body.skipped }, { created: 1, skipped: 1 });
    assert.equal(inserts.length, 1);
    assert.ok(inserts[0].params.includes('uid-next'));
  });

  test('3일 뒤 퇴실: 바로 요청(SHORT_NOTICE)', async () => {
    const { inserts, opened, before, after } = await runSyncJobs([{ date: kstDay(3), uid: 'uid-near' }]);
    const at = dispatchParam(inserts[0]).getTime();
    assert.ok(at >= before - 1000 && at <= after + 1000, '지금 요청');
    assert.ok(inserts[0].params.includes('SHORT_NOTICE'));
    assert.deepEqual(opened, [kstDay(3)], '바로 요청할 일정은 칸도 바로 연다');
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
      openCleaningSlot: async () => true,
      fetch: async () => ({ ok: true, text: async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR' }),
      parseVEvents: () => [], airbnbEventsToReservations: () => reservations,
      reservationUidOf, retireAfterSync: async () => ({}), isCompleteCalendar: () => true,
      alertGoneCheckouts: async () => {},
      toKstDateKey, calcCleaningTimes, planJobDispatch,
      advanceJob: async () => {}, postSlack: async () => true,
      console: { error() {} },
    };
    await loadSync(deps)(deps.db, { kv: {} });
    return inserts;
  }

  test('숙소 하나에서 오류가 나도 다른 숙소의 예약 가져오기는 계속된다(정기 작업이 혼자 돈다)', async () => {
    const jobs = [], errors = [];
    const date = kstDay(40);
    const reservations = [{ uid: 'uid-0', guestName: null, platform: 'Airbnb',
      checkIn: new Date(new Date(`${date}T15:00:00+09:00`).getTime() - 2 * DAY), checkOut: new Date(`${date}T11:00:00+09:00`) }];
    const db = { query: async (sql, params) => {
      if (sql.includes('FROM property_cleaning_config')) {
        return { rows: ['A숙소', 'B숙소'].map(id => ({ property_id: id, name: id, ical_url: `https://example.invalid/${id}`, checkout_hour: 11, cleaning_duration_hours: 2.5 })) };
      }
      if (sql.includes('SELECT NOW()')) return { rows: [{ now: new Date() }] };
      if (sql.includes('INSERT INTO property_reservations')) {
        if (params[0] === 'A숙소') throw Object.assign(new Error('저장 거절'), { code: '23514' });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO cleaning_jobs')) { jobs.push(params[0]); return { rowCount: 0, rows: [] }; }
      throw new Error(`예상하지 못한 쿼리: ${sql.slice(0, 60)}`);
    } };
    const deps = {
      openCleaningSlot: async () => true, fetch: async () => ({ ok: true, text: async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR' }),
      parseVEvents: () => [], airbnbEventsToReservations: () => reservations,
      reservationUidOf, retireAfterSync: async () => ({}), isCompleteCalendar: () => true, alertGoneCheckouts: async () => {},
      toKstDateKey, calcCleaningTimes, planJobDispatch, advanceJob: async () => {}, postSlack: async () => true,
      console: { error: (...a) => errors.push(a.join(' ')) },
    };
    await loadSync(deps)(db, { kv: {} });
    assert.deepEqual(jobs, ['B숙소'], 'A숙소가 실패해도 B숙소는 청소 일정까지 간다');
    assert.ok(errors.some(e => e.includes('A숙소')), 'A숙소 실패는 기록');
  });

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

describe('월간 배치(매월 15일) — 실제 핸들러 실행 (RF-19, 시나리오 S01: 요청은 청소 2주 전)', () => {
  const cronSource = read('api/cron/[...slug].js');
  const cronAst = parse(cronSource, { sourceType: 'module' });
  function loadCron(name, deps) {
    const node = cronAst.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
    assert.ok(node, `${name} 없음`);
    return new Function(...Object.keys(deps), `return (${cronSource.slice(node.start, node.end)});`)(...Object.values(deps));
  }
  const start = date => calcCleaningTimes(date, 11, 3).cleaning_start_at;

  async function runMonthly({ checkouts, pendingJobs, failInsertOn = [], google = false, monthDates = null, requestedDays = [] }) {
    const inserts = [], updates = [], blockerDeletes = [], errors = [], slack = [], ranges = [], blockersMade = [];
    const db = { query: async (sql, params) => {
      if (sql.includes('FROM property_cleaning_config')) {
        return { rows: [{ property_id: '파주201', name: '파주201', ical_url: 'https://example.invalid/ical', checkout_hour: 11,
          cleaning_duration_hours: 3, google_calendar_id: google ? 'calendar-1' : null, data_origin: 'REAL' }] };
      }
      if (sql.includes('SELECT 1 FROM property_calendar_blockers')) return { rows: [] };
      if (sql.includes('INSERT INTO property_calendar_blockers')) { blockersMade.push(params[1]); return { rowCount: 1, rows: [] }; }
      if (sql.includes('INSERT INTO cleaning_jobs')) {
        inserts.push({ sql, params });
        if (failInsertOn.some(date => params[2] === start(date).toISOString())) {
          throw Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
        }
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('DELETE FROM property_calendar_blockers')) { blockerDeletes.push(params[1]); return { rows: [] }; }
      if (sql.includes('SELECT * FROM cleaning_jobs')) { ranges.push(params); return { rows: pendingJobs }; }
      if (sql.includes('UPDATE cleaning_jobs SET dispatch_after')) {
        updates.push({ sql, params });
        return { rowCount: pendingJobs.find(j => j.id === params[1])?.movedOn ? 0 : 1, rows: [] };
      }
      throw new Error(`예상하지 못한 쿼리: ${sql.slice(0, 60)}`);
    } };
    const deps = {
      getGoogleToken: async () => { if (!google) throw new Error('no google in test'); return 'token'; }, kv: {},
      getNextMonthDates: () => monthDates ?? [checkouts[0]], createBlockerEvent: async () => 'evt', deleteBlockerEvent: async () => {},
      fetch: async () => ({ ok: true, text: async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR' }),
      parseCheckoutsFromIcal: () => checkouts.map((date, i) => ({ date, uid: `uid-${i}` })),
      calcCleaningTimes, planJobDispatch, toKstDateKey,
      requestedCleaningDays: async () => new Set(requestedDays),
      postSlack: async text => { slack.push(text); return true; }, console: { error: (...a) => errors.push(a.join(' ')) },
    };
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await loadCron('handleMonthlyClean', deps)(db, res);
    return { res, inserts, updates, blockerDeletes, errors, slack, ranges, blockersMade };
  }

  test('칸은 요청 보내는 날 연다(DEC-07): 15일 작업은 퇴실 날을 포함해 다음 달 모든 날을 막고 칸을 열지 않는다. 이미 요청이 나갔거나 배정된 날만 막지 않는다', async () => {
    const days = [kstDay(40), kstDay(41), kstDay(42), kstDay(43)];
    const { blockersMade, blockerDeletes, inserts, res } = await runMonthly({
      google: true, monthDates: days, checkouts: [days[1], days[3]], requestedDays: [days[3]], pendingJobs: [],
    });
    assert.equal(res.code, 200);
    assert.deepEqual(blockersMade, [days[0], days[1], days[2]], '퇴실 날(days[1])도 막는다 / 요청이 이미 나간 날(days[3])은 막지 않는다');
    assert.deepEqual(blockerDeletes, [], '15일 작업은 칸을 열지 않는다 — 요청 보내는 날 연다');
    assert.equal(inserts.length, 2, '청소 일정은 그대로 만든다');
  });

  test('새로 만드는 일정은 처음부터 "청소 2주 전" 요청 시각을 저장한다', async () => {
    const date = kstDay(40);
    const { inserts } = await runMonthly({ checkouts: [date], pendingJobs: [] });
    const columns = /\(([^)]*)\)\s*VALUES/.exec(inserts[0].sql)[1].split(',').map(s => s.trim());
    assert.ok(columns.includes('dispatch_after'), '요청 시각을 비워 두지 않는다');
    assert.equal(inserts[0].params[columns.indexOf('dispatch_after')], new Date(start(date).getTime() - 14 * DAY).toISOString());
  });

  test('다음 달 "요청 전" 일정의 요청 시각을 "지금"이 아니라 청소 2주 전으로 잡고, 같은 날 두 번째는 10분 뒤', async () => {
    const d1 = kstDay(40), d2 = kstDay(45);
    const jobs = [{ id: 'j1', cleaning_start_at: start(d1) }, { id: 'j2', cleaning_start_at: start(d1) }, { id: 'j3', cleaning_start_at: start(d2) }];
    const before = Date.now();
    const { updates, res } = await runMonthly({ checkouts: [d1], pendingJobs: jobs });
    assert.equal(res.code, 200);
    const at = Object.fromEntries(updates.map(u => [u.params[1], new Date(u.params[0]).getTime()]));
    assert.equal(at.j1, start(d1).getTime() - 14 * DAY);
    assert.equal(at.j2, start(d1).getTime() - 14 * DAY + 10 * 60_000);
    assert.equal(at.j3, start(d2).getTime() - 14 * DAY);
    for (const value of Object.values(at)) assert.ok(value > before + 7 * DAY, '15일에 바로 요청하지 않는다');
    assert.ok(updates.every(u => /AND status='PENDING'/.test(u.sql)), '그 사이 진행된 일정은 건드리지 않는다');
  });

  test('한 날짜의 일정 생성이 거절돼도(예약 목록에 아직 없는 새 예약) 나머지 날짜의 일정 생성·요청 시각 잡기는 계속한다', async () => {
    const d1 = kstDay(40), d2 = kstDay(41), d3 = kstDay(42);
    const { inserts, blockerDeletes, updates, res, errors, slack } = await runMonthly({
      checkouts: [d1, d2, d3], failInsertOn: [d2], pendingJobs: [{ id: 'j1', cleaning_start_at: start(d1) }],
    });
    assert.equal(res.code, 200);
    assert.equal(inserts.length, 3, '실패한 날 다음 날짜도 일정 생성을 시도');
    assert.deepEqual(blockerDeletes, [], '15일 작업은 칸을 열지 않는다(요청 날 연다)');
    assert.equal(updates.length, 1, '요청 시각 잡기 단계까지 간다');
    assert.ok(errors.some(e => e.includes(d2)), '실패는 기록한다');
    assert.equal(res.body.jobsFailed, 1);
    assert.match(slack[0], /일정 생성 실패 1건/, '운영자 요약에 실패가 보인다');
  });

  test('요약의 "발송 스케줄링" 건수는 실제로 요청 시각을 잡은 일정만 센다(그 사이 진행된 일정 제외)', async () => {
    const d1 = kstDay(40);
    const { res, slack } = await runMonthly({ checkouts: [d1], pendingJobs: [
      { id: 'j1', cleaning_start_at: start(d1) }, { id: 'j2', cleaning_start_at: start(kstDay(41)), movedOn: true },
    ] });
    assert.equal(res.body.scheduled, 1);
    assert.match(slack[0], /발송 스케줄링 1건/);
    assert.doesNotMatch(slack[0], /실패/);
  });

  test('다음 달 범위는 한국 시간 자정부터 다음다음 달 자정 전까지', async () => {
    const { ranges } = await runMonthly({ checkouts: [kstDay(40)], pendingJobs: [] });
    const [from, to] = ranges[0].map(v => new Date(v));
    const kst = d => new Date(d.getTime() + 9 * 3_600_000);
    assert.equal(kst(from).getUTCDate(), 1);
    assert.equal(kst(from).getUTCHours(), 0, '한국 시간 1일 0시');
    assert.equal(kst(to).getUTCDate(), 1);
    assert.equal(kst(to).getUTCHours(), 0);
    const nowKst = kst(new Date());
    assert.equal(kst(from).getUTCMonth(), (nowKst.getUTCMonth() + 1) % 12, '다음 달');
  });
});

describe('소스 계약 — 작업을 만드는 모든 곳', () => {
  test('동기화·관리자 일괄 등록은 planJobDispatch 를 쓰고 14일 규칙을 따로 두지 않는다', () => {
    for (const name of ['syncAllPropertiesIcal', 'syncJobs']) {
      const body = name === 'syncAllPropertiesIcal'
        ? icalSyncSource.slice(exportedFunctionNode(icalSyncAst, name).start) // 전체 + 숙소 하나
        : (node => handlerSource.slice(node.start, node.end))(handlerAst.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name));
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
      'server/cleaning/_icalSync.js': read('server/cleaning/_icalSync.js'),
      'api/cron/[...slug].js': read('api/cron/[...slug].js'),
      'scripts/backfill-real-reservations.mjs': read('scripts/backfill-real-reservations.mjs'),
      'scripts/seed-simulated-data.mjs': read('scripts/seed-simulated-data.mjs'),
    };
    // 이유가 있는 예외: 시뮬레이션 시드는 SIMULATED(외부 발송 없음). 월간 배치도 이제 요청 시각을 저장한다(RF-19)
    const exempt = { 'scripts/seed-simulated-data.mjs': /SIMULATED/ };
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
