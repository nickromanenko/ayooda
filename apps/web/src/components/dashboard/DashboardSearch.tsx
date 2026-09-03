'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity, Bot, CornerDownLeft, CreditCard, FileText, LayoutDashboard,
  Loader2, MessageSquare, MessagesSquare, Search, Settings, ShieldCheck,
  TestTube2, Ticket, Users, Workflow, Wrench, X,
} from 'lucide-react'
import type { AgentDoc } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import styles from './DashboardSearch.module.css'

export const DASHBOARD_SEARCH_EVENT = 'ayooda:open-search'

type Result = {
  id: string
  section: 'Navigate' | 'Agents' | 'Conversations' | 'Tickets'
  title: string
  subtitle: string
  href: string
  icon: typeof Search
}

const OWNER_PAGES: Result[] = [
  { id: 'overview', section: 'Navigate', title: 'Overview', subtitle: 'Workspace activity and launch progress', href: '/dashboard', icon: LayoutDashboard },
  { id: 'inbox', section: 'Navigate', title: 'Inbox', subtitle: 'Customer conversations and assignments', href: '/dashboard/inbox', icon: MessageSquare },
  { id: 'copilot', section: 'Navigate', title: 'Copilot', subtitle: 'Chat privately with your agents', href: '/dashboard/copilot', icon: MessagesSquare },
  { id: 'agents', section: 'Navigate', title: 'Agents', subtitle: 'Create and configure AI agents', href: '/dashboard/agents', icon: Bot },
  { id: 'channels', section: 'Navigate', title: 'Channel health', subtitle: 'Delivery status and incidents', href: '/dashboard/channels', icon: Activity },
  { id: 'billing', section: 'Navigate', title: 'Billing', subtitle: 'Plan, usage limits, and invoices', href: '/dashboard/billing', icon: CreditCard },
  { id: 'team', section: 'Navigate', title: 'Team', subtitle: 'Members and agent access', href: '/dashboard/team', icon: Users },
  { id: 'settings', section: 'Navigate', title: 'Settings', subtitle: 'Profile and workspace preferences', href: '/dashboard/settings', icon: Settings },
]

const MEMBER_PAGES = OWNER_PAGES.filter((item) => ['inbox', 'copilot'].includes(item.id))

const AGENT_AREAS = [
  { slug: '', label: 'Info', keywords: 'identity persona prompt model', icon: Bot },
  { slug: 'knowledge', label: 'Knowledge', keywords: 'documents sources indexing retrieval', icon: FileText },
  { slug: 'skills', label: 'Skills', keywords: 'memory scoring web search', icon: Wrench },
  { slug: 'tools', label: 'Tools', keywords: 'connectors actions api', icon: Wrench },
  { slug: 'mcp', label: 'MCP', keywords: 'model context protocol server', icon: Wrench },
  { slug: 'escalation', label: 'Workflows', keywords: 'routing handoff automation rules', icon: Workflow },
  { slug: 'tickets', label: 'Tickets', keywords: 'support requests webhook email intake delivery', icon: MessageSquare },
  { slug: 'test', label: 'Test', keywords: 'sandbox regression evaluations', icon: TestTube2 },
  { slug: 'deploy', label: 'Deploy', keywords: 'widget telegram email slack sms channels', icon: Activity },
  { slug: 'usage', label: 'Usage', keywords: 'analytics performance confidence metrics', icon: Activity },
  { slug: 'security', label: 'Security', keywords: 'access keys providers permissions', icon: ShieldCheck },
] as const

function conversationTitle(row: Record<string, unknown>): string {
  const direct = [row.emailReplyTo, row.smsFrom].find((value) => typeof value === 'string' && value.trim())
  if (typeof direct === 'string') return direct
  if (typeof row.slackUserId === 'string' && row.slackUserId) return `Slack ${row.slackUserId}`
  if (typeof row.telegramChatId === 'string' && row.telegramChatId) return `Telegram ${row.telegramChatId}`
  const visitor = typeof row.visitorId === 'string' ? row.visitorId : ''
  return visitor ? `Visitor ${visitor.slice(0, 8)}…` : 'Customer conversation'
}

