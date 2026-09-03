import { Hono } from 'hono'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { loadTicketingConfig, rotateTicketingSecret, safeTicketingConfig, saveTicketingConfig } from '../lib/ticketing/config'
import { processTicketDelivery, ticketPayloadHash } from '../lib/ticketing/delivery'
import { adminDb } from '../lib/firebase-admin'

const ticketing = new Hono<{ Variables: AuthVariables }>()
ticketing.use('*', requireAuth)
ticketing.use('*', requireOwner)
ticketing.use('*', requireAgent)

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return (value.toDate() as Date).toISOString()
  return null
}

async function deliveryHealth(workspaceId: string, agentId: string) {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/ticketDeliveries`).where('agentId', '==', agentId).orderBy('createdAt', 'desc').limit(250).get()
  let failed = 0
  let lastSuccessfulAt: string | null = null
  for (const doc of snap.docs) {
    const data = doc.data()
    if (data.test === true) continue
    if (data.status === 'failed') failed++
    if (data.status !== 'delivered') continue
    const deliveredAt = iso(data.deliveredAt)
    if (deliveredAt && (!lastSuccessfulAt || deliveredAt > lastSuccessfulAt)) lastSuccessfulAt = deliveredAt
  }
  return { failed, lastSuccessfulAt }
}

ticketing.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const [config, health] = await Promise.all([loadTicketingConfig(workspaceId, agentId), deliveryHealth(workspaceId, agentId)])
  return c.json({ ...safeTicketingConfig(config), deliveryHealth: health })
})

ticketing.put('/', async (c) => {
  const result = await saveTicketingConfig(c.get('workspaceId'), c.get('agentId')!, await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ ...safeTicketingConfig(result.value), ...(result.newSecret ? { signingSecret: result.newSecret } : {}) })
})

ticketing.post('/secret/rotate', async (c) => {
  const secret = await rotateTicketingSecret(c.get('workspaceId'), c.get('agentId')!)
  if (!secret) return c.json({ error: 'Configure webhook delivery before rotating its signing secret.' }, 409)
  return c.json({ secret })
})

ticketing.post('/test', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const config = await loadTicketingConfig(workspaceId, agentId)
  if (config.destination.type === 'internal') return c.json({ error: 'Choose an external destination before sending a test.' }, 409)
  const now = new Date()
  const payload = {
    id: `evt_test_${Date.now()}`, type: 'ticket.test', createdAt: now.toISOString(), test: true,
    data: { ticket: { id: 'test', number: 1001, status: 'open', priority: 'normal', subject: 'Ayooda test ticket', description: 'This is synthetic test data. No customer ticket was created.', fields: {}, customer: { name: 'Test customer', email: 'customer@example.com', phone: null }, conversation: { id: 'test', dashboardUrl: 'https://app.ayooda.live/dashboard/inbox', messages: [] } } },
  }
  const ref = adminDb.collection(`workspaces/${workspaceId}/ticketDeliveries`).doc()
  await ref.set({
    eventId: payload.id, ticketId: 'test', agentId, event: 'ticket.test', payload,
    payloadSha256: ticketPayloadHash(payload), destinationType: config.destination.type,
    status: 'pending', attemptCount: 0, nextAttemptAt: now, test: true, createdAt: now, updatedAt: now,
  })
  const outcome = await processTicketDelivery(ref)
  if (outcome !== 'delivered') {
    const snap = await ref.get()
    return c.json({ error: snap.data()?.safeError ?? 'Test delivery failed.' }, 502)
  }
  return c.json({ ok: true })
})

export default ticketing
