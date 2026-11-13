/**
 * s117 — 청소 관리 › 절차 점검(RF-18): 실제 청소 절차를 순서대로 확인하는 화면
 *
 * 사용자 지시(2026-11-12): "6단계 절차 자체가 잘못됐다 — 청소 예약 캘린더는 호스트가 반복 일정으로 만들고, 블로커를 쫙 깔고,
 * 예약 일정에 맞춰 블로커를 지우는 방식", "임시 기능 없이 원래 로직대로 타보자".
 * 옛 테스트 플로우는 가짜 일정을 만들고(예약 연결 규칙에 막혀 실패), 실제 일정을 취소하고, 담당자를 비활성화할 수 있었다.
 * 새 화면: ① 연결 확인 ② 날짜별 칸 상태 ③ 청소 일정·요청 예정일 ④ 실제 일정으로 진행(원래 수동 발송 경로, 확인 체크 뒤에만).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import {
  connectionChecks, dayLabel, jobDaySlot, jobStatusLabel, kstDay, monthShouldBeBlocked, requestProgressRows, requestScheduleCheck, slotDayRows,
} from '../../src/domain/cleaningProcessCheckDomain.js';
import { OPERATOR_ALLOWED } from '../../api/cleaning/[...slug].js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const DAY = 86_400_000;
const at = (day, hh = '11:00') => new Date(`${day}T${hh}:00+09:00`).toISOString();

describe('① 연결 확인', () => {
  test('예약 피드·캘린더·예약 링크·자동 배정 알림을 사람 말로, 빠진 것은 빨강', () => {
    const now = Date.parse('2026-11-13T00:00:00Z');
    const all = connectionChecks({ ical_configured: true, google_calendar_id: 'cal', google_calendar_booking_url: 'https://x' },
      { status: 'active', expiration: String(now + 3 * DAY) }, now);
    assert.deepEqual(all.map(c => c.level), ['ok', 'ok', 'ok', 'ok']);
    assert.match(all[3].detail, /3일 남음/);
    const none = connectionChecks({}, { status: 'expired' }, now);
    assert.deepEqual(none.map(c => c.level), ['bad', 'bad', 'bad', 'bad']);
    assert.match(none[2].detail, /예약 링크가 없어 담당자가 칸을 예약할 수 없어요/);
  });

  test('구독 만료 기록이 없으면 고장으로 단정하지 않고 안내로', () => {
    const [, , , watch] = connectionChecks({ google_calendar_id: 'cal' }, { status: 'unknown' });
    assert.equal(watch.level, 'info');
    assert.match(watch.detail, /캘린더 다시 확인/);
  });
});

describe('② 날짜별 칸 상태 — 원래 절차: 퇴실 없는 날·요청 전은 막힘, 요청 보낸 날만 열림', () => {
  const today = '2026-11-28';
  const job = (day, status, extra = {}) => ({ checkout_at: at(day), status, dispatch_after: at('2026-12-01'), ...extra });
  const rowOf = (result, day) => result.rows.find(row => row.day === day);

  test('정상: 퇴실 없는 날 막힘, 요청 전 퇴실 막힘, 요청 중 퇴실 열림 → 확인 필요 0', () => {
    const result = slotDayRows({ today, days: 4, blockedDays: ['2026-11-28', '2026-11-29', '2026-11-30'],
      jobs: [job('2026-11-29', 'PENDING'), job('2026-12-01', 'NOTIFYING_VIP_1')] });
    assert.equal(rowOf(result, '2026-11-28').level, 'ok');
    assert.match(rowOf(result, '2026-11-29').note, /요청 전 · 칸 막힘\(12\/1\(화\) 요청할 때 열려요\)/);
    assert.equal(rowOf(result, '2026-12-01').level, 'ok', '요청 중인 날은 열림이 정상');
    assert.match(rowOf(result, '2026-12-01').note, /요청 중 · 칸 열림/);
    const notYet = slotDayRows({ today: '2026-11-13', start: '2026-12-02', days: 1, blockedDays: [], jobs: [] });
    assert.equal(notYet.rows[0].level, 'info', '다음 달은 이번 달 15일 전엔 아직 막기 전(안내)');
    assert.equal(result.summary.checkoutDays, 2);
    assert.equal(result.summary.problems, 0);
  });

  test('요청이 나갔는데 칸이 막혀 있으면 빨강(담당자가 예약할 수 없음)', () => {
    const result = slotDayRows({ today, days: 2, blockedDays: ['2026-11-28', '2026-11-29'], jobs: [job('2026-11-29', 'NOTIFYING_VIP_2')] });
    assert.equal(rowOf(result, '2026-11-29').level, 'bad');
    assert.match(rowOf(result, '2026-11-29').note, /담당자가 예약할 수 없어요/);
    assert.equal(result.summary.problems, 1);
  });

  test('퇴실이 없는데 열려 있거나, 요청 전인데 이미 열려 있으면 주황(요청 순서와 상관없이 예약될 수 있음)', () => {
    const result = slotDayRows({ today, days: 3, blockedDays: ['2026-11-28'], jobs: [job('2026-11-30', 'PENDING')] });
    assert.equal(rowOf(result, '2026-11-29').level, 'warn');
    assert.match(rowOf(result, '2026-11-29').note, /퇴실이 없는데 칸이 열려 있어요/);
    assert.equal(rowOf(result, '2026-11-30').level, 'warn');
    assert.match(rowOf(result, '2026-11-30').note, /요청 전인데 칸이 이미 열려 있어요/);
  });

  test('취소된 일정은 퇴실로 보지 않는다(운영자가 취소하며 칸을 다시 막음) / 배정 완료는 열림이 정상', () => {
    const result = slotDayRows({ today, days: 3, blockedDays: ['2026-11-28', '2026-11-29'],
      jobs: [job('2026-11-29', 'CANCELLED'), job('2026-11-30', 'ASSIGNED', { cleaner_name: '김담당' })] });
    assert.equal(rowOf(result, '2026-11-29').checkout, false);
    assert.equal(rowOf(result, '2026-11-29').level, 'ok');
    assert.match(rowOf(result, '2026-11-30').note, /배정 완료 \(김담당\)/);
  });

  test('그 달 칸 막기는 날짜로 판단 — 15일 작업이 실패한 달은 숨지 않고 빨강', () => {
    assert.equal(monthShouldBeBlocked('2026-11', '2026-11-13'), true, '이번 달');
    assert.equal(monthShouldBeBlocked('2026-12', '2026-11-14'), false, '다음 달은 15일 전엔 아직');
    assert.equal(monthShouldBeBlocked('2026-12', '2026-11-15'), true, '15일부터는 막혔어야');
    assert.equal(monthShouldBeBlocked('2027-01', '2026-12-20'), true, '해 넘김');
    const failed = slotDayRows({ today: '2026-11-20', start: '2026-12-01', days: 3, blockedDays: [], jobs: [] });
    assert.deepEqual(failed.summary.unblockedMonths, ['2026-12']);
    assert.equal(failed.rows[0].level, 'warn', '막혔어야 하는 날이 열려 있음');
    const fine = slotDayRows({ today: '2026-11-20', start: '2026-12-01', days: 3, blockedDays: ['2026-12-01', '2026-12-02', '2026-12-03'], jobs: [] });
    assert.deepEqual(fine.summary.unblockedMonths, []);
  });

  test('같은 날 청소 일정이 여럿이면 더 심한 쪽을 보이고 따로 알린다(퇴실 하나에 일정 하나)', () => {
    const result = slotDayRows({ today, days: 2, blockedDays: ['2026-11-28', '2026-11-29'], jobs: [
      job('2026-11-29', 'PENDING'), { ...job('2026-11-29', 'NOTIFYING_BULK'), checkout_at: at('2026-11-29', '12:00') }] });
    const row = rowOf(result, '2026-11-29');
    assert.equal(row.level, 'bad', '요청 중인데 막힌 쪽이 더 심함');
    assert.match(row.note, /같은 날 청소 일정이 2개예요/);
    // 둘 다 정상(요청 전·막힘)이어도 일정이 둘이면 그 자체로 확인 필요
    const twoPending = slotDayRows({ today, days: 2, blockedDays: ['2026-11-28', '2026-11-29'], jobs: [
      job('2026-11-29', 'PENDING'), { ...job('2026-11-29', 'PENDING'), checkout_at: at('2026-11-29', '12:00') }] });
    assert.equal(rowOf(twoPending, '2026-11-29').level, 'warn');
  });

  test('4단계의 그날 칸은 2단계와 같은 규칙(6주 밖 일정도 그날만 조회한 결과로)', () => {
    const far = { checkout_at: at('2027-08-06'), status: 'PENDING', dispatch_after: at('2027-07-23') };
    const row = jobDaySlot({ today: '2026-11-13', job: far, blockedDays: [] });
    assert.equal(row.day, '2027-08-06');
    assert.equal(row.level, 'info', '그 달 칸은 아직 막기 전');
    const assigned = { checkout_at: at('2026-11-29'), status: 'ASSIGNED' };
    assert.equal(jobDaySlot({ today: '2026-11-13', job: assigned, blockedDays: ['2026-11-29'] }).level, 'warn', '2단계와 같은 판단');
  });

  test('요청 예정일이 지났는데 아직 요청 전이면 빨강 — 매일 요청 작업이 멈춘 것(하루 두 번 도는 작업 간격 14시간까지는 정상)', () => {
    const now = Date.parse('2026-11-28T12:00:00+09:00');
    const stuck = slotDayRows({ today, now, days: 2, blockedDays: ['2026-11-28', '2026-11-29'],
      jobs: [job('2026-11-29', 'PENDING', { dispatch_after: at('2026-11-15') })] });
    assert.equal(rowOf(stuck, '2026-11-29').level, 'bad');
    assert.match(rowOf(stuck, '2026-11-29').note, /요청 예정일\(11\/15\(일\)\)이 지났는데 아직 요청 전이에요/);
    const justDue = slotDayRows({ today, now, days: 2, blockedDays: ['2026-11-28', '2026-11-29'],
      jobs: [job('2026-11-29', 'PENDING', { dispatch_after: new Date(now - 10 * 3_600_000).toISOString() })] });
    assert.equal(rowOf(justDue, '2026-11-29').level, 'ok', '10시간 전 예정은 다음 요청 작업이 보낸다');
    const check = requestScheduleCheck({ status: 'PENDING', cleaning_start_at: at('2026-11-29'), dispatch_after: at('2026-11-15') }, now);
    assert.equal(check.ok, false);
    assert.match(check.note, /요청 작업이 멈췄을 수 있어요/);
  });

  test('칸 막기 실패 판단은 막혀 있어야 하는 날이 있을 때만 — 보이는 날이 모두 요청 나간 날이면 경고 안 함', () => {
    const endOfMonth = slotDayRows({ today: '2026-11-30', start: '2026-11-30', days: 1, blockedDays: [],
      jobs: [job('2026-11-30', 'NOTIFYING_VIP_1')] });
    assert.deepEqual(endOfMonth.summary.unblockedMonths, []);
  });

  test('날짜는 한국 날짜 — 퇴실 11시(한국)가 그날로 잡힌다, 기본 6주', () => {
    assert.equal(kstDay('2026-11-29T02:00:00Z'), '2026-11-29');
    assert.equal(kstDay('2026-11-28T15:30:00Z'), '2026-11-29', '한국 자정 넘으면 다음 날');
    assert.equal(slotDayRows({ today, jobs: [], blockedDays: [] }).rows.length, 42);
    assert.equal(dayLabel('2026-11-29'), '11/29(일)');
  });
});

describe('③ 청소 일정과 요청 예정일', () => {
  test('상태를 사람 말로', () => {
    assert.equal(jobStatusLabel({ status: 'NOTIFYING_VIP_1' }), '1순위 담당자에게 요청 중');
    assert.equal(jobStatusLabel({ status: 'ASSIGNED', cleaner_name: '김담당' }), '배정 완료 — 김담당');
    assert.match(jobStatusLabel({ status: 'PENDING', dispatch_after: at('2026-11-29') }), /11\/29\(일\) 요청 예정/);
    assert.equal(jobStatusLabel({ status: 'ESCALATED' }), '배정 실패 — 직접 배정이 필요해요');
  });

  test('요청 예정일이 청소 2주 전 규칙과 맞는지(만들 때 2주 안이었으면 바로, 같은 날 10분 간격은 같은 것으로)', () => {
    const start = at('2026-12-13');
    const created = '2026-10-12T12:00:00Z';
    const now = Date.parse('2026-10-12T13:00:00Z'); // 일정을 만든 직후에 본다(예정일이 아직 안 지남)
    assert.equal(requestScheduleCheck({ status: 'PENDING', cleaning_start_at: start, created_at: created,
      dispatch_after: new Date(Date.parse(start) - 14 * DAY + 10 * 60_000).toISOString() }, now).ok, true);
    const early = requestScheduleCheck({ status: 'PENDING', cleaning_start_at: start, created_at: created, dispatch_after: created }, now);
    assert.equal(early.ok, false);
    assert.match(early.note, /규칙\(11\/29\(일\)\)보다 일찍/);
    assert.equal(requestScheduleCheck({ status: 'ASSIGNED' }).ok, true, '요청이 이미 나간 일정은 대상 아님');
    assert.deepEqual(requestScheduleCheck({ status: 'PENDING', cleaning_start_at: start, dispatch_after: null }), { ok: false, note: '요청 예정일이 없어요' });
    const seventh = new Date(Date.parse(start) - 14 * DAY + 70 * 60_000).toISOString();
    assert.equal(requestScheduleCheck({ status: 'PENDING', cleaning_start_at: start, created_at: created, dispatch_after: seventh }, now).ok, true,
      '같은 날 7번째(70분 뒤)도 규칙대로');
  });

  test('요청 기록은 순서대로, 연락처 없이', () => {
    const rows = requestProgressRows([
      { tier: 'VIP_2', cleaner_name: '이담당', sent_at: '2026-11-15T13:43:00Z', response: null, phone: '010-0000-0000' },
      { tier: 'VIP_1', cleaner_name: '김담당', sent_at: '2026-11-15T12:43:00Z', response: 'DECLINED' },
    ]);
    assert.deepEqual(rows.map(r => r.who), ['1순위 김담당', '2순위 이담당']);
    assert.equal(rows[0].answer, '거절');
    assert.ok(!JSON.stringify(rows).includes('010'), '연락처를 싣지 않는다');
  });
});

describe('④ 화면 — 원래 절차만 쓰고, 실제 요청은 확인 체크 뒤에만', () => {
  const panel = read('src/components/v2/CleaningProcessCheck.jsx');
  const manager = read('src/components/v2/CleaningManager.jsx');

  test('옛 테스트 플로우(가짜 일정·취소·담당자 비활성화·상태 초기화)는 없다', () => {
    assert.ok(!/function TestFlowPanel/.test(manager));
    assert.match(manager, /\{tab === 'test' && !isOperator && <CleaningProcessCheck apiFetch=\{apiFetch\} \/>\}/);
    assert.match(manager, /const visibleTabs = TABS\.filter\(t => !\(isOperator && t\.key === 'test'\)\);/, '운영자에겐 탭 자체를 숨김');
    assert.match(manager, /\{visibleTabs\.map\(t => \{/);
    assert.match(manager, /label: '🧪 절차 점검'/);
    for (const forbidden of [/checkouts:\s*\[/, /status: 'CANCELLED'/, /method: 'DELETE'/, /_test_reset/, /\/api\/cleaning\/cleaners/]) {
      assert.ok(!forbidden.test(panel), `절차 점검 화면에 ${forbidden} 가 있으면 안 된다`);
    }
  });

  test('1~3단계는 읽기(GET): 숙소·캘린더 알림 구독·숙소별 청소 일정·막힌 칸·구글 캘린더', () => {
    for (const path of ['/api/cleaning/properties', '/api/cleaning/calendar-watch?calendar_id=', '/api/cleaning/jobs?property_id=',
      '/api/cleaning/blockers?property_id=', '/api/cleaning/calendar-scan?calendar_id=']) {
      assert.ok(panel.includes(path), path);
    }
    const posts = [...panel.matchAll(/apiFetch\('([^']+)', \{ method: 'POST'/g)].map(m => m[1]);
    assert.deepEqual(posts.sort(), ['/api/cleaning/calendar-scan', '/api/cleaning/dispatch'], '쓰기는 원래 절차의 수동 발송·캘린더 다시 확인 두 가지뿐');
  });

  test('실제 요청은 요청 전 일정에서, 확인 체크를 한 뒤에만', () => {
    const ast = parse(panel, { sourceType: 'module', plugins: ['jsx'] });
    const body = (() => {
      let found = '';
      JSON.stringify(ast, (key, value) => {
        if (value?.type === 'FunctionDeclaration' && value.id?.name === 'sendRequestNow') found = panel.slice(value.start, value.end);
        return value;
      });
      return found;
    })();
    assert.match(body, /if \(!selectedJob \|\| selectedJob\.status !== 'PENDING' \|\| !confirmed\) return;/);
    assert.ok(body.indexOf("'/api/cleaning/dispatch'") > body.indexOf('!confirmed'));
    assert.match(panel, /disabled=\{!confirmed \|\| busy\}/);
    assert.match(panel, /실제 담당자에게 요청이 가는 것을 확인했어요/);
  });

  test('판단 규칙은 도메인에 — 화면은 표시만(4단계 그날 칸도 같은 규칙)', () => {
    assert.match(panel, /from '\.\.\/\.\.\/domain\/cleaningProcessCheckDomain\.js'/);
    for (const fn of ['connectionChecks(', 'slotDayRows(', 'jobDaySlot(', 'requestScheduleCheck(', 'requestProgressRows(', 'jobStatusLabel(']) {
      assert.ok(panel.includes(fn), fn);
    }
    assert.ok(!/blockedDays\.includes\(/.test(panel), '화면에서 칸 판단을 따로 하지 않는다');
  });

  test('숙소별·오늘 이후 일정만 서버에서 받는다(200건 제한에 가까운 일정이 잘리지 않게), 늦게 온 옛 숙소 응답은 버린다', () => {
    assert.match(panel, /\/api\/cleaning\/jobs\?property_id=\$\{encodeURIComponent\(target\)\}&from=\$\{today\}&limit=200/);
    assert.match(panel, /const seq = \+\+loadSeq\.current;/);
    assert.match(panel, /if \(seq !== loadSeq\.current\) return;/);
  });

  test('일정을 빠르게 바꿀 때 옛 일정 응답은 버리고, 구글 확인은 이 숙소의 칸만 센다', () => {
    assert.match(panel, /const seq = \+\+selectSeq\.current;/);
    assert.match(panel, /if \(seq !== selectSeq\.current\) return;/);
    assert.match(panel, /calendar-scan\?calendar_id=\$\{encodeURIComponent\(property\.google_calendar_id\)\}&date=\$\{day\}&property_id=/);
  });

  test('운영자 계정이면 관리자 전용 안내만(가려진 정보로 거짓 경고를 띄우지 않게)', () => {
    assert.match(panel, /const me = await apiFetch\('\/api\/auth\/me'\)/);
    assert.match(panel, /if \(me\?\.required && me\?\.role === 'operator'\) \{ setAdminOnly\(true\); return; \}/);
    assert.match(panel, /청소 절차 점검은 관리자만 쓸 수 있어요/);
    assert.match(panel, /if \(\/관리자만\/\.test\(e\.message\)\) setAdminOnly\(true\);/, '로그인 확인이 실패해도 서버가 막으면 안내로');
  });

  test('단계 버튼은 배경·테두리·레이블을 모두 갖춘다', () => {
    const stepButton = panel.slice(panel.indexOf('<button onClick={onToggle}'), panel.indexOf('</button>', panel.indexOf('<button onClick={onToggle}')));
    assert.match(stepButton, /background: open \?/);
    assert.match(stepButton, /border: open \? '2px solid #2563eb' : '1\.5px solid #e2e8f0'/);
    assert.ok(!/border: 'none'/.test(stepButton));
  });
});

describe('서버 — 새 조회는 읽기 전용·관리자 전용', () => {
  const api = read('api/cleaning/[...slug].js');
  const ast = parse(api, { sourceType: 'module' });
  const load = (name, deps) => {
    const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
    return new Function(...Object.keys(deps), `return (${api.slice(node.start, node.end)});`)(...Object.values(deps));
  };

  test('막힌 칸 목록: 운영자 허용 목록에 없다(관리자 전용), 날짜 형식 검사, 숙소·기간으로만 읽는다', async () => {
    assert.ok(!OPERATOR_ALLOWED.has('GET blockers'));
    const queries = [];
    const sendJson = (_res, code, body) => ({ code, body });
    const listBlockers = load('listBlockers', {
      db: { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [{ day: '2026-11-29' }] }; } }, sendJson,
    });
    assert.equal((await listBlockers({ query: { property_id: '파주201', from: '2026-11-13', to: 'x' } }, {})).code, 400);
    const ok = await listBlockers({ query: { property_id: '파주201', from: '2026-11-13', to: '2026-12-24' } }, {});
    assert.deepEqual(ok, { code: 200, body: { property_id: '파주201', days: ['2026-11-29'] } });
    assert.match(queries[0].sql, /^\s*SELECT block_date::text AS day FROM property_calendar_blockers/);
    assert.deepEqual(queries[0].params, ['파주201', '2026-11-13', '2026-12-24']);
  });

  test('구글 캘린더 읽기(수동 스캔 GET)는 PROPOS 블로커 수도 돌려주고 아무것도 바꾸지 않는다', () => {
    const scan = api.slice(api.indexOf('async function handleCalendarScan'), api.indexOf('// POST: ASSIGNED 업데이트'));
    assert.match(scan, /ev\.extendedProperties\?\.private\?\.propos === "blocker"\s*&& \(!scanPropertyId \|\| ev\.extendedProperties\?\.private\?\.property_id === scanPropertyId\)/,
      '캘린더를 여러 숙소가 같이 써도 이 숙소의 블로커만');
    assert.ok(!/UPDATE |INSERT |DELETE /.test(scan.slice(scan.indexOf('if (req.method !== "POST")'))), 'GET 쪽은 읽기만');
  });

  test('캘린더 알림 구독 만료 시각 — 수동 등록·자동 갱신이 같은 함수로 남기고, 만료 뒤 2주 보관', async () => {
    const cron = read('api/cron/[...slug].js');
    assert.match(cron, /await saveCalendarWatchExpiration\(kv, calId, watched\?\.expiration\);/);
    assert.match(api, /await saveCalendarWatchExpiration\(kv, calendarId, result\.expiration\);/);
    assert.match(api, /kv\.get\(`calendar_watch_expiration:\$\{calendarId\}`\)/, '화면이 묻는 자리와 같은 키');
    const { saveCalendarWatchExpiration } = await import('../../server/cleaning/_calendar.js');
    const writes = [];
    const expiration = String(Date.now() + 6 * DAY);
    await saveCalendarWatchExpiration({ set: async (key, value, options) => { writes.push({ key, value, options }); } }, 'cal-1', expiration);
    assert.equal(writes[0].key, 'calendar_watch_expiration:cal-1');
    assert.ok(writes[0].options.ex >= 19 * 86_400, '만료(6일) + 2주 동안 남는다');
    const attempts = [];
    const recorder = { set: async (...args) => { attempts.push(args); } };
    await saveCalendarWatchExpiration(recorder, 'cal-1', undefined);
    const originalError = console.error; console.error = () => {};
    try { await saveCalendarWatchExpiration(recorder, 'cal-1', 'not-a-number'); } finally { console.error = originalError; }
    assert.deepEqual(attempts, [], '만료 시각이 없거나 형식이 이상하면 기록하지 않는다(옛 기록을 엉뚱한 값으로 덮지 않게)');
  });

  test('청소 일정 목록: 숙소·날짜 거르기는 서버에서, 날짜 형식은 검사', async () => {
    const queries = [];
    const listJobs = load('listJobs', {
      runFollowupChecks: async () => {}, scopeQueryIds: () => null, console,
      db: { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } },
      sendJson: (_res, code, body) => ({ code, body }),
    });
    await listJobs({ query: { property_id: '파주201', from: '2026-11-13', limit: '200' } }, {}, {});
    assert.match(queries[0].sql, /j\.property_id=\$1 AND \(j\.checkout_at AT TIME ZONE 'Asia\/Seoul'\)::date >= \$2::date/);
    assert.match(queries[0].sql, /ORDER BY j\.cleaning_start_at ASC LIMIT 200/, '날짜부터 볼 때는 가까운 순서(200건 제한에 가까운 일정이 잘리지 않게)');
    assert.deepEqual(queries[0].params, ['파주201', '2026-11-13']);
    await listJobs({ query: { from: '2026-11-13; DROP' } }, {}, {});
    assert.deepEqual(queries[1].params, [], '형식이 틀린 날짜는 무시');
  });
});
