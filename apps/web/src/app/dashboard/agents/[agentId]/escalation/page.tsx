'use client'

import { use, useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, Trash2, ArrowUp, ArrowDown, CheckCircle2, MessageSquareText, Route, UserRoundCheck, UserRoundPlus } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import type { WorkflowActionType, WorkflowRule, WorkflowTargets, WorkflowTrigger, TriggerType } from '@ayooda/shared'
import { Loading } from '@/components/dashboard/Loading'
import { card, label, input, errorText } from '@/components/dashboard/ui'
import WorkflowGraphEditor from './WorkflowGraphEditor'
import styles from './page.module.css'

const TRIGGER_LABELS: Record<TriggerType, string> = {
  ask_for_human: 'Visitor asks for a human',
  low_confidence: 'Low knowledge confidence',
  bot_replies: 'After N bot replies',
  keyword: 'Message contains a keyword',
  off_hours: 'Outside business hours',
}
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ACTIONS: Array<{ type: WorkflowActionType; label: string; description: string; icon: typeof Route }> = [
  { type: 'escalate', label: 'Human queue', description: 'Pause the agent and place the conversation in the shared queue.', icon: UserRoundPlus },
  { type: 'assign_teammate', label: 'Assign teammate', description: 'Pause the agent and assign the conversation directly.', icon: UserRoundCheck },
  { type: 'route_agent', label: 'Route to agent', description: 'Move future replies to another AI agent.', icon: Route },
  { type: 'resolve', label: 'Resolve', description: 'Close the conversation and run normal post-processing.', icon: CheckCircle2 },
  { type: 'reply', label: 'Send response', description: 'Send exact text, then stop or continue through the workflow.', icon: MessageSquareText },
]

interface Editor {
  id: string | null
  name: string
  enabled: boolean
  type: TriggerType
  phrases: string
  keywords: string
  count: number
  timezone: string
  days: number[]
  start: string
  end: string
  actionType: WorkflowActionType
  actionMessage: string
  continueProcessing: boolean
  teammateUid: string
  targetAgentId: string
}

function emptyEditor(): Editor {
  return {
    id: null, name: '', enabled: true, type: 'ask_for_human',
    phrases: 'human, agent, talk to a person', keywords: 'refund, cancel', count: 3,
    timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00',
    actionType: 'escalate', actionMessage: '', continueProcessing: false, teammateUid: '', targetAgentId: '',
  }
}

function actionSummary(rule: WorkflowRule, targets: WorkflowTargets): string {
  switch (rule.action.type) {
    case 'escalate': return 'Send to human queue'
    case 'resolve': return 'Resolve conversation'
    case 'reply': return `Send response${rule.action.continue ? ' · then continue' : ' · then stop'}`
    case 'assign_teammate': {
      const teammateUid = rule.action.teammateUid
      const teammate = targets.teammates.find((item) => item.uid === teammateUid)
      return `Assign to ${teammate?.name || teammate?.email || 'teammate'}`
    }
    case 'route_agent': {
      const agentId = rule.action.agentId
      return `Route to ${targets.agents.find((item) => item.id === agentId)?.name ?? 'agent'}`
    }
  }
}

function triggerSummary(t: WorkflowTrigger): string {
  switch (t.type) {
    case 'ask_for_human': return `asks for a human (${t.phrases.length} phrases)`
    case 'keyword': return `keyword (${t.keywords.join(', ')})`
    case 'low_confidence': return 'low knowledge confidence'
    case 'bot_replies': return `after ${t.count} bot replies`
    case 'off_hours': return `off-hours (${t.timezone})`
  }
}

function editorToTrigger(e: Editor): WorkflowTrigger {
  switch (e.type) {
    case 'ask_for_human': return { type: 'ask_for_human', phrases: e.phrases.split(',').map((s) => s.trim()).filter(Boolean) }
    case 'keyword': return { type: 'keyword', keywords: e.keywords.split(',').map((s) => s.trim()).filter(Boolean) }
    case 'low_confidence': return { type: 'low_confidence' }
    case 'bot_replies': return { type: 'bot_replies', count: Number(e.count) }
    case 'off_hours': return { type: 'off_hours', timezone: e.timezone.trim(), days: e.days, start: e.start, end: e.end }
  }
}

function ruleToEditor(r: WorkflowRule): Editor {
  const e = emptyEditor()
  e.id = r.id; e.name = r.name; e.enabled = r.enabled; e.type = r.trigger.type
  e.actionType = r.action.type
  if (r.action.type === 'escalate') e.actionMessage = r.action.handoffMessage ?? ''
  if (r.action.type !== 'escalate') e.actionMessage = r.action.message ?? ''
  if (r.action.type === 'reply') e.continueProcessing = r.action.continue
  if (r.action.type === 'assign_teammate') e.teammateUid = r.action.teammateUid
  if (r.action.type === 'route_agent') e.targetAgentId = r.action.agentId
  const t = r.trigger
  if (t.type === 'ask_for_human') e.phrases = t.phrases.join(', ')
  if (t.type === 'keyword') e.keywords = t.keywords.join(', ')
  if (t.type === 'bot_replies') e.count = t.count
  if (t.type === 'off_hours') { e.timezone = t.timezone; e.days = t.days; e.start = t.start; e.end = t.end }
  return e
}

