import { describe, expect, test } from 'bun:test'
import { loadTurnTools } from './turn-tools'

const ctx = { workspaceId: 'w', agentId: 'a', conversationId: 'c', visitorId: 'v', message: 'hi', config: {}, trace: { span: () => ({ end: () => {} }) } } as never

const deps = (overrides: Partial<Parameters<typeof loadTurnTools>[4]> = {}) => ({
  loadTools: async () => [{ id: 't1', name: 'lookup' }] as never,
  gatherTools: async () => ({ web_search: {} as never }),
  loadMcpTools: async () => ({ mcp_shopify_refund: {} as never }),
  ...overrides,
})

describe('loadTurnTools', () => {
  test('returns customer, skill and MCP tools', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, deps())
    expect(out.tools).toHaveLength(1)
    expect(Object.keys(out.skillTools)).toEqual(['web_search'])
    expect(Object.keys(out.mcpTools)).toEqual(['mcp_shopify_refund'])
  })

  test('a customer tool-load failure still yields skill + MCP tools', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, deps({ loadTools: async () => { throw new Error('firestore down') } }))
    expect(out.tools).toEqual([])
    expect(Object.keys(out.skillTools)).toEqual(['web_search'])
    expect(Object.keys(out.mcpTools)).toEqual(['mcp_shopify_refund'])
  })

  test('a skill tool failure still yields customer + MCP tools', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, deps({ gatherTools: async () => { throw new Error('boom') } }))
    expect(out.tools).toHaveLength(1)
    expect(out.skillTools).toEqual({})
    expect(Object.keys(out.mcpTools)).toEqual(['mcp_shopify_refund'])
  })

  test('an MCP failure still yields customer + skill tools', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, deps({ loadMcpTools: async () => { throw new Error('mcp down') } }))
    expect(out.tools).toHaveLength(1)
    expect(Object.keys(out.skillTools)).toEqual(['web_search'])
    expect(out.mcpTools).toEqual({})
  })

  test('never rejects even when all three fail', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, deps({
      loadTools: async () => { throw new Error('a') },
      gatherTools: async () => { throw new Error('b') },
      loadMcpTools: async () => { throw new Error('c') },
    }))
    expect(out).toEqual({ tools: [], skillTools: {}, mcpTools: {} })
  })
})
