import { createHash, createHmac } from 'node:crypto'
import type { DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '../firebase-admin'
import { decryptSecret } from '../crypto'
import { assertSafeHttpsUrl } from '../tools/ssrf'
import { sendEmail } from '../email/client'
import { loadTicketingConfig } from './config'

const RETRY_MINUTES = [0, 1, 5, 30, 120, 720]
const LEASE_MS = 2 * 60_000

type DeliveryData = {
  eventId: string
  ticketId: string
  agentId: string
  event: 'ticket.created' | 'ticket.test'
  test?: boolean
  payload: Record<string, unknown>
  payloadSha256: string
  destinationType: 'webhook' | 'email'
  status: 'pending' | 'processing' | 'delivered' | 'failed'
  attemptCount: number
  nextAttemptAt: Date
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, '$1[redacted]').slice(0, 300)
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

export function signTicketWebhook(timestamp: number, body: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function ticketPayloadHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function emailTransport(workspaceId: string) {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/channels`).where('type', '==', 'email').get()
  const channel = snap.docs.find((doc) => doc.data().isActive !== false && doc.data().resendApiKeyEnc)
  if (!channel) throw new Error('Connect an active email channel before using ticket email delivery.')
  const data = channel.data()
  return {
    apiKey: decryptSecret(String(data.resendApiKeyEnc)),
    from: String(data.config?.fromAddress ?? data.config?.inboxAddress ?? ''),
  }
}

async function deliver(workspaceId: string, delivery: DeliveryData): Promise<{ status?: number; externalId?: string; externalUrl?: string }> {
  const config = await loadTicketingConfig(workspaceId, delivery.agentId)
  const body = JSON.stringify(delivery.payload)
  if (config.destination.type === 'webhook') {
    const url = await assertSafeHttpsUrl(config.destination.url)
    const timestamp = Math.floor(Date.now() / 1000)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(url, {
        method: 'POST', redirect: 'manual', signal: controller.signal, body,
        headers: {
          'Content-Type': 'application/json', 'User-Agent': 'Ayooda-Webhooks/1.0',
          'X-Ayooda-Event': delivery.event, 'X-Ayooda-Event-Id': delivery.eventId,
          'X-Ayooda-Timestamp': String(timestamp),
          'X-Ayooda-Signature': `v1=${signTicketWebhook(timestamp, body, decryptSecret(config.destination.signingSecretEnc))}`,
        },
      })
      if (!response.ok) throw Object.assign(new Error(`Webhook returned HTTP ${response.status}.`), { status: response.status })
      const text = await response.text()
      if (!text || text.length > 4096) return { status: response.status }
      try {
        const result = JSON.parse(text) as { externalId?: unknown; externalUrl?: unknown }
        const externalId = typeof result.externalId === 'string' ? result.externalId.slice(0, 200) : undefined
        let externalUrl: string | undefined
        if (typeof result.externalUrl === 'string' && result.externalUrl.length <= 2048) {
          const parsed = new URL(result.externalUrl)
          if (parsed.protocol === 'https:') externalUrl = parsed.toString()
        }
        return { status: response.status, externalId, externalUrl }
      } catch { return { status: response.status } }
    } finally { clearTimeout(timeout) }
  }
  if (config.destination.type === 'email') {
    const transport = await emailTransport(workspaceId)
    const ticket = (delivery.payload.data as { ticket?: Record<string, unknown> } | undefined)?.ticket ?? {}
    const customer = ticket.customer as Record<string, unknown> | undefined
    const fields = ticket.fields as Record<string, unknown> | undefined
    const conversation = ticket.conversation as Record<string, unknown> | undefined
    const transcript = Array.isArray(conversation?.messages) ? conversation.messages as Array<Record<string, unknown>> : []
    const lines = [
      `Ticket #${ticket.number}: ${ticket.subject}`, '', String(ticket.description ?? ''), '',
      `Priority: ${ticket.priority ?? 'normal'}`,
      customer?.email ? `Customer: ${customer.name || customer.email} <${customer.email}>` : customer?.name ? `Customer: ${customer.name}` : '',
      ...Object.entries(fields ?? {}).map(([key, value]) => `${key}: ${String(value)}`),
      ...(transcript.length ? ['', 'Conversation:', ...transcript.map((message) => `${String(message.role ?? 'message')}: ${String(message.content ?? '')}`)] : []), '',
      `Open in Ayooda: ${conversation?.dashboardUrl ?? ''}`,
    ].filter((line) => line !== '')
    const html = `<h2>Ticket #${escapeHtml(ticket.number)}: ${escapeHtml(ticket.subject)}</h2><p>${escapeHtml(ticket.description).replace(/\n/g, '<br>')}</p><p><strong>Priority:</strong> ${escapeHtml(ticket.priority ?? 'normal')}</p>${customer?.email ? `<p><strong>Customer:</strong> ${escapeHtml(customer.name || customer.email)} &lt;${escapeHtml(customer.email)}&gt;</p>` : customer?.name ? `<p><strong>Customer:</strong> ${escapeHtml(customer.name)}</p>` : ''}${Object.keys(fields ?? {}).length ? `<h3>Details</h3><ul>${Object.entries(fields ?? {}).map(([key, value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`).join('')}</ul>` : ''}${transcript.length ? `<h3>Conversation</h3>${transcript.map((message) => `<p><strong>${escapeHtml(message.role)}:</strong> ${escapeHtml(message.content).replace(/\n/g, '<br>')}</p>`).join('')}` : ''}<p><a href="${escapeHtml(conversation?.dashboardUrl)}">Open in Ayooda</a></p>`
    await sendEmail({ apiKey: transport.apiKey, from: transport.from, to: config.destination.address, subject: `[Ayooda #${ticket.number}] ${ticket.subject}`, text: lines.join('\n'), html })
    return {}
  }
  throw new Error('External ticket destination is no longer configured.')
}

export async function processTicketDelivery(ref: DocumentReference, now = new Date()): Promise<'delivered' | 'pending' | 'failed' | 'skipped'> {
  const claimed = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const data = snap.data() as DeliveryData & { leaseExpiresAt?: { toDate?: () => Date } }
    const lease = data.leaseExpiresAt?.toDate?.()
    if (data.status === 'delivered' || data.status === 'failed' || (data.status === 'processing' && lease && lease > now)) return null
    tx.update(ref, { status: 'processing', leaseExpiresAt: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now, updatedAt: now })
    return data
  })
  if (!claimed) return 'skipped'
  const workspaceId = ref.parent.parent?.id
  if (!workspaceId) throw new Error('Invalid ticket delivery path.')
  const attempt = claimed.attemptCount + 1
  try {
    const result = await deliver(workspaceId, claimed)
    await ref.update({ status: 'delivered', attemptCount: attempt, deliveredAt: now, responseStatus: result.status ?? null, safeError: null, leaseExpiresAt: null, updatedAt: now })
    if (!claimed.test) {
      await adminDb.doc(`workspaces/${workspaceId}/tickets/${claimed.ticketId}`).update({
        deliveryState: 'delivered', externalId: result.externalId ?? null, externalUrl: result.externalUrl ?? null, updatedAt: now,
      })
    }
    return 'delivered'
  } catch (error) {
    const status = Number((error as { status?: number }).status ?? 0)
    const retryable = !status || [408, 425, 429].includes(status) || status >= 500
    const exhausted = attempt >= RETRY_MINUTES.length
    const failed = !retryable || exhausted
    const next = failed ? null : new Date(now.getTime() + RETRY_MINUTES[attempt]! * 60_000)
    await ref.update({ status: failed ? 'failed' : 'pending', attemptCount: attempt, nextAttemptAt: next, responseStatus: status || null, safeError: safeError(error), leaseExpiresAt: null, updatedAt: now })
    if (!claimed.test) {
      await adminDb.doc(`workspaces/${workspaceId}/tickets/${claimed.ticketId}`).update({ deliveryState: failed ? 'failed' : 'pending', updatedAt: now })
    }
    return failed ? 'failed' : 'pending'
  }
}

export async function processDueTicketDeliveries(now = new Date(), limit = 50): Promise<{ delivered: number; pending: number; failed: number }> {
  const snap = await adminDb.collectionGroup('ticketDeliveries').where('nextAttemptAt', '<=', now).limit(limit).get()
  const result = { delivered: 0, pending: 0, failed: 0 }
  for (const doc of snap.docs) {
    if (!['pending', 'processing'].includes(String(doc.data().status))) continue
    const outcome = await processTicketDelivery(doc.ref, now).catch(() => 'failed' as const)
    if (outcome === 'delivered') result.delivered++
    else if (outcome === 'pending') result.pending++
    else if (outcome === 'failed') result.failed++
  }
  return result
}
