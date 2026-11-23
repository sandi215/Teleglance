import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

import { fetchInbox, fetchMessages, fetchDigest, postStt, postDraft, postSend } from './api.js'
import type { Chat, ChatMessage, Digest } from './api.js'
import { eventTypeOf } from './events.js'
import {
  homeScreen,
  detailScreen,
  digestScreen,
  detailPages,
  digestPages,
  replyIdleScreen,
  replyRecordingScreen,
  replyWorkingScreen,
  replyMenuScreen,
  replySentScreen,
  replyErrorScreen,
  REPLY_MENU,
} from './ui.js'
import { PcmRecorder, toBase64 } from './audio.js'

// TeleGlance glasses app — Day 3: home / detail / digest screens.
// Day 4: voice reply with AI draft (reply screen).
// Navigation (tap / scroll / double-tap only — SDK 0.0.10 has no
// long-press event):
//   home   — scroll moves focus, tap opens detail, double-tap exits
//   detail — tap/scroll pages messages, last page tap opens reply,
//            double-tap back home
//   reply  — tap toggles record, stop transcribes + drafts, menu
//            Send/Rewrite/Cancel (scroll moves focus, tap chooses),
//            scroll down goes to digest, scroll up back to detail,
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
  | {
      kind: 'reply'
      chat: Chat
      returnPage: number
      phase: 'idle' | 'recording' | 'working' | 'menu' | 'sent' | 'error'
      transcript?: string
      draft?: string
      variant?: number
      menuFocus?: number
      demoSent?: boolean
      error?: string
    }
  | { kind: 'digest'; digest: Digest; page: number }

let chats: Chat[] = []
let focus = 0
let screen: Screen = { kind: 'home' }
// Inbox refresh timer (assigned at boot). MUST be cleared on exit —
// otherwise it keeps calling textContainerUpgrade on the destroyed
// container every 30s after shutDownPageContainer (spams
// "container 1 not found" warnings in the simulator log).
let refreshTimer: ReturnType<typeof setInterval> | undefined

const recorder = new PcmRecorder()
const audioControl = (on: boolean): unknown => bridge.audioControl(on)

function totalUnread(): number {
  return chats.reduce((s, c) => s + c.unread, 0)
}

