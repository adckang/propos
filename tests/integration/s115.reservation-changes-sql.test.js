// PGLITE_TEST_ROOT=/private/tmp/propos-act11-sql node --test tests/integration/s115.reservation-changes-sql.test.js
//
// s115 — 매일 예약 가져오기(RF-20)로 Airbnb 예약의 추가·변경·취소가 청소 일정·칸·요청까지 이어지는지, 실제 코드로 끝까지 돌려 본다.
// 저장소는 연습용(메모리 DB 또는 격리 로컬 DB)이고, 담당자에게 가는 문자·앱 알림·Slack 은 가로챈다(실제로 나가지 않음).
// Airbnb 피드는 테스트가 만든 달력 텍스트를 돌려준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleaningSqlFixture, actualCleaningModule, installDeliveryIO } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const sync = enabled ? await actualCleaningModule('server/cleaning/_icalSync.js') : null;
const recon = enabled ? await actualCleaningModule('server/cleaning/_reservationSync.js') : null;
const dispatch = enabled ? await actualCleaningModule('server/cleaning/_dispatch.js') : null;

const PROPERTY = 'fixture-property';
const ICAL_URL = 'https://example.invalid/airbnb.ics';
const DAY = 86_400_000;
/** 오늘(한국 날짜)부터 days 일 뒤 — 달력 형식 YYYYMMDD 와 'YYYY-MM-DD' */
const kstDate = days => new Date(Date.now() + 9 * 3_600_000 + days * DAY).toISOString().slice(0, 10);
const icalDate = days => kstDate(days).replaceAll('-', '');

/** 예약 목록 → Airbnb 피드 달력 텍스트 */
function feed(reservations) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0',
    ...reservations.flatMap(r => ['BEGIN:VEVENT', `UID:${r.uid}`, `DTSTART;VALUE=DATE:${icalDate(r.in)}`,
      `DTEND;VALUE=DATE:${icalDate(r.out)}`, 'SUMMARY:Reserved', 'END:VEVENT']),
    'END:VCALENDAR'].join('\r\n');
}

async function harness() {
  const f = await createCleaningSqlFixture();
  const io = installDeliveryIO();
  // 운영의 Slack 보내기는 성공하면 true 를 돌려주고, 시스템은 그걸 보고 "이미 알림"으로 기록한다 — 가짜도 같게
  globalThis.__cleaningDeliveryIO.slack = async (...args) => { io.calls.slack.push(args); return true; };
  const fixtureFetch = globalThis.fetch;
  let current = feed([]);
  globalThis.fetch = async (url, options) => (String(url) === ICAL_URL
    ? { ok: true, status: 200, text: async () => current }
    : fixtureFetch(url, options));
  await f.pool.query(`UPDATE property_cleaning_config SET ical_url=$1, checkout_hour=11, cleaning_duration_hours=3 WHERE property_id=$2`,
    [ICAL_URL, PROPERTY]);
  await f.pool.query('DELETE FROM cleaning_jobs WHERE id=$1', [f.jobId]); // 도구가 만든 지난 날짜 작업은 이 시나리오와 무관
  const kvData = new Map();
  const kv = { get: async key => kvData.get(key) ?? null, set: async (key, value) => { kvData.set(key, value); } };
  const h = {
    f, io,
    /** Airbnb 피드를 이 예약들로 바꾸고 정기 작업처럼 예약 가져오기를 한 번 돌린다 */
    async run(reservations) { current = feed(reservations); await sync.syncAllPropertiesIcal(f.pool, { kv }); },
    /** 다음 정기 작업까지 시간이 흐른 것처럼(마지막으로 본 시각을 2시간 앞당김 — "1시간 넘게 안 보인 예약만 정리" 규칙) */
    async later() { await f.pool.query(`UPDATE property_reservations SET last_seen_at = last_seen_at - INTERVAL '2 hours'`); },
    async reservation(uid) {
      return (await f.pool.query('SELECT status, check_out FROM property_reservations WHERE property_id=$1 AND reservation_uid=$2', [PROPERTY, uid])).rows[0];
    },
    async jobOn(days) {
      return (await f.pool.query(`SELECT * FROM cleaning_jobs WHERE property_id=$1 AND (checkout_at AT TIME ZONE 'Asia/Seoul')::date = $2::date`,
        [PROPERTY, kstDate(days)])).rows[0];
    },
    async blockerOn(days) {
      return (await f.pool.query('SELECT 1 FROM property_calendar_blockers WHERE property_id=$1 AND block_date=$2', [PROPERTY, kstDate(days)])).rows.length > 0;
    },
    async addBlocker(days) {
      await f.pool.query(`INSERT INTO property_calendar_blockers(property_id, block_date, event_id) VALUES($1,$2,$3)`, [PROPERTY, kstDate(days), `evt-${days}`]);
    },
    requests: () => io.calls.sms.length + io.calls.push.length,
    slackTexts: () => io.calls.slack.map(args => String(args[0])),
    async close() { io.restore(); globalThis.fetch = fixtureFetch; await f.close(); },
  };
  return h;
}

