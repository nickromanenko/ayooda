import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import Link from 'next/link'
import { MessageSquare, BookOpen, Bot, Zap, Radio, ChevronRight } from 'lucide-react'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'
import { ActivationChecklist, type ActivationStep } from '@/components/dashboard/ActivationChecklist'
import { BillingBanner } from '@/components/dashboard/BillingBanner'
import { PageHeader } from '@/components/dashboard/DashboardPrimitives'

export const dynamic = 'force-dynamic'

interface AgentRow {
  id: string
  name: string
  isDefault: boolean
  indexedDocs: number
  chunks: number
  channels: string[]
  configuredChannels: number
}

async function loadOverview() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')?.value
  if (!sessionCookie) redirect('/login')

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true)
    const db = getAdminDb()
    const userSnap = await db.doc(`users/${decoded.uid}`).get()
    if (!userSnap.exists) redirect('/api/session')

    const { workspaceId } = userSnap.data()!
    const workspaceSnap = await db.doc(`workspaces/${workspaceId}`).get()
    if (!workspaceSnap.exists) redirect('/onboarding')

    const workspace = workspaceSnap.data()!

    const convCol = db.collection(`workspaces/${workspaceId}/conversations`)

    const [totalConvAgg, resolvedAgg, resolvedTakeoverAgg, agentsSnap, channelsSnap, recentSnap] =
      await Promise.all([
        convCol.count().get(),
        convCol.where('status', '==', 'resolved').count().get(),
        convCol.where('status', '==', 'resolved').where('hadTakeover', '==', true).count().get(),
        db.collection(`workspaces/${workspaceId}/agents`).get(),
        db.collection(`workspaces/${workspaceId}/channels`).get(),
        convCol.orderBy('updatedAt', 'desc').limit(5).get(),
      ])

    // Knowledge is stored per agent (workspaces/{ws}/agents/{id}/knowledge), so
    // it has to be summed across them — there is no workspace-level collection.
    const knowledgePerAgent = await Promise.all(
      agentsSnap.docs.map((a) => a.ref.collection('knowledge').get()),
    )

    const channelLabel = (type: string) =>
      type === 'web_widget' ? 'Website' : type === 'telegram' ? 'Telegram' : type === 'email' ? 'Email' : type === 'slack' ? 'Slack' : type === 'sms' ? 'SMS' : type

    const agents: AgentRow[] = agentsSnap.docs.map((a, i) => {
      const docs = knowledgePerAgent[i]!.docs.map((d) => d.data())
      const indexed = docs.filter((d) => d.status === 'indexed')
      return {
        id: a.id,
        name: (a.data().name as string) ?? 'Agent',
        isDefault: a.data().isDefault === true,
        indexedDocs: indexed.length,
        chunks: indexed.reduce((sum, d) => sum + ((d.chunkCount as number) ?? 0), 0),
        channels: channelsSnap.docs
          .filter((c) => c.data().agentId === a.id && c.data().isActive !== false && (c.data().type !== 'web_widget' || c.data().lastSeenAt))
          .map((c) => channelLabel(c.data().type as string)),
        configuredChannels: channelsSnap.docs.filter((c) => c.data().agentId === a.id).length,
      }
    })
    agents.sort((x, y) => (x.isDefault === y.isDefault ? x.name.localeCompare(y.name) : x.isDefault ? -1 : 1))

    const activationAgent = agents[0]
    const activationAgentDoc = activationAgent ? agentsSnap.docs.find((doc) => doc.id === activationAgent.id) : null
    let evaluationPassed = false
    let handoffConfigured = false
    if (activationAgentDoc) {
      const [runSnap, graphSnap, ruleSnap] = await Promise.all([
        activationAgentDoc.ref.collection('evaluationRuns').orderBy('createdAt', 'desc').limit(1).get(),
        activationAgentDoc.ref.collection('workflowGraph').doc('main').get(),
        activationAgentDoc.ref.collection('workflowRules').where('enabled', '==', true).get(),
      ])
      const latestRun = runSnap.docs[0]?.data()
      evaluationPassed = Number(latestRun?.total ?? 0) > 0 && Number(latestRun?.passed ?? 0) === Number(latestRun?.total ?? 0)
      const graphHasHandoff = graphSnap.exists && Array.isArray(graphSnap.data()?.nodes)
        && graphSnap.data()!.nodes.some((node: { kind?: string; action?: { type?: string } }) => node.kind === 'action' && ['escalate', 'assign_teammate'].includes(node.action?.type ?? ''))
      const ruleHasHandoff = ruleSnap.docs.some((doc) => ['escalate', 'assign_teammate'].includes(doc.data().action?.type))
      handoffConfigured = Boolean(graphHasHandoff || ruleHasHandoff)
    }

    const totalConversations = totalConvAgg.data().count
    const resolved = resolvedAgg.data().count
    const resolvedWithTakeover = resolvedTakeoverAgg.data().count
    const usage = workspace.usage ?? { conversationCount: 0, messageCount: 0, tokenCount: 0 }

    const indexedDocCount = agents.reduce((s, a) => s + a.indexedDocs, 0)
    const chunkCount = agents.reduce((s, a) => s + a.chunks, 0)
    const liveAgentCount = agents.filter((a) => a.channels.length > 0).length

    return {
      totalConversations,
      automationRate: resolved > 0 ? Math.round(((resolved - resolvedWithTakeover) / resolved) * 100) : null,
      avgMessages:
        usage.conversationCount > 0 ? (usage.messageCount ?? 0) / usage.conversationCount : null,
      indexedDocCount,
      chunkCount,
      liveAgentCount,
      agents,
      activation: {
        agentName: activationAgent?.name ?? 'your first agent',
        agentConfigured: Boolean(activationAgentDoc && (
          String(activationAgentDoc.data().name ?? '') !== 'Support Agent'
          || String(activationAgentDoc.data().description ?? '').trim()
          || String(activationAgentDoc.data().systemPrompt ?? '') !== 'You are a helpful customer support agent. Answer questions based on the provided context.'
        )),
        knowledgeReady: (activationAgent?.indexedDocs ?? 0) > 0,
        evaluationPassed,
        handoffConfigured,
        channelConfigured: (activationAgent?.configuredChannels ?? 0) > 0,
        channelLive: (activationAgent?.channels.length ?? 0) > 0,
      },
      recent: recentSnap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          lastMessage: (data.lastMessage as string) ?? '',
          status: data.status as string,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
        }
      }),
    }
  } catch (err) {
    if (isRedirectError(err)) throw err
    console.error('[dashboard/page] session verification failed:', err)
    redirect('/api/session')
  }
}

