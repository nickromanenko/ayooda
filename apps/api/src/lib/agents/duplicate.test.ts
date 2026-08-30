import { describe, expect, test } from 'bun:test'
import { parseDuplicateAgentInput, remapWorkflowAgentReferences } from './duplicate'

describe('agent duplication input', () => {
  test('creates a bounded default name and copies reusable configuration by default', () => {
    const result = parseDuplicateAgentInput({}, 'A'.repeat(100))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toHaveLength(80)
      expect(result.value.name.endsWith(' copy')).toBe(true)
      expect(result.value.copyTools).toBe(true)
      expect(result.value.copySkills).toBe(true)
      expect(result.value.copyWorkflows).toBe(true)
      expect(result.value.copyTests).toBe(true)
    }
  })

  test('supports deliberately excluding optional configuration', () => {
    expect(parseDuplicateAgentInput({ name: 'Sales EU', copyTools: false, copyTests: false }, 'Sales')).toEqual({
      ok: true,
      value: { name: 'Sales EU', copyTools: false, copySkills: true, copyWorkflows: true, copyTests: false },
    })
  })

  test('rejects empty, oversized, and malformed input', () => {
    expect(parseDuplicateAgentInput({ name: ' ' }, 'Kim').ok).toBe(false)
    expect(parseDuplicateAgentInput({ name: 'x'.repeat(81) }, 'Kim').ok).toBe(false)
    expect(parseDuplicateAgentInput({ copyTools: 'yes' }, 'Kim').ok).toBe(false)
  })

  test('self-routing workflow actions follow the duplicated agent', () => {
    expect(remapWorkflowAgentReferences({
      action: { type: 'route_agent', agentId: 'source' },
      nodes: [{ id: 'a', action: { type: 'route_agent', agentId: 'source' } }, { id: 'b', action: { type: 'route_agent', agentId: 'other' } }],
    }, 'source', 'target')).toMatchObject({
      action: { agentId: 'target' },
      nodes: [{ action: { agentId: 'target' } }, { action: { agentId: 'other' } }],
    })
  })
})
