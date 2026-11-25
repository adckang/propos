import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';

type Props = {
  onComplete: (phone: string, email: string) => Promise<void>;
};

export default function PhoneAuthScreen({ onComplete }: Props) {
  const [phone, setPhone]     = useState('');
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);

  async function submitRegistration() {
    const normalized = phone.replace(/[^0-9]/g, '').replace(/^82/, '0');
    if (!/^010\d{8}$/.test(normalized)) {
      Alert.alert('입력 오류', '올바른 전화번호를 입력해주세요');
      return;
    }
    if (!email.includes('@')) {
      Alert.alert('입력 오류', '올바른 이메일을 입력해주세요');
      return;
    }
    const withDash = normalized.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
    setLoading(true);
    try {
      await onComplete(withDash, email.toLowerCase().trim());
    } catch (e: any) {
      Alert.alert('등록 실패', e?.message ?? '등록 정보를 확인해주세요');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <View style={s.card}>
        <Text style={s.logo}>PROPOS Worker</Text>

        <Text style={s.label}>전화번호</Text>
        <TextInput
          style={s.input}
          placeholder="010-0000-0000"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />
        <Text style={s.label}>이메일</Text>
        <Text style={s.hint}>Google Calendar 예약 시 사용하는 이메일을 입력하세요</Text>
        <TextInput
          style={s.input}
          placeholder="worker@gmail.com"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />
        <TouchableOpacity style={s.btn} onPress={submitRegistration} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>등록하기</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap:       { flex: 1, backgroundColor: '#f5f7fa', justifyContent: 'center', padding: 24 },
  card:       { backgroundColor: '#fff', borderRadius: 16, padding: 28, elevation: 3 },
  logo:       { fontSize: 22, fontWeight: '700', color: '#1a1a2e', marginBottom: 28, textAlign: 'center' },
  label:      { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  hint:       { fontSize: 12, color: '#777', marginBottom: 10, lineHeight: 18 },
  input:      { borderWidth: 1.5, borderColor: '#dde1ea', borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 16, color: '#111' },
  btn:        { backgroundColor: '#2563eb', borderWidth: 1.5, borderColor: '#1d4ed8', borderRadius: 10, padding: 15, alignItems: 'center' },
  btnText:    { color: '#fff', fontWeight: '700', fontSize: 16 },
});
