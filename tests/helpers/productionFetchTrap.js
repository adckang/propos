// RF-23: 테스트가 진짜 네트워크로 운영 쪽 주소에 요청하는 것을 막는 장치. `npm test` 가 `node --import` 로
// 모든 테스트 파일보다 먼저 불러온다(테스트 실행기가 띄우는 파일마다 걸린다).
// 운영 쪽 주소로 가는 fetch 는 실제로 보내지 않고 실패 응답(599)을 돌려준 뒤, 그 테스트 파일이 끝날 때 무엇을 막았는지
// 출력하고 실패(종료 코드 1)로 만든다 — 테스트가 모두 통과했더라도. 테스트가 fetch 를 가짜로 바꿨다가 "원래 값"으로
// 돌려놓으면 이 장치로 돌아오므로, 여기 잡히는 것은 진짜 네트워크로 나갔을 요청이다.
// 일부러 막히는지 확인하는 테스트는 globalThis.__productionFetchTrap 의 calls·reset 을 쓴다.
import { isProductionHost } from './productionHosts.js';

const calls = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async function productionFetchTrap(input, init) {
  let url = null;
  try { url = new URL(typeof input === 'string' ? input : input?.url ?? String(input)); } catch { /* 상대 주소 등은 그대로 */ }
  if (url && isProductionHost(url.hostname)) {
    calls.push(`${init?.method ?? input?.method ?? 'GET'} ${url.origin}${url.pathname}`);
    return new Response('{}', { status: 599 });
  }
  return realFetch.apply(this, arguments);
};

globalThis.__productionFetchTrap = { calls, reset() { calls.length = 0; } };

process.on('exit', (code) => {
  if (!calls.length) return;
  process.stderr.write(`[productionFetchTrap] 테스트가 운영 쪽 주소로 요청하려 해서 막았습니다 (${calls.length}건):\n${calls.map((c) => `  ${c}`).join('\n')}\n`);
  if (code === 0) process.exitCode = 1;
});
