'use client'

import Link from 'next/link'
import { Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AdminListResponse, AdminUserSummary } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { AppSelect } from '@/components/ui/AppSelect'
import styles from '../admin.module.css'

const date = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [adminsOnly, setAdminsOnly] = useState(false)
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
      if (status) params.set('status', status)
      if (adminsOnly) params.set('platformRole', 'admin')
      if (nextCursor) params.set('cursor', nextCursor)
      const response = await apiRequest(`/admin/users?${params}`)
      const body = await response.json().catch(() => ({})) as AdminListResponse<AdminUserSummary> & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not load users.')
      setUsers((current) => append ? [...current, ...body.items] : body.items)
      setCursor(body.nextCursor)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load users.') }
    finally { setLoading(false); setLoadingMore(false) }
  }, [adminsOnly, query, status])

  useEffect(() => { void load() }, [load])

  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Platform directory</p><h1 className={styles.title}>Users</h1><p className={styles.description}>Find accounts, understand their workspace access, and safely manage sign-in.</p></div></header>
    <form className={styles.toolbar} onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()) }}>
      <div className={styles.searchWrap}><Search className={styles.searchIcon} size={16} /><label className="sr-only" htmlFor="admin-user-search">Search users</label><input id="admin-user-search" className={styles.field} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Name, email, or exact UID" /></div>
      <AppSelect ariaLabel="Filter by account status" className={styles.heroSelect} value={status} onChange={setStatus} emptyLabel="All statuses" options={[{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled' }]} />
      <label className={styles.button + ' ' + styles.buttonGhost} style={{ cursor: 'pointer' }}><input type="checkbox" checked={adminsOnly} onChange={(event) => setAdminsOnly(event.target.checked)} /> Admins only</label>
      <button className={styles.button} type="submit">Search</button>
    </form>
    <section className={styles.tableCard} aria-busy={loading}>
      {loading ? <div className={styles.loading}><Loader2 className={styles.spinner} aria-label="Loading users" /></div> : error ? <div className={styles.error}>{error}<br /><button className={`${styles.button} ${styles.buttonGhost}`} onClick={() => void load()}>Retry</button></div> : users.length === 0 ? <div className={styles.empty}>No users match these filters.</div> : <>
        <div className={styles.tableScroller}><table className={styles.table}><thead><tr><th>User</th><th>Workspace</th><th>Access</th><th>Role</th><th>Created</th></tr></thead><tbody>{users.map((user) => <tr key={user.uid}><td><Link className={styles.tableLink} href={`/admin/users/${encodeURIComponent(user.uid)}`}>{user.displayName || user.email || 'Unnamed user'}</Link><div className={styles.secondary}>{user.email || user.uid}</div></td><td><Link className={styles.tableLink} href={`/admin/workspaces/${encodeURIComponent(user.workspaceId)}`}>{user.workspaceName || user.workspaceId || 'Unassigned'}</Link></td><td><span className={`${styles.badge} ${user.accessStatus === 'disabled' ? styles.badgeDanger : styles.badgeSuccess}`}>{user.accessStatus}</span></td><td><span className={`${styles.badge} ${user.platformRole === 'admin' ? styles.badgeAccent : ''}`}>{user.platformRole ?? user.workspaceRole}</span></td><td className={styles.mono}>{user.createdAt ? date.format(new Date(user.createdAt)) : '—'}</td></tr>)}</tbody></table></div>
        {cursor && <div className={styles.tableFooter}><button className={`${styles.button} ${styles.buttonGhost}`} disabled={loadingMore} onClick={() => void load(cursor, true)}>{loadingMore ? <><Loader2 size={14} className={styles.spinner} /> Loading…</> : 'Load more'}</button></div>}
      </>}
    </section>
  </div>
}
