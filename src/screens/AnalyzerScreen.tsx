import React, {useState, useRef, useCallback} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  FlatList, ScrollView, ActivityIndicator, Modal, Platform,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {rootBridge, AppInfo} from '../native/RootBridge';

type Tab = 'classes' | 'methods' | 'fields' | 'smali' | 'strings' | 'manifest';

const TABS: {id: Tab; label: string; icon: string}[] = [
  {id: 'classes',  label: 'CLASSES',  icon: '📦'},
  {id: 'methods',  label: 'METHODS',  icon: '⚙️'},
  {id: 'fields',   label: 'FIELDS',   icon: '🏷'},
  {id: 'smali',    label: 'SMALI',    icon: '🔍'},
  {id: 'strings',  label: 'STRINGS',  icon: '🔤'},
  {id: 'manifest', label: 'MANIFEST', icon: '📋'},
];

export default function AnalyzerScreen() {
  const [apps, setApps]             = useState<AppInfo[]>([]);
  const [filteredApps, setFiltered] = useState<AppInfo[]>([]);
  const [appSearch, setAppSearch]   = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [loadingApps, setLoadingApps]     = useState(false);
  const [selectedApp, setSelectedApp]     = useState<AppInfo | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>('classes');
  const [output, setOutput]       = useState<string[]>([]);
  const [running, setRunning]     = useState(false);
  const [outSearch, setOutSearch] = useState('');

  const scrollRef = useRef<ScrollView>(null);

  useFocusEffect(useCallback(() => { /* nothing on focus */ }, []));

  // ── Load installed apps ──────────────────────────────────────────────────────
  const openPicker = async () => {
    setPickerVisible(true);
    if (apps.length > 0) return;
    setLoadingApps(true);
    try {
      const list = await rootBridge.getInstalledApps();
      const userApps = list.filter(a => !a.isSystemApp);
      setApps(userApps);
      setFiltered(userApps);
    } catch (e) {
      setApps([]); setFiltered([]);
    }
    setLoadingApps(false);
  };

  const filterApps = (q: string) => {
    setAppSearch(q);
    const lq = q.toLowerCase();
    setFiltered(apps.filter(a =>
      a.appName.toLowerCase().includes(lq) || a.packageName.toLowerCase().includes(lq)
    ));
  };

  const selectApp = (app: AppInfo) => {
    setSelectedApp(app);
    setPickerVisible(false);
    setOutput(['> ' + app.packageName]);
    setOutSearch('');
  };

  // ── Get APK path from package name ──────────────────────────────────────────
  const getApkPath = async (pkg: string): Promise<string> => {
    const result: string = await rootBridge.execShell(
      'su -c "pm path ' + pkg + ' 2>/dev/null | head -1 | sed \'s/package://\'"',
    );
    return result.trim();
  };

  // ── Run analysis ─────────────────────────────────────────────────────────────
  const analyze = async () => {
    if (!selectedApp) return;
    const pkg = selectedApp.packageName;
    setRunning(true);
    setOutput(['Analyzing ' + pkg + ' [' + activeTab.toUpperCase() + ']...']);
    setOutSearch('');

    // JS-level timeout fallback (60s)
    const timeoutId = setTimeout(() => {
      setRunning(false);
      setOutput(prev =>
        prev[prev.length - 1]?.includes('ANALYZING') || prev.length <= 1
          ? ['Timeout (60s) — try STRINGS or MANIFEST tab']
          : prev
      );
    }, 60000);

    try {
      const apkPath = await getApkPath(pkg);
      if (!apkPath) {
        clearTimeout(timeoutId);
        setOutput(['Could not find APK path.']);
        setRunning(false);
        return;
      }

      // Shell.cmd() runs as root directly — no su -c wrapping needed
      // Use sh -c with single-quoted inner command to avoid any escaping issues
      const T = '/data/local/tmp/ax' + Date.now();
      let cmd = '';

      switch (activeTab) {
        case 'classes':
          cmd = 'mkdir -p ' + T
              + ' && unzip -q ' + apkPath + ' classes.dex -d ' + T + ' 2>/dev/null'
              + ' && strings ' + T + '/classes.dex'
              + ' | grep -oE "L[a-zA-Z][a-zA-Z0-9/_]{3,};"'
              + ' | sort -u | head -500'
              + ' ; rm -rf ' + T;
          break;
        case 'methods':
          cmd = 'mkdir -p ' + T
              + ' && unzip -q ' + apkPath + ' classes.dex -d ' + T + ' 2>/dev/null'
              + ' && strings ' + T + '/classes.dex'
              + ' | grep -E "^[a-z][a-zA-Z0-9_]{2,40}$"'
              + ' | sort -u | head -500'
              + ' ; rm -rf ' + T;
          break;
        case 'fields':
          cmd = 'mkdir -p ' + T
              + ' && unzip -q ' + apkPath + ' classes.dex -d ' + T + ' 2>/dev/null'
              + ' && strings ' + T + '/classes.dex'
              + ' | grep -E "^[a-z_][a-zA-Z0-9_]{1,30}$"'
              + ' | sort -u | head -500'
              + ' ; rm -rf ' + T;
          break;
        case 'smali':
          cmd = 'mkdir -p ' + T
              + ' && unzip -q ' + apkPath + ' classes.dex -d ' + T + ' 2>/dev/null'
              + ' && strings ' + T + '/classes.dex | head -400'
              + ' ; rm -rf ' + T;
          break;
        case 'strings':
          cmd = 'strings ' + apkPath
              + ' | grep -aE "(https?://|/api/|secret|token|password|auth|Bearer|key=|apikey)"'
              + ' | sort -u | head -300';
          break;
        case 'manifest':
          cmd = 'unzip -p ' + apkPath + ' AndroidManifest.xml 2>/dev/null | strings | head -100';
          break;
      }

      const result: string = await rootBridge.execShell(cmd);
      clearTimeout(timeoutId);
      const lines = result.split('\n').filter(l => l.trim());

      if (!lines.length) {
        setOutput([
          'No output — try STRINGS or MANIFEST tab',
          'Possible: dexdump not available / APK encrypted',
        ]);
      } else {
        setOutput(lines);
        setTimeout(() => scrollRef.current?.scrollToEnd({animated: false}), 100);
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      setOutput(['Error: ' + (e?.message || String(e))]);
    }

    setRunning(false);
  };

  const filteredOutput = outSearch.trim()
    ? output.filter(l => l.toLowerCase().includes(outSearch.toLowerCase()))
    : output;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>

      {/* App selector */}
      <TouchableOpacity style={s.appBtn} onPress={openPicker} activeOpacity={0.8}>
        {selectedApp ? (
          <View style={s.appBtnInner}>
            <View style={s.appBtnInfo}>
              <Text style={s.appBtnName} numberOfLines={1}>{selectedApp.appName}</Text>
              <Text style={s.appBtnPkg}  numberOfLines={1}>{selectedApp.packageName}</Text>
            </View>
            <Text style={s.appBtnChange}>CHANGE</Text>
          </View>
        ) : (
          <Text style={s.appBtnPlaceholder}>📱  اختار تطبيق للتحليل...</Text>
        )}
      </TouchableOpacity>

      {/* Analysis tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabsScroll}>
        <View style={s.tabs}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[s.tab, activeTab === t.id && s.tabActive]}
              onPress={() => setActiveTab(t.id)}>
              <Text style={s.tabIcon}>{t.icon}</Text>
              <Text style={[s.tabText, activeTab === t.id && s.tabTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Analyze button */}
      <TouchableOpacity
        style={[s.runBtn, (!selectedApp || running) && s.runBtnDisabled]}
        onPress={analyze}
        disabled={!selectedApp || running}
        activeOpacity={0.8}>
        {running ? (
          <View style={s.runBtnRow}>
            <ActivityIndicator color="#00ff88" size="small"/>
            <Text style={s.runBtnText}>  ANALYZING...</Text>
          </View>
        ) : (
          <Text style={s.runBtnText}>ANALYZE {TABS.find(t => t.id === activeTab)?.label}</Text>
        )}
      </TouchableOpacity>

      {/* Output box */}
      <View style={s.outputBox}>
        <View style={s.outHeader}>
          <Text style={s.outLabel}>
            {'RESULT' +
              (filteredOutput.length < output.length
                ? ' (' + filteredOutput.length + '/' + output.length + ')'
                : output.length > 0 ? ' (' + output.length + ')' : '')}
          </Text>
          <TouchableOpacity onPress={() => { setOutput([]); setOutSearch(''); }}>
            <Text style={s.clearBtn}>CLEAR</Text>
          </TouchableOpacity>
        </View>

        <View style={s.searchRow}>
          <TextInput
            style={s.searchInput}
            placeholder="Filter..."
            placeholderTextColor="#222"
            value={outSearch}
            onChangeText={setOutSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {outSearch.length > 0 && (
            <TouchableOpacity onPress={() => setOutSearch('')} style={s.searchX}>
              <Text style={s.searchXText}>X</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView ref={scrollRef} style={s.outScroll} showsVerticalScrollIndicator>
          {filteredOutput.length === 0 ? (
            <Text style={s.outEmpty}>
              {outSearch ? 'No results' : selectedApp ? 'Press ANALYZE' : 'Select an app first'}
            </Text>
          ) : (
            filteredOutput.map((line, i) => (
              <Text
                key={i}
                selectable
                style={[
                  s.outLine,
                  line.startsWith('Error') && s.outErr,
                  line.startsWith('Timeout') && s.outWarn,
                  line.startsWith('Analyzing') && s.outInfo,
                  line.startsWith('L') && line.endsWith(';') && s.outClass,
                  line.includes('name') && line.includes('(') && s.outMethod,
                ]}>
                {line}
              </Text>
            ))
          )}
        </ScrollView>
      </View>

      {/* App picker modal */}
      <Modal visible={pickerVisible} animationType="slide" transparent>
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.header}>
              <Text style={m.title}>Select App</Text>
              <TouchableOpacity onPress={() => setPickerVisible(false)}>
                <Text style={m.close}>X</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={m.search}
              placeholder="Search..."
              placeholderTextColor="#333"
              value={appSearch}
              onChangeText={filterApps}
              autoCorrect={false}
            />

            {loadingApps ? (
              <View style={m.loading}>
                <ActivityIndicator color="#00ff88" size="large"/>
                <Text style={m.loadingText}>Loading...</Text>
              </View>
            ) : (
              <FlatList
                data={filteredApps}
                keyExtractor={item => item.packageName}
                renderItem={({item}) => (
                  <TouchableOpacity style={m.appItem} onPress={() => selectApp(item)} activeOpacity={0.7}>
                    <Text style={m.appName} numberOfLines={1}>{item.appName}</Text>
                    <Text style={m.appPkg}  numberOfLines={1}>{item.packageName}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={m.empty}>No apps found</Text>}
                initialNumToRender={30}
                getItemLayout={(_, index) => ({length: 56, offset: 56 * index, index})}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const MONO = Platform.OS === 'android' ? 'monospace' : 'Courier';

const s = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0a0a0a', padding: 10, gap: 8},

  appBtn: {
    backgroundColor: '#111', borderRadius: 8,
    borderWidth: 1, borderColor: '#1e1e1e',
    padding: 12,
  },
  appBtnInner:       {flexDirection: 'row', alignItems: 'center'},
  appBtnInfo:        {flex: 1},
  appBtnName:        {color: '#eee', fontFamily: MONO, fontSize: 14},
  appBtnPkg:         {color: '#3a3a3a', fontFamily: MONO, fontSize: 10, marginTop: 2},
  appBtnChange:      {color: '#005533', fontFamily: MONO, fontSize: 11, letterSpacing: 2},
  appBtnPlaceholder: {color: '#2a2a2a', fontFamily: MONO, fontSize: 13},

  tabsScroll: {flexGrow: 0},
  tabs: {flexDirection: 'row', gap: 6, paddingBottom: 2},
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 7, borderWidth: 1, borderColor: '#1e1e1e',
    backgroundColor: '#111',
  },
  tabActive:     {backgroundColor: '#001a00', borderColor: '#00ff88'},
  tabIcon:       {fontSize: 13},
  tabText:       {color: '#444', fontFamily: MONO, fontSize: 10, fontWeight: 'bold', letterSpacing: 1},
  tabTextActive: {color: '#00ff88'},

  runBtn: {
    backgroundColor: '#001a00', borderWidth: 1, borderColor: '#00ff88',
    borderRadius: 8, paddingVertical: 13, alignItems: 'center',
  },
  runBtnDisabled: {opacity: 0.35},
  runBtnRow:      {flexDirection: 'row', alignItems: 'center'},
  runBtnText:     {color: '#00ff88', fontFamily: MONO, fontWeight: 'bold', fontSize: 13, letterSpacing: 3},

  outputBox: {
    flex: 1, backgroundColor: '#050505',
    borderRadius: 8, borderWidth: 1, borderColor: '#1a1a1a', overflow: 'hidden',
  },
  outHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#0f0f0f', paddingHorizontal: 10, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#141414',
  },
  outLabel:    {color: '#2a2a2a', fontFamily: MONO, fontSize: 10, letterSpacing: 3},
  clearBtn:    {color: '#2a2a2a', fontFamily: MONO, fontSize: 10, letterSpacing: 2},
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#111', paddingHorizontal: 8,
  },
  searchInput: {flex: 1, color: '#00ff88', fontFamily: MONO, fontSize: 11, paddingVertical: 5},
  searchX:     {padding: 4},
  searchXText: {color: '#444', fontSize: 12},
  outScroll:   {flex: 1, padding: 8},
  outEmpty:    {color: '#1a1a1a', fontFamily: MONO, fontSize: 12, textAlign: 'center', marginTop: 40},
  outLine:     {color: '#2a4a2a', fontFamily: MONO, fontSize: 11, lineHeight: 17},
  outErr:      {color: '#ff4444'},
  outWarn:     {color: '#ffaa00'},
  outInfo:     {color: '#0088ff'},
  outClass:    {color: '#00cc88'},
  outMethod:   {color: '#00aaff'},
});

const m = StyleSheet.create({
  overlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end'},
  sheet: {
    backgroundColor: '#0d0d0d', borderTopWidth: 1, borderTopColor: '#1e1e1e',
    borderTopLeftRadius: 14, borderTopRightRadius: 14,
    maxHeight: '80%', padding: 16,
  },
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12},
  title:  {color: '#00ff88', fontFamily: 'monospace', fontSize: 14, fontWeight: 'bold'},
  close:  {color: '#555', fontSize: 20, padding: 4},
  search: {
    backgroundColor: '#111', borderRadius: 8,
    borderWidth: 1, borderColor: '#1e1e1e',
    paddingHorizontal: 12, paddingVertical: 9,
    color: '#00ff88', fontFamily: 'monospace', fontSize: 13,
    marginBottom: 8,
  },
  loading:     {alignItems: 'center', padding: 40, gap: 12},
  loadingText: {color: '#333', fontFamily: 'monospace', fontSize: 12},
  appItem: {
    paddingHorizontal: 4, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#111',
    height: 56, justifyContent: 'center',
  },
  appName: {color: '#ddd', fontFamily: 'monospace', fontSize: 13},
  appPkg:  {color: '#2a2a2a', fontFamily: 'monospace', fontSize: 10, marginTop: 1},
  empty:   {color: '#222', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', marginTop: 40},
});
