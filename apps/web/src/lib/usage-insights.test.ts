import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildUsageInsights, type UsageInsightInput } from './usage-insights'

const healthy: UsageInsightInput = {
  agentId: 'agent_1', conversations: { total: 20, resolved: 18, waiting: 0 }, automationRate: 90,
  handoffs: { total: 2, causes: [{ reason: 'Refunds', count: 1, percentage: 50 }] },
  confidence: { average: 85, lowRate: 10, count: 20, threshold: 70 }, csat: { average: 4.7, count: 10 },
  timing: { firstReply: { averageMs: 2_000, count: 20 } }, knowledge: { docs: 2, indexed: 2 },
  workspace: { periodConversations: 20, includedCap: 100 },
}

describe('usage insights', () => {
  it('prioritizes customers who are currently waiting', () => {
    const result = buildUsageInsights({ ...healthy, conversations: { ...healthy.conversations, waiting: 2 } })
    assert.equal(result[0]?.id, 'waiting')
    assert.equal(result[0]?.level, 'urgent')
  })

  it('uses an activation insight when there is no performance data', () => {
    const result = buildUsageInsights({ ...healthy, conversations: { total: 0, resolved: 0, waiting: 0 } })
    assert.deepEqual(result.map((item) => item.id), ['launch'])
  })

  it('waits for meaningful sample sizes before diagnosing quality', () => {
    const result = buildUsageInsights({ ...healthy, confidence: { ...healthy.confidence, lowRate: 80, count: 2 }, csat: { average: 1, count: 2 } })
    assert.deepEqual(result.map((item) => item.id), ['healthy'])
  })

  it('returns a bounded, priority-ordered action list', () => {
    const result = buildUsageInsights({
      ...healthy, conversations: { total: 20, resolved: 10, waiting: 1 }, automationRate: 30,
      confidence: { ...healthy.confidence, lowRate: 50 }, csat: { average: 2.5, count: 10 },
      knowledge: { docs: 2, indexed: 1 }, workspace: { periodConversations: 95, includedCap: 100 },
    })
    assert.equal(result.length, 4)
    assert.equal(result[0]?.level, 'urgent')
    assert.ok(result.slice(1).every((item) => item.level === 'warning'))
  })
})
