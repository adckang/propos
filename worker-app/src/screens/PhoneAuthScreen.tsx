import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import auth from '@react-native-firebase/auth';

type Step = 'phone' | 'otp' | 'email';

type Props = {
  onComplete: (phone: string, email: string) => void;
};

export default function PhoneAuthScreen({ onComplete }: Props) {
  const [step, setStep]       = useState<Step>('phone');
  const [phone, setPhone]     = useState('');
  const [otp, setOtp]         = useState('');
  const [email, setEmail]     = useState('');
  const [confirm, setConfirm] = useState<ReturnType<typeof auth['signInWithPhoneNumber']> extends Promise<infer T> ? T : never | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestOtp() {
    const normalized = phone.replace(/[^0-9]/g, '').replace(/^0/, '+82');
    if (normalized.length < 11) {
      Alert.alert('입력 오류', '올바른 전화번호를 입력해주세요');
      return;
    }
    setLoading(true);
    try {
      const result = await auth().signInWithPhoneNumber(normalized);
      setConfirm(result as any);
      setStep('otp');
    } catch (e: any) {
      Alert.alert('오류', e.message ?? 'OTP 전송 실패');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!confirm) return;
    setLoading(true);
    try {
      await (confirm as any).confirm(otp);
      setStep('email');
    } catch {
      Alert.alert('인증 실패', '인증번호가 올바르지 않습니다');
    } finally {
      setLoading(false);
    }
  }

  function submitEmail() {
    if (!email.includes('@')) {
      Alert.alert('입력 오류', '올바른 이메일을 입력해주세요');
      return;
    }
    const normalized = phone.replace(/[^0-9]/g, '');
    const formatted = normalized.startsWith('82')
      ? `0${normalized.slice(2)}`
      : normalized;
    const withDash = formatted.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
    onComplete(withDash, email.toLowerCase().trim());
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <View style={s.card}>
        <Text style={s.logo}>PROPOS Worker</Text>

        {step === 'phone' && (
          <>
            <Text style={s.label}>전화번호</Text>
            <TextInput
              style={s.input}
              placeholder="010-0000-0000"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <TouchableOpacity style={s.btn} onPress={requestOtp} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>인증번호 받기</Text>}
            </TouchableOpacity>
          </>
        )}

        {step === 'otp' && (
          <>
            <Text style={s.label}>인증번호 (6자리)</Text>
            <TextInput
              style={s.input}
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={6}
              value={otp}
              onChangeText={setOtp}
            />
            <TouchableOpacity style={s.btn} onPress={verifyOtp} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>확인</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.textBtn} onPress={() => setStep('phone')}>
              <Text style={s.textBtnText}>번호 다시 입력</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'email' && (
          <>
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
            <TouchableOpacity style={s.btn} onPress={submitEmail}>
              <Text style={s.btnText}>등록하기</Text>
            </TouchableOpacity>
          </>
        )}
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
  textBtn:    { marginTop: 14, alignItems: 'center' },
  textBtnText:{ color: '#2563eb', fontSize: 14 },
});
