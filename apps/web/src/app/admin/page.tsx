'use client'

import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AdminOverview, AdminOverviewMetric } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import styles from './admin.module.css'

const number = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

function Metric({ label, metric, hint }: { label: string; metric: AdminOverviewMetric; hint?: string }) {
  return <article className={styles.metric}><p className={styles.metricLabel}>{label}</p><p className={styles.metricValue}>{metric.value === null ? '—' : number.format(metric.value)}</p><p className={styles.metricHint}>{metric.unavailable ? 'Unavailable right now' : hint}</p></article>
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await apiRequest('/admin/overview')
      if (!response.ok) throw new Error('Could not load platform metrics.')
      setData(await response.json() as AdminOverview)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load platform metrics.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (loading) return <div className={styles.loading}><Loader2 className={styles.spinner} aria-label="Loading admin overview" /></div>
  if (error || !data) return <div className={styles.page}><div className={styles.error}>{error}<br /><button className={`${styles.button} ${styles.buttonGhost}`} onClick={() => void load()}>Retry</button></div></div>

  const metrics = data.metrics
  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Platform operations</p><h1 className={styles.title}>Overview</h1><p className={styles.description}>A clear view of Ayooda accounts, workspaces, subscriptions, and current usage.</p></div></header>
    <section className={styles.metricGrid} aria-label="Platform metrics">
      <Metric label="Users" metric={metrics.users} hint={`${metrics.signups7d.value ?? '—'} joined in 7 days`} />
      <Metric label="Workspaces" metric={metrics.workspaces} hint={`${metrics.signups30d.value ?? '—'} users joined in 30 days`} />
      <Metric label="Active plans" metric={metrics.activeSubscriptions} hint={`${metrics.trialingSubscriptions.value ?? '—'} trialing`} />
      <Metric label="Past due" metric={metrics.pastDueSubscriptions} hint="Needs billing attention" />
      <Metric label="Period conversations" metric={metrics.periodConversations} hint="Across all workspaces" />
      <Metric label="Total tokens" metric={metrics.totalTokens} hint="Lifetime recorded usage" />
    </section>
    <div className={styles.gridTwo}>
      <section className={styles.card}><div className={styles.cardHeader}><h2 className={styles.cardTitle}>Recent users</h2><Link className={styles.subtleLink} href="/admin/users">View all</Link></div><ul className={styles.list}>{data.recentUsers.map((user) => <li className={styles.listItem} key={user.uid}><div className={styles.listMain}><p className={styles.primary}>{user.displayName || user.email || user.uid}</p><p className={styles.secondary}>{user.email} · {user.workspaceName || 'No workspace name'}</p></div><time className={styles.date}>{user.createdAt ? date.format(new Date(user.createdAt)) : '—'}</time></li>)}{data.recentUsers.length === 0 && <li className={styles.empty}>No users yet.</li>}</ul></section>
      <section className={styles.card}><div className={styles.cardHeader}><h2 className={styles.cardTitle}>Recent workspaces</h2><Link className={styles.subtleLink} href="/admin/workspaces">View all</Link></div><ul className={styles.list}>{data.recentWorkspaces.map((workspace) => <li className={styles.listItem} key={workspace.id}><div className={styles.listMain}><p className={styles.primary}>{workspace.name}</p><p className={styles.secondary}>{workspace.ownerEmail || workspace.ownerId} · {workspace.subscriptionStatus ?? 'No plan'}</p></div><time className={styles.date}>{workspace.createdAt ? date.format(new Date(workspace.createdAt)) : '—'}</time></li>)}{data.recentWorkspaces.length === 0 && <li className={styles.empty}>No workspaces yet.</li>}</ul></section>
    </div>
  </div>
}