// ── 추가 ──────────────────────────────────────────────────────────────────

test('추가 — 40일 뒤 퇴실: 예약·청소 일정이 생기고 요청은 청소 2주 전, 칸은 그때까지 막혀 있다', { skip: !enabled }, async () => {
  const h = await harness();
  try {
    await h.addBlocker(40); // 15일 작업이 막아 둔 칸
    await h.run([{ uid: 'far@airbnb', in: 38, out: 40 }]);
    assert.equal((await h.reservation('far@airbnb')).status, 'ACTIVE');
    const job = await h.jobOn(40);
    assert.equal(job.status, 'PENDING');
    assert.equal(job.reservation_uid, 'far@airbnb');
    assert.equal(new Date(job.dispatch_after).getTime(), new Date(job.cleaning_start_at).getTime() - 14 * DAY, '요청은 청소 2주 전');
    assert.equal(h.requests(), 0, '지금 요청하지 않는다');
    assert.equal(await h.blockerOn(40), true, '칸은 요청 날 열린다');
  } finally { await h.close(); }
});

test('추가 — 5일 뒤 퇴실(2주 안): 그날 칸을 열고 1순위 담당자에게 바로 요청, 운영자에게 알림', { skip: !enabled }, async () => {
  const h = await harness();
  try {
    await h.addBlocker(5);
    await h.run([{ uid: 'near@airbnb', in: 3, out: 5 }]);
    const job = await h.jobOn(5);
    assert.equal(job.source, 'SHORT_NOTICE');
    assert.equal(job.status, 'NOTIFYING_VIP_1');
    assert.equal(h.requests(), 1, '1순위 담당자에게 요청 1건');
    assert.equal(await h.blockerOn(5), false, '칸이 열렸다');
    assert.ok(h.slackTexts().some(text => text.includes('SHORT_NOTICE')), '운영자 알림');
  } finally { await h.close(); }
});

test('운영자가 2주 안 청소를 취소하며 다시 막은 칸은, 다음 예약 가져오기가 다시 열지 않는다', { skip: !enabled }, async () => {
  const h = await harness();
  try {
    await h.addBlocker(5);
    await h.run([{ uid: 'near@airbnb', in: 3, out: 5 }]);
    assert.equal(await h.blockerOn(5), false, '처음엔 열림');
    // 운영자가 일정을 취소 — 칸 다시 막기(청소 관리의 일정 취소와 같은 결과)
    await h.f.pool.query(`UPDATE cleaning_jobs SET status='CANCELLED' WHERE property_id=$1`, [PROPERTY]);
    await h.addBlocker(5);
    await h.run([{ uid: 'near@airbnb', in: 3, out: 5 }]);
    await h.run([{ uid: 'near@airbnb', in: 3, out: 5 }]);
    assert.equal(await h.blockerOn(5), true, '다시 막은 칸은 그대로');
    assert.equal(h.requests(), 1, '취소된 일정으로 다시 요청하지 않는다');
  } finally { await h.close(); }
});

// ── 변경 ──────────────────────────────────────────────────────────────────

test('변경 — 같은 예약의 퇴실이 40일 → 42일로: 새 날짜에 일정이 생기고, 옛 날짜 일정은 요청을 멈추고 운영자에게 알린다', { skip: !enabled }, async () => {
  const h = await harness();
  try {
    await h.run([{ uid: 'move@airbnb', in: 38, out: 40 }]);
    const before = h.slackTexts().length;
    await h.run([{ uid: 'move@airbnb', in: 40, out: 42 }]);
    assert.equal(new Date((await h.reservation('move@airbnb')).check_out).toISOString().slice(0, 10) <= kstDate(42), true);
    const moved = await h.jobOn(42);
    assert.equal(moved?.status, 'PENDING', '새 퇴실 날짜에 청소 일정');
    const old = await h.jobOn(40);
    assert.equal(await recon.isCheckoutCancelled(h.f.pool, old), true, '옛 날짜는 퇴실이 없어진 날');
    assert.equal(h.slackTexts().length, before + 1, '운영자에게 한 번 알림');
    const sent = await dispatch.advanceJob(h.f.pool, old);
    assert.equal(sent.errorCode, 'RESERVATION_CANCELLED', '옛 날짜로는 요청을 보내지 않는다');
    assert.equal(h.requests(), 0);
    await h.run([{ uid: 'move@airbnb', in: 40, out: 42 }]);
    assert.equal(h.slackTexts().length, before + 1, '같은 일로 다시 알리지 않는다');
  } finally { await h.close(); }
});

