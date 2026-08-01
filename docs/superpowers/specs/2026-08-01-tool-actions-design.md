# Ayooda Sub-project F — Custom Tool/Webhook Actions — Design Spec

**Date:** 2026-08-01
**Status:** Approved for planning
**Scope:** Let a workspace owner define HTTP "tools" the AI agent can call mid-conversation (look up an order, check inventory, update a record). The LLM decides when to call a tool; the API executes the HTTP request server-side, feeds the result back to the model, and the agent answers using it. Works on both channels (widget + Telegram) since both go through `prepareTurn`.

## Background

Today the agent answers purely from the RAG knowledge base. `prepareTurn` ([apps/api/src/lib/chat/agent-turn.ts](../../../apps/api/src/lib/chat/agent-turn.ts)) builds `ChatParams` and the caller drives `streamChat` ([apps/api/src/lib/llm/openrouter.ts](../../../apps/api/src/lib/llm/openrouter.ts)) — a pure text-streaming generator with no tool-calling. This sub-project adds LLM function-calling: the model can return `tool_calls`, which we execute as HTTP requests against customer-configured endpoints, feed back, and loop until the model produces a final answer. This is the foundation the later CRM-integrations sub-project builds on (prebuilt tool templates).

OpenRouter is OpenAI-compatible, so tools are passed as a `tools` array and returned as `tool_calls` deltas in the stream.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Read vs write | **Read + write, writes need owner opt-in.** Any HTTP method. Each tool is `kind: 'read'` or `'write'`. Read tools the agent calls freely. Write tools are exposed to the model **only when the owner sets `writeEnabled === true`** on that tool. |
| Builder flexibility | **Raw HTTP builder.** One flexible primitive: name, description, method, URL template with `{param}` placeholders, static headers, an encrypted auth secret, and a parameter schema the LLM fills. Plus a **Test** button. No prebuilt CRM templates (that's the next sub-project). |
| Tool-resolution loop | **Streaming throughout** via `yield*` delegation, so tool orchestration stays server-side and the widget's SSE UX is preserved. Rounds that only call tools emit no text; the final round streams the answer. |
| Tool scope | **Per-workspace** (shared by the single agent). Per-agent scoping waits for the multiple-agents sub-project. |

---

## 1. Data model (Firestore + shared types)

New subcollection `workspaces/{id}/tools/{toolId}`:

```
{
  name: string            // slug, ^[a-zA-Z0-9_-]{1,48}$ — becomes the LLM function name (unique per workspace)
  description: string      // what the model reads to decide when to call (<= 1024 chars)
  method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'
  urlTemplate: string      // e.g. https://api.shop.com/orders/{orderId}
  params: ToolParam[]      // { name, type: 'string'|'number'|'boolean', description, required }
  headers: { key: string, value: string }[]   // static headers
  auth: ToolAuth           // { type: 'none'|'bearer'|'header', headerName?, secretEnc? }
  kind: 'read'|'write'
  writeEnabled: boolean     // write tools only; read tools ignore it (treat as false)
  enabled: boolean          // owner can disable a tool without deleting it
  createdAt, updatedAt
}
```

- `secretEnc` is AES-256-GCM encrypted via the existing [apps/api/src/lib/crypto.ts](../../../apps/api/src/lib/crypto.ts) (`encryptSecret`/`decryptSecret`, env `API_KEY_ENCRYPTION_SECRET`). It is **never returned** by any endpoint; GET responses carry `hasSecret: boolean` instead.
- `name` must be unique within a workspace (checked on create/update via a query) — it is the function name the model calls, and duplicate function names are ambiguous.

Shared types (`packages/shared`): `ToolParamType = 'string'|'number'|'boolean'`; `ToolParam`; `ToolAuthType = 'none'|'bearer'|'header'`; `ToolAuth`; `ToolMethod`; `ToolKind = 'read'|'write'`; a `ToolDef` interface (the stored shape, minus `secretEnc`, plus `id` and `hasSecret`) for the API↔web contract.

## 2. Tool loading and the OpenRouter schema

A new module `apps/api/src/lib/chat/tools.ts`:

- **`loadTools(workspaceId): Promise<StoredTool[]>`** — read `workspaces/{id}/tools` where `enabled == true`. Filter out write tools whose `writeEnabled !== true` (they are never exposed to the model). Returns the full stored shape (including `secretEnc`) for the executor.
- **`toOpenRouterTools(tools): OpenRouterTool[]`** — map each to `{ type: 'function', function: { name, description, parameters } }` where `parameters` is a JSON Schema object built from `params`: `{ type: 'object', properties: { <name>: { type, description } }, required: [<required names>], additionalProperties: false }`. `number`→`"number"`, `boolean`→`"boolean"`, `string`→`"string"`.

## 3. Executor — `executeTool(tool, args): Promise<ToolResult>` (in `tools.ts`)

Runs one tool call. `ToolResult = { status: number, body: string, error?: string }`.

**Security baseline (fixed, non-negotiable):**
- **HTTPS only.** Reject any non-`https:` URL after substitution.
- **SSRF guard.** DNS-resolve the final host (Bun `node:dns/promises` `lookup`, all addresses) and reject if any resolved IP is loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16, incl. cloud metadata `169.254.169.254`), unique-local IPv6 (`fc00::/7`), or `::1`. A pure helper `isBlockedAddress(ip): boolean` is unit-tested.
- **No redirect following.** `redirect: 'manual'`; a 3xx is returned to the model as-is (status + empty body), never followed (defeats redirect-based SSRF).
- **Timeout.** 10s via `AbortController`; on abort return `{ status: 0, body: '', error: 'timeout' }`.
- **Response cap.** Read at most 32KB of the body; truncate and note truncation. Non-text/opaque bodies are read as text best-effort.

