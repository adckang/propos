/**
 * /api/monitoring/config  — POST: Pi 워처로 설정 전달
 * /api/monitoring/state   — GET/POST/PUT: Pi 워처 roomState 중계
 *
 * slug[0] = "config" | "state"
 */

const WATCHER_URLS = (() => {
  try { return JSON.parse(process.env.PROPOS_WATCHER_URLS ?? "{}"); }
  catch { return {}; }
})();
const DEFAULT_WATCHER_URL = process.env.PROPOS_WATCHER_URL;

function resolveWatcherUrl(watcherId) {
  if (watcherId && WATCHER_URLS[watcherId]) return WATCHER_URLS[watcherId];
  return DEFAULT_WATCHER_URL ?? null;
}

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
  const action = (req.query?.slug
    ? (Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug)
    : (req.url || "").split("?")[0].split("/").filter(Boolean)[2]) || "";

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
      sendJson(res, r.status, body);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}
