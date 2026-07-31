import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  Share,
  ToastAndroid,
} from 'react-native';
import {rootBridge} from '../native/RootBridge';

export default function AfScreen({route}: any) {
  const {packageName, appName} = route.params;
  const [loading, setLoading] = useState(true);
  const [afValue, setAfValue] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [raw, setRaw] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    setAfValue(null);
    try {
      const res = await rootBridge.getAfInstallation(packageName);
      if (res.found && res.value) {
        setAfValue(res.value);
        setRaw(res.raw ?? '');
      } else {
        setError(res.message ?? 'AF_INSTALLATION not found for this app.');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to read AF_INSTALLATION.');
    }
    setLoading(false);
  };

  const copy = () => {
    if (!afValue) return;
    Share.share({message: afValue});
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.appName}>{appName ?? packageName}</Text>
      <Text style={s.pkg}>{packageName}</Text>

      <View style={s.box}>
        <Text style={s.label}>AF_INSTALLATION</Text>
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color="#00ff88" size="large" />
            <Text style={s.hint}>Reading via root...</Text>
          </View>
        ) : error ? (
          <View style={s.center}>
            <Text style={s.errText}>⚠ {error}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={load}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={s.value} selectable>
              {afValue}
            </Text>
            <TouchableOpacity style={s.copyBtn} onPress={copy}>
              <Text style={s.copyText}>Copy / Share</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {!loading && !error && raw !== '' && (
        <View style={s.rawBox}>
          <TouchableOpacity onPress={() => setShowRaw(v => !v)}>
            <Text style={s.rawToggle}>
              {showRaw ? '▼' : '▶'} Raw appsflyer-data.xml
            </Text>
          </TouchableOpacity>
          {showRaw && (
            <Text style={s.raw} selectable>
              {raw}
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0d0d0d'},
  content: {padding: 16, paddingBottom: 40},
  appName: {
    color: '#e0e0e0',
    fontSize: 20,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  pkg: {color: '#555', fontSize: 12, fontFamily: 'monospace', marginTop: 4},

  box: {
    marginTop: 20,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 16,
  },
  label: {
    color: '#00ff88',
    fontSize: 12,
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: 12,
  },
  value: {
    color: '#00ff88',
    fontSize: 15,
    fontFamily: 'monospace',
    lineHeight: 24,
    letterSpacing: 0.5,
  },
  copyBtn: {
    marginTop: 18,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: '#0a2a15',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00ff88',
  },
  copyText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 13},

  center: {alignItems: 'center', gap: 12, paddingVertical: 12},
  hint: {color: '#444', fontFamily: 'monospace', fontSize: 12},
  errText: {
    color: '#ff4444',
    fontFamily: 'monospace',
    fontSize: 13,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
  },
  retryText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 13},

  rawBox: {marginTop: 20},
  rawToggle: {color: '#5bc8ff', fontFamily: 'monospace', fontSize: 12},
  raw: {
    marginTop: 10,
    color: '#777',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 17,
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 12,
  },
});