test('변경 — Airbnb 가 새 번호로 다시 내보내며 날짜도 바꿈: 새 날짜 일정은 바로, 옛 예약은 두 번 연속 안 보인 뒤 취소·알림', { skip: !enabled }, async () => {
  const h = await harness();
  try {
    const keep = { uid: 'keep@airbnb', in: 58, out: 60 };
    await h.run([{ uid: 'old@airbnb', in: 38, out: 40 }, keep]);
    await h.run([{ uid: 'new@airbnb', in: 40, out: 42 }, keep]);
    assert.ok(await h.jobOn(42), '새 날짜 일정은 첫 번째 가져오기에서 바로');
    assert.equal((await h.reservation('old@airbnb')).status, 'ACTIVE', '한 번 안 보인 것으로는 취소하지 않는다');
    await h.later();
    await h.run([{ uid: 'new@airbnb', in: 40, out: 42 }, keep]);
    assert.equal((await h.reservation('old@airbnb')).status, 'CANCELLED', '두 번 연속 안 보이면 취소');
    assert.equal(await recon.isCheckoutCancelled(h.f.pool, await h.jobOn(40)), true);
    assert.ok(h.slackTexts().some(text => text.includes(kstDate(40).slice(5).replace('-', '/')) || text.includes('퇴실')), '운영자 알림');
  } finally { await h.close(); }
});

// ── 취소 ──────────────────────────────────────────────────────────────────

test('취소 — 요청이 이미 나간 퇴실이 취소되면: 두 번 연속 안 보인 뒤 다음 담당자 요청을 멈추고 운영자에게 알린다(일정 취소는 운영자 몫)', { skip: !enabled }, async () => {
  const h = await harness();
  try {
    const keep = { uid: 'keep@airbnb', in: 58, out: 60 };
    await h.run([{ uid: 'cancel@airbnb', in: 3, out: 5 }, keep]);
    assert.equal(h.requests(), 1, '처음엔 요청이 나갔다');
    await h.run([keep]);
    assert.equal((await h.reservation('cancel@airbnb')).status, 'ACTIVE', '한 번은 피드 흔들림일 수 있어 그대로');
    await h.later();
    await h.run([keep]);
    assert.equal((await h.reservation('cancel@airbnb')).status, 'CANCELLED');
    const job = await h.jobOn(5);
    assert.ok(h.slackTexts().some(text => text.includes('퇴실')), '운영자 알림');
    const next = await dispatch.advanceJob(h.f.pool, job);
    assert.equal(next.errorCode, 'RESERVATION_CANCELLED', '다음 담당자에게 요청하지 않는다');
    assert.equal(h.requests(), 1, '추가 요청 없음');
    assert.equal((await h.jobOn(5)).status, 'NOTIFYING_VIP_1', '일정 자체는 운영자가 정한다(그대로 둠)');
  } finally { await h.close(); }
});

test('취소처럼 보였다가 돌아온 예약(피드 한 번 흔들림): 취소하지 않고 알림도 없다', { skip: !enabled }, async () => {
  const h = await harness();
  try {
    const keep = { uid: 'keep@airbnb', in: 58, out: 60 };
    const blip = { uid: 'blip@airbnb', in: 38, out: 40 };
    await h.run([blip, keep]);
    const slackBefore = h.slackTexts().length;
    await h.run([keep]);
    await h.later();
    await h.run([blip, keep]);
    assert.equal((await h.reservation('blip@airbnb')).status, 'ACTIVE');
    assert.equal(await recon.isCheckoutCancelled(h.f.pool, await h.jobOn(40)), false);
    assert.equal(h.slackTexts().length, slackBefore);
  } finally { await h.close(); }
});

test('같은 피드를 여러 번 가져와도(하루 두 번 + 화면 15분마다) 일정·요청·알림이 늘지 않는다', { skip: !enabled }, async () => {
  const h = await harness();
  try {
    const list = [{ uid: 'near@airbnb', in: 3, out: 5 }, { uid: 'far@airbnb', in: 38, out: 40 }];
    await h.run(list);
    const snapshot = { requests: h.requests(), slack: h.slackTexts().length };
    for (let i = 0; i < 3; i++) await h.run(list);
    const { rows: [{ n }] } = await h.f.pool.query('SELECT COUNT(*)::int AS n FROM cleaning_jobs WHERE property_id=$1', [PROPERTY]);
    assert.equal(n, 2);
    assert.deepEqual({ requests: h.requests(), slack: h.slackTexts().length }, snapshot);
  } finally { await h.close(); }
});
