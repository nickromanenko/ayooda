'use client'

import Link from 'next/link'
import { Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AdminAuditEvent, AdminListResponse } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import styles from '../admin.module.css'

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function AdminAuditLogPage() {
  const [events, setEvents] = useState<AdminAuditEvent[]>([])
  const [targetInput, setTargetInput] = useState('')
  const [targetId, setTargetId] = useState('')
  const [action, setAction] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (nextCursor?: string, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '30' })
      if (targetId) params.set('targetId', targetId)
      if (action) params.set('action', action)
      if (nextCursor) params.set('cursor', nextCursor)
      const response = await apiRequest(`/admin/audit-log?${params}`)
      const body = await response.json().catch(() => ({})) as AdminListResponse<AdminAuditEvent> & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not load the audit log.')
      setEvents((current) => append ? [...current, ...body.items] : body.items)
      setCursor(body.nextCursor)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load the audit log.') }
    finally { setLoading(false); setLoadingMore(false) }
  }, [action, targetId])
  useEffect(() => { void load() }, [load])

  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Accountability</p><h1 className={styles.title}>Audit log</h1><p className={styles.description}>A durable record of platform role changes and administrator account actions. Sensitive tokens and customer message content are never recorded.</p></div></header>
    <form className={styles.toolbar} onSubmit={(event) => { event.preventDefault(); setTargetId(targetInput.trim()) }}>
      <div className={styles.searchWrap}><Search className={styles.searchIcon} size={16} /><label className="sr-only" htmlFor="audit-target-search">Filter target ID</label><input id="audit-target-search" className={styles.field} value={targetInput} onChange={(event) => setTargetInput(event.target.value)} placeholder="Exact target UID or workspace ID" /></div>
      <select className={styles.select} value={action} onChange={(event) => setAction(event.target.value)} aria-label="Filter audit action"><option value="">All actions</option><option value="user.disable">User disabled</option><option value="user.enable">User enabled</option><option value="user.revoke_sessions">Sessions revoked</option><option value="platform_role.granted">Admin granted</option><option value="platform_role.revoked">Admin revoked</option></select>
      <button className={styles.button} type="submit">Filter</button>
    </form>
    <section className={styles.tableCard} aria-busy={loading}>
      {loading ? <div className={styles.loading}><Loader2 className={styles.spinner} aria-label="Loading audit log" /></div> : error ? <div className={styles.error}>{error}<br /><button className={`${styles.button} ${styles.buttonGhost}`} onClick={() => void load()}>Retry</button></div> : events.length === 0 ? <div className={styles.empty}>No administrative events match these filters.</div> : <>
        <div className={styles.tableScroller}><table className={styles.table}><thead><tr><th>Event</th><th>Actor</th><th>Target</th><th>Outcome</th><th>Time</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td><div className={styles.primary}>{event.summary}</div><div className={`${styles.secondary} ${styles.mono}`}>{event.action}</div></td><td>{event.actorEmail || event.actorUid}</td><td>{event.targetType === 'user' ? <Link className={styles.tableLink} href={`/admin/users/${encodeURIComponent(event.targetId)}`}>{event.targetId}</Link> : event.targetType === 'workspace' ? <Link className={styles.tableLink} href={`/admin/workspaces/${encodeURIComponent(event.targetId)}`}>{event.targetId}</Link> : event.targetId}</td><td><span className={`${styles.badge} ${event.outcome === 'failed' ? styles.badgeDanger : styles.badgeSuccess}`}>{event.outcome}</span></td><td className={styles.mono}>{event.createdAt ? date.format(new Date(event.createdAt)) : '—'}</td></tr>)}</tbody></table></div>
        {cursor && <div className={styles.tableFooter}><button className={`${styles.button} ${styles.buttonGhost}`} disabled={loadingMore} onClick={() => void load(cursor, true)}>{loadingMore ? <><Loader2 size={14} className={styles.spinner} /> Loading…</> : 'Load more'}</button></div>}
      </>}
    </section>
  </div>
}
