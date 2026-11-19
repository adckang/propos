// s132 — v1 D-1 자동화 화면의 "iCal 동기화"가 예약 캘린더 주소를 외부 공개 중계(api.allorigins.win)로 보내던 것.
// Airbnb iCal 주소에는 비밀값(?s=…)이 들어 있어, 그 주소를 아는 사람은 누구나 예약 일정을 읽을 수 있다(CLAUDE.md:
// iCal URL 은 저장소에도 두지 않는다). 브라우저는 우리 API 만 부른다(D-012) — 이미 있는 iCal 중계 `/api/ical`(관리자 로그인)을 쓴다.
// 실제 화면 파일을 묶어, 화면 안의 iCal 함수(_ical)를 그대로 불러 시험한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PANEL = fileURLToPath(new URL('../../src/components/v1/D1AutomationPanel.jsx', import.meta.url));
const SECRET_ICAL = 'https://www.airbnb.com/calendar/ical/123.ics?s=fixture-secret&t=1';
const CALENDAR = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:fixture-1\r\nDTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261123\r\nSUMMARY:Reserved\r\nSTATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

async function loadPanelIcal() {
  const bundle = await build({
    entryPoints: [PANEL], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    jsx: 'automatic', loader: { '.js': 'jsx' },
    plugins: [{ name: 'expose-panel-ical', setup(b) {
      // 불러올 때 브라우저 전역(window)을 만지는 알림·HA 모듈은 빈 대역(이 시험의 iCal 함수는 쓰지 않는다)
      b.onResolve({ filter: /\/utils\/toast$|\/haBrowserClient\.js$/ }, () => ({ path: 'browser-only', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
      // 화면 파일 끝에 내부 iCal 함수 묶음을 내보내는 한 줄만 붙인다(코드는 그대로)
      b.onLoad({ filter: /D1AutomationPanel\.jsx$/ }, args => ({
        contents: readFileSync(args.path, 'utf8') + '\nexport { _ical as __panelIcal };\n', loader: 'jsx',
      }));
    } }],
  });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  return mod.__panelIcal;
}

function stubFetch(t, respond) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return respond(String(url)); };
  t.after(() => { globalThis.fetch = saved; });
  return calls;
}

test('iCal 동기화는 우리 서버의 중계(/api/ical)로만 가고, 캘린더 주소는 그 요청의 값으로만 들어간다', async t => {
  const ical = await loadPanelIcal();
  const calls = stubFetch(t, () => new Response(CALENDAR, { status: 200, headers: { 'Content-Type': 'text/calendar' } }));
  const text = await ical.fetchViaProxy(SECRET_ICAL);
  assert.equal(text, CALENDAR);
  assert.equal(calls.length, 1);
  const sent = new URL(calls[0].url, 'https://www.proposonline.com');
  assert.equal(sent.origin, 'https://www.proposonline.com', `같은 사이트 주소여야 한다: ${calls[0].url}`);
  assert.equal(sent.pathname, '/api/ical');
  assert.equal(sent.searchParams.get('url'), SECRET_ICAL, '비밀값(s·t)까지 그대로 한 값으로 전달');
  assert.deepEqual([...sent.searchParams.keys()], ['url']);
  assert.equal(calls[0].init?.cache, 'no-store');
  assert.equal(ical.toBookings(ical.parse(text), { propId: 'P-1', propName: '파주201' }).length, 1, '받은 달력을 그대로 해석');
});

test('중계가 거절하면(로그인 없음·잘못된 주소·상대 서버 오류) 기존 안내 그대로 실패한다', async t => {
  const ical = await loadPanelIcal();
  for (const status of [401, 400, 502]) {
    stubFetch(t, () => new Response(JSON.stringify({ error: 'x' }), { status, headers: { 'Content-Type': 'application/json' } }));
    await assert.rejects(ical.fetchViaProxy(SECRET_ICAL), { message: `프록시 응답 오류 (${status})` });
  }
  stubFetch(t, () => new Response('', { status: 200 }));
  await assert.rejects(ical.fetchViaProxy(SECRET_ICAL), { message: 'iCal 내용이 비어있습니다' });
});
