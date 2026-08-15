import { describe, expect, test } from 'bun:test'
import { loadTurnTools } from './turn-tools'

const ctx = { workspaceId: 'w', agentId: 'a', conversationId: 'c', visitorId: 'v', message: 'hi', config: {}, trace: { span: () => ({ end: () => {} }) } } as never

describe('loadTurnTools', () => {
  test('returns both customer tools and skill tools', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, {
      loadTools: async () => [{ id: 't1', name: 'lookup' }] as never,
      gatherTools: async () => ({ web_search: {} as never }),
    })
    expect(out.tools).toHaveLength(1)
    expect(Object.keys(out.skillTools)).toEqual(['web_search'])
  })

  test('a customer tool-load failure still yields skill tools', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, {
      loadTools: async () => { throw new Error('firestore down') },
      gatherTools: async () => ({ web_search: {} as never }),
    })
    expect(out.tools).toEqual([])
    expect(Object.keys(out.skillTools)).toEqual(['web_search'])
  })

  test('a skill tool failure still yields customer tools', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, {
      loadTools: async () => [{ id: 't1', name: 'lookup' }] as never,
      gatherTools: async () => { throw new Error('boom') },
    })
    expect(out.tools).toHaveLength(1)
    expect(out.skillTools).toEqual({})
  })

  test('never rejects even when both fail', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, {
      loadTools: async () => { throw new Error('a') },
      gatherTools: async () => { throw new Error('b') },
    })
    expect(out).toEqual({ tools: [], skillTools: {} })
  })
})
