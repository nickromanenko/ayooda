# Custom Tool/Webhook Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace owner define HTTP "tools" the AI agent calls mid-conversation (look up an order, update a record); the LLM decides when to call one, the API executes the request server-side (SSRF-guarded), feeds the result back, and the agent answers using it — on both the widget and Telegram channels.

**Architecture:** OpenRouter function-calling. `streamChat` gains a `tools` param and accumulates `tool_calls` from the stream. A new orchestrator `runAgentTurn` (in `apps/api/src/lib/chat/tools.ts`) delegates to `streamChat` via `yield*` so text still streams to whichever channel consumes it, runs a bounded tool-resolution loop between rounds, and both channels swap `streamChat(...)` → `runAgentTurn(...)`. Tools live in `workspaces/{id}/tools`; an owner-only `/tools` route manages them.

**Tech Stack:** Bun + Hono (api), Firestore (Admin SDK), `node:dns/promises` (SSRF resolution), AES-256-GCM via existing `crypto.ts`, `@ayooda/shared` types, Next.js App Router client page (web). Tests: `bun test`.

## Global Constraints

- **Security baseline (executor, non-negotiable):** HTTPS-only; DNS-resolve the host and reject loopback/private/link-local/ULA/cloud-metadata IPs; `redirect: 'manual'` (never follow 3xx); 10s timeout via `AbortController`; read at most 32KB of the response body (truncate).
- **Turn bounds:** `MAX_ROUNDS = 3` tool-resolution rounds; `MAX_CALLS_PER_ROUND = 5`. When rounds are exhausted with the model still requesting tools, make one final tool-free streaming call so the user still gets an answer.
- **Write opt-in:** a `write` tool is exposed to the model only when `writeEnabled === true`. `read` tools are always exposed (when `enabled`).
- **Secrets:** auth secrets are AES-256-GCM encrypted via `apps/api/src/lib/crypto.ts` (`encryptSecret`/`decryptSecret`, env `API_KEY_ENCRYPTION_SECRET`) and **never returned** by any endpoint (responses carry `hasSecret: boolean`).
- **Tool naming:** `name` matches `^[a-zA-Z0-9_-]{1,48}$`, unique per workspace (it is the LLM function name).
- **Routes:** all `/tools` endpoints are owner-only (`requireAuth` + `requireOwner`). Tools are a per-workspace subcollection `workspaces/{id}/tools`.
- **Both channels go through `prepareTurn`** — do not add tool logic to widget/telegram beyond swapping the generator call.
- **Web caution:** `apps/web/AGENTS.md` warns this is a modified Next.js — the Tools page must mirror the existing dashboard client-page idiom (`'use client'` + `apiRequest`, inline styles), introducing no new framework APIs.
- **Money/consistency:** tool calls do NOT count as conversations; their tokens fold into the existing token counter via the summed `ChatResult`.

---

### Task 1: Shared tool types

**Files:**
- Modify: `packages/shared/src/index.ts` (append a new section)

**Interfaces:**
- Consumes: nothing.
- Produces: `ToolMethod`, `ToolParamType`, `ToolAuthType`, `ToolKind`, `ToolParam`, `ToolAuth`, `ToolDef` (the API↔web contract shape).

- [ ] **Step 1: Add the types**

Append to `packages/shared/src/index.ts`:

```ts
// ---------------------------------------------------------------------------
// Tool / webhook actions
// ---------------------------------------------------------------------------

export type ToolMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type ToolParamType = 'string' | 'number' | 'boolean'
export type ToolAuthType = 'none' | 'bearer' | 'header'
export type ToolKind = 'read' | 'write'

export interface ToolParam {
  name: string
  type: ToolParamType
  description: string
  required: boolean
}

/** Auth as returned to the web (no secret). Storage adds `secretEnc`; requests send `secret` (write-only). */
export interface ToolAuth {
  type: ToolAuthType
  headerName?: string
}

/** The tool as returned by GET /tools — never carries the secret. */
export interface ToolDef {
  id: string
  name: string
  description: string
  method: ToolMethod
  urlTemplate: string
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>
  auth: ToolAuth
  hasSecret: boolean
  kind: ToolKind
  writeEnabled: boolean
  enabled: boolean
}
```

- [ ] **Step 2: Typecheck and build shared**

Run: `pnpm --filter @ayooda/shared typecheck && pnpm --filter @ayooda/shared build`
Expected: PASS, `dist/index.d.ts` regenerated with the new exports (api imports from `dist`).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/dist
git commit -m "feat(shared): tool/webhook action types"
```

---

### Task 2: SSRF address guard

**Files:**
- Create: `apps/api/src/lib/tools/ssrf.ts`
- Test: `apps/api/src/lib/tools/ssrf.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isBlockedAddress(ip: string): boolean` — true when an IPv4/IPv6 literal is loopback, private, link-local, ULA, CGNAT, multicast/reserved, or unparseable (fail-closed).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/tools/ssrf.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { isBlockedAddress } from './ssrf'

describe('isBlockedAddress', () => {
  test('blocks loopback, private, link-local, CGNAT, multicast', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255',
      '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1']) {
      expect(isBlockedAddress(ip)).toBe(true)
    }
  })
  test('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '1.1.1.1']) {
      expect(isBlockedAddress(ip)).toBe(false)
    }
  })
  test('handles IPv6 loopback, ULA, link-local, and mapped IPv4', () => {
    expect(isBlockedAddress('::1')).toBe(true)
    expect(isBlockedAddress('fd00::1')).toBe(true)
    expect(isBlockedAddress('fe80::1')).toBe(true)
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false)
  })
  test('fails closed on garbage', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true)
    expect(isBlockedAddress('999.1.1.1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/tools/ssrf.test.ts`
