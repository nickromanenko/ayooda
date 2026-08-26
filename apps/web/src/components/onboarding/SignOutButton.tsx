'use client'

import { LogOut } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthProvider'

export function SignOutButton() {
  const { signOut } = useAuth()
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        minHeight: 44, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
        background: 'none', border: '1px solid var(--line)',
        color: 'var(--ink-mute)', fontSize: 12, fontFamily: 'var(--font-sans)',
        transition: 'border-color .15s, color .15s, scale .15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--line-2)'
        e.currentTarget.style.color = 'var(--ink-dim)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--line)'
        e.currentTarget.style.color = 'var(--ink-mute)'
      }}
    >
      <LogOut size={13} />
      Sign out
    </button>
  )
}
