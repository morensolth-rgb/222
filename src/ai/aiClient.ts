import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── AI client (OpenAI-compatible chat completions) ─────────────────────────
// Key + optional custom base URL are stored on-device only.

const KEY_STORE = 'ai:apikey:v1';
const BASE_STORE = 'ai:baseurl:v1';
const DEFAULT_BASE = 'https://api.openai.com';
const DEFAULT_MODEL = 'gpt-4o-mini';

export async function getApiKey(): Promise<string> {
  return (await AsyncStorage.getItem(KEY_STORE)) ?? '';
}

export async function setApiKey(key: string): Promise<void> {
  await AsyncStorage.setItem(KEY_STORE, key.trim());
}

export async function getBaseUrl(): Promise<string> {
  return (await AsyncStorage.getItem(BASE_STORE)) ?? DEFAULT_BASE;
}

export async function setBaseUrl(url: string): Promise<void> {
  const u = url.trim().replace(/\/+$/, '');
  await AsyncStorage.setItem(BASE_STORE, u || DEFAULT_BASE);
}

const MAX_CONTENT = 12000; // chars sent to the model

const SYSTEM_PROMPT = `You are a reverse-engineering assistant inside a root save-editor app for Android games.
The user gives you the content of a save/config file from a game's private data folder.
Your job:
1. Identify which fields/keys/values represent player progress: coins, gems, gold, cash, level, XP, lives, energy, unlocked items, high score, etc.
2. For each, give: the exact key name or byte pattern, its current value, and what it likely means.
3. Suggest safe edits (e.g. "set coins to 999999") and warn about values that look checksummed/hashed/encrypted.
4. If the file looks encrypted, obfuscated, or is a binary blob you cannot interpret, say so clearly and suggest what to try instead.
Be concise. Use a short bullet list per finding. Plain text only, no markdown headers.`;

export async function analyzeSave(opts: {
  path: string;
  appName: string;
  content: string;
}): Promise<string> {
  const key = await getApiKey();
  if (!key) throw new Error('NO_KEY');

  const base = await getBaseUrl();
  const truncated =
    opts.content.length > MAX_CONTENT
      ? opts.content.slice(0, MAX_CONTENT) +
        `\n...[truncated, file is ${opts.content.length} chars total]`
      : opts.content;

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.2,
      messages: [
        {role: 'system', content: SYSTEM_PROMPT},
        {
          role: 'user',
          content: `Game: ${opts.appName}\nFile: ${opts.path}\n\n--- FILE CONTENT ---\n${truncated}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('BAD_KEY');
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const text: string | undefined = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from AI');
  return text.trim();
}
