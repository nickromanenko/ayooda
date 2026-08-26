import { describe, expect, test, afterEach } from 'bun:test'
import { toAiSdkTools, buildToolRequest, type StoredTool } from './tools'

const fakeTrace = { span: () => ({ end: () => {} }) } as unknown as import('../langfuse').LangfuseTrace

const readTool: StoredTool = {
  id: 't1', name: 'order_lookup', description: 'Look up an order',
  method: 'GET', urlTemplate: 'https://api.shop.com/orders/{orderId}',
  params: [
    { name: 'orderId', type: 'string', description: 'id', required: true },
    { name: 'verbose', type: 'boolean', description: 'v', required: false },
  ],
  headers: [{ key: 'Accept', value: 'application/json' }],
  auth: { type: 'none' }, kind: 'read', writeEnabled: false, enabled: true,
}

describe('toAiSdkTools', () => {
  test('maps to a tool set whose execute returns the formatted executor result', async () => {
    const set = toAiSdkTools([readTool], fakeTrace, async (_t, args) => ({ status: 200, body: JSON.stringify(args) }))
    expect(Object.keys(set)).toEqual(['order_lookup'])
    const out = await set.order_lookup!.execute!({ orderId: 'A1' }, { toolCallId: 't', messages: [] } as never)
    expect(out).toBe('status 200\n{"orderId":"A1"}')
  })
  test('execute surfaces an executor error string', async () => {
    const set = toAiSdkTools([readTool], fakeTrace, async () => ({ status: 0, body: '', error: 'blocked host' }))
    const out = await set.order_lookup!.execute!({ orderId: 'A1' }, { toolCallId: 't', messages: [] } as never)
    expect(out).toBe('error: blocked host')
  })
})

describe('buildToolRequest', () => {
  test('substitutes placeholders and appends leftover args as query for GET', () => {
    const r = buildToolRequest(readTool, { orderId: 'A/1', verbose: true })
    expect(r.url).toBe('https://api.shop.com/orders/A%2F1?verbose=true')
    expect(r.method).toBe('GET')
    expect(r.body).toBeUndefined()
    expect(r.headers.Accept).toBe('application/json')
  })
  test('sends leftover args as a JSON body for POST', () => {
    const writeTool: StoredTool = { ...readTool, method: 'POST', urlTemplate: 'https://api.shop.com/orders/{orderId}/refund' }
    const r = buildToolRequest(writeTool, { orderId: 'A1', amount: 10 })
    expect(r.url).toBe('https://api.shop.com/orders/A1/refund')
    expect(r.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(r.body!)).toEqual({ amount: 10 })
  })
  test('renders nested JSON body templates with typed parameter values', () => {
    const writeTool: StoredTool = {
      ...readTool,
      method: 'POST',
      urlTemplate: 'https://api.shop.com/orders/{orderId}/refund',
      bodyTemplate: '{"refund":{"amount":"{amount}","notify":true}}',
      bodyEncoding: 'json',
    }
    const r = buildToolRequest(writeTool, { orderId: 'A1', amount: 10 })
    expect(r.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(r.body!)).toEqual({ refund: { amount: 10, notify: true } })
  })
  test('renders Stripe-style form encoded body templates', () => {
    const writeTool: StoredTool = {
      ...readTool,
      method: 'POST',
      urlTemplate: 'https://api.stripe.com/v1/customers/{orderId}',
      bodyTemplate: '{"email":"{email}"}',
      bodyEncoding: 'form',
    }
    const r = buildToolRequest(writeTool, { orderId: 'cus_1', email: 'new+tag@example.com' })
    expect(r.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(r.body).toBe('email=new%2Btag%40example.com')
  })
  test('throws when a required placeholder is missing', () => {
    expect(() => buildToolRequest(readTool, {})).toThrow('missing required param: orderId')
  })
})

import { executeTool } from './tools'

const fetchOk = (bodyText: string, status = 200) =>
  (async () => new Response(bodyText, { status })) as unknown as typeof fetch
const publicLookup = async () => [{ address: '93.184.216.34' }]
const privateLookup = async () => [{ address: '10.0.0.5' }]

describe('executeTool', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  const tool: StoredTool = {
    id: 't', name: 'lookup', description: 'd', method: 'GET',
    urlTemplate: 'https://api.example.com/x', params: [], headers: [],
    auth: { type: 'none' }, kind: 'read', writeEnabled: false, enabled: true,
  }

  test('returns status + body on success', async () => {
    globalThis.fetch = fetchOk('{"ok":true}', 200)
    const r = await executeTool(tool, {}, { lookup: publicLookup })
    expect(r.status).toBe(200)
    expect(r.body).toContain('ok')
  })
  test('blocks a host resolving to a private IP', async () => {
    globalThis.fetch = fetchOk('should not run')
    const r = await executeTool(tool, {}, { lookup: privateLookup })
    expect(r.error).toBe('blocked host')
    expect(r.status).toBe(0)
  })
  test('rejects a non-https url', async () => {
    const r = await executeTool({ ...tool, urlTemplate: 'http://api.example.com/x' }, {}, { lookup: publicLookup })
    expect(r.error).toBe('only https is allowed')
  })
  test('does not send authenticated tools without a credential', async () => {
    globalThis.fetch = fetchOk('should not run')
    const r = await executeTool({ ...tool, auth: { type: 'bearer' } }, {}, { lookup: publicLookup })
    expect(r.error).toBe('auth credential missing')
  })
  test('returns a param error without calling fetch', async () => {
    const r = await executeTool({ ...tool, urlTemplate: 'https://api.example.com/{id}' }, {}, { lookup: publicLookup })
    expect(r.error).toBe('missing required param: id')
  })
  test('truncates a body over the cap', async () => {
    globalThis.fetch = fetchOk('a'.repeat(40 * 1024), 200)
    const r = await executeTool(tool, {}, { lookup: publicLookup })
    expect(r.body).toContain('[truncated]')
  })
})

