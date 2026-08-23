import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/** Full-panel loading state — centered and identical everywhere it's used. */
export function Loading({ label = 'Loading…', pad = '48px 0', size = 16 }: { label?: string; pad?: string; size?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: pad, color: 'var(--ink-mute)', fontSize: 14,
      }}
    >
      <Loader2 size={size} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)', flexShrink: 0 }} />
      {label}
    </div>
  )
}

/** Consistent empty state with an optional icon and hint line. */
export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ink-mute)' }}>
      {icon && (
        <div style={{ margin: '0 auto 12px', opacity: 0.3, display: 'flex', justifyContent: 'center' }}>{icon}</div>
      )}
      <p style={{ fontSize: 13, margin: 0 }}>{title}</p>
      {hint && <p style={{ fontSize: 12, marginTop: 4, color: 'var(--ink-faint)' }}>{hint}</p>}
    </div>
  )
}
