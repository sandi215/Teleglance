// Screen builders for the 576x288 glasses display.
//
// Layout (single text container, ~10 lines at 27px):
//   line 1: header — app/screen name + counts (ALL CAPS for emphasis)
//   lines 2-9: body (max 8 lines)
//   line 10: footer hint
//
// NOTE: SDK 0.0.10 has no textColor on TextContainerProperty, so the
// DESIGN.md brightness hierarchy (header 4 / body 3 / preview 2 /
// footer 1) is expressed through layout instead: caps header, indented
// previews, footer hint on the last line.

import type { Chat, ChatMessage, Digest } from './api.js'

export const CHARS_PER_LINE = 46
export const BODY_LINES = 8

/** Word-wrap to max `width` chars per line; long words are hard-split. */
export function wrap(text: string, width = CHARS_PER_LINE): string[] {
  const lines: string[] = []
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let cur = ''
    for (const w of words) {
      if (cur === '') {
        cur = w.length > width ? w.slice(0, width) : w
        if (w.length > width) {
          let rest = w.slice(width)
          while (rest.length > 0) {
            lines.push(cur)
            cur = rest.slice(0, width)
            rest = rest.slice(width)
          }
        }
        continue
      }
      if (cur.length + 1 + w.length <= width) {
        cur += ` ${w}`
      } else {
        lines.push(cur)
        cur = w
      }
    }
    if (cur !== '') lines.push(cur)
  }
  return lines
}

export function paginate(lines: string[], perPage = BODY_LINES): string[][] {
  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage))
  }
  return pages.length > 0 ? pages : [[]]
}

/** Truncate to `width` chars at a word boundary, with an ellipsis. */
export function ellipsize(text: string, width = CHARS_PER_LINE): string {
  if (text.length <= width) return text
  const cut = text.slice(0, width - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const head = lastSpace > width / 2 ? cut.slice(0, lastSpace) : cut
  return `${head}…`
}

function frame(header: string, body: string[], footer: string): string {
  const lines = [header, ...body.slice(0, BODY_LINES)]
  while (lines.length < 1 + BODY_LINES) lines.push('')
  lines.push(footer)
  return lines.join('\n')
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Home: up to 3 chats, focused one marked with > (ASCII — the glasses
 * font has no ▸ glyph; it renders as a blank). */
export function homeScreen(chats: Chat[], focus: number, totalUnread: number): string {
  const shown = chats.slice(0, 3)
  const body: string[] = []
  shown.forEach((c, i) => {
    const mark = i === focus ? '>' : ' '
    body.push(ellipsize(`${mark} ${c.title} — ${c.unread} new`))
    body.push(`  ${ellipsize(c.preview, CHARS_PER_LINE - 2)}`)
  })
  return frame(
    `TELEGLANCE · ${totalUnread} NEW`,
    body,
    'Tap: open · 2x tap: exit',
  )
}

/** Flatten a chat's messages (newest first) into display lines. */
export function detailLines(messages: ChatMessage[]): string[] {
  const lines: string[] = []
  for (const m of messages) {
    lines.push(`${m.sender} ${fmtTime(m.ts)}`.slice(0, CHARS_PER_LINE))
    for (const w of wrap(m.text)) lines.push(`  ${w}`.slice(0, CHARS_PER_LINE))
  }
  return lines
}

export function detailPages(messages: ChatMessage[]): string[][] {
  return paginate(detailLines(messages))
}

export function digestPages(digest: Digest): string[][] {
  const lines: string[] = []
  for (const b of digest.bullets) {
    for (const w of wrap(`• ${b}`)) lines.push(w)
  }
  if (lines.length === 0) lines.push('(no messages yet)')
  return paginate(lines)
}

export function detailScreen(
  chat: Chat,
  messages: ChatMessage[],
  page: number,
): string {
  const pages = detailPages(messages)
  const p = Math.min(page, pages.length - 1)
  return frame(
    `${chat.title.toUpperCase()} (${p + 1}/${pages.length})`.slice(0, CHARS_PER_LINE),
    pages[p],
    'Tap: next · 2x tap: back',
  )
}

export function digestScreen(digest: Digest, page: number): string {
  const pages = digestPages(digest)
  const p = Math.min(page, pages.length - 1)
  return frame(
    `DIGEST · ${digest.chat.title.toUpperCase()} (${p + 1}/${pages.length})`.slice(
      0,
      CHARS_PER_LINE,
    ),
    pages[p],
    'Tap: next · 2x tap: home',
  )
}

export const REPLY_MENU = ['Send', 'Rewrite', 'Cancel'] as const

export function replyIdleScreen(chat: Chat): string {
  return frame(
    `REPLY · ${chat.title.toUpperCase()}`.slice(0, CHARS_PER_LINE),
    ['Tap to record your reply.', '', 'Speak, then tap again', 'to stop and transcribe.'],
    'Tap: record · Scroll: digest',
  )
}

export function replyRecordingScreen(chat: Chat): string {
  return frame(
    `LISTENING · ${chat.title.toUpperCase()}`.slice(0, CHARS_PER_LINE),
    ['Recording…', '', 'Tap again to stop', 'and transcribe.'],
    'Tap: stop · 2x tap: home',
  )
}

export function replyWorkingScreen(chat: Chat): string {
  return frame(
    `REPLY · ${chat.title.toUpperCase()}`.slice(0, CHARS_PER_LINE),
    ['Transcribing…', 'Drafting your reply…'],
    'Please wait…',
  )
}

/** Transcript + AI draft + Send/Rewrite/Cancel menu (scroll moves focus).
 * Body budget is 8 lines: transcript ≤2, draft ≤3, menu 3. */
export function replyMenuScreen(
  chat: Chat,
  transcript: string,
  draft: string,
  menuFocus: number,
): string {
  const body: string[] = []
  for (const w of wrap(`You: ${transcript}`).slice(0, 2)) body.push(w)
  for (const w of wrap(`Draft: ${draft}`).slice(0, 3)) body.push(w)
  REPLY_MENU.forEach((item, i) => {
    body.push(`${i === menuFocus ? '>' : ' '} ${item}`)
  })
  return frame(
    `REPLY · ${chat.title.toUpperCase()}`.slice(0, CHARS_PER_LINE),
    body,
    'Tap: choose · Scroll: move',
  )
}

export function replySentScreen(chat: Chat, demo: boolean): string {
  return frame(
    demo ? 'SENT (DEMO)' : 'SENT',
    demo
      ? [`Reply noted for ${chat.title}.`, '', 'Demo mode — not sent', 'to Telegram.']
      : [`Reply sent to ${chat.title}.`],
    'Tap: home',
  )
}

export function replyErrorScreen(chat: Chat, message: string): string {
  return frame(
    `REPLY · ${chat.title.toUpperCase()}`.slice(0, CHARS_PER_LINE),
    ['Something went wrong:', ...wrap(message).slice(0, 4)],
    'Tap: back to chat',
  )
}
