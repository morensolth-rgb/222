import React, {useEffect, useMemo, useState, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {rootBridge, SaveCandidate} from '../native/RootBridge';

// ─── Snapshot parsing / diffing ──────────────────────────────────────────────
interface SnapEntry {size: number; mtime: number; md5: string}
type Snapshot = Record<string, SnapEntry>;

function parseSnapshot(raw: string): Snapshot {
  const out: Snapshot = {};
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const p = line.split('|');
    if (p.length < 4) continue;
    out[p[0]] = {
      size: parseInt(p[1], 10) || 0,
      mtime: parseInt(p[2], 10) || 0,
      md5: p[3],
    };
  }
  return out;
}

interface DiffEntry {
  path: string;
  change: 'new' | 'modified' | 'deleted';
  oldSize: number;
  newSize: number;
}

function diffSnapshots(before: Snapshot, after: Snapshot): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const path of Object.keys(after)) {
    const a = after[path];
    const b = before[path];
    if (!b) {
      out.push({path, change: 'new', oldSize: 0, newSize: a.size});
    } else if (b.md5 !== '-' && a.md5 !== '-' ? b.md5 !== a.md5
                                             : b.size !== a.size || b.mtime !== a.mtime) {
      out.push({path, change: 'modified', oldSize: b.size, newSize: a.size});
    }
  }
  for (const path of Object.keys(before)) {
    if (!after[path]) out.push({path, change: 'deleted', oldSize: before[path].size, newSize: 0});
  }
  // Interesting first: modified, then new, then deleted; bigger delta first
  const rank = {modified: 0, new: 1, deleted: 2};
  out.sort((x, y) =>
    rank[x.change] - rank[y.change] ||
    Math.abs(y.newSize - y.oldSize) - Math.abs(x.newSize - x.oldSize));
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const KIND_META: Record<string, {icon: string; color: string}> = {
  xml:    {icon: '⟨⟩', color: '#ff9f43'},
  json:   {icon: '{}', color: '#5bc8ff'},
  sqlite: {icon: '▤',  color: '#c56cf0'},
  bin:    {icon: '01', color: '#666'},
};

const CHANGE_META: Record<DiffEntry['change'], {label: string; color: string}> = {
  modified: {label: 'MOD', color: '#00ff88'},
  new:      {label: 'NEW', color: '#ffd700'},
  deleted:  {label: 'DEL', color: '#ff4444'},
};

