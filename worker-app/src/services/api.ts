import { PROPOS_BASE_URL } from '../config';

export async function registerWorker(phone: string, email: string, fcmToken: string) {
  const res = await fetch(`${PROPOS_BASE_URL}/api/workers/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, email, fcm_token: fcmToken }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  return res.json() as Promise<{ ok: boolean; worker: { id: string; active: boolean }; message: string }>;
}

export async function sendHeartbeat(fcmToken: string) {
  await fetch(`${PROPOS_BASE_URL}/api/workers/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fcm_token: fcmToken }),
  }).catch(() => {}); // heartbeat 실패는 무시 (앱 동작에 영향 없음)
}

export async function updateFcmToken(oldToken: string, newToken: string) {
  await fetch(`${PROPOS_BASE_URL}/api/workers/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fcm_token: oldToken, new_token: newToken }),
  });
}

export async function declineJob(token: string): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${PROPOS_BASE_URL}/api/cleaning/d?token=${token}&format=api`);
  if (!res.ok) return { ok: false };
  return res.json() as Promise<{ ok: boolean; message?: string }>;
}