Expected: FAIL — cannot find module `./ssrf`.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/tools/ssrf.ts`:

```ts
/** True if an IP (v4 or v6 literal) must never be called: loopback, private,
 * link-local, unique-local, CGNAT, multicast/reserved. Unparseable → true (fail closed). */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase()
  if (addr.includes(':')) {
    if (addr === '::1' || addr === '::') return true
    const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mapped) return isBlockedAddress(mapped[1]!)
    if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true // fc00::/7 ULA
    if (/^fe[89ab][0-9a-f]:/.test(addr)) return true // fe80::/10 link-local
    return false
  }
  const parts = addr.split('.')
  if (parts.length !== 4) return true
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = nums as [number, number, number, number]
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // link-local incl. 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a >= 224) return true // multicast + reserved
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/tools/ssrf.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/tools/ssrf.ts apps/api/src/lib/tools/ssrf.test.ts
git commit -m "feat(api): SSRF address guard for tool actions"
```

---

### Task 3: Tool input validation

**Files:**
- Create: `apps/api/src/lib/tools/validate.ts`
- Test: `apps/api/src/lib/tools/validate.test.ts`

**Interfaces:**
- Consumes: shared `ToolMethod`, `ToolParamType`, `ToolAuthType`, `ToolKind`, `ToolParam` (Task 1).
- Produces: `ValidatedTool` interface and `validateToolInput(raw: unknown): { ok: true; value: ValidatedTool } | { ok: false; error: string }`. `ValidatedTool` = the normalized create/update payload with an optional plaintext `secret` (the route encrypts it).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/tools/validate.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { validateToolInput } from './validate'

const base = {
  name: 'order_lookup',
  description: 'Look up an order by id',
  method: 'GET',
  urlTemplate: 'https://api.shop.com/orders/{orderId}',
  params: [{ name: 'orderId', type: 'string', description: 'the id', required: true }],
  headers: [],
  auth: { type: 'none' },
  kind: 'read',
}

describe('validateToolInput', () => {
  test('accepts a valid read tool', () => {
    const r = validateToolInput(base)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name).toBe('order_lookup')
      expect(r.value.writeEnabled).toBe(false)
      expect(r.value.enabled).toBe(true)
    }
  })
  test('rejects a non-https url', () => {
    const r = validateToolInput({ ...base, urlTemplate: 'http://api.shop.com/x' })
    expect(r.ok).toBe(false)
  })
  test('rejects a placeholder with no matching param', () => {
    const r = validateToolInput({ ...base, urlTemplate: 'https://x.com/{missing}' })
    expect(r.ok).toBe(false)
  })
  test('rejects a bad name', () => {
    expect(validateToolInput({ ...base, name: 'bad name!' }).ok).toBe(false)
  })
  test('rejects a duplicate param name', () => {
    const r = validateToolInput({ ...base, params: [base.params[0], base.params[0]], urlTemplate: 'https://x.com/' })
    expect(r.ok).toBe(false)
  })
  test('header auth requires headerName', () => {
    expect(validateToolInput({ ...base, auth: { type: 'header' } }).ok).toBe(false)
    expect(validateToolInput({ ...base, auth: { type: 'header', headerName: 'X-Key', secret: 's' } }).ok).toBe(true)
  })
  test('write tool carries writeEnabled through', () => {
    const r = validateToolInput({ ...base, method: 'POST', kind: 'write', writeEnabled: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.writeEnabled).toBe(true)
  })
  test('rejects a forbidden header key', () => {
    expect(validateToolInput({ ...base, headers: [{ key: 'Host', value: 'x' }] }).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/tools/validate.test.ts`
Expected: FAIL — cannot find module `./validate`.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/tools/validate.ts`:

```ts
import type { ToolMethod, ToolParamType, ToolAuthType, ToolKind, ToolParam } from '@ayooda/shared'

export interface ValidatedTool {
  name: string
  description: string
  method: ToolMethod
  urlTemplate: string
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>
  auth: { type: ToolAuthType; headerName?: string }
  secret?: string
  kind: ToolKind
  writeEnabled: boolean
  enabled: boolean
}

const NAME_RE = /^[a-zA-Z0-9_-]{1,48}$/
const PARAM_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const METHODS: ToolMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const PARAM_TYPES: ToolParamType[] = ['string', 'number', 'boolean']
const AUTH_TYPES: ToolAuthType[] = ['none', 'bearer', 'header']
const FORBIDDEN_HEADERS = new Set(['host', 'content-length'])

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })

