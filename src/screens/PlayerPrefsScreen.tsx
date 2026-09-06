import React, {useEffect, useMemo, useState, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {rootBridge} from '../native/RootBridge';

// ─── Types ───────────────────────────────────────────────────────────────────
type PrefType = 'int' | 'long' | 'float' | 'boolean' | 'string' | 'set';

interface PrefEntry {
  name: string;
  type: PrefType;
  value: string;        // raw value as string (set = comma-joined)
  original: string;     // value at load time — for dirty tracking
}

type Category = 'currency' | 'progress' | 'consumable' | 'identity' | 'other';

// ─── XML parse / serialize ───────────────────────────────────────────────────
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // amp last
}

function encodeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parsePrefs(xml: string): PrefEntry[] {
  const entries: PrefEntry[] = [];

  // <set name="..."><string>..</string>...</set>
  const setRe = /<set\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/set>/g;
  let m: RegExpExecArray | null;
  while ((m = setRe.exec(xml)) !== null) {
    const name = decodeXml(m[1]);
    const inner = m[2];
    const items: string[] = [];
    const strRe = /<string>([\s\S]*?)<\/string>/g;
    let sm: RegExpExecArray | null;
    while ((sm = strRe.exec(inner)) !== null) items.push(decodeXml(sm[1]));
    entries.push({name, type: 'set', value: items.join(','), original: items.join(',')});
  }

  // scalar tags
  const scalarRe =
    /<(int|long|float|boolean|string)\s+name="([^"]*)"(?:\s+value="([^"]*)")?\s*\/?>(?:([\s\S]*?)<\/\1>)?/g;
  while ((m = scalarRe.exec(xml)) !== null) {
    const type = m[1] as PrefType;
    const name = decodeXml(m[2]);
    // value either in attribute or as inner text (<string>..</string>)
    const raw = m[3] !== undefined ? m[3] : (m[4] ?? '');
    const value = decodeXml(raw);
    entries.push({name, type, value, original: value});
  }

  return entries;
}

function serializePrefs(entries: PrefEntry[]): string {
  const lines: string[] = [
    `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>`,
    '<map>',
  ];
  for (const e of entries) {
    const name = encodeXml(e.name);
    switch (e.type) {
      case 'string':
        lines.push(`    <string name="${name}">${encodeXml(e.value)}</string>`);
        break;
      case 'set': {
        const items = e.value.length
          ? e.value.split(',').map(v => `        <string>${encodeXml(v)}</string>`)
          : [];
        lines.push(`    <set name="${name}">`);
        lines.push(...items);
        lines.push('    </set>');
        break;
      }
      case 'boolean':
        lines.push(`    <boolean name="${name}" value="${e.value === 'true' ? 'true' : 'false'}" />`);
        break;
      default:
        lines.push(`    <${e.type} name="${name}" value="${encodeXml(e.value)}" />`);
    }
  }
  lines.push('</map>');
  return lines.join('\n') + '\n';
}

// ─── Heuristic assistant ─────────────────────────────────────────────────────
const PATTERNS: {cat: Category; label: string; re: RegExp}[] = [
  {
    cat: 'currency',
    label: 'Currency',
    re: /coin|gold|gem|crystal|diamond|cash|money|buck|currency|credit|token|star(?!t)|shard|pearl|ruby|emerald|silver|coin/i,
  },
  {
    cat: 'progress',
    label: 'Progress',
    re: /level|wave|stage|chapter|progress|complete|unlock|kill|score|xp|exp(?!ir)|rank|tier|mission|achievement|win|victory|highest|best|rebirth|prestige/i,
  },
  {
    cat: 'consumable',
    label: 'Consumable',
    re: /booster|amount|potion|energy|life|lives|heart|ammo|ticket|spin|key(?!board)|hint|skip|revive|shield|powerup|item|inventory|count/i,
  },
  {
    cat: 'identity',
    label: 'Identity / system',
    re: /install|uuid|device|id$|_id|id_|guid|session|token|auth|timer|time|date|queststate|state|config|setting|version|first|last|review|rate|ad_|_ad|consent|privacy|unity|firebase|appsflyer|singular|adjust/i,
  },
];

function classify(name: string): Category {
  for (const p of PATTERNS) {
    if (p.re.test(name)) return p.cat;
  }
  return 'other';
}

const CAT_COLORS: Record<Category, string> = {
  currency:   '#ffd700',
  progress:   '#00ff88',
  consumable: '#5bc8ff',
  identity:   '#666',
  other:      '#444',
};

