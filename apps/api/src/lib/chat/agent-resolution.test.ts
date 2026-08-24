import { describe, expect, test } from 'bun:test'
import { toAgentRec, inlineAgentRec } from './agent-resolution'

describe('toAgentRec', () => {
  test('maps a full agent document', () => {
    expect(toAgentRec('a1', {
      systemPrompt: 'be helpful', llmModel: 'anthropic/claude-haiku-4.5',
      gatewayKey: 'enc', knowledgeNamespace: 'ns_1',
      customEndpoint: { baseURL: 'https://models.example.com/v1', modelId: 'llama', apiKeyEnc: 'custom-enc' },
    }, 'ws1')).toEqual({
      id: 'a1', systemPrompt: 'be helpful', llmModel: 'anthropic/claude-haiku-4.5',
      gatewayKey: 'enc', knowledgeNamespace: 'ns_1',
      customEndpoint: { baseURL: 'https://models.example.com/v1', modelId: 'llama', apiKeyEnc: 'custom-enc' },
    })
  })

  test('fills defaults for a sparse document', () => {
    const r = toAgentRec('a2', {}, 'ws1')
    expect(r.systemPrompt).toBe('')
    expect(r.llmModel).toBe('google/gemini-2.5-flash')
    expect(r.gatewayKey).toBeUndefined()
    // A missing namespace must fall back to the workspace-wide one, or retrieval
    // would silently query an undefined Pinecone namespace.
    expect(r.knowledgeNamespace).toBe('ws_ws1')
  })
})

describe('inlineAgentRec', () => {
  test('builds the pre-migration fallback from workspace.agent', () => {
    const r = inlineAgentRec('ws1', { agent: { systemPrompt: 'inline p', llmModel: 'openai/gpt-5' }, gatewayKey: 'wk' })
    expect(r).toEqual({
      id: 'inline', systemPrompt: 'inline p', llmModel: 'openai/gpt-5',
      gatewayKey: 'wk', knowledgeNamespace: 'ws_ws1',
    })
  })

  test('tolerates a workspace with no inline agent at all', () => {
    const r = inlineAgentRec('ws1', {})
    expect(r.id).toBe('inline')
    expect(r.systemPrompt).toBe('')
    expect(r.llmModel).toBe('google/gemini-2.5-flash')
  })
})
