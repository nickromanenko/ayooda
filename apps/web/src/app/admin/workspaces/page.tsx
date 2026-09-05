'use client'

import Link from 'next/link'
import { Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AdminListResponse, AdminWorkspaceSummary } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { AppSelect } from '@/components/ui/AppSelect'
import styles from '../admin.module.css'

const date = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const number = new Intl.NumberFormat()

export default function AdminWorkspacesPage() {
  const [items, setItems] = useState<AdminWorkspaceSummary[]>([])
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [subscriptionStatus, setSubscriptionStatus] = useState('')
  const [tier, setTier] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (nextCursor?: string, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '25' })
      if (query) params.set('query', query)
      if (subscriptionStatus) params.set('subscriptionStatus', subscriptionStatus)
      if (tier) params.set('tier', tier)
      if (nextCursor) params.set('cursor', nextCursor)
      const response = await apiRequest(`/admin/workspaces?${params}`)
      const body = await response.json().catch(() => ({})) as AdminListResponse<AdminWorkspaceSummary> & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not load workspaces.')
      setItems((current) => append ? [...current, ...body.items] : body.items)
      setCursor(body.nextCursor)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load workspaces.') }
    finally { setLoading(false); setLoadingMore(false) }
  }, [query, subscriptionStatus, tier])
  useEffect(() => { void load() }, [load])

  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Tenant operations</p><h1 className={styles.title}>Workspaces</h1><p className={styles.description}>Inspect customer setup, subscription health, and aggregate usage without exposing secrets or conversation content.</p></div></header>
    <form className={styles.toolbar} onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()) }}>
      <div className={styles.searchWrap}><Search className={styles.searchIcon} size={16} /><label className="sr-only" htmlFor="admin-workspace-search">Search workspaces</label><input id="admin-workspace-search" className={styles.field} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Workspace name or exact ID" /></div>
      <AppSelect ariaLabel="Filter subscription status" className={styles.heroSelect} value={subscriptionStatus} onChange={setSubscriptionStatus} emptyLabel="All subscriptions" options={[{ value: 'trialing', label: 'Trialing' }, { value: 'active', label: 'Active' }, { value: 'past_due', label: 'Past due' }, { value: 'canceled', label: 'Canceled' }, { value: 'expired', label: 'Expired' }]} />
      <AppSelect ariaLabel="Filter plan" className={styles.heroSelect} value={tier} onChange={setTier} emptyLabel="All plans" options={[{ value: 'lite', label: 'Lite' }, { value: 'core', label: 'Core' }, { value: 'max', label: 'Max' }]} />
      <button className={styles.button} type="submit">Search</button>
    </form>
    <section className={styles.tableCard} aria-busy={loading}>
      {loading ? <div className={styles.loading}><Loader2 className={styles.spinner} aria-label="Loading workspaces" /></div> : error ? <div className={styles.error}>{error}<br /><button className={`${styles.button} ${styles.buttonGhost}`} onClick={() => void load()}>Retry</button></div> : items.length === 0 ? <div className={styles.empty}>No workspaces match these filters.</div> : <>
        <div className={styles.tableScroller}><table className={styles.table}><thead><tr><th>Workspace</th><th>Owner</th><th>Subscription</th><th>Period usage</th><th>Created</th></tr></thead><tbody>{items.map((workspace) => <tr key={workspace.id}><td><Link className={styles.tableLink} href={`/admin/workspaces/${encodeURIComponent(workspace.id)}`}>{workspace.name}</Link><div className={`${styles.secondary} ${styles.mono}`}>{workspace.id}</div></td><td>{workspace.ownerEmail || workspace.ownerId || '—'}</td><td><span className={`${styles.badge} ${workspace.subscriptionStatus === 'past_due' ? styles.badgeDanger : workspace.subscriptionStatus === 'active' ? styles.badgeSuccess : ''}`}>{workspace.tier ?? 'No plan'} · {workspace.subscriptionStatus ?? 'unknown'}</span></td><td className={styles.mono}>{number.format(workspace.periodConversationCount)} conversations</td><td className={styles.mono}>{workspace.createdAt ? date.format(new Date(workspace.createdAt)) : '—'}</td></tr>)}</tbody></table></div>
        {cursor && <div className={styles.tableFooter}><button className={`${styles.button} ${styles.buttonGhost}`} disabled={loadingMore} onClick={() => void load(cursor, true)}>{loadingMore ? <><Loader2 size={14} className={styles.spinner} /> Loading…</> : 'Load more'}</button></div>}
      </>}
    </section>
  </div>
}
