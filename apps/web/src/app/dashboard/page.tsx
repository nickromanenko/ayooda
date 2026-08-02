import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import Link from 'next/link'
import { MessageSquare, BookOpen, Bot, Zap } from 'lucide-react'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'
import { GetStartedStep } from '@/components/dashboard/GetStartedStep'
import { BillingBanner } from '@/components/dashboard/BillingBanner'

export const dynamic = 'force-dynamic'

async function loadOverview() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')?.value
  if (!sessionCookie) redirect('/login')

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true)
    const db = getAdminDb()
    const userSnap = await db.doc(`users/${decoded.uid}`).get()
    if (!userSnap.exists) redirect('/login')

    const { workspaceId } = userSnap.data()!
    const workspaceSnap = await db.doc(`workspaces/${workspaceId}`).get()
    if (!workspaceSnap.exists) redirect('/onboarding')

    const workspace = workspaceSnap.data()!

    const convCol = db.collection(`workspaces/${workspaceId}/conversations`)
    const knowledgeCol = db.collection(`workspaces/${workspaceId}/knowledge`)
    const channelsCol = db.collection(`workspaces/${workspaceId}/channels`)

    const [totalConvAgg, resolvedAgg, resolvedTakeoverAgg, knowledgeSnap, channelsAgg, recentSnap] =
      await Promise.all([
        convCol.count().get(),
        convCol.where('status', '==', 'resolved').count().get(),
        convCol.where('status', '==', 'resolved').where('hadTakeover', '==', true).count().get(),
        knowledgeCol.get(),
        channelsCol.count().get(),
        convCol.orderBy('updatedAt', 'desc').limit(5).get(),
      ])

    const totalConversations = totalConvAgg.data().count
    const resolved = resolvedAgg.data().count
    const resolvedWithTakeover = resolvedTakeoverAgg.data().count
    const knowledgeDocs = knowledgeSnap.docs.map((d) => d.data())
    const indexedDocs = knowledgeDocs.filter((d) => d.status === 'indexed')
    const chunkCount = indexedDocs.reduce((sum, d) => sum + (d.chunkCount ?? 0), 0)
    const channelCount = channelsAgg.data().count
    const usage = workspace.usage ?? { conversationCount: 0, messageCount: 0, tokenCount: 0 }

    return {
      totalConversations,
      automationRate: resolved > 0 ? Math.round(((resolved - resolvedWithTakeover) / resolved) * 100) : null,
      avgMessages:
        usage.conversationCount > 0 ? (usage.messageCount ?? 0) / usage.conversationCount : null,
      knowledgeDocCount: knowledgeDocs.length,
      indexedDocCount: indexedDocs.length,
      chunkCount,
      channelCount,
      agentConfigured: Boolean(workspace.agent?.description),
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
    redirect('/login')
  }
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
      label: 'Agent status',
      value: o.channelCount > 0 && o.indexedDocCount > 0 ? 'Active' : 'Setup incomplete',
      icon: Bot,
      accent: o.channelCount > 0 && o.indexedDocCount > 0 ? 'var(--mint)' : 'var(--ink-mute)',
    },
  ]

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <BillingBanner />
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>Overview</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-mute)', marginTop: 4 }}>
          Your support agent at a glance
        </p>
      </div>

      {/* Stats grid — same card styling as before */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '18px 20px' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: `color-mix(in oklab, ${stat.accent} 15%, transparent)`, border: `1px solid color-mix(in oklab, ${stat.accent} 25%, transparent)`, display: 'grid', placeItems: 'center', marginBottom: 12, color: stat.accent }}>
              <stat.icon size={16} />
            </div>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>{stat.value}</p>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>{stat.label}</p>
            {stat.sub && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>{stat.sub}</p>}
          </div>
        ))}
      </div>

      {/* Recent conversations */}
      {o.recent.length > 0 && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 16 }}>
            Recent conversations
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {o.recent.map((conv, i) => (
              <Link key={conv.id} href="/dashboard/inbox" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderTop: i > 0 ? '1px solid var(--line)' : 'none', textDecoration: 'none' }}>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {conv.lastMessage || 'New conversation'}
                </span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-mute)', flexShrink: 0 }}>{conv.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Get started */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 16 }}>
          Get started
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <GetStartedStep number={1} title="Configure your agent" description="Give your agent a name, avatar, and personality." href="/dashboard/agents" done={o.agentConfigured} />
          <GetStartedStep number={2} title="Add your knowledge base" description="Paste your website URL or upload documents." href="/dashboard/knowledge" done={o.indexedDocCount > 0} />
          <GetStartedStep number={3} title="Deploy the widget" description="Copy a script tag and paste it into your website." href="/dashboard/channels" done={o.channelCount > 0} />
        </div>
      </div>
    </div>
  )
}
