import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getStoredFcmToken, onForegroundMessage } from '../services/fcm';
import { sendHeartbeat } from '../services/api';
import type { RootStackParamList } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const nav = useNavigation<Nav>();

  useEffect(() => {
    // heartbeat
    getStoredFcmToken().then(t => { if (t) sendHeartbeat(t); });

    // 앱이 포그라운드일 때 메시지 수신 → JobScreen으로 이동
    const unsub = onForegroundMessage(payload => {
      nav.navigate('Job', { payload });
    });

    // 백그라운드에서 알림 탭 → 앱이 이미 열려있을 때
    const unsubBg = messaging().onNotificationOpenedApp(msg => {
      const d = msg.data as Record<string, string>;
      nav.navigate('Job', {
        payload: {
          jobId: d.jobId ?? '',
          token: d.token ?? '',
          calendarUrl: d.calendarUrl ?? '',
          hostPhone: d.hostPhone ?? '',
          title: msg.notification?.title ?? '',
          body: msg.notification?.body ?? '',
        },
      });
    });

    return () => { unsub(); unsubBg(); };
  }, [nav]);

  return (
    <View style={s.wrap}>
      <View style={s.badge}>
        <Text style={s.badgeIcon}>🟢</Text>
        <Text style={s.badgeText}>대기 중</Text>
      </View>
      <Text style={s.desc}>새 요청이 오면 알림으로 알려드립니다.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: '#f5f7fa', alignItems: 'center', justifyContent: 'center', padding: 24 },
  badge:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 50, paddingHorizontal: 20, paddingVertical: 12, elevation: 2, marginBottom: 16 },
  badgeIcon: { fontSize: 20, marginRight: 8 },
  badgeText: { fontSize: 18, fontWeight: '700', color: '#111' },
  desc:      { fontSize: 14, color: '#777', textAlign: 'center' },
});
