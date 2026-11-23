// Backend client for the glasses app. The backend runs on the same
// machine (localhost:3000) and is whitelisted in app.json. If the backend
// is unreachable, fall back to embedded demo data so the app still renders.

export interface Chat {
  id: string
  title: string
  kind: string
  unread: number
  preview: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  chatId: string
  sender: string
  text: string
  ts: string
}

export interface Digest {
  chat: { id: string; title: string; kind: string }
  bullets: string[]
  count: number
}

const BACKEND = 'http://localhost:3000'

async function getJson<T>(path: string, timeoutMs = 3000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BACKEND}${path}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BACKEND}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(err.error ?? `HTTP ${res.status}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

// Embedded fallback — mirrors the backend demo seed (server/demo-seed.ts).
const FALLBACK_CHATS: Chat[] = [
  {
    id: 'demo-crypto-news',
    title: 'Crypto News',
    kind: 'channel',
    unread: 5,
    preview: 'Analysts split on $100k BTC by year-end',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-build-night',
    title: 'Build Night',
    kind: 'group',
    unread: 2,
    preview: 'Raka: me! demo video is due tomorrow',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-teleglance',
    title: 'TeleGlance',
    kind: 'dm',
    unread: 1,
    preview: 'Bot: your digest is ready',
    updatedAt: new Date().toISOString(),
  },
]

const FALLBACK_MESSAGES: Record<string, ChatMessage[]> = {
  'demo-crypto-news': [
    { id: 'm1', chatId: 'demo-crypto-news', sender: 'Crypto News', text: 'Analysts split on $100k BTC by year-end as options open interest climbs', ts: new Date().toISOString() },
    { id: 'm2', chatId: 'demo-crypto-news', sender: 'Crypto News', text: 'Stablecoin bill passes committee 19-4, heads to full House vote next week', ts: new Date().toISOString() },
    { id: 'm3', chatId: 'demo-crypto-news', sender: 'Crypto News', text: 'Solana network stable after validator patch; TPS back above 3,000', ts: new Date().toISOString() },
    { id: 'm4', chatId: 'demo-crypto-news', sender: 'Crypto News', text: 'Ethereum Pectra upgrade goes live: staking withdrawals now take minutes, not days', ts: new Date().toISOString() },
    { id: 'm5', chatId: 'demo-crypto-news', sender: 'Crypto News', text: 'BTC breaks $98k as spot ETF inflows hit a record $1.2B in a single day', ts: new Date().toISOString() },
  ],
  'demo-build-night': [
    { id: 'm1', chatId: 'demo-build-night', sender: 'Raka', text: 'me! demo video is due tomorrow, need one more take', ts: new Date().toISOString() },
    { id: 'm2', chatId: 'demo-build-night', sender: 'Aisha', text: 'who is coming to the build night? bringing the spare G2', ts: new Date().toISOString() },
  ],
  'demo-teleglance': [
    { id: 'm1', chatId: 'demo-teleglance', sender: 'TeleGlance', text: 'Bot: your digest is ready — 3 new stories in Crypto News', ts: new Date().toISOString() },
  ],
}

export async function fetchInbox(): Promise<Chat[]> {
  try {
    const data = await getJson<{ chats: Chat[] }>('/api/inbox')
    return data.chats
  } catch {
    return FALLBACK_CHATS
  }
}

export async function fetchMessages(chatId: string): Promise<ChatMessage[]> {
  try {
    const data = await getJson<{ messages: ChatMessage[] }>(
      `/api/messages?chat=${encodeURIComponent(chatId)}`,
    )
    return data.messages
  } catch {
    return FALLBACK_MESSAGES[chatId] ?? []
  }
}

export async function fetchDigest(chatId: string): Promise<Digest> {
  try {
    return await getJson<Digest>(`/api/digest?chat=${encodeURIComponent(chatId)}`)
  } catch {
    const messages = FALLBACK_MESSAGES[chatId] ?? []
    const chat = FALLBACK_CHATS.find(c => c.id === chatId)
    return {
      chat: { id: chatId, title: chat?.title ?? chatId, kind: chat?.kind ?? 'dm' },
      bullets: messages.slice(0, 3).map(m => m.text),
      count: messages.length,
    }
  }
}

export interface SttResult {
  transcript: string
  demo: boolean
}

/** PCM (base64 s16le 16 kHz mono) -> transcript. Empty audio (or the
 * simulator's silent mic) asks for the scripted demo transcript. */
export async function postStt(audioBase64: string, chatId: string): Promise<SttResult> {
  if (!audioBase64) {
    return postJson<SttResult>('/api/stt', { demo: true, chatId })
  }
  return postJson<SttResult>('/api/stt', { audio: audioBase64, chatId })
}

export interface DraftResult {
  draft: string
  variant: number
}

export async function postDraft(transcript: string, variant: number): Promise<DraftResult> {
  return postJson<DraftResult>('/api/draft', { transcript, variant })
}

export interface SendResult {
  ok: boolean
  demo: boolean
  messageId: string | number | null
}

export async function postSend(chatId: string, text: string): Promise<SendResult> {
  return postJson<SendResult>('/api/send', { chatId, text })
}
