import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateFcmToken } from './api';

const STORAGE_KEY_FCM = '@propos/fcm_token';

/** 앱 시작 시 FCM 권한 요청 + 토큰 발급 */
export async function initFcm(): Promise<string | null> {
  const status = await messaging().requestPermission();
  const granted =
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL;

  if (!granted) return null;

  const token = await messaging().getToken();
  const stored = await AsyncStorage.getItem(STORAGE_KEY_FCM);

  if (stored && stored !== token) {
    await updateFcmToken(stored, token).catch(() => {});
  }

  await AsyncStorage.setItem(STORAGE_KEY_FCM, token);
  return token;
}

export async function getStoredFcmToken(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEY_FCM);
}

/** FCM 토큰 자동 갱신 리스너 (앱 수명 동안 유지) */
export function watchTokenRefresh() {
  return messaging().onTokenRefresh(async (newToken) => {
    const old = await AsyncStorage.getItem(STORAGE_KEY_FCM);
    if (old && old !== newToken) {
      await updateFcmToken(old, newToken).catch(() => {});
    }
    await AsyncStorage.setItem(STORAGE_KEY_FCM, newToken);
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
