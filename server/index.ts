import express from 'express'

// TeleGlance backend.
// Serves the glasses app: inbox + digests + drafts + sends.
// Day 2: real Telegram long-polling (server/telegram.ts) feeds the inbox
// store; GET /api/digest serves an extractive summary per chat.
// The bot token is never in this repo — see server/telegram.ts.

import { InboxStore } from './store.js'
import { createTransport } from './telegram.js'
import { seedDemo } from './demo-seed.js'
import { extractiveDigest } from './summarize.js'
import { transcribePcm } from './stt.js'
import { makeDraft } from './draft.js'

const app = express()
// PCM audio arrives base64-encoded: a 10s reply is ~430 KB, a 60s one
// ~2.6 MB. The default 100 KB JSON limit would reject every recording.
app.use(express.json({ limit: '5mb' }))

// The glasses WebView is served from the Vite dev server origin, so the
// backend must allow cross-origin fetches from it.
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

const DEMO_MODE = process.env.DEMO_MODE !== '0'
const store = new InboxStore()
const transport = createTransport()

if (DEMO_MODE) {
  seedDemo(store)
  console.log('[teleglance-server] demo seed loaded')
}

// Poll state, exposed via /health for observability.
const pollState = { lastPollAt: null as string | null, updatesSeen: 0, errors: 0 }

async function pollLoop(): Promise<void> {
  let offset: number | undefined
  for (;;) {
    try {
      const updates = await transport.getUpdates(offset, 25)
      pollState.lastPollAt = new Date().toISOString()
      for (const update of updates) {
        if (store.addUpdate(update)) pollState.updatesSeen += 1
        offset = Math.max(offset ?? 0, update.update_id + 1)
      }
    } catch (err) {
      pollState.errors += 1
      console.error('[teleglance-server] poll error:', (err as Error).message)
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

// Fire-and-forget: the poll loop never blocks the HTTP server.
void pollLoop()

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'teleglance-server', demo: DEMO_MODE, poll: pollState })
})

app.get('/api/inbox', (_req, res) => {
  res.json({ chats: store.getInbox() })
})

app.get('/api/digest', (req, res) => {
  const chatId = String(req.query.chat ?? '')
  if (!chatId) {
    res.status(400).json({ error: 'missing ?chat=<id>' })
    return
  }
  const chat = store.getChat(chatId)
  if (!chat) {
    res.status(404).json({ error: `unknown chat ${chatId}` })
    return
  }
  const messages = store.getMessages(chatId)
  res.json({
    chat: { id: chat.id, title: chat.title, kind: chat.kind },
    bullets: extractiveDigest(messages, 3),
    count: messages.length,
  })
})

app.get('/api/messages', (req, res) => {
  const chatId = String(req.query.chat ?? '')
  if (!chatId) {
    res.status(400).json({ error: 'missing ?chat=<id>' })
    return
  }
  const chat = store.getChat(chatId)
  if (!chat) {
    res.status(404).json({ error: `unknown chat ${chatId}` })
    return
  }
  res.json({
    chat: { id: chat.id, title: chat.title, kind: chat.kind },
    messages: store.getMessages(chatId),
  })
})

// Voice reply path (Day 4): PCM (base64 s16le 16 kHz mono) -> transcript.
// { audio?: string (base64), demo?: true, chatId?: string }.
// demo:true (or empty audio with no STT endpoint) returns the scripted
// demo transcript — the headless simulator has no live mic.
app.post('/api/stt', async (req, res) => {
  try {
    const { audio, demo, chatId } = req.body as {
      audio?: string
      demo?: boolean
      chatId?: string
    }
    if (demo === true || !audio) {
      const { transcript } = await transcribePcm(Buffer.alloc(0), chatId)
      res.json({ transcript, demo: true })
      return
    }
    const pcm = Buffer.from(audio, 'base64')
    // 16 kHz s16le mono: 32,000 bytes/second. Reject > 60s of audio.
    if (pcm.length === 0 || pcm.length > 60 * 32_000) {
      res.status(400).json({ error: 'audio must be 1–60 seconds of PCM' })
      return
    }
    const { transcript, demo: isDemo } = await transcribePcm(pcm, chatId)
    res.json({ transcript, demo: isDemo })
  } catch (err) {
    res.status(502).json({ error: `transcription failed: ${(err as Error).message}` })
  }
})

// Transcript -> AI draft. { transcript, variant? } -> { draft, variant }.
app.post('/api/draft', (req, res) => {
  const { transcript, variant } = req.body as { transcript?: string; variant?: number }
  if (!transcript || typeof transcript !== 'string') {
    res.status(400).json({ error: 'missing transcript' })
    return
  }
  const v = Number.isInteger(variant) ? (variant as number) : 0
  const draft = makeDraft(transcript, v)
  if (!draft) {
    res.status(400).json({ error: 'transcript produced an empty draft' })
    return
  }
  res.json({ draft, variant: ((v % 3) + 3) % 3 })
})

// Send the approved draft via the bot. { chatId, text }.
// Real numeric Telegram chat ids send for real. Demo chat ids (demo-*)
// have no Telegram target: unless DEMO_TARGET_CHAT is set (a real group
// the bot is in — Day 6 setup), the send is a demo stub that reports
// demo:true so the glasses UI can say so honestly.
app.post('/api/send', async (req, res) => {
  const { chatId, text } = req.body as { chatId?: string; text?: string }
  if (!chatId || !text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'missing chatId or text' })
    return
  }
  const chat = store.getChat(chatId)
  if (!chat) {
    res.status(404).json({ error: `unknown chat ${chatId}` })
    return
  }
  try {
    if (/^-?\d+$/.test(chatId)) {
      const result = (await transport.sendMessage(chatId, text.trim())) as {
        message_id?: number
      }
      res.json({ ok: true, demo: false, messageId: result?.message_id ?? null })
      return
    }
    const target = process.env.DEMO_TARGET_CHAT
    if (target) {
      const result = (await transport.sendMessage(target, text.trim())) as {
        message_id?: number
      }
      res.json({ ok: true, demo: false, messageId: result?.message_id ?? null })
      return
    }
    console.log(`[teleglance-server] demo send (no DEMO_TARGET_CHAT): ${chatId}: ${text.trim()}`)
    res.json({ ok: true, demo: true, messageId: `demo-${Date.now()}` })
  } catch (err) {
    res.status(502).json({ error: `send failed: ${(err as Error).message}` })
  }
})

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`[teleglance-server] listening on http://localhost:${PORT}`)
})
