'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  collection, query, orderBy, onSnapshot, Timestamp, limit, limitToLast,
  doc, getDocs, startAfter, endBefore, type DocumentData, type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { ArrowLeft, Bot, Contact, Loader2, MessageSquare, Search, Send, StickyNote, Ticket, User, X } from 'lucide-react'
import { db } from '@/lib/firebase'
import { apiRequest, apiRequestOrThrow } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'
import MarkdownMessage from '@/components/dashboard/MarkdownMessage'
import InboxCustomerDrawer, { type InboxCustomerContext } from '@/components/dashboard/InboxCustomerDrawer'
import InboxTicketPanel from '@/components/dashboard/InboxTicketPanel'
import { AppSelect } from '@/components/ui/AppSelect'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useAuth } from '@/components/providers/AuthProvider'
import styles from './page.module.css'

interface Conversation {
  id: string
  channelId: string
  agentId?: string | null
  visitorId: string
  status: 'bot' | 'waiting' | 'human' | 'resolved'
  operatorId: string | null
  escalationReason?: string
  lastMessage: string
  updatedAt: Timestamp | null
  createdAt: Timestamp | null
  score?: number
  summary?: string
  unread?: boolean
  emailReplyTo?: string
  smsFrom?: string
  slackUserId?: string
  telegramChatId?: number
  channelType?: string
  ticketId?: string
  ticketNumber?: number
  customerName?: string
  customerEmail?: string
  customerExternalId?: string
  customerVerified?: boolean
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'operator'
  content: string
  createdAt: Timestamp | null
}

interface InternalNote {
  id: string
  content: string
  authorId: string
  authorName: string
  createdAt: Timestamp | null
}

interface Operator {
  uid: string
  displayName: string
  email: string
  role: string
}

type InboxFilter = 'all' | 'unread' | 'mine' | 'tickets' | 'waiting' | 'human' | 'bot' | 'resolved'

const INBOX_FILTERS: readonly InboxFilter[] = ['all', 'unread', 'mine', 'tickets', 'waiting', 'human', 'bot', 'resolved']

function isInboxFilter(value: string | null): value is InboxFilter {
  return value !== null && INBOX_FILTERS.includes(value as InboxFilter)
}

const STATUS_STYLE: Record<Conversation['status'], React.CSSProperties> = {
  bot: { background: 'var(--accent-soft)', color: 'var(--accent-text)' },
  waiting: { background: 'rgba(239,68,68,0.15)', color: 'var(--danger)' },
  human: { background: 'rgba(245,165,36,0.18)', color: 'var(--accent-2)' },
  resolved: { background: 'var(--panel-2)', color: 'var(--ink-mute)' },
}

const CONVERSATION_PAGE_SIZE = 50
const MESSAGE_PAGE_SIZE = 100

function formatTime(ts: Timestamp | null): string {
  if (!ts) return ''
  const date = ts.toDate()
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString()
}

function normalizeTimestamp(value: unknown): Timestamp | null {
  if (value instanceof Timestamp) return value
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date)
  }
  if (value && typeof value === 'object') {
    const raw = value as { _seconds?: number; seconds?: number }
    const seconds = raw._seconds ?? raw.seconds
    if (typeof seconds === 'number') return Timestamp.fromMillis(seconds * 1000)
  }
  return null
}

function normalizeConversation(value: Record<string, unknown>): Conversation {
  return {
    ...value,
    id: String(value.id),
    channelId: String(value.channelId ?? ''),
    visitorId: String(value.visitorId ?? ''),
    status: value.status as Conversation['status'],
    operatorId: typeof value.operatorId === 'string' ? value.operatorId : null,
    lastMessage: String(value.lastMessage ?? ''),
    createdAt: normalizeTimestamp(value.createdAt),
    updatedAt: normalizeTimestamp(value.updatedAt),
  } as Conversation
}

function conversationLabel(conversation: Conversation): string {
  if (conversation.customerName) return conversation.customerName
  if (conversation.customerEmail) return conversation.customerEmail
  if (conversation.emailReplyTo) return conversation.emailReplyTo
  if (conversation.smsFrom) return conversation.smsFrom
  if (conversation.slackUserId) return `Slack ${conversation.slackUserId}`
  if (conversation.telegramChatId) return `Telegram ${conversation.telegramChatId}`
  return `Visitor ${conversation.visitorId.slice(0, 8)}…`
}

