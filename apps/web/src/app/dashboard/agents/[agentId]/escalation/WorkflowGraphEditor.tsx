'use client'

import { useCallback, useEffect, useState } from 'react'
import { GitBranch, LayoutGrid, Loader2, MessageSquareText, Plus, Power, Save, Trash2, Zap } from 'lucide-react'
import type {
  TriggerType,
  WorkflowAction,
  WorkflowActionType,
  WorkflowGraph,
  WorkflowGraphBranch,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowGraphResponse,
  WorkflowTargets,
  WorkflowTrigger,
} from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { input, label } from '@/components/dashboard/ui'
import styles from './WorkflowGraphEditor.module.css'

const NODE_WIDTH = 220
const NODE_HEIGHT = 96

type ConditionNode = Extract<WorkflowGraphNode, { kind: 'condition' }>
type ActionNode = Extract<WorkflowGraphNode, { kind: 'action' }>

const TRIGGER_LABELS: Record<TriggerType, string> = {
  ask_for_human: 'Visitor asks for a human',
  low_confidence: 'Low knowledge confidence',
  bot_replies: 'After N bot replies',
  keyword: 'Message contains a keyword',
  off_hours: 'Outside business hours',
}

const ACTION_LABELS: Record<WorkflowActionType, string> = {
  escalate: 'Send to human queue',
  assign_teammate: 'Assign teammate',
  route_agent: 'Route to agent',
  resolve: 'Resolve conversation',
  reply: 'Send exact response',
}

const emptyTrigger = (type: TriggerType): WorkflowTrigger => {
  switch (type) {
    case 'ask_for_human': return { type, phrases: ['human', 'agent'] }
    case 'low_confidence': return { type }
    case 'bot_replies': return { type, count: 3 }
    case 'keyword': return { type, keywords: ['refund'] }
    case 'off_hours': return { type, timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }
  }
}

const emptyAction = (type: WorkflowActionType): WorkflowAction => {
  switch (type) {
    case 'escalate': return { type }
    case 'resolve': return { type }
    case 'assign_teammate': return { type, teammateUid: '' }
    case 'route_agent': return { type, agentId: '' }
    case 'reply': return { type, message: 'Thanks — I’m looking into that now.', continue: false }
  }
}

function triggerSummary(trigger: WorkflowTrigger): string {
  switch (trigger.type) {
    case 'ask_for_human': return `${trigger.phrases.length} hand-off phrase${trigger.phrases.length === 1 ? '' : 's'}`
    case 'keyword': return trigger.keywords.join(', ')
    case 'low_confidence': return 'No confident knowledge match'
    case 'bot_replies': return `${trigger.count} bot replies reached`
    case 'off_hours': return `${trigger.timezone} · ${trigger.start}–${trigger.end}`
  }
}

function actionSummary(action: WorkflowAction, targets: WorkflowTargets): string {
  switch (action.type) {
    case 'escalate': return 'Human queue'
    case 'resolve': return 'Close and post-process'
    case 'reply': return action.continue ? 'Respond, then continue' : 'Respond, then stop'
    case 'assign_teammate': {
      const teammate = targets.teammates.find((item) => item.uid === action.teammateUid)
      return teammate?.name || teammate?.email || 'Choose teammate'
    }
    case 'route_agent': return targets.agents.find((item) => item.id === action.agentId)?.name ?? 'Choose agent'
  }
}

function autoLayout(graph: WorkflowGraph): WorkflowGraph {
  const outgoing = new Map<string, WorkflowGraphEdge[]>()
  graph.edges.forEach((edge) => outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]))
  const start = graph.nodes.find((node) => node.kind === 'start')
  if (!start) return graph
  const level = new Map<string, number>([[start.id, 0]])
  const queue = [start.id]
  while (queue.length) {
    const from = queue.shift()!
    for (const edge of outgoing.get(from) ?? []) {
      const nextLevel = (level.get(from) ?? 0) + 1
      if (!level.has(edge.to) || nextLevel < level.get(edge.to)!) {
        level.set(edge.to, nextLevel)
        queue.push(edge.to)
      }
    }
  }
  const perLevel = new Map<number, string[]>()
  graph.nodes.forEach((node) => {
    const column = level.get(node.id) ?? Math.max(0, ...level.values()) + 1
    perLevel.set(column, [...(perLevel.get(column) ?? []), node.id])
  })
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const column = level.get(node.id) ?? Math.max(0, ...level.values()) + 1
      const row = perLevel.get(column)?.indexOf(node.id) ?? 0
      return { ...node, position: { x: 42 + column * 280, y: 42 + row * 145 } }
    }),
  }
}

