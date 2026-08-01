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