export default function InboxPage() {
  const { workspace, loading: wsLoading } = useWorkspace()
  const { user } = useAuth()
  const [liveConversations, setLiveConversations] = useState<Conversation[]>([])
  const [olderConversations, setOlderConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [liveMessages, setLiveMessages] = useState<Message[]>([])
  const [olderMessages, setOlderMessages] = useState<Message[]>([])
  const [notes, setNotes] = useState<InternalNote[]>([])
  const [reply, setReply] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [composerMode, setComposerMode] = useState<'reply' | 'note'>('reply')
  const [sending, setSending] = useState(false)
  const [sendingNote, setSendingNote] = useState(false)
  const [takingOver, setTakingOver] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [actionError, setActionError] = useState('')
  const [realtimeError, setRealtimeError] = useState('')
  const [subscriptionVersion, setSubscriptionVersion] = useState(0)
  const [hasOlderConversations, setHasOlderConversations] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlderConversations, setLoadingOlderConversations] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [operators, setOperators] = useState<Operator[]>([])
  const [customerContext, setCustomerContext] = useState<InboxCustomerContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState('')
  const [customerOpen, setCustomerOpen] = useState(false)
  // Which agent answered. Sourced from /copilot/agents rather than /agents,
  // because the Inbox is open to members and /agents is owner-only.
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const markingReadRef = useRef<Set<string>>(new Set())
  const conversationCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)
  const messageCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)

  function updateFilterUrl(nextFilter: InboxFilter, nextAgentId: string) {
    const url = new URL(window.location.href)
    if (nextFilter === 'all') url.searchParams.delete('status')
    else url.searchParams.set('status', nextFilter)
    if (nextAgentId === 'all') url.searchParams.delete('agentId')
    else url.searchParams.set('agentId', nextAgentId)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  function changeFilter(nextFilter: InboxFilter) {
    setFilter(nextFilter)
    updateFilterUrl(nextFilter, agentFilter)
  }

  function changeAgentFilter(nextAgentId: string) {
    setAgentFilter(nextAgentId)
    updateFilterUrl(filter, nextAgentId)
  }

  function clearSearchAndFilters() {
    setSearchInput('')
    setFilter('all')
    setAgentFilter('all')
    updateFilterUrl('all', 'all')
  }

  const workspaceId = workspace?.id
  const conversations = useMemo(() => {
    const merged = new Map<string, Conversation>()
    for (const item of [...olderConversations, ...liveConversations]) merged.set(item.id, item)
    return [...merged.values()].sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0))
  }, [liveConversations, olderConversations])
  const messages = useMemo(() => {
    const merged = new Map<string, Message>()
    for (const item of [...olderMessages, ...liveMessages]) merged.set(item.id, item)
    return [...merged.values()].sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))
  }, [liveMessages, olderMessages])
  const selectedConv = conversations.find((conversation) => conversation.id === selectedId)
  const timeline = useMemo(() => [
    ...messages.map((message) => ({ kind: 'message' as const, item: message })),
    ...notes.map((note) => ({ kind: 'note' as const, item: note })),
  ].sort((a, b) => (a.item.createdAt?.toMillis() ?? 0) - (b.item.createdAt?.toMillis() ?? 0)), [messages, notes])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const linkedFilter = params.get('status')
    const linkedAgent = params.get('agentId')
    if (isInboxFilter(linkedFilter)) setFilter(linkedFilter)
    if (linkedAgent) setAgentFilter(linkedAgent)
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([apiRequest('/copilot/agents'), apiRequest('/conversations/operators')])
      .then(async ([agentResponse, operatorResponse]) => {
        if (cancelled) return
        if (agentResponse.ok) {
          const data = await agentResponse.json() as { agents: { id: string; name: string }[] }
          setAgents(data.agents)
        }
        if (operatorResponse.ok) {
          const data = await operatorResponse.json() as { operators: Operator[] }
          setOperators(data.operators)
        }
      })
      .catch(() => { /* identity labels are supplementary; the queue still works */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const term = searchInput.trim()
    if (!term) { setSearchResults(null); setSearching(false); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      void apiRequest(`/conversations?search=${encodeURIComponent(term)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error('Search failed')
          const data = await response.json() as Array<Record<string, unknown>>
          if (!cancelled) setSearchResults(data.map(normalizeConversation))
        })
        .catch(() => { if (!cancelled) setRealtimeError('Conversation search could not be completed.') })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [searchInput])

  // Overview and customer-history links can open a conversation outside the
  // current realtime page. Load that exact row once, then let normal listeners
  // take over messages and updates.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('conversation')
    if (!id) return
    let cancelled = false
    void apiRequest(`/conversations/${encodeURIComponent(id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Conversation not found')
        const conversation = normalizeConversation(await response.json() as Record<string, unknown>)
        if (!cancelled) {
          setOlderConversations((current) => current.some((row) => row.id === conversation.id) ? current : [conversation, ...current])
          setSelectedId(conversation.id)
        }
      })
      .catch(() => { if (!cancelled) setRealtimeError('The linked conversation could not be loaded.') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!workspaceId) return
    setOlderConversations([]); setRealtimeError('')
    const q = query(
      collection(db, `workspaces/${workspaceId}/conversations`),
      orderBy('updatedAt', 'desc'),
      limit(CONVERSATION_PAGE_SIZE + 1),
    )
    const unsub = onSnapshot(q, (snap) => {
      const page = snap.docs.slice(0, CONVERSATION_PAGE_SIZE)
      conversationCursorRef.current = page.at(-1) ?? null
      setHasOlderConversations(snap.docs.length > CONVERSATION_PAGE_SIZE)
      setLiveConversations(page.map((d) => ({ id: d.id, ...d.data() } as Conversation)))
      setRealtimeError('')
    }, () => setRealtimeError('Live conversations could not be loaded. Check your connection and try again.'))
    return unsub
  }, [workspaceId, subscriptionVersion])

  useEffect(() => {
    if (!workspaceId || !selectedId) { setLiveMessages([]); setOlderMessages([]); return }
    setOlderMessages([]); setActionError('')
    const q = query(
      collection(db, `workspaces/${workspaceId}/conversations/${selectedId}/messages`),
      orderBy('createdAt', 'asc'),
      limitToLast(MESSAGE_PAGE_SIZE + 1),
    )
    const unsub = onSnapshot(q, (snap) => {
      const page = snap.docs.slice(-MESSAGE_PAGE_SIZE)
      messageCursorRef.current = page[0] ?? null
      setHasOlderMessages(snap.docs.length > MESSAGE_PAGE_SIZE)
      setLiveMessages(page.map((d) => ({ id: d.id, ...d.data() } as Message)))
      setRealtimeError('')
    }, () => setRealtimeError('Messages could not be updated. Check your connection and try again.'))
    return unsub
  }, [workspaceId, selectedId, subscriptionVersion])

  useEffect(() => {
    if (!workspaceId || !selectedId) return
    return onSnapshot(doc(db, `workspaces/${workspaceId}/conversations/${selectedId}`), (snapshot) => {
      if (!snapshot.exists()) return
      const conversation = { id: snapshot.id, ...snapshot.data() } as Conversation
      setOlderConversations((current) => [conversation, ...current.filter((row) => row.id !== conversation.id)])
    }, () => setRealtimeError('This conversation could not be updated.'))
  }, [workspaceId, selectedId, subscriptionVersion])

  useEffect(() => {
    if (!workspaceId || !selectedId) { setNotes([]); return }
    const notesQuery = query(
      collection(db, `workspaces/${workspaceId}/conversations/${selectedId}/notes`),
      orderBy('createdAt', 'asc'),
      limitToLast(50),
    )
    const unsubscribe = onSnapshot(notesQuery, (snapshot) => {
      setNotes(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as InternalNote)))
    }, () => setRealtimeError('Internal notes could not be updated.'))
    return unsubscribe
  }, [workspaceId, selectedId, subscriptionVersion])

  useEffect(() => {
    if (!selectedId) return
    setComposerMode('reply'); setReply(''); setNoteDraft(''); setCustomerContext(null); setContextError('')
    setContextLoading(true)
    let cancelled = false
    void apiRequest(`/conversations/${encodeURIComponent(selectedId)}/context`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as InboxCustomerContext & { error?: string }
        if (!response.ok) throw new Error(data.error ?? 'Could not load customer details.')
        if (!cancelled) setCustomerContext(data)
      })
      .catch((caught) => { if (!cancelled) setContextError(caught instanceof Error ? caught.message : 'Could not load customer details.') })
      .finally(() => { if (!cancelled) setContextLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  useEffect(() => {
    if (!selectedId || !selectedConv?.unread || markingReadRef.current.has(selectedId)) return
    markingReadRef.current.add(selectedId)
    setLiveConversations((current) => current.map((conversation) => conversation.id === selectedId ? { ...conversation, unread: false } : conversation))
    setOlderConversations((current) => current.map((conversation) => conversation.id === selectedId ? { ...conversation, unread: false } : conversation))
    setSearchResults((current) => current?.map((conversation) => conversation.id === selectedId ? { ...conversation, unread: false } : conversation) ?? null)
    void apiRequest(`/conversations/${encodeURIComponent(selectedId)}/read`, { method: 'POST' })
      .catch(() => {})
      .finally(() => markingReadRef.current.delete(selectedId))
  }, [selectedId, selectedConv?.unread])

  async function openConversation(id: string) {
    if (!conversations.some((conversation) => conversation.id === id)) {
      try {
        const response = await apiRequestOrThrow(`/conversations/${encodeURIComponent(id)}`, {}, 'Could not load this conversation.')
        const conversation = normalizeConversation(await response.json() as Record<string, unknown>)
        setOlderConversations((current) => current.some((row) => row.id === id) ? current : [conversation, ...current])
      } catch (caught) {
        setRealtimeError(caught instanceof Error ? caught.message : 'Could not load this conversation.')
        return
      }
    }
    setSelectedId(id)
    setCustomerOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.set('conversation', id)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  function closeConversation() {
    setSelectedId(null); setCustomerOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('conversation')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  async function retryCustomerContext() {
    if (!selectedId) return
    setContextLoading(true); setContextError('')
    try {
      const response = await apiRequestOrThrow(`/conversations/${encodeURIComponent(selectedId)}/context`, {}, 'Could not load customer details.')
      setCustomerContext(await response.json() as InboxCustomerContext)
    } catch (caught) {
      setContextError(caught instanceof Error ? caught.message : 'Could not load customer details.')
    } finally { setContextLoading(false) }
  }

  async function loadOlderConversations() {
    if (!workspaceId || !conversationCursorRef.current || loadingOlderConversations) return
    setLoadingOlderConversations(true); setRealtimeError('')
    try {
      const snap = await getDocs(query(
        collection(db, `workspaces/${workspaceId}/conversations`),
        orderBy('updatedAt', 'desc'), startAfter(conversationCursorRef.current), limit(CONVERSATION_PAGE_SIZE + 1),
      ))
      const page = snap.docs.slice(0, CONVERSATION_PAGE_SIZE)
      conversationCursorRef.current = page.at(-1) ?? conversationCursorRef.current
      setHasOlderConversations(snap.docs.length > CONVERSATION_PAGE_SIZE)
      setOlderConversations((current) => [...current, ...page.map((d) => ({ id: d.id, ...d.data() } as Conversation))])
    } catch {
      setRealtimeError('Older conversations could not be loaded.')
    } finally { setLoadingOlderConversations(false) }
  }

  async function loadOlderMessages() {
    if (!workspaceId || !selectedId || !messageCursorRef.current || loadingOlderMessages) return
    setLoadingOlderMessages(true); setRealtimeError('')
    try {
      const snap = await getDocs(query(
        collection(db, `workspaces/${workspaceId}/conversations/${selectedId}/messages`),
        orderBy('createdAt', 'asc'), endBefore(messageCursorRef.current), limitToLast(MESSAGE_PAGE_SIZE + 1),
      ))
      const page = snap.docs.slice(-MESSAGE_PAGE_SIZE)
      messageCursorRef.current = page[0] ?? messageCursorRef.current
      setHasOlderMessages(snap.docs.length > MESSAGE_PAGE_SIZE)
      setOlderMessages((current) => [...page.map((d) => ({ id: d.id, ...d.data() } as Message)), ...current])
    } catch {
      setRealtimeError('Older messages could not be loaded.')
    } finally { setLoadingOlderMessages(false) }
  }

  useEffect(() => {
    if (loadingOlderMessages) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [timeline, loadingOlderMessages])

  async function handleTakeover() {
    if (!selectedId) return
    setTakingOver(true); setActionError('')
    try {
      await apiRequestOrThrow(`/conversations/${selectedId}/takeover`, { method: 'POST' }, 'Could not take over this conversation.')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not take over this conversation.')
    } finally {
      setTakingOver(false)
    }
  }

  async function handleResolve() {
    if (!selectedId) return
    setActionError('')
    try {
      await apiRequestOrThrow(`/conversations/${selectedId}/resolve`, { method: 'POST' }, 'Could not resolve this conversation.')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not resolve this conversation.')
    }
  }

  async function handleAssign(uid: string) {
    if (!selectedId || assigning) return
    setAssigning(true); setActionError('')
    try {
      await apiRequestOrThrow(`/conversations/${selectedId}/assignee`, {
        method: 'PUT', body: JSON.stringify({ uid: uid || null }),
      }, 'Could not update the assignee.')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the assignee.')
    } finally { setAssigning(false) }
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim() || !selectedId || sending) return
    setSending(true); setActionError('')
    try {
      await apiRequestOrThrow(`/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: reply.trim() }),
      }, 'Could not send your reply.')
      setReply('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not send your reply.')
    } finally {
      setSending(false)
    }
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault()
    if (!noteDraft.trim() || !selectedId || sendingNote) return
    setSendingNote(true); setActionError('')
    try {
      await apiRequestOrThrow(`/conversations/${selectedId}/notes`, {
        method: 'POST', body: JSON.stringify({ content: noteDraft.trim() }),
      }, 'Could not add the internal note.')
      setNoteDraft('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not add the internal note.')
    } finally { setSendingNote(false) }
  }

  const agentName = (id?: string | null) =>
    (id ? agents.find((a) => a.id === id)?.name : undefined) ?? 'Unassigned'
  const operatorName = (id?: string | null) => {
    if (!id) return 'Unassigned'
    const operator = operators.find((person) => person.uid === id)
    return operator?.displayName || operator?.email || 'Assigned teammate'
  }

  if (wsLoading) {
    return <div className={styles.root}><div className={styles.list} style={{ width: 280, flexShrink: 0, background: 'var(--panel)', boxShadow: 'inset -1px 0 var(--line)' }}><Loading label="Loading conversations…" pad="24px 16px" /></div><div style={{ flex: 1 }}><Loading label="Preparing your inbox…" pad="72px 24px" /></div></div>
  }

  const sourceConversations = searchResults ?? conversations
  const visibleConversations = sourceConversations
    .filter((conversation) => filter === 'all'
      || (filter === 'unread' && conversation.unread)
      || (filter === 'mine' && conversation.operatorId === user?.uid)
      || (filter === 'tickets' && Boolean(conversation.ticketId))
      || conversation.status === filter)
    .filter((c) => agentFilter === 'all' || c.agentId === agentFilter)

  return (
    <div className={styles.root}>
      {/* Conversation list */}
      <div className={styles.list} data-thread-open={Boolean(selectedId)} style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <h1 style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Inbox</h1>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>
            {searching ? 'Searching…' : searchResults ? `${visibleConversations.length} search results` : visibleConversations.length === conversations.length
              ? `${conversations.length} conversations`
              : `${visibleConversations.length} of ${conversations.length} conversations`}
          </p>
        </div>
        <div style={{ padding: '10px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} aria-hidden style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-mute)', pointerEvents: 'none' }} />
            <input
              type="search"
              className="dashboard-field"
              aria-label="Search conversations"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search conversations…"
              style={{ width: '100%', minHeight: 40, padding: '7px 34px', border: '1px solid var(--line-2)', borderRadius: 12, background: 'var(--control-surface)', color: 'var(--ink)', fontSize: 12.5 }}
            />
            {searchInput && <button type="button" aria-label="Clear search" onClick={() => setSearchInput('')} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, display: 'grid', placeItems: 'center', border: 0, borderRadius: '50%', background: 'transparent', color: 'var(--ink-mute)', cursor: 'pointer' }}><X size={14} /></button>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          {INBOX_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => changeFilter(f)}
              style={{
                minHeight: 40, fontSize: 11.5, fontFamily: 'var(--font-mono)', padding: '0 10px', borderRadius: 20, cursor: 'pointer',
                border: '1px solid var(--line)', textTransform: 'capitalize',
                background: filter === f ? 'var(--control-selected)' : 'transparent',
                color: filter === f ? 'var(--control-selected-text)' : 'var(--ink-mute)',
              }}
            >
              {f === 'human' ? 'Assigned' : f}
            </button>
          ))}
        </div>
        {agents.length > 1 && (
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
            <AppSelect
              ariaLabel="Filter by agent"
              value={agentFilter}
              onChange={changeAgentFilter}
              options={[{ value: 'all', label: 'All agents' }, ...agents.map((agent) => ({ value: agent.id, label: agent.name }))]}
            />
          </div>
        )}
        {realtimeError && (
          <div role="alert" style={{ padding: '9px 10px', borderBottom: '1px solid var(--line)', color: 'var(--danger)', fontSize: 11.5 }}>
            {realtimeError}{' '}
            <button type="button" onClick={() => setSubscriptionVersion((value) => value + 1)} style={{ padding: 0, border: 0, color: 'inherit', background: 'none', fontWeight: 600, cursor: 'pointer' }}>Retry</button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {visibleConversations.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ink-mute)', gap: 8, padding: '0 24px', textAlign: 'center' }}>
              <MessageSquare size={28} style={{ opacity: 0.3 }} />
              <p style={{ fontSize: 13, margin: 0 }}>{searchResults || conversations.length ? 'No conversations match your search or filters.' : 'No conversations yet.'}</p>
              <p style={{ fontSize: 12.5, margin: 0, color: 'var(--ink-faint)' }}>{searchResults || conversations.length ? 'Clear the search and filters to see every conversation.' : 'They’ll appear here when visitors start chatting.'}</p>
              {(searchResults || conversations.length > 0) && <button type="button" className="btn btn-ghost" onClick={clearSearchAndFilters}>Clear search and filters</button>}
            </div>
          ) : (
            <>
            {visibleConversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => void openConversation(conv.id)}
                style={{
                  width: '100%', textAlign: 'left', padding: '12px 16px',
                  borderBottom: '1px solid var(--line)',
                  borderLeft: selectedId === conv.id ? '2px solid var(--control-primary)' : '2px solid transparent',
                  background: selectedId === conv.id ? 'var(--control-selected)' : 'transparent',
                  cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '150ms',
                }}
                onMouseEnter={e => { if (selectedId !== conv.id) (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-2)' }}
                onMouseLeave={e => { if (selectedId !== conv.id) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, fontSize: 12, fontWeight: conv.unread ? 650 : 500, color: conv.unread ? 'var(--ink)' : 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 158 }}>
                    {conv.unread && <span aria-label="Unread" title="Unread" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--control-primary)', flexShrink: 0 }} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{conversationLabel(conv)}</span>
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-faint)', flexShrink: 0 }}>{formatTime(conv.updatedAt)}</span>
                </div>
                <p style={{ fontSize: 12, fontWeight: conv.unread ? 550 : 400, color: conv.unread ? 'var(--ink-dim)' : 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '0 0 6px' }}>{conv.lastMessage}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 500, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 20, ...STATUS_STYLE[conv.status] }}>
                    {conv.status}
                  </span>
                  {conv.ticketId && <span title={`Support ticket #${conv.ticketNumber ?? ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}><Ticket size={11} />#{conv.ticketNumber ?? '—'}</span>}
                  <span
                    style={{
                      fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--ink-faint)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                    }}
                    title={`Answered by ${agentName(conv.agentId)}`}
                  >
                    {agentName(conv.agentId)}
                  </span>
                  {conv.operatorId && <span title={`Assigned to ${operatorName(conv.operatorId)}`} style={{ fontSize: 11.5, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>→ {operatorName(conv.operatorId)}</span>}
                  {typeof conv.score === 'number' && (
                    <span
                      style={{
                        fontSize: 12, fontFamily: 'var(--font-mono)', padding: '2px 6px',
                        borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', color: 'var(--ink-mute)',
                      }}
                      title="Conversation score"
                    >
                      {conv.score}/5
                    </span>
                  )}
                </div>
              </button>
            ))}
            {hasOlderConversations && !searchResults && filter === 'all' && agentFilter === 'all' && (
              <button type="button" className="btn btn-ghost" onClick={() => void loadOlderConversations()} disabled={loadingOlderConversations} style={{ width: 'calc(100% - 20px)', justifyContent: 'center', margin: 10 }}>
                {loadingOlderConversations ? 'Loading…' : 'Load older conversations'}
              </button>
            )}
            </>
          )}
        </div>
      </div>

      {/* Message thread */}
      {selectedId && selectedConv ? (
        <div className={styles.thread} data-open="true" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-2)' }}>
          {/* Thread header */}
          <div className={styles.threadHeader} style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <button type="button" className={styles.backButton} aria-label="Back to conversations" onClick={closeConversation}>
              <ArrowLeft size={18} />
            </button>
            <div className={styles.threadIdentity}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
                {conversationLabel(selectedConv)}
              </p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>
                Status: <span style={{ textTransform: 'capitalize' }}>{selectedConv.status}</span>
                {' · '}Agent: {agentName(selectedConv.agentId)}
              </p>
              {selectedConv.status === 'waiting' && selectedConv.escalationReason && (
                <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 2 }}>Escalated: {selectedConv.escalationReason}</p>
              )}
            </div>
            <div className={styles.threadActions} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AppSelect
                ariaLabel="Assign conversation"
                value={selectedConv.operatorId ?? ''}
                disabled={assigning || selectedConv.status === 'resolved'}
                onChange={(value) => void handleAssign(value)}
                emptyLabel="Unassigned"
                style={{ maxWidth: 180 }}
                options={operators.map((operator) => ({ value: operator.uid, label: `${operator.displayName || operator.email}${operator.uid === user?.uid ? ' (you)' : ''}` }))}
              />
              {(selectedConv.status === 'bot' || selectedConv.status === 'waiting') && (
                <button
                  type="button"
                  onClick={() => void handleTakeover()}
                  disabled={takingOver}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                    background: 'var(--control-primary)', color: 'var(--control-primary-text)', border: 'none', cursor: 'pointer',
                    opacity: takingOver ? 0.5 : 1, transition: 'opacity .15s',
                  }}
                >
                  {takingOver ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <User size={12} />}
                  Take over
                </button>
              )}
              {selectedConv.status === 'human' && (
                <button
                  type="button"
                  onClick={() => void handleResolve()}
                  style={{
                    padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                    background: 'var(--control-secondary)', color: 'var(--ink-dim)',
                    border: 'none', boxShadow: 'var(--shadow-control)', cursor: 'pointer',
                  }}
                >
                  Mark resolved
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                aria-pressed={composerMode === 'note'}
                onClick={() => setComposerMode('note')}
                style={{ width: 40, height: 40, padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}
                title="Add internal note"
                aria-label="Add internal note"
              ><StickyNote size={15} /></button>
              <button
                type="button"
                className="btn btn-ghost"
                aria-pressed={customerOpen}
                onClick={() => setCustomerOpen((open) => !open)}
                style={{ width: 40, height: 40, padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}
                title="Customer details"
                aria-label="Customer details"
              ><Contact size={16} /></button>
            </div>
          </div>

          {selectedConv.summary && (
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '12px 20px 0' }}>{selectedConv.summary}</p>
          )}
          <InboxTicketPanel
            conversationId={selectedConv.id}
            agentId={selectedConv.agentId}
            ticketId={selectedConv.ticketId}
            ticketNumber={selectedConv.ticketNumber}
            suggestedSubject={selectedConv.lastMessage || `Support request from ${conversationLabel(selectedConv)}`}
            operators={operators}
            canRetryDelivery={workspace?.role === 'owner'}
          />
          {actionError && <p role="alert" style={{ fontSize: 12, color: 'var(--danger)', margin: '10px 20px 0' }}>{actionError}</p>}

          {/* Messages */}
          <div className={styles.messages} style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {hasOlderMessages && (
              <button type="button" className="btn btn-ghost" onClick={() => void loadOlderMessages()} disabled={loadingOlderMessages} style={{ alignSelf: 'center' }}>
                {loadingOlderMessages ? 'Loading…' : 'Load older messages'}
              </button>
            )}
            {timeline.map((entry) => {
              if (entry.kind === 'note') {
                return <div key={`note-${entry.item.id}`} className={styles.internalNote}>
                  <div><StickyNote size={13} /> Internal note · {entry.item.authorName}</div>
                  <p>{entry.item.content}</p>
                </div>
              }
              const msg = entry.item
              return (
                <div
                  key={msg.id}
                  className={styles.message}
                  style={{
                    display: 'flex', gap: 8, maxWidth: '75%',
                    flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                    marginLeft: msg.role === 'user' ? 'auto' : undefined,
                  }}
                >
                  <div className={styles.messageAvatar} style={{
                    width: 24, height: 24, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
                    background: msg.role === 'user' ? 'var(--control-selected)'
                      : msg.role === 'operator' ? 'var(--accent-soft)'
                      : 'rgba(99,102,241,0.15)',
                  }}>
                    {msg.role === 'user'
                      ? <User size={12} style={{ color: 'var(--control-selected-text)' }} />
                      : msg.role === 'operator'
                        ? <User size={12} style={{ color: 'var(--accent-text)' }} />
                        : <Bot size={12} style={{ color: 'var(--ai)' }} />}
                  </div>
                  <div className={`${styles.messageBubble} ${
                    msg.role === 'user' ? styles.userBubble
                      : msg.role === 'operator' ? styles.operatorBubble
                        : styles.assistantBubble
                  }`}>
                    {msg.role === 'user'
                      ? msg.content
                      : <MarkdownMessage content={msg.content} className={styles.markdown} />}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply / internal note composer */}
          {(selectedConv.status === 'human' || composerMode === 'note') && (
            <form
              onSubmit={(event) => composerMode === 'note' ? void handleAddNote(event) : void handleSendReply(event)}
              className={styles.reply}
              data-mode={composerMode}
              style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)', padding: '10px 16px 12px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end', flexShrink: 0 }}
            >
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 4 }}>
                {selectedConv.status === 'human' && <button type="button" aria-pressed={composerMode === 'reply'} onClick={() => setComposerMode('reply')} className={styles.composerTab}>Reply</button>}
                <button type="button" aria-pressed={composerMode === 'note'} onClick={() => setComposerMode('note')} className={styles.composerTab}>Internal note</button>
                {composerMode === 'note' && <span style={{ marginLeft: 'auto', alignSelf: 'center', color: 'var(--ink-faint)', fontSize: 11.5 }}>Only teammates can see this</span>}
              </div>
              <textarea
                className="dashboard-field"
                rows={1}
                value={composerMode === 'note' ? noteDraft : reply}
                onChange={(event) => composerMode === 'note' ? setNoteDraft(event.target.value) : setReply(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() }
                }}
                maxLength={composerMode === 'note' ? 2_000 : 5_000}
                placeholder={composerMode === 'note' ? 'Add context for your teammates…' : 'Reply as operator…'}
                style={{
                  flex: 1, resize: 'none', borderRadius: 12,
                  border: `1px solid ${composerMode === 'note' ? 'color-mix(in srgb, var(--accent) 45%, var(--line-2))' : 'var(--line-2)'}`, padding: '9px 12px',
                  fontSize: 13, background: composerMode === 'note' ? 'color-mix(in srgb, var(--accent) 5%, var(--control-surface))' : 'var(--control-surface)', color: 'var(--ink)',
                  maxHeight: 112, fontFamily: 'var(--font-ui)',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = composerMode === 'note' ? 'color-mix(in srgb, var(--accent) 45%, var(--line-2))' : 'var(--line-2)')}
              />
              <button
                type="submit"
                disabled={composerMode === 'note' ? sendingNote || !noteDraft.trim() : sending || !reply.trim()}
                aria-label={composerMode === 'note' ? 'Add internal note' : 'Send reply'}
                style={{
                  padding: 10, borderRadius: 12, background: 'var(--control-primary)', border: 'none',
                  color: 'var(--control-primary-text)', cursor: 'pointer', flexShrink: 0,
                  opacity: (composerMode === 'note' ? sendingNote || !noteDraft.trim() : sending || !reply.trim()) ? 0.5 : 1, transition: 'opacity .15s',
                }}
              >
                {(composerMode === 'note' ? sendingNote : sending) ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : composerMode === 'note' ? <StickyNote size={16} /> : <Send size={16} />}
              </button>
            </form>
          )}
          {selectedConv.status !== 'human' && composerMode !== 'note' && (
            <div style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)', padding: '12px 16px', flexShrink: 0 }}>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', margin: 0 }}>
                {selectedConv.status === 'resolved' ? 'This conversation is resolved.' : selectedConv.status === 'waiting' ? 'This conversation is waiting for a teammate.' : 'The bot is handling this conversation.'}{' '}
                {selectedConv.status !== 'resolved' && <><button type="button" onClick={() => void handleTakeover()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-text)', fontWeight: 500, padding: 0, fontSize: 12 }}>Take over</button>{' '}to reply, or{' '}</>}
                <button type="button" onClick={() => setComposerMode('note')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-text)', fontWeight: 500, padding: 0, fontSize: 12 }}>add an internal note</button>.
              </p>
            </div>
          )}
          <InboxCustomerDrawer
            open={customerOpen}
            context={customerContext}
            loading={contextLoading}
            error={contextError}
            selectedId={selectedId}
            onClose={() => setCustomerOpen(false)}
            onRetry={() => void retryCustomerContext()}
            onSelectConversation={(id) => void openConversation(id)}
          />
        </div>
      ) : (
        <div className={styles.emptyThread} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)', background: 'var(--bg-2)' }}>
          <div style={{ textAlign: 'center' }}>
            <MessageSquare size={36} style={{ margin: '0 auto 12px', opacity: 0.2 }} />
            <p style={{ fontSize: 13, margin: 0 }}>Select a conversation to view messages</p>
          </div>
        </div>
      )}
    </div>
  )
}
