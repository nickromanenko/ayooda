import { lookup as dnsLookup } from 'node:dns/promises'
import type { ToolMethod, ToolParam, ToolBodyEncoding } from '@ayooda/shared'
import { smoothStream, streamText as aiStreamText, stepCountIs, tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { ChatParams, ChatChunk, ChatResult, ChatMessage } from '../llm/chat'
import { decryptSecret } from '../crypto'
import { isBlockedAddress } from '../tools/ssrf'
import { adminDb } from '../firebase-admin'
import type { LangfuseTrace } from '../langfuse'
import { resolveConnectorAccessTokenEnc } from '../tools/credential'
import { createRuntimeLanguageModel } from '../llm/runtime'

export interface StoredTool {
  id: string
  name: string
  description: string
  method: ToolMethod
  urlTemplate: string
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>
  bodyTemplate?: string
  bodyEncoding?: ToolBodyEncoding
  auth: { type: 'none' | 'bearer' | 'header'; headerName?: string; secretEnc?: string; credentialId?: string }
  kind: 'read' | 'write'
  writeEnabled: boolean
  enabled: boolean
}

export function toAiSdkTools(
  tools: StoredTool[],
  trace: LangfuseTrace,
  execute: (t: StoredTool, args: Record<string, unknown>) => Promise<ToolResult> = executeTool,
): ToolSet {
  const set: ToolSet = {}
  for (const t of tools) {
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const p of t.params) {
      const field: z.ZodTypeAny = p.type === 'number' ? z.number() : p.type === 'boolean' ? z.boolean() : z.string()
      const described = field.describe(p.description)
      shape[p.name] = p.required ? described : described.optional()
    }
    set[t.name] = tool({
      description: t.description,
      inputSchema: z.object(shape),
      execute: async (args: Record<string, unknown>) => {
        const span = trace.span({ name: `tool:${t.name}`, input: args })
        const r = await execute(t, args)
        span.end({ output: { status: r.status, error: r.error } })
        return r.error ? `error: ${r.error}` : `status ${r.status}\n${r.body}`
      },
    })
  }
  return set
}

export interface BuiltRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

function renderBodyTemplate(template: string, args: Record<string, unknown>, used: Set<string>): unknown {
  const parsed = JSON.parse(template) as unknown
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]))
    }
    if (typeof value !== 'string') return value

    const exact = /^\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/.exec(value)
    if (exact) {
      const name = exact[1]!
      const replacement = args[name]
      if (replacement === undefined || replacement === null) throw new Error(`missing required param: ${name}`)
      used.add(name)
      return replacement
    }

    return value.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, name: string) => {
      const replacement = args[name]
      if (replacement === undefined || replacement === null) throw new Error(`missing required param: ${name}`)
      used.add(name)
      return String(replacement)
    })
  }
  return visit(parsed)
}

function formBody(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('form body must be an object')
  const body = new URLSearchParams()
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== null) body.append(key, String(item))
  }
  return body.toString()
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
    const bodyValue = tool.bodyTemplate
      ? renderBodyTemplate(tool.bodyTemplate, args, used)
      : leftover
    if (tool.bodyEncoding === 'form') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      return { url, method: tool.method, headers, body: formBody(bodyValue) }
    }
    headers['Content-Type'] = 'application/json'
    return { url, method: tool.method, headers, body: JSON.stringify(bodyValue) }
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
  if (tool.auth.type !== 'none' && !tool.auth.secretEnc) {
    return { status: 0, body: '', error: 'auth credential missing' }
  }
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

/** Tools the model may see: enabled, and (read OR write-with-writeEnabled). */
export function selectExposedTools(tools: StoredTool[]): StoredTool[] {
  return tools.filter((t) => t.enabled && (t.kind === 'read' || t.writeEnabled === true))
}

export async function loadTools(workspaceId: string, agentId: string): Promise<StoredTool[]> {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/agents/${agentId}/tools`).where('enabled', '==', true).get()
  const tools = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StoredTool, 'id'>) }))
  const credentialIds = [...new Set(tools.map((item) => item.auth.credentialId).filter((id): id is string => !!id))]
  const credentials = new Map<string, string>()
  const resolved = await Promise.all(credentialIds.map(async (id) => [id, await resolveConnectorAccessTokenEnc(workspaceId, id)] as const))
  for (const [id, accessTokenEnc] of resolved) if (accessTokenEnc) credentials.set(id, accessTokenEnc)
  for (const item of tools) {
    if (item.auth.credentialId) item.auth = { ...item.auth, secretEnc: credentials.get(item.auth.credentialId) }
  }
  return selectExposedTools(tools)
}

type StreamResult = { textStream: AsyncIterable<string>; usage: Promise<{ inputTokens?: number; outputTokens?: number }> }
interface RunDeps {
  streamText?: (opts: {
    model: unknown
    system: string
    messages: ChatMessage[]
    tools?: ToolSet
    stopWhen?: unknown
    experimental_transform?: unknown
  }) => StreamResult
  execute?: (t: StoredTool, args: Record<string, unknown>) => Promise<ToolResult>
}

/**
 * Channel-agnostic agent turn. Uses the AI SDK's streamText with the resolved Gateway or
 * OpenAI-compatible runtime to stream text and run the multi-step tool loop natively
 * (stopWhen: stepCountIs(MAX_ROUNDS)).
 * Keeps the AsyncGenerator<ChatChunk, ChatResult> shape so the channels are unchanged.
 */
export async function* runAgentTurn(
  chatParams: ChatParams,
  tools: StoredTool[],
  trace: LangfuseTrace,
  deps: RunDeps = {},
  skillTools: ToolSet = {},
  mcpTools: ToolSet = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
  // The default wrapper swaps the model string for the selected provider model, so an
  // injected streamText (tests) never touches a live provider.
  const run = deps.streamText ?? ((opts) =>
    aiStreamText({
      ...opts,
      model: createRuntimeLanguageModel(
        chatParams.runtime ?? { type: 'gateway', apiKey: chatParams.apiKey ?? '' },
        chatParams.model,
      ),
    } as Parameters<typeof aiStreamText>[0]) as unknown as StreamResult)
  const execute = deps.execute ?? executeTool
  const customerTools = tools.length ? toAiSdkTools(tools, trace, execute) : {}
  for (const name of Object.keys(customerTools)) {
    if (Object.hasOwn(skillTools, name)) console.warn(`[skills] tool name "${name}" shadowed by a customer tool`)
    if (Object.hasOwn(mcpTools, name)) console.warn(`[mcp] tool name "${name}" shadowed by a customer tool`)
  }
  const toolSet: ToolSet = { ...skillTools, ...mcpTools, ...customerTools }
  const result = run({
    model: chatParams.model,
    system: chatParams.systemPrompt,
    messages: chatParams.messages,
    tools: Object.keys(toolSet).length ? toolSet : undefined,
    stopWhen: stepCountIs(MAX_ROUNDS),
    // Gemini and some OpenAI-compatible providers emit very large text deltas.
    // Smooth them into word-sized chunks so every SSE consumer gets visibly
    // progressive output instead of a typing indicator followed by a full reply.
    experimental_transform: smoothStream({ delayInMs: 8, chunking: 'word' }),
  })
  for await (const delta of result.textStream) yield { text: delta }
  const u = await result.usage
  return { promptTokens: u.inputTokens ?? 0, completionTokens: u.outputTokens ?? 0 }
}