**Request construction:**
- Substitute `{param}` placeholders in `urlTemplate` with URL-encoded arg values. A placeholder with no matching arg → the tool call fails with `error: 'missing required param'` (returned to the model, not thrown).
- Params **not** consumed as placeholders: for `GET`/`DELETE` → appended as query-string params; for `POST`/`PUT`/`PATCH` → sent as a JSON body (`Content-Type: application/json`).
- Apply static `headers`. Apply `auth`: `bearer` → `Authorization: Bearer <secret>`; `header` → `<headerName>: <secret>`; `none` → nothing. Secret decrypted at call time.
- Result body returned to the model is `status + "\n" + truncatedBody` text.

**Bounds:** `MAX_ROUNDS = 3` tool-resolution rounds per turn; within a round, at most `MAX_CALLS_PER_ROUND = 5` tool calls executed (extra calls beyond the cap get an error result). These prevent runaway loops/cost. When `MAX_ROUNDS` is exhausted with the model still requesting tools, stop looping and make one final tool-free streaming call so the user still gets an answer.

## 4. `streamChat` changes (openrouter.ts)

- `ChatParams` gains optional `tools?: OpenRouterTool[]`. When present, include `tools` in the request body.
- `ChatResult` gains `toolCalls?: ToolCall[]` where `ToolCall = { id: string, name: string, arguments: string }` (raw JSON string args, as the API returns them).
- Stream parsing accumulates `delta.tool_calls[]` by `index`: concatenate `function.arguments` string fragments, capture `id` and `function.name` from the first fragment of each index. `finish_reason: 'tool_calls'` (or any accumulated calls at `[DONE]`) → return them in `ChatResult`. Text deltas still `yield` exactly as today, so a channel consuming via `yield*` is unaffected.

## 5. Orchestrator — `runAgentTurn` (in `tools.ts`), consumed by both channels

A generator `async function* runAgentTurn(chatParams, tools, trace): AsyncGenerator<ChatChunk, ChatResult>` that both channels call **instead of** `streamChat` directly:

