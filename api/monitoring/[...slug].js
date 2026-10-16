/**
 * /api/monitoring/config  — POST: Pi 워처로 설정 전달
 * /api/monitoring/state   — GET/POST/PUT: Pi 워처 roomState 중계
 *
 * slug[0] = "config" | "state"
 */

import { DATA_PROFILE, resolveServerDataProfile } from "../../src/config/dataProfile.js";

import { requireScope } from "../../server/auth/operatorAuth.js";
import { isAdminScope } from "../../server/auth/operatorAccounts.js";
import { createWatcherPropertyLookup, operatorMayUseWatcher, resolveWatcherUrl } from "../../server/auth/watcherScope.js";
import { _setAuthDbForTest, getAuthDb } from "../../server/auth/authDb.js";

let watcherLookup = createWatcherPropertyLookup();
/** 테스트 전용 주입 */
export function _setForTest({ db: fakeDb, lookup } = {}) { _setAuthDbForTest(fakeDb); watcherLookup = lookup ?? createWatcherPropertyLookup(); }

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}

export default async function handler(req, res) {
  if (resolveServerDataProfile(process.env) === DATA_PROFILE.DEMO) {
    return sendJson(res, 403, { error: "demo profile cannot access the Pi watcher", dataProfile: "demo" });
  }
  // D-033/D-035: 먼저 누구인지 확인한다. 관리자는 제한 없음. 운영자는 "자기 숙소에 연결된 워처의 상태 조회(GET)"만 —
  // 설정 전송(config)과 상태 쓰기(POST/PUT)는 관리자 전용.
  let scope;
  try { scope = await requireScope(req, res, getAuthDb); }
  catch (err) { console.error("[monitoring] 신원 확인 실패:", err.message); return sendJson(res, 503, { error: "잠시 후 다시 시도해주세요" }); }
  if (!scope) return;
  const action = (req.query?.slug
    ? (Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug)
    : (req.url || "").split("?")[0].split("/").filter(Boolean)[2]) || "";

  if (!isAdminScope(scope)) {
    if (!(action === "state" && req.method === "GET")) return sendJson(res, 403, { error: "관리자만 할 수 있어요", code: "FORBIDDEN" });
    // 이름표(watcherId)만이 아니라, 우리가 실제로 호출할 주소가 "그 숙소를 보고한 워처"와 같아야 한다
    if (!operatorMayUseWatcher(scope, await watcherLookup(), req.query?.watcherId, resolveWatcherUrl)) {
      return sendJson(res, 403, { error: "이 숙소의 워처가 아니에요", code: "FORBIDDEN" });
    }
  }

  const watcherId = req.query?.watcherId ?? null;
  const watcherUrl = resolveWatcherUrl(watcherId);

  if (!watcherUrl) {
    sendJson(res, 503, { error: "PROPOS_WATCHER_URL not configured" });
    return;
  }

  try {
    if (action === "config") {
      if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); return; }
      const body = await readBody(req);
      const upstream = `${watcherUrl.replace(/\/$/, "")}/api/monitoring/config`;
      const r = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json().catch(() => ({}));
      sendJson(res, r.status, result);
      return;
    }

    if (action === "state") {
      const upstream = `${watcherUrl.replace(/\/$/, "")}/api/monitoring/state`;
      const options = { method: req.method, headers: { "Content-Type": "application/json" } };
      if (req.method === "POST" || req.method === "PUT") {
        options.body = JSON.stringify(await readBody(req));
      }
      const r = await fetch(upstream, options);
      const body = await r.json().catch(() => ({}));
      if (!isAdminScope(scope) && !r.ok) { sendJson(res, 502, { error: "워처에서 상태를 가져오지 못했어요" }); return; } // 운영자에게 워처의 오류 내용을 그대로 주지 않는다
      sendJson(res, r.status, body);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    sendJson(res, 502, { error: !isAdminScope(scope) ? "워처에 연결할 수 없어요" : err.message });
  }
}
