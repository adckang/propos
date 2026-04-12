import { callHaService, getHaState, getHaStates } from "./haProxy.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function handleService(body) {
  const { domain, service, data } = body || {};
  await callHaService(domain, service, data || {});
  return { ok: true };
}

async function handleState(entityId) {
  return { state: await getHaState(entityId) };
}

async function handleStates(body) {
  const { entityIds } = body || {};
  return { states: await getHaStates(entityIds || []) };
}

export async function handleNodeHaRequest(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "POST" && url.pathname === "/api/ha/service") {
      const payload = await handleService(await readJsonBody(req));
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ha/state") {
      const payload = await handleState(url.searchParams.get("entityId"));
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ha/states") {
      const payload = await handleStates(await readJsonBody(req));
      sendJson(res, 200, payload);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unknown error" });
  }
}

export async function handleVercelService(req, res) {
  try {
    sendJson(res, 200, await handleService(await readJsonBody(req)));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unknown error" });
  }
}

export async function handleVercelState(req, res) {
  try {
    sendJson(res, 200, await handleState(req.query?.entityId));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unknown error" });
  }
}

export async function handleVercelStates(req, res) {
  try {
    sendJson(res, 200, await handleStates(await readJsonBody(req)));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unknown error" });
  }
}