```
const schema = toOpenRouterTools(tools)   // [] when the workspace has no tools
let messages = chatParams.messages
let totalPrompt = 0, totalCompletion = 0
for (let round = 0; round < MAX_ROUNDS; round++) {
  const result = yield* streamChat({ ...chatParams, messages, tools: schema.length ? schema : undefined })
  totalPrompt += result.promptTokens; totalCompletion += result.completionTokens
  if (!result.toolCalls?.length) return { promptTokens: totalPrompt, completionTokens: totalCompletion }
  // append the assistant tool_calls message + one tool result message per call
  messages = [...messages, assistantToolCallsMsg(result.toolCalls), ...await executeCalls(result.toolCalls)]
}
// rounds exhausted → one final tool-free streaming call
const final = yield* streamChat({ ...chatParams, messages, tools: undefined })
return { promptTokens: totalPrompt + final.promptTokens, completionTokens: totalCompletion + final.completionTokens }
```

- `assistantToolCallsMsg` and the `tool` result messages use the OpenAI/OpenRouter roles: an `assistant` message with a `tool_calls` array, then one `{ role: 'tool', tool_call_id, content }` per call. This requires `streamChat` to pass through message shapes beyond the current `{role,content}` — the message array type widens to allow the assistant-with-tool_calls and tool-role messages.
- Each tool call gets a Langfuse span (`name: tool:<name>`, input args, output status). Non-fatal: an executor error becomes the tool result content so the model can react.
- Token usage is summed across rounds and returned in the single `ChatResult`, so `persist()` bookkeeping is unchanged.

### `prepareTurn` change
`ReadyTurn` gains `tools: StoredTool[]` (loaded via `loadTools`, non-fatal on error → `[]`). The two callers switch from `streamChat(chatParams)` to `runAgentTurn(chatParams, tools, trace)`. No billing/gate/persist changes — tool calls do not count as conversations; their tokens fold into the existing token counter.

## 6. Channel wiring

- **Widget** ([apps/api/src/routes/widget.ts](../../../apps/api/src/routes/widget.ts)) — replace the `streamChat` loop with `runAgentTurn`; SSE emission of text chunks is identical.
- **Telegram** ([apps/api/src/routes/telegram.ts](../../../apps/api/src/routes/telegram.ts)) — replace `streamChat` with `runAgentTurn`; still accumulates text then `sendMessage`.

Both already consume a `ChatChunk` generator and a returned `ChatResult`, so the swap is mechanical.

## 7. API — `apps/api/src/routes/tools.ts` (requireAuth + requireOwner)

Mounted at `/tools`. All owner-only (tools expose auth secrets and outbound calls).

- **`GET /tools`** — list this workspace's tools as `ToolDef[]` (id, name, description, method, urlTemplate, params, headers, auth **without** secret + `hasSecret`, kind, writeEnabled, enabled).
- **`POST /tools`** `{ name, description, method, urlTemplate, params, headers, auth, kind, writeEnabled?, enabled? }` — validate (see §8); encrypt `auth.secret` → `secretEnc` if provided; reject a duplicate `name` in the workspace (409). Returns the created `ToolDef`.
- **`PUT /tools/:id`** — update. If `auth.secret` present, re-encrypt; if `auth.type === 'none'`, clear `secretEnc`; if the secret field is omitted, keep the existing `secretEnc`. Re-validate name uniqueness (excluding self).
- **`DELETE /tools/:id`** — delete (idempotent → 200).
- **`POST /tools/:id/test`** `{ args: Record<string, unknown> }` — run the tool through the **same** `executeTool` (SSRF guard included) with owner-supplied sample args; return `{ status, body, error? }`. Owner-only; the tool need not be `enabled` to test.

A pure `validateToolInput(raw): { ok: true, value } | { ok: false, error }` helper (name slug, method enum, https URL template, param names unique + valid identifiers, auth shape, description length) is unit-testable.

## 8. Validation rules

