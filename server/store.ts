// In-memory inbox store. Single process, no DB: the demo backend keeps
// chats + messages in memory; the poll loop (telegram.ts) feeds it and the
// demo seeder (demo-seed.ts) fills it with scripted messages in demo mode.

export interface ChatMessage {
  id: string
  chatId: string
  sender: string
  text: string
  ts: string
}

export type ChatKind = 'channel' | 'group' | 'dm'

export interface ChatSummary {
  id: string
  title: string
  kind: ChatKind
  unread: number
  preview: string
  updatedAt: string
}

export interface TelegramChat {
  id: number | string
  type?: string
  title?: string
  first_name?: string
  username?: string
}

export interface TelegramMessage {
  message_id: number
  date: number
  chat: TelegramChat
  from?: { first_name?: string; username?: string }
  text?: string
  caption?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  channel_post?: TelegramMessage
  edited_message?: TelegramMessage
  edited_channel_post?: TelegramMessage
}

const kindOf = (type?: string): ChatKind =>
  type === 'channel' ? 'channel' : type === 'private' ? 'dm' : 'group'

const titleOf = (chat: TelegramChat): string =>
  chat.title ?? chat.first_name ?? chat.username ?? `Chat ${chat.id}`

const senderOf = (msg: TelegramMessage): string =>
  msg.from?.first_name ?? msg.from?.username ?? 'Unknown'

export class InboxStore {
  private chats = new Map<string, ChatSummary>()
  private messages = new Map<string, ChatMessage[]>()

  addMessage(chatId: string, title: string, kind: ChatKind, msg: ChatMessage): void {
    const list = this.messages.get(chatId) ?? []
    if (list.some(m => m.id === msg.id)) return
    list.push(msg)
    this.messages.set(chatId, list)
    const prev = this.chats.get(chatId)
    this.chats.set(chatId, {
      id: chatId,
      title,
      kind,
      unread: (prev?.unread ?? 0) + 1,
      preview: msg.text.slice(0, 80),
      updatedAt: msg.ts,
    })
  }

  /** Feed one getUpdates update (message or channel_post) into the store. */
  addUpdate(update: TelegramUpdate): boolean {
    const msg = update.message ?? update.channel_post
    if (!msg || !(msg.text ?? msg.caption)) return false
    const chatId = String(msg.chat.id)
    const text = msg.text ?? msg.caption ?? ''
    this.addMessage(chatId, titleOf(msg.chat), kindOf(msg.chat.type), {
      id: `${chatId}:${msg.message_id}`,
      chatId,
      sender: senderOf(msg),
      text,
      ts: new Date(msg.date * 1000).toISOString(),
    })
    return true
  }

  getInbox(): ChatSummary[] {
    return [...this.chats.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )
  }

  getMessages(chatId: string): ChatMessage[] {
    return [...(this.messages.get(chatId) ?? [])].sort((a, b) =>
      b.ts.localeCompare(a.ts),
    )
  }

  hasChat(chatId: string): boolean {
    return this.chats.has(chatId)
  }

  getChat(chatId: string): ChatSummary | undefined {
    return this.chats.get(chatId)
  }
}
