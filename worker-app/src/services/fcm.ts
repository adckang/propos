import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFcmTokenOwner, updateFcmToken } from './api';

const STORAGE_KEY_FCM = '@propos/fcm_token';
const STORAGE_KEY_PENDING = '@propos/fcm_token_pending';
type Rotation = { oldToken: string; newToken: string; workerId: string };
let syncQueue: Promise<unknown> = Promise.resolve();

async function confirmRotation(rotation: Rotation) {
  await updateFcmToken(rotation.oldToken, rotation.newToken, rotation.workerId);
  await AsyncStorage.setItem(STORAGE_KEY_FCM, rotation.newToken);
  await AsyncStorage.removeItem(STORAGE_KEY_PENDING);
}

async function synchronizeToken(token: string) {
  let stored = await AsyncStorage.getItem(STORAGE_KEY_FCM);
  const raw = await AsyncStorage.getItem(STORAGE_KEY_PENDING);
  if (raw) {
    const pending = JSON.parse(raw) as Rotation;
    if (!pending || typeof pending.oldToken !== 'string' || !pending.oldToken ||
        typeof pending.newToken !== 'string' || !pending.newToken || pending.newToken === pending.oldToken ||
        typeof pending.workerId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pending.workerId) ||
        (stored !== pending.oldToken && stored !== pending.newToken)) {
      throw new Error('token recovery state invalid');
    }
    if (stored === pending.newToken) await AsyncStorage.removeItem(STORAGE_KEY_PENDING);
    else await confirmRotation(pending);
    stored = pending.newToken;
  }
  if (!stored) {
    // Initial registration still belongs to registerWorker/App.tsx.
    await AsyncStorage.setItem(STORAGE_KEY_FCM, token);
  } else if (stored !== token) {
    const workerId = await getFcmTokenOwner(stored);
    const pending = { oldToken: stored, newToken: token, workerId };
    await AsyncStorage.setItem(STORAGE_KEY_PENDING, JSON.stringify(pending));
    await confirmRotation(pending);
  }
}

function synchronizeLatestToken(): Promise<string> {
  const next = syncQueue.then(async () => {
    // Read the SDK token when this operation starts, so queued listeners cannot
    // restore an older token over a newer refresh event.
    const token = await messaging().getToken();
    try { await synchronizeToken(token); } catch { /* durable intent / old token survive for the next startup */ }
    return token;
  });
  syncQueue = next.catch(() => {});
  return next;
}

/** 앱 시작 시 FCM 권한 요청 + 토큰 발급 */
export async function initFcm(): Promise<string | null> {
  const status = await messaging().requestPermission();
  const granted =
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL;

  if (!granted) return null;

  return synchronizeLatestToken();
}

export async function getStoredFcmToken(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEY_FCM);
}

/** FCM 토큰 자동 갱신 리스너 (앱 수명 동안 유지) */
export function watchTokenRefresh() {
  return messaging().onTokenRefresh(async () => {
    await synchronizeLatestToken().catch(() => {});
  });
}

export type JobPayload = {
  jobId: string;
  token: string;       // 거절용 토큰
  calendarUrl: string; // Google Calendar 예약 URL
  hostPhone: string;
  title: string;
  body: string;
};

/** 포그라운드 메시지 수신 리스너 */
export function onForegroundMessage(handler: (payload: JobPayload) => void) {
  return messaging().onMessage(async (remoteMessage) => {
    const data = remoteMessage.data as Record<string, string>;
    handler({
      jobId: data.jobId ?? '',
      token: data.token ?? '',
      calendarUrl: data.calendarUrl ?? '',
      hostPhone: data.hostPhone ?? '',
      title: remoteMessage.notification?.title ?? '[PROPOS] 새 요청',
      body: remoteMessage.notification?.body ?? '',
    });
  });
}

/** 백그라운드에서 알림 탭으로 앱 열릴 때 */
export async function getInitialNotification(): Promise<JobPayload | null> {
  const msg = await messaging().getInitialNotification();
  if (!msg?.data) return null;
  const data = msg.data as Record<string, string>;
  return {
    jobId: data.jobId ?? '',
    token: data.token ?? '',
    calendarUrl: data.calendarUrl ?? '',
    hostPhone: data.hostPhone ?? '',
    title: msg.notification?.title ?? '',
    body: msg.notification?.body ?? '',
  };
}
