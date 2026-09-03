export interface InboxConversationSearchFields {
  visitorId?: unknown
  lastMessage?: unknown
  summary?: unknown
  emailReplyTo?: unknown
  emailSubject?: unknown
  smsFrom?: unknown
  slackUserId?: unknown
  telegramChatId?: unknown
  customerName?: unknown
  customerEmail?: unknown
  customerExternalId?: unknown
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export function matchesInboxSearch(row: InboxConversationSearchFields, rawQuery: string): boolean {
  const terms = rawQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = [
    row.visitorId,
    row.lastMessage,
    row.summary,
    row.emailReplyTo,
    row.emailSubject,
    row.smsFrom,
    row.slackUserId,
    row.telegramChatId,
    row.customerName,
    row.customerEmail,
    row.customerExternalId,
  ].map((value) => String(value ?? '').toLocaleLowerCase()).join('\n')
  return terms.every((term) => haystack.includes(term))
}

export function inboxCustomerIdentity(row: InboxConversationSearchFields): {
  label: string
  email: string | null
  phone: string | null
  externalId: string
} {
  const visitorId = text(row.visitorId) || 'Unknown visitor'
  const email = text(row.customerEmail) || text(row.emailReplyTo) || (visitorId.startsWith('email_') ? visitorId.slice(6) : '')
  const phone = text(row.smsFrom) || (visitorId.startsWith('sms_') ? visitorId.slice(4) : '')
  const slackUser = text(row.slackUserId)
  const telegramChat = text(row.telegramChatId)
  const name = text(row.customerName)
  const externalId = text(row.customerExternalId) || visitorId
  const label = name || email || phone || (slackUser ? `Slack ${slackUser}` : '') || (telegramChat ? `Telegram ${telegramChat}` : '') || externalId
  return { label, email: email || null, phone: phone || null, externalId }
}
