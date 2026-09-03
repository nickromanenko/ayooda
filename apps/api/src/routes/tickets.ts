import { Hono } from 'hono'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { processTicketDelivery } from '../lib/ticketing/delivery'
import { loadTicketingConfig } from '../lib/ticketing/config'

const tickets = new Hono<{ Variables: AuthVariables }>()
tickets.use('*', requireAuth)

/** Safe intake schema for Inbox operators; destination details remain owner-only. */
tickets.get('/intake/:agentId', async (c) => {
  const agentId = c.req.param('agentId')
  const agent = await adminDb.doc(`workspaces/${c.get('workspaceId')}/agents/${agentId}`).get()
  if (!agent.exists) return c.json({ error: 'Agent not found.' }, 404)
  const config = await loadTicketingConfig(c.get('workspaceId'), agentId)
  return c.json({ enabled: config.enabled, fields: config.fields })
})

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return (value.toDate() as Date).toISOString()
  return null
}

function safeTicket(id: string, data: Record<string, unknown>): Record<string, unknown> & { id: string } {
  return { ...data, id, createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt), resolvedAt: iso(data.resolvedAt) }
}

tickets.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const search = c.req.query('search')?.trim().toLowerCase() ?? ''
  const status = c.req.query('status')
  const priority = c.req.query('priority')
  const agentId = c.req.query('agentId')
  const assignee = c.req.query('assignee')
  const deliveryState = c.req.query('deliveryState')
  const snap = await adminDb.collection(`workspaces/${workspaceId}/tickets`).orderBy('updatedAt', 'desc').limit(search ? 250 : 50).get()
  const rows = snap.docs.map((doc) => safeTicket(doc.id, doc.data())).filter((ticket) => {
    if (status && ticket.status !== status) return false
    if (priority && ticket.priority !== priority) return false
    if (agentId && ticket.agentId !== agentId) return false
    if (assignee && ticket.assigneeUid !== assignee) return false
    if (deliveryState && ticket.deliveryState !== deliveryState) return false
    if (!search) return true
    const customer = ticket.customer as { name?: string; email?: string } | undefined
    return `${ticket.number} ${ticket.subject} ${ticket.description} ${customer?.name ?? ''} ${customer?.email ?? ''} ${ticket.externalId ?? ''} ${JSON.stringify(ticket.fields ?? {})}`.toLowerCase().includes(search)
  }).slice(0, 50)
  return c.json({ tickets: rows })
})

tickets.get('/:id', async (c) => {
  const snap = await adminDb.doc(`workspaces/${c.get('workspaceId')}/tickets/${c.req.param('id')}`).get()
  if (!snap.exists) return c.json({ error: 'Ticket not found.' }, 404)
  return c.json(safeTicket(snap.id, snap.data()!))
})

tickets.patch('/:id', async (c) => {
  const ref = adminDb.doc(`workspaces/${c.get('workspaceId')}/tickets/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Ticket not found.' }, 404)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  if (body.status !== undefined) {
    if (!['open', 'in_progress', 'resolved', 'closed'].includes(String(body.status))) return c.json({ error: 'Invalid ticket status.' }, 400)
    update.status = body.status
    update.resolvedAt = body.status === 'resolved' || body.status === 'closed' ? FieldValue.serverTimestamp() : FieldValue.delete()
  }
  if (body.priority !== undefined) {
    if (!['low', 'normal', 'high', 'urgent'].includes(String(body.priority))) return c.json({ error: 'Invalid ticket priority.' }, 400)
    update.priority = body.priority
  }
  if (body.assigneeUid !== undefined) {
    const uid = typeof body.assigneeUid === 'string' && body.assigneeUid ? body.assigneeUid : null
    if (uid) {
      const user = await adminDb.doc(`users/${uid}`).get()
      if (!user.exists || user.data()?.workspaceId !== c.get('workspaceId')) return c.json({ error: 'Teammate not found.' }, 404)
    }
    update.assigneeUid = uid
  }
  await ref.update(update)
  const fresh = await ref.get()
  return c.json(safeTicket(fresh.id, fresh.data()!))
})

tickets.post('/:id/resend', async (c) => {
  if (c.get('role') !== 'owner') return c.json({ error: 'Owner access required.' }, 403)
  const workspaceId = c.get('workspaceId')
  const ticket = await adminDb.doc(`workspaces/${workspaceId}/tickets/${c.req.param('id')}`).get()
  if (!ticket.exists) return c.json({ error: 'Ticket not found.' }, 404)
  const deliveries = await adminDb.collection(`workspaces/${workspaceId}/ticketDeliveries`).where('ticketId', '==', ticket.id).limit(1).get()
  if (deliveries.empty) return c.json({ error: 'This ticket has no external delivery.' }, 409)
  const ref = deliveries.docs[0]!.ref
  await ref.update({ status: 'pending', nextAttemptAt: new Date(), safeError: null, leaseExpiresAt: null, updatedAt: new Date() })
  await ticket.ref.update({ deliveryState: 'pending', updatedAt: new Date() })
  const outcome = await processTicketDelivery(ref)
  return c.json({ ok: outcome === 'delivered', outcome })
})

export default tickets
