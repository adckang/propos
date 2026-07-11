import { fetchIcalText } from "./icalProxy.js";

function resolveStatusCode(error) {
  const message = String(error?.message || "");
  if (
    message === "url is required" ||
    message === "Invalid URL" ||
    message === "Only http/https URLs are allowed"
  ) {
    return 400;
  }
  if (message.startsWith("iCal upstream ")) {
    return 502;
  }
  return 500;
}

function sendText(res, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function handleIcalRequest(urlValue) {
  return await fetchIcalText(urlValue);
}

export async function handleNodeIcalRequest(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/api/ical") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const payload = await handleIcalRequest(url.searchParams.get("url"));
    sendText(res, 200, payload, "text/calendar; charset=utf-8");
  } catch (error) {
    sendJson(res, resolveStatusCode(error), { error: error.message || "Unknown error" });
  }
}

export async function handleVercelIcal(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      res.setHeader("Allow", "GET");
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const payload = await handleIcalRequest(req.query?.url);
    sendText(res, 200, payload, "text/calendar; charset=utf-8");
  } catch (error) {
    sendJson(res, resolveStatusCode(error), { error: error.message || "Unknown error" });
  }
}
