'use client'

import { Clock3, Hash, Mail, MessageSquare, Phone, X } from 'lucide-react'
import styles from '@/app/dashboard/inbox/page.module.css'

export type InboxTimestamp = string | { _seconds?: number; seconds?: number } | null

export interface InboxCustomerContext {
  customer: { label: string; email: string | null; phone: string | null; externalId: string }
  channelType: string | null
  conversationCount: number
  truncated: boolean
  firstSeenAt: InboxTimestamp
  lastSeenAt: InboxTimestamp
  recentConversations: Array<{ id: string; status: string; lastMessage: string; updatedAt: InboxTimestamp }>
}

function dateValue(value: InboxTimestamp): Date | null {
  if (!value) return null
  const date = typeof value === 'string'
    ? new Date(value)
    : new Date((value._seconds ?? value.seconds ?? 0) * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(value: InboxTimestamp): string {
  const date = dateValue(value)
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : '—'
}

function channelName(value: string | null): string {
  return value === 'web_widget' ? 'Website widget' : value === 'sms' ? 'SMS' : value ? value[0]!.toUpperCase() + value.slice(1) : 'Unknown channel'
}

export default function InboxCustomerDrawer({
  open,
  context,
  loading,
  error,
  selectedId,
  onClose,
  onRetry,
  onSelectConversation,
}: {
  open: boolean
  context: InboxCustomerContext | null
  loading: boolean
  error: string
  selectedId: string
  onClose: () => void
  onRetry: () => void
  onSelectConversation: (id: string) => void
}) {
  return (
    <aside className={styles.customerDrawer} data-open={open} aria-hidden={!open} inert={!open} aria-label="Customer details">
      <div className={styles.drawerTitleRow}>
        <div>
          <p className={styles.drawerEyebrow}>Customer</p>
          <h2 className={styles.drawerTitle}>{context?.customer.label ?? 'Customer details'}</h2>
        </div>
        <button type="button" className={styles.drawerClose} aria-label="Close customer details" onClick={onClose}><X size={17} /></button>
      </div>

      {loading ? <div className={styles.drawerState}>Loading customer history…</div> : error ? (
        <div className={styles.drawerState} role="alert">{error}<button type="button" className="btn btn-ghost" onClick={onRetry}>Retry</button></div>
      ) : context ? (
        <div className={styles.drawerContent}>
          <dl className={styles.customerFacts}>
            {context.customer.email && <div><dt><Mail size={13} /> Email</dt><dd>{context.customer.email}</dd></div>}
            {context.customer.phone && <div><dt><Phone size={13} /> Phone</dt><dd>{context.customer.phone}</dd></div>}
            <div><dt><MessageSquare size={13} /> Channel</dt><dd>{channelName(context.channelType)}</dd></div>
            <div><dt><Clock3 size={13} /> First seen</dt><dd>{formatDate(context.firstSeenAt)}</dd></div>
            <div><dt><Hash size={13} /> Conversations</dt><dd>{context.conversationCount}{context.truncated ? '+' : ''}</dd></div>
          </dl>

          <div className={styles.drawerSection}>
            <p className={styles.drawerSectionTitle}>Customer ID</p>
            <code className={styles.customerId}>{context.customer.externalId}</code>
          </div>

          <div className={styles.drawerSection}>
            <p className={styles.drawerSectionTitle}>Recent conversations</p>
            <div className={styles.customerHistory}>
              {context.recentConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  aria-current={conversation.id === selectedId ? 'true' : undefined}
                  className={styles.historyItem}
                  data-active={conversation.id === selectedId}
                  onClick={() => onSelectConversation(conversation.id)}
                >
                  <span>{conversation.lastMessage || 'New conversation'}</span>
                  <small>{conversation.status} · {formatDate(conversation.updatedAt)}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
