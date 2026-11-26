import { PROPOS_BASE_URL } from '../config';

export async function registerWorker(phone: string, email: string, fcmToken: string) {
  const res = await fetch(`${PROPOS_BASE_URL}/api/workers/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, email, fcm_token: fcmToken }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `register failed: ${res.status}`);
  return body as { ok: boolean; worker: { id: string; active: boolean }; message: string };
}

export async function sendHeartbeat(fcmToken: string) {
  await fetch(`${PROPOS_BASE_URL}/api/workers/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fcm_token: fcmToken }),
  }).catch(() => {}); // heartbeat 실패는 무시 (앱 동작에 영향 없음)
}

async function workerRequest(resource: 'token' | 'requests', options: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${PROPOS_BASE_URL}/api/workers/${resource}`, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`${resource} request failed: ${res.status}`);
    const receipt = await res.json();
    if (receipt?.ok !== true) throw new Error(`${resource} receipt missing`);
    return receipt;
  } finally { clearTimeout(timer); }
}

// The read-only GET is rejected safely by older servers; it cannot rotate a
// token before the app has persisted the identity needed for lost-ACK recovery.
export async function getFcmTokenOwner(token: string): Promise<string> {
  const receipt = await workerRequest('token', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  if (typeof receipt.worker_id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt.worker_id)) {
    throw new Error('token owner receipt missing');
  }
  return receipt.worker_id;
}

export async function updateFcmToken(oldToken: string, newToken: string, workerId?: string) {
  await workerRequest('token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fcm_token: oldToken, new_token: newToken, ...(workerId ? { worker_id: workerId } : {}) }),
  });
}

export type CleaningRequest = {
  id: string;
  propertyName: string;
  cleaningAt: string;
  calendarPath: string;
  declineToken: string | null;
};

export async function listCleaningRequests(token: string): Promise<CleaningRequest[]> {
  const receipt = await workerRequest('requests', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  if (!Array.isArray(receipt.requests)) throw new Error('requests missing');
  return receipt.requests;
}

export async function declineJob(token: string, fromHistory = false): Promise<{ ok: boolean; message?: string }> {
  const source = fromHistory ? '&source=history' : '';
  const res = await fetch(`${PROPOS_BASE_URL}/api/cleaning/d?token=${encodeURIComponent(token)}&format=api${source}`);
  if (!res.ok) return { ok: false };
  return res.json() as Promise<{ ok: boolean; message?: string }>;
}