function ago(mtime: number): string {
  const d = Date.now() / 1000 - mtime;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// ─── Component ───────────────────────────────────────────────────────────────
type Tab = 'scan' | 'diff';

export default function SaveHunterScreen({navigation, route}: any) {
  const packageName: string = route.params.packageName;
  const appName: string = route.params.appName ?? packageName;
  const snapKey = `snap:${packageName}`;

  const [tab, setTab] = useState<Tab>('scan');

  // Quick scan state
  const [candidates, setCandidates] = useState<SaveCandidate[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanError, setScanError] = useState('');

  // Snapshot diff state
  const [hasBaseline, setHasBaseline] = useState(false);
  const [baselineTime, setBaselineTime] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const [diffs, setDiffs] = useState<DiffEntry[] | null>(null);
  const [diffError, setDiffError] = useState('');

  useEffect(() => {
    navigation.setOptions({title: `Save Hunter — ${appName}`});
    AsyncStorage.getItem(snapKey).then(v => {
      if (v) {
        try {
          const j = JSON.parse(v);
          setHasBaseline(true);
          setBaselineTime(j.time ?? 0);
        } catch (_) {}
      }
    });
    runScan();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Quick scan ────────────────────────────────────────────────────────────
  const runScan = useCallback(async () => {
    setScanning(true);
    setScanError('');
    try {
      const list = await rootBridge.scanSaves(packageName);
      setCandidates(list);
    } catch (e: any) {
      setScanError(e?.message ?? 'Scan failed');
    }
    setScanning(false);
    setScanDone(true);
  }, [packageName]);

  // ── Snapshot diff ─────────────────────────────────────────────────────────
  const takeBaseline = async () => {
    setSnapping(true);
    setDiffError('');
    try {
      const raw = await rootBridge.snapshot(packageName);
      await AsyncStorage.setItem(snapKey, JSON.stringify({time: Date.now(), raw}));
      setHasBaseline(true);
      setBaselineTime(Date.now());
      setDiffs(null);
      Alert.alert(
        'Baseline saved',
        'Now open the game, make some progress (earn coins, kill an enemy, finish a level), then come back and tap Compare.',
      );
    } catch (e: any) {
      setDiffError(e?.message ?? 'Snapshot failed');
    }
    setSnapping(false);
  };

  const compare = async () => {
    setSnapping(true);
    setDiffError('');
    try {
      const stored = await AsyncStorage.getItem(snapKey);
      if (!stored) throw new Error('No baseline — take one first');
      const before = parseSnapshot(JSON.parse(stored).raw);
      const raw = await rootBridge.snapshot(packageName);
      const after = parseSnapshot(raw);
      setDiffs(diffSnapshots(before, after));
    } catch (e: any) {
      setDiffError(e?.message ?? 'Compare failed');
    }
    setSnapping(false);
  };

  // ── Open a file in the right editor ───────────────────────────────────────
  const openFile = useCallback((path: string, kind?: string) => {
    const k = kind ?? 'bin';
    if (k === 'xml' || path.endsWith('.xml')) {
      // Reuse the prefs editor for any XML file
      navigation.navigate('PlayerPrefs', {
        path,
        title: path.split('/').pop(),
        packageName,
        appName: path.split('/').pop(),
      });
    } else {
      navigation.navigate('FileBrowser', {
        path: path.substring(0, path.lastIndexOf('/')),
        title: path.split('/').pop(),
        openFile: path,
      });
    }
  }, [navigation, packageName]);

  // ── Render: scan tab ──────────────────────────────────────────────────────
  const renderCandidate = ({item}: {item: SaveCandidate}) => {
    const km = KIND_META[item.kind] ?? KIND_META.bin;
    const name = item.path.split('/').pop() ?? item.path;
    const dir = item.path.replace(`/data/data/${packageName}/`, '');
    return (
      <TouchableOpacity style={s.card} onPress={() => openFile(item.path, item.kind)}>
        <View style={s.cardHead}>
          <Text style={[s.kindIcon, {color: km.color}]}>{km.icon}</Text>
          <Text style={s.cardName} numberOfLines={1}>{name}</Text>
          <View style={s.scorePill}>
            <Text style={s.scoreText}>{item.score}</Text>
          </View>
        </View>
        <Text style={s.cardPath} numberOfLines={1}>{dir}</Text>
        <Text style={s.cardMeta}>
          {item.size}  ·  {ago(item.mtime)}  ·  {item.hits} keyword hits
        </Text>
      </TouchableOpacity>
    );
  };

  const scanBody = scanning ? (
    <View style={s.center}>
      <ActivityIndicator color="#00ff88" size="large" />
      <Text style={s.hint}>Scanning game files via root...</Text>
    </View>
  ) : scanError ? (
    <View style={s.center}>
      <Text style={s.errText}>⚠ {scanError}</Text>
      <TouchableOpacity style={s.retryBtn} onPress={runScan}>
        <Text style={s.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <FlatList
      data={candidates}
      keyExtractor={item => item.path}
      renderItem={renderCandidate}
      contentContainerStyle={{paddingBottom: 20}}
      ListHeaderComponent={
        scanDone ? (
          <Text style={s.listHead}>
            {candidates.length} candidate files — tap to open & edit
          </Text>
        ) : null
      }
      ListEmptyComponent={
        <Text style={s.empty}>No files with progress keywords found</Text>
      }
      initialNumToRender={30}
      maxToRenderPerBatch={30}
      windowSize={10}
    />
  );

  // ── Render: diff tab ──────────────────────────────────────────────────────
  const renderDiff = ({item}: {item: DiffEntry}) => {
    const cm = CHANGE_META[item.change];
    const name = item.path.split('/').pop() ?? item.path;
    const dir = item.path.replace(`/data/data/${packageName}/`, '');
    const delta = item.newSize - item.oldSize;
    return (
      <TouchableOpacity
        style={s.card}
        onPress={() => item.change !== 'deleted' && openFile(item.path)}>
        <View style={s.cardHead}>
          <Text style={[s.changeBadge, {color: cm.color, borderColor: cm.color}]}>
            {cm.label}
          </Text>
          <Text style={s.cardName} numberOfLines={1}>{name}</Text>
          <Text style={s.deltaText}>
            {item.change === 'deleted'
              ? `-${item.oldSize}B`
              : `${delta >= 0 ? '+' : ''}${delta}B`}
          </Text>
        </View>
        <Text style={s.cardPath} numberOfLines={1}>{dir}</Text>
      </TouchableOpacity>
    );
  };

  const diffBody = (
    <View style={{flex: 1}}>
      <View style={s.diffControls}>
        <TouchableOpacity
          style={[s.diffBtn, snapping && s.diffBtnDisabled]}
          disabled={snapping}
          onPress={takeBaseline}>
          <Text style={s.diffBtnText}>
            {hasBaseline ? '↺ Retake baseline' : '📸 Take baseline'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.diffBtn, (!hasBaseline || snapping) && s.diffBtnDisabled]}
          disabled={!hasBaseline || snapping}
          onPress={compare}>
          <Text style={s.diffBtnText}>⚖ Compare now</Text>
        </TouchableOpacity>
      </View>
      {hasBaseline && (
        <Text style={s.baselineInfo}>
          Baseline from {new Date(baselineTime).toLocaleTimeString()} — play the game, then compare
        </Text>
      )}
      {snapping ? (
        <View style={s.center}>
          <ActivityIndicator color="#00ff88" size="large" />
          <Text style={s.hint}>Hashing files via root...</Text>
        </View>
      ) : diffError ? (
        <View style={s.center}>
          <Text style={s.errText}>⚠ {diffError}</Text>
        </View>
      ) : diffs ? (
        <FlatList
          data={diffs}
          keyExtractor={item => item.path}
          renderItem={renderDiff}
          contentContainerStyle={{paddingBottom: 20}}
          ListHeaderComponent={
            <Text style={s.listHead}>
              {diffs.length} files changed — these hold your progress
            </Text>
          }
          ListEmptyComponent={
            <Text style={s.empty}>
              No changes detected.{'\n'}Make sure the game actually saved (some games save on exit).
            </Text>
          }
        />
      ) : (
        <View style={s.center}>
          <Text style={s.diffExplain}>
            {'How it works:\n\n1. Take baseline (snapshot of all game files)\n2. Play the game — earn coins, finish a level\n3. Come back, tap Compare\n4. Files that changed = where progress lives'}
          </Text>
        </View>
      )}
    </View>
  );

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <View style={s.tabs}>
        {([['scan', '🔍 Quick Scan'], ['diff', '📸 Snapshot Diff']] as [Tab, string][]).map(([v, l]) => (
          <TouchableOpacity
            key={v}
            style={[s.tab, tab === v && s.tabActive]}
            onPress={() => setTab(v)}>
            <Text style={[s.tabText, tab === v && s.tabTextActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Value Hunt entry */}
      <TouchableOpacity
        style={s.huntLink}
        onPress={() =>
          navigation.navigate('ValueHunt', {packageName, appName})
        }>
        <Text style={s.huntLinkText}>
          🎯 Know your level/coins? Hunt by exact value →
        </Text>
      </TouchableOpacity>
      {tab === 'scan' ? scanBody : diffBody}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0d0d0d'},
  center:    {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20},
  hint:      {color: '#333', fontFamily: 'monospace', fontSize: 12},
  errText:   {color: '#ff4444', fontFamily: 'monospace', fontSize: 13, textAlign: 'center'},
  retryBtn:  {paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#1a1a1a', borderRadius: 6, borderWidth: 1, borderColor: '#00ff88'},
  retryText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 13},
  empty:     {color: '#333', textAlign: 'center', marginTop: 40, fontFamily: 'monospace', fontSize: 12, lineHeight: 20},

  tabs: {flexDirection: 'row', gap: 6, padding: 10, paddingBottom: 4},

  huntLink: {
    marginHorizontal: 10,
    marginBottom: 6,
    paddingVertical: 9,
    borderRadius: 7,
    backgroundColor: '#101a14',
    borderWidth: 1,
    borderColor: '#1e3a2a',
    alignItems: 'center',
  },
  huntLinkText: {color: '#ffd700', fontFamily: 'monospace', fontSize: 11},
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 7,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    alignItems: 'center',
  },
  tabActive:     {backgroundColor: '#001a0d', borderColor: '#00ff88'},
  tabText:       {color: '#555', fontSize: 12, fontFamily: 'monospace'},
  tabTextActive: {color: '#00ff88'},

  listHead: {
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 11,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  card: {
    marginHorizontal: 10,
    marginVertical: 4,
    padding: 10,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  cardHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
  kindIcon: {fontFamily: 'monospace', fontSize: 12, width: 22, textAlign: 'center'},
  cardName: {flex: 1, color: '#ddd', fontFamily: 'monospace', fontSize: 13},
  cardPath: {color: '#444', fontFamily: 'monospace', fontSize: 10, marginTop: 4},
  cardMeta: {color: '#333', fontFamily: 'monospace', fontSize: 10, marginTop: 3},

  scorePill: {
    backgroundColor: '#0a2a15',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#00ff88',
  },
  scoreText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 11, fontWeight: 'bold'},

  changeBadge: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: 'bold',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    width: 38,
    textAlign: 'center',
  },
  deltaText: {color: '#888', fontFamily: 'monospace', fontSize: 11},

  diffControls: {flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingBottom: 6},
  diffBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 7,
    backgroundColor: '#0a2a15',
    borderWidth: 1,
    borderColor: '#00ff88',
    alignItems: 'center',
  },
  diffBtnDisabled: {opacity: 0.35},
  diffBtnText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 12, fontWeight: 'bold'},
  baselineInfo: {
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 10,
    textAlign: 'center',
    paddingBottom: 6,
  },
  diffExplain: {
    color: '#444',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 22,
    textAlign: 'center',
  },
});