- `name`: matches `^[a-zA-Z0-9_-]{1,48}$`, unique per workspace.
- `description`: 1–1024 chars.
- `method`: one of the five.
- `urlTemplate`: parses as a URL, scheme `https:`, and every `{placeholder}` corresponds to a declared param name.
- `params`: each `name` a valid identifier (`^[a-zA-Z_][a-zA-Z0-9_]*$`), unique; `type` in the enum; `description` ≤ 256 chars; ≤ 20 params.
- `headers`: ≤ 20; keys non-empty; no `Host`/`Content-Length` overrides.
- `auth`: `type` in enum; `header` requires `headerName`; `secret` (plaintext, write-only) optional.
- `kind`: `read`|`write`. `writeEnabled` only meaningful for `write`.

Validation failures → 400 with a specific message.

## 9. Web — `apps/web/src/app/dashboard/tools/page.tsx` (client)

- New **Tools** sidebar link ([apps/web/src/components/dashboard/Sidebar.tsx](../../../apps/web/src/components/dashboard/Sidebar.tsx)), owner-only (uses the caller `role` already surfaced by `GET /workspace`).
- List of tools with enable/disable and delete; a create/edit form matching the existing dashboard inline-style idiom: name, description, method, URL template, a params editor (rows of name/type/description/required), a headers editor (rows of key/value), an auth section (type + headerName + secret; secret shows "•••• set" when `hasSecret`), a read/write selector, and for write tools a "Let the agent perform this action" (`writeEnabled`) toggle with a short caution note.
- A **Test** panel: sample-arg inputs (derived from `params`) → `POST /tools/:id/test` → shows status + body. Inline errors surfaced from 4xx.

## 10. Error handling

- Executor never throws into the orchestrator: timeouts, SSRF rejections, non-2xx, and missing params all become a `ToolResult` whose `body`/`error` is handed to the model as the tool message, so the agent can apologize or retry with different args.
- SSRF-blocked URL → tool result `{ status: 0, error: 'blocked host' }`; also rejected at **create/test** time when the host is a literal blocked IP (best-effort; DNS can change, so the call-time guard is authoritative).
- Duplicate tool name → 409. Validation failure → 400. Unknown tool id → 404.
- `MAX_ROUNDS` exhausted → final tool-free answer (never an infinite loop).
- Missing `API_KEY_ENCRYPTION_SECRET` → create/test fails clearly (same as existing BYO-key/Telegram-token paths).

## 11. Testing & verification

- **Unit (`bun test`):** `isBlockedAddress` (loopback/private/link-local/ULA/metadata → true; public → false); `validateToolInput` (name slug, https-only, placeholder↔param coverage, param identifier rules, auth shape); `toOpenRouterTools` (param types → JSON Schema, required list); placeholder substitution + param placement (URL vs query vs body per method); the stream parser accumulating `tool_calls` deltas across frames.
- **Live E2E:** create a read tool against a public test API (e.g. `https://api.github.com/repos/{owner}/{repo}` or httpbin), `POST /tools/:id/test` returns real JSON; a widget chat whose message triggers the tool shows the agent calling it and answering from the result (verify token counts persisted, conversation count unaffected); a write tool stays invisible to the model until `writeEnabled` is set; an SSRF attempt (`https://169.254.169.254/...` or a host resolving to a private IP) is blocked; `MAX_ROUNDS` cap ends cleanly. Clean up test tools/conversations afterward.
- **Web:** owner sees the Tools nav + page, can create/edit/test/delete a tool and toggle write-enable; a member session does not see the nav and 403s on `/tools`.

## Out of scope (v1)

OAuth / token-refresh auth flows; prebuilt CRM connector templates (the next sub-project); per-agent tool scoping (waits for multiple-agents-per-workspace); streaming-time human approval of individual write calls; response transformation / JSONPath extraction; following redirects; non-HTTPS endpoints; per-tool rate limiting (the turn-level round/call caps are the backstop).