export function validateToolInput(
  raw: unknown,
): { ok: true; value: ValidatedTool } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Invalid request body.')
  const o = raw as Record<string, unknown>

  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!NAME_RE.test(name)) return fail('Name must be 1–48 chars: letters, numbers, _ or -.')

  const description = typeof o.description === 'string' ? o.description.trim() : ''
  if (description.length < 1 || description.length > 1024) return fail('Description must be 1–1024 characters.')

  const method = o.method as ToolMethod
  if (!METHODS.includes(method)) return fail('Method must be one of GET, POST, PUT, PATCH, DELETE.')

  const urlTemplate = typeof o.urlTemplate === 'string' ? o.urlTemplate.trim() : ''
  let url: URL
  try { url = new URL(urlTemplate.replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, 'x')) } catch { return fail('URL is not valid.') }
  if (url.protocol !== 'https:') return fail('URL must use https://.')

  const rawParams = Array.isArray(o.params) ? o.params : []
  if (rawParams.length > 20) return fail('A tool may have at most 20 parameters.')
  const params: ToolParam[] = []
  const seen = new Set<string>()
  for (const p of rawParams) {
    if (!p || typeof p !== 'object') return fail('Each parameter must be an object.')
    const pp = p as Record<string, unknown>
    const pname = typeof pp.name === 'string' ? pp.name.trim() : ''
    if (!PARAM_RE.test(pname)) return fail(`Parameter name "${pname}" is invalid.`)
    if (seen.has(pname)) return fail(`Duplicate parameter name "${pname}".`)
    seen.add(pname)
    const ptype = pp.type as ToolParamType
    if (!PARAM_TYPES.includes(ptype)) return fail(`Parameter "${pname}" has an invalid type.`)
    const pdesc = typeof pp.description === 'string' ? pp.description.trim() : ''
    if (pdesc.length > 256) return fail(`Parameter "${pname}" description is too long.`)
    params.push({ name: pname, type: ptype, description: pdesc, required: pp.required === true })
  }

  // Every {placeholder} in the URL must be a declared param.
  const placeholders = [...urlTemplate.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!)
  for (const ph of placeholders) {
    if (!seen.has(ph)) return fail(`URL placeholder {${ph}} has no matching parameter.`)
  }

  const rawHeaders = Array.isArray(o.headers) ? o.headers : []
  if (rawHeaders.length > 20) return fail('A tool may have at most 20 headers.')
  const headers: Array<{ key: string; value: string }> = []
  for (const h of rawHeaders) {
    if (!h || typeof h !== 'object') return fail('Each header must be an object.')
    const hh = h as Record<string, unknown>
    const key = typeof hh.key === 'string' ? hh.key.trim() : ''
    const value = typeof hh.value === 'string' ? hh.value : ''
    if (!key) return fail('Header keys cannot be empty.')
    if (FORBIDDEN_HEADERS.has(key.toLowerCase())) return fail(`Header "${key}" cannot be overridden.`)
    headers.push({ key, value })
  }

  const rawAuth = (o.auth ?? { type: 'none' }) as Record<string, unknown>
  const authType = rawAuth.type as ToolAuthType
  if (!AUTH_TYPES.includes(authType)) return fail('Auth type must be none, bearer, or header.')
  const auth: ValidatedTool['auth'] = { type: authType }
  if (authType === 'header') {
    const headerName = typeof rawAuth.headerName === 'string' ? rawAuth.headerName.trim() : ''
    if (!headerName) return fail('Header auth requires a header name.')
    auth.headerName = headerName
  }
  const secret = typeof rawAuth.secret === 'string' && rawAuth.secret.length > 0 ? rawAuth.secret : undefined

  const kind = o.kind as ToolKind
  if (kind !== 'read' && kind !== 'write') return fail('Kind must be read or write.')
  const writeEnabled = kind === 'write' && o.writeEnabled === true
  const enabled = o.enabled === undefined ? true : o.enabled === true

  return { ok: true, value: { name, description, method, urlTemplate, params, headers, auth, secret, kind, writeEnabled, enabled } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/tools/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/tools/validate.ts apps/api/src/lib/tools/validate.test.ts
git commit -m "feat(api): tool input validation"
```

---

### Task 4: OpenRouter tool-calling support

**Files:**
- Modify: `apps/api/src/lib/llm/openrouter.ts`
- Test: `apps/api/src/lib/llm/openrouter.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: exported `ToolCall = { id: string; name: string; arguments: string }`; `OpenRouterTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }`; widened `ChatMessage` (adds assistant-with-`tool_calls` and `tool` role); `ChatParams.tools?: OpenRouterTool[]`; `ChatResult.toolCalls?: ToolCall[]`. Existing `streamChat` text streaming unchanged.

- [ ] **Step 1: Write the failing test** (append to `openrouter.test.ts`)

```ts
import { describe as describe2, expect as expect2, test as test2, afterEach as afterEach2 } from 'bun:test'
import { streamChat as streamChat2 } from './openrouter'

const realFetch2 = globalThis.fetch
afterEach2(() => { globalThis.fetch = realFetch2 })

describe2('streamChat tool-calling', () => {
  test2('accumulates tool_calls deltas across frames and sends tools in the body', async () => {
    let sentBody: any = null
    const body =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"order_lookup","arguments":"{\\"or"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"derId\\":\\"A1\\"}"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":9,"completion_tokens":4}}\n\n' +
      'data: [DONE]\n\n'
    globalThis.fetch = (async (_url: string, init: any) => {
      sentBody = JSON.parse(init.body)
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }) as unknown as typeof fetch

    const tools = [{ type: 'function' as const, function: { name: 'order_lookup', description: 'd', parameters: { type: 'object', properties: {}, required: [] } } }]
    const gen = streamChat2({ model: 'x/y', systemPrompt: 's', messages: [{ role: 'user', content: 'where is A1' }], apiKey: 'k', tools })
    const texts: string[] = []
    let result: any
    while (true) { const n = await gen.next(); if (n.done) { result = n.value; break } texts.push(n.value.text) }
    expect2(texts).toEqual([])
    expect2(sentBody.tools).toHaveLength(1)
    expect2(result.toolCalls).toEqual([{ id: 'call_1', name: 'order_lookup', arguments: '{"orderId":"A1"}' }])
    expect2(result.promptTokens).toBe(9)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/llm/openrouter.test.ts`
Expected: FAIL — `sentBody.tools` undefined and `result.toolCalls` undefined.

- [ ] **Step 3: Implement**

Rewrite `apps/api/src/lib/llm/openrouter.ts`:

```ts
export interface ToolCall { id: string; name: string; arguments: string }
export interface OpenRouterTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

interface WireToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatParams {
  model: string
  systemPrompt: string
  messages: ChatMessage[]
  apiKey: string
  tools?: OpenRouterTool[]
}
export interface ChatChunk { text: string }
export interface ChatResult { promptTokens: number; completionTokens: number; toolCalls?: ToolCall[] }

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export async function* streamChat(
  params: ChatParams,
): AsyncGenerator<ChatChunk, ChatResult, void> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ayooda.live',
      'X-Title': 'Ayooda',
    },
    body: JSON.stringify({
      model: params.model,
      messages: [{ role: 'system', content: params.systemPrompt }, ...params.messages],
      stream: true,
      stream_options: { include_usage: true },
      ...(params.tools?.length ? { tools: params.tools } : {}),
    }),
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter error ${res.status}: ${detail.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let promptTokens = 0
  let completionTokens = 0
  const toolAcc: Array<{ id: string; name: string; arguments: string }> = []

  const parseFrame = (frame: string): { text?: string; done?: boolean } => {
    const line = frame.split('\n').find((l) => l.startsWith('data:'))
    if (!line) return {}
    const data = line.slice(5).trim()
    if (data === '[DONE]') return { done: true }
    let parsed: {
      choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      error?: { message?: string }
    }
    try { parsed = JSON.parse(data) } catch { return {} }
    if (parsed.error) throw new Error(`OpenRouter stream error: ${parsed.error.message ?? 'unknown'}`)
    if (parsed.usage) {
      promptTokens = parsed.usage.prompt_tokens ?? promptTokens
      completionTokens = parsed.usage.completion_tokens ?? completionTokens
    }
    const tcs = parsed.choices?.[0]?.delta?.tool_calls
    if (tcs) {
      for (const tc of tcs) {
        const idx = tc.index ?? 0
        const cur = (toolAcc[idx] ??= { id: '', name: '', arguments: '' })
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name = tc.function.name
        if (tc.function?.arguments) cur.arguments += tc.function.arguments
      }
    }
    const text = parsed.choices?.[0]?.delta?.content
    return text ? { text } : {}
  }

  try {
    let finished = false
    while (!finished) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      const toSplit = done ? buffer + '\n\n' : buffer
      const frames = toSplit.split('\n\n')
      buffer = done ? '' : (frames.pop() ?? '')
      for (const frame of frames) {
        const r = parseFrame(frame)
        if (r.text) yield { text: r.text }
        if (r.done) { finished = true; break }
      }
      if (done) break
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  const toolCalls = toolAcc.filter((t) => t && t.id)
  return { promptTokens, completionTokens, ...(toolCalls.length ? { toolCalls } : {}) }
}
```

- [ ] **Step 4: Run the full openrouter test to verify all pass**

Run: `cd apps/api && bun test src/lib/llm/openrouter.test.ts`
Expected: PASS — the four original tests plus the new tool-calling test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/llm/openrouter.ts apps/api/src/lib/llm/openrouter.test.ts
git commit -m "feat(api): OpenRouter tool-calling in streamChat"
```

---

### Task 5: Tool schema + request builders

**Files:**
- Create: `apps/api/src/lib/chat/tools.ts` (add builders + `StoredTool`; more added in Tasks 6–7)
- Test: `apps/api/src/lib/chat/tools.test.ts`

**Interfaces:**
- Consumes: shared `ToolMethod`, `ToolParam` (Task 1); `OpenRouterTool` from `../llm/openrouter` (Task 4).
- Produces: `StoredTool` interface; `toOpenRouterTools(tools: StoredTool[]): OpenRouterTool[]`; `BuiltRequest` interface; `buildToolRequest(tool: StoredTool, args: Record<string, unknown>): BuiltRequest` (throws `Error('missing required param: <name>')` on an unfilled placeholder; does NOT apply auth).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/chat/tools.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/chat/tools.test.ts`
Expected: FAIL — cannot find module `./tools`.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/chat/tools.ts`:

```ts
import type { ToolMethod, ToolParam } from '@ayooda/shared'
import type { OpenRouterTool } from '../llm/openrouter'

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/chat/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat/tools.ts apps/api/src/lib/chat/tools.test.ts
git commit -m "feat(api): tool JSON-schema + request builders"
```

---

### Task 6: Tool executor (SSRF-guarded HTTP)

**Files:**
- Modify: `apps/api/src/lib/chat/tools.ts` (add `executeTool` + `ToolResult`)
- Test: `apps/api/src/lib/chat/tools.test.ts` (extend)

**Interfaces:**
- Consumes: `StoredTool`, `buildToolRequest` (Task 5); `isBlockedAddress` from `../tools/ssrf` (Task 2); `decryptSecret` from `../crypto`.
- Produces: `ToolResult = { status: number; body: string; error?: string }`; `executeTool(tool: StoredTool, args: Record<string, unknown>, deps?: { lookup?: LookupFn }): Promise<ToolResult>`. Never throws — all failures become a `ToolResult`. `LookupFn = (host: string, opts: { all: true }) => Promise<Array<{ address: string }>>`.

- [ ] **Step 1: Write the failing test** (append to `tools.test.ts`)

```ts
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
```

Import note: the extended block reuses `afterEach` — ensure the file's top import line is `import { describe, expect, test, afterEach } from 'bun:test'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/chat/tools.test.ts`
Expected: FAIL — `executeTool` is not exported.

- [ ] **Step 3: Implement** (append to `apps/api/src/lib/chat/tools.ts`)

```ts
import { lookup as dnsLookup } from 'node:dns/promises'
import { decryptSecret } from '../crypto'
import { isBlockedAddress } from '../tools/ssrf'

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/chat/tools.test.ts`
Expected: PASS (builders + executor).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat/tools.ts apps/api/src/lib/chat/tools.test.ts
git commit -m "feat(api): SSRF-guarded tool executor"
```

---

### Task 7: Orchestrator (runAgentTurn) + tool loading

**Files:**
- Modify: `apps/api/src/lib/chat/tools.ts` (add `selectExposedTools`, `loadTools`, `runAgentTurn`, `MAX_ROUNDS`, `MAX_CALLS_PER_ROUND`)
- Test: `apps/api/src/lib/chat/tools.test.ts` (extend)

**Interfaces:**
- Consumes: `streamChat`, `ChatParams`, `ChatChunk`, `ChatResult`, `ChatMessage`, `ToolCall` from `../llm/openrouter` (Task 4); `executeTool`, `toOpenRouterTools`, `StoredTool` (Tasks 5–6); `LangfuseTrace` from `../langfuse`; `adminDb` from `../firebase-admin`.
- Produces: `MAX_ROUNDS = 3`, `MAX_CALLS_PER_ROUND = 5`; `selectExposedTools(tools: StoredTool[]): StoredTool[]` (enabled + (read OR writeEnabled)); `loadTools(workspaceId: string): Promise<StoredTool[]>`; `runAgentTurn(chatParams, tools, trace, deps?): AsyncGenerator<ChatChunk, ChatResult, void>` where `deps` = `{ stream?, execute? }` (injectable for tests, default to the real `streamChat`/`executeTool`).

- [ ] **Step 1: Write the failing test** (append to `tools.test.ts`)

```ts
import { selectExposedTools, runAgentTurn, type StoredTool as ST } from './tools'

const tool = (over: Partial<ST>): ST => ({
  id: 'x', name: 'n', description: 'd', method: 'GET', urlTemplate: 'https://a.com/', params: [],
  headers: [], auth: { type: 'none' }, kind: 'read', writeEnabled: false, enabled: true, ...over,
})
const fakeTrace = { span: () => ({ end: () => {} }) } as any

async function* streamText(text: string, tokens = 1): AsyncGenerator<{ text: string }, any, void> {
  if (text) yield { text }
  return { promptTokens: tokens, completionTokens: tokens }
}
async function* streamCall(id: string, name: string, args: string): AsyncGenerator<{ text: string }, any, void> {
  return { promptTokens: 1, completionTokens: 1, toolCalls: [{ id, name, arguments: args }] }
}

describe('selectExposedTools', () => {
  test('exposes enabled read tools and write tools only when writeEnabled', () => {
    const list = [
      tool({ name: 'r', kind: 'read', enabled: true }),
      tool({ name: 'w_off', kind: 'write', writeEnabled: false, enabled: true }),
      tool({ name: 'w_on', kind: 'write', writeEnabled: true, enabled: true }),
      tool({ name: 'r_disabled', kind: 'read', enabled: false }),
    ]
    expect(selectExposedTools(list).map((t) => t.name).sort()).toEqual(['r', 'w_on'])
  })
})

describe('runAgentTurn', () => {
  test('no tools → single stream call, text passes through', async () => {
    const gen = runAgentTurn({ model: 'm', systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' }, [], fakeTrace, { stream: () => streamText('hello', 2) })
    const texts: string[] = []
    let result: any
    while (true) { const n = await gen.next(); if (n.done) { result = n.value; break } texts.push(n.value.text) }
    expect(texts).toEqual(['hello'])
    expect(result).toEqual({ promptTokens: 2, completionTokens: 2 })
  })

  test('executes a tool call then streams the final answer, summing tokens', async () => {
    const calls: string[] = []
    let round = 0
    const stream = () => (round++ === 0 ? streamCall('c1', 'n', '{"orderId":"A1"}') : streamText('done', 3))
    const execute = async (_t: ST, a: Record<string, unknown>) => { calls.push(JSON.stringify(a)); return { status: 200, body: 'shipped' } }
    const gen = runAgentTurn({ model: 'm', systemPrompt: 's', messages: [{ role: 'user', content: 'where' }], apiKey: 'k' }, [tool({ name: 'n' })], fakeTrace, { stream, execute })
    const texts: string[] = []
    let result: any
    while (true) { const nx = await gen.next(); if (nx.done) { result = nx.value; break } texts.push(nx.value.text) }
    expect(calls).toEqual(['{"orderId":"A1"}'])
    expect(texts).toEqual(['done'])
    expect(result.promptTokens).toBe(4) // 1 (tool round) + 3 (final)
  })

  test('stops after MAX_ROUNDS and makes one tool-free final call', async () => {
    let n = 0
    const toolsSeen: boolean[] = []
    const stream = (p: any) => { toolsSeen.push(!!p.tools); n++; return n <= 3 ? streamCall(`c${n}`, 'n', '{}') : streamText('fallback', 1) }
    const execute = async () => ({ status: 200, body: 'x' })
    const gen = runAgentTurn({ model: 'm', systemPrompt: 's', messages: [{ role: 'user', content: 'x' }], apiKey: 'k' }, [tool({ name: 'n' })], fakeTrace, { stream, execute })
    let result: any
    while (true) { const nx = await gen.next(); if (nx.done) { result = nx.value; break } }
    expect(n).toBe(4) // 3 tool rounds + 1 final
    expect(toolsSeen).toEqual([true, true, true, false]) // final call is tool-free
    expect(result.completionTokens).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/chat/tools.test.ts`
Expected: FAIL — `selectExposedTools`/`runAgentTurn` not exported.

- [ ] **Step 3: Implement** (append to `apps/api/src/lib/chat/tools.ts`)

```ts
import { adminDb } from '../firebase-admin'
import { streamChat, type ChatParams, type ChatChunk, type ChatResult, type ChatMessage } from '../llm/openrouter'
import type { LangfuseTrace } from '../langfuse'

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
```

Note: `ToolCall` is consumed via `result.toolCalls` (typed by `ChatResult`), so no extra import is needed.

- [ ] **Step 4: Run the full tools test to verify all pass**

Run: `cd apps/api && bun test src/lib/chat/tools.test.ts`
Expected: PASS (builders + executor + orchestrator + selectExposedTools).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat/tools.ts apps/api/src/lib/chat/tools.test.ts
git commit -m "feat(api): runAgentTurn tool-resolution loop + loadTools"
```

---

### Task 8: Wire tools into prepareTurn + both channels

**Files:**
- Modify: `apps/api/src/lib/chat/agent-turn.ts` (load tools, add to `ReadyTurn`)
- Modify: `apps/api/src/routes/widget.ts` (swap `streamChat` → `runAgentTurn`)
- Modify: `apps/api/src/routes/telegram.ts` (swap `streamChat` → `runAgentTurn`)

**Interfaces:**
- Consumes: `loadTools`, `runAgentTurn`, `StoredTool` from `../lib/chat/tools` (Task 7); existing `prepareTurn` `ReadyTurn`.
- Produces: `ReadyTurn.tools: StoredTool[]`.

- [ ] **Step 1: agent-turn.ts — add tools to ReadyTurn**

In `apps/api/src/lib/chat/agent-turn.ts`:

Add to the imports:

```ts
import { loadTools, type StoredTool } from './tools'
```

Add the field to the `ReadyTurn` interface (after `llmModel: string`):

```ts
  llmModel: string
  tools: StoredTool[]
  persist: (reply: string, promptTokens: number, completionTokens: number) => Promise<string>
```

Load tools (non-fatal) just before the final `return`, after `fullSystemPrompt` is built:

```ts
  let tools: StoredTool[] = []
  try {
    tools = await loadTools(workspaceId)
  } catch (err) {
    console.warn('[agent-turn] tool load failed:', err)
  }
```

Add `tools` to the returned object:

```ts
  return {
    kind: 'ready',
    chatParams: { model: llmModel, systemPrompt: fullSystemPrompt, messages: chatMessages, apiKey: keyResult.apiKey },
    sources,
    trace,
    llmModel,
    tools,
    persist,
  }
```

- [ ] **Step 2: widget.ts — use runAgentTurn**

In `apps/api/src/routes/widget.ts`: replace the import line `import { streamChat } from '../lib/llm/openrouter'` with:

```ts
import { runAgentTurn } from '../lib/chat/tools'
```

Change the destructure to include `tools`:

```ts
  const { chatParams, sources, trace, llmModel, tools, persist } = prepared
```

Change the generator construction inside `streamSSE` from `const gen = streamChat(chatParams)` to:

```ts
      const gen = runAgentTurn(chatParams, tools, trace)
```

(The `while (true) { gen.next() ... }` loop and everything else stay unchanged — `runAgentTurn` yields `ChatChunk` and returns `ChatResult` exactly like `streamChat`.)

- [ ] **Step 3: telegram.ts — use runAgentTurn**

In `apps/api/src/routes/telegram.ts`: replace `import { streamChat } from '../lib/llm/openrouter'` with:

```ts
import { runAgentTurn } from '../lib/chat/tools'
```

Change `const gen = streamChat(prepared.chatParams)` to:

```ts
      const gen = runAgentTurn(prepared.chatParams, prepared.tools, prepared.trace)
```

- [ ] **Step 4: Typecheck, build, and run the api test suite**

Run: `cd apps/api && bunx tsc --noEmit && bun test`
Expected: PASS — no type errors; all unit tests green (nothing references the removed `streamChat` import in widget/telegram).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat/agent-turn.ts apps/api/src/routes/widget.ts apps/api/src/routes/telegram.ts
git commit -m "feat(api): route both channels through runAgentTurn with workspace tools"
```

---

### Task 9: /tools API route

**Files:**
- Create: `apps/api/src/routes/tools.ts`
- Modify: `apps/api/src/index.ts` (mount at `/tools`)

**Interfaces:**
- Consumes: `requireAuth`, `requireOwner`, `AuthVariables` (middleware); `validateToolInput`, `ValidatedTool` (Task 3); `executeTool`, `StoredTool` (Tasks 5–6); `encryptSecret` (`../lib/crypto`); shared `ToolDef` (Task 1); `adminDb`.
- Produces: a Hono router mounted at `/tools` with `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/test`.

- [ ] **Step 1: Implement the route**

Create `apps/api/src/routes/tools.ts`:

```ts
import { Hono } from 'hono'
import type { DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { encryptSecret } from '../lib/crypto'
import { validateToolInput, type ValidatedTool } from '../lib/tools/validate'
import { executeTool, type StoredTool } from '../lib/chat/tools'
import type { ToolDef } from '@ayooda/shared'

const tools = new Hono<{ Variables: AuthVariables }>()
tools.use('*', requireAuth)
tools.use('*', requireOwner)

function toToolDef(id: string, d: DocumentData): ToolDef {
  return {
    id,
    name: d.name,
    description: d.description,
    method: d.method,
    urlTemplate: d.urlTemplate,
    params: d.params ?? [],
    headers: d.headers ?? [],
    auth: { type: d.auth?.type ?? 'none', ...(d.auth?.headerName ? { headerName: d.auth.headerName } : {}) },
    hasSecret: !!d.auth?.secretEnc,
    kind: d.kind,
    writeEnabled: !!d.writeEnabled,
    enabled: d.enabled !== false,
  }
}

function buildAuth(v: ValidatedTool): { type: string; headerName?: string; secretEnc?: string } {
  if (v.auth.type === 'none') return { type: 'none' }
  const out: { type: string; headerName?: string; secretEnc?: string } = { type: v.auth.type }
  if (v.auth.type === 'header' && v.auth.headerName) out.headerName = v.auth.headerName
  if (v.secret) out.secretEnc = encryptSecret(v.secret)
  return out
}

function toStoredTool(id: string, d: DocumentData): StoredTool {
  return {
    id, name: d.name, description: d.description, method: d.method, urlTemplate: d.urlTemplate,
    params: d.params ?? [], headers: d.headers ?? [], auth: d.auth ?? { type: 'none' },
    kind: d.kind, writeEnabled: !!d.writeEnabled, enabled: d.enabled !== false,
  }
}

/** GET /tools — list this workspace's tools (never returns secrets). */
tools.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const snap = await adminDb.collection(`workspaces/${ws}/tools`).get()
  return c.json({ tools: snap.docs.map((d) => toToolDef(d.id, d.data())) })
})

/** POST /tools — create a tool. */
tools.post('/', async (c) => {
  const ws = c.get('workspaceId')
  const result = validateToolInput(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const v = result.value

  const dup = await adminDb.collection(`workspaces/${ws}/tools`).where('name', '==', v.name).limit(1).get()
  if (!dup.empty) return c.json({ error: 'A tool with that name already exists.' }, 409)

  const doc = {
    name: v.name, description: v.description, method: v.method, urlTemplate: v.urlTemplate,
    params: v.params, headers: v.headers, auth: buildAuth(v),
    kind: v.kind, writeEnabled: v.writeEnabled, enabled: v.enabled,
    createdAt: new Date(), updatedAt: new Date(),
  }
  const ref = await adminDb.collection(`workspaces/${ws}/tools`).add(doc)
  return c.json(toToolDef(ref.id, doc))
})

/** PUT /tools/:id — update a tool (keeps the existing secret if none supplied). */
tools.put('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = adminDb.doc(`workspaces/${ws}/tools/${id}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Tool not found' }, 404)

  const result = validateToolInput(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const v = result.value

  const dup = await adminDb.collection(`workspaces/${ws}/tools`).where('name', '==', v.name).limit(1).get()
  if (!dup.empty && dup.docs[0]!.id !== id) return c.json({ error: 'A tool with that name already exists.' }, 409)

  const existing = snap.data()!
  let auth = buildAuth(v)
  // Keep the existing secret when the type still needs one and no new secret was supplied.
  if (v.auth.type !== 'none' && !v.secret && existing.auth?.secretEnc) {
    auth = { ...auth, secretEnc: existing.auth.secretEnc }
  }

  const doc = {
    name: v.name, description: v.description, method: v.method, urlTemplate: v.urlTemplate,
    params: v.params, headers: v.headers, auth,
    kind: v.kind, writeEnabled: v.writeEnabled, enabled: v.enabled, updatedAt: new Date(),
  }
  await ref.update(doc)
  return c.json(toToolDef(id, { ...existing, ...doc }))
})

