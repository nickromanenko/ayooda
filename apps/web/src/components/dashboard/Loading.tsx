import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/** Full-panel loading state — centered and identical everywhere it's used. */
export function Loading({ label = 'Loading…', pad = '48px 0', size = 16 }: { label?: string; pad?: string; size?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        width: '100%', maxWidth: 880, margin: '0 auto', padding: pad,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-mute)', fontSize: 13, marginBottom: 16 }}>
        <Loader2 size={size} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-text)', flexShrink: 0 }} />
        {label}
      </div>
      <div aria-hidden style={{ display: 'grid', gap: 10 }}>
        {[72, 100, 86].map((width, index) => (
          <span key={width} style={{ display: 'block', width: `${width}%`, height: index === 0 ? 18 : 52, borderRadius: index === 0 ? 8 : 14, background: 'linear-gradient(100deg, var(--panel-2) 25%, var(--panel) 45%, var(--panel-2) 65%)', backgroundSize: '220% 100%', animation: 'dashboard-shimmer 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  )
}

/** Consistent empty state with an optional icon and hint line. */
export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ink-mute)' }}>
      {icon && (
        <div style={{ margin: '0 auto 12px', opacity: 0.3, display: 'flex', justifyContent: 'center' }}>{icon}</div>
      )}
      <p style={{ fontSize: 13, margin: 0 }}>{title}</p>
      {hint && <p style={{ maxWidth: 420, margin: '5px auto 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-faint)' }}>{hint}</p>}
      {action && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>{action}</div>}
    </div>
  )
}
