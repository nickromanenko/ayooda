export type ParsedUpdate =
  | { kind: 'text'; chatId: number; userId: number; text: string }
  | { kind: 'nontext'; chatId: number; userId: number }
  | { kind: 'ignore' }

interface TgMessage {
  chat?: { id?: number; type?: string }
  from?: { id?: number }
  text?: string
}

/** Parse a Telegram Update into a channel-agnostic shape. Only private `message` updates are actionable. */
export function parseUpdate(update: unknown): ParsedUpdate {
  const u = update as { message?: TgMessage } | null
  const msg = u?.message
  if (!msg) return { kind: 'ignore' } // edited_message / channel_post / callback_query / etc.

  if (msg.chat?.type !== undefined && msg.chat.type !== 'private') return { kind: 'ignore' } // DM-only

  const chatId = msg.chat?.id
  const userId = msg.from?.id
  if (typeof chatId !== 'number' || typeof userId !== 'number') return { kind: 'ignore' }

  const text = typeof msg.text === 'string' ? msg.text.trim() : ''
  if (text.length === 0) return { kind: 'nontext', chatId, userId }
  return { kind: 'text', chatId, userId, text }
}
