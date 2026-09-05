import type { ReactNode } from 'react'
import { Skeleton, Spinner } from '@heroui/react'
import styles from './Loading.module.css'

/** Full-panel loading state — centered and identical everywhere it's used. */
export function Loading({ label = 'Loading…', pad = '48px 0', size = 16 }: { label?: string; pad?: string; size?: number }) {
  return (
    <div role="status" aria-live="polite" className={styles.loading} style={{ padding: pad }}>
      <div className={styles.status}>
        <Spinner aria-hidden="true" className={styles.spinner} size={size <= 14 ? 'sm' : size >= 22 ? 'lg' : 'md'} />
        {label}
      </div>
      <div aria-hidden className={styles.skeletons}>
        {[72, 100, 86].map((width, index) => (
          <Skeleton animationType="shimmer" className={index === 0 ? styles.titleSkeleton : styles.cardSkeleton} key={width} style={{ width: `${width}%` }} />
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