function render(): void {
  let content: string
  if (screen.kind === 'home') {
    content = homeScreen(chats, focus, totalUnread())
  } else if (screen.kind === 'detail') {
    content = detailScreen(screen.chat, screen.messages, screen.page)
  } else if (screen.kind === 'reply') {
    if (screen.phase === 'idle') content = replyIdleScreen(screen.chat)
    else if (screen.phase === 'recording') content = replyRecordingScreen(screen.chat)
    else if (screen.phase === 'working') content = replyWorkingScreen(screen.chat)
    else if (screen.phase === 'menu') {
      content = replyMenuScreen(
        screen.chat,
        screen.transcript ?? '',
        screen.draft ?? '',
        screen.menuFocus ?? 0,
      )
    } else if (screen.phase === 'sent') {
      content = replySentScreen(screen.chat, screen.demoSent ?? false)
    } else {
      content = replyErrorScreen(screen.chat, screen.error ?? 'Unknown error')
    }
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

async function openDetail(chat: Chat, page = 0): Promise<void> {
  const messages = await fetchMessages(chat.id)
  screen = { kind: 'detail', chat, messages, page }
  render()
}

async function openDigest(chat: Chat): Promise<void> {
  const digest = await fetchDigest(chat.id)
  screen = { kind: 'digest', digest, page: 0 }
  render()
}

function openReply(chat: Chat, returnPage: number): void {
  stopRecording()
  screen = { kind: 'reply', chat, returnPage, phase: 'idle' }
  render()
}

function goHome(): void {
  stopRecording()
  screen = { kind: 'home' }
  render()
}

function stopRecording(): void {
  if (recorder.isActive) recorder.stop(audioControl)
}

/** Stop recording, transcribe, draft, show the menu. Runs after the
 * user taps to stop. Any failure lands on the reply error screen. */
async function finishRecording(): Promise<void> {
  if (screen.kind !== 'reply') return
  const chat = screen.chat
  const pcm = recorder.stop(audioControl)
  screen = { ...screen, phase: 'working' }
  render()
  try {
    const stt = await postStt(pcm.length > 0 ? toBase64(pcm) : '', chat.id)
    const draft = await postDraft(stt.transcript, 0)
    if (screen.kind !== 'reply') return // user navigated away meanwhile
    screen = {
      ...screen,
      phase: 'menu',
      transcript: stt.transcript,
      draft: draft.draft,
      variant: draft.variant,
      menuFocus: 0,
    }
    render()
  } catch (err) {
    if (screen.kind !== 'reply') return
    screen = { ...screen, phase: 'error', error: (err as Error).message }
    render()
  }
}

async function activateMenuItem(): Promise<void> {
  if (screen.kind !== 'reply' || screen.phase !== 'menu') return
  const item = REPLY_MENU[screen.menuFocus ?? 0]
  const chat = screen.chat
  if (item === 'Cancel') {
    await openDetail(chat, screen.returnPage)
    return
  }
  if (item === 'Rewrite') {
    const nextVariant = ((screen.variant ?? 0) + 1) % 3
    try {
      const draft = await postDraft(screen.transcript ?? '', nextVariant)
      if (screen.kind !== 'reply') return
      screen = { ...screen, draft: draft.draft, variant: draft.variant }
      render()
    } catch (err) {
      if (screen.kind !== 'reply') return
      screen = { ...screen, phase: 'error', error: (err as Error).message }
      render()
    }
    return
  }
  // Send
  try {
    const result = await postSend(chat.id, screen.draft ?? '')
    if (screen.kind !== 'reply') return
    screen = { ...screen, phase: 'sent', demoSent: result.demo }
    render()
  } catch (err) {
    if (screen.kind !== 'reply') return
    screen = { ...screen, phase: 'error', error: (err as Error).message }
    render()
  }
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
      openReply(screen.chat, screen.page)
    }
    return
  }
  if (screen.kind === 'reply') {
    if (screen.phase === 'idle') {
      recorder.start(audioControl)
      screen = { ...screen, phase: 'recording' }
      render()
    } else if (screen.phase === 'recording') {
      await finishRecording()
    } else if (screen.phase === 'menu') {
      await activateMenuItem()
    } else if (screen.phase === 'sent' || screen.phase === 'error') {
      goHome()
    }
    // 'working': taps ignored until STT/draft resolves.
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
  if (screen.kind === 'reply') {
    if (screen.phase === 'menu') {
      screen.menuFocus = ((screen.menuFocus ?? 0) + 1) % REPLY_MENU.length
      render()
      return
    }
    // idle/recording/working: scroll down goes to digest.
    void openDigest(screen.chat)
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
  if (screen.kind === 'reply') {
    if (screen.phase === 'menu') {
      screen.menuFocus =
        ((screen.menuFocus ?? 0) - 1 + REPLY_MENU.length) % REPLY_MENU.length
      render()
      return
    }
    // idle/recording/working: scroll up goes back to the detail page.
    void openDetail(screen.chat, screen.returnPage)
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
//   • Audio PCM frames come through `event.audioEvent` — a SEPARATE
//     branch, checked FIRST. Audio frames carry no sysEvent, so they
//     must never fall through to the tap handler (see the `asr`
//     template: the same mistake fires a tap on every audio frame).
//   • Double-tap → `shutDownPageContainer(1)` is a root-level check: it
//     must fire no matter which envelope the event arrives in, so users
//     can always exit the app from home.
//   • Check DOUBLE_CLICK_EVENT before CLICK_EVENT.
const unsubscribe = bridge.onEvenHubEvent(event => {
  const pcm = event.audioEvent?.audioPcm
  if (pcm) recorder.push(pcm)

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
    stopRecording()
    unsubscribe()
  }
})

// Boot: load the inbox, render home, then signal readiness.
chats = await fetchInbox()
render()
console.log('[teleglance] ready')

// Refresh the inbox every 30s while on home, so new Telegram messages
// (e.g. a real DM arriving after boot) appear without restarting the
// app. Detail/digest/reply screens are left alone mid-read.
refreshTimer = setInterval(() => {
  if (screen.kind !== 'home') return
  void fetchInbox().then(list => {
    chats = list
    if (focus >= Math.min(chats.length, 3)) focus = 0
    render()
  })
}, 30_000)