const TYPE_COLORS: Record<PrefType, string> = {
  int:     '#ff9f43',
  long:    '#ff9f43',
  float:   '#c56cf0',
  boolean: '#ff6b81',
  string:  '#5bc8ff',
  set:     '#888',
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function PlayerPrefsScreen({navigation, route}: any) {
  const packageName: string = route.params.packageName;
  // Generic mode: any XML prefs file path can be passed directly
  const prefsPath: string =
    route.params.path ??
    `/data/data/${packageName}/shared_prefs/${packageName}.v2.playerprefs.xml`;
  const appName: string =
    route.params.appName ?? route.params.title ?? packageName;

  const [entries, setEntries] = useState<PrefEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const xml = await rootBridge.readFile(prefsPath);
      if (xml.startsWith('[Binary')) throw new Error('Unexpected binary content');
      const parsed = parsePrefs(xml);
      if (parsed.length === 0) throw new Error('No entries parsed — file may be empty');
      setEntries(parsed);
    } catch (e: any) {
      setError(e?.message ?? 'Cannot read PlayerPrefs');
    }
    setLoading(false);
  }, [prefsPath]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    navigation.setOptions({title: appName});
  }, [navigation, appName]);

  const dirty = useMemo(() => entries.some(e => e.value !== e.original), [entries]);

  const updateValue = (name: string, value: string) => {
    setEntries(es => es.map(e => (e.name === name ? {...e, value} : e)));
  };

  const save = () => {
    // Validate numeric fields before writing
    for (const e of entries) {
      if ((e.type === 'int' || e.type === 'long') && !/^-?\d+$/.test(e.value.trim())) {
        Alert.alert('Invalid value', `"${e.name}" must be a whole number (${e.type}).`);
        return;
      }
      if (e.type === 'float' && isNaN(parseFloat(e.value))) {
        Alert.alert('Invalid value', `"${e.name}" must be a number (float).`);
        return;
      }
    }
    Alert.alert(
      'Save PlayerPrefs?',
      `This overwrites the save file for ${appName}. The game may need to be force-stopped and reopened to see changes.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Save',
          onPress: async () => {
            setSaving(true);
            try {
              const xml = serializePrefs(entries);
              await rootBridge.writeFile(prefsPath, xml);
              // Force-stop the game so it reloads prefs from disk
              rootBridge.execShell(`am force-stop ${packageName}`).catch(() => {});
              setEntries(es => es.map(e => ({...e, original: e.value})));
              Alert.alert('Saved', 'Game was force-stopped. Reopen it to see changes.');
            } catch (e: any) {
              Alert.alert('Write failed', e?.message ?? 'Unknown error');
            }
            setSaving(false);
          },
        },
      ],
    );
  };

  // ── Grouping ──────────────────────────────────────────────────────────────
  const {interesting, rest} = useMemo(() => {
    const q = search.toLowerCase().trim();
    const match = (e: PrefEntry) => !q || e.name.toLowerCase().includes(q);
    const interesting = entries.filter(e => {
      const c = classify(e.name);
      return (c === 'currency' || c === 'progress' || c === 'consumable') && match(e);
    });
    const rest = entries.filter(e => {
      const c = classify(e.name);
      return (c === 'identity' || c === 'other') && match(e);
    });
    return {interesting, rest};
  }, [entries, search]);

  const renderRow = ({item}: {item: PrefEntry}) => {
    const cat = classify(item.name);
    const changed = item.value !== item.original;
    const isBool = item.type === 'boolean';
    return (
      <View style={[s.row, changed && s.rowChanged]}>
        <View style={s.rowHead}>
          <View style={[s.catDot, {backgroundColor: CAT_COLORS[cat]}]} />
          <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
          <Text style={[s.typeBadge, {color: TYPE_COLORS[item.type], borderColor: TYPE_COLORS[item.type]}]}>
            {item.type}
          </Text>
        </View>
        {isBool ? (
          <View style={s.boolRow}>
            {(['true', 'false'] as const).map(v => (
              <TouchableOpacity
                key={v}
                style={[s.boolBtn, item.value === v && s.boolBtnActive]}
                onPress={() => updateValue(item.name, v)}>
                <Text style={[s.boolText, item.value === v && s.boolTextActive]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <TextInput
            style={[s.valueInput, changed && s.valueChanged]}
            value={item.value}
            onChangeText={t => updateValue(item.name, t)}
            keyboardType={
              item.type === 'int' || item.type === 'long'
                ? 'number-pad'
                : item.type === 'float'
                ? 'decimal-pad'
                : 'default'
            }
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            selectionColor="#00ff88"
            placeholder={item.type === 'set' ? 'comma,separated,values' : ''}
            placeholderTextColor="#333"
          />
        )}
      </View>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#00ff88" size="large" />
        <Text style={s.hint}>Reading PlayerPrefs via root...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.center}>
        <Text style={s.errText}>⚠ {error}</Text>
        <Text style={s.errPath}>{prefsPath}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={load}>
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.retryBtn, {marginTop: 8, borderColor: '#333'}]}
          onPress={() =>
            navigation.replace('FileBrowser', {
              path: prefsPath.substring(0, prefsPath.lastIndexOf('/')),
              title: packageName.split('.').pop(),
            })
          }>
          <Text style={[s.retryText, {color: '#5bc8ff'}]}>Open file browser instead</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Search */}
      <TextInput
        style={s.search}
        placeholder="Filter keys..."
        placeholderTextColor="#444"
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        autoCapitalize="none"
      />

      {/* Jump to Save Hunter */}
      <TouchableOpacity
        style={s.hunterLink}
        onPress={() =>
          navigation.navigate('SaveHunter', {packageName, appName})
        }>
        <Text style={s.hunterLinkText}>
          🔍 Progress not here? Hunt the real save file →
        </Text>
      </TouchableOpacity>

      <FlatList
        data={interesting}
        keyExtractor={item => item.name}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>★ Likely game values ({interesting.length})</Text>
            <Text style={s.sectionSub}>heuristic guess — verify in-game</Text>
          </View>
        }
        ListFooterComponent={
          <View>
            <TouchableOpacity style={s.sectionHead} onPress={() => setShowAll(v => !v)}>
              <Text style={[s.sectionTitle, {color: '#888'}]}>
                {showAll ? '▾' : '▸'} All other keys ({rest.length})
              </Text>
              <Text style={s.sectionSub}>identity, timers, config</Text>
            </TouchableOpacity>
            {showAll && rest.map(item => (
              <View key={item.name}>{renderRow({item})}</View>
            ))}
            <View style={{height: 90}} />
          </View>
        }
        ListEmptyComponent={
          <Text style={s.empty}>
            {search ? `No matches for "${search}"` : 'No game-like keys found'}
          </Text>
        }
        initialNumToRender={30}
        maxToRenderPerBatch={30}
        windowSize={10}
      />

      {/* Save bar */}
      <View style={s.saveBar}>
        <Text style={s.saveBarInfo}>
          {entries.filter(e => e.value !== e.original).length} changed
        </Text>
        <TouchableOpacity
          style={[s.saveBtn, (!dirty || saving) && s.saveBtnDisabled]}
          disabled={!dirty || saving}
          onPress={save}>
          <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0d0d0d'},
  center:    {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20},
  hint:      {color: '#333', fontFamily: 'monospace', fontSize: 12},
  errText:   {color: '#ff4444', fontFamily: 'monospace', fontSize: 13, textAlign: 'center'},
  errPath:   {color: '#333', fontFamily: 'monospace', fontSize: 10, textAlign: 'center'},
  retryBtn:  {paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#1a1a1a', borderRadius: 6, borderWidth: 1, borderColor: '#00ff88'},
  retryText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 13},
  empty:     {color: '#333', textAlign: 'center', marginTop: 40, fontFamily: 'monospace', fontSize: 12},

  search: {
    margin: 10,
    backgroundColor: '#111',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#00ff88',
    fontSize: 13,
    fontFamily: 'monospace',
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },

  hunterLink: {
    marginHorizontal: 10,
    marginBottom: 6,
    paddingVertical: 8,
    borderRadius: 7,
    backgroundColor: '#101a14',
    borderWidth: 1,
    borderColor: '#1e3a2a',
    alignItems: 'center',
  },
  hunterLinkText: {color: '#5bc8ff', fontFamily: 'monospace', fontSize: 11},

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  sectionTitle: {color: '#ffd700', fontFamily: 'monospace', fontSize: 12, fontWeight: 'bold'},
  sectionSub:   {color: '#333', fontFamily: 'monospace', fontSize: 10},

  row: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#131313',
  },
  rowChanged: {backgroundColor: '#0a140d'},
  rowHead: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5},
  catDot:  {width: 7, height: 7, borderRadius: 4},
  rowName: {flex: 1, color: '#ccc', fontFamily: 'monospace', fontSize: 12},
  typeBadge: {
    fontFamily: 'monospace',
    fontSize: 9,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },

  valueInput: {
    backgroundColor: '#111',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  valueChanged: {borderColor: '#00ff88'},

  boolRow: {flexDirection: 'row', gap: 8},
  boolBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    alignItems: 'center',
  },
  boolBtnActive: {backgroundColor: '#001a0d', borderColor: '#00ff88'},
  boolText:      {color: '#555', fontFamily: 'monospace', fontSize: 12},
  boolTextActive:{color: '#00ff88'},

  saveBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
  },
  saveBarInfo: {color: '#ff9900', fontFamily: 'monospace', fontSize: 12},
  saveBtn: {
    paddingHorizontal: 22,
    paddingVertical: 9,
    backgroundColor: '#0a2a15',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#00ff88',
  },
  saveBtnDisabled: {opacity: 0.35},
  saveBtnText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 13, fontWeight: 'bold'},
});
