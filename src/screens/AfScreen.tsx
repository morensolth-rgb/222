import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  ToastAndroid,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {rootBridge} from '../native/RootBridge';

export default function AfScreen({route}: any) {
  const {packageName, appName, sdk} = route.params as {
    packageName: string;
    appName?: string;
    sdk?: string;
  };

  // Normalise the detected SDK string into a primary type
  const sdkType: 'appsflyer' | 'adjust' | 'singular' | 'unknown' = (() => {
    const s = (sdk ?? '').toLowerCase();
    if (s.includes('appsflyer')) return 'appsflyer';
    if (s.includes('singular')) return 'singular';
    if (s.includes('adjust')) return 'adjust';
    return 'unknown';
  })();

  const [loading, setLoading] = useState(true);
  const [afValue, setAfValue] = useState<string | null>(null);
  const [adidValue, setAdidValue] = useState<string | null>(null);
  const [aifa, setAifa] = useState<string | null>(null);
  const [singularInstallId, setSingularInstallId] = useState<string | null>(null);
  const [raw, setRaw] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setAfValue(null);
    setAdidValue(null);
    setAifa(null);
    setSingularInstallId(null);

    const tasks: Promise<void>[] = [];

    // Advertising ID — needed for AppsFlyer combo + Adjust display
    tasks.push(
      rootBridge.getAdvertisingId()
        .then(r => { if (r.found && r.value) setAdidValue(r.value); })
        .catch(() => {}),
    );

    if (sdkType === 'appsflyer' || sdkType === 'unknown') {
      tasks.push(
        rootBridge.getAfInstallation(packageName)
          .then(r => {
            if (r.found && r.value) {
              setAfValue(r.value);
              setRaw(r.raw ?? '');
            }
          })
          .catch(() => {}),
      );
    }

    if (sdkType === 'singular') {
      tasks.push(
        rootBridge.getSingularIds(packageName)
          .then(r => {
            if (r.aifa) setAifa(r.aifa);
            if (r.installId) setSingularInstallId(r.installId);
          })
          .catch(() => {}),
      );
    }

    await Promise.all(tasks);
    setLoading(false);
  };

  const copy = (value: string | null, label: string) => {
    if (!value) return;
    Clipboard.setString(value);
    ToastAndroid.show(`${label} copied`, ToastAndroid.SHORT);
  };

  // The combined one-liner for AppsFlyer games: ADID|AF_INSTALLATION
  const afCombined =
    adidValue && afValue ? `${adidValue}|${afValue}` : (afValue ?? null);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.appName}>{appName ?? packageName}</Text>
      <Text style={s.pkg}>{packageName}</Text>
      {!!sdk && <Text style={s.sdkTag}>{sdk}</Text>}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#00ff88" size="large" />
          <Text style={s.hint}>Reading via root...</Text>
        </View>
      ) : (
        <>
          {/* ── AppsFlyer ── single line: ADID|AF ── */}
          {sdkType === 'appsflyer' && (
            <View style={s.box}>
              <Text style={s.label}>AF · ADID | INSTALLATION</Text>
              {afCombined ? (
                <TouchableOpacity activeOpacity={0.6} onPress={() => copy(afCombined, 'Copied')}>
                  <Text style={s.value} selectable>{afCombined}</Text>
                  <Text style={s.tapHint}>tap to copy</Text>
                </TouchableOpacity>
              ) : (
                <Text style={s.none}>No AppsFlyer data for this app</Text>
              )}
            </View>
          )}

          {/* ── Adjust ── only the device Advertising ID ── */}
          {sdkType === 'adjust' && (
            <View style={s.box}>
              <Text style={s.label}>ADVERTISING ID (device)</Text>
              {adidValue ? (
                <TouchableOpacity activeOpacity={0.6} onPress={() => copy(adidValue, 'Advertising ID')}>
                  <Text style={s.value} selectable>{adidValue}</Text>
                  <Text style={s.tapHint}>tap to copy</Text>
                </TouchableOpacity>
              ) : (
                <Text style={s.none}>Not available on this device</Text>
              )}
            </View>
          )}

          {/* ── Singular ── two separate ids ── */}
          {sdkType === 'singular' && (
            <>
              <View style={s.box}>
                <Text style={s.label}>AIFA</Text>
                {aifa ? (
                  <TouchableOpacity activeOpacity={0.6} onPress={() => copy(aifa, 'AIFA')}>
                    <Text style={s.value} selectable>{aifa}</Text>
                    <Text style={s.tapHint}>tap to copy</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={s.none}>AIFA not found</Text>
                )}
              </View>

              <View style={s.box}>
                <Text style={s.label}>Singular Install ID</Text>
                {singularInstallId ? (
                  <TouchableOpacity activeOpacity={0.6} onPress={() => copy(singularInstallId, 'Singular Install ID')}>
                    <Text style={s.value} selectable>{singularInstallId}</Text>
                    <Text style={s.tapHint}>tap to copy</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={s.none}>Install ID not found</Text>
                )}
              </View>
            </>
          )}

          {/* ── Unknown / fallback ── show whatever we could read ── */}
          {sdkType === 'unknown' && (
            <>
              <View style={s.box}>
                <Text style={s.label}>AF · ADID | INSTALLATION</Text>
                {afCombined ? (
                  <TouchableOpacity activeOpacity={0.6} onPress={() => copy(afCombined, 'Copied')}>
                    <Text style={s.value} selectable>{afCombined}</Text>
                    <Text style={s.tapHint}>tap to copy</Text>
                  </TouchableOpacity>
                ) : adidValue ? (
                  <TouchableOpacity activeOpacity={0.6} onPress={() => copy(adidValue, 'Advertising ID')}>
                    <Text style={s.value} selectable>{adidValue}</Text>
                    <Text style={s.tapHint}>tap to copy (advertising id)</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={s.none}>No data for this app</Text>
                )}
              </View>
            </>
          )}
        </>
      )}

      {!loading && sdkType === 'appsflyer' && raw !== '' && (
        <View style={s.rawBox}>
          <TouchableOpacity onPress={() => setShowRaw(v => !v)}>
            <Text style={s.rawToggle}>{showRaw ? '▼' : '▶'} Raw appsflyer-data.xml</Text>
          </TouchableOpacity>
          {showRaw && <Text style={s.raw} selectable>{raw}</Text>}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0d0d0d'},
  content: {padding: 16, paddingBottom: 40},
  appName: {color: '#e0e0e0', fontSize: 20, fontFamily: 'monospace', fontWeight: 'bold'},
  pkg: {color: '#555', fontSize: 12, fontFamily: 'monospace', marginTop: 4},
  sdkTag: {color: '#0af', fontSize: 11, fontFamily: 'monospace', marginTop: 6},

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
    fontSize: 11,
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: 12,
  },
  value: {color: '#00ff88', fontSize: 14, fontFamily: 'monospace', lineHeight: 22, letterSpacing: 0.3},
  tapHint: {color: '#2a6a40', fontSize: 10, fontFamily: 'monospace', marginTop: 10, letterSpacing: 1},
  none: {color: '#444', fontFamily: 'monospace', fontSize: 12},

  center: {alignItems: 'center', gap: 12, paddingVertical: 40},
  hint: {color: '#444', fontFamily: 'monospace', fontSize: 12},

  rawBox: {marginTop: 20},
  rawToggle: {color: '#5bc8ff', fontFamily: 'monospace', fontSize: 12},
  raw: {
    marginTop: 10, color: '#777', fontFamily: 'monospace', fontSize: 11,
    lineHeight: 17, backgroundColor: '#0a0a0a', borderRadius: 8, padding: 12,
  },
});
