import { callHaService, getHaState, getHaStates, renderHaTemplate, getHaHistory } from "./haProxy.js";

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

async function handleTemplate(body) {
  const { template } = body || {};
  if (!template) throw new Error("template is required");
  return { result: await renderHaTemplate(template) };
}

async function handleHistory(searchParams) {
  const entityId = searchParams.get('entityId');
  const start    = searchParams.get('start');
  if (!entityId || !start) throw new Error("entityId and start required");
  return { history: await getHaHistory(entityId, start) };
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

    if (req.method === "POST" && url.pathname === "/api/ha/template") {
      const payload = await handleTemplate(await readJsonBody(req));
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ha/history") {
      const payload = await handleHistory(url.searchParams);
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

export async function handleVercelTemplate(req, res) {
  try {
    sendJson(res, 200, await handleTemplate(await readJsonBody(req)));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unknown error" });
  }
}

export async function handleVercelHistory(req, res) {
  try {
    const params = new URLSearchParams(
      typeof req.query === 'object'
        ? Object.entries(req.query).map(([k, v]) => `${k}=${v}`).join('&')
        : ''
    );
    sendJson(res, 200, await handleHistory(params));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unknown error" });
  }
}
