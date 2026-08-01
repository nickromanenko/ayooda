import { describe, expect, test, afterEach } from 'bun:test'
import { toOpenRouterTools, buildToolRequest, type StoredTool } from './tools'

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

describe('toOpenRouterTools', () => {
  test('maps params to a JSON Schema with a required list', () => {
    const [t] = toOpenRouterTools([readTool])
    expect(t!.function.name).toBe('order_lookup')
    expect(t!.function.parameters).toEqual({
      type: 'object',
      properties: { orderId: { type: 'string', description: 'id' }, verbose: { type: 'boolean', description: 'v' } },
      required: ['orderId'],
      additionalProperties: false,
    })
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
const fakeTrace = { span: () => ({ end: () => {} }) } as unknown as import('../langfuse').LangfuseTrace

async function* streamText(text: string, tokens = 1): AsyncGenerator<{ text: string }, { promptTokens: number; completionTokens: number }, void> {
  if (text) yield { text }
  return { promptTokens: tokens, completionTokens: tokens }
}
async function* streamCall(id: string, name: string, args: string): AsyncGenerator<{ text: string }, { promptTokens: number; completionTokens: number; toolCalls: Array<{ id: string; name: string; arguments: string }> }, void> {
  return { promptTokens: 1, completionTokens: 1, toolCalls: [{ id, name, arguments: args }] }
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
  test('no tools → single stream call, text passes through', async () => {
    const gen = runAgentTurn({ model: 'm', systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' }, [], fakeTrace, { stream: () => streamText('hello', 2) })
    const texts: string[] = []
    let result: { promptTokens: number; completionTokens: number } | undefined
    while (true) { const n = await gen.next(); if (n.done) { result = n.value; break } texts.push(n.value.text) }
    expect(texts).toEqual(['hello'])
    expect(result).toEqual({ promptTokens: 2, completionTokens: 2 })
  })

  test('executes a tool call then streams the final answer, summing tokens', async () => {
    const calls: string[] = []
    let round = 0
    const stream = () => (round++ === 0 ? streamCall('c1', 'n', '{"orderId":"A1"}') : streamText('done', 3))
    const execute = async (_t: StoredTool, a: Record<string, unknown>) => { calls.push(JSON.stringify(a)); return { status: 200, body: 'shipped' } }
    const gen = runAgentTurn({ model: 'm', systemPrompt: 's', messages: [{ role: 'user', content: 'where' }], apiKey: 'k' }, [mkTool({ name: 'n' })], fakeTrace, { stream, execute })
    const texts: string[] = []
    let result: { promptTokens: number; completionTokens: number } | undefined
    while (true) { const nx = await gen.next(); if (nx.done) { result = nx.value; break } texts.push(nx.value.text) }
    expect(calls).toEqual(['{"orderId":"A1"}'])
    expect(texts).toEqual(['done'])
    expect(result!.promptTokens).toBe(4) // 1 (tool round) + 3 (final)
  })

  test('stops after MAX_ROUNDS and makes one tool-free final call', async () => {
    let n = 0
    const toolsSeen: boolean[] = []
    const stream = (p: { tools?: unknown }) => { toolsSeen.push(!!p.tools); n++; return n <= 3 ? streamCall(`c${n}`, 'n', '{}') : streamText('fallback', 1) }
    const execute = async () => ({ status: 200, body: 'x' })
    const gen = runAgentTurn({ model: 'm', systemPrompt: 's', messages: [{ role: 'user', content: 'x' }], apiKey: 'k' }, [mkTool({ name: 'n' })], fakeTrace, { stream, execute })
    let result: { promptTokens: number; completionTokens: number } | undefined
    while (true) { const nx = await gen.next(); if (nx.done) { result = nx.value; break } }
    expect(n).toBe(4) // 3 tool rounds + 1 final
    expect(toolsSeen).toEqual([true, true, true, false]) // final call is tool-free
    expect(result!.completionTokens).toBe(4)
  })
})