function nextId(graph: WorkflowGraph, prefix: string): string {
  let index = 1
  while (graph.nodes.some((node) => node.id === `${prefix}_${index}`)) index++
  return `${prefix}_${index}`
}

export default function WorkflowGraphEditor({ agentId, targets }: { agentId: string; targets: WorkflowTargets }) {
  const base = `/agents/${agentId}/workflows/graph`
  const [graph, setGraph] = useState<WorkflowGraph | null>(null)
  const [persisted, setPersisted] = useState(false)
  const [legacyRuleCount, setLegacyRuleCount] = useState(0)
  const [selectedId, setSelectedId] = useState('start')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiRequest(base)
      const data = await response.json().catch(() => ({})) as WorkflowGraphResponse & { error?: string }
      if (!response.ok || !data.graph) throw new Error(data.error ?? 'Could not load the workflow graph.')
      setGraph(data.graph)
      setPersisted(data.persisted)
      setLegacyRuleCount(data.legacyRuleCount)
      setSelectedId((current) => data.graph!.nodes.some((node) => node.id === current) ? current : data.graph!.nodes[0]!.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the workflow graph.')
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className={styles.loading}><Loader2 size={16} /> Loading graph…</div>
  if (!graph) return <p role="alert" className={styles.error}>{error || 'Workflow graph unavailable.'}</p>

  const activeGraph = graph
  const selected = activeGraph.nodes.find((node) => node.id === selectedId) ?? activeGraph.nodes[0]!
  const canvasWidth = Math.max(920, ...graph.nodes.map((node) => node.position.x + NODE_WIDTH + 60))
  const canvasHeight = Math.max(430, ...graph.nodes.map((node) => node.position.y + NODE_HEIGHT + 60))
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))

  function updateNode(node: WorkflowGraphNode) {
    setGraph((current) => current ? { ...current, nodes: current.nodes.map((item) => item.id === node.id ? node : item) } : current)
    setNotice('')
  }

  function setConnection(from: string, branch: WorkflowGraphBranch, to: string) {
    setGraph((current) => {
      if (!current) return current
      const edges = current.edges.filter((edge) => !(edge.from === from && edge.branch === branch))
      if (to) edges.push({ id: `edge_${from}_${branch}`, from, to, branch })
      return { ...current, edges }
    })
    setNotice('')
  }

  function addNode(kind: 'condition' | 'action') {
    const id = nextId(activeGraph, kind)
    const y = 42 + activeGraph.nodes.filter((node) => node.kind === kind).length * 135
    const node: WorkflowGraphNode = kind === 'condition'
      ? { id, kind, name: 'New condition', trigger: emptyTrigger('keyword'), position: { x: 320, y } }
      : { id, kind, name: 'New action', action: emptyAction('reply'), position: { x: 650, y } }
    setGraph({ ...activeGraph, nodes: [...activeGraph.nodes, node] })
    setSelectedId(id)
    setNotice('Connect the new node before saving.')
  }

  function removeNode() {
    if (selected.kind === 'start') return
    const nodes = activeGraph.nodes.filter((node) => node.id !== selected.id)
    setGraph({ ...activeGraph, nodes, edges: activeGraph.edges.filter((edge) => edge.from !== selected.id && edge.to !== selected.id) })
    setSelectedId(nodes[0]!.id)
    setNotice('Node removed. Check any branches that previously pointed to it.')
  }

  async function save() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await apiRequest(base, { method: 'PUT', body: JSON.stringify(graph) })
      const data = await response.json().catch(() => ({})) as WorkflowGraphResponse & { error?: string }
      if (!response.ok || !data.graph) throw new Error(data.error ?? 'Could not save the workflow graph.')
      setGraph(data.graph)
      setPersisted(true)
      setLegacyRuleCount(data.legacyRuleCount)
      setNotice('Graph saved and active for new customer turns.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the workflow graph.')
    } finally {
      setSaving(false)
    }
  }

  async function returnToRules() {
    if (!window.confirm('Deactivate and delete this graph? The ordered rules fallback will resume immediately.')) return
    setSaving(true)
    setError('')
    try {
      const response = await apiRequest(base, { method: 'DELETE' })
      if (!response.ok) throw new Error('Could not deactivate the graph.')
      setPersisted(false)
      setNotice('Graph deactivated. Ordered rules are active again.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not deactivate the graph.')
    } finally {
      setSaving(false)
    }
  }

  const options = graph.nodes.filter((node) => node.id !== selected.id && node.kind !== 'start')
  const connection = (branch: WorkflowGraphBranch) => graph.edges.find((edge) => edge.from === selected.id && edge.branch === branch)?.to ?? ''

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <div>
          <div className={styles.statusRow}>
            <span className={`${styles.statusDot} ${persisted && graph.enabled ? styles.statusDotLive : ''}`} />
            <strong>{persisted ? graph.enabled ? 'Graph active' : 'Graph paused' : 'Converted preview'}</strong>
            <span>{graph.nodes.length} nodes · {graph.edges.length} connections</span>
          </div>
          <p>{persisted ? 'This graph replaces ordered-rule execution while it remains active.' : `Automatically converted from ${legacyRuleCount} ordered rule${legacyRuleCount === 1 ? '' : 's'}. Saving activates it.`}</p>
        </div>
        <div className={styles.toolbarActions}>
          <button type="button" className={styles.toolButton} onClick={() => setGraph(autoLayout(graph))}><LayoutGrid size={14} /> Auto-layout</button>
          <button type="button" className={styles.toolButton} onClick={() => addNode('condition')}><Plus size={14} /> Condition</button>
          <button type="button" className={styles.toolButton} onClick={() => addNode('action')}><Plus size={14} /> Action</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving} style={{ minHeight: 40, padding: '0 14px' }}>
            {saving ? <Loader2 size={14} className={styles.spinner} /> : <Save size={14} />} {persisted ? 'Save graph' : 'Activate graph'}
          </button>
        </div>
      </div>

      {!persisted && <p className={styles.previewNotice}>Preview only — customer conversations still use the ordered rules until you activate this graph.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      <div className={styles.workspace}>
        <div className={styles.canvasScroller}>
          <div className={styles.canvas} style={{ width: canvasWidth, height: canvasHeight }}>
            <svg className={styles.edges} width={canvasWidth} height={canvasHeight} aria-hidden="true">
              <defs>
                <marker id="workflow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const from = nodeById.get(edge.from)
                const to = nodeById.get(edge.to)
                if (!from || !to) return null
                const offset = edge.branch === 'yes' ? -18 : edge.branch === 'no' ? 18 : 0
                const x1 = from.position.x + NODE_WIDTH
                const y1 = from.position.y + NODE_HEIGHT / 2 + offset
                const x2 = to.position.x
                const y2 = to.position.y + NODE_HEIGHT / 2
                const bend = Math.max(55, Math.abs(x2 - x1) * 0.45)
                return (
                  <g key={edge.id}>
                    <path className={`${styles.edgePath} ${edge.branch === 'yes' ? styles.edgeYes : edge.branch === 'no' ? styles.edgeNo : ''}`} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} markerEnd="url(#workflow-arrow)" />
                    {edge.branch !== 'always' && <text className={styles.edgeLabel} x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6}>{edge.branch}</text>}
                  </g>
                )
              })}
            </svg>

            {graph.nodes.map((node) => (
              <button
                type="button"
                key={node.id}
                className={`${styles.node} ${node.kind === 'condition' ? styles.nodeCondition : node.kind === 'action' ? styles.nodeAction : ''} ${node.id === selected.id ? styles.nodeSelected : ''}`}
                style={{ left: node.position.x, top: node.position.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                onClick={() => setSelectedId(node.id)}
                aria-pressed={node.id === selected.id}
              >
                <span className={styles.nodeIcon}>{node.kind === 'start' ? <Zap size={15} /> : node.kind === 'condition' ? <GitBranch size={15} /> : <MessageSquareText size={15} />}</span>
                <span className={styles.nodeCopy}>
                  <small>{node.kind}</small>
                  <strong>{node.name}</strong>
                  <span>{node.kind === 'start' ? 'Entry point' : node.kind === 'condition' ? triggerSummary(node.trigger) : actionSummary(node.action, targets)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <aside className={styles.inspector}>
          <div className={styles.inspectorHeader}>
            <div><small>{selected.kind} node</small><strong>{selected.name}</strong></div>
            {selected.kind !== 'start' && <button type="button" onClick={removeNode} className={styles.deleteButton} aria-label="Delete selected node"><Trash2 size={14} /></button>}
          </div>

          {selected.kind !== 'start' && (
            <label className={styles.field}>
              <span>Name</span>
              <input value={selected.name} maxLength={80} onChange={(event) => updateNode({ ...selected, name: event.target.value })} style={input} />
            </label>
          )}

          {selected.kind === 'condition' && <ConditionFields node={selected} update={updateNode} />}
          {selected.kind === 'action' && <ActionFields node={selected} targets={targets} graph={graph} setGraph={setGraph} />}

          <div className={styles.connections}>
            <p style={label}>Connections</p>
            {selected.kind === 'start' && <ConnectionSelect label="Next" value={connection('always')} options={options} onChange={(to) => setConnection(selected.id, 'always', to)} required />}
            {selected.kind === 'condition' && (
              <>
                <ConnectionSelect label="Yes" value={connection('yes')} options={options} onChange={(to) => setConnection(selected.id, 'yes', to)} required />
                <ConnectionSelect label="No" value={connection('no')} options={options} onChange={(to) => setConnection(selected.id, 'no', to)} />
              </>
            )}
            {selected.kind === 'action' && selected.action.type === 'reply' && selected.action.continue && (
              <ConnectionSelect label="Next" value={connection('always')} options={options} onChange={(to) => setConnection(selected.id, 'always', to)} />
            )}
            {selected.kind === 'action' && (selected.action.type !== 'reply' || !selected.action.continue) && <p className={styles.terminalHint}>This action ends the workflow path.</p>}
          </div>

          <label className={styles.enabledToggle}>
            <input type="checkbox" checked={graph.enabled} onChange={(event) => setGraph({ ...graph, enabled: event.target.checked })} />
            <span><strong>Graph enabled</strong><small>Paused graphs remain saved but do not run.</small></span>
          </label>

          {persisted && <button type="button" className={styles.returnButton} onClick={() => void returnToRules()} disabled={saving}><Power size={14} /> Return to ordered rules</button>}
        </aside>
      </div>
    </div>
  )
}

function ConnectionSelect({ label: title, value, options, onChange, required = false }: {
  label: string
  value: string
  options: WorkflowGraphNode[]
  onChange: (id: string) => void
  required?: boolean
}) {
  return (
    <label className={styles.connectionField}>
      <span>{title}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={input}>
        <option value="">{required ? 'Choose a node' : 'End path'}</option>
        {options.map((node) => <option key={node.id} value={node.id}>{node.name} · {node.kind}</option>)}
      </select>
    </label>
  )
}

function ConditionFields({ node, update }: { node: ConditionNode; update: (node: WorkflowGraphNode) => void }) {
  const trigger = node.trigger
  const setTrigger = (next: WorkflowTrigger) => update({ ...node, trigger: next })
  return (
    <>
      <label className={styles.field}>
        <span>Condition</span>
        <select value={trigger.type} onChange={(event) => setTrigger(emptyTrigger(event.target.value as TriggerType))} style={input}>
          {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((type) => <option key={type} value={type}>{TRIGGER_LABELS[type]}</option>)}
        </select>
      </label>
      {trigger.type === 'ask_for_human' && <TextList label="Phrases" value={trigger.phrases} onChange={(phrases) => setTrigger({ ...trigger, phrases })} />}
      {trigger.type === 'keyword' && <TextList label="Keywords" value={trigger.keywords} onChange={(keywords) => setTrigger({ ...trigger, keywords })} />}
      {trigger.type === 'bot_replies' && (
        <label className={styles.field}><span>Reply count</span><input type="number" min={1} max={50} value={trigger.count} onChange={(event) => setTrigger({ ...trigger, count: Number(event.target.value) })} style={input} /></label>
      )}
      {trigger.type === 'low_confidence' && <p className={styles.fieldHint}>Yes when retrieval returns no confident knowledge source.</p>}
      {trigger.type === 'off_hours' && (
        <>
          <label className={styles.field}><span>Timezone</span><input value={trigger.timezone} onChange={(event) => setTrigger({ ...trigger, timezone: event.target.value })} style={input} /></label>
          <label className={styles.field}><span>Open days (0–6)</span><input value={trigger.days.join(', ')} onChange={(event) => setTrigger({ ...trigger, days: event.target.value.split(',').map(Number).filter(Number.isInteger) })} style={input} /></label>
          <div className={styles.timeRow}>
            <label><span>Open</span><input type="time" value={trigger.start} onChange={(event) => setTrigger({ ...trigger, start: event.target.value })} style={input} /></label>
            <label><span>Close</span><input type="time" value={trigger.end} onChange={(event) => setTrigger({ ...trigger, end: event.target.value })} style={input} /></label>
          </div>
        </>
      )}
    </>
  )
}

function TextList({ label: title, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  return (
    <label className={styles.field}>
      <span>{title}</span>
      <textarea value={value.join(', ')} onChange={(event) => onChange(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} style={{ ...input, minHeight: 66, resize: 'vertical' }} />
      <small>Comma-separated, up to 20.</small>
    </label>
  )
}

function ActionFields({ node, targets, graph, setGraph }: {
  node: ActionNode
  targets: WorkflowTargets
  graph: WorkflowGraph
  setGraph: (graph: WorkflowGraph) => void
}) {
  const action = node.action
  function setAction(next: WorkflowAction) {
    setGraph({
      ...graph,
      nodes: graph.nodes.map((item) => item.id === node.id ? { ...node, action: next } : item),
      edges: next.type === 'reply' && next.continue ? graph.edges : graph.edges.filter((edge) => edge.from !== node.id),
    })
  }
  const message = action.type === 'escalate' ? action.handoffMessage ?? '' : action.message ?? ''
  const setMessage = (value: string) => {
    if (action.type === 'escalate') setAction({ ...action, handoffMessage: value })
    else setAction({ ...action, message: value })
  }
  return (
    <>
      <label className={styles.field}>
        <span>Action</span>
        <select value={action.type} onChange={(event) => setAction(emptyAction(event.target.value as WorkflowActionType))} style={input}>
          {(Object.keys(ACTION_LABELS) as WorkflowActionType[]).map((type) => <option key={type} value={type}>{ACTION_LABELS[type]}</option>)}
        </select>
      </label>
      {action.type === 'assign_teammate' && (
        <label className={styles.field}><span>Teammate</span><select value={action.teammateUid} onChange={(event) => setAction({ ...action, teammateUid: event.target.value })} style={input}><option value="">Choose teammate</option>{targets.teammates.map((item) => <option key={item.uid} value={item.uid}>{item.name || item.email}</option>)}</select></label>
      )}
      {action.type === 'route_agent' && (
        <label className={styles.field}><span>Agent</span><select value={action.agentId} onChange={(event) => setAction({ ...action, agentId: event.target.value })} style={input}><option value="">Choose agent</option>{targets.agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      )}
      <label className={styles.field}>
        <span>{action.type === 'reply' ? 'Response message' : 'Customer message (optional)'}</span>
        <textarea value={message} maxLength={500} onChange={(event) => setMessage(event.target.value)} style={{ ...input, minHeight: 72, resize: 'vertical' }} />
        <small className={styles.count}>{message.length}/500</small>
      </label>
      {action.type === 'reply' && (
        <label className={styles.continueToggle}>
          <input type="checkbox" checked={action.continue} onChange={(event) => setAction({ ...action, continue: event.target.checked })} />
          <span><strong>Continue path</strong><small>Follow Next, or let the AI answer when Next is empty.</small></span>
        </label>
      )}
    </>
  )
}
