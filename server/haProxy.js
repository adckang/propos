import CFG from "../src/config/privateConfig.js";

const HA_BASE = CFG.ha.baseUrl;
const HA_TOKEN = CFG.ha.token;

export function getHaWsUrl() {
  if (CFG.ha.wsUrl) return CFG.ha.wsUrl;
  return HA_BASE.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/api/websocket';
}

export function getHaToken() {
  return HA_TOKEN;
}

function getHeaders() {
  return {
    Authorization: `Bearer ${HA_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function parseJsonSafe(response) {
  return response.json().catch(() => null);
}

async function parseTextSafe(response) {
  return response.text().catch(() => "");
}

export async function callHaService(domain, service, data = {}) {
  if (!domain) throw new Error("domain is required");
  if (!service) throw new Error("service is required");

  const response = await fetch(`${HA_BASE}/api/services/${domain}/${service}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await parseTextSafe(response);
    throw new Error(`HA ${response.status}: ${text}`);
  }

  return (await parseJsonSafe(response)) ?? {};
}

export async function getHaState(entityId) {
  if (!entityId) throw new Error("entityId is required");

  const response = await fetch(`${HA_BASE}/api/states/${entityId}`, {
    headers: {
      Authorization: `Bearer ${HA_TOKEN}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return await parseJsonSafe(response);
}

export async function renderHaTemplate(template) {
  if (!template) throw new Error("template is required");
  const response = await fetch(`${HA_BASE}/api/template`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ template }),
  });
  if (!response.ok) {
    const text = await parseTextSafe(response);
    throw new Error(`HA template ${response.status}: ${text}`);
  }
  return response.text();
}

export async function getHaHistory(entityId, startIso) {
  const path = `/api/history/period/${encodeURIComponent(startIso)}?filter_entity_id=${encodeURIComponent(entityId)}&minimal_response=true&no_attributes=true`;
  const response = await fetch(`${HA_BASE}${path}`, { headers: getHeaders() });
  if (!response.ok) return [];
  const data = await parseJsonSafe(response);
  return Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
}

// 히스토리 재처리용 — 속성(device_class, friendly_name 등) 포함
export async function getHaHistoryFull(entityId, startIso) {
  const path = `/api/history/period/${encodeURIComponent(startIso)}?filter_entity_id=${encodeURIComponent(entityId)}`;
  const response = await fetch(`${HA_BASE}${path}`, { headers: getHeaders() });
  if (!response.ok) return [];
  const data = await parseJsonSafe(response);
  return Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
}

export async function getHaStates(entityIds) {
  if (!Array.isArray(entityIds)) {
    throw new Error("entityIds must be an array");
  }

  const uniqueIds = [...new Set(entityIds.filter(Boolean))];
  const entries = await Promise.all(
    uniqueIds.map(async entityId => [entityId, await getHaState(entityId)])
  );

  return Object.fromEntries(entries);
}
