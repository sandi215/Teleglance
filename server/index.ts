import express from 'express'

// TeleGlance backend — Day 1 skeleton.
// Serves the glasses app: inbox + digests + drafts + sends.
// Day 1: /api/inbox returns scripted demo data only. Real Telegram
// long-polling lands on Day 2 (server/telegram.ts).

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

export interface InboxChat {
  id: string
  title: string
  kind: 'channel' | 'group' | 'dm'
  unread: number
  preview: string
  updatedAt: string
}

// Scripted demo inbox (Day 1). The Day 2 seeder replaces this with
// messages pulled from the demo bot via getUpdates.
const DEMO_INBOX: InboxChat[] = [
  {
    id: 'demo-crypto-news',
    title: 'Crypto News',
    kind: 'channel',
    unread: 2,
    preview: 'BTC breaks $98k as ETF inflows hit record',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-build-night',
    title: 'Build Night',
    kind: 'group',
    unread: 1,
    preview: 'Aisha: who is coming to the build night?',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-teleglance',
    title: 'TeleGlance',
    kind: 'dm',
    unread: 0,
    preview: 'Bot: your digest is ready',
    updatedAt: new Date().toISOString(),
  },
]

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'teleglance-server', demo: true })
})

app.get('/api/inbox', (_req, res) => {
  res.json({ chats: DEMO_INBOX })
})

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`[teleglance-server] listening on http://localhost:${PORT}`)
})
