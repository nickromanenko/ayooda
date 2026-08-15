'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore'
import { Loader2, Send, Plus, Trash2, MessagesSquare, FileText, Bot, User } from 'lucide-react'
import { db } from '@/lib/firebase'
import { apiRequest } from '@/lib/api'
import { readSSE } from '@/lib/sse'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useAuth } from '@/components/providers/AuthProvider'
import AgentAvatar from '@/components/dashboard/AgentAvatar'
import type { CopilotThreadDoc } from '@ayooda/shared'

const label: React.CSSProperties = { fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }
// Named inputStyle (not `input`, per agents/page.tsx) — the composer's own text
// state is `input`/`setInput`, matching the send() handler's exact shape.
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }

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
  const { workspace } = useWorkspace()
  const { user } = useAuth()
  const searchParams = useSearchParams()

  const [agents, setAgents] = useState<AgentPickerItem[]>([])
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [pendingAgentId, setPendingAgentId] = useState('')
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const workspaceId = workspace?.id
  const uid = user?.uid

  const loadThreads = useCallback(async () => {
    const res = await apiRequest('/copilot/threads')
    if (res.ok) { const d = await res.json() as { threads: ThreadRow[] }; setThreads(d.threads) }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Members can't reach the owner-only /agents routes, so the picker uses
        // /copilot/agents — a smaller, member-readable view of the same list.
        const [agentsRes] = await Promise.all([apiRequest('/copilot/agents'), loadThreads()])
        if (agentsRes.ok && !cancelled) { const d = await agentsRes.json() as { agents: AgentPickerItem[] }; setAgents(d.agents) }
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
    if (agent) { setPendingAgentId(agent); setActiveThreadId(null); setMessages([]) }
  }, [searchParams])

  // Once agents are known, default the picker to the workspace's default agent
  // so a first-time visitor isn't staring at an empty select — but only if
  // nothing (deep link or a click) has already chosen one.
  useEffect(() => {
    if (pendingAgentId || agents.length === 0) return
    const def = agents.find((a) => a.isDefault) ?? agents[0]
    if (def) setPendingAgentId(def.id)
  }, [agents, pendingAgentId])

  useEffect(() => {
    if (!workspaceId || !uid || !activeThreadId) { setMessages([]); return }
    const q = query(
      collection(db, `workspaces/${workspaceId}/copilotUsers/${uid}/threads/${activeThreadId}/messages`),
      orderBy('createdAt', 'asc'),
    )
    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message))
      setMessages(msgs)
      // Hand the streamed buffer over to the persisted message atomically: clear
      // `pending` only once Firestore confirms the assistant's reply landed —
      // not on the SSE `done` event. Clearing on `done` left a gap on a brand
      // new thread (the listener had only just subscribed, so `messages` was
      // still empty when `pending` was cleared) and could double-render on a
      // continuing thread (persisted message arriving a few ms before `done`).
      if (msgs[msgs.length - 1]?.role === 'assistant') setPending('')
    })
    return unsub
  }, [workspaceId, uid, activeThreadId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pending])

  function startNewThread() {
    setActiveThreadId(null)
    setMessages([])
    setError('')
  }

  function selectThread(t: ThreadRow) {
    setActiveThreadId(t.id)
    setPendingAgentId(t.agentId)
    setError('')
  }

  async function removeThread(id: string) {
    setBusyId(id)
    try {
      await apiRequest(`/copilot/threads/${id}`, { method: 'DELETE' })
      if (activeThreadId === id) { setActiveThreadId(null); setMessages([]) }
      await loadThreads()
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
      void loadThreads()
    } finally {
      setStreaming(false)
    }
  }

  const activeAgentId = activeThreadId ? threads.find((t) => t.id === activeThreadId)?.agentId : pendingAgentId
  const activeAgent = agents.find((a) => a.id === activeAgentId)
  const canCompose = Boolean(activeThreadId || pendingAgentId)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink-mute)', padding: '48px 0', justifyContent: 'center' }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} /> Loading…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)', margin: -24, overflow: 'hidden' }}>
      {/* Thread list */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <h1 style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Copilot</h1>
          <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>Chat with your team&apos;s agents</p>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <p style={{ ...label, marginBottom: 8 }}>New thread</p>
          <select value={pendingAgentId} onChange={(e) => setPendingAgentId(e.target.value)} style={{ ...inputStyle, marginBottom: 8, fontSize: 13, padding: '8px 10px' }}>
            <option value="">Choose an agent…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button
            type="button"
            onClick={startNewThread}
            disabled={!pendingAgentId}
            className="btn btn-primary"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 12px', fontSize: 12.5, opacity: pendingAgentId ? 1 : 0.5 }}
          >
            <Plus size={13} /> New thread
          </button>
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
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                    borderBottom: '1px solid var(--line)',
                    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => selectThread(t)}
                >
                  <AgentAvatar name={agent?.name ?? 'Agent'} photoURL={agent?.photoURL ?? null} seed={t.agentId} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</p>
                    <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '2px 0 0' }}>{formatRelative(t.updatedAt)}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete thread"
                    onClick={(e) => { e.stopPropagation(); void removeThread(t.id) }}
                    disabled={busyId === t.id}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, flexShrink: 0 }}
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-2)' }}>
          <div style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {activeAgent && <AgentAvatar name={activeAgent.name} photoURL={activeAgent.photoURL} seed={activeAgent.id} size={24} />}
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>{activeAgent?.name ?? 'New thread'}</p>
          </div>

          {error && <p style={{ fontSize: 12, color: '#f87171', margin: '12px 20px 0' }}>{error}</p>}

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map((msg) => (
              <div
                key={msg.id}
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
                      : <Bot size={12} style={{ color: '#818cf8' }} />}
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
                      <span key={`${s.docId}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-mute)', border: '1px solid var(--line-2)', borderRadius: 20, padding: '2px 8px' }}>
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
                  <Bot size={12} style={{ color: '#818cf8' }} />
                </div>
                <div style={{ padding: '8px 12px', borderRadius: 16, borderTopLeftRadius: 4, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', background: 'var(--panel)', color: 'var(--ink-dim)', border: '1px solid var(--line)' }}>
                  {pending || <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); void send() }}
            style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}
          >
            <textarea
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
                fontSize: 13, background: 'var(--bg-2)', color: 'var(--ink)',
                outline: 'none', maxHeight: 112, fontFamily: 'var(--font-sans)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--line-2)')}
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              style={{
                padding: 10, borderRadius: 12, background: 'var(--accent)', border: 'none',
                color: '#1a0e08', cursor: 'pointer', flexShrink: 0,
                opacity: streaming || !input.trim() ? 0.5 : 1, transition: 'opacity .15s',
              }}
            >
              {streaming ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
            </button>
          </form>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)', background: 'var(--bg-2)' }}>
          <div style={{ textAlign: 'center' }}>
            <MessagesSquare size={36} style={{ margin: '0 auto 12px', opacity: 0.2 }} />
            <p style={{ fontSize: 13, margin: 0 }}>Select a thread or choose an agent to start one</p>
          </div>
        </div>
      )}
    </div>
  )
}
