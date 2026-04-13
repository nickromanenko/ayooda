'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  MessageSquare,
  BookOpen,
  Bot,
  Radio,
  Settings,
  LogOut,
} from 'lucide-react'
import { useAuth } from '@/components/providers/AuthProvider'
import { cn } from '@/lib/utils'

const navItems = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard, exact: true },
  { label: 'Inbox', href: '/dashboard/inbox', icon: MessageSquare },
  { label: 'Knowledge', href: '/dashboard/knowledge', icon: BookOpen },
  { label: 'Agent', href: '/dashboard/agent', icon: Bot },
  { label: 'Channels', href: '/dashboard/channels', icon: Radio },
]

const bottomItems = [
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user, signOut } = useAuth()

  function isActive(item: { href: string; exact?: boolean }) {
    if (item.exact) return pathname === item.href
    return pathname.startsWith(item.href)
  }

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-zinc-900 text-zinc-100 h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-zinc-800">
        <span className="text-base font-semibold tracking-tight text-white">Ayooda</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              isActive(item)
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800',
            )}
          >
            <item.icon size={16} />
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-4 border-t border-zinc-800 space-y-0.5">
        {bottomItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              isActive(item)
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800',
            )}
          >
            <item.icon size={16} />
            {item.label}
          </Link>
        ))}

        {/* User + sign out */}
        <div className="pt-2 mt-2 border-t border-zinc-800">
          <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
            <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
              {user?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <span className="text-xs text-zinc-400 truncate">
              {user?.displayName ?? user?.email ?? 'Account'}
            </span>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
