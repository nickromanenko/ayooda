'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  Bot,
  CreditCard,
  Settings,
  Users,
  LogOut,
} from 'lucide-react'
import { useAuth } from '@/components/providers/AuthProvider'

// Knowledge, tools, escalation rules and deployment all configure one agent, so
// they are reached through that agent's tabs rather than as siblings here.
const navItems = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard, exact: true },
  { label: 'Inbox', href: '/dashboard/inbox', icon: MessageSquare },
  { label: 'Copilot', href: '/dashboard/copilot', icon: MessagesSquare },
  { label: 'Agents', href: '/dashboard/agents', icon: Bot },
]

const bottomItems = [
  { label: 'Billing', href: '/dashboard/billing', icon: CreditCard },
  { label: 'Team', href: '/dashboard/team', icon: Users },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
]

export function Sidebar({ role }: { role: 'owner' | 'member' }) {
  const pathname = usePathname()
  const { user, signOut } = useAuth()

  // Copilot is per-member internal chat, not an owner-only admin surface — every
  // team member needs a way to reach it, same as Inbox.
  const visibleNav = role === 'owner'
    ? navItems
    : navItems.filter((i) => i.href === '/dashboard/inbox' || i.href === '/dashboard/copilot')
  const visibleBottom = role === 'owner' ? bottomItems : []

  function isActive(item: { href: string; exact?: boolean }) {
    if (item.exact) return pathname === item.href
    return pathname.startsWith(item.href)
  }

  return (
    <aside style={{
      width: 220, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--panel)',
      borderRight: '1px solid var(--line)',
      height: '100%',
    }}>
      {/* Logo */}
      <div style={{ padding: '18px 16px 16px', borderBottom: '1px solid var(--line)' }}>
        <Link href="/dashboard" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          color: 'var(--ink)', textDecoration: 'none',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="4" fill="var(--accent)" />
            <path d="M2.5 12h6M15.5 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 16 }}>Ayooda</span>
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visibleNav.map(item => {
          const active = isActive(item)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 'var(--r-sm)',
                fontSize: 13.5, fontWeight: active ? 500 : 400,
                color: active ? 'var(--ink)' : 'var(--ink-mute)',
                background: active ? 'var(--accent-soft)' : 'transparent',
                border: active ? '1px solid rgba(245,165,36,0.18)' : '1px solid transparent',
                textDecoration: 'none',
                transition: 'background .15s, color .15s',
              }}
              onMouseEnter={e => {
                if (!active) {
                  e.currentTarget.style.background = 'var(--panel-2)'
                  e.currentTarget.style.color = 'var(--ink)'
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--ink-mute)'
                }
              }}
            >
              <item.icon size={15} strokeWidth={active ? 2 : 1.5} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '8px 8px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visibleBottom.map(item => {
          const active = isActive(item)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 'var(--r-sm)',
                fontSize: 13.5, fontWeight: active ? 500 : 400,
                color: active ? 'var(--ink)' : 'var(--ink-mute)',
                background: active ? 'var(--accent-soft)' : 'transparent',
                border: active ? '1px solid rgba(245,165,36,0.18)' : '1px solid transparent',
                textDecoration: 'none',
                transition: 'background .15s, color .15s',
              }}
              onMouseEnter={e => {
                if (!active) {
                  e.currentTarget.style.background = 'var(--panel-2)'
                  e.currentTarget.style.color = 'var(--ink)'
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--ink-mute)'
                }
              }}
            >
              <item.icon size={15} strokeWidth={active ? 2 : 1.5} />
              {item.label}
            </Link>
          )
        })}

        {/* User + sign out */}
        <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 8px' }}>
            <div style={{
              width: 24, height: 24, borderRadius: 50,
              background: 'var(--accent)', display: 'grid', placeItems: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: '#1a0e08',
              flexShrink: 0,
            }}>
              {user?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.displayName ?? user?.email ?? 'Account'}
            </span>
          </div>
          <button
            onClick={signOut}
            style={{
              all: 'unset', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 'var(--r-sm)',
              fontSize: 13.5, color: 'var(--ink-mute)',
              width: '100%', boxSizing: 'border-box',
              transition: 'background .15s, color .15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--panel-2)'
              e.currentTarget.style.color = 'var(--ink)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--ink-mute)'
            }}
          >
            <LogOut size={15} strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