import { selectExposedTools, runAgentTurn } from './tools'

const mkTool = (over: Partial<StoredTool>): StoredTool => ({
  id: 'x', name: 'n', description: 'd', method: 'GET', urlTemplate: 'https://a.com/', params: [],
  headers: [], auth: { type: 'none' }, kind: 'read', writeEnabled: false, enabled: true, ...over,
})

function fakeStream(deltas: string[], usage: { inputTokens?: number; outputTokens?: number }) {
  return { textStream: (async function* () { for (const d of deltas) yield d })(), usage: Promise.resolve(usage) }
}

describe('selectExposedTools', () => {
  test('exposes enabled read tools and write tools only when writeEnabled', () => {
    const list = [
      mkTool({ name: 'r', kind: 'read', enabled: true }),
      mkTool({ name: 'w_off', kind: 'write', writeEnabled: false, enabled: true }),
      mkTool({ name: 'w_on', kind: 'write', writeEnabled: true, enabled: true }),
      mkTool({ name: 'r_disabled', kind: 'read', enabled: false }),
    ]
    expect(selectExposedTools(list).map((t) => t.name).sort()).toEqual(['r', 'w_on'])
  })
})

describe('runAgentTurn', () => {
  test('yields text deltas and maps usage → prompt/completion tokens', async () => {
    const gen = runAgentTurn(
      { model: 'm', systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' },
      [], fakeTrace,
      { streamText: () => fakeStream(['Hel', 'lo'], { inputTokens: 9, outputTokens: 2 }) },
    )
    const texts: string[] = []
    let result: { promptTokens: number; completionTokens: number } | undefined
    while (true) { const n = await gen.next(); if (n.done) { result = n.value; break } texts.push(n.value.text) }
    expect(texts).toEqual(['Hel', 'lo'])
    expect(result).toEqual({ promptTokens: 9, completionTokens: 2 })
  })

  test('passes no tools when the workspace has none', async () => {
    let seenTools: unknown = 'unset'
    let seenTransform: unknown
    const gen = runAgentTurn(
      { model: 'm', systemPrompt: 's', messages: [], apiKey: 'k' }, [], fakeTrace,
      { streamText: (o) => {
        seenTools = o.tools
        seenTransform = o.experimental_transform
        return fakeStream(['x'], {})
      } },
    )
    while (!(await gen.next()).done) { /* drain */ }
    expect(seenTools).toBeUndefined()
    expect(seenTransform).toBeFunction()
  })

  test('a customer tool wins a name collision with a skill tool of the same name', async () => {
    let seenTools: Record<string, unknown> | undefined
    const customerTool = mkTool({ name: 'lookup', description: 'customer version' })
    const skillTools = { lookup: { description: 'skill version' } } as unknown as import('ai').ToolSet
    const gen = runAgentTurn(
      { model: 'm', systemPrompt: 's', messages: [], apiKey: 'k' }, [customerTool], fakeTrace,
      { streamText: (o) => { seenTools = o.tools as Record<string, unknown>; return fakeStream(['x'], {}) } },
      skillTools,
    )
    while (!(await gen.next()).done) { /* drain */ }
    expect(seenTools).toBeDefined()
    expect((seenTools!.lookup as { description: string }).description).toBe('customer version')
  })

  test('passes the skill tool set through when there are no customer tools', async () => {
    let seenTools: Record<string, unknown> | undefined
    const skillTools = { web_search: { description: 'search' } } as unknown as import('ai').ToolSet
    const gen = runAgentTurn(
      { model: 'm', systemPrompt: 's', messages: [], apiKey: 'k' }, [], fakeTrace,
      { streamText: (o) => { seenTools = o.tools as Record<string, unknown>; return fakeStream(['x'], {}) } },
      skillTools,
    )
    while (!(await gen.next()).done) { /* drain */ }
    expect(seenTools).toEqual(skillTools as unknown as Record<string, unknown>)
  })

  test('merges MCP tools alongside skill tools', async () => {
    let seenTools: Record<string, unknown> | undefined
    const skillTools = { web_search: { description: 'search' } } as unknown as import('ai').ToolSet
    const mcpTools = { mcp_shopify_refund: { description: 'mcp' } } as unknown as import('ai').ToolSet
    const gen = runAgentTurn(
      { model: 'm', systemPrompt: 's', messages: [], apiKey: 'k' }, [], fakeTrace,
      { streamText: (o) => { seenTools = o.tools as Record<string, unknown>; return fakeStream(['x'], {}) } },
      skillTools,
      mcpTools,
    )
    while (!(await gen.next()).done) { /* drain */ }
    expect(seenTools).toBeDefined()
    expect(Object.keys(seenTools!).sort()).toEqual(['mcp_shopify_refund', 'web_search'])
  })

  test('passes undefined when both customer and skill tool sets are empty', async () => {
    let seenTools: unknown = 'unset'
    const gen = runAgentTurn(
      { model: 'm', systemPrompt: 's', messages: [], apiKey: 'k' }, [], fakeTrace,
      { streamText: (o) => { seenTools = o.tools; return fakeStream(['x'], {}) } },
      {},
    )
    while (!(await gen.next()).done) { /* drain */ }
    expect(seenTools).toBeUndefined()
  })
})
