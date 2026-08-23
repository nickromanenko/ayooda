import { createHash } from 'crypto'
import type { ReceivedEmail } from './client'

export interface ParsedInbound {
  fromAddress: string
  toAddress: string | null
  subject: string
  text: string
  messageId: string
  inReplyTo: string | null
}

/** "Acme <support@example.com>" → "support@example.com" (lowercased). */
export function bareAddress(v: string): string {
  const m = v.match(/<([^>]+)>/)
  return (m ? m[1]! : v).trim().toLowerCase()
}

/** "<abc123@example.com>" → "abc123@example.com". */
export function cleanMessageId(v: string): string {
  return v.trim().replace(/^<|>$/g, '')
}

function header(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseReceivedEmail(email: ReceivedEmail, webhookMessageId?: string): ParsedInbound {
  const fromAddress = bareAddress(email.from)
  const toAddress = email.to?.[0] ? bareAddress(email.to[0]) : null
  const subject = email.subject?.trim() || '(no subject)'
  const text = email.text?.trim() || (email.html ? stripHtml(email.html) : '')

  const messageId = cleanMessageId(
    webhookMessageId || email.message_id || header(email.headers, 'message-id') || '',
  )
  const inReplyToRaw = email.in_reply_to || header(email.headers, 'in-reply-to') || ''
  const inReplyTo = inReplyToRaw ? cleanMessageId(inReplyToRaw) : null

  return { fromAddress, toAddress, subject, text, messageId, inReplyTo }
}

/** A stable key for grouping a reply with its parent thread. */
export function emailThreadKey(inReplyTo: string | null, messageId: string): string {
  return inReplyTo || messageId || `unknown-${Date.now()}`
}

export function conversationIdForEmail(threadKey: string): string {
  return `email_${createHash('sha1').update(threadKey).digest('hex').slice(0, 24)}`
}

export function visitorIdForEmail(fromAddress: string): string {
  return `email_${fromAddress.toLowerCase()}`
}

export function replySubject(subject: string): string {
  return subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`
}
