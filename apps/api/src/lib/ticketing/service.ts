import { randomUUID } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { validateTicketSubmission, type TicketSubmission } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { loadTicketingConfig } from './config'
import { processTicketDelivery, ticketPayloadHash } from './delivery'

export interface CreateTicketInput {
  workspaceId: string
  agentId: string
  conversationId: string
  submission: unknown
  createdBy: 'agent' | 'operator'
}

export type TicketTranscriptMessage = { role: string; content: string; createdAt: string | null }

export function boundedTicketTranscript(messages: TicketTranscriptMessage[], maxBytes = 128 * 1024): TicketTranscriptMessage[] {
  const kept: TicketTranscriptMessage[] = []
  let bytes = 2
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    const addition = Buffer.byteLength(JSON.stringify(message), 'utf8') + (kept.length ? 1 : 0)
    if (bytes + addition > maxBytes) break
    kept.unshift(message)
    bytes += addition
  }
  return kept
}

export async function createSupportTicket(input: CreateTicketInput) {
  const config = await loadTicketingConfig(input.workspaceId, input.agentId)
  if (!config.enabled && input.createdBy === 'agent') throw new Error('Ticket intake is not enabled for this agent.')
  const parsed = validateTicketSubmission(input.submission, input.createdBy === 'operator' ? { ...config, requireConfirmation: false } : config)
  if (!parsed.ok) throw new Error(parsed.error)
  const submission: TicketSubmission = parsed.value
  const convRef = adminDb.doc(`workspaces/${input.workspaceId}/conversations/${input.conversationId}`)
  const ticketRef = adminDb.collection(`workspaces/${input.workspaceId}/tickets`).doc()
  const deliveryRef = adminDb.collection(`workspaces/${input.workspaceId}/ticketDeliveries`).doc()
  const counterRef = adminDb.doc(`workspaces/${input.workspaceId}/counters/tickets`)
  const [conversation, agent, messages] = await Promise.all([
    convRef.get(),
    adminDb.doc(`workspaces/${input.workspaceId}/agents/${input.agentId}`).get(),
    convRef.collection('messages').orderBy('createdAt', 'desc').limit(100).get(),
  ])
  if (!conversation.exists || conversation.data()?.agentId !== input.agentId) throw new Error('Conversation not found.')
  const conversationData = conversation.data()!
  const transcript = boundedTicketTranscript(messages.docs.reverse().map((doc) => {
    const data = doc.data()
    const createdAt = data.createdAt?.toDate?.()
    return { role: String(data.role ?? 'user'), content: String(data.content ?? '').slice(0, 4000), createdAt: createdAt instanceof Date ? createdAt.toISOString() : null }
  }))
  const now = new Date()
  const external = config.destination.type !== 'internal'
  const result = await adminDb.runTransaction(async (tx) => {
    const [freshConversation, counter] = await Promise.all([tx.get(convRef), tx.get(counterRef)])
    const existingId = freshConversation.data()?.ticketId
    if (typeof existingId === 'string' && existingId) return { created: false, ticketId: existingId, ticketNumber: Number(freshConversation.data()?.ticketNumber ?? 0), deliveryRef: null }
    const number = Math.max(1, Number(counter.data()?.nextNumber ?? 1))
    const customer = {
      name: typeof conversationData.customerName === 'string' ? conversationData.customerName : null,
      email: typeof conversationData.emailReplyTo === 'string' ? conversationData.emailReplyTo : typeof conversationData.customerEmail === 'string' ? conversationData.customerEmail : null,
      phone: typeof conversationData.smsFrom === 'string' ? conversationData.smsFrom : typeof conversationData.customerPhone === 'string' ? conversationData.customerPhone : null,
      visitorId: typeof conversationData.visitorId === 'string' ? conversationData.visitorId : null,
    }
    const dashboardBase = (process.env.WEB_PUBLIC_URL ?? 'https://app.ayooda.live').replace(/\/$/, '')
    const payload = {
      id: `evt_${randomUUID()}`, type: 'ticket.created', createdAt: now.toISOString(),
      data: { ticket: {
        id: ticketRef.id, number, status: 'open', priority: submission.priority, subject: submission.subject,
        description: submission.description, fields: submission.fields, customer,
        agent: { id: input.agentId, name: String(agent.data()?.name ?? 'Support agent') },
        conversation: {
          id: input.conversationId, channel: conversationData.channelType ?? null,
          dashboardUrl: `${dashboardBase}/dashboard/inbox?conversation=${encodeURIComponent(input.conversationId)}`,
          messages: transcript,
        },
      } },
    }
    const ticket = {
      number, agentId: input.agentId, conversationId: input.conversationId,
      channelId: conversationData.channelId ?? null, channelType: conversationData.channelType ?? null,
      status: 'open', priority: submission.priority, subject: submission.subject, description: submission.description,
      fields: submission.fields, customer, assigneeUid: conversationData.operatorId ?? null,
      transcriptMessageCount: messages.size, deliveryState: external ? 'pending' : 'not_configured',
      externalId: null, externalUrl: null, createdBy: input.createdBy, createdAt: now, updatedAt: now,
    }
    tx.set(counterRef, { nextNumber: number + 1, updatedAt: now }, { merge: true })
    tx.set(ticketRef, ticket)
    tx.update(convRef, {
      ticketId: ticketRef.id, ticketNumber: number,
      ...(config.afterSubmission === 'handoff' ? { status: 'waiting', operatorId: null, escalationReason: 'Support ticket created' } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (external) tx.set(deliveryRef, {
      eventId: payload.id, ticketId: ticketRef.id, agentId: input.agentId, event: 'ticket.created', payload,
      payloadSha256: ticketPayloadHash(payload), destinationType: config.destination.type,
      status: 'pending', attemptCount: 0, nextAttemptAt: now, createdAt: now, updatedAt: now,
    })
    return { created: true, ticketId: ticketRef.id, ticketNumber: number, deliveryRef: external ? deliveryRef : null }
  })
  if (result.deliveryRef) void processTicketDelivery(result.deliveryRef).catch((error) => console.warn('[tickets] initial delivery failed:', error))
  return { ...result, status: 'open' as const, deliveryState: external ? 'pending' as const : 'not_configured' as const, acknowledgementMessage: config.acknowledgementMessage.replaceAll('{number}', String(result.ticketNumber)) }
}
