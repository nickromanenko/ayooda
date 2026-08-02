# Ayooda Sub-project L — Migrate LLM Layer to Vercel AI SDK + AI Gateway — Design Spec

**Date:** 2026-08-02
**Status:** Approved for planning
**Scope:** Replace the custom fetch-based OpenRouter chat client and the hand-rolled tool-resolution loop with the Vercel AI SDK (`ai` v5) `streamText`, routed through **AI Gateway**. The SDK owns streaming and the multi-step tool loop; `runAgentTurn`'s generator signature is preserved so the channels are untouched. Per-agent BYO keys become AI Gateway keys with a platform `AI_GATEWAY_API_KEY` fallback that covers all providers. Embeddings (direct Gemini) and Langfuse tracing are unchanged.

## Background

Chat currently flows: `prepareTurn` ([apps/api/src/lib/chat/agent-turn.ts](../../../apps/api/src/lib/chat/agent-turn.ts)) builds `ChatParams`, `runAgentTurn` ([apps/api/src/lib/chat/tools.ts](../../../apps/api/src/lib/chat/tools.ts)) drives a **manual** bounded tool loop over `streamChat` ([apps/api/src/lib/llm/openrouter.ts](../../../apps/api/src/lib/llm/openrouter.ts)) — a hand-written OpenAI-compatible SSE reader with manual `tool_calls` accumulation. Both channels consume `runAgentTurn`'s `AsyncGenerator<ChatChunk, ChatResult>`: the widget streams text over SSE; Telegram accumulates then sends once. Per-agent BYO OpenRouter keys (encrypted, `agent.openRouterKey`) resolve via `resolveOpenRouterKey` ([apps/api/src/lib/llm/resolve.ts](../../../apps/api/src/lib/llm/resolve.ts)), with a platform `OPENROUTER_API_KEY` fallback restricted to Gemini. `LLM_MODELS` ([packages/shared/src/index.ts](../../../packages/shared/src/index.ts)) is keyed by slugs (`google/gemini-2.5-flash`, `anthropic/claude-haiku-4.5`, `openai/gpt-5`, …). Embeddings are **direct Gemini** (`gemini-embedding-001` @768) via [apps/api/src/lib/gemini.ts](../../../apps/api/src/lib/gemini.ts) — not on the chat path.

The AI SDK's `streamText({ model, system, messages, tools, stopWhen: stepCountIs(N) })` runs the tool loop natively: text via `result.textStream`, tokens via `await result.usage` (`{ inputTokens, outputTokens, totalTokens }`). A Gateway model is a string id (our existing slugs) or `createGateway({ apiKey })(modelId)` for a per-request key.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Adoption | **Idiomatic** — `streamText` + `stepCountIs` own streaming + the tool loop. Delete `streamChat` and the manual accumulation/loop. Preserve `runAgentTurn`'s generator signature so widget/telegram are untouched. |
| BYOK | **Per-agent AI Gateway key** (encrypted) + platform `AI_GATEWAY_API_KEY` fallback that covers **all** providers (the old Gemini-only restriction is dropped). Field renamed `openRouterKey` → `gatewayKey`; existing OpenRouter keys are abandoned (owners re-enter). |
| Embeddings | **Unchanged** — direct Gemini. |
| Model catalog | **Unchanged** — the slugs are already Gateway model ids. |
| Tracing | **Keep Langfuse** manual spans around `streamText` + tool `execute`. No AI SDK OpenTelemetry. |

---

## 1. Dependencies

Add to `apps/api`: `ai` (^5) and `zod` (^3). Keep `@google/generative-ai` (embeddings). No dependency removed (the OpenRouter client was custom fetch).

## 2. Model catalog + key resolution

