import { describe, expect, test } from 'bun:test'
import type { EscalationContext, WorkflowGraph, WorkflowRule } from '@ayooda/shared'
import { evaluateWorkflowGraph, graphFromRules, validateWorkflowGraph } from './graph'

const ctx = (over: Partial<EscalationContext> = {}): EscalationContext => ({
  messageLower: 'hello', botReplyCount: 0, sourceCount: 2, now: new Date('2026-08-23T12:00:00Z'), ...over,
})

const branchingGraph = (): WorkflowGraph => ({
  version: 1,
  enabled: true,
  nodes: [
    { id: 'start', kind: 'start', name: 'Start', position: { x: 0, y: 0 } },
    { id: 'refund', kind: 'condition', name: 'Refund?', trigger: { type: 'keyword', keywords: ['refund'] }, position: { x: 200, y: 0 } },
    { id: 'ack', kind: 'action', name: 'Acknowledge', action: { type: 'reply', message: 'I can help.', continue: true }, position: { x: 400, y: 0 } },
    { id: 'vip', kind: 'condition', name: 'Needs human?', trigger: { type: 'ask_for_human', phrases: ['human'] }, position: { x: 600, y: 0 } },
    { id: 'queue', kind: 'action', name: 'Queue', action: { type: 'escalate' }, position: { x: 800, y: 0 } },
    { id: 'answer', kind: 'action', name: 'Exact answer', action: { type: 'reply', message: 'Refunds take five days.', continue: false }, position: { x: 800, y: 180 } },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'refund', branch: 'always' },
    { id: 'e2', from: 'refund', to: 'ack', branch: 'yes' },
    { id: 'e3', from: 'refund', to: 'answer', branch: 'no' },
    { id: 'e4', from: 'ack', to: 'vip', branch: 'always' },
    { id: 'e5', from: 'vip', to: 'queue', branch: 'yes' },
    { id: 'e6', from: 'vip', to: 'answer', branch: 'no' },
  ],
})

describe('workflow graph validation', () => {
  test('accepts a reachable acyclic branching graph', () => {
    expect(validateWorkflowGraph(branchingGraph()).ok).toBe(true)
  })

  test('rejects cycles, duplicate branches, and unreachable nodes', () => {
    const cycle = branchingGraph()
    cycle.nodes.find((node) => node.id === 'queue')!.kind === 'action' &&
      ((cycle.nodes.find((node) => node.id === 'queue') as Extract<typeof cycle.nodes[number], { kind: 'action' }>).action = { type: 'reply', message: 'again', continue: true })
    cycle.edges.push({ id: 'cycle', from: 'queue', to: 'refund', branch: 'always' })
    expect(validateWorkflowGraph(cycle)).toMatchObject({ ok: false, error: expect.stringContaining('cycle') })

    const duplicate = branchingGraph()
    duplicate.edges.push({ id: 'duplicate', from: 'refund', to: 'queue', branch: 'yes' })
    expect(validateWorkflowGraph(duplicate).ok).toBe(false)

    const unreachable = branchingGraph()
    unreachable.nodes.push({ id: 'orphan', kind: 'action', name: 'Orphan', action: { type: 'resolve' }, position: { x: 50, y: 400 } })
    expect(validateWorkflowGraph(unreachable)).toMatchObject({ ok: false, error: expect.stringContaining('reachable') })
  })

  test('terminal actions cannot have outgoing connections', () => {
    const graph = branchingGraph()
    graph.edges.push({ id: 'bad', from: 'answer', to: 'queue', branch: 'always' })
    expect(validateWorkflowGraph(graph)).toMatchObject({ ok: false, error: expect.stringContaining('Terminal action') })
  })

  test('rejects a malformed enabled state instead of activating it implicitly', () => {
    expect(validateWorkflowGraph({ ...branchingGraph(), enabled: 'false' })).toEqual({
      ok: false,
      error: 'Workflow graph enabled state must be true or false.',
    })
  })

  test('normalizes graph data with existing trigger and action validation', () => {
    const graph = branchingGraph() as unknown as { enabled?: unknown; nodes: Array<Record<string, unknown>> }
    graph.enabled = undefined
    ;(graph.nodes.find((node) => node.id === 'ack')!.action as Record<string, unknown>).message = '  I can help.  '
    const result = validateWorkflowGraph(graph)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.enabled).toBe(true)
      expect(result.value.nodes.find((node) => node.id === 'ack')).toMatchObject({ action: { message: 'I can help.' } })
    }
  })
})

describe('legacy rule migration', () => {
  const rule = (id: string, order: number, enabled = true): WorkflowRule => ({
    id, order, enabled, name: id,
    trigger: { type: 'keyword', keywords: [id] },
    action: { type: 'reply', message: id, continue: true },
  })

  test('preserves active rule order and continuation semantics', () => {
    const graph = graphFromRules([rule('second', 2), rule('disabled', 1, false), rule('first', 0)])
    expect(graph.nodes.filter((node) => node.kind === 'condition').map((node) => node.name)).toEqual(['first', 'second'])
    expect(graph.edges).toContainEqual({ id: 'edge_4', from: 'action_1', to: 'condition_2', branch: 'always' })
    expect(validateWorkflowGraph(graph).ok).toBe(true)
  })

  test('an empty ruleset becomes a valid start-only graph', () => {
    const graph = graphFromRules([])
    expect(graph.nodes).toHaveLength(1)
    expect(graph.edges).toEqual([])
    expect(validateWorkflowGraph(graph).ok).toBe(true)
  })
})

describe('workflow graph execution', () => {
  test('follows yes/no branches and executes sequential actions', () => {
    const refundHuman = evaluateWorkflowGraph(branchingGraph(), ctx({ messageLower: 'refund human' }))
    expect(refundHuman.actions.map((step) => step.id)).toEqual(['ack', 'queue'])
    expect(refundHuman.path).toEqual(['start', 'refund', 'ack', 'vip', 'queue'])

    const other = evaluateWorkflowGraph(branchingGraph(), ctx({ messageLower: 'shipping' }))
    expect(other.actions.map((step) => step.id)).toEqual(['answer'])
    expect(other.path).toEqual(['start', 'refund', 'answer'])
  })

  test('a disabled graph is a no-op', () => {
    const graph = branchingGraph()
    graph.enabled = false
    expect(evaluateWorkflowGraph(graph, ctx())).toEqual({ actions: [], path: [], truncated: false })
  })

  test('runtime bounds corrupt cyclic input even if validation was bypassed', () => {
    const graph = branchingGraph()
    const queue = graph.nodes.find((node) => node.id === 'queue')
    if (!queue || queue.kind !== 'action') throw new Error('missing queue')
    queue.action = { type: 'reply', message: 'loop', continue: true }
    graph.edges.push({ id: 'cycle', from: 'queue', to: 'refund', branch: 'always' })
    expect(evaluateWorkflowGraph(graph, ctx({ messageLower: 'refund human' })).truncated).toBe(true)
  })
})
