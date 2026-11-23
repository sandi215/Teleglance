import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

import { fetchInbox, fetchMessages, fetchDigest } from './api.js'
import type { Chat, ChatMessage, Digest } from './api.js'
import { eventTypeOf } from './events.js'
import { homeScreen, detailScreen, digestScreen, detailPages, digestPages } from './ui.js'

// TeleGlance glasses app — Day 3: home / detail / digest screens.
// Navigation (tap / scroll / double-tap only — SDK 0.0.10 has no
// long-press event):
//   home   — scroll moves focus, tap opens detail, double-tap exits
//   detail — tap/scroll pages messages, last page tap opens digest,
//            double-tap back home
//   digest — tap/scroll pages bullets, last page tap goes home,
//            double-tap back home

const bridge = await waitForEvenAppBridge()

const mainText = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: 'TeleGlance\nLoading inbox...',
  isEventCapture: 1,
})

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [mainText],
  }),
)

console.log('Page created:', result === 0 ? 'success' : `failed (${result})`)

type Screen =
  | { kind: 'home' }
  | { kind: 'detail'; chat: Chat; messages: ChatMessage[]; page: number }
  | { kind: 'digest'; digest: Digest; page: number }

let chats: Chat[] = []
let focus = 0
let screen: Screen = { kind: 'home' }
// Inbox refresh timer (assigned at boot). MUST be cleared on exit —
// otherwise it keeps calling textContainerUpgrade on the destroyed
// container every 30s after shutDownPageContainer (spams
// "container 1 not found" warnings in the simulator log).
let refreshTimer: ReturnType<typeof setInterval> | undefined

function totalUnread(): number {
  return chats.reduce((s, c) => s + c.unread, 0)
}

function render(): void {
  let content: string
  if (screen.kind === 'home') {
    content = homeScreen(chats, focus, totalUnread())
  } else if (screen.kind === 'detail') {
    content = detailScreen(screen.chat, screen.messages, screen.page)
  } else {
    content = digestScreen(screen.digest, screen.page)
  }
  void bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 1,
      containerName: 'main',
      content,
    }),
  )
}

function detailPageCount(messages: ChatMessage[]): number {
  return detailPages(messages).length
}

function digestPageCount(digest: Digest): number {
  return digestPages(digest).length
}

async function openDetail(chat: Chat): Promise<void> {
  const messages = await fetchMessages(chat.id)
  screen = { kind: 'detail', chat, messages, page: 0 }
  render()
}

async function openDigest(chat: Chat): Promise<void> {
  const digest = await fetchDigest(chat.id)
  screen = { kind: 'digest', digest, page: 0 }
  render()
}

function goHome(): void {
  screen = { kind: 'home' }
  render()
}

async function onTap(): Promise<void> {
  if (screen.kind === 'home') {
    const chat = chats.slice(0, 3)[focus]
    if (chat) await openDetail(chat)
    return
  }
  if (screen.kind === 'detail') {
    if (screen.page + 1 < detailPageCount(screen.messages)) {
      screen.page += 1
      render()
    } else {
      await openDigest(screen.chat)
    }
    return
  }
  // digest
  if (screen.page + 1 < digestPageCount(screen.digest)) {
    screen.page += 1
    render()
  } else {
    goHome()
  }
}

function onScrollDown(): void {
  if (screen.kind === 'home') {
    const n = Math.min(chats.length, 3)
    focus = (focus + 1) % Math.max(n, 1)
    render()
    return
  }
  void onTap()
}

function onScrollUp(): void {
  if (screen.kind === 'home') {
    const n = Math.min(chats.length, 3)
    focus = (focus - 1 + Math.max(n, 1)) % Math.max(n, 1)
    render()
    return
  }
  if (screen.kind === 'detail' && screen.page > 0) {
    screen.page -= 1
    render()
  } else if (screen.kind === 'digest' && screen.page > 0) {
    screen.page -= 1
    render()
  }
}

// Event routing, critical details:
//   • Taps/double-taps/lifecycle come through `event.sysEvent`.
//     Scroll gestures come through `event.textEvent`. Never mix them.
//   • Double-tap → `shutDownPageContainer(1)` is a root-level check: it
//     must fire no matter which envelope the event arrives in, so users
//     can always exit the app from home.
//   • Check DOUBLE_CLICK_EVENT before CLICK_EVENT.
const unsubscribe = bridge.onEvenHubEvent(event => {
  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)
  const listType = eventTypeOf(event.listEvent)

  if (
    sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    textType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    listType === OsEventTypeList.DOUBLE_CLICK_EVENT
  ) {
    if (screen.kind === 'home') {
      clearInterval(refreshTimer)
      bridge.shutDownPageContainer(1)
    } else {
      goHome()
    }
    return
  }

  if (
    sysType === OsEventTypeList.CLICK_EVENT ||
    textType === OsEventTypeList.CLICK_EVENT ||
    listType === OsEventTypeList.CLICK_EVENT
  ) {
    void onTap()
    return
  }

  if (
    textType === OsEventTypeList.SCROLL_BOTTOM_EVENT ||
    sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT
  ) {
    onScrollDown()
    return
  }

  if (
    textType === OsEventTypeList.SCROLL_TOP_EVENT ||
    sysType === OsEventTypeList.SCROLL_TOP_EVENT
  ) {
    onScrollUp()
    return
  }

  if (
    sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  ) {
    clearInterval(refreshTimer)
    unsubscribe()
  }
})

// Boot: load the inbox, render home, then signal readiness.
chats = await fetchInbox()
render()
console.log('[teleglance] ready')

// Refresh the inbox every 30s while on home, so new Telegram messages
// (e.g. a real DM arriving after boot) appear without restarting the
// app. Detail/digest screens are left alone mid-read.
refreshTimer = setInterval(() => {
  if (screen.kind !== 'home') return
  void fetchInbox().then(list => {
    chats = list
    if (focus >= Math.min(chats.length, 3)) focus = 0
    render()
  })
}, 30_000)
