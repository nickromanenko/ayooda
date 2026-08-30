'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  BookOpen,
  Loader2,
  MessageCircleQuestion,
  RotateCcw,
  Send,
  Sparkles,
  User,
  UserRoundCheck,
  Wrench,
} from 'lucide-react'
import { trackProductEvent } from '@/lib/product-analytics'
import type { AgentDoc } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { readSSE } from '@/lib/sse'
import AgentAvatar from '@/components/dashboard/AgentAvatar'
import MarkdownMessage from '@/components/dashboard/MarkdownMessage'
import { Loading } from '@/components/dashboard/Loading'
import styles from './page.module.css'
import EvaluationSuite from './EvaluationSuite'

type Source = { docId: string; source: string; score: number }
type SandboxMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  escalated?: boolean
}
type SandboxStatus = 'ready' | 'waiting' | 'assigned' | 'resolved'

const STATUS_LABEL: Record<SandboxStatus, string> = {
  ready: 'Bot active',
  waiting: 'Human queue',
  assigned: 'Assigned',
  resolved: 'Resolved',
}

const STATUS_DETAIL: Record<SandboxStatus, string> = {
  ready: 'Online · sandbox',
  waiting: 'Waiting for a human',
  assigned: 'Assigned to a teammate',
  resolved: 'Conversation resolved',
}

const SCENARIOS = [
  { label: 'Knowledge answer', icon: BookOpen, prompt: 'What are the most important things a new customer should know?' },
  { label: 'Uncertain question', icon: MessageCircleQuestion, prompt: 'Tell me about a policy that is not covered in your documentation.' },
  { label: 'Human hand-off', icon: UserRoundCheck, prompt: 'I need to speak with a human support agent.' },
] as const

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    const fallback = window.setTimeout(resolve, 50)
    window.requestAnimationFrame(() => {
      window.clearTimeout(fallback)
      resolve()
    })
  })
}

