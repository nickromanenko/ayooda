import { describe, expect, test } from 'bun:test'
import { buildAgentReadiness, type AgentReadinessInput } from './agent-readiness'

const ready: AgentReadinessInput = {
  agentId: 'agent_1', name: 'Kim', systemPrompt: 'Help customers', llmModel: 'model', runtimeConfigured: true,
  knowledgeReady: 2, knowledgeTotal: 2, knowledgeIssues: 0, evaluationPassed: 3, evaluationTotal: 3,
  liveChannels: 1, configuredChannels: 1, widgetConfigured: true, widgetInstalled: true, widgetDomains: 1,
  handoffConfigured: true,
}

describe('agent launch readiness', () => {
  test('reports a fully ready agent', () => {
    const result = buildAgentReadiness(ready)
    expect(result.ready).toBe(true)
    expect(result.score).toBe(100)
    expect(result.blockers).toBe(0)
    expect(result.items.every((item) => item.status === 'complete')).toBe(true)
  })

  test('does not require widget domains when no widget is configured', () => {
    const result = buildAgentReadiness({ ...ready, widgetConfigured: false, widgetInstalled: false, widgetDomains: 0 })
    expect(result.ready).toBe(true)
    expect(result.items.find((item) => item.id === 'domains')?.required).toBe(false)
  })

  test('separates blockers from recommendations', () => {
    const result = buildAgentReadiness({ ...ready, knowledgeIssues: 1, evaluationPassed: 2, widgetDomains: 0, handoffConfigured: false })
    expect(result.ready).toBe(false)
    expect(result.blockers).toBe(3)
    expect(result.items.find((item) => item.id === 'handoff')?.status).toBe('recommended')
  })
})
