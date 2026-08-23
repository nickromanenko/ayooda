import type {
  EscalationContext,
  WorkflowAction,
  WorkflowGraph,
  WorkflowGraphBranch,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowRule,
} from '@ayooda/shared'
import { matchesTrigger } from './engine'
import { validateWorkflowAction, validateWorkflowTrigger } from './validate'

export const MAX_WORKFLOW_GRAPH_NODES = 50
export const MAX_WORKFLOW_GRAPH_EDGES = 100
export const MAX_WORKFLOW_EXECUTION_STEPS = 50

const ID = /^[A-Za-z0-9_-]{1,120}$/
const BRANCHES: WorkflowGraphBranch[] = ['always', 'yes', 'no']

type Fail = { ok: false; error: string }
type Valid = { ok: true; value: WorkflowGraph }
const fail = (error: string): Fail => ({ ok: false, error })

function position(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const { x, y } = raw as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x < 0 || y < 0 || x > 10_000 || y > 10_000) return null
  return { x: Math.round(x), y: Math.round(y) }
}

function name(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return value.length >= 1 && value.length <= 80 ? value : null
}

function parseNode(raw: unknown): { ok: true; value: WorkflowGraphNode } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Every graph node must be an object.')
  const node = raw as Record<string, unknown>
  if (typeof node.id !== 'string' || !ID.test(node.id)) return fail('Every graph node needs a safe id.')
  const nodeName = name(node.name)
  if (!nodeName) return fail(`Node ${node.id} needs a name (max 80 characters).`)
  const nodePosition = position(node.position)
  if (!nodePosition) return fail(`Node ${node.id} has an invalid canvas position.`)

  if (node.kind === 'start') return { ok: true, value: { id: node.id, kind: 'start', name: nodeName, position: nodePosition } }
  if (node.kind === 'condition') {
    const trigger = validateWorkflowTrigger(node.trigger)
    if (!trigger.ok) return fail(`Condition ${nodeName}: ${trigger.error}`)
    return { ok: true, value: { id: node.id, kind: 'condition', name: nodeName, trigger: trigger.value, position: nodePosition } }
  }
  if (node.kind === 'action') {
    const action = validateWorkflowAction(node.action)
    if (!action.ok) return fail(`Action ${nodeName}: ${action.error}`)
    return { ok: true, value: { id: node.id, kind: 'action', name: nodeName, action: action.value, position: nodePosition } }
  }
  return fail(`Node ${node.id} has an unknown kind.`)
}

function parseEdge(raw: unknown, nodeIds: Set<string>): { ok: true; value: WorkflowGraphEdge } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Every graph connection must be an object.')
  const edge = raw as Record<string, unknown>
  if (typeof edge.id !== 'string' || !ID.test(edge.id)) return fail('Every graph connection needs a safe id.')
  if (typeof edge.from !== 'string' || typeof edge.to !== 'string' || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
    return fail(`Connection ${edge.id} references a missing node.`)
  }
  if (edge.from === edge.to) return fail(`Connection ${edge.id} cannot point to itself.`)
  if (!BRANCHES.includes(edge.branch as WorkflowGraphBranch)) return fail(`Connection ${edge.id} has an invalid branch.`)
  return { ok: true, value: { id: edge.id, from: edge.from, to: edge.to, branch: edge.branch as WorkflowGraphBranch } }
}