export default function AgentSandboxPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const [agent, setAgent] = useState<AgentDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState<SandboxMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [allowTools, setAllowTools] = useState(false)
  const [status, setStatus] = useState<SandboxStatus>('ready')
  const [lastSources, setLastSources] = useState<Source[]>([])
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    void apiRequest(`/agents/${agentId}`)
      .then(async (res) => {
        if (!cancelled && res.ok) setAgent(await res.json() as AgentDoc)
        else if (!cancelled) setError('Could not load this agent.')
      })
      .catch(() => { if (!cancelled) setError('Could not load this agent.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [agentId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pending])

  const reset = useCallback(async () => {
    setResetting(true)
    setError('')
    try {
      if (sessionId) {
        const res = await apiRequest(`/agents/${agentId}/sandbox/${sessionId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Could not reset the test session.')
      }
      setSessionId(null)
      setMessages([])
      setPending('')
      setLastSources([])
      setStatus('ready')
      setInput('')
    } catch {
      setError('Could not reset the test session.')
    } finally {
      setResetting(false)
    }
  }, [agentId, sessionId])

  async function send() {
    const text = input.trim()
    if (!text || streaming || status !== 'ready') return
    const userMessage: SandboxMessage = { id: crypto.randomUUID(), role: 'user', content: text }
    setMessages((current) => [...current, userMessage])
    setInput('')
    setPending('')
    setError('')
    setStreaming(true)

    try {
      const res = await apiRequest(`/agents/${agentId}/sandbox/chat`, {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          ...(sessionId ? { sessionId } : {}),
          allowTools,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Could not send the test message.')
      }
      if (messages.length === 0) {
        trackProductEvent('Agent Test Started', { tools_enabled: allowTools })
      }

      let buffer = ''
      let resultSources: Source[] = []
      let escalated = false
      await readSSE(res, {
        onEvent: async (event, data) => {
          if (event === 'chunk') {
            buffer += (JSON.parse(data) as { text: string }).text
            setPending(buffer)
            await waitForPaint()
          } else if (event === 'done') {
            const result = JSON.parse(data) as {
              sessionId: string
              sources?: Source[]
              status?: 'bot' | 'waiting' | 'human' | 'resolved'
              escalated?: boolean
              silent?: boolean
            }
            setSessionId(result.sessionId)
            resultSources = result.sources ?? []
            escalated = result.escalated === true
            setLastSources(resultSources)
            if (result.status && result.status !== 'bot') setStatus(result.status === 'human' ? 'assigned' : result.status)
            if (buffer) {
              setStreaming(false)
              setMessages((current) => [...current, {
                id: crypto.randomUUID(), role: 'assistant', content: buffer,
                escalated,
              }])
              setPending('')
            } else if (result.silent) {
              setError('This workflow stopped the conversation. Reset the session to test another flow.')
            }
          } else if (event === 'error') {
            throw new Error((JSON.parse(data) as { error: string }).error)
          }
        },
      })
    } catch (err) {
      setPending('')
      setError(err instanceof Error ? err.message : 'Connection lost.')
    } finally {
      setStreaming(false)
    }
  }

  function chooseScenario(prompt: string) {
    setInput(prompt)
    inputRef.current?.focus()
  }

  function assistantAvatar() {
    if (agent?.photoURL) {
      return (
        <span className={styles.agentMessageAvatar}>
          <AgentAvatar name={agent.name} photoURL={agent.photoURL} seed={agent.id} size={25} />
        </span>
      )
    }
    return <span className={styles.messageAvatar}><Bot size={13} /></span>
  }

  const confidence = lastSources.length
    ? Math.round(Math.min(1, Math.max(0, ...lastSources.map((source) => source.score))) * 100)
    : null

  if (loading) return <Loading />

  return (
    <>
      <p className={styles.intro}>
        Test this agent with its real knowledge and workflow rules. Sandbox sessions stay out of the inbox, customer analytics, and conversation limits.
      </p>

      <EvaluationSuite agentId={agentId} />

      <div className={styles.grid}>
        <aside className={styles.controlPanel}>
          <p className={styles.eyebrow}>Test scenarios</p>
          <div className={styles.scenarioList}>
            {SCENARIOS.map(({ label, icon: Icon, prompt }) => (
              <button key={label} type="button" className={styles.scenarioButton} onClick={() => chooseScenario(prompt)} disabled={streaming || status !== 'ready'}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          <div className={styles.divider} />
          <p className={styles.eyebrow}>Capabilities</p>
          <label className={styles.toolToggle}>
            <span className={styles.toolCopy}>
              <span className={styles.toolTitle}>Connected tools</span>
              <span className={styles.toolHint}>Off by default for safe testing</span>
            </span>
            <input
              type="checkbox"
              className={styles.visuallyHidden}
              checked={allowTools}
              onChange={(event) => setAllowTools(event.target.checked)}
            />
            <span className={`${styles.switch} ${allowTools ? styles.switchOn : ''}`} aria-hidden="true">
              <span className={styles.switchKnob} />
            </span>
          </label>
          {allowTools && (
            <p className={styles.warning}>
              Connected tools are live and may read or change external systems. Use test accounts and safe prompts.
            </p>
          )}

          <div className={styles.divider} />
          <p className={styles.eyebrow}>Diagnostics</p>
          <div className={styles.diagnostics}>
            <div className={styles.diagnosticRow}>
              <span className={styles.diagnosticLabel}>Flow</span>
              <span className={`${styles.diagnosticValue} ${status !== 'ready' ? styles.statusWaiting : styles.statusReady}`}>
                {STATUS_LABEL[status]}
              </span>
            </div>
            <div className={styles.diagnosticRow}>
              <span className={styles.diagnosticLabel}>Confidence</span>
              <span className={styles.diagnosticValue}>{confidence === null ? '—' : `${confidence}%`}</span>
            </div>
            <div className={styles.diagnosticRow}>
              <span className={styles.diagnosticLabel}>Sources</span>
              <span className={styles.diagnosticValue}>{lastSources.length}</span>
            </div>
            <div className={styles.diagnosticRow}>
              <span className={styles.diagnosticLabel}>Tools</span>
              <span className={styles.diagnosticValue}>{allowTools ? 'Live' : 'Off'}</span>
            </div>
          </div>

          <button type="button" className={`btn btn-ghost ${styles.resetButton}`} onClick={() => void reset()} disabled={resetting || (!sessionId && messages.length === 0)}>
            {resetting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={13} />}
            Reset session
          </button>
        </aside>

        <section className={styles.previewShell} aria-label="Agent sandbox chat">
          <div className={styles.chatWindow}>
            <header className={styles.chatHeader}>
              {agent
                ? <AgentAvatar name={agent.name} photoURL={agent.photoURL} seed={agent.id} size={38} />
                : <span className={styles.messageAvatar}><Bot size={15} /></span>}
              <div className={styles.agentCopy}>
                <p className={styles.agentName}>{agent?.name ?? 'Test agent'}</p>
                <p className={styles.agentState}>{STATUS_DETAIL[status]}</p>
              </div>
              <span className={styles.testBadge}>Test traffic</span>
            </header>

            <div className={styles.messages} aria-live="polite">
              {messages.length === 0 && !pending ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon}><Sparkles size={18} /></span>
                  <p className={styles.emptyTitle}>Run a realistic support conversation</p>
                  <p className={styles.emptyHint}>Choose a scenario or write your own message. Knowledge retrieval and workflow rules behave exactly as they do for customers.</p>
                </div>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className={`${styles.messageRow} ${message.role === 'user' ? styles.messageRowUser : ''}`}>
                    {message.role === 'assistant' && assistantAvatar()}
                    <div className={`${styles.bubble} ${message.role === 'user' ? styles.userBubble : styles.assistantBubble} ${message.escalated ? styles.escalatedBubble : ''}`}>
                      {message.role === 'assistant'
                        ? <MarkdownMessage content={message.content} className={styles.markdown} />
                        : message.content}
                    </div>
                    {message.role === 'user' && <span className={styles.messageAvatar}><User size={13} /></span>}
                  </div>
                ))
              )}

              {streaming && (
                <div className={styles.messageRow}>
                  {assistantAvatar()}
                  <div className={`${styles.bubble} ${styles.assistantBubble}`}>
                    {pending ? <MarkdownMessage content={pending} className={styles.markdown} /> : (
                      <span className={styles.typing} aria-label="Agent is typing">
                        <span className={styles.typingDot} /><span className={styles.typingDot} /><span className={styles.typingDot} />
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            {status !== 'ready' && (
              <p className={styles.handoffNotice}><AlertTriangle size={14} /> Workflow action: {STATUS_LABEL[status].toLowerCase()}. Reset to test another conversation.</p>
            )}
            {error && <p role="alert" className={styles.errorNotice}>{error}</p>}

            <div className={styles.composer}>
              <textarea
                ref={inputRef}
                className={styles.textarea}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                disabled={streaming || status !== 'ready'}
                maxLength={5_000}
                rows={1}
                placeholder={status !== 'ready' ? 'Reset to continue testing' : 'Type a customer message…'}
              />
              <button
                type="button"
                className={`btn btn-primary ${styles.sendButton}`}
                onClick={() => void send()}
                disabled={streaming || status !== 'ready' || !input.trim()}
                aria-label="Send test message"
              >
                {streaming ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : allowTools ? <Wrench size={15} /> : <Send size={15} />}
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
