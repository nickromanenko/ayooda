'use client'

import Link from 'next/link'
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AdminWorkspaceDetail } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import styles from '../../admin.module.css'

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const number = new Intl.NumberFormat()

export default function WorkspaceDetail({ workspaceId }: { workspaceId: string }) {
  const [workspace, setWorkspace] = useState<AdminWorkspaceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await apiRequest(`/admin/workspaces/${encodeURIComponent(workspaceId)}`)
      const body = await response.json().catch(() => ({})) as AdminWorkspaceDetail & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not load this workspace.')
      setWorkspace(body)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load this workspace.') }
    finally { setLoading(false) }
  }, [workspaceId])
  useEffect(() => { void load() }, [load])

  if (loading) return <div className={styles.loading}><Loader2 className={styles.spinner} aria-label="Loading workspace" /></div>
  if (error || !workspace) return <div className={styles.page}><div className={styles.error}>{error}<br /><button className={`${styles.button} ${styles.buttonGhost}`} onClick={() => void load()}>Retry</button></div></div>

  return <div className={styles.page}>
    <Link href="/admin/workspaces" className={styles.backLink}><ArrowLeft size={15} /> Workspaces</Link>
    <header className={styles.header}><div><p className={styles.eyebrow}>Workspace</p><h1 className={styles.title}>{workspace.name}</h1><p className={`${styles.description} ${styles.mono}`}>{workspace.id}</p></div><span className={`${styles.badge} ${workspace.subscriptionStatus === 'past_due' ? styles.badgeDanger : workspace.subscriptionStatus === 'active' ? styles.badgeSuccess : ''}`}>{workspace.tier ?? 'No plan'} · {workspace.subscriptionStatus ?? 'unknown'}</span></header>
    <section className={styles.countGrid} aria-label="Workspace counts">{Object.entries(workspace.counts).map(([label, value]) => <div className={styles.countCard} key={label}><span className={styles.countValue}>{number.format(value)}</span><span className={styles.countLabel}>{label}</span></div>)}</section>
    <div className={styles.detailGrid} style={{ marginTop: 18 }}>
      <section className={styles.card}><div className={styles.cardHeader}><h2 className={styles.cardTitle}>Workspace details</h2></div><dl className={styles.detailList}><dt>Owner</dt><dd>{workspace.ownerEmail || workspace.ownerId || '—'}</dd><dt>Onboarding</dt><dd>{workspace.onboardingComplete ? 'Complete' : 'Incomplete'}</dd><dt>Created</dt><dd>{workspace.createdAt ? date.format(new Date(workspace.createdAt)) : '—'}</dd><dt>Period conversations</dt><dd className={styles.mono}>{number.format(workspace.periodConversationCount)}</dd><dt>Total tokens</dt><dd className={styles.mono}>{number.format(workspace.tokenCount)}</dd><dt>Stripe customer</dt><dd>{workspace.stripeCustomerId ? <a className={styles.subtleLink} href={`https://dashboard.stripe.com/search?query=${encodeURIComponent(workspace.stripeCustomerId)}`} target="_blank" rel="noreferrer">{workspace.stripeCustomerId} <ExternalLink size={12} aria-label="Open in Stripe" /></a> : '—'}</dd><dt>Stripe subscription</dt><dd className={styles.mono}>{workspace.stripeSubscriptionId ?? '—'}</dd></dl></section>
      <section className={styles.card}><div className={styles.cardHeader}><h2 className={styles.cardTitle}>Members</h2></div><ul className={styles.list}>{workspace.members.map((member) => <li className={styles.listItem} key={member.uid}><div className={styles.listMain}><Link className={styles.tableLink} href={`/admin/users/${encodeURIComponent(member.uid)}`}>{member.displayName || member.email || member.uid}</Link><p className={styles.secondary}>{member.email} · {member.workspaceRole}</p></div><span className={`${styles.badge} ${member.accessStatus === 'disabled' ? styles.badgeDanger : styles.badgeSuccess}`}>{member.accessStatus}</span></li>)}</ul></section>
    </div>
  </div>
}
