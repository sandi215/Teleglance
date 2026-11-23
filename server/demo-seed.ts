// Scripted demo messages (crypto channel digest scenario). Used when
// DEMO_MODE=1 so the glasses UI and the demo video have deterministic
// content even before the bot receives real messages. Chat ids are
// prefixed "demo-" so they never collide with real Telegram chat ids.

import type { InboxStore } from './store.js'

interface SeedMessage {
  chatId: string
  title: string
  kind: 'channel' | 'group' | 'dm'
  sender: string
  text: string
  minutesAgo: number
}

const SEED: SeedMessage[] = [
  // Crypto News channel — the digest scenario.
  {
    chatId: 'demo-crypto-news',
    title: 'Crypto News',
    kind: 'channel',
    sender: 'Crypto News',
    text: 'BTC breaks $98k as spot ETF inflows hit a record $1.2B in a single day',
    minutesAgo: 42,
  },
  {
    chatId: 'demo-crypto-news',
    title: 'Crypto News',
    kind: 'channel',
    sender: 'Crypto News',
    text: 'Ethereum Pectra upgrade goes live: staking withdrawals now take minutes, not days',
    minutesAgo: 31,
  },
  {
    chatId: 'demo-crypto-news',
    title: 'Crypto News',
    kind: 'channel',
    sender: 'Crypto News',
    text: 'Solana network stable after validator patch; TPS back above 3,000',
    minutesAgo: 18,
  },
  {
    chatId: 'demo-crypto-news',
    title: 'Crypto News',
    kind: 'channel',
    sender: 'Crypto News',
    text: 'Stablecoin bill passes committee 19-4, heads to full House vote next week',
    minutesAgo: 9,
  },
  {
    chatId: 'demo-crypto-news',
    title: 'Crypto News',
    kind: 'channel',
    sender: 'Crypto News',
    text: 'Analysts split on $100k BTC by year-end as options open interest climbs',
    minutesAgo: 4,
  },
  // Build Night group.
  {
    chatId: 'demo-build-night',
    title: 'Build Night',
    kind: 'group',
    sender: 'Aisha',
    text: 'who is coming to the build night? bringing the spare G2',
    minutesAgo: 25,
  },
  {
    chatId: 'demo-build-night',
    title: 'Build Night',
    kind: 'group',
    sender: 'Raka',
    text: 'me! demo video is due tomorrow, need one more take',
    minutesAgo: 12,
  },
  // TeleGlance DM.
  {
    chatId: 'demo-teleglance',
    title: 'TeleGlance',
    kind: 'dm',
    sender: 'TeleGlance',
    text: 'Bot: your digest is ready — 3 new stories in Crypto News',
    minutesAgo: 6,
  },
]

export function seedDemo(store: InboxStore): void {
  const now = Date.now()
  for (const [i, s] of SEED.entries()) {
    store.addMessage(s.chatId, s.title, s.kind, {
      id: `${s.chatId}:seed-${i}`,
      chatId: s.chatId,
      sender: s.sender,
      text: s.text,
      ts: new Date(now - s.minutesAgo * 60_000).toISOString(),
    })
  }
}
