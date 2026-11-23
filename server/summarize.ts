// Extractive digest: no LLM key needed. Scores each message by how often
// its content words recur across the chat, picks the top distinct messages
// (max 3), and returns them as bullets. Deterministic, works offline.
// An LLM path (Xingchi) can replace this when a verified key exists; the
// endpoint shape stays the same.

import type { ChatMessage } from './store.js'

const STOPWORDS = new Set(
  'a an the and or but of to in on for with at by from as is are was were be been it its this that these those i you he she we they my your his her our their not no yes if so do does did will would can could should have has had what when where who why how all any more most other some such than then there here about into over under out up down'.split(
    ' ',
  ),
)

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w))
}

function scoreMessages(messages: ChatMessage[]): Map<string, number> {
  const freq = new Map<string, number>()
  const perMessage = messages.map(m => {
    const ws = words(m.text)
    for (const w of new Set(ws)) freq.set(w, (freq.get(w) ?? 0) + 1)
    return ws
  })
  const scores = new Map<string, number>()
  messages.forEach((m, i) => {
    let s = 0
    for (const w of new Set(perMessage[i])) s += freq.get(w) ?? 0
    // Prefer messages with substance over one-word pings.
    s += Math.min(perMessage[i].length, 20) * 0.1
    scores.set(m.id, s)
  })
  return scores
}

function bullet(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 140 ? `${oneLine.slice(0, 137)}...` : oneLine
}

/** Top `maxBullets` messages, newest-first among the top scorers. */
export function extractiveDigest(
  messages: ChatMessage[],
  maxBullets = 3,
): string[] {
  if (messages.length === 0) return []
  const scores = scoreMessages(messages)
  const ranked = [...messages].sort(
    (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0),
  )
  const picked = ranked.slice(0, maxBullets)
  picked.sort((a, b) => b.ts.localeCompare(a.ts))
  return picked.map(m => bullet(m.text))
}
