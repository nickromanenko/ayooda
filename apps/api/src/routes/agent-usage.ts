import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { shouldResetPeriod, checkEntitlement } from '../lib/billing/entitlement'

/**
 * Per-agent usage.
 *
 * Conversation figures are counted from the conversations collection, so they
 * are accurate for the agent's entire life. Message and token figures come from
 * counters on the agent doc, which only started accruing when per-agent tracking
 * was added — `trackedSince` says from when, so the UI can label them honestly
 * rather than showing a zero that looks like a bug.
 */
const agentUsage = new Hono<{ Variables: AuthVariables }>()
agentUsage.use('*', requireAuth)
agentUsage.use('*', requireOwner)
agentUsage.use('*', requireAgent)

const toDate = (v: unknown): Date | null => {
  if (!v) return null
  const d = v as { toDate?: () => Date }
  return typeof d.toDate === 'function' ? d.toDate() : (v instanceof Date ? v : null)
}

agentUsage.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const workspaceSnap = await adminDb.doc(`workspaces/${ws}`).get()
  const workspaceData = workspaceSnap.data() ?? {}
  const wsUsage = workspaceData.usage ?? {}

  const rawSub = workspaceData.subscription
  const sub = rawSub
    ? {
        ...rawSub,
        trialEndsAt: toDate(rawSub.trialEndsAt),
        currentPeriodEnd: toDate(rawSub.currentPeriodEnd),
      }
    : undefined

  // The workspace's billing period, so "this period" here lines up with Billing.
  const storedPeriodStart = toDate(wsUsage.periodStart)
  const reset = shouldResetPeriod(storedPeriodStart, new Date(), sub)
  const periodStart = reset ? new Date() : storedPeriodStart

  const conv = adminDb.collection(`workspaces/${ws}/conversations`)
  const mine = conv.where('agentId', '==', agentId)

  const [totalAgg, resolvedAgg, takeoverAgg, waitingAgg, periodAgg, agentSnap, knowledgeSnap, channelsSnap] =
    await Promise.all([
      mine.count().get(),
      mine.where('status', '==', 'resolved').count().get(),
      mine.where('status', '==', 'resolved').where('hadTakeover', '==', true).count().get(),
      mine.where('status', '==', 'waiting').count().get(),
      // The only query here needing a composite index (agentId + createdAt).
      // Degrade to null rather than failing the whole page while that index is
      // still building after a deploy — the UI simply omits the period figure.
      periodStart
        ? mine.where('createdAt', '>=', periodStart).count().get().catch((err: unknown) => {
            console.warn('[agent-usage] period count unavailable (index building?):', err)
            return null
          })
        : Promise.resolve(null),
      adminDb.doc(`workspaces/${ws}/agents/${agentId}`).get(),
      adminDb.collection(`workspaces/${ws}/agents/${agentId}/knowledge`).get(),
      adminDb.collection(`workspaces/${ws}/channels`).where('agentId', '==', agentId).get(),
    ])

  const total = totalAgg.data().count
  const resolved = resolvedAgg.data().count
  const resolvedWithTakeover = takeoverAgg.data().count
  const automated = resolved - resolvedWithTakeover

  const agentData = agentSnap.data() ?? {}
  const agentUsageDoc = agentData.usage ?? {}

  const indexed = knowledgeSnap.docs.map((d) => d.data()).filter((d) => d.status === 'indexed')

  // Reuse the billing gate so the included cap shown here matches Billing —
  // including trials, whose cap is not on any plan.
  const now = new Date()
  const periodUsed = reset ? 0 : ((wsUsage.periodConversationCount as number | undefined) ?? 0)
  const ent = checkEntitlement({
    subscription: sub,
    periodConversationCount: periodUsed,
    now,
    workspaceCreatedAt: toDate(workspaceData.createdAt) ?? new Date(0),
  })

  return c.json({
    conversations: {
      total,
      thisPeriod: periodAgg ? periodAgg.data().count : null,
      resolved,
      automated,
      handedOff: resolvedWithTakeover,
      waiting: waitingAgg.data().count,
    },
    // Same definition the Overview uses: of the conversations this agent
    // resolved, the share it resolved without a human stepping in.
    automationRate: resolved > 0 ? Math.round((automated / resolved) * 100) : null,
    messages: {
      count: (agentUsageDoc.messageCount as number | undefined) ?? null,
      tokens: (agentUsageDoc.tokenCount as number | undefined) ?? null,
      trackedSince: toDate(agentUsageDoc.trackedSince)?.toISOString() ?? null,
    },
    knowledge: {
      docs: knowledgeSnap.size,
      indexed: indexed.length,
      chunks: indexed.reduce((sum, d) => sum + ((d.chunkCount as number) ?? 0), 0),
    },
    channels: channelsSnap.docs.map((d) => d.data().type as string),
    workspace: {
      periodConversations: periodUsed,
      includedCap: ent.includedCap,
      periodStart: periodStart?.toISOString() ?? null,
      tier: ent.tier,
    },
  })
})

export default agentUsage
