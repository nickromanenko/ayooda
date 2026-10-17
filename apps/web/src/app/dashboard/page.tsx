import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import Link from 'next/link'
import { MessageSquare, BookOpen, Bot, Zap } from 'lucide-react'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'
import { ActivationChecklist, type ActivationStep } from '@/components/dashboard/ActivationChecklist'
import { BillingBanner } from '@/components/dashboard/BillingBanner'
import { PageHeader } from '@/components/dashboard/DashboardPrimitives'
import { Chip, CountUp, ListRow, Panel, StatTile, StatusPill, type PillTone } from '@/components/dashboard/kit'
import rows from './overview.module.css'

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

const STATUS_TONE: Record<string, PillTone> = { bot: 'lime', waiting: 'red', human: 'blue', resolved: 'neutral' }

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default async function DashboardPage() {
  const o = await loadOverview()

  const stats = [
    {
      label: 'Total conversations',
      value: <CountUp value={o.totalConversations} />,
      sub: o.avgMessages !== null ? `${o.avgMessages.toFixed(1)} messages avg` : undefined,
      icon: MessageSquare,
    },
    {
      label: 'Automation rate',
      value: o.automationRate !== null ? <CountUp value={o.automationRate} suffix="%" /> : '—',
      sub: o.automationRate !== null ? 'resolved without takeover' : 'no resolved conversations yet',
      icon: Zap,
      tone: 'good' as const,
    },
    {
      label: 'Knowledge docs',
      value: <CountUp value={o.indexedDocCount} />,
      sub: `${o.chunkCount} chunks indexed`,
      icon: BookOpen,
    },
    {
      label: 'Agents live',
      value: `${o.liveAgentCount}/${o.agents.length}`,
      sub: o.liveAgentCount > 0 ? 'deployed to a channel' : 'none deployed yet',
      icon: Bot,
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

      <div className={rows.tiles}>
        {stats.map((stat, i) => (
          <StatTile key={stat.label} index={i} label={stat.label} value={stat.value} sub={stat.sub} icon={<stat.icon size={14} aria-hidden />} tone={stat.tone} />
        ))}
      </div>

      {/* Per-agent status: "is it set up?" is a question about a specific agent, not the workspace. */}
      {o.agents.length > 0 && (
        <Panel title="Your agents" sub={`${o.liveAgentCount} of ${o.agents.length} live`}>
          {o.agents.map((a, i) => (
            <ListRow
              key={a.id}
              index={i}
              href={`/dashboard/agents/${a.id}`}
              title={<>{a.name}{a.isDefault && <Chip>default</Chip>}</>}
              sub={`${a.indexedDocs} doc${a.indexedDocs === 1 ? '' : 's'} indexed · ${a.chunks.toLocaleString('en-US')} chunks`}
              meta={<>{a.channels.map((c) => <Chip key={c}>{c}</Chip>)}<StatusPill tone={a.channels.length ? 'green' : 'neutral'}>{a.channels.length ? 'Live' : 'Not deployed'}</StatusPill></>}
            />
          ))}
        </Panel>
      )}

      {/* Recent conversations */}
      {o.recent.length > 0 && (
        <Panel title="Recent conversations" action={<Link href="/dashboard/inbox" className={rows.link}>Open inbox</Link>}>
          {o.recent.map((conv, i) => (
            <ListRow
              key={conv.id}
              index={i}
              plain
              href={`/dashboard/inbox?conversation=${encodeURIComponent(conv.id)}`}
              title={(conv.lastMessage || 'New conversation').replace(/[*_`#]/g, '')}
              sub={timeAgo(conv.updatedAt)}
              meta={<StatusPill tone={STATUS_TONE[conv.status] ?? 'neutral'}>{conv.status}</StatusPill>}
            />
          ))}
        </Panel>
      )}

    </div>
  )
}
