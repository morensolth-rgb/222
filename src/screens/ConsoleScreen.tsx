import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import {rootBridge} from '../native/RootBridge';

export default function ConsoleScreen() {
  const [lines, setLines] = useState<{text: string; type: 'out' | 'err' | 'cmd'}[]>([]);
  const [cmd, setCmd] = useState('');
  const [polling, setPolling] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLine = (text: string, type: 'out' | 'err' | 'cmd') =>
    setLines(prev => [...prev.slice(-500), {text, type}]);

  const startLogcat = () => {
    if (polling) return;
    setPolling(true);
    addLine('[*] Starting logcat stream (frida)...', 'out');
    let lastLine = '';
    pollRef.current = setInterval(async () => {
      try {
        const out = await rootBridge.execShell(
          'logcat -d -t 20 -s Frida:* frida:* | tail -20'
        );
        if (out && out !== lastLine) {
          const newLines = out.split('\n').filter(l => l.trim());
          newLines.forEach(l => addLine(l, 'out'));
          lastLine = out;
          await rootBridge.execShell('logcat -c');
        }
      } catch (e) {}
    }, 1500);
  };

  const stopLogcat = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setPolling(false);
    addLine('[*] Logcat stopped', 'out');
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const runCmd = async () => {
    if (!cmd.trim()) return;
    const c = cmd.trim();
    setCmd('');
    addLine('$ ' + c, 'cmd');
    try {
      const out = await rootBridge.execShell(c);
      if (out) addLine(out, 'out');
    } catch (e: any) {
      addLine('Error: ' + e.message, 'err');
    }
  };

  return (
    <View style={s.container}>
      <View style={s.toolbar}>
        <TouchableOpacity
          style={[s.tbBtn, polling && s.tbBtnActive]}
          onPress={polling ? stopLogcat : startLogcat}>
          <Text style={s.tbText}>{polling ? '■ STOP' : '▶ LOGCAT'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.tbBtn}
          onPress={() => setLines([])}>
          <Text style={s.tbText}>CLEAR</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.output}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd()}>
        {lines.map((l, i) => (
          <Text
            key={i}
            style={[
              s.line,
              l.type === 'err' && s.lineErr,
              l.type === 'cmd' && s.lineCmd,
            ]}>
            {l.text}
          </Text>
        ))}
      </ScrollView>

      <View style={s.inputRow}>
        <Text style={s.prompt}>$ </Text>
        <TextInput
          style={s.input}
          value={cmd}
          onChangeText={setCmd}
          onSubmitEditing={runCmd}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          placeholder="shell command..."
          placeholderTextColor="#333"
        />
        <TouchableOpacity style={s.sendBtn} onPress={runCmd}>
          <Text style={s.sendText}>↵</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#080808'},
  toolbar: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    backgroundColor: '#0d0d0d',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  tbBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#111',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  tbBtnActive: {backgroundColor: '#1a0000', borderColor: '#ff4444'},
  tbText: {color: '#00ff88', fontFamily: 'monospace', fontSize: 12},
  output: {flex: 1, padding: 8},
  line: {color: '#00cc44', fontFamily: 'monospace', fontSize: 11, marginBottom: 1},
  lineErr: {color: '#ff6666'},
  lineCmd: {color: '#ffaa00'},
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    padding: 6,
  },
  prompt: {color: '#00ff88', fontFamily: 'monospace', fontSize: 14, paddingHorizontal: 4},
  input: {
    flex: 1,
    color: '#eee',
    fontFamily: 'monospace',
    fontSize: 13,
    padding: 4,
  },
  sendBtn: {
    padding: 6,
    backgroundColor: '#003d22',
    borderRadius: 4,
  },
  sendText: {color: '#00ff88', fontSize: 16, fontFamily: 'monospace'},
});