/** Validate and normalize the complete graph before it reaches Firestore. */
export function validateWorkflowGraph(raw: unknown): Valid | Fail {
  if (!raw || typeof raw !== 'object') return fail('Workflow graph is required.')
  const input = raw as Record<string, unknown>
  if (input.version !== 1) return fail('Unsupported workflow graph version.')
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return fail('Workflow graph enabled state must be true or false.')
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > MAX_WORKFLOW_GRAPH_NODES) {
    return fail(`A workflow needs 1–${MAX_WORKFLOW_GRAPH_NODES} nodes.`)
  }
  if (!Array.isArray(input.edges) || input.edges.length > MAX_WORKFLOW_GRAPH_EDGES) {
    return fail(`A workflow supports at most ${MAX_WORKFLOW_GRAPH_EDGES} connections.`)
  }

  const nodes: WorkflowGraphNode[] = []
  const nodeIds = new Set<string>()
  for (const rawNode of input.nodes) {
    const parsed = parseNode(rawNode)
    if (!parsed.ok) return parsed
    if (nodeIds.has(parsed.value.id)) return fail(`Duplicate node id: ${parsed.value.id}.`)
    nodeIds.add(parsed.value.id)
    nodes.push(parsed.value)
  }

  const starts = nodes.filter((node) => node.kind === 'start')
  if (starts.length !== 1) return fail('A workflow must have exactly one start node.')
  const start = starts[0]!

  const edges: WorkflowGraphEdge[] = []
  const edgeIds = new Set<string>()
  const branchKeys = new Set<string>()
  for (const rawEdge of input.edges) {
    const parsed = parseEdge(rawEdge, nodeIds)
    if (!parsed.ok) return parsed
    if (edgeIds.has(parsed.value.id)) return fail(`Duplicate connection id: ${parsed.value.id}.`)
    const branchKey = `${parsed.value.from}:${parsed.value.branch}`
    if (branchKeys.has(branchKey)) return fail(`Node ${parsed.value.from} has more than one ${parsed.value.branch} connection.`)
    edgeIds.add(parsed.value.id)
    branchKeys.add(branchKey)
    edges.push(parsed.value)
  }

  if (edges.some((edge) => edge.to === start.id)) return fail('Nothing can connect back to the start node.')
  const outgoing = new Map<string, WorkflowGraphEdge[]>()
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge])

  for (const node of nodes) {
    const next = outgoing.get(node.id) ?? []
    if (node.kind === 'start') {
      if (next.some((edge) => edge.branch !== 'always') || (nodes.length > 1 && next.length !== 1) || next.length > 1) {
        return fail('The start node needs one Next connection.')
      }
    } else if (node.kind === 'condition') {
      if (next.some((edge) => edge.branch === 'always') || next.filter((edge) => edge.branch === 'yes').length !== 1) {
        return fail(`Condition ${node.name} needs one Yes connection and may have one No connection.`)
      }
    } else {
      if (next.some((edge) => edge.branch !== 'always') || next.length > 1) return fail(`Action ${node.name} may have one Next connection.`)
      if ((node.action.type !== 'reply' || !node.action.continue) && next.length) {
        return fail(`Terminal action ${node.name} cannot continue to another node.`)
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return false
    if (visited.has(id)) return true
    visiting.add(id)
    for (const edge of outgoing.get(id) ?? []) if (!walk(edge.to)) return false
    visiting.delete(id)
    visited.add(id)
    return true
  }
  if (!walk(start.id)) return fail('Workflow connections cannot contain a cycle.')
  if (visited.size !== nodes.length) return fail('Every workflow node must be reachable from Start.')

  return { ok: true, value: { version: 1, enabled: input.enabled !== false, nodes, edges } }
}

/** Convert the currently active ordered rules into an equivalent directed graph. */
export function graphFromRules(rules: WorkflowRule[]): WorkflowGraph {
  const active = rules.filter((rule) => rule.enabled).sort((a, b) => a.order - b.order)
  const nodes: WorkflowGraphNode[] = [{ id: 'start', kind: 'start', name: 'Start', position: { x: 40, y: 70 } }]
  const edges: WorkflowGraphEdge[] = []
  let edge = 0
  const connect = (from: string, to: string, branch: WorkflowGraphBranch) => {
    edges.push({ id: `edge_${++edge}`, from, to, branch })
  }

  active.forEach((rule, index) => {
    const y = 40 + index * 150
    const conditionId = `condition_${index + 1}`
    const actionId = `action_${index + 1}`
    nodes.push({ id: conditionId, kind: 'condition', name: rule.name, trigger: rule.trigger, position: { x: 300, y } })
    nodes.push({ id: actionId, kind: 'action', name: rule.name, action: rule.action, position: { x: 610, y } })
    connect(conditionId, actionId, 'yes')
    if (index === 0) connect('start', conditionId, 'always')
    if (index < active.length - 1) {
      const next = `condition_${index + 2}`
      connect(conditionId, next, 'no')
      if (rule.action.type === 'reply' && rule.action.continue) connect(actionId, next, 'always')
    }
  })
  return { version: 1, enabled: true, nodes, edges }
}

export interface WorkflowGraphActionStep {
  id: string
  name: string
  action: WorkflowAction
}

export interface WorkflowGraphExecution {
  actions: WorkflowGraphActionStep[]
  path: string[]
  truncated: boolean
}

/** Execute one safe, bounded path through an already validated acyclic graph. */
export function evaluateWorkflowGraph(graph: WorkflowGraph, ctx: EscalationContext): WorkflowGraphExecution {
  if (!graph.enabled) return { actions: [], path: [], truncated: false }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const start = graph.nodes.find((node) => node.kind === 'start')
  if (!start) return { actions: [], path: [], truncated: true }
  const outgoing = new Map<string, WorkflowGraphEdge[]>()
  for (const edge of graph.edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge])

  const actions: WorkflowGraphActionStep[] = []
  const path: string[] = []
  const seen = new Set<string>()
  let current: WorkflowGraphNode | undefined = start

  for (let step = 0; current && step < MAX_WORKFLOW_EXECUTION_STEPS; step++) {
    if (seen.has(current.id)) return { actions, path, truncated: true }
    seen.add(current.id)
    path.push(current.id)
    const next = outgoing.get(current.id) ?? []

    if (current.kind === 'action') {
      actions.push({ id: current.id, name: current.name, action: current.action })
      if (current.action.type !== 'reply' || !current.action.continue) return { actions, path, truncated: false }
      current = byId.get(next.find((edge) => edge.branch === 'always')?.to ?? '')
    } else if (current.kind === 'condition') {
      const branch = matchesTrigger(current.trigger, ctx) ? 'yes' : 'no'
      current = byId.get(next.find((edge) => edge.branch === branch)?.to ?? '')
    } else {
      current = byId.get(next.find((edge) => edge.branch === 'always')?.to ?? '')
    }
  }

  return { actions, path, truncated: current !== undefined }
}
