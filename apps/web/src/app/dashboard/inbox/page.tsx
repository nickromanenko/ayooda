'use client'

import { useState, useEffect, useRef } from 'react'
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore'
import { ArrowLeft, Loader2, MessageSquare, User, Bot, Send } from 'lucide-react'
import { db } from '@/lib/firebase'
import { apiRequest } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'
import { useWorkspace } from '@/hooks/useWorkspace'
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
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'operator'
  content: string
  createdAt: Timestamp | null
}

const STATUS_STYLE: Record<Conversation['status'], React.CSSProperties> = {
  bot: { background: 'var(--accent-soft)', color: 'var(--accent)' },
  waiting: { background: 'rgba(239,68,68,0.15)', color: 'var(--danger)' },
  human: { background: 'rgba(245,165,36,0.18)', color: 'var(--accent-2)' },
  resolved: { background: 'var(--panel-2)', color: 'var(--ink-mute)' },
}

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

export default function InboxPage() {
  const { workspace, loading: wsLoading } = useWorkspace()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [takingOver, setTakingOver] = useState(false)
  const [filter, setFilter] = useState<'all' | 'waiting' | 'human' | 'bot' | 'resolved'>('all')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  // Which agent answered. Sourced from /copilot/agents rather than /agents,
  // because the Inbox is open to members and /agents is owner-only.
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const workspaceId = workspace?.id

  useEffect(() => {
    let cancelled = false
    void apiRequest('/copilot/agents')
      .then(async (res) => {
        if (!res.ok || cancelled) return
        const d = await res.json() as { agents: { id: string; name: string }[] }
        setAgents(d.agents)
      })
      .catch(() => { /* names are a nicety; the inbox still works without them */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!workspaceId) return
    const q = query(
      collection(db, `workspaces/${workspaceId}/conversations`),
      orderBy('updatedAt', 'desc'),
    )
    const unsub = onSnapshot(q, (snap) => {
      setConversations(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Conversation)))
    })
    return unsub
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || !selectedId) { setMessages([]); return }
    const q = query(
      collection(db, `workspaces/${workspaceId}/conversations/${selectedId}/messages`),
      orderBy('createdAt', 'asc'),
    )
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message)))
    })
    return unsub
  }, [workspaceId, selectedId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleTakeover() {
    if (!selectedId) return
    setTakingOver(true)
    try {
      await apiRequest(`/conversations/${selectedId}/takeover`, { method: 'POST' })
    } finally {
      setTakingOver(false)
    }
  }

  async function handleResolve() {
    if (!selectedId) return
    await apiRequest(`/conversations/${selectedId}/resolve`, { method: 'POST' })
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim() || !selectedId || sending) return
    setSending(true)
    try {
      await apiRequest(`/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: reply.trim() }),
      })
      setReply('')
    } finally {
      setSending(false)
    }
  }

  const selectedConv = conversations.find((c) => c.id === selectedId)
  const agentName = (id?: string | null) =>
    (id ? agents.find((a) => a.id === id)?.name : undefined) ?? 'Unassigned'

  if (wsLoading) {
    return <Loading />
  }

  const visibleConversations = conversations
    .filter((c) => filter === 'all' || c.status === filter)
    .filter((c) => agentFilter === 'all' || c.agentId === agentFilter)

  return (
    <div className={styles.root} style={{ display: 'flex', height: 'calc(100vh - 48px)', margin: -24, overflow: 'hidden' }}>
      {/* Conversation list */}
      <div className={styles.list} data-thread-open={Boolean(selectedId)} style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <h1 style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Inbox</h1>
          <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
            {visibleConversations.length === conversations.length
              ? `${conversations.length} conversations`
              : `${visibleConversations.length} of ${conversations.length} conversations`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          {(['all', 'waiting', 'human', 'bot', 'resolved'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{
                fontSize: 11, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20, cursor: 'pointer',
                border: '1px solid var(--line)', textTransform: 'capitalize',
                background: filter === f ? 'var(--accent-soft)' : 'transparent',
                color: filter === f ? 'var(--accent)' : 'var(--ink-mute)',
              }}
            >
              {f}
            </button>
          ))}
        </div>
        {agents.length > 1 && (
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
            <select
              aria-label="Filter by agent"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              style={{
                width: '100%', fontSize: 11.5, padding: '5px 8px', borderRadius: 'var(--r-sm)',
                border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)',
              }}
            >
              <option value="all">All agents</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {visibleConversations.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ink-mute)', gap: 8, padding: '0 24px', textAlign: 'center' }}>
              <MessageSquare size={28} style={{ opacity: 0.3 }} />
              <p style={{ fontSize: 13, margin: 0 }}>No conversations yet.</p>
              <p style={{ fontSize: 12, margin: 0, color: 'var(--ink-faint)' }}>They&apos;ll appear here when visitors start chatting.</p>
            </div>
          ) : (
            visibleConversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => setSelectedId(conv.id)}
                style={{
                  width: '100%', textAlign: 'left', padding: '12px 16px',
                  borderBottom: '1px solid var(--line)',
                  borderLeft: selectedId === conv.id ? '2px solid var(--accent)' : '2px solid transparent',
                  background: selectedId === conv.id ? 'var(--accent-soft)' : 'transparent',
                  cursor: 'pointer', transition: 'background .15s',
                }}
                onMouseEnter={e => { if (selectedId !== conv.id) (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-2)' }}
                onMouseLeave={e => { if (selectedId !== conv.id) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                    {conv.visitorId.slice(0, 8)}…
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}>{formatTime(conv.updatedAt)}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '0 0 6px' }}>{conv.lastMessage}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 500, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 20, ...STATUS_STYLE[conv.status] }}>
                    {conv.status}
                  </span>
                  <span
                    style={{
                      fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-faint)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                    }}
                    title={`Answered by ${agentName(conv.agentId)}`}
                  >
                    {agentName(conv.agentId)}
                  </span>
                  {typeof conv.score === 'number' && (
                    <span
                      style={{
                        fontSize: 11, fontFamily: 'var(--font-mono)', padding: '2px 6px',
                        borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', color: 'var(--ink-mute)',
                      }}
                      title="Conversation score"
                    >
                      {conv.score}/5
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Message thread */}
      {selectedId && selectedConv ? (
        <div className={styles.thread} data-open="true" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-2)' }}>
          {/* Thread header */}
          <div className={styles.threadHeader} style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <button type="button" className={styles.backButton} aria-label="Back to conversations" onClick={() => setSelectedId(null)}>
              <ArrowLeft size={18} />
            </button>
            <div className={styles.threadIdentity}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
                Visitor {selectedConv.visitorId.slice(0, 8)}…
              </p>
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                Status: <span style={{ textTransform: 'capitalize' }}>{selectedConv.status}</span>
                {' · '}Agent: {agentName(selectedConv.agentId)}
              </p>
              {selectedConv.status === 'waiting' && selectedConv.escalationReason && (
                <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>Escalated: {selectedConv.escalationReason}</p>
              )}
            </div>
            <div className={styles.threadActions} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {(selectedConv.status === 'bot' || selectedConv.status === 'waiting') && (
                <button
                  type="button"
                  onClick={() => void handleTakeover()}
                  disabled={takingOver}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                    background: 'var(--accent)', color: '#1a0e08', border: 'none', cursor: 'pointer',
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
                    background: 'var(--panel-2)', color: 'var(--ink-dim)',
                    border: '1px solid var(--line)', cursor: 'pointer',
                  }}
                >
                  Mark resolved
                </button>
              )}
            </div>
          </div>

          {selectedConv.summary && (
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '12px 20px 0' }}>{selectedConv.summary}</p>
          )}

          {/* Messages */}
          <div className={styles.messages} style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={styles.message}
                style={{
                  display: 'flex', gap: 8, maxWidth: '75%',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  marginLeft: msg.role === 'user' ? 'auto' : undefined,
                }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
                  background: msg.role === 'user' ? 'var(--panel-2)'
                    : msg.role === 'operator' ? 'var(--accent-soft)'
                    : 'rgba(99,102,241,0.15)',
                }}>
                  {msg.role === 'user'
                    ? <User size={12} style={{ color: 'var(--ink-mute)' }} />
                    : msg.role === 'operator'
                      ? <User size={12} style={{ color: 'var(--accent)' }} />
                      : <Bot size={12} style={{ color: 'var(--ai)' }} />}
                </div>
                <div style={{
                  padding: '8px 12px', borderRadius: 16, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                  borderTopRightRadius: msg.role === 'user' ? 4 : 16,
                  borderTopLeftRadius: msg.role !== 'user' ? 4 : 16,
                  background: msg.role === 'user' ? 'var(--panel-2)'
                    : msg.role === 'operator' ? 'var(--accent)'
                    : 'var(--panel)',
                  color: msg.role === 'operator' ? '#1a0e08' : 'var(--ink-dim)',
                  border: msg.role === 'assistant' ? '1px solid var(--line)' : 'none',
                }}>
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply input */}
          {selectedConv.status === 'human' && (
            <form
              onSubmit={(e) => void handleSendReply(e)}
              className={styles.reply}
              style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}
            >
              <textarea
                rows={1}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSendReply(e as unknown as React.FormEvent) }
                }}
                placeholder="Reply as operator…"
                style={{
                  flex: 1, resize: 'none', borderRadius: 12,
                  border: '1px solid var(--line-2)', padding: '8px 12px',
                  fontSize: 13, background: 'var(--bg-2)', color: 'var(--ink)',
                  outline: 'none', maxHeight: 112, fontFamily: 'var(--font-sans)',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
              />
              <button
                type="submit"
                disabled={sending || !reply.trim()}
                style={{
                  padding: 10, borderRadius: 12, background: 'var(--accent)', border: 'none',
                  color: '#1a0e08', cursor: 'pointer', flexShrink: 0,
                  opacity: sending || !reply.trim() ? 0.5 : 1, transition: 'opacity .15s',
                }}
              >
                {sending ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
              </button>
            </form>
          )}
          {selectedConv.status === 'bot' && (
            <div style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)', padding: '12px 16px', flexShrink: 0 }}>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', margin: 0 }}>
                The bot is handling this conversation.{' '}
                <button type="button" onClick={() => void handleTakeover()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 500, padding: 0, fontSize: 12 }}>
                  Take over
                </button>{' '}
                to reply.
              </p>
            </div>
          )}
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
