async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

export async function callService(domain, service, data = {}) {
  return requestJson("/api/ha/service", {
    method: "POST",
    body: JSON.stringify({ domain, service, data }),
  });
}

export async function getState(entityId) {
  const payload = await requestJson(`/api/ha/state?entityId=${encodeURIComponent(entityId)}`);
  return payload.state ?? null;
}

export async function getStates(entityIds) {
  const payload = await requestJson("/api/ha/states", {
    method: "POST",
    body: JSON.stringify({ entityIds }),
  });
  return payload.states ?? {};
}

export default { callService, getState, getStates };
