import React, {useState, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import {rootBridge} from '../native/RootBridge';

type Tab = 'smali' | 'classes' | 'strings' | 'manifest';

const TAB_LABELS: Record<Tab, string> = {
  smali:    'SMALI',
  classes:  'CLASSES',
  strings:  'STRINGS',
  manifest: 'MANIFEST',
};

export default function PatcherScreen() {
  const [apkPath, setApkPath]   = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('classes');
  const [output, setOutput]     = useState<string[]>(['APK Analyzer ready. Enter APK path and analyze.']);
  const [running, setRunning]   = useState(false);
  const [search, setSearch]     = useState('');
  const scrollRef               = useRef<ScrollView>(null);

  const appendLog = (msg: string) => {
    setOutput(prev => [...prev, msg]);
    setTimeout(() => scrollRef.current?.scrollToEnd({animated: true}), 50);
  };

  const clearOutput = () => setOutput([]);

  const runAnalysis = async () => {
    const path = apkPath.trim();
    if (!path) return;
    setRunning(true);
    setOutput([`▶ Analyzing: ${path}`]);
    setSearch('');
    try {
      let cmd = '';
      switch (activeTab) {
        case 'classes':
          // List all .dex classes via dexdump or baksmali
          cmd = `cd /data/local/tmp && su -c "
            if [ -f '${path}' ]; then
              unzip -p '${path}' classes.dex 2>/dev/null | dd 2>/dev/null | strings | grep '^L[a-zA-Z]' | head -500 || \
              dexdump -e '${path}' 2>/dev/null | grep 'Class descriptor' | sed 's/.*Class descriptor.*: //' | head -500 || \
              echo 'Listing via zip...' && unzip -l '${path}' '*.dex' 2>/dev/null
            else
              echo 'File not found: ${path}'
            fi
          "`;
          break;

        case 'smali':
          // Disassemble first 200 lines of main dex using dexdump
          cmd = `su -c "
            if [ -f '${path}' ]; then
              dexdump -d '${path}' 2>/dev/null | head -300 || \
              strings '${path}' | grep -E '^[a-zA-Z_\\.]{3,}$' | sort -u | head -300
            else
              echo 'File not found: ${path}'
            fi
          "`;
          break;

        case 'strings':
          // Extract interesting strings (URLs, keys, package names)
          cmd = `su -c "
            if [ -f '${path}' ]; then
              strings '${path}' | grep -E '(https?://|api_|secret_|key_|token_|password|com\\.[a-z]+\\.[a-z])' | sort -u | head -400
            else
              echo 'File not found: ${path}'
            fi
          "`;
          break;

        case 'manifest':
          // Decode AndroidManifest.xml using aapt if available
          cmd = `su -c "
            if [ -f '${path}' ]; then
              aapt dump badging '${path}' 2>/dev/null || \
              aapt2 dump badging '${path}' 2>/dev/null || \
              unzip -p '${path}' AndroidManifest.xml 2>/dev/null | strings | head -200
            else
              echo 'File not found: ${path}'
            fi
          "`;
          break;
      }

      const result: string = await rootBridge.execShell(cmd);
      const lines = result.split('\n').filter(l => l.trim());
      if (lines.length === 0) {
        appendLog('⚠ No output. Make sure the file is a valid APK.');
      } else {
        lines.forEach(l => appendLog(l));
        appendLog(`\n✓ Done — ${lines.length} lines`);
      }
    } catch (e: any) {
      appendLog('✗ Error: ' + (e?.message || String(e)));
    } finally {
      setRunning(false);
    }
  };

  const filteredOutput = search.trim()
    ? output.filter(l => l.toLowerCase().includes(search.toLowerCase()))
    : output;

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>APK ANALYZER</Text>
        <Text style={s.headerSub}>Inspect smali · classes · strings · manifest</Text>
      </View>

      {/* APK Path input */}
      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          value={apkPath}
          onChangeText={setApkPath}
          placeholder="/sdcard/target.apk  or  /data/app/com.x.y/base.apk"
          placeholderTextColor="#333"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Analysis tabs */}
      <View style={s.tabs}>
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tab, activeTab === t && s.tabActive]}
            onPress={() => setActiveTab(t)}>
            <Text style={[s.tabText, activeTab === t && s.tabTextActive]}>
              {TAB_LABELS[t]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Run button */}
      <TouchableOpacity
        style={[s.runBtn, running && s.runBtnDisabled]}
        onPress={runAnalysis}
        disabled={running}
        activeOpacity={0.8}>
        {running ? (
          <View style={s.runBtnInner}>
            <ActivityIndicator color="#0f0" size="small" />
            <Text style={s.runBtnText}>  ANALYZING...</Text>
          </View>
        ) : (
          <Text style={s.runBtnText}>▶ ANALYZE {TAB_LABELS[activeTab]}</Text>
        )}
      </TouchableOpacity>

      {/* Output */}
      <View style={s.outputBox}>
        <View style={s.outHeader}>
          <Text style={s.outLabel}>
            OUTPUT
            {filteredOutput.length < output.length
              ? ` (${filteredOutput.length}/${output.length})`
              : ` (${output.length})`}
          </Text>
          <TouchableOpacity onPress={clearOutput}>
            <Text style={s.clearBtn}>CLEAR</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={s.searchRow}>
          <TextInput
            style={s.searchInput}
            placeholder="Filter output..."
            placeholderTextColor="#2a2a2a"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} style={s.searchClear}>
              <Text style={s.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView ref={scrollRef} style={s.outScroll} showsVerticalScrollIndicator>
          {filteredOutput.map((line, i) => (
            <Text
              key={i}
              style={[
                s.outLine,
                line.startsWith('✗') && s.outErr,
                line.startsWith('✓') && s.outOk,
                line.startsWith('▶') && s.outInfo,
              ]}
              selectable>
              {line}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0a0a0a', padding: 12, gap: 8},
  header: {
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: {
    color: '#00ff41',
    fontSize: 18,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    fontWeight: 'bold',
    letterSpacing: 4,
  },
  headerSub: {
    color: '#333',
    fontSize: 10,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    marginTop: 2,
  },
  inputRow: {},
  input: {
    backgroundColor: '#111',
    color: '#eee',
    fontSize: 12,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tabs: {flexDirection: 'row', gap: 6},
  tab: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    backgroundColor: '#111',
    alignItems: 'center',
  },
  tabActive: {backgroundColor: '#001a00', borderColor: '#00ff41'},
  tabText: {
    color: '#444',
    fontSize: 10,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  tabTextActive: {color: '#00ff41'},
  runBtn: {
    backgroundColor: '#001a00',
    borderWidth: 1,
    borderColor: '#00ff41',
    borderRadius: 6,
    paddingVertical: 13,
    alignItems: 'center',
  },
  runBtnDisabled: {opacity: 0.5},
  runBtnInner: {flexDirection: 'row', alignItems: 'center'},
  runBtnText: {
    color: '#00ff41',
    fontSize: 13,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    fontWeight: 'bold',
    letterSpacing: 3,
  },
  outputBox: {
    flex: 1,
    backgroundColor: '#050505',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  outHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  outLabel: {
    color: '#333',
    fontSize: 10,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    letterSpacing: 3,
  },
  clearBtn: {
    color: '#333',
    fontSize: 10,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    letterSpacing: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#141414',
    paddingHorizontal: 8,
  },
  searchInput: {
    flex: 1,
    color: '#00ff41',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    fontSize: 11,
    paddingVertical: 6,
  },
  searchClear: {padding: 4},
  searchClearText: {color: '#444', fontSize: 12},
  outScroll: {flex: 1, padding: 8},
  outLine: {
    color: '#3a6a3a',
    fontSize: 11,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    lineHeight: 17,
  },
  outErr: {color: '#ff4444'},
  outOk:  {color: '#00ff41'},
  outInfo: {color: '#00aaff'},
});
