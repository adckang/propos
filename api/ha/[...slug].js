import {
  handleVercelService,
  handleVercelState,
  handleVercelStates,
  handleVercelAllStates,
  handleVercelHistory,
  handleVercelTemplate,
} from "../../server/haApiHandlers.js";
import { renderHaTemplate } from "../../server/haProxy.js";
import { DATA_PROFILE, resolveServerDataProfile } from "../../src/config/dataProfile.js";
import { requireScope } from "../../server/auth/operatorAuth.js";
import { isAdminScope } from "../../server/auth/operatorAccounts.js";
import { areaEntitiesTemplate, authorizeOperatorHa } from "../../server/auth/haScope.js";
import { _setAuthDbForTest, getAuthDb } from "../../server/auth/authDb.js";

const HANDLERS = {
  service:    handleVercelService,
  state:      handleVercelState,
  states:     handleVercelStates,
  'all-states': handleVercelAllStates,
  history:    handleVercelHistory,
  template:   handleVercelTemplate,
};

// 숙소 영역(= 숙소 이름, D-016)에 속한 기기 목록. 폴링마다 HA 를 두드리지 않도록 짧게 캐시한다.
// 진행 중인 조회는 합쳐서 기다리고(동시 요청이 각자 HA 를 두드리지 않게), **실패는 캐시하지 않는다**(HA 가 한 번 흔들렸다고
// 30초 동안 "이 숙소의 기기가 아니에요"로 보이면 권한 문제로 오해된다 — 실패는 예외로 올려 503 으로 응답한다).
const AREA_TTL_MS = 30_000;
let AREA_LOOKUP_TIMEOUT_MS = 5_000;
/** 테스트 전용: 제한 시간 조정 */
export function _setAreaTimeoutForTest(ms) { AREA_LOOKUP_TIMEOUT_MS = ms ?? 5_000; }
// HA 가 응답하지 않아도 깔끔한 503 으로 끝나도록 영역 조회에 제한 시간을 둔다(플랫폼이 먼저 함수를 끊으면 504 가 된다)
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`HA 응답 없음(${ms}ms)`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const areaCache = new Map(); // areaName -> { at, promise }
function haAreaEntityIds(areaName) {
  const hit = areaCache.get(areaName);
  if (hit && Date.now() - hit.at < AREA_TTL_MS) return hit.promise;
  const promise = withTimeout(renderHaTemplate(areaEntitiesTemplate(areaName)), AREA_LOOKUP_TIMEOUT_MS).then((raw) => {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("영역 기기 목록이 배열이 아님");
    return parsed.filter((x) => typeof x === "string");
  });
  areaCache.set(areaName, { at: Date.now(), promise });
  promise.catch(() => { if (areaCache.get(areaName)?.promise === promise) areaCache.delete(areaName); });
  return promise;
}
let areaLookup = haAreaEntityIds;
/** 테스트 전용 주입 */
export function _setAreaLookupForTest(fn) { areaLookup = fn ?? haAreaEntityIds; areaCache.clear(); }
export { _setAuthDbForTest };

async function readJsonOnce(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "demo profile cannot access Home Assistant", dataProfile: "demo" }));
    return;
  }
  // D-033/D-035: 먼저 누구인지 확인한다. 관리자는 제한 없음, 운영자는 자기 숙소의 HA 영역 안에서만.
  let scope;
  try { scope = await requireScope(req, res, getAuthDb); }
  catch (err) { console.error("[ha] 신원 확인 실패:", err.message); return sendJson(res, 503, { error: "잠시 후 다시 시도해주세요" }); }
  if (!scope) return;

  const action = (req.query?.slug
    ? (Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug)
    : (req.url || "").split("?")[0].split("/").filter(Boolean)[2]) || "";
  const handle = HANDLERS[action];
  if (!handle) return sendJson(res, 404, { error: "Not found" });

  if (!isAdminScope(scope)) {
    const body = req.method === "POST" ? await readJsonOnce(req) : {};
    if (req.method === "POST") req.body = body; // 아래 핸들러가 같은 본문을 다시 읽을 수 있게(스트림은 한 번만 읽힌다)
    let verdict;
    try { verdict = await authorizeOperatorHa({ action, query: req.query ?? {}, body, scope, getAreaEntityIds: areaLookup }); }
    catch (err) { // HA 영역 조회 실패 — 권한 문제(403)가 아니라 일시적 연결 문제(503)로 알린다
      console.error("[ha] 영역 기기 조회 실패:", err.message);
      return sendJson(res, 503, { error: "스마트홈에 잠시 연결할 수 없어요", code: "HA_UNAVAILABLE" });
    }
    if (!verdict.ok) return sendJson(res, verdict.status, { error: verdict.error, code: verdict.code });
  }
  return handle(req, res);
}
