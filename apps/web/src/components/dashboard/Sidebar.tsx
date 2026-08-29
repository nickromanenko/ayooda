'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  Bot,
  CreditCard,
  Settings,
  Activity,
  Users,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
} from 'lucide-react'
import { useAuth } from '@/components/providers/AuthProvider'
import { useWorkspace } from '@/hooks/useWorkspace'
import { apiRequest } from '@/lib/api'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import styles from './Sidebar.module.css'

// Knowledge, tools, escalation rules and deployment all configure one agent, so
// they are reached through that agent's tabs rather than as siblings here.
const navItems = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard, exact: true },
  { label: 'Inbox', href: '/dashboard/inbox', icon: MessageSquare, badge: 'inbox' as const },
  { label: 'Copilot', href: '/dashboard/copilot', icon: MessagesSquare },
  { label: 'Agents', href: '/dashboard/agents', icon: Bot },
]

const bottomItems = [
  { label: 'Channel health', href: '/dashboard/channels', icon: Activity, badge: 'channels' as const },
  { label: 'Billing', href: '/dashboard/billing', icon: CreditCard },
  { label: 'Team', href: '/dashboard/team', icon: Users },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
]

const STORAGE_KEY = 'ayooda.sidebar.collapsed'

// A tiny external store so the collapsed flag can be read during render
// (no hydration mismatch), and stays in sync across tabs.
let collapsedListeners: Array<() => void> = []
function subscribeCollapsed(cb: () => void) {
  collapsedListeners.push(cb)
  window.addEventListener('storage', cb)
  return () => {
    collapsedListeners = collapsedListeners.filter((l) => l !== cb)
    window.removeEventListener('storage', cb)
  }
}
function getCollapsedSnapshot(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}
function getCollapsedServerSnapshot(): boolean {
  return false
}
function setCollapsedPersisted(next: boolean) {
  try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ }
  collapsedListeners.forEach((l) => l())
}

