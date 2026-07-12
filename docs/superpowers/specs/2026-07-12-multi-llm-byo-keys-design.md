# Ayooda Sub-project B — Multi-Model via OpenRouter + Bring-Your-Own-Key — Design Spec

**Date:** 2026-07-12
**Status:** Approved for planning
**Scope:** Let a workspace pick any chat model (Gemini, Claude, OpenAI, …) served through **OpenRouter**, running on the customer's own (encrypted) OpenRouter key, with the platform key as a Gemini-only fallback.

## Background

Today the widget chat handler ([apps/api/src/routes/widget.ts](../../../apps/api/src/routes/widget.ts)) calls Gemini directly on the platform `GEMINI_API_KEY`, so Ayooda pays for all inference and customers can't use Claude/OpenAI. Rather than integrate three provider SDKs, we route **all chat** through OpenRouter — a single OpenAI-compatible streaming endpoint that fronts every model — and let customers bring one OpenRouter key that covers everything.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Provider integration | **OpenRouter only** — one HTTP client (`fetch` → OpenAI-compatible SSE). No `@anthropic-ai/sdk` / `openai` / Gemini-chat SDK. No new npm deps. |
| Key model | **One OpenRouter key per workspace** (not per-provider), AES-256-GCM encrypted; `API_KEY_ENCRYPTION_SECRET` env. Never returned by any endpoint. |
| Fallback | Platform `OPENROUTER_API_KEY` used only for **Gemini-family** models (preserves frictionless onboarding, bounds platform cost). Non-Gemini models require the customer's key. |
| No key + non-Gemini model | Pre-stream JSON 502 with an actionable message; widget shows its generic error bubble. |
| Embeddings | **Unchanged** — stay on direct Gemini (`gemini-embedding-001` via `GEMINI_API_KEY`). OpenRouter is chat-only. |

---

## 1. Model catalog (`packages/shared`)

Replace the Gemini-only `GEMINI_MODELS` export with a provider-aware catalog keyed by **OpenRouter model slug**, keeping `GEMINI_MODELS` as a derived export for back-compat (agent page + PUT validation import it).

```ts
export type LLMProvider = 'gemini' | 'claude' | 'openai'

export interface LLMModel {
  provider: LLMProvider
  id: string          // OpenRouter slug, e.g. "anthropic/claude-3.5-haiku"
  label: string       // UI label, e.g. "Claude Haiku"
  description: string
}

export const LLM_MODELS: readonly LLMModel[] = [ /* gemini + claude + openai entries */ ]
export const GEMINI_MODELS = LLM_MODELS.filter(m => m.provider === 'gemini') // back-compat
export function findModel(id: string): LLMModel | undefined
export function providerOf(modelId: string): LLMProvider | undefined
```

- **Exact slugs are pinned in the implementation plan** from openrouter.ai/models (do not hardcode from memory). Two models per provider is enough for v1 (e.g. a fast/cheap and a stronger option each). `AgentConfig.llmModel` stays a single string field; provider is derived via `providerOf`.
- **Model migration:** existing workspaces store bare Gemini ids (`gemini-flash-latest`, `gemini-pro-latest`, or retired `gemini-2.5-*`) that OpenRouter won't accept. Extend the existing `LEGACY_MODEL_MAP` (in [apps/api/src/lib/gemini.ts](../../../apps/api/src/lib/gemini.ts), or relocate to shared) to map every bare/retired Gemini id → its OpenRouter slug (e.g. `gemini-flash-latest` → `google/gemini-2.5-flash`). Chat maps at read; `GET /workspace` already maps ids so the UI self-heals; a stored bare id self-heals on the next agent save.

## 2. Encrypted key storage

### 2a. Crypto module

New [apps/api/src/lib/crypto.ts](../../../apps/api/src/lib/crypto.ts):

```ts
export function encryptSecret(plaintext: string): string   // "v1:<iv b64>:<authTag b64>:<ciphertext b64>"
export function decryptSecret(payload: string): string
```

- Node `crypto` `aes-256-gcm`. Key = SHA-256 of `process.env.API_KEY_ENCRYPTION_SECRET` (32 bytes from any-length secret); throw at first use if the env var is missing/empty. Random 12-byte IV per encryption. Versioned `v1:` prefix. Pure and fully unit-testable (round-trip, tamper → throws, wrong-key → throws).

### 2b. Firestore shape

One encrypted key per workspace:

```
workspaces/{id}.openRouterKey?: string   // encrypted payload; server-only, never sent to clients
```

Shared: extend `WorkspaceDoc` with `openRouterKey?: string` (documented server-only). Not seeded for new workspaces (absent = none set).

### 2c. Key endpoints ([apps/api/src/routes/workspace.ts](../../../apps/api/src/routes/workspace.ts), `requireAuth`)

- **`PUT /workspace/key`** — body `{ apiKey: string }`. Trim; reject empty or >500 chars (400). Optional warn-only sanity check (OpenRouter keys start `sk-or-`) — do not hard-reject. Encrypt → store at `openRouterKey`. Return `{ ok: true }`.
- **`DELETE /workspace/key`** — remove `openRouterKey` via `FieldValue.delete()`. Return `{ ok: true }`.
- **`GET /workspace`** gains `hasOpenRouterKey: boolean` (presence only). The existing "never return secrets" rule extends to never returning `openRouterKey`.

## 3. OpenRouter chat client

New [apps/api/src/lib/llm/openrouter.ts](../../../apps/api/src/lib/llm/openrouter.ts) — a single streaming client, no SDK:

```ts
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatParams { model: string; systemPrompt: string; messages: ChatMessage[]; apiKey: string }
export interface ChatChunk { text: string }
export interface ChatResult { promptTokens: number; completionTokens: number }
export async function* streamChat(params: ChatParams): AsyncGenerator<ChatChunk, ChatResult, void>
```

- `POST https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer <apiKey>`, `HTTP-Referer`/`X-Title` headers (OpenRouter attribution), body `{ model, messages: [{role:'system',content:systemPrompt}, ...messages], stream: true, stream_options: { include_usage: true } }`.
- Parse the OpenAI-compatible SSE response with a reused frame parser (extract a shared `parseSSEStream` helper, or inline the same logic as the widget's `extractSSEMessages`): each `data:` line is JSON; yield `choices[0].delta.content` when present; on the terminal `data: [DONE]` stop; capture `usage` from the final chunk (`prompt_tokens`/`completion_tokens`) for the return value.
- Non-2xx response (bad key, rate limit, unknown model) → throw with the status + OpenRouter error message. Network/stream errors propagate to the caller's existing SSE `error` handling.
- Small, single-responsibility, unit-testable against a mocked `fetch` returning a canned SSE body (assert it forwards deltas in order, stops on `[DONE]`, and reports usage).

## 4. Key resolution + chat integration

Resolution helper (in `apps/api/src/lib/llm/index.ts`):

```ts
export function resolveOpenRouterKey(provider: LLMProvider, encryptedWorkspaceKey: string | undefined):
  { ok: true; apiKey: string } | { ok: false; reason: 'missing_key' }
```

- If `encryptedWorkspaceKey` set → `decryptSecret` → use it (covers all models).
- Else if `provider === 'gemini'` and `process.env.OPENROUTER_API_KEY` set → platform fallback.
- Else → `{ ok: false, reason: 'missing_key' }`.

In **`POST /widget/chat`** ([apps/api/src/routes/widget.ts](../../../apps/api/src/routes/widget.ts)), replace the direct Gemini construction (current steps 6–7):
1. `provider = providerOf(llmModel) ?? 'gemini'`; map `llmModel` through `LEGACY_MODEL_MAP` to the OpenRouter slug first.
2. `resolveOpenRouterKey(provider, workspaceData.openRouterKey)`. If `{ ok: false }` → this is **pre-stream** → return JSON `502 { error: 'This agent's AI model needs an OpenRouter API key. Add one in Settings.' }`. (The widget already treats a non-SSE response as an error and shows its generic bubble; the operator/dashboard sees the real message.)
3. Build `ChatMessage[]` from the already-fetched last-10 history, call `streamChat({ model: slug, systemPrompt: fullSystemPrompt, messages, apiKey })`, and drive the existing SSE loop from the generator: `for await (const {text} of stream)` → `chunk` events; the generator's return value gives `promptTokens`/`completionTokens`. All existing persistence, usage counters, Langfuse instrumentation, and `done`/`error` handling are unchanged (they depend only on `reply` + token counts). Langfuse generation `name` generalizes `gemini-chat` → `llm-chat`, `model` = the slug.

Embeddings/RAG retrieval in the same handler are untouched (still direct Gemini).

## 5. Web UI

- **Agent page** ([apps/web/src/app/dashboard/agent/page.tsx](../../../apps/web/src/app/dashboard/agent/page.tsx)) — model selector becomes provider-grouped over `LLM_MODELS` (headers Gemini / Claude / OpenAI). If a non-Gemini model is selected while `hasOpenRouterKey` is false, show an inline hint linking to Settings. `PUT /workspace/agent` validation broadens from `GEMINI_MODELS` to `LLM_MODELS`.
- **Settings page** (from Sub-project A) gains an **OpenRouter API key** card: shows "Connected ✓ / Not set", a write-only paste field + Save (`PUT /workspace/key`), and Remove (`DELETE /workspace/key`). Copy notes: "One key unlocks Claude, GPT, and more. Gemini works without a key on the platform's allowance." Value never pre-filled.

## 6. Error handling summary

- Missing `API_KEY_ENCRYPTION_SECRET` → crypto throws on first use; documented in `apps/api/.env.example` + architecture doc. (Fails loudly, never mis-decrypts.)
- Missing key for a non-Gemini model → pre-stream JSON 502, actionable message; widget shows generic error bubble.
- OpenRouter errors (bad key, model unavailable, rate limit) mid-stream → existing `error` SSE event + Langfuse ERROR.
- Decryption failure (rotated/tampered secret) → treated as a provider error for that request; logged; process does not crash.

## 7. Testing & verification

- **Unit tests** (`bun test`): crypto round-trip + tamper/wrong-key rejection; `resolveOpenRouterKey` (customer key, gemini platform fallback, non-gemini missing → error); catalog integrity (unique slugs, valid provider) + `providerOf`/`findModel`; `streamChat` against a mocked `fetch` SSE body (forwards deltas in order, stops on `[DONE]`, reports usage, throws on non-2xx).
- **Live E2E** (real services, platform `OPENROUTER_API_KEY` if available else deferred): a Gemini-family model streams end-to-end through OpenRouter; `GET /workspace` shows `hasOpenRouterKey` correctly and never returns the key; selecting a Claude/OpenAI model with no key → widget error bubble + correct 502.
- **Deferred verification** (needs a real key from you): live Claude/OpenAI streaming, and platform-fallback if no `OPENROUTER_API_KEY` is set in the dev env. All adapters are unit-verified against mocked streams meanwhile.

## Out of scope

Per-model parameters (temperature/max tokens) in UI; token-cost display; OpenRouter model auto-discovery; per-provider keys; Cloud KMS (app-layer AES is the agreed posture).
