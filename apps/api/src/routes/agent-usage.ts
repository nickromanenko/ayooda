import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { shouldResetPeriod, checkEntitlement } from '../lib/billing/entitlement'
import { averageTiming } from '../lib/analytics/timing'
import { CONFIDENCE_TREND_DAYS, confidenceSummary, utcDateKey } from '../lib/analytics/confidence'
import { periodTrends, USAGE_TREND_DAYS } from '../lib/analytics/period-trends'

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
agentUsage.use('*', requireAgent)

const toDate = (v: unknown): Date | null => {
  if (!v) return null
  const d = v as { toDate?: () => Date }
  return typeof d.toDate === 'function' ? d.toDate() : (v instanceof Date ? v : null)
}

/** Escape one CSV cell (RFC 4180). Newlines collapse to spaces to keep rows simple. */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  const cleaned = s.replace(/[\r\n]+/g, ' ')
  return /[",]/.test(cleaned) ? `"${cleaned.replace(/"/g, '""')}"` : cleaned
}

export interface HandoffCause {
  reason: string
  count: number
  percentage: number
}

interface HandoffConversation {
  id: string
  status?: unknown
  hadTakeover?: unknown
  escalationReason?: unknown
}

/** Build a bounded, deduplicated cause breakdown from escalation and takeover query results. */
export function aggregateHandoffCauses(rows: HandoffConversation[]): { total: number; causes: HandoffCause[] } {
  const conversations = new Map<string, HandoffConversation>()
  for (const row of rows) conversations.set(row.id, { ...conversations.get(row.id), ...row })

  const counts = new Map<string, number>()
  let total = 0
  for (const row of conversations.values()) {
    const rawReason = typeof row.escalationReason === 'string' ? row.escalationReason.trim() : ''
    const isHandoff = rawReason.length > 0 || row.hadTakeover === true || row.status === 'waiting'
    if (!isHandoff) continue
    const reason = (rawReason || (row.hadTakeover === true ? 'Manual takeover' : 'Unspecified')).slice(0, 80)
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
    total += 1
  }

  const ranked = [...counts.entries()].sort(([aReason, aCount], [bReason, bCount]) =>
    bCount - aCount || aReason.localeCompare(bReason))
  const visible = ranked.slice(0, 7)
  const other = ranked.slice(7).reduce((sum, [, count]) => sum + count, 0)
  if (other > 0) visible.push(['Other', other])

  return {
    total,
    causes: visible.map(([reason, count]) => ({
      reason,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    })),
  }
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
  const requestNow = new Date()
  const confidenceStart = new Date(requestNow.getTime() - (CONFIDENCE_TREND_DAYS - 1) * 86_400_000)
  const confidenceStartKey = utcDateKey(confidenceStart)

  const trendStart = new Date(requestNow.getTime() - USAGE_TREND_DAYS * 2 * 86_400_000)
  const [totalAgg, resolvedAgg, takeoverAgg, waitingAgg, periodAgg, agentSnap, knowledgeSnap, channelsSnap, escalatedSnap, allTakeoversSnap, firstReplySnap, resolutionSnap, confidenceDailySnap, trendSnap] =
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
      mine.where('escalationReason', '>=', '').select('escalationReason', 'hadTakeover', 'status').get().catch((err: unknown) => {
        console.warn('[agent-usage] escalation causes unavailable (index building?):', err)
        return null
      }),
      mine.where('hadTakeover', '==', true).select('escalationReason', 'hadTakeover', 'status').get().catch((err: unknown) => {
        console.warn('[agent-usage] takeover causes unavailable:', err)
        return null
      }),
      mine.where('firstReplyMs', '>=', 0).select('firstReplyMs').get().catch((err: unknown) => {
        console.warn('[agent-usage] first-reply timing unavailable (index building?):', err)
        return null
      }),
      mine.where('resolutionMs', '>=', 0).select('resolutionMs').get().catch((err: unknown) => {
        console.warn('[agent-usage] resolution timing unavailable (index building?):', err)
        return null
      }),
      adminDb.collection(`workspaces/${ws}/agents/${agentId}/confidenceDaily`)
        .where('date', '>=', confidenceStartKey).orderBy('date', 'asc').limit(CONFIDENCE_TREND_DAYS).get()
        .catch((err: unknown) => {
          console.warn('[agent-usage] confidence trend unavailable:', err)
          return null
        }),
      mine.where('createdAt', '>=', trendStart)
        .select('createdAt', 'status', 'hadTakeover', 'firstReplyMs', 'score').get()
        .catch((err: unknown) => {
          console.warn('[agent-usage] period trends unavailable (index building?):', err)
          return null
        }),
    ])

  const total = totalAgg.data().count
  const resolved = resolvedAgg.data().count
  const resolvedWithTakeover = takeoverAgg.data().count
  const automated = resolved - resolvedWithTakeover

  const agentData = agentSnap.data() ?? {}
  const agentUsageDoc = agentData.usage ?? {}

  const indexed = knowledgeSnap.docs.map((d) => d.data()).filter((d) => d.status === 'indexed')
  const handoffs = aggregateHandoffCauses([
    ...(escalatedSnap?.docs ?? []),
    ...(allTakeoversSnap?.docs ?? []),
  ].map((d) => ({ id: d.id, ...d.data() })))
  const timing = {
    firstReply: averageTiming((firstReplySnap?.docs ?? []).map((d) => d.data().firstReplyMs)),
    resolution: averageTiming((resolutionSnap?.docs ?? []).map((d) => d.data().resolutionMs)),
  }
  const confidence = confidenceSummary(
    (confidenceDailySnap?.docs ?? []).map((d) => d.data()),
    requestNow,
  )

  // CSAT: the scoring skill writes score (1–5) on resolved conversations.
  // The `where score >= 1` leg needs a composite index (agentId + score); degrade
  // to null while it builds rather than failing the page.
  let csat: { average: number | null; count: number; distribution: [number, number, number, number, number] } = {
    average: null, count: 0, distribution: [0, 0, 0, 0, 0],
  }
  try {
    const scoredSnap = await mine.where('score', '>=', 1).get()
    const scores = scoredSnap.docs
      .map((d) => d.data().score as number)
      .filter((s) => Number.isFinite(s))
    if (scores.length > 0) {
      const sum = scores.reduce((a, b) => a + b, 0)
      const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0]
      for (const s of scores) {
        const i = Math.min(4, Math.max(0, Math.round(s) - 1))
        distribution[i]! += 1
      }
      csat = {
        average: Math.round((sum / scores.length) * 10) / 10,
        count: scores.length,
        distribution,
      }
    }
  } catch (err) {
    console.warn('[agent-usage] csat unavailable (index building?):', err)
  }

  // Reuse the billing gate so the included cap shown here matches Billing —
  // including trials, whose cap is not on any plan.
  const now = requestNow
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
    handoffs,
    timing,
    confidence,
    trends: trendSnap ? periodTrends(trendSnap.docs.map((doc) => doc.data()), requestNow) : null,
    csat,
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

/** GET /agents/:agentId/usage/export — this agent's conversations as CSV. */
agentUsage.get('/export', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const snap = await adminDb.collection(`workspaces/${ws}/conversations`).where('agentId', '==', agentId).get()
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as Array<{ id: string } & Record<string, unknown>>
  rows.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0))

  const header = [
    'conversation_id', 'visitor', 'channel', 'status', 'created_at', 'updated_at',
    'first_reply_at', 'first_reply_ms', 'resolved_at', 'resolution_ms',
    'knowledge_confidence_average', 'knowledge_confidence_latest', 'knowledge_confidence_samples',
    'score', 'summary', 'had_takeover', 'escalation_reason', 'last_message',
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([
      r.id,
      r.visitorId ?? '',
      r.channelType ?? '',
      r.status ?? '',
      toDate(r.createdAt)?.toISOString() ?? '',
      toDate(r.updatedAt)?.toISOString() ?? '',
      toDate(r.firstReplyAt)?.toISOString() ?? '',
      typeof r.firstReplyMs === 'number' ? r.firstReplyMs : '',
      toDate(r.resolvedAt)?.toISOString() ?? '',
      typeof r.resolutionMs === 'number' ? r.resolutionMs : '',
      typeof r.confidenceSum === 'number' && typeof r.confidenceSamples === 'number' && r.confidenceSamples > 0
        ? Math.round(r.confidenceSum / r.confidenceSamples)
        : '',
      typeof r.confidenceLatest === 'number' ? r.confidenceLatest : '',
      typeof r.confidenceSamples === 'number' ? r.confidenceSamples : '',
      typeof r.score === 'number' ? r.score : '',
      r.summary ?? '',
      r.hadTakeover === true ? 'true' : 'false',
      r.escalationReason ?? '',
      r.lastMessage ?? '',
    ].map(csvCell).join(','))
  }

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="agent-${agentId}-conversations.csv"`)
  return c.body(lines.join('\n'))
})

export default agentUsage
