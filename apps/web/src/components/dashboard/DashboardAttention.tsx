'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, Bell, ChevronRight, Inbox, RefreshCw, Ticket, X } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import styles from './DashboardAttention.module.css'

export const DASHBOARD_ATTENTION_EVENT = 'ayooda:open-attention'

type WaitingConversation = {
  id: string
  lastMessage?: string
  emailReplyTo?: string
  smsFrom?: string
  slackUserId?: string
  telegramChatId?: string | number
  visitorId?: string
}

type ChannelHealth = {
  id: string
  agentName: string
  type: string
  status: string
  lastDetail?: string | null
  consecutiveFailures?: number
}

type FailedTicket = {
  id: string
  number: number
  subject: string
  conversationId: string
}

function customerName(row: WaitingConversation): string {
  if (row.emailReplyTo?.trim()) return row.emailReplyTo
  if (row.smsFrom?.trim()) return row.smsFrom
  if (row.slackUserId?.trim()) return `Slack ${row.slackUserId}`
  if (row.telegramChatId) return `Telegram ${row.telegramChatId}`
  return row.visitorId ? `Visitor ${row.visitorId.slice(0, 8)}…` : 'Customer conversation'
}

function channelName(type: string): string {
  return type === 'web_widget' ? 'Website widget' : type === 'sms' ? 'SMS' : type.charAt(0).toUpperCase() + type.slice(1)
}

export default function DashboardAttention({ role }: { role: 'owner' | 'member' }) {
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState<WaitingConversation[]>([])
  const [failing, setFailing] = useState<ChannelHealth[]>([])
  const [failedTickets, setFailedTickets] = useState<FailedTicket[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [conversationResponse, channelResponse, ticketResponse] = await Promise.all([
        apiRequest('/conversations?status=waiting'),
        role === 'owner' ? apiRequest('/channels/reliability') : Promise.resolve(null),
        role === 'owner' ? apiRequest('/tickets?deliveryState=failed') : Promise.resolve(null),
      ])
      if (!conversationResponse.ok || (channelResponse && !channelResponse.ok) || (ticketResponse && !ticketResponse.ok)) throw new Error()
      const conversations = await conversationResponse.json() as WaitingConversation[]
      const channelBody = channelResponse ? await channelResponse.json() as { channels?: ChannelHealth[] } : null
      const ticketBody = ticketResponse ? await ticketResponse.json() as { tickets?: FailedTicket[] } : null
      setWaiting(conversations)
      setFailing((channelBody?.channels ?? []).filter((channel) => channel.status === 'failing'))
      setFailedTickets(ticketBody?.tickets ?? [])
    } catch {
      setError('The latest attention items could not be loaded. Your existing conversations are unaffected.')
    } finally {
      setLoading(false)
    }
  }, [role])

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(DASHBOARD_ATTENTION_EVENT, show)
    return () => window.removeEventListener(DASHBOARD_ATTENTION_EVENT, show)
  }, [])

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    void load()
    return () => {
      document.body.style.overflow = overflow
      restoreFocusRef.current?.focus()
    }
  }, [load, open])

  function close() {
    setOpen(false)
    setError('')
  }

  function visit(href: string) {
    close()
    router.push(href)
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Tab') return
    const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  if (!open) return null

  const total = waiting.length + failing.length + failedTickets.length
  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="attention-title" onKeyDown={handleKeyDown}>
        <header className={styles.header}>
          <span className={styles.titleIcon}><Bell size={18} /></span>
          <div><h2 id="attention-title">Needs attention</h2><p>Live items that may need a teammate.</p></div>
          <button type="button" className={styles.iconButton} onClick={() => void load()} disabled={loading} aria-label="Refresh attention items" title="Refresh"><RefreshCw size={16} data-spinning={loading} /></button>
          <button ref={closeRef} type="button" className={styles.iconButton} onClick={close} aria-label="Close attention center" title="Close"><X size={17} /></button>
        </header>

        <div className={styles.content} aria-live="polite" aria-busy={loading}>
          {error && <div className={styles.error} role="status"><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>}

          {!error && waiting.length > 0 && <section className={styles.section} aria-labelledby="waiting-heading">
            <div className={styles.sectionHeading}><div><Inbox size={15} /><h3 id="waiting-heading">Waiting conversations</h3></div><span>{waiting.length}</span></div>
            <div className={styles.items}>{waiting.slice(0, 20).map((conversation) => (
              <button type="button" className={styles.item} key={conversation.id} onClick={() => visit(`/dashboard/inbox?conversation=${encodeURIComponent(conversation.id)}`)}>
                <span className={styles.itemIcon}><Inbox size={15} /></span>
                <span className={styles.itemCopy}><strong>{customerName(conversation)}</strong><small>{conversation.lastMessage?.trim() || 'Waiting for a teammate to respond.'}</small></span>
                <ChevronRight size={15} aria-hidden />
              </button>
            ))}</div>
          </section>}

          {!error && failing.length > 0 && <section className={styles.section} aria-labelledby="channels-heading">
            <div className={styles.sectionHeading}><div><Activity size={15} /><h3 id="channels-heading">Channel failures</h3></div><span>{failing.length}</span></div>
            <div className={styles.items}>{failing.map((channel) => (
              <button type="button" className={styles.item} key={channel.id} onClick={() => visit(`/dashboard/channels#channel-${encodeURIComponent(channel.id)}`)}>
                <span className={styles.itemIcon} data-danger="true"><Activity size={15} /></span>
                <span className={styles.itemCopy}><strong>{channel.agentName} · {channelName(channel.type)}</strong><small>{channel.lastDetail || `${channel.consecutiveFailures ?? 1} consecutive delivery failure${channel.consecutiveFailures === 1 ? '' : 's'}.`}</small></span>
                <ChevronRight size={15} aria-hidden />
              </button>
            ))}</div>
          </section>}

          {!error && failedTickets.length > 0 && <section className={styles.section} aria-labelledby="tickets-heading">
            <div className={styles.sectionHeading}><div><Ticket size={15} /><h3 id="tickets-heading">Ticket delivery failures</h3></div><span>{failedTickets.length}</span></div>
            <div className={styles.items}>{failedTickets.map((ticket) => (
              <button type="button" className={styles.item} key={ticket.id} onClick={() => visit(`/dashboard/inbox?conversation=${encodeURIComponent(ticket.conversationId)}`)}>
                <span className={styles.itemIcon} data-danger="true"><Ticket size={15} /></span>
                <span className={styles.itemCopy}><strong>#{ticket.number} · {ticket.subject}</strong><small>The ticket is safe in Ayooda. External delivery needs attention.</small></span>
                <ChevronRight size={15} aria-hidden />
              </button>
            ))}</div>
          </section>}

          {!error && !loading && total === 0 && <div className={styles.empty}><span><Bell size={21} /></span><h3>Nothing needs attention</h3><p>Waiting conversations, channel failures, and ticket delivery issues will appear here.</p></div>}
          {!error && loading && total === 0 && <div className={styles.loading}><RefreshCw size={20} data-spinning="true" /><span>Checking your workspace…</span></div>}
        </div>

        <footer className={styles.footer}><span>{total ? `${total} open item${total === 1 ? '' : 's'}` : 'Workspace clear'}</span><button type="button" onClick={() => visit('/dashboard/inbox')}>Open inbox</button></footer>
      </div>
    </div>
  )
}
