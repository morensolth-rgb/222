import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LICENSE_SERVER   = 'https://frida-license-server-production.up.railway.app';
export const LICENSE_KEY_STORAGE = 'auth_token';
export const LICENSE_EMAIL_STORAGE = 'auth_email';
export const DEVICE_ID_STORAGE = 'device_id';


// Generate a persistent device ID (no native library needed)
async function getOrCreateDeviceId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem('device_id');
    if (stored) return stored;
    const id = 'dv-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
    await AsyncStorage.setItem('device_id', id);
    return id;
  } catch { return 'unknown'; }
}

interface Props { onUnlocked: () => void; }

type Mode = 'login' | 'register';

export default function LicenseScreen({ onUnlocked }: Props) {
  const [mode,     setMode]     = useState<Mode>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleLogin = async () => {
    const em = email.trim().toLowerCase();
    const pw = password.trim();
    if (!em || !pw) return Alert.alert('خطأ', 'ادخل الإيميل وكلمة المرور');
    setLoading(true);
    try {
      const deviceId = await getOrCreateDeviceId();
      const res  = await fetch(`${LICENSE_SERVER}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: pw, deviceId }),
      });
      const data = await res.json();
      if (data.ok) {
        await AsyncStorage.setItem(LICENSE_KEY_STORAGE, data.token);
        await AsyncStorage.setItem(LICENSE_EMAIL_STORAGE, data.email);
        onUnlocked();
      } else {
        const msgs: Record<string, string> = {
          not_found:      'الإيميل غير موجود',
          wrong_password: 'كلمة المرور غلط',
          not_activated:  '⏳ الحساب قيد المراجعة\nانتظر تأكيد الدفع من المطوّر',
        };
        Alert.alert('خطأ', msgs[data.error] || data.message || 'حدث خطأ');
      }
    } catch {
      Alert.alert('خطأ', 'تعذر الاتصال بالسيرفر');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    const em = email.trim().toLowerCase();
    const pw = password.trim();
    if (!em || !pw) return Alert.alert('خطأ', 'ادخل الإيميل وكلمة المرور');
    if (!em.includes('@')) return Alert.alert('خطأ', 'إيميل غير صحيح');
    if (pw.length < 6)    return Alert.alert('خطأ', 'كلمة المرور 6 أحرف على الأقل');
    setLoading(true);
    try {
      const res  = await fetch(`${LICENSE_SERVER}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: pw }),
      });
      const data = await res.json();
      if (data.ok) {
        Alert.alert(
          '✅ تم التسجيل',
          'حسابك قيد المراجعة.\nبعد تأكيد الدفع ($5) سيتم تفعيله.\nتواصل مع المطوّر.',
          [{ text: 'حسناً', onPress: () => setMode('login') }]
        );
      } else {
        const msgs: Record<string, string> = {
          email_exists:       'الإيميل مسجّل مسبقاً',
          password_too_short: 'كلمة المرور قصيرة جداً',
        };
        Alert.alert('خطأ', msgs[data.error] || 'حدث خطأ');
      }
    } catch {
      Alert.alert('خطأ', 'تعذر الاتصال بالسيرفر');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        {/* Grid bg */}
        <View style={s.gridH1}/><View style={s.gridH2}/>
        <View style={s.gridV1}/><View style={s.gridV2}/>

        {/* Logo */}
        <View style={s.logoWrap}>
          <Text style={s.bracket}>[</Text>
          <View style={s.mid}>
            <Text style={s.title}>FRIDA</Text>
            <Text style={s.ctl}>CTL</Text>
          </View>
          <Text style={s.bracket}>]</Text>
        </View>
        <Text style={s.sub}>RESTRICTED ACCESS</Text>

        {/* Tabs */}
        <View style={s.tabs}>
          <TouchableOpacity
            style={[s.tab, mode === 'login' && s.tabActive]}
            onPress={() => setMode('login')}>
            <Text style={[s.tabText, mode === 'login' && s.tabTextActive]}>تسجيل دخول</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, mode === 'register' && s.tabActive]}
            onPress={() => setMode('register')}>
            <Text style={[s.tabText, mode === 'register' && s.tabTextActive]}>حساب جديد</Text>
          </TouchableOpacity>
        </View>

        {/* Fields */}
        <TextInput
          style={s.input}
          value={email}
          onChangeText={setEmail}
          placeholder="example@email.com"
          placeholderTextColor="#2a2a2a"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />
        <TextInput
          style={s.input}
          value={password}
          onChangeText={setPassword}
          placeholder="كلمة المرور"
          placeholderTextColor="#2a2a2a"
          secureTextEntry
          autoCapitalize="none"
          editable={!loading}
          onSubmitEditing={mode === 'login' ? handleLogin : handleRegister}
          returnKeyType="done"
        />

        {/* Button */}
        <TouchableOpacity
          style={[s.btn, loading && s.btnDisabled]}
          onPress={mode === 'login' ? handleLogin : handleRegister}
          disabled={loading}
          activeOpacity={0.8}>
          {loading
            ? <ActivityIndicator color="#00ff88" size="small"/>
            : <Text style={s.btnText}>
                {mode === 'login' ? 'UNLOCK' : 'REGISTER'}
              </Text>
          }
        </TouchableOpacity>

        {/* Price hint on register */}
        {mode === 'register' && (
          <Text style={s.priceHint}>
            💰 العضوية الدائمة: $5 — دفعة واحدة فقط
          </Text>
        )}

        <Text style={s.credit}>Developer Haider (Apex tracker) 💀</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#000' },
  container: {
    flexGrow: 1, backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28, paddingVertical: 40,
  },
  gridH1: { position: 'absolute', width: '100%', height: 1, backgroundColor: '#0a1a0a', top: '30%' },
  gridH2: { position: 'absolute', width: '100%', height: 1, backgroundColor: '#0a1a0a', top: '70%' },
  gridV1: { position: 'absolute', height: '100%', width: 1, backgroundColor: '#0a1a0a', left: '20%' },
  gridV2: { position: 'absolute', height: '100%', width: 1, backgroundColor: '#0a1a0a', left: '80%' },
  logoWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: '#00ff88',
    paddingHorizontal: 24, paddingVertical: 14,
    backgroundColor: '#020d05', marginBottom: 6,
  },
  bracket: { color: '#00ff88', fontSize: 44, fontFamily: 'monospace', fontWeight: '100', lineHeight: 52 },
  mid:     { alignItems: 'center' },
  title:   { color: '#00ff88', fontSize: 38, fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: 8 },
  ctl:     { color: '#004d22', fontSize: 12, fontFamily: 'monospace', letterSpacing: 12, marginTop: -4 },
  sub: {
    color: '#1a3a22', fontFamily: 'monospace', fontSize: 11,
    letterSpacing: 6, marginBottom: 28, marginTop: 8,
  },
  tabs: {
    flexDirection: 'row', width: '100%',
    borderWidth: 1, borderColor: '#1e3a1e',
    borderRadius: 8, marginBottom: 16, overflow: 'hidden',
  },
  tab:          { flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: '#050505' },
  tabActive:    { backgroundColor: '#001a00' },
  tabText:      { color: '#2a4a2a', fontFamily: 'monospace', fontSize: 13 },
  tabTextActive:{ color: '#00ff88', fontFamily: 'monospace', fontSize: 13 },
  input: {
    width: '100%',
    backgroundColor: '#0a0a0a',
    borderWidth: 1, borderColor: '#1e3a1e',
    borderRadius: 8, paddingHorizontal: 16, paddingVertical: 14,
    color: '#00ff88', fontFamily: 'monospace', fontSize: 14,
    marginBottom: 10,
  },
  btn: {
    width: '100%',
    backgroundColor: '#001a00',
    borderWidth: 1, borderColor: '#00ff88',
    borderRadius: 8, paddingVertical: 15,
    alignItems: 'center', marginTop: 4, marginBottom: 14,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#00ff88', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 14, letterSpacing: 4 },
  priceHint: {
    color: '#1a5a2a', fontFamily: 'monospace', fontSize: 12,
    textAlign: 'center', marginBottom: 8,
  },
  credit: {
    marginTop: 30,
    color: '#0d2a0d', fontFamily: 'monospace', fontSize: 10, letterSpacing: 3,
  },
});
