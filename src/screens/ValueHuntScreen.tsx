import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
  ScrollView,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {rootBridge, ValueHit, ValueSearchFile} from '../native/RootBridge';

// ─── Types ───────────────────────────────────────────────────────────────────
type Phase = 'search' | 'refine' | 'done';

interface FileGroup {
  path: string;
  size: string;
  hits: ValueHit[]; // parsed from "offset:encoding" pairs
}

const ENC_LABEL: Record<string, string> = {
  ascii: 'text',
  i32:   'int32',
  i64:   'int64',
  f32:   'float',
  f64:   'double',
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function ValueHuntScreen({navigation, route}: any) {
  const packageName: string = route.params.packageName;
  const appName: string = route.params.appName ?? packageName;

  const [phase, setPhase] = useState<Phase>('search');
  const [values, setValues] = useState('');       // "6, 500"
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  // Search results grouped per file
  const [groups, setGroups] = useState<FileGroup[]>([]);
  // Flat hit list for refine rounds
  const [hits, setHits] = useState<ValueHit[]>([]);
  const [searchedValues, setSearchedValues] = useState<string[]>([]);

  // Refine input
  const [newValue, setNewValue] = useState('');

  // Write modal (Alert.prompt is iOS-only)
  const [writeTarget, setWriteTarget] = useState<ValueHit | null>(null);
  const [writeVal, setWriteVal] = useState('');
  const [writing, setWriting] = useState(false);

  // Persist search state so it survives process death (app killed in
  // background while playing the game)
  const stateKey = `valuehunt:${packageName}`;

  useEffect(() => {
    navigation.setOptions({title: `Value Hunt — ${appName}`});
    AsyncStorage.getItem(stateKey).then(v => {
      if (!v) return;
      try {
        const j = JSON.parse(v);
        if (Array.isArray(j.hits) && j.hits.length > 0) {
          setHits(j.hits);
          setSearchedValues(j.searchedValues ?? []);
          setValues(j.values ?? '');
          const byPath = new Map<string, ValueHit[]>();
          for (const h of j.hits as ValueHit[]) {
            if (!byPath.has(h.path)) byPath.set(h.path, []);
            byPath.get(h.path)!.push(h);
          }
          setGroups(
            Array.from(byPath.entries()).map(([path, hs]) => ({path, size: '', hits: hs})),
          );
          setPhase(j.hits.length === 1 ? 'done' : 'refine');
        }
      } catch (_) {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (hs: ValueHit[], vals: string[], input: string) => {
    AsyncStorage.setItem(
      stateKey,
      JSON.stringify({hits: hs, searchedValues: vals, values: input}),
    ).catch(() => {});
  };

  // ── Initial search ────────────────────────────────────────────────────────
  const runSearch = async () => {
    const vals = values.split(',').map(v => v.trim()).filter(Boolean);
    if (vals.length === 0) {
      Alert.alert('Enter values', 'e.g. your level and coins: 6, 500');
      return;
    }
    for (const v of vals) {
      if (isNaN(parseFloat(v))) {
        Alert.alert('Invalid value', `"${v}" is not a number`);
        return;
      }
    }
    setSearching(true);
    setError('');
    setGroups([]);
    setHits([]);
    try {
      const files: ValueSearchFile[] = await rootBridge.valueSearch(
        packageName,
        vals.join(','),
      );
      const gs: FileGroup[] = files.map(f => ({
        path: f.path,
        size: f.size,
        hits: f.hits
          .split(',')
          .filter(Boolean)
          .map(h => {
            const [off, enc] = h.split(':');
            return {path: f.path, offset: parseInt(off, 10), encoding: enc as ValueHit['encoding']};
          }),
      }));
      setGroups(gs);
      const flat = gs.flatMap(g => g.hits);
      setHits(flat);
      setSearchedValues(vals);
      persist(flat, vals, values);
      setPhase(gs.length > 0 ? 'refine' : 'search');
      if (gs.length === 0) {
        setError(
          'No file contains these values. The game may encrypt its save, or store a derived number (e.g. level-1).',
        );
      }
    } catch (e: any) {
      setError(e?.message ?? 'Search failed');
    }
    setSearching(false);
  };

  // ── Refine round ──────────────────────────────────────────────────────────
  const runRefine = async () => {
    const nv = newValue.trim();
    if (!nv || isNaN(parseFloat(nv))) {
      Alert.alert('Enter the new value', 'e.g. your level is now 7');
      return;
    }
    setSearching(true);
    setError('');
    try {
      const csv = hits.map(h => `${h.path}:${h.offset}:${h.encoding}`).join(';');
      const kept: ValueHit[] = await rootBridge.valueRefine(csv, nv);
      setHits(kept);
      persist(kept, [...searchedValues, nv], values);
      // regroup
      const byPath = new Map<string, ValueHit[]>();
      for (const h of kept) {
        if (!byPath.has(h.path)) byPath.set(h.path, []);
        byPath.get(h.path)!.push(h);
      }
      setGroups(
        Array.from(byPath.entries()).map(([path, hs]) => ({path, size: '', hits: hs})),
      );
      setSearchedValues(vs => [...vs, nv]);
      setNewValue('');
      if (kept.length === 0) {
        setError('All hits eliminated — the value may be stored differently. Start over.');
      } else if (kept.length === 1) {
        setPhase('done');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Refine failed');
    }
    setSearching(false);
  };

  // ── Write a new value ─────────────────────────────────────────────────────
  const openWrite = (hit: ValueHit) => {
    setWriteTarget(hit);
    setWriteVal('');
  };

  const doWrite = async () => {
    if (!writeTarget) return;
    const v = writeVal.trim();
    if (!v || isNaN(parseFloat(v))) {
      Alert.alert('Invalid', 'Enter a number');
      return;
    }
    setWriting(true);
    try {
      await rootBridge.valueWrite(writeTarget.path, writeTarget.offset, writeTarget.encoding, v);
      rootBridge.execShell(`am force-stop ${packageName}`).catch(() => {});
      setWriteTarget(null);
      Alert.alert('Written', `${v} written. Game force-stopped — reopen it.`);
    } catch (e: any) {
      Alert.alert('Write failed', e?.message ?? 'Unknown error');
    }
    setWriting(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const renderGroup = ({item}: {item: FileGroup}) => {
    const name = item.path.split('/').pop() ?? item.path;
    const dir = item.path.replace(`/data/data/${packageName}/`, '');
    return (
      <View style={s.card}>
        <Text style={s.cardName} numberOfLines={1}>{name}</Text>
        <Text style={s.cardPath} numberOfLines={1}>{dir}</Text>
        <Text style={s.cardMeta}>
          {item.hits.length} hit{item.hits.length !== 1 ? 's' : ''}
          {item.size ? `  ·  ${item.size}` : ''}
        </Text>
        {phase === 'done' || item.hits.length <= 5 ? (
          <View style={s.hitList}>
            {item.hits.slice(0, 8).map((h, i) => (
              <TouchableOpacity
                key={i}
                style={s.hitChip}
                onPress={() => openWrite(h)}>
                <Text style={s.hitChipText}>
                  @{h.offset} · {ENC_LABEL[h.encoding] ?? h.encoding}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView style={s.container} keyboardShouldPersistTaps="handled">
      {/* Search input */}
      <View style={s.inputBlock}>
        <Text style={s.label}>Values you know (comma-separated)</Text>
        <TextInput
          style={s.input}
          placeholder="e.g. 6, 500   (level, coins)"
          placeholderTextColor="#444"
          value={values}
          onChangeText={setValues}
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          autoCapitalize="none"
        />
        <TouchableOpacity
          style={[s.btn, searching && s.btnDisabled]}
          disabled={searching}
          onPress={runSearch}>
          <Text style={s.btnText}>{searching ? 'Scanning...' : '🔍 Search all files'}</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={s.errText}>⚠ {error}</Text> : null}

      {searching && (
        <View style={s.centerRow}>
          <ActivityIndicator color="#00ff88" />
          <Text style={s.hint}>Reading files via root (base64)...</Text>
        </View>
      )}

      {/* Refine block */}
      {phase !== 'search' && hits.length > 0 && (
        <View style={s.refineBlock}>
          <Text style={s.label}>
            Chain: {searchedValues.join(' → ')} — {hits.length} hit{hits.length !== 1 ? 's' : ''} left
          </Text>
          <View style={s.refineRow}>
            <TextInput
              style={[s.input, {flex: 1, marginBottom: 0}]}
              placeholder="New value after playing"
              placeholderTextColor="#444"
              value={newValue}
              onChangeText={setNewValue}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[s.btn, {marginTop: 0}, searching && s.btnDisabled]}
              disabled={searching}
              onPress={runRefine}>
              <Text style={s.btnText}>Refine</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.refineHint}>
            Play the game so the value changes (level 6 → 7), enter the new value, refine.
          </Text>
        </View>
      )}

      {/* Results */}
      {groups.length > 0 && (
        <FlatList
          data={groups}
          keyExtractor={item => item.path}
          renderItem={renderGroup}
          scrollEnabled={false}
          ListHeaderComponent={
            <Text style={s.listHead}>
              {phase === 'done'
                ? '🎯 Exact location found — tap a hit to write a new value'
                : `${groups.length} files contain ${searchedValues.join(' + ')}`}
            </Text>
          }
        />
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0d0d0d'},

  inputBlock: {padding: 12, gap: 8},
  label: {color: '#888', fontFamily: 'monospace', fontSize: 11},
  input: {
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  btn: {
    marginTop: 4,
    paddingVertical: 11,
    borderRadius: 8,
    backgroundColor: '#0a2a15',
    borderWidth: 1,
    borderColor: '#00ff88',
    alignItems: 'center',
  },
  btnDisabled: {opacity: 0.4},
  btnText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 13, fontWeight: 'bold'},

  centerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 10},
  hint: {color: '#333', fontFamily: 'monospace', fontSize: 11},
  errText: {color: '#ff4444', fontFamily: 'monospace', fontSize: 12, paddingHorizontal: 14, paddingVertical: 8, lineHeight: 18},

  refineBlock: {
    margin: 12,
    marginTop: 0,
    padding: 12,
    backgroundColor: '#101a14',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3a2a',
    gap: 8,
  },
  refineRow: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  refineHint: {color: '#444', fontFamily: 'monospace', fontSize: 10, lineHeight: 15},

  listHead: {color: '#888', fontFamily: 'monospace', fontSize: 11, paddingHorizontal: 14, paddingVertical: 8},

  card: {
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 10,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  cardName: {color: '#ddd', fontFamily: 'monospace', fontSize: 13},
  cardPath: {color: '#444', fontFamily: 'monospace', fontSize: 10, marginTop: 3},
  cardMeta: {color: '#00ff88', fontFamily: 'monospace', fontSize: 10, marginTop: 4},

  hitList: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8},
  hitChip: {
    backgroundColor: '#0a2a15',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#00ff88',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  hitChipText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 10},

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a2a',
    padding: 16,
    gap: 12,
  },
  modalTitle: {color: '#00ff88', fontFamily: 'monospace', fontSize: 14, fontWeight: 'bold'},
  modalInfo: {color: '#888', fontFamily: 'monospace', fontSize: 11, lineHeight: 17},
  modalBtns: {flexDirection: 'row', gap: 10},
  modalBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 7,
    backgroundColor: '#0a2a15',
    borderWidth: 1,
    borderColor: '#00ff88',
    alignItems: 'center',
  },
  modalBtnText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 13, fontWeight: 'bold'},
});
