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
import {rootBridge, AppSdkInfo} from '../native/RootBridge';

export default function AfScreen({route}: any) {
  const {packageName, appName, sdk} = route.params as {
    packageName: string;
    appName?: string;
    sdk?: string;
  };

  const [loading, setLoading] = useState(true);
  const [sdkInfo, setSdkInfo] = useState<AppSdkInfo | null>(null);
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
    setSdkInfo(null);

    // 1. Probe the app's own shared_prefs directly — the source of truth.
    //    Reliable across devices (doesn't depend on `pm list packages -3`).
    let info: AppSdkInfo = {appsflyer: false, singular: false, adjust: false, files: []};
    try {
      info = await rootBridge.detectAppSdk(packageName);
    } catch (_) {}
    setSdkInfo(info);

    const tasks: Promise<void>[] = [];

    // 2. Device Advertising ID — always useful (AF combo + Adjust + fallback)
    tasks.push(
      rootBridge.getAdvertisingId()
        .then(r => { if (r.found && r.value) setAdidValue(r.value); })
        .catch(() => {}),
    );

    // 3. AppsFlyer — read when the app actually has an appsflyer pref file
    if (info.appsflyer) {
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

    // 4. Singular — read when the app has singular pref files
    if (info.singular) {
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

  const showAdjustBlock =
    !!sdkInfo && sdkInfo.adjust && !sdkInfo.appsflyer && !sdkInfo.singular;

  const hasAnyData =
    !!afValue || !!adidValue || !!aifa || !!singularInstallId;

  // Pretty SDK label for the header (from live probe, fallback to passed sdk)
  const detectedLabel = (() => {
    if (!sdkInfo) return sdk ?? '';
    const parts: string[] = [];
    if (sdkInfo.appsflyer) parts.push('AppsFlyer');
    if (sdkInfo.singular) parts.push('Singular');
    if (sdkInfo.adjust) parts.push('Adjust');
    if (sdkInfo.branch) parts.push('Branch');
    return parts.join(' · ') || sdk || '';
  })();

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.appName}>{appName ?? packageName}</Text>
      <Text style={s.pkg}>{packageName}</Text>
      {!!detectedLabel && <Text style={s.sdkTag}>{detectedLabel}</Text>}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#00ff88" size="large" />
          <Text style={s.hint}>Reading via root...</Text>
        </View>
      ) : (
        <>
          {/* ── AppsFlyer ── separate lines: ADID then AF_INSTALLATION ── */}
          {sdkInfo?.appsflyer && (
            <>
              <View style={s.box}>
                <Text style={s.label}>Advertising ID</Text>
                {adidValue ? (
                  <TouchableOpacity activeOpacity={0.6} onPress={() => copy(adidValue, 'Advertising ID')}>
                    <Text style={s.value} selectable>{adidValue}</Text>
                    <Text style={s.tapHint}>tap to copy</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={s.none}>Advertising ID not available</Text>
                )}
              </View>

              <View style={s.box}>
                <Text style={s.label}>AF Installation</Text>
                {afValue ? (
                  <TouchableOpacity activeOpacity={0.6} onPress={() => copy(afValue, 'AF Installation')}>
                    <Text style={s.value} selectable>{afValue}</Text>
                    <Text style={s.tapHint}>tap to copy</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={s.none}>appsflyer-data.xml found but AF_INSTALLATION missing</Text>
                )}
              </View>
            </>
          )}

          {/* ── Singular ── two separate ids ── */}
          {sdkInfo?.singular && (
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

          {/* ── Adjust (pure) ── only the device Advertising ID ── */}
          {showAdjustBlock && (
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

          {/* ── Fallback: nothing detected / no data ── show device ADID ── */}
          {!hasAnyData && (
            <View style={s.box}>
              <Text style={s.label}>ADVERTISING ID (device)</Text>
              {adidValue ? (
                <TouchableOpacity activeOpacity={0.6} onPress={() => copy(adidValue, 'Advertising ID')}>
                  <Text style={s.value} selectable>{adidValue}</Text>
                  <Text style={s.tapHint}>tap to copy</Text>
                </TouchableOpacity>
              ) : (
                <Text style={s.none}>No identifiers found for this app</Text>
              )}
            </View>
          )}
        </>
      )}

      {!loading && sdkInfo?.appsflyer && raw !== '' && (
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