export default function AgentEscalationPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const base = `/agents/${agentId}/workflows`

  const [rules, setRules] = useState<WorkflowRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [targets, setTargets] = useState<WorkflowTargets>({ teammates: [], agents: [] })
  const [view, setView] = useState<'graph' | 'rules'>('graph')

  const load = useCallback(async () => {
    try {
      const [rulesRes, targetsRes] = await Promise.all([apiRequest(base), apiRequest(`${base}/targets`)])
      if (rulesRes.ok) { const d = await rulesRes.json() as { rules: WorkflowRule[] }; setRules(d.rules) }
      if (targetsRes.ok) setTargets(await targetsRes.json() as WorkflowTargets)
    } finally { setLoading(false) }
  }, [base])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!editor) return
    setSaving(true); setError('')
    const message = editor.actionMessage.trim()
    const action = editor.actionType === 'escalate'
      ? { type: 'escalate' as const, ...(message ? { handoffMessage: message } : {}) }
      : editor.actionType === 'reply'
        ? { type: 'reply' as const, message, continue: editor.continueProcessing }
        : editor.actionType === 'resolve'
          ? { type: 'resolve' as const, ...(message ? { message } : {}) }
          : editor.actionType === 'assign_teammate'
            ? { type: 'assign_teammate' as const, teammateUid: editor.teammateUid, ...(message ? { message } : {}) }
            : { type: 'route_agent' as const, agentId: editor.targetAgentId, ...(message ? { message } : {}) }
    const payload = { name: editor.name.trim(), enabled: editor.enabled, trigger: editorToTrigger(editor), action }
    try {
      const res = editor.id
        ? await apiRequest(`${base}/${editor.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiRequest(base, { method: 'POST', body: JSON.stringify(payload) })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save the rule'); return }
      setEditor(null); await load()
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    setBusyId(id)
    try { await apiRequest(`${base}/${id}`, { method: 'DELETE' }); await load() } finally { setBusyId('') }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...rules]
    const j = index + dir
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j]!, next[index]!]
    setRules(next)
    await apiRequest(`${base}/reorder`, { method: 'PUT', body: JSON.stringify({ orderedIds: next.map((r) => r.id) }) })
    await load()
  }

  const editorIncomplete = !!editor && (
    !editor.name.trim()
    || (editor.actionType === 'reply' && !editor.actionMessage.trim())
    || (editor.actionType === 'assign_teammate' && !editor.teammateUid)
    || (editor.actionType === 'route_agent' && !editor.targetAgentId)
  )

  if (loading) return <Loading />

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>
            {view === 'graph'
              ? 'Build a branching workflow with condition and action nodes. Each condition follows its Yes or No connection.'
              : 'Ordered rules remain available as a fallback. An active graph takes precedence over this list.'}
          </p>
          <div className={styles.viewSwitch} aria-label="Workflow editor mode">
            <button type="button" className={view === 'graph' ? styles.viewSwitchActive : ''} onClick={() => setView('graph')}>Graph</button>
            <button type="button" className={view === 'rules' ? styles.viewSwitchActive : ''} onClick={() => setView('rules')}>Rules fallback</button>
          </div>
        </div>
        {view === 'rules' && !editor && <button type="button" onClick={() => { setEditor(emptyEditor()); setError('') }} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, flexShrink: 0, whiteSpace: 'nowrap' }}><Plus size={14} /> New rule</button>}
      </div>

      {view === 'graph' && <WorkflowGraphEditor agentId={agentId} targets={targets} />}

      {view === 'rules' && error && <p style={{ ...errorText, marginBottom: 12 }}>{error}</p>}

      {view === 'rules' && !editor && (
        <div style={card}>
          <p style={label}>This agent&apos;s rules</p>
          {rules.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No rules yet. Add one to automate a conversation outcome.</p>}
          {rules.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button type="button" onClick={() => void move(i, -1)} disabled={i === 0} aria-label="Up" style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: 'var(--ink-mute)', opacity: i === 0 ? 0.3 : 1, padding: 0 }}><ArrowUp size={13} /></button>
                <button type="button" onClick={() => void move(i, 1)} disabled={i === rules.length - 1} aria-label="Down" style={{ background: 'none', border: 'none', cursor: i === rules.length - 1 ? 'default' : 'pointer', color: 'var(--ink-mute)', opacity: i === rules.length - 1 ? 0.3 : 1, padding: 0 }}><ArrowDown size={13} /></button>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{r.name}{!r.enabled && <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}> · disabled</span>}</p>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{triggerSummary(r.trigger)}</p>
                <p className={styles.actionSummary}>{actionSummary(r, targets)}</p>
              </div>
              <button type="button" onClick={() => { setEditor(ruleToEditor(r)); setError('') }} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>Edit</button>
              <button type="button" onClick={() => void remove(r.id)} disabled={busyId === r.id} aria-label="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 6 }}>{busyId === r.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}</button>
            </div>
          ))}
        </div>
      )}

      {view === 'rules' && editor && (
        <div style={card}>
          <p style={label}>{editor.id ? 'Edit rule' : 'New rule'}</p>
          <div style={{ marginBottom: 12 }}><input placeholder="Rule name" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} style={input} /></div>

          <p style={{ ...label, marginTop: 16 }}>When (trigger)</p>
          <select value={editor.type} onChange={(e) => setEditor({ ...editor, type: e.target.value as TriggerType })} style={input}>
            {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
          </select>

          <div style={{ marginTop: 12 }}>
            {editor.type === 'ask_for_human' && <textarea placeholder="Comma-separated phrases" value={editor.phrases} onChange={(e) => setEditor({ ...editor, phrases: e.target.value })} style={{ ...input, minHeight: 48, resize: 'vertical' }} />}
            {editor.type === 'keyword' && <textarea placeholder="Comma-separated keywords" value={editor.keywords} onChange={(e) => setEditor({ ...editor, keywords: e.target.value })} style={{ ...input, minHeight: 48, resize: 'vertical' }} />}
            {editor.type === 'low_confidence' && <p style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Escalates when the knowledge base returns no confident match.</p>}
            {editor.type === 'bot_replies' && <input type="number" min={1} max={50} value={editor.count} onChange={(e) => setEditor({ ...editor, count: Number(e.target.value) })} style={{ ...input, width: 120 }} />}
            {editor.type === 'off_hours' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input placeholder="Timezone (e.g. America/New_York)" value={editor.timezone} onChange={(e) => setEditor({ ...editor, timezone: e.target.value })} style={input} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DAY_NAMES.map((d, i) => (
                    <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-mute)' }}>
                      <input type="checkbox" checked={editor.days.includes(i)} onChange={(e) => setEditor({ ...editor, days: e.target.checked ? [...editor.days, i] : editor.days.filter((x) => x !== i) })} /> {d}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Open</span>
                  <input type="time" value={editor.start} onChange={(e) => setEditor({ ...editor, start: e.target.value })} style={{ ...input, width: 130 }} />
                  <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>to</span>
                  <input type="time" value={editor.end} onChange={(e) => setEditor({ ...editor, end: e.target.value })} style={{ ...input, width: 130 }} />
                </div>
              </div>
            )}
          </div>

          <p style={{ ...label, marginTop: 20 }}>Then (action)</p>
          <div className={styles.actionGrid}>
            {ACTIONS.map((action) => {
              const Icon = action.icon
              const selected = editor.actionType === action.type
              return (
                <button
                  key={action.type}
                  type="button"
                  aria-pressed={selected}
                  className={`${styles.actionCard} ${selected ? styles.actionCardSelected : ''}`}
                  onClick={() => setEditor({ ...editor, actionType: action.type })}
                >
                  <span className={styles.actionIcon}><Icon size={15} /></span>
                  <span><strong>{action.label}</strong><small>{action.description}</small></span>
                </button>
              )
            })}
          </div>

          {editor.actionType === 'assign_teammate' && (
            <div className={styles.actionField}>
              <p style={label}>Teammate</p>
              <select value={editor.teammateUid} onChange={(e) => setEditor({ ...editor, teammateUid: e.target.value })} style={input}>
                <option value="">Choose a teammate</option>
                {targets.teammates.map((item) => <option key={item.uid} value={item.uid}>{item.name || item.email}{item.name && item.email ? ` · ${item.email}` : ''}</option>)}
              </select>
            </div>
          )}

          {editor.actionType === 'route_agent' && (
            <div className={styles.actionField}>
              <p style={label}>Destination agent</p>
              <select value={editor.targetAgentId} onChange={(e) => setEditor({ ...editor, targetAgentId: e.target.value })} style={input}>
                <option value="">Choose another agent</option>
                {targets.agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
          )}

          <div className={styles.actionField}>
            <p style={label}>{editor.actionType === 'reply' ? 'Response message' : 'Customer message (optional)'}</p>
            <textarea
              required={editor.actionType === 'reply'}
              maxLength={500}
              placeholder={editor.actionType === 'reply' ? 'Write the exact response to send.' : 'Add a short message explaining what happens next.'}
              value={editor.actionMessage}
              onChange={(e) => setEditor({ ...editor, actionMessage: e.target.value })}
              style={{ ...input, minHeight: 72, resize: 'vertical' }}
            />
            <span className={styles.characterCount}>{editor.actionMessage.length}/500</span>
          </div>

          {editor.actionType === 'reply' && (
            <label className={styles.continueToggle}>
              <input type="checkbox" checked={editor.continueProcessing} onChange={(e) => setEditor({ ...editor, continueProcessing: e.target.checked })} />
              <span><strong>Continue processing</strong><small>Evaluate later matching rules; if none match, let the AI answer after this response.</small></span>
            </label>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-mute)', marginTop: 16 }}>
            <input type="checkbox" checked={editor.enabled} onChange={(e) => setEditor({ ...editor, enabled: e.target.checked })} /> Enabled
          </label>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => void save()} disabled={saving || editorIncomplete} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: saving || editorIncomplete ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save rule'}</button>
            <button type="button" onClick={() => setEditor(null)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}
