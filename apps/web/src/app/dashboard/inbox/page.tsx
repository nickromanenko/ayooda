'use client'

import { useState, useEffect, useRef } from 'react'
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore'
import { Loader2, MessageSquare, User, Bot, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase'
import { apiRequest } from '@/lib/api'
import { useWorkspace } from '@/hooks/useWorkspace'

interface Conversation {
  id: string
  channelId: string
  visitorId: string
  status: 'bot' | 'human' | 'resolved'
  operatorId: string | null
  lastMessage: string
  updatedAt: Timestamp | null
  createdAt: Timestamp | null
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'operator'
  content: string
  createdAt: Timestamp | null
}

const STATUS_BADGE: Record<Conversation['status'], string> = {
  bot: 'bg-indigo-50 text-indigo-600',
  human: 'bg-amber-50 text-amber-600',
  resolved: 'bg-zinc-100 text-zinc-400',
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
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const workspaceId = workspace?.id

  // Real-time conversation list
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

  // Real-time messages for selected conversation
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

  // Scroll to bottom when messages update
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

  if (wsLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400 py-12 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-48px)] -m-6 overflow-hidden">
      {/* Conversation list */}
      <div className="w-72 flex-shrink-0 border-r border-zinc-200 bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-200">
          <h1 className="text-sm font-semibold text-zinc-900">Inbox</h1>
          <p className="text-xs text-zinc-400 mt-0.5">{conversations.length} conversations</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-2 px-6 text-center">
              <MessageSquare size={28} className="opacity-30" />
              <p className="text-sm">No conversations yet.</p>
              <p className="text-xs">They'll appear here when visitors start chatting.</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => setSelectedId(conv.id)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 transition-colors',
                  selectedId === conv.id && 'bg-indigo-50 border-l-2 border-l-indigo-500',
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-zinc-600 truncate max-w-[120px]">
                    {conv.visitorId.slice(0, 8)}…
                  </span>
                  <span className="text-[10px] text-zinc-400 flex-shrink-0">
                    {formatTime(conv.updatedAt)}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 truncate mb-1.5">{conv.lastMessage}</p>
                <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full', STATUS_BADGE[conv.status])}>
                  {conv.status}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Message thread */}
      {selectedId && selectedConv ? (
        <div className="flex-1 flex flex-col bg-zinc-50">
          {/* Thread header */}
          <div className="bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-sm font-medium text-zinc-900">
                Visitor {selectedConv.visitorId.slice(0, 8)}…
              </p>
              <p className="text-xs text-zinc-400">
                Status: <span className="capitalize">{selectedConv.status}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedConv.status === 'bot' && (
                <button
                  type="button"
                  onClick={() => void handleTakeover()}
                  disabled={takingOver}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-50"
                >
                  {takingOver ? <Loader2 size={12} className="animate-spin" /> : <User size={12} />}
                  Take over
                </button>
              )}
              {selectedConv.status === 'human' && (
                <button
                  type="button"
                  onClick={() => void handleResolve()}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 transition-colors"
                >
                  Mark resolved
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'flex gap-2 max-w-[75%]',
                  msg.role === 'user' ? 'flex-row-reverse ml-auto' : 'flex-row',
                )}
              >
                <div className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                  msg.role === 'user' ? 'bg-zinc-200' : msg.role === 'operator' ? 'bg-amber-100' : 'bg-indigo-100',
                )}>
                  {msg.role === 'user'
                    ? <User size={12} className="text-zinc-500" />
                    : msg.role === 'operator'
                      ? <User size={12} className="text-amber-600" />
                      : <Bot size={12} className="text-indigo-600" />}
                </div>
                <div className={cn(
                  'px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
                  msg.role === 'user'
                    ? 'bg-zinc-200 text-zinc-800 rounded-tr-sm'
                    : msg.role === 'operator'
                      ? 'bg-amber-500 text-white rounded-tl-sm'
                      : 'bg-white text-zinc-800 border border-zinc-200 rounded-tl-sm',
                )}>
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply input — only when operator has taken over */}
          {selectedConv.status === 'human' && (
            <form
              onSubmit={(e) => void handleSendReply(e)}
              className="bg-white border-t border-zinc-200 px-4 py-3 flex gap-2 items-end flex-shrink-0"
            >
              <textarea
                rows={1}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSendReply(e as unknown as React.FormEvent) }
                }}
                placeholder="Reply as operator…"
                className="flex-1 resize-none rounded-xl border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent max-h-28"
              />
              <button
                type="submit"
                disabled={sending || !reply.trim()}
                className="p-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50 flex-shrink-0"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>
          )}
          {selectedConv.status === 'bot' && (
            <div className="bg-white border-t border-zinc-200 px-4 py-3 flex-shrink-0">
              <p className="text-xs text-zinc-400 text-center">
                The bot is handling this conversation.{' '}
                <button type="button" onClick={() => void handleTakeover()} className="text-amber-500 hover:underline font-medium">
                  Take over
                </button>{' '}
                to reply.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-zinc-400 bg-zinc-50">
          <div className="text-center">
            <MessageSquare size={36} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">Select a conversation to view messages</p>
          </div>
        </div>
      )}
    </div>
  )
}
