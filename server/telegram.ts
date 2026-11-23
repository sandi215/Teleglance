// Telegram transport for the TeleGlance backend.
//
// The bot token is NEVER in this repo. Two transports:
//   1. Direct (production): TELEGRAM_BOT_TOKEN env is set -> plain fetch
//      to api.telegram.org.
//   2. Helper (this dev VM): no env token -> shell out to the sanctioned
//      custom.telegram connector helper, which carries the registered
//      credential. The token never leaves the connector.
//
// getUpdates long polling: the poll loop in index.ts calls getUpdates with
// a 25s timeout and advances `offset` past each processed update_id.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { TelegramUpdate } from './store.js'

const execFileAsync = promisify(execFile)

export interface TelegramTransport {
  getUpdates(offset?: number, timeout?: number): Promise<TelegramUpdate[]>
  sendMessage(chatId: string | number, text: string): Promise<unknown>
}

const HELPER_PATH =
  process.env.TELEGRAM_HELPER ??
  join(homedir(), 'workspace', 'custom-connectors', 'custom.telegram', 'bin', 'telegram.py')

class DirectTransport implements TelegramTransport {
  constructor(private token: string) {}

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string }
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`)
    return data.result as T
  }

  getUpdates(offset?: number, timeout = 25): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout,
      limit: 100,
      allowed_updates: ['message', 'channel_post'],
    })
  }

  sendMessage(chatId: string | number, text: string): Promise<unknown> {
    return this.call('sendMessage', { chat_id: chatId, text })
  }
}

class HelperTransport implements TelegramTransport {
  private async run(args: string[]): Promise<Record<string, unknown>> {
    const { stdout } = await execFileAsync('python3', [HELPER_PATH, ...args], {
      timeout: 40_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    const data = JSON.parse(stdout) as { ok: boolean; result?: unknown; description?: string }
    if (!data.ok) throw new Error(`Telegram helper failed: ${data.description ?? 'unknown'}`)
    return data as Record<string, unknown>
  }

  async getUpdates(offset?: number, timeout = 25): Promise<TelegramUpdate[]> {
    const args = ['getupdates', '--limit', '100', '--timeout', String(timeout)]
    if (offset !== undefined) args.push('--offset', String(offset))
    const data = await this.run(args)
    return (data.result as TelegramUpdate[]) ?? []
  }

  async sendMessage(chatId: string | number, text: string): Promise<unknown> {
    const data = await this.run([
      'sendmessage',
      '--chat-id',
      String(chatId),
      '--text',
      text,
    ])
    return data.result
  }
}

export function createTransport(): TelegramTransport {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (token) return new DirectTransport(token)
  return new HelperTransport()
}
