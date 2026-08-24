import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Navigation from './src/navigation';
import PhoneAuthScreen from './src/screens/PhoneAuthScreen';
import { initFcm, watchTokenRefresh, getInitialNotification } from './src/services/fcm';
import type { JobPayload } from './src/services/fcm';
import { registerWorker } from './src/services/api';

// 앱이 완전히 종료된 상태에서 백그라운드 메시지 처리 (반드시 파일 최상단에)
messaging().setBackgroundMessageHandler(async () => {});

const STORAGE_KEY_REGISTERED = '@propos/registered';

export default function App() {
  const [ready, setReady]                       = useState(false);
  const [registered, setRegistered]             = useState(false);
  const [initialPayload, setInitialPayload]     = useState<JobPayload | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_REGISTERED).then(v => {
      setRegistered(v === 'true');
      setReady(true);
    });
  }, []);

  async function handleRegistration(phone: string, email: string) {
    const fcmToken = await initFcm();
    if (!fcmToken) return;

    await registerWorker(phone, email, fcmToken);
    await AsyncStorage.setItem(STORAGE_KEY_REGISTERED, 'true');
    setRegistered(true);
    watchTokenRefresh();
  }

  useEffect(() => {
    if (!registered) return;

    initFcm().then(watchTokenRefresh);

    // cold-start: 앱이 완전히 종료됐다가 알림 탭으로 열린 경우
    getInitialNotification().then(payload => {
      if (payload) setInitialPayload(payload);
    });
  }, [registered]);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!registered) {
    return <PhoneAuthScreen onComplete={handleRegistration} />;
  }

  return <Navigation initialPayload={initialPayload} />;
}