const panelStyle: React.CSSProperties = {
  background: 'var(--panel)', border: 0, boxShadow: 'var(--shadow-soft)',
  borderRadius: 'var(--r-md)', padding: 24, marginBottom: 24,
}
const eyebrow: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 16,
}

export default async function DashboardPage() {
  const o = await loadOverview()

  const stats = [
    {
      label: 'Total conversations',
      value: String(o.totalConversations),
      sub: o.avgMessages !== null ? `${o.avgMessages.toFixed(1)} messages avg` : undefined,
      icon: MessageSquare,
      accent: 'var(--blue)',
    },
    {
      label: 'Automation rate',
      value: o.automationRate !== null ? `${o.automationRate}%` : '—',
      sub: o.automationRate !== null ? 'resolved without takeover' : 'no resolved conversations yet',
      icon: Zap,
      accent: 'var(--mint)',
    },
    {
      label: 'Knowledge docs',
      value: String(o.indexedDocCount),
      sub: `${o.chunkCount} chunks indexed`,
      icon: BookOpen,
      accent: 'var(--accent)',
    },
    {
      label: 'Agents live',
      value: `${o.liveAgentCount}/${o.agents.length}`,
      sub: o.liveAgentCount > 0 ? 'deployed to a channel' : 'none deployed yet',
      icon: Bot,
      accent: o.liveAgentCount > 0 ? 'var(--mint)' : 'var(--ink-mute)',
    },
  ]

  const firstAgentId = o.agents[0]?.id
  const activationBase = firstAgentId ? `/dashboard/agents/${firstAgentId}` : '/dashboard/agents'
  const activationSteps: ActivationStep[] = [
    {
      id: 'identity', title: 'Configure identity', action: 'Configure', done: o.activation.agentConfigured,
      description: 'Set a recognizable name, purpose, instructions, and model.', href: activationBase,
    },
    {
      id: 'knowledge', title: 'Index trusted knowledge', action: 'Add knowledge', done: o.activation.knowledgeReady,
      description: 'Give the agent at least one indexed source it can rely on.', href: firstAgentId ? `${activationBase}/knowledge` : activationBase,
    },
    {
      id: 'tests', title: 'Pass regression tests', action: 'Create tests', done: o.activation.evaluationPassed,
      description: 'Verify important answers and hand-off behavior before launch.', href: firstAgentId ? `${activationBase}/test` : activationBase,
    },
    {
      id: 'handoff', title: 'Configure human hand-off', action: 'Set workflow', done: o.activation.handoffConfigured,
      description: 'Give uncertain or sensitive requests a safe path to a teammate.', href: firstAgentId ? `${activationBase}/escalation` : activationBase,
    },
    {
      id: 'channel', title: 'Launch a channel', action: o.activation.channelConfigured ? 'Finish installation' : 'Deploy', done: o.activation.channelLive,
      description: o.activation.channelConfigured && !o.activation.channelLive
        ? 'The channel is configured but has not received its first live connection.'
        : 'Connect a customer channel and verify that it receives traffic.',
      href: firstAgentId ? `${activationBase}/deploy` : activationBase,
    },
  ]

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <BillingBanner />
      <PageHeader title="Overview" description="Your support agents at a glance" />

      <ActivationChecklist agentName={o.activation.agentName} steps={activationSteps} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{ background: 'var(--panel)', border: 0, boxShadow: 'var(--shadow-soft)', borderRadius: 'var(--r-md)', padding: '18px 20px' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: `color-mix(in oklab, ${stat.accent} 15%, transparent)`, border: `1px solid color-mix(in oklab, ${stat.accent} 25%, transparent)`, display: 'grid', placeItems: 'center', marginBottom: 12, color: stat.accent }}>
              <stat.icon size={16} />
            </div>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>{stat.value}</p>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>{stat.label}</p>
            {stat.sub && <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 2 }}>{stat.sub}</p>}
          </div>
        ))}
      </div>

      {/* Per-agent status — one row per agent, since "is it set up?" is a
          question about a specific agent, not about the workspace. */}
      {o.agents.length > 0 && (
        <div style={panelStyle}>
          <div style={eyebrow}>Your agents</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {o.agents.map((a, i) => (
              <Link
                key={a.id}
                href={`/dashboard/agents/${a.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 4px', borderTop: i > 0 ? '1px solid var(--line)' : 'none', textDecoration: 'none' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>
                    {a.name}
                    {a.isDefault && <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}> · default</span>}
                  </p>
                  <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: 0 }}>
                    {a.indexedDocs} doc{a.indexedDocs === 1 ? '' : 's'} indexed
                  </p>
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontFamily: 'var(--font-mono)', color: a.channels.length ? 'var(--mint)' : 'var(--ink-mute)', flexShrink: 0 }}>
                  <Radio size={12} />
                  {a.channels.length ? a.channels.join(' · ') : 'not deployed'}
                </span>
                <ChevronRight size={14} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent conversations */}
      {o.recent.length > 0 && (
        <div style={panelStyle}>
          <div style={eyebrow}>Recent conversations</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {o.recent.map((conv, i) => (
              <Link key={conv.id} href={`/dashboard/inbox?conversation=${encodeURIComponent(conv.id)}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderTop: i > 0 ? '1px solid var(--line)' : 'none', textDecoration: 'none' }}>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {conv.lastMessage || 'New conversation'}
                </span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-mute)', flexShrink: 0 }}>{conv.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
