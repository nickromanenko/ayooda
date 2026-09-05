'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, ArrowLeft, BookOpen, Building2, LogOut, Menu, ShieldCheck, Users, X } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/components/providers/AuthProvider'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import styles from './AdminShell.module.css'

const nav = [
  { href: '/admin', label: 'Overview', icon: Activity, exact: true },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/workspaces', label: 'Workspaces', icon: Building2 },
  { href: '/admin/audit-log', label: 'Audit log', icon: ShieldCheck },
]

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const helpSlug = /^\/admin\/users\/[^/]+/.test(pathname) ? 'admin-user-detail'
    : pathname.startsWith('/admin/users') ? 'admin-users'
    : /^\/admin\/workspaces\/[^/]+/.test(pathname) ? 'admin-workspace-detail'
    : pathname.startsWith('/admin/workspaces') ? 'admin-workspaces'
    : pathname.startsWith('/admin/audit-log') ? 'admin-audit-log'
    : 'admin-overview'

  const links = nav.map((item) => {
    const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
    return (
      <Link key={item.href} href={item.href} className={styles.navLink} data-active={active} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}>
        <item.icon size={17} strokeWidth={active ? 2 : 1.6} />
        {item.label}
      </Link>
    )
  })

  return (
    <div className={`${styles.shell} dashboard-shell`}>
      <header className={styles.mobileHeader}>
        <Link href="/admin" className={styles.brand}><ShieldCheck size={20} /> Ayooda Admin</Link>
        <button type="button" className={styles.iconButton} onClick={() => setOpen(true)} aria-label="Open admin navigation"><Menu size={20} /></button>
      </header>
      <button type="button" className={styles.backdrop} data-open={open} onClick={() => setOpen(false)} aria-label="Close admin navigation" tabIndex={open ? 0 : -1} />
      <aside className={styles.sidebar} data-open={open}>
        <div className={styles.sidebarHeader}>
          <Link href="/admin" className={styles.brand}><ShieldCheck size={20} /> <span>Ayooda Admin</span></Link>
          <button type="button" className={`${styles.iconButton} ${styles.mobileClose}`} onClick={() => setOpen(false)} aria-label="Close admin navigation"><X size={20} /></button>
        </div>
        <div className={styles.adminBadge}>Platform operations</div>
        <nav className={styles.nav} aria-label="Administration">{links}</nav>
        <div className={styles.footer}>
          <Link href={`/dashboard/knowledge-base?article=${helpSlug}`} className={styles.navLink}><BookOpen size={17} /> Help for this page</Link>
          <Link href="/dashboard" className={styles.navLink}><ArrowLeft size={17} /> Back to workspace</Link>
          <ThemeToggle className="dashboard-theme-toggle" showLabel />
          <div className={styles.account} title={user?.email ?? undefined}>{user?.email ?? 'Administrator'}</div>
          <button type="button" className={styles.navButton} onClick={() => void signOut()}><LogOut size={17} /> Sign out</button>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
