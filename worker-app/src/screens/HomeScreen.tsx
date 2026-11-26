import React, { useCallback, useEffect, useState } from 'react';
import { AppState, FlatList, Text, TouchableOpacity, StyleSheet } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getStoredFcmToken, onForegroundMessage } from '../services/fcm';
import { listCleaningRequests, sendHeartbeat } from '../services/api';
import type { CleaningRequest } from '../services/api';
import type { RootStackParamList } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const nav = useNavigation<Nav>();
  const [requests, setRequests] = useState<CleaningRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  useFocusEffect(useCallback(() => {
    let focused = true;
    let latest = 0;

    async function refresh() {
      const sequence = ++latest;
      setLoading(true);
      try {
        const token = await getStoredFcmToken();
        if (!token) throw new Error('worker token missing');
        const items = await listCleaningRequests(token);
        if (!focused || sequence !== latest) return;
        setRequests(items);
        setFailed(false);
      } catch {
        if (!focused || sequence !== latest) return;
        setRequests([]);
        setFailed(true);
      } finally {
        if (focused && sequence === latest) setLoading(false);
      }
    }

    void refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => { focused = false; subscription.remove(); };
  }, [refreshCount]));

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
    <FlatList
      style={s.list}
      contentContainerStyle={s.content}
      data={requests}
      keyExtractor={item => item.id}
      refreshing={loading}
      onRefresh={() => setRefreshCount(value => value + 1)}
      ListEmptyComponent={loading ? undefined : (
        <Text style={s.empty}>{failed ? '청소 요청을 불러오지 못했습니다.' : '받은 청소 요청이 없습니다.'}</Text>
      )}
      renderItem={({ item }) => (
        <TouchableOpacity accessibilityRole="button" style={s.card} onPress={() => nav.navigate('Job', { request: item })}>
          <Text style={s.property}>{item.propertyName}</Text>
          <Text style={s.date}>{item.cleaningAt}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const s = StyleSheet.create({
  list:     { flex: 1, backgroundColor: '#f5f7fa' },
  content:  { flexGrow: 1, padding: 16 },
  card:     { backgroundColor: '#fff', borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 10 },
  property: { fontSize: 16, fontWeight: '700', color: '#111' },
  date:     { fontSize: 14, color: '#475569', marginTop: 6 },
  empty:    { color: '#475569', textAlign: 'center', marginTop: 24 },
});
