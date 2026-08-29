import type { ReactNode } from 'react'
import styles from './DashboardPrimitives.module.css'

export function PageHeader({ title, description, eyebrow, action }: { title: string; description?: ReactNode; eyebrow?: string; action?: ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </header>
  )
}

export function Notice({ title, children, tone = 'error', action }: { title?: string; children: ReactNode; tone?: 'error' | 'success' | 'neutral'; action?: ReactNode }) {
  return (
    <div className={`${styles.notice} ${tone === 'error' ? styles.error : tone === 'success' ? styles.success : ''}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
      <div>{title && <strong>{title}</strong>}{children}</div>
      {action && <div className={styles.noticeAction}>{action}</div>}
    </div>
  )
}