export function Sidebar({ role, hasAgentAccess = false }: { role: 'owner' | 'member'; hasAgentAccess?: boolean }) {
  const pathname = usePathname()
  const { user, signOut } = useAuth()
  const { workspace } = useWorkspace()
  const collapsed = useSyncExternalStore(subscribeCollapsed, getCollapsedSnapshot, getCollapsedServerSnapshot)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [badges, setBadges] = useState({ inbox: 0, channels: 0 })

  useEffect(() => {
    if (!workspace?.id) return
    let cancelled = false
    const refresh = async () => {
      try {
        const [inboxRes, channelsRes] = await Promise.all([
          apiRequest('/conversations?status=waiting'),
          apiRequest('/channels/reliability'),
        ])
        const inboxBody = inboxRes.ok ? await inboxRes.json() as unknown[] : null
        const channelsBody = channelsRes.ok ? await channelsRes.json() as { summary?: { failing?: number } } : null
        if (!cancelled) setBadges({ inbox: inboxBody?.length ?? 0, channels: channelsBody?.summary?.failing ?? 0 })
      } catch { /* badges are supplementary; navigation still works without them */ }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [workspace?.id])

  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  function toggleCollapsed() {
    setCollapsedPersisted(!getCollapsedSnapshot())
  }

  // Copilot is per-member internal chat, not an owner-only admin surface — every
  // team member needs a way to reach it, same as Inbox.
  const visibleNav = role === 'owner'
    ? navItems
    : navItems.filter((i) =>
        i.href === '/dashboard/inbox' ||
        i.href === '/dashboard/copilot' ||
        // Members see Agents only once they hold at least one; otherwise the
        // link would lead to an empty list.
        (i.href === '/dashboard/agents' && hasAgentAccess))
  const visibleBottom = role === 'owner' ? bottomItems : []

  function isActive(item: { href: string; exact?: boolean }) {
    if (item.exact) return pathname === item.href
    return pathname.startsWith(item.href)
  }

  const itemStyle = (active: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start',
    gap: 10, padding: collapsed ? '10px 0' : '8px 12px', borderRadius: 'var(--r-sm)',
    fontSize: 13.5, fontWeight: active ? 500 : 400,
    color: active ? 'var(--control-selected-text)' : 'var(--ink-mute)',
    background: active ? 'var(--control-selected)' : 'transparent',
    border: '1px solid transparent',
    textDecoration: 'none', transitionProperty: 'background-color, color', transitionDuration: '150ms', transitionTimingFunction: 'ease-out',
  })

  const hoverIn = (e: React.MouseEvent<HTMLElement>, active: boolean) => {
    if (active) return
    e.currentTarget.style.background = 'var(--panel-2)'
    e.currentTarget.style.color = 'var(--ink)'
  }
  const hoverOut = (e: React.MouseEvent<HTMLElement>, active: boolean) => {
    if (active) return
    e.currentTarget.style.background = 'transparent'
    e.currentTarget.style.color = 'var(--ink-mute)'
  }

  const badgeCount = (item: { badge?: 'inbox' | 'channels' }) => item.badge ? badges[item.badge] : 0

  const renderLink = (item: { label: string; href: string; icon: typeof LayoutDashboard; exact?: boolean; badge?: 'inbox' | 'channels' }) => {
    const active = isActive(item)
    const count = badgeCount(item)
    const accessibleLabel = count > 0 ? `${item.label}, ${count} ${item.badge === 'inbox' ? 'waiting' : 'need attention'}` : item.label
    return (
      <Link
        key={item.href}
        href={item.href}
        className={styles.desktopNavLink}
        data-tooltip={collapsed ? accessibleLabel : undefined}
        aria-label={accessibleLabel}
        aria-current={active ? 'page' : undefined}
        style={itemStyle(active)}
        onMouseEnter={(e) => hoverIn(e, active)}
        onMouseLeave={(e) => hoverOut(e, active)}
      >
        <item.icon size={15} strokeWidth={active ? 2 : 1.5} style={{ flexShrink: 0 }} />
        {!collapsed && item.label}
        {count > 0 && <span className={styles.navBadge} data-collapsed={collapsed}>{collapsed ? '' : count > 99 ? '99+' : count}</span>}
      </Link>
    )
  }

  const accountName = user?.displayName ?? user?.email ?? 'Account'

  const mobileLink = (item: { label: string; href: string; icon: typeof LayoutDashboard; exact?: boolean; badge?: 'inbox' | 'channels' }) => {
    const active = isActive(item)
    const count = badgeCount(item)
    return (
      <Link key={item.href} href={item.href} className={styles.mobileNavLink} data-active={active} aria-current={active ? 'page' : undefined} onClick={() => setMobileOpen(false)}>
        <item.icon size={18} strokeWidth={active ? 2 : 1.5} />
        {item.label}
        {count > 0 && <span className={styles.navBadge}>{count > 99 ? '99+' : count}</span>}
      </Link>
    )
  }

  return (
    <>
    <header className={styles.mobileHeader}>
      <Link href="/dashboard" className={styles.mobileLogo} aria-label="Ayooda dashboard">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="4" fill="var(--accent)" />
          <path d="M2.5 12h6M15.5 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Ayooda
      </Link>
      <button type="button" className={styles.menuButton} aria-label="Open dashboard navigation" aria-expanded={mobileOpen} aria-controls="dashboard-mobile-drawer" onClick={() => setMobileOpen(true)}>
        <Menu size={20} />
      </button>
    </header>

    <button type="button" className={styles.mobileBackdrop} data-open={mobileOpen} aria-label="Close dashboard navigation" tabIndex={mobileOpen ? 0 : -1} onClick={() => setMobileOpen(false)} />
    <aside id="dashboard-mobile-drawer" className={styles.mobileDrawer} data-open={mobileOpen} aria-hidden={!mobileOpen}>
      <div className={styles.drawerHeader}>
        <span className={styles.mobileLogo}>Menu</span>
        <button type="button" className={styles.closeButton} aria-label="Close dashboard navigation" onClick={() => setMobileOpen(false)}>
          <X size={20} />
        </button>
      </div>
      <nav className={styles.mobileNav} aria-label="Dashboard navigation">
        {visibleNav.map(mobileLink)}
        {visibleBottom.map(mobileLink)}
      </nav>
      <div className={styles.mobileFooter}>
        <ThemeToggle className="dashboard-theme-toggle" showLabel />
        <div className={styles.mobileAccount} title={accountName}>{accountName}</div>
        <button type="button" className={styles.mobileAction} onClick={() => void signOut()}>
          <LogOut size={18} /> Sign out
        </button>
      </div>
    </aside>

    <aside className={styles.desktopSidebar} style={{
      width: collapsed ? 64 : 220, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--panel)',
      borderRight: '1px solid var(--line)',
      height: '100%',
      transition: 'width .2s ease',
    }}>
      {/* Logo */}
      <div style={{
        padding: collapsed ? '18px 0 16px' : '18px 16px 16px',
        borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <Link href="/dashboard" title="Ayooda" aria-label="Ayooda" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          color: 'var(--ink)', textDecoration: 'none',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="4" fill="var(--accent)" />
            <path d="M2.5 12h6M15.5 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {!collapsed && <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 16 }}>Ayooda</span>}
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visibleNav.map(renderLink)}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '8px 8px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!collapsed && <p className={styles.navSectionLabel}>Workspace</p>}
        {visibleBottom.map(renderLink)}

        <ThemeToggle className="dashboard-theme-toggle" showLabel={!collapsed} />

        {/* User + sign out */}
        <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <div
            title={collapsed ? accountName : undefined}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 8, padding: collapsed ? '6px 0 8px' : '6px 12px 8px',
            }}
          >
            <div style={{
              width: 24, height: 24, borderRadius: 50,
              background: 'var(--control-primary)', display: 'grid', placeItems: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--control-primary-text)',
              flexShrink: 0,
            }}>
              {user?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            {!collapsed && (
              <span style={{ fontSize: 12.5, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {accountName}
              </span>
            )}
          </div>
          <button
            onClick={signOut}
            title={collapsed ? 'Sign out' : undefined}
            aria-label="Sign out"
            style={{
              all: 'unset', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 10, padding: collapsed ? '8px 0' : '8px 12px', borderRadius: 'var(--r-sm)',
              fontSize: 13.5, color: 'var(--ink-mute)',
              width: '100%', boxSizing: 'border-box',
              transitionProperty: 'background-color, color', transitionDuration: '150ms', transitionTimingFunction: 'ease-out',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-2)'; e.currentTarget.style.color = 'var(--ink)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-mute)' }}
          >
            <LogOut size={15} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            {!collapsed && 'Sign out'}
          </button>
        </div>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            all: 'unset', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 10, padding: collapsed ? '10px 0' : '10px 12px', borderRadius: 'var(--r-sm)',
            fontSize: 13.5, color: 'var(--ink-mute)',
            width: '100%', boxSizing: 'border-box',
            transitionProperty: 'background-color, color', transitionDuration: '150ms', transitionTimingFunction: 'ease-out',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-2)'; e.currentTarget.style.color = 'var(--ink)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-mute)' }}
        >
          {collapsed
            ? <PanelLeftOpen size={15} strokeWidth={1.5} />
            : <><PanelLeftClose size={15} strokeWidth={1.5} style={{ flexShrink: 0 }} /> Collapse</>}
        </button>
      </div>
    </aside>
    </>
  )
}