/** DELETE /tools/:id — idempotent. */
tools.delete('/:id', async (c) => {
  const ws = c.get('workspaceId')
  await adminDb.doc(`workspaces/${ws}/tools/${c.req.param('id')}`).delete()
  return c.json({ ok: true })
})

/** POST /tools/:id/test { args } — run the tool through the guarded executor. */
tools.post('/:id/test', async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const snap = await adminDb.doc(`workspaces/${ws}/tools/${id}`).get()
  if (!snap.exists) return c.json({ error: 'Tool not found' }, 404)
  const body = await c.req.json<{ args?: Record<string, unknown> }>().catch(() => ({} as { args?: Record<string, unknown> }))
  const r = await executeTool(toStoredTool(id, snap.data()!), body.args ?? {})
  return c.json(r)
})

export default tools
```

- [ ] **Step 2: Mount the route in index.ts**

In `apps/api/src/index.ts`, add the import alongside the others:

```ts
import toolRoutes from './routes/tools'
```

And mount it with the other authed routes (after `app.route('/conversations', conversationRoutes)`):

```ts
app.route('/tools', toolRoutes)
```

- [ ] **Step 3: Typecheck and build**

Run: `cd apps/api && bunx tsc --noEmit && bun build src/index.ts --outfile /dev/null --target bun`
Expected: PASS — no type errors, bundles cleanly.

- [ ] **Step 4: Verify the route is mounted**

Run: `cd apps/api && grep -n "toolRoutes" src/index.ts`
Expected: two matches — the `import toolRoutes from './routes/tools'` line and the `app.route('/tools', toolRoutes)` line. (Booting the full app for an HTTP smoke test is deferred to the Live E2E — `firebase-admin` init needs credentials not present in a bare run.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/tools.ts apps/api/src/index.ts
git commit -m "feat(api): owner-only /tools CRUD + test endpoint"
```