function includesQuery(result: Pick<Result, 'title' | 'subtitle'>, query: string): boolean {
  return `${result.title} ${result.subtitle}`.toLocaleLowerCase().includes(query)
}

export default function DashboardSearch({ role, hasAgentAccess }: { role: 'owner' | 'member'; hasAgentAccess: boolean }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([])
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const agentLoadStartedRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [agents, setAgents] = useState<AgentDoc[]>([])
  const [conversationSearch, setConversationSearch] = useState<{ query: string; results: Result[] }>({ query: '', results: [] })
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [searchingQuery, setSearchingQuery] = useState('')
  const [loadError, setLoadError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const openSearch = () => {
      setOpen(true)
      if (agentLoadStartedRef.current) return
      agentLoadStartedRef.current = true
      setLoadingAgents(true)
      setLoadError('')
      void apiRequest('/agents')
        .then(async (response) => {
          if (!response.ok) throw new Error()
          const body = await response.json() as { agents?: AgentDoc[] }
          setAgents(body.agents ?? [])
        })
        .catch(() => {
          agentLoadStartedRef.current = false
          setLoadError('Agent results are temporarily unavailable. Reopen search to retry.')
        })
        .finally(() => setLoadingAgents(false))
    }
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target
      const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        openSearch()
      } else if (event.key === '/' && !isEditing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener(DASHBOARD_SEARCH_EVENT, openSearch)
    window.addEventListener('keydown', shortcut)
    return () => {
      window.removeEventListener(DASHBOARD_SEARCH_EVENT, openSearch)
      window.removeEventListener('keydown', shortcut)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    inputRef.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      restoreFocusRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    const term = query.trim()
    if (!open || term.length < 2) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      const normalized = term.toLocaleLowerCase()
      setSearchingQuery(normalized)
      setLoadError('')
      void Promise.all([
        apiRequest(`/conversations?search=${encodeURIComponent(term)}`),
        apiRequest(`/tickets?search=${encodeURIComponent(term)}`),
      ])
        .then(async ([conversationResponse, ticketResponse]) => {
          if (!conversationResponse.ok || !ticketResponse.ok) throw new Error()
          const rows = await conversationResponse.json() as Array<Record<string, unknown>>
          const ticketBody = await ticketResponse.json() as { tickets?: Array<Record<string, unknown>> }
          if (cancelled) return
          const conversations: Result[] = rows.slice(0, 5).map((row) => ({
            id: `conversation-${String(row.id)}`,
            section: 'Conversations' as const,
            title: conversationTitle(row),
            subtitle: typeof row.lastMessage === 'string' && row.lastMessage.trim() ? row.lastMessage : `Status: ${String(row.status ?? 'open')}`,
            href: `/dashboard/inbox?conversation=${encodeURIComponent(String(row.id))}`,
            icon: MessageSquare,
          }))
          const ticketResults: Result[] = (ticketBody.tickets ?? []).slice(0, 5).map((ticket) => ({
            id: `ticket-${String(ticket.id)}`,
            section: 'Tickets' as const,
            title: `#${String(ticket.number ?? '—')} · ${String(ticket.subject ?? 'Support ticket')}`,
            subtitle: `${String(ticket.status ?? 'open').replace('_', ' ')} · ${String(ticket.priority ?? 'normal')} priority`,
            href: `/dashboard/inbox?conversation=${encodeURIComponent(String(ticket.conversationId ?? ''))}`,
            icon: Ticket,
          }))
          setConversationSearch({ query: normalized, results: [...conversations, ...ticketResults] })
        })
        .catch(() => { if (!cancelled) setLoadError('Conversation and ticket results are temporarily unavailable.') })
        .finally(() => { if (!cancelled) setSearchingQuery((current) => current === normalized ? '' : current) })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, query])

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const pages = role === 'owner'
      ? OWNER_PAGES
      : [...MEMBER_PAGES, ...(hasAgentAccess ? [OWNER_PAGES.find((item) => item.id === 'agents')!] : [])]
    const navigation = normalized ? pages.filter((item) => includesQuery(item, normalized)) : pages.slice(0, 4)
    const agentResults: Result[] = []
    for (const agent of agents) {
      if (!normalized) {
        if (agentResults.length < 4) agentResults.push({
          id: `agent-${agent.id}`, section: 'Agents', title: agent.name,
          subtitle: agent.description || 'Open agent configuration', href: `/dashboard/agents/${agent.id}`, icon: Bot,
        })
        continue
      }
      for (const area of AGENT_AREAS) {
        const haystack = `${agent.name} ${agent.description} ${area.label} ${area.keywords}`.toLocaleLowerCase()
        if (!haystack.includes(normalized)) continue
        agentResults.push({
          id: `agent-${agent.id}-${area.slug || 'info'}`, section: 'Agents',
          title: area.slug ? `${agent.name} · ${area.label}` : agent.name,
          subtitle: area.slug ? `Open ${area.label.toLocaleLowerCase()} settings` : agent.description || 'Open agent configuration',
          href: `/dashboard/agents/${agent.id}${area.slug ? `/${area.slug}` : ''}`, icon: area.icon,
        })
        if (agentResults.length === 8) break
      }
      if (agentResults.length === 8) break
    }
    const conversations = normalized.length >= 2 && conversationSearch.query === normalized ? conversationSearch.results : []
    return [...navigation, ...agentResults, ...conversations]
  }, [agents, conversationSearch, hasAgentAccess, query, role])

  const safeActiveIndex = results.length ? Math.min(activeIndex, results.length - 1) : 0
  useEffect(() => {
    resultRefs.current[safeActiveIndex]?.scrollIntoView({ block: 'nearest' })
  }, [safeActiveIndex, results.length])

  function close() {
    setOpen(false)
    setQuery('')
    setConversationSearch({ query: '', results: [] })
    setSearchingQuery('')
    setLoadError('')
  }

  function choose(result: Result) {
    close()
    router.push(result.href)
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => results.length ? (value + 1) % results.length : 0); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => results.length ? (value - 1 + results.length) % results.length : 0); return }
    if (event.key === 'Enter' && results[safeActiveIndex]) { event.preventDefault(); choose(results[safeActiveIndex]); return }
    if (event.key !== 'Tab') return
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? [])
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  if (!open) return null

  let currentSection = ''
  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Search dashboard" onKeyDown={handleKeyDown}>
        <div className={styles.searchBar}>
          <Search size={19} aria-hidden />
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }} placeholder="Search agents, conversations, and settings…" aria-label="Search dashboard" aria-controls="dashboard-search-results" aria-activedescendant={results[safeActiveIndex] ? `dashboard-search-result-${safeActiveIndex}` : undefined} autoComplete="off" />
          {(loadingAgents || (Boolean(searchingQuery) && searchingQuery === query.trim().toLocaleLowerCase())) && <Loader2 className={styles.spinner} size={16} aria-label="Searching" />}
          <button type="button" className={styles.close} onClick={close} aria-label="Close search" title="Close"><X size={16} /></button>
        </div>
        <div id="dashboard-search-results" className={styles.results} role="listbox" aria-label="Search results">
          {results.map((result, index) => {
            const heading = result.section !== currentSection
            currentSection = result.section
            const Icon = result.icon
            return (
              <div key={result.id} className={styles.resultBlock}>
                {heading && <p className={styles.sectionLabel}>{result.section}</p>}
                <button
                  id={`dashboard-search-result-${index}`}
                  ref={(node) => { resultRefs.current[index] = node }}
                  type="button"
                  role="option"
                  aria-selected={index === safeActiveIndex}
                  className={styles.result}
                  data-active={index === safeActiveIndex}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => choose(result)}
                >
                  <span className={styles.resultIcon}><Icon size={16} /></span>
                  <span className={styles.resultCopy}><strong>{result.title}</strong><small>{result.subtitle}</small></span>
                  {index === safeActiveIndex && <CornerDownLeft size={14} className={styles.enterIcon} aria-hidden />}
                </button>
              </div>
            )
          })}
          {!results.length && !loadingAgents && (!searchingQuery || searchingQuery !== query.trim().toLocaleLowerCase()) && (
            <div className={styles.empty}><Search size={20} /><strong>No matching destination</strong><p>Try an agent name, customer, feature, or setting.</p></div>
          )}
          {loadError && <p className={styles.error} role="status">{loadError}</p>}
        </div>
        <footer className={styles.footer}><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></footer>
      </div>
    </div>
  )
}
