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

const app = express()
app.use(express.json())

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

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`[teleglance-server] listening on http://localhost:${PORT}`)
})
