'use client'

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  collection, query, orderBy, onSnapshot, Timestamp, limitToLast, getDocs, endBefore,
  type DocumentData, type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { ArrowLeft, Loader2, Send, Plus, Trash2, MessagesSquare, FileText, Bot, User } from 'lucide-react'
import { Button } from '@heroui/react'
import { db } from '@/lib/firebase'
import { apiRequest, apiRequestOrThrow } from '@/lib/api'
import { readSSE } from '@/lib/sse'
import { Loading } from '@/components/dashboard/Loading'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useAuth } from '@/components/providers/AuthProvider'
import AgentAvatar from '@/components/dashboard/AgentAvatar'
import { AppSelect } from '@/components/ui/AppSelect'
import { useAppConfirm } from '@/components/ui/AppInteractionProvider'
import { label } from '@/components/dashboard/ui'
import type { CopilotThreadDoc } from '@ayooda/shared'
import styles from './page.module.css'

// GET /copilot/threads sends Firestore Timestamps through a plain JSON response
// (no client SDK in the loop to reconstruct a real Timestamp), so they arrive as
// this shape rather than something with a .toDate() method.
type TsJSON = { _seconds: number; _nanoseconds: number }

interface ThreadRow extends Omit<CopilotThreadDoc, 'createdAt' | 'updatedAt'> {
  id: string
  createdAt: TsJSON | null
  updatedAt: TsJSON | null
}

/** GET /copilot/agents — deliberately smaller than AgentDoc: no systemPrompt or
 *  hasGatewayKey, since members (who can't hit the owner-only /agents routes)
 *  use this endpoint for the picker. */
interface AgentPickerItem {
  id: string
  name: string
  photoURL: string | null
  isDefault: boolean
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Timestamp | null
  metadata?: { sources?: Array<{ docId: string; source: string; score: number }> }
}

const MESSAGE_PAGE_SIZE = 100

function formatRelative(ts: TsJSON | null): string {
  if (!ts) return ''
  const date = new Date(ts._seconds * 1000)
  const now = new Date()
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString()
}

export default function CopilotPage() {
  return (
    <Suspense fallback={null}>
      <CopilotPageInner />
    </Suspense>
  )
}

