import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Linking, Alert, ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { declineJob } from '../services/api';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Job'>;

export default function JobScreen({ route, navigation }: Props) {
  const { payload } = route.params;
  const [view, setView]     = useState<'main' | 'calendar'>('main');
  const [declined, setDeclined] = useState(false);
  const [loading, setLoading]   = useState(false);

  async function handleDecline() {
    Alert.alert('거절 확인', '이 요청을 거절하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '거절',
        style: 'destructive',
        onPress: async () => {
          setLoading(true);
          try {
            const result = await declineJob(payload.token);
            if (result.ok) {
              setDeclined(true);
            } else {
              Alert.alert('처리 불가', result.message ?? '이미 처리된 요청이거나 연결 오류입니다.');
            }
          } catch {
            Alert.alert('오류', '처리 중 문제가 발생했습니다. 다시 시도해주세요.');
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  }

  function handleNegotiate() {
    Linking.openURL(`sms:${payload.hostPhone}`);
  }

  if (view === 'calendar') {
    return (
      <View style={{ flex: 1 }}>
        <TouchableOpacity style={s.backBtn} onPress={() => setView('main')}>
          <Text style={s.backBtnText}>← 돌아가기</Text>
        </TouchableOpacity>
        <WebView source={{ uri: payload.calendarUrl }} style={{ flex: 1 }} />
      </View>
    );
  }

  if (declined) {
    return (
      <View style={s.wrap}>
        <Text style={s.doneIcon}>✓</Text>
        <Text style={s.doneTitle}>거절 완료</Text>
        <Text style={s.doneDesc}>다음 담당자에게 자동으로 전달됩니다.</Text>
        <TouchableOpacity style={s.closeBtn} onPress={() => navigation.goBack()}>
          <Text style={s.closeBtnText}>닫기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.card}>
        <Text style={s.tag}>청소 요청</Text>
        <Text style={s.title}>{payload.body}</Text>
      </View>

      <TouchableOpacity style={[s.btn, s.btnAccept]} onPress={() => setView('calendar')} disabled={loading}>
        <Text style={s.btnText}>✓ 수락 (예약하기)</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[s.btn, s.btnDecline]} onPress={handleDecline} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#dc2626" />
          : <Text style={[s.btnText, s.btnTextDecline]}>✕ 거절</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={[s.btn, s.btnNegotiate]} onPress={handleNegotiate}>
        <Text style={[s.btnText, s.btnTextNegotiate]}>💬 협의 필요</Text>
      </TouchableOpacity>

      <Text style={s.hint}>수락을 누르면 Google Calendar 예약 페이지가 열립니다.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:            { flex: 1, backgroundColor: '#f5f7fa', padding: 24, justifyContent: 'center' },
  card:            { backgroundColor: '#fff', borderRadius: 16, padding: 24, marginBottom: 28, elevation: 2 },
  tag:             { fontSize: 12, fontWeight: '700', color: '#2563eb', letterSpacing: 0.5, marginBottom: 8 },
  title:           { fontSize: 18, fontWeight: '700', color: '#111', lineHeight: 26 },
  btn:             { borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12, borderWidth: 1.5 },
  btnAccept:       { backgroundColor: '#2563eb', borderColor: '#1d4ed8' },
  btnDecline:      { backgroundColor: '#fff', borderColor: '#dc2626' },
  btnNegotiate:    { backgroundColor: '#fff', borderColor: '#6b7280' },
  btnText:         { fontSize: 16, fontWeight: '700', color: '#fff' },
  btnTextDecline:  { color: '#dc2626' },
  btnTextNegotiate:{ color: '#374151' },
  hint:            { fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8 },
  backBtn:         { padding: 14, backgroundColor: '#f5f7fa', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  backBtnText:     { fontSize: 15, color: '#2563eb', fontWeight: '600' },
  doneIcon:        { fontSize: 48, textAlign: 'center', color: '#22c55e', marginBottom: 12 },
  doneTitle:       { fontSize: 22, fontWeight: '700', color: '#111', textAlign: 'center', marginBottom: 8 },
  doneDesc:        { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 32 },
  closeBtn:        { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 14, alignItems: 'center' },
  closeBtnText:    { color: '#374151', fontWeight: '600', fontSize: 15 },
});