- `LLM_MODELS` unchanged; update the `LLMModel.id` comment from "OpenRouter slug" to "AI Gateway model id". `providerOf`/`findModel`/`GEMINI_MODELS` stay (catalog + `/agents` model validation).
- **New** `resolveGatewayKey(encryptedAgentKey: string | undefined): { ok: true; apiKey: string } | { ok: false; reason: 'missing_key' }` (in `apps/api/src/lib/llm/resolve.ts`, replacing `resolveOpenRouterKey`): if `encryptedAgentKey` → `decryptSecret`; else if `process.env.AI_GATEWAY_API_KEY` → platform key (any provider); else `{ ok: false }`. No `provider` argument (the platform key is universal).
- **Field rename** `agent.gatewayKey` (was `agent.openRouterKey`). Shared `AgentDoc.hasOpenRouterKey` → `hasGatewayKey`. Touch points: `/agents` `toAgentDoc` + `PUT/DELETE /agents/:id/key`; `agent-turn.ts` agent resolution (`agentRec.gatewayKey`); `GET /workspace` (`hasOpenRouterKey` → sourced from the default agent's `gatewayKey`); web Agents page + Settings key labels. Pre-existing `openRouterKey` values are ignored.

## 3. Chat types (`apps/api/src/lib/llm/chat.ts`, new)

Delete `apps/api/src/lib/llm/openrouter.ts`. Move the still-consumed types to a small `chat.ts`:

```ts
export type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatParams { model: string; system: string; messages: ChatMessage[]; apiKey: string }
export interface ChatChunk { text: string }
export interface ChatResult { promptTokens: number; completionTokens: number }
```

(The assistant-with-`tool_calls` / `tool`-role message shapes and `ToolCall`/`OpenRouterTool` are removed — the SDK manages the tool round-trip internally, so channel-facing messages are only system/user/assistant text.)

## 4. Tool adapter + `runAgentTurn` rewrite (`apps/api/src/lib/chat/tools.ts`)

- **`toAiSdkTools(tools: StoredTool[]): Record<string, Tool>`** (replaces `toOpenRouterTools`): for each tool, build a Zod object from `params` (`string`→`z.string()`, `number`→`z.number()`, `boolean`→`z.boolean()`; non-required → `.optional()`; each `.describe(param.description)`), and:
  ```ts
  tool({
    description: t.description,
    inputSchema: z.object(shape),
    execute: async (args) => {
      const span = trace.span({ name: `tool:${t.name}`, input: args })
      const r = await executeTool(t, args as Record<string, unknown>)
      span.end({ output: { status: r.status, error: r.error } })
      return r.error ? `error: ${r.error}` : `status ${r.status}\n${r.body}`
    },
  })
  ```
  `executeTool` (SSRF-guarded), `buildToolRequest`, `selectExposedTools`, `loadTools`, `MAX_ROUNDS`, `MAX_CALLS_PER_ROUND` are **unchanged**.
- **`runAgentTurn(chatParams, tools, trace, deps?)`** keeps its signature `AsyncGenerator<ChatChunk, ChatResult, void>` and `deps` for tests, now implemented with the SDK:
  ```ts
  const stream = deps.streamText ?? streamText
  const model = createGateway({ apiKey: chatParams.apiKey })(chatParams.model)
  const result = stream({
    model, system: chatParams.system, messages: chatParams.messages,
    tools: tools.length ? toAiSdkTools(tools, trace) : undefined,
    stopWhen: stepCountIs(MAX_ROUNDS),
  })
  for await (const delta of result.textStream) yield { text: delta }
  const u = await result.usage
  return { promptTokens: u.inputTokens ?? 0, completionTokens: u.outputTokens ?? 0 }
  ```
  Errors thrown while iterating propagate to the caller's existing `try/catch` (widget → SSE `error`; Telegram → apology). `deps.streamText` is injected only in tests; production uses the real `streamText`.

## 5. `prepareTurn` (`agent-turn.ts`)

- Agent resolution reads `agentRec.gatewayKey` (was `openRouterKey`).
- Key resolution: `resolveGatewayKey(agentRec.gatewayKey)` (drop the `provider` arg + the Gemini-only branch).
- Build `chatParams: { model: llmModel, system: fullSystemPrompt, messages: chatMessages, apiKey: keyResult.apiKey }` (rename `systemPrompt` → `system`). `chatMessages` stay `{ role: 'user'|'assistant', content }`.
- RAG, escalation rules, `sourceCount`, billing gate, overage metering, and `persist` are **unchanged**. The `ReadyTurn.tools` load is unchanged.

## 6. Channels

`widget.ts` and `telegram.ts` are **unchanged** — they consume `runAgentTurn(chatParams, tools, trace)` exactly as before (same `ChatChunk` generator + `ChatResult`). Only the import of `streamChat` (if any remained) is removed; both already import `runAgentTurn`.

## 7. Environment & docs

- New api env `AI_GATEWAY_API_KEY` (platform Gateway key). Retire `OPENROUTER_API_KEY` (remove from code/env; the AI SDK reads `AI_GATEWAY_API_KEY` by default).
- Update `apps/api/.env.example` (replace `OPENROUTER_API_KEY` with `AI_GATEWAY_API_KEY`) and `docs/self-hosting.md` (the OpenRouter row → AI Gateway; note per-agent keys are Gateway keys).

## 8. Error handling

- Missing key (no agent key + no `AI_GATEWAY_API_KEY`) → `prepareTurn` returns the existing `{ kind: 'error' }` (pre-stream 502), unchanged.
- A Gateway/model error surfaces when iterating `textStream` → the caller's `try/catch` emits the existing failure path.
- A tool `execute` never throws into the SDK (executeTool returns a `ToolResult`; the adapter formats it as a string), so a failed tool becomes a tool message the model can react to — same behavior as today.
- `stopWhen: stepCountIs(MAX_ROUNDS)` bounds the loop; the SDK returns whatever text exists at the cap.

## 9. Testing & verification

- **Delete** `apps/api/src/lib/llm/openrouter.test.ts` and the old `runAgentTurn` manual-loop tests in `tools.test.ts` (they assert logic the SDK now owns).
- **New unit tests (`bun test`):**
  - `toAiSdkTools`: a read tool → a `Record` with the tool name; its `inputSchema` parses valid args and rejects a missing required arg; `execute` calls `executeTool` (inject a fake executor via the existing `deps`/module boundary) and returns the formatted string.
  - `runAgentTurn` with `deps.streamText`: a fake returning `{ textStream: asyncGen(['Hel','lo']), usage: Promise.resolve({ inputTokens: 9, outputTokens: 2 }) }` → the generator yields `['Hel','lo']` and returns `{ promptTokens: 9, completionTokens: 2 }`; a no-tools call passes `tools: undefined`.
  - `resolveGatewayKey`: agent key present → decrypts; only `AI_GATEWAY_API_KEY` set → platform key; neither → `{ ok: false }`.
  - `executeTool`, `ssrf`, `validate`, `selectExposedTools`, `buildToolRequest` tests unchanged and green.
- **Live E2E:** with a platform `AI_GATEWAY_API_KEY`, a widget chat streams a grounded answer for a Gemini, a Claude, and an OpenAI model (all via Gateway); a tool-triggering message resolves through the SDK's multi-step loop and the agent answers from the result; a per-agent `gatewayKey` overrides the platform key; Telegram parity; token counts persist with correct attribution. Verify requests appear in the AI Gateway dashboard.

## Out of scope

Moving embeddings to the AI SDK; AI Gateway failover/routing/provider-options config; AI SDK OpenTelemetry (Langfuse stays); model-catalog changes; any widget/telegram behavior change; streaming tool-call progress to the visitor (only final text streams, as today).