function CopilotPageInner() {
  const confirm = useAppConfirm()
  const { workspace } = useWorkspace()
  const { user } = useAuth()
  const searchParams = useSearchParams()

  const [agents, setAgents] = useState<AgentPickerItem[]>([])
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [liveMessages, setLiveMessages] = useState<Message[]>([])
  const [olderMessages, setOlderMessages] = useState<Message[]>([])
  const [pendingAgentId, setPendingAgentId] = useState('')
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [realtimeError, setRealtimeError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [subscriptionVersion, setSubscriptionVersion] = useState(0)
  const [mobileComposeOpen, setMobileComposeOpen] = useState(() => Boolean(searchParams.get('agent')))
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)

  const workspaceId = workspace?.id
  const uid = user?.uid
  const messages = useMemo(() => {
    const merged = new Map<string, Message>()
    for (const item of [...olderMessages, ...liveMessages]) merged.set(item.id, item)
    return [...merged.values()].sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))
  }, [liveMessages, olderMessages])
  const clearMessages = useCallback(() => { setLiveMessages([]); setOlderMessages([]); setHasOlderMessages(false) }, [])

  const loadThreads = useCallback(async () => {
    try {
      const res = await apiRequest('/copilot/threads')
      if (!res.ok) throw new Error('Could not load Copilot threads.')
      const d = await res.json() as { threads: ThreadRow[] }
      setThreads(d.threads)
    } catch {
      setError('Could not load Copilot threads. Check your connection and try again.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Members can't reach the owner-only /agents routes, so the picker uses
        // /copilot/agents — a smaller, member-readable view of the same list.
        const [agentsRes] = await Promise.all([apiRequest('/copilot/agents'), loadThreads()])
        if (!agentsRes.ok) throw new Error('Could not load agents.')
        if (!cancelled) { const d = await agentsRes.json() as { agents: AgentPickerItem[] }; setAgents(d.agents) }
      } catch {
        if (!cancelled) setError('Copilot could not be loaded. Check your connection and try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [loadThreads])

  // ?agent= opens a composer targeting that agent — it must NOT create a thread
  // until the user actually sends; there is deliberately no create-thread route.
  useEffect(() => {
    const agent = searchParams.get('agent')
    if (agent) { setPendingAgentId(agent); setActiveThreadId(null); clearMessages() }
  }, [searchParams, clearMessages])

  // Once agents are known, default the picker to the workspace's default agent
  // so a first-time visitor isn't staring at an empty select — but only if
  // nothing (deep link or a click) has already chosen one.
  useEffect(() => {
    if (pendingAgentId || agents.length === 0) return
    const def = agents.find((a) => a.isDefault) ?? agents[0]
    if (def) setPendingAgentId(def.id)
  }, [agents, pendingAgentId])

  useEffect(() => {
    if (!workspaceId || !uid || !activeThreadId) { clearMessages(); return }
    setOlderMessages([])
    setRealtimeError('')
    const q = query(
      collection(db, `workspaces/${workspaceId}/copilotUsers/${uid}/threads/${activeThreadId}/messages`),
      orderBy('createdAt', 'asc'),
      limitToLast(MESSAGE_PAGE_SIZE + 1),
    )
    const unsub = onSnapshot(q, (snap) => {
      const page = snap.docs.slice(-MESSAGE_PAGE_SIZE)
      messageCursorRef.current = page[0] ?? null
      setHasOlderMessages(snap.docs.length > MESSAGE_PAGE_SIZE)
      const msgs = page.map((d) => ({ id: d.id, ...d.data() } as Message))
      setLiveMessages(msgs)
      // Hand the streamed buffer over to the persisted message atomically: clear
      // `pending` only once Firestore confirms the assistant's reply landed —
      // not on the SSE `done` event. Clearing on `done` left a gap on a brand
      // new thread (the listener had only just subscribed, so `messages` was
      // still empty when `pending` was cleared) and could double-render on a
      // continuing thread (persisted message arriving a few ms before `done`).
      if (msgs[msgs.length - 1]?.role === 'assistant') setPending('')
    }, () => setRealtimeError('Live messages could not be loaded. Check your connection and try again.'))
    return unsub
  }, [workspaceId, uid, activeThreadId, subscriptionVersion, clearMessages])

  async function loadOlderMessages() {
    if (!workspaceId || !uid || !activeThreadId || !messageCursorRef.current || loadingOlderMessages) return
    setLoadingOlderMessages(true); setRealtimeError('')
    try {
      const snap = await getDocs(query(
        collection(db, `workspaces/${workspaceId}/copilotUsers/${uid}/threads/${activeThreadId}/messages`),
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
  }, [messages, pending, loadingOlderMessages])

  function startNewThread() {
    setActiveThreadId(null)
    clearMessages()
    setError('')
    setMobileComposeOpen(true)
  }

  function selectThread(t: ThreadRow) {
    setActiveThreadId(t.id)
    setPendingAgentId(t.agentId)
    clearMessages()
    setError('')
    setRealtimeError('')
    setMobileComposeOpen(true)
  }

  async function removeThread(id: string) {
    if (!await confirm({ title: 'Delete this thread?', description: 'The Copilot conversation and its messages will be permanently removed.', confirmLabel: 'Delete thread' })) return
    setBusyId(id)
    try {
      await apiRequestOrThrow(`/copilot/threads/${id}`, { method: 'DELETE' }, 'Could not delete this thread.')
      if (activeThreadId === id) { setActiveThreadId(null); clearMessages() }
      await loadThreads()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete this thread.')
    } finally {
      setBusyId('')
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || streaming) return
    setInput(''); setError(''); setStreaming(true)
    setPending('')                       // the in-flight assistant reply

    try {
      const body = activeThreadId
        ? { message: text, threadId: activeThreadId }
        : { message: text, agentId: pendingAgentId }

      const res = await apiRequest('/copilot/chat', { method: 'POST', body: JSON.stringify(body) })

      // Errors come back as JSON, not SSE — check before reading the stream.
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setError(d.error ?? 'Could not send the message')
        setInput((current) => current || text)
        return
      }

      let buffer = ''
      await readSSE(res, {
        onEvent: (event, data) => {
          if (event === 'chunk') {
            buffer += (JSON.parse(data) as { text: string }).text
            setPending(buffer)
          } else if (event === 'done') {
            const d = JSON.parse(data) as { threadId: string }
            // Setting the id switches the onSnapshot listener onto this thread.
            // `pending` is cleared there (once the persisted message actually
            // arrives), not here — see the listener effect for why.
            setActiveThreadId(d.threadId)
            void loadThreads()
          } else if (event === 'error') {
            setError((JSON.parse(data) as { error: string }).error)
            setPending('')
            // A new thread may already have been created (and a cap unit spent)
            // before the turn failed — refresh so the user can continue it
            // instead of unknowingly starting (and paying for) another one.
            void loadThreads()
          }
        },
      })
    } catch {
      setError('Connection lost')
      setInput((current) => current || text)
      void loadThreads()
    } finally {
      setStreaming(false)
    }
  }

  const activeAgentId = activeThreadId ? threads.find((t) => t.id === activeThreadId)?.agentId : pendingAgentId
  const activeAgent = agents.find((a) => a.id === activeAgentId)
  const canCompose = Boolean(activeThreadId || pendingAgentId)

  if (loading) {
    return <div className={styles.root}><div className={styles.list} style={{ width: 300, flexShrink: 0, background: 'var(--panel)', boxShadow: 'inset -1px 0 var(--line)' }}><Loading label="Loading threads…" pad="24px 16px" /></div><div style={{ flex: 1 }}><Loading label="Preparing Copilot…" pad="72px 24px" /></div></div>
  }

  return (
    <div className={styles.root}>
      {/* Thread list */}
      <div className={styles.list} data-compose-open={mobileComposeOpen} style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <h1 style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Copilot</h1>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>Chat with your team&apos;s agents</p>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <p style={{ ...label, marginBottom: 8 }}>New thread</p>
          <AppSelect
            ariaLabel="Choose an agent for the new thread"
            emptyLabel="Choose an agent…"
            onChange={setPendingAgentId}
            options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
            style={{ marginBottom: 8 }}
            value={pendingAgentId}
          />
          <Button
            onPress={startNewThread}
            isDisabled={!pendingAgentId}
            className="btn btn-primary"
            style={{ width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 12px', fontSize: 12.5, opacity: pendingAgentId ? 1 : 0.5 }}
          >
            <Plus size={13} /> New thread
          </Button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {threads.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ink-mute)', gap: 8, padding: '0 24px', textAlign: 'center' }}>
              <MessagesSquare size={28} style={{ opacity: 0.3 }} />
              <p style={{ fontSize: 13, margin: 0 }}>No threads yet.</p>
              <p style={{ fontSize: 12, margin: 0, color: 'var(--ink-faint)' }}>Pick an agent above and send a message to start one.</p>
            </div>
          ) : (
            threads.map((t) => {
              const agent = agents.find((a) => a.id === t.agentId)
              const isActive = activeThreadId === t.id
              return (
                <div
                  key={t.id}
                  style={{
                    display: 'flex', alignItems: 'center',
                    borderBottom: '1px solid var(--line)',
                    borderLeft: isActive ? '2px solid var(--control-primary)' : '2px solid transparent',
                    background: isActive ? 'var(--control-selected)' : 'transparent',
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => selectThread(t)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, padding: '10px 6px 10px 14px', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <AgentAvatar name={agent?.name ?? 'Agent'} photoURL={agent?.photoURL ?? null} seed={t.agentId} size={28} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-faint)', marginTop: 2 }}>{formatRelative(t.updatedAt)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="Delete thread"
                    onClick={() => void removeThread(t.id)}
                    disabled={busyId === t.id}
                    style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', background: 'none', border: 'none', borderRadius: 10, cursor: 'pointer', color: 'var(--ink-faint)', padding: 0, flexShrink: 0 }}
                  >
                    {busyId === t.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Conversation */}
      {canCompose ? (
        <div className={styles.conversation} data-open={mobileComposeOpen} style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-2)' }}>
          <div className={styles.conversationHeader} style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button type="button" className={styles.backButton} aria-label="Back to Copilot threads" onClick={() => setMobileComposeOpen(false)}>
              <ArrowLeft size={18} />
            </button>
            {activeAgent && <AgentAvatar name={activeAgent.name} photoURL={activeAgent.photoURL} seed={activeAgent.id} size={24} />}
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>{activeAgent?.name ?? 'New thread'}</p>
          </div>

          {error && <p role="alert" style={{ fontSize: 12, color: 'var(--danger)', margin: '12px 20px 0' }}>{error}</p>}
          {realtimeError && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 20px 0', fontSize: 12, color: 'var(--danger)' }}>
              <span>{realtimeError}</span>
              <button type="button" className="btn btn-ghost" onClick={() => setSubscriptionVersion((value) => value + 1)} style={{ padding: '4px 8px', minHeight: 30 }}>Retry</button>
            </div>
          )}

          <div className={styles.messages} style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {hasOlderMessages && (
              <button type="button" className="btn btn-ghost" disabled={loadingOlderMessages} onClick={() => void loadOlderMessages()} style={{ alignSelf: 'center', minHeight: 36, padding: '6px 12px' }}>
                {loadingOlderMessages ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</> : 'Load older messages'}
              </button>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={styles.message}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '75%',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  marginLeft: msg.role === 'user' ? 'auto' : undefined,
                }}
              >
                <div style={{ display: 'flex', gap: 8, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
                    background: msg.role === 'user' ? 'var(--panel-2)' : 'rgba(99,102,241,0.15)',
                  }}>
                    {msg.role === 'user'
                      ? <User size={12} style={{ color: 'var(--ink-mute)' }} />
                      : <Bot size={12} style={{ color: 'var(--ai)' }} />}
                  </div>
                  <div style={{
                    padding: '8px 12px', borderRadius: 16, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                    borderTopRightRadius: msg.role === 'user' ? 4 : 16,
                    borderTopLeftRadius: msg.role !== 'user' ? 4 : 16,
                    background: msg.role === 'user' ? 'var(--panel-2)' : 'var(--panel)',
                    color: 'var(--ink-dim)',
                    border: msg.role === 'assistant' ? '1px solid var(--line)' : 'none',
                  }}>
                    {msg.content}
                  </div>
                </div>
                {msg.role === 'assistant' && msg.metadata?.sources && msg.metadata.sources.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 32 }}>
                    {msg.metadata.sources.map((s, i) => (
                      <span key={`${s.docId}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-mute)', border: '1px solid var(--line-2)', borderRadius: 20, padding: '2px 8px' }}>
                        <FileText size={10} /> {s.source}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {(streaming || pending) && (
              <div style={{ display: 'flex', gap: 8, maxWidth: '75%' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2, background: 'rgba(99,102,241,0.15)' }}>
                  <Bot size={12} style={{ color: 'var(--ai)' }} />
                </div>
                <div style={{ padding: '8px 12px', borderRadius: 16, borderTopLeftRadius: 4, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', background: 'var(--panel)', color: 'var(--ink-dim)', border: '1px solid var(--line)' }}>
                  {pending || <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            className={styles.composer}
            onSubmit={(e) => { e.preventDefault(); void send() }}
            style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}
          >
            <textarea
              className="dashboard-field"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
              }}
              placeholder="Message your agent…"
              style={{
                flex: 1, resize: 'none', borderRadius: 12,
                border: '1px solid var(--line-2)', padding: '8px 12px',
                fontSize: 13, background: 'var(--control-surface)', color: 'var(--ink)',
                maxHeight: 112, fontFamily: 'var(--font-ui)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--line-2)')}
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              style={{
                padding: 10, borderRadius: 12, background: 'var(--control-primary)', border: 'none',
                color: 'var(--control-primary-text)', cursor: 'pointer', flexShrink: 0,
                opacity: streaming || !input.trim() ? 0.5 : 1, transition: 'opacity .15s',
              }}
            >
              {streaming ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
            </button>
          </form>
        </div>
      ) : (
        <div className={styles.emptyConversation} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)', background: 'var(--bg-2)' }}>
          <div style={{ textAlign: 'center' }}>
            <MessagesSquare size={36} style={{ margin: '0 auto 12px', opacity: 0.2 }} />
            <p style={{ fontSize: 13, margin: 0 }}>Select a thread or choose an agent to start one</p>
          </div>
        </div>
      )}
    </div>
  )
}
