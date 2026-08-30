import { describe, expect, test } from 'bun:test'
import { agentCoreSnapshot, changedCoreFields, isAgentCoreSnapshot } from './version-history'

describe('agent configuration history', () => {
  test('keeps only restorable core configuration', () => {
    expect(agentCoreSnapshot({
      name: 'Kim', description: 'Support', systemPrompt: 'Be helpful', llmModel: 'model', role: 'support', gatewayKey: 'secret',
    })).toEqual({ name: 'Kim', description: 'Support', systemPrompt: 'Be helpful', llmModel: 'model', role: 'support' })
  })

  test('reports exactly the fields that changed', () => {
    const before = agentCoreSnapshot({ name: 'Kim', description: '', systemPrompt: 'Old', llmModel: 'a', role: null })
    const after = { ...before, systemPrompt: 'New', llmModel: 'b' }
    expect(changedCoreFields(before, after)).toEqual(['systemPrompt', 'llmModel'])
  })

  test('rejects incomplete or malformed stored snapshots', () => {
    expect(isAgentCoreSnapshot({ name: 'Kim' })).toBe(false)
    expect(isAgentCoreSnapshot({ name: 'Kim', description: '', systemPrompt: '', llmModel: 'm', role: null })).toBe(true)
  })
})
