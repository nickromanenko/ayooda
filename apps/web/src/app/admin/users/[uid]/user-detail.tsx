'use client'

import Link from 'next/link'
import { ArrowLeft, Loader2, LogOut, ShieldOff, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AdminUserSummary } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import styles from '../../admin.module.css'

const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const shown = (value: string | null) => value ? fullDate.format(new Date(value)) : '—'

export default function UserDetail({ uid }: { uid: string }) {
  const [user, setUser] = useState<AdminUserSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await apiRequest(`/admin/users/${encodeURIComponent(uid)}`)
      const body = await response.json().catch(() => ({})) as AdminUserSummary & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not load this user.')
      setUser(body)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load this user.') }
    finally { setLoading(false) }
  }, [uid])
  useEffect(() => { void load() }, [load])

  async function action(kind: 'disable' | 'enable' | 'revoke-sessions') {
    if (!user) return
    const prompt = kind === 'disable'
      ? `Disable ${user.email || user.uid}? They will be signed out and unable to sign in.`
      : kind === 'enable' ? `Re-enable ${user.email || user.uid}?` : `Sign ${user.email || user.uid} out of all sessions?`
    if (!window.confirm(prompt)) return
    setBusy(kind); setError(''); setNotice('')
    try {
      const response = await apiRequest(`/admin/users/${encodeURIComponent(uid)}/${kind}`, { method: 'POST' })
      const body = await response.json().catch(() => ({})) as AdminUserSummary & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'The account action failed.')
      setUser({ ...body, workspaceName: body.workspaceName || user.workspaceName })
      setNotice(kind === 'disable' ? 'Account disabled and sessions revoked.' : kind === 'enable' ? 'Account enabled.' : 'All sessions were revoked.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The account action failed.') }
    finally { setBusy('') }
  }

  if (loading) return <div className={styles.loading}><Loader2 className={styles.spinner} aria-label="Loading user" /></div>
  if (error && !user) return <div className={styles.page}><div className={styles.error}>{error}<br /><button className={`${styles.button} ${styles.buttonGhost}`} onClick={() => void load()}>Retry</button></div></div>
  if (!user) return null

  return <div className={styles.page}>
    <Link href="/admin/users" className={styles.backLink}><ArrowLeft size={15} /> Users</Link>
    <header className={styles.header}><div><p className={styles.eyebrow}>User account</p><h1 className={styles.title}>{user.displayName || user.email || 'Unnamed user'}</h1><p className={styles.description}>{user.email || user.uid}</p></div><span className={`${styles.badge} ${user.accessStatus === 'disabled' ? styles.badgeDanger : styles.badgeSuccess}`}>{user.accessStatus}</span></header>
    {error && <div className={styles.notice} role="alert">{error}</div>}
    {notice && <div className={`${styles.notice} ${styles.successNotice}`} role="status">{notice}</div>}
    <div className={styles.detailGrid}>
      <section className={styles.card}><div className={styles.cardHeader}><h2 className={styles.cardTitle}>Account details</h2></div><dl className={styles.detailList}><dt>Firebase UID</dt><dd className={styles.mono}>{user.uid}</dd><dt>Email</dt><dd>{user.email || '—'}</dd><dt>Workspace</dt><dd><Link className={styles.subtleLink} href={`/admin/workspaces/${encodeURIComponent(user.workspaceId)}`}>{user.workspaceName || user.workspaceId}</Link></dd><dt>Workspace role</dt><dd>{user.workspaceRole}</dd><dt>Platform role</dt><dd>{user.platformRole ?? 'None'}</dd><dt>Created</dt><dd>{shown(user.createdAt)}</dd><dt>Last sign-in</dt><dd>{shown(user.lastSignInAt)}</dd><dt>Updated</dt><dd>{shown(user.updatedAt)}</dd></dl></section>
      <aside className={styles.card}><div className={styles.cardHeader}><h2 className={styles.cardTitle}>Account actions</h2></div><p className={styles.description} style={{ marginBottom: 16 }}>Every action is recorded in the platform audit log.</p><div className={styles.actions}>{user.accessStatus === 'disabled' ? <button className={styles.button} disabled={!!busy} onClick={() => void action('enable')}>{busy === 'enable' ? <Loader2 size={15} className={styles.spinner} /> : <ShieldCheck size={15} />} Enable account</button> : <button className={`${styles.button} ${styles.buttonDanger}`} disabled={!!busy} onClick={() => void action('disable')}>{busy === 'disable' ? <Loader2 size={15} className={styles.spinner} /> : <ShieldOff size={15} />} Disable account</button>}<button className={`${styles.button} ${styles.buttonGhost}`} disabled={!!busy} onClick={() => void action('revoke-sessions')}>{busy === 'revoke-sessions' ? <Loader2 size={15} className={styles.spinner} /> : <LogOut size={15} />} Revoke sessions</button></div></aside>
    </div>
  </div>
}