---

### Task 10: Dashboard Tools page + nav

**Files:**
- Modify: `apps/web/src/components/dashboard/Sidebar.tsx` (add the owner-only Tools link)
- Create: `apps/web/src/app/dashboard/tools/page.tsx`

**Interfaces:**
- Consumes: `apiRequest` from `@/lib/api`; the `/tools` endpoints (Task 9); shared `ToolDef`, `ToolMethod`, `ToolParamType`, `ToolAuthType`, `ToolKind` (Task 1).
- Produces: the Tools UI. No exports consumed elsewhere.

**Note:** `apps/web/AGENTS.md` warns this is a modified Next.js — this page mirrors the existing `dashboard/team/page.tsx` idiom exactly (`'use client'`, `apiRequest`, inline styles). Do not introduce server components, route handlers, or other framework APIs.

- [ ] **Step 1: Add the Tools nav link (owner-only)**

In `apps/web/src/components/dashboard/Sidebar.tsx`: add `Wrench` to the `lucide-react` import, then add a nav item to `navItems` (which is already hidden for members):

```ts
  { label: 'Channels', href: '/dashboard/channels', icon: Radio },
  { label: 'Tools', href: '/dashboard/tools', icon: Wrench },
```

- [ ] **Step 2: Create the Tools page**

Create `apps/web/src/app/dashboard/tools/page.tsx`:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Trash2, Plus, Play } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import type { ToolDef, ToolMethod, ToolParamType, ToolAuthType, ToolKind } from '@ayooda/shared'

