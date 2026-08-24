import { createHash } from 'node:crypto'

const E164_RE = /^\+[1-9]\d{7,14}$/
const ACCOUNT_SID_RE = /^AC[a-f0-9]{32}$/i
const MESSAGE_SID_RE = /^SM[a-f0-9]{32}$/i

export function normalizePhoneNumber(value: string): string | null {
  const normalized = value.replace(/[\s().-]/g, '')
  return E164_RE.test(normalized) ? normalized : null
}

export function isTwilioAccountSid(value: string): boolean {
  return ACCOUNT_SID_RE.test(value)
}

export interface InboundSms {
  messageSid: string
  from: string
  to: string
  body: string
}

export function parseInboundSms(params: Record<string, string>): InboundSms | null {
  const from = normalizePhoneNumber(params.From ?? '')
  const to = normalizePhoneNumber(params.To ?? '')
  const body = (params.Body ?? '').trim()
  if (!MESSAGE_SID_RE.test(params.MessageSid ?? '') || !from || !to || !body) return null
  return { messageSid: params.MessageSid, from, to, body: body.slice(0, 10_000) }
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
}

export function smsConversationId(from: string, to: string): string {
  return stableId('sms', `${from}:${to}`)
}

export function smsVisitorId(from: string): string {
  return stableId('smsv', from)
}
