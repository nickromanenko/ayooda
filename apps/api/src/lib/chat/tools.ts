import { lookup as dnsLookup } from 'node:dns/promises'
import type { ToolMethod, ToolParam } from '@ayooda/shared'
import { streamChat, type OpenRouterTool, type ChatParams, type ChatChunk, type ChatResult, type ChatMessage } from '../llm/openrouter'
import { decryptSecret } from '../crypto'
import { isBlockedAddress } from '../tools/ssrf'
import { adminDb } from '../firebase-admin'
import type { LangfuseTrace } from '../langfuse'

export interface StoredTool {
  id: string
  name: string
  description: string
  method: ToolMethod
  urlTemplate: string
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>
  auth: { type: 'none' | 'bearer' | 'header'; headerName?: string; secretEnc?: string }
  kind: 'read' | 'write'
  writeEnabled: boolean
  enabled: boolean
}

export function toOpenRouterTools(tools: StoredTool[]): OpenRouterTool[] {
  return tools.map((t) => {
    const properties: Record<string, { type: string; description: string }> = {}
    const required: string[] = []
    for (const p of t.params) {
      properties[p.name] = { type: p.type, description: p.description }
      if (p.required) required.push(p.name)
    }
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: { type: 'object', properties, required, additionalProperties: false },
      },
    }
  })
}

export interface BuiltRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** Build the HTTP request for a tool call. Throws on an unfilled placeholder. Auth is applied later by executeTool. */
export function buildToolRequest(tool: StoredTool, args: Record<string, unknown>): BuiltRequest {
  const used = new Set<string>()
  const url = tool.urlTemplate.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, name: string) => {
    const v = args[name]
    if (v === undefined || v === null) throw new Error(`missing required param: ${name}`)
    used.add(name)
    return encodeURIComponent(String(v))
  })

  const headers: Record<string, string> = {}
  for (const h of tool.headers) headers[h.key] = h.value

  const leftover: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (!used.has(k) && v !== undefined) leftover[k] = v
  }

  if (tool.method === 'POST' || tool.method === 'PUT' || tool.method === 'PATCH') {
    headers['Content-Type'] = 'application/json'
    return { url, method: tool.method, headers, body: JSON.stringify(leftover) }
  }

  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(leftover)) qs.append(k, String(v))
  const query = qs.toString()
  const full = query ? url + (url.includes('?') ? '&' : '?') + query : url
  return { url: full, method: tool.method, headers }
}

export interface ToolResult { status: number; body: string; error?: string }

type LookupFn = (host: string, opts: { all: true }) => Promise<Array<{ address: string }>>

const TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 32 * 1024

async function readCapped(res: Response, cap: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let out = ''
  let total = 0
  try {
    while (total < cap) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      out += dec.decode(value, { stream: true })
      if (total >= cap) { out += '…[truncated]'; break }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return out
}

/** Execute one tool call, SSRF-guarded. Never throws — all failures become a ToolResult. */
export async function executeTool(
  tool: StoredTool,
  args: Record<string, unknown>,
  deps: { lookup?: LookupFn } = {},
): Promise<ToolResult> {
  const resolve = deps.lookup ?? (dnsLookup as unknown as LookupFn)

  let req: BuiltRequest
  try {
    req = buildToolRequest(tool, args)
  } catch (err) {
    return { status: 0, body: '', error: err instanceof Error ? err.message : 'bad request' }
  }

  let parsed: URL
  try { parsed = new URL(req.url) } catch { return { status: 0, body: '', error: 'invalid url' } }
  if (parsed.protocol !== 'https:') return { status: 0, body: '', error: 'only https is allowed' }

  try {
    const addrs = await resolve(parsed.hostname, { all: true })
    if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) {
      return { status: 0, body: '', error: 'blocked host' }
    }
  } catch {
    return { status: 0, body: '', error: 'dns resolution failed' }
  }

  const headers = { ...req.headers }
  if (tool.auth.type !== 'none' && tool.auth.secretEnc) {
    let secret: string
    try { secret = decryptSecret(tool.auth.secretEnc) } catch { return { status: 0, body: '', error: 'auth secret error' } }
    if (tool.auth.type === 'bearer') headers['Authorization'] = `Bearer ${secret}`
    else if (tool.auth.type === 'header' && tool.auth.headerName) headers[tool.auth.headerName] = secret
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers,
      body: req.body,
      redirect: 'manual',
      signal: controller.signal,
    })
    const body = await readCapped(res, MAX_BODY_BYTES)
    return { status: res.status, body }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { status: 0, body: '', error: 'timeout' }
    return { status: 0, body: '', error: 'request failed' }
  } finally {
    clearTimeout(timer)
  }
}

export const MAX_ROUNDS = 3
export const MAX_CALLS_PER_ROUND = 5

/** Tools the model may see: enabled, and (read OR write-with-writeEnabled). */
export function selectExposedTools(tools: StoredTool[]): StoredTool[] {
  return tools.filter((t) => t.enabled && (t.kind === 'read' || t.writeEnabled === true))
}

export async function loadTools(workspaceId: string): Promise<StoredTool[]> {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/tools`).where('enabled', '==', true).get()
  const tools = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StoredTool, 'id'>) }))
  return selectExposedTools(tools)
}

interface RunDeps {
  stream?: (params: ChatParams) => AsyncGenerator<ChatChunk, ChatResult, void>
  execute?: (tool: StoredTool, args: Record<string, unknown>) => Promise<ToolResult>
}

function safeParse(json: string): Record<string, unknown> {
  try { const v = JSON.parse(json || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

/**
 * Channel-agnostic agent turn with a bounded tool-resolution loop. Delegates to streamChat
 * via yield* so text still streams to the caller; between rounds it executes any tool calls
 * the model requested and feeds the results back. Falls back to one tool-free call after MAX_ROUNDS.
 */
export async function* runAgentTurn(
  chatParams: ChatParams,
  tools: StoredTool[],
  trace: LangfuseTrace,
  deps: RunDeps = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
  const stream = deps.stream ?? streamChat
  const execute = deps.execute ?? executeTool
  const schema = toOpenRouterTools(tools)
  const byName = new Map(tools.map((t) => [t.name, t]))
  let messages: ChatMessage[] = chatParams.messages
  let promptTokens = 0
  let completionTokens = 0

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = yield* stream({ ...chatParams, messages, tools: schema.length ? schema : undefined })
    promptTokens += result.promptTokens
    completionTokens += result.completionTokens
    const calls = result.toolCalls ?? []
    if (calls.length === 0) return { promptTokens, completionTokens }

    messages = [
      ...messages,
      {
        role: 'assistant',
        content: null,
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })),
      },
    ]

    for (let i = 0; i < calls.length; i++) {
      const c = calls[i]!
      let content: string
      if (i >= MAX_CALLS_PER_ROUND) {
        content = 'error: too many tool calls in one step'
      } else {
        const tool = byName.get(c.name)
        if (!tool) {
          content = `error: unknown tool ${c.name}`
        } else {
          const span = trace.span({ name: `tool:${c.name}`, input: safeParse(c.arguments) })
          const r = await execute(tool, safeParse(c.arguments))
          span.end({ output: { status: r.status, error: r.error } })
          content = r.error ? `error: ${r.error}` : `status ${r.status}\n${r.body}`
        }
      }
      messages = [...messages, { role: 'tool', tool_call_id: c.id, content }]
    }
  }

  const final = yield* stream({ ...chatParams, messages, tools: undefined })
  return { promptTokens: promptTokens + final.promptTokens, completionTokens: completionTokens + final.completionTokens }
}