const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20 }
const label: React.CSSProperties = { fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }
const input: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }
const row: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 8 }

interface ParamRow { name: string; type: ToolParamType; description: string; required: boolean }
interface HeaderRow { key: string; value: string }
interface FormState {
  id: string | null
  name: string; description: string; method: ToolMethod; urlTemplate: string
  params: ParamRow[]; headers: HeaderRow[]
  authType: ToolAuthType; headerName: string; secret: string; hasSecret: boolean
  kind: ToolKind; writeEnabled: boolean; enabled: boolean
}

const emptyForm: FormState = {
  id: null, name: '', description: '', method: 'GET', urlTemplate: '',
  params: [], headers: [], authType: 'none', headerName: '', secret: '', hasSecret: false,
  kind: 'read', writeEnabled: false, enabled: true,
}

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolDef[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [testArgs, setTestArgs] = useState('{}')
  const [testResult, setTestResult] = useState<string>('')
  const [testing, setTesting] = useState(false)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('/tools')
      if (res.ok) { const d = await res.json() as { tools: ToolDef[] }; setTools(d.tools) }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  function startCreate() { setForm({ ...emptyForm }); setError(''); setTestResult(''); setTestArgs('{}') }
  function startEdit(t: ToolDef) {
    setForm({
      id: t.id, name: t.name, description: t.description, method: t.method, urlTemplate: t.urlTemplate,
      params: t.params.map((p) => ({ ...p })), headers: t.headers.map((h) => ({ ...h })),
      authType: t.auth.type, headerName: t.auth.headerName ?? '', secret: '', hasSecret: t.hasSecret,
      kind: t.kind, writeEnabled: t.writeEnabled, enabled: t.enabled,
    })
    setError(''); setTestResult(''); setTestArgs('{}')
  }

  function payload(f: FormState) {
    return {
      name: f.name.trim(), description: f.description.trim(), method: f.method, urlTemplate: f.urlTemplate.trim(),
      params: f.params, headers: f.headers.filter((h) => h.key.trim()),
      auth: { type: f.authType, ...(f.authType === 'header' ? { headerName: f.headerName.trim() } : {}), ...(f.secret ? { secret: f.secret } : {}) },
      kind: f.kind, writeEnabled: f.kind === 'write' ? f.writeEnabled : false, enabled: f.enabled,
    }
  }

  async function save() {
    if (!form) return
    setSaving(true); setError('')
    try {
      const res = form.id
        ? await apiRequest(`/tools/${form.id}`, { method: 'PUT', body: JSON.stringify(payload(form)) })
        : await apiRequest('/tools', { method: 'POST', body: JSON.stringify(payload(form)) })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save the tool'); return }
      setForm(null); await load()
    } finally { setSaving(false) }
  }

  async function runTest() {
    if (!form?.id) { setTestResult('Save the tool before testing.'); return }
    setTesting(true); setTestResult('')
    let args: unknown = {}
    try { args = JSON.parse(testArgs || '{}') } catch { setTestResult('Sample args must be valid JSON.'); setTesting(false); return }
    try {
      const res = await apiRequest(`/tools/${form.id}/test`, { method: 'POST', body: JSON.stringify({ args }) })
      const d = await res.json().catch(() => ({}))
      setTestResult(JSON.stringify(d, null, 2))
    } finally { setTesting(false) }
  }

  async function remove(id: string) {
    setBusyId(id)
    try { await apiRequest(`/tools/${id}`, { method: 'DELETE' }); await load() } finally { setBusyId('') }
  }

  if (loading) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-mute)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Tools</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Let your agent call your APIs — look up orders, check inventory, update records.</p>
        </div>
        {!form && <button type="button" onClick={startCreate} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 16px' }}><Plus size={14} /> New tool</button>}
      </div>

      {!form && (
        <div style={card}>
          <p style={label}>Your tools</p>
          {tools.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No tools yet. Create one to give your agent an action.</p>}
          {tools.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{t.name} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{t.method}</span></p>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.urlTemplate}</p>
              </div>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20, background: 'var(--bg-2)', color: t.kind === 'write' ? 'var(--accent)' : 'var(--ink-mute)' }}>{t.kind}{t.kind === 'write' && !t.writeEnabled ? ' · off' : ''}</span>
              {!t.enabled && <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>disabled</span>}
              <button type="button" onClick={() => startEdit(t)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>Edit</button>
              <button type="button" onClick={() => void remove(t.id)} disabled={busyId === t.id} aria-label="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 6 }}>
                {busyId === t.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div style={card}>
          <p style={label}>{form.id ? 'Edit tool' : 'New tool'}</p>

          <div style={{ marginBottom: 12 }}>
            <input placeholder="tool_name (letters, numbers, _ -)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <textarea placeholder="Description — tell the agent when to use this tool" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...input, minHeight: 60, resize: 'vertical' }} />
          </div>
          <div style={{ ...row }}>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as ToolMethod })} style={{ ...input, width: 120 }}>
              {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as ToolMethod[]).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input placeholder="https://api.example.com/orders/{orderId}" value={form.urlTemplate} onChange={(e) => setForm({ ...form, urlTemplate: e.target.value })} style={input} />
          </div>

          <p style={{ ...label, marginTop: 16 }}>Parameters</p>
          {form.params.map((p, i) => (
            <div key={i} style={row}>
              <input placeholder="name" value={p.name} onChange={(e) => { const params = [...form.params]; params[i] = { ...p, name: e.target.value }; setForm({ ...form, params }) }} style={{ ...input, width: 140 }} />
              <select value={p.type} onChange={(e) => { const params = [...form.params]; params[i] = { ...p, type: e.target.value as ToolParamType }; setForm({ ...form, params }) }} style={{ ...input, width: 110 }}>
                {(['string', 'number', 'boolean'] as ToolParamType[]).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input placeholder="description" value={p.description} onChange={(e) => { const params = [...form.params]; params[i] = { ...p, description: e.target.value }; setForm({ ...form, params }) }} style={input} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={p.required} onChange={(e) => { const params = [...form.params]; params[i] = { ...p, required: e.target.checked }; setForm({ ...form, params }) }} /> req
              </label>
              <button type="button" onClick={() => setForm({ ...form, params: form.params.filter((_, j) => j !== i) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)' }}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setForm({ ...form, params: [...form.params, { name: '', type: 'string', description: '', required: true }] })} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>+ Parameter</button>

          <p style={{ ...label, marginTop: 16 }}>Headers</p>
          {form.headers.map((h, i) => (
            <div key={i} style={row}>
              <input placeholder="Header" value={h.key} onChange={(e) => { const headers = [...form.headers]; headers[i] = { ...h, key: e.target.value }; setForm({ ...form, headers }) }} style={{ ...input, width: 200 }} />
              <input placeholder="value" value={h.value} onChange={(e) => { const headers = [...form.headers]; headers[i] = { ...h, value: e.target.value }; setForm({ ...form, headers }) }} style={input} />
              <button type="button" onClick={() => setForm({ ...form, headers: form.headers.filter((_, j) => j !== i) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)' }}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setForm({ ...form, headers: [...form.headers, { key: '', value: '' }] })} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>+ Header</button>

          <p style={{ ...label, marginTop: 16 }}>Authentication</p>
          <div style={row}>
            <select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value as ToolAuthType })} style={{ ...input, width: 160 }}>
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="header">Custom header</option>
            </select>
            {form.authType === 'header' && <input placeholder="X-API-Key" value={form.headerName} onChange={(e) => setForm({ ...form, headerName: e.target.value })} style={{ ...input, width: 180 }} />}
            {form.authType !== 'none' && <input type="password" placeholder={form.hasSecret ? '•••• set (leave blank to keep)' : 'secret'} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} style={input} />}
          </div>

          <p style={{ ...label, marginTop: 16 }}>Access</p>
          <div style={row}>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ToolKind })} style={{ ...input, width: 160 }}>
              <option value="read">Read (lookup)</option>
              <option value="write">Write (changes data)</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-mute)' }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
            </label>
          </div>
          {form.kind === 'write' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', marginTop: 8, padding: '10px 12px', background: 'var(--bg-2)', borderRadius: 'var(--r-sm)' }}>
              <input type="checkbox" checked={form.writeEnabled} onChange={(e) => setForm({ ...form, writeEnabled: e.target.checked })} />
              Let the agent perform this action. The agent can trigger this write on its own during a conversation.
            </label>
          )}

          {form.id && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <p style={label}>Test</p>
              <textarea value={testArgs} onChange={(e) => setTestArgs(e.target.value)} style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 48 }} />
              <button type="button" onClick={() => void runTest()} disabled={testing} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, marginTop: 8 }}><Play size={13} /> {testing ? 'Running…' : 'Run test'}</button>
              {testResult && <pre style={{ marginTop: 10, padding: 12, background: 'var(--bg-2)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--ink-dim)', overflow: 'auto', maxHeight: 240 }}>{testResult}</pre>}
            </div>
          )}

          {error && <p style={{ fontSize: 12, color: '#f87171', marginTop: 12 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>{saving ? 'Saving…' : 'Save tool'}</button>
            <button type="button" onClick={() => setForm(null)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck, build, and lint the web app**

Run: `pnpm --filter web typecheck && pnpm --filter web build && pnpm --filter web lint`
Expected: PASS — page compiles, `@ayooda/shared` types resolve, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/dashboard/Sidebar.tsx apps/web/src/app/dashboard/tools/page.tsx
git commit -m "feat(web): dashboard Tools page + owner-only nav link"
```

---

## Live E2E (after all tasks — from the spec §11)

Run against the dev API + a real workspace with an OpenRouter key:

1. **Read tool round-trip:** `POST /tools` a read tool against a public API (e.g. `https://api.github.com/repos/{owner}/{repo}`), then `POST /tools/:id/test { args: { owner: 'anthropics', repo: 'anthropic-sdk-python' } }` → real JSON with status 200.
2. **Agent uses the tool:** in a widget chat, ask something that triggers the tool; confirm the agent calls it and answers from the result; verify the assistant message persisted with summed token counts and the workspace `usage.conversationCount` did **not** increment for the tool call.
3. **Write opt-in:** create a `write` tool with `writeEnabled=false`; confirm it is absent from the model's tools (agent won't call it); set `writeEnabled=true` and confirm it becomes callable.
4. **SSRF:** `POST /tools/:id/test` for a tool whose host resolves private (`https://169.254.169.254/latest/meta-data/` or a host pointing at `127.0.0.1`) → `{ status: 0, error: 'blocked host' }`.
5. **Rounds cap:** a tool that always makes the model call again ends cleanly with a final answer (no hang).
6. **Owner gate:** a member session 403s on `GET /tools`; the Tools nav is hidden for members.

Clean up test tools/conversations afterward.

## Out of scope (v1)

OAuth/token-refresh auth; prebuilt CRM connector templates (next sub-project); per-agent tool scoping (waits for multiple-agents); streaming-time human approval of individual write calls; response transformation/JSONPath extraction; following redirects; non-HTTPS endpoints; per-tool rate limiting (turn-level round/call caps are the backstop).
