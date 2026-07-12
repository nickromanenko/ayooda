# Ayooda Sub-project B — Multi-LLM + Bring-Your-Own-Key — Design Spec

**Date:** 2026-07-12
**Status:** Approved for planning
**Scope:** Support Claude and OpenAI alongside Gemini, each running on the customer's own (encrypted) API key, selectable per workspace.

## Background

Today the widget chat handler ([apps/api/src/routes/widget.ts](../../../apps/api/src/routes/widget.ts)) calls Gemini directly on the **platform** `GEMINI_API_KEY`, so Ayooda pays for every customer's inference and customers cannot use Claude or OpenAI. `LLMProvider` already types `'gemini' | 'claude' | 'openai'` in [packages/shared/src/index.ts](../../../packages/shared/src/index.ts) but only Gemini is implemented. This sub-project makes provider a real choice, runs non-Gemini providers on customer keys, and encrypts those keys at rest.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Key storage | App-layer AES-256-GCM; `API_KEY_ENCRYPTION_SECRET` env (Secret Manager in prod). Keys never returned by any endpoint. |
| Gemini default | Platform-key fallback when no customer Gemini key is set (frictionless onboarding preserved). |
| Claude/OpenAI without a key | Chat returns a clear "provider not configured — add an API key" error; the widget shows a friendly fallback message; the operator/dashboard surfaces the real reason. |

**Implementation note:** when writing the Claude adapter, the implementer MUST consult the `claude-api` skill for current Anthropic model IDs, the Messages streaming API shape, and SDK usage — do not hardcode model IDs from memory.

---

## 1. Model catalog (`packages/shared`)

Replace the Gemini-only `GEMINI_MODELS` export with a provider-aware catalog while keeping `GEMINI_MODELS` as a derived export for backward compatibility (the agent page and existing validation import it).

```ts
export type LLMProvider = 'gemini' | 'claude' | 'openai'

export interface LLMModel {
  provider: LLMProvider
  id: string          // the wire model id sent to the provider SDK
  label: string       // UI label, e.g. "Claude Haiku"
  description: string
}

export const LLM_MODELS: readonly LLMModel[] = [ /* gemini + claude + openai entries */ ]
export const GEMINI_MODELS = LLM_MODELS.filter(m => m.provider === 'gemini') // back-compat
export function findModel(id: string): LLMModel | undefined
export function providerOf(modelId: string): LLMProvider | undefined
```

Model IDs: Gemini entries stay as-is (`gemini-flash-latest`, `gemini-pro-latest`). Claude and OpenAI entries — the implementation plan will pin exact current IDs (Claude via the `claude-api` skill; OpenAI a current default like a GPT-5-tier model + a cheaper mini). Two models per provider is enough for v1. `AgentConfig.llmModel` stays a single string field (now any catalog id, not just Gemini); provider is derived via `providerOf`.

`LEGACY_MODEL_MAP` (currently in `apps/api/src/lib/gemini.ts`) is unaffected — it still maps retired Gemini ids and runs before catalog lookup.

## 2. Encrypted key storage

### 2a. Crypto module

New [apps/api/src/lib/crypto.ts](../../../apps/api/src/lib/crypto.ts):

```ts
export function encryptSecret(plaintext: string): string   // returns "v1:<iv b64>:<authTag b64>:<ciphertext b64>"
export function decryptSecret(payload: string): string
```

- Node `crypto` `aes-256-gcm`. Key = SHA-256 of `process.env.API_KEY_ENCRYPTION_SECRET` (gives a 32-byte key from any-length secret); throw at first use if the env var is missing/empty. Random 12-byte IV per encryption. Versioned prefix (`v1:`) so the scheme can evolve.
- Pure and fully unit-testable (round-trip, tamper detection → decrypt throws, wrong-key → throws).

### 2b. Firestore shape

Keys live on the workspace doc under a new `apiKeys` map, values are the encrypted payload strings:

```
workspaces/{id}.apiKeys: { gemini?: string, claude?: string, openai?: string }  // encrypted
```

New shared types: extend `WorkspaceDoc` with `apiKeys?: Partial<Record<LLMProvider, string>>` (encrypted; server-only — never sent to clients). Seed omitted for new workspaces (absent = none set).

### 2c. Key endpoints ([apps/api/src/routes/workspace.ts](../../../apps/api/src/routes/workspace.ts), `requireAuth`)

- **`PUT /workspace/keys/:provider`** — body `{ apiKey: string }`. Validate `:provider` ∈ providers and `apiKey` non-empty (trim; reject >500 chars). Optionally a cheap format sanity check per provider (e.g. OpenAI `sk-`, Anthropic `sk-ant-`) — warn-only, do not hard-reject (formats change). Encrypt and store at `apiKeys.{provider}`. Return `{ ok: true }`.
- **`DELETE /workspace/keys/:provider`** — remove `apiKeys.{provider}` via `FieldValue.delete()`. Return `{ ok: true }`.
- **`GET /workspace`** gains a `keyStatus: { gemini: boolean, claude: boolean, openai: boolean }` field (presence only — never the values). The existing defensive "never return `llmApiKey`" note extends to never returning `apiKeys`.

## 3. Provider abstraction

New [apps/api/src/lib/llm/](../../../apps/api/src/lib/llm/) directory:

- **`types.ts`** — the interface every adapter implements:
  ```ts
  export interface ChatMessage { role: 'user' | 'assistant'; content: string }
  export interface ChatParams {
    model: string
    systemPrompt: string
    messages: ChatMessage[]
    apiKey: string
  }
  export interface ChatChunk { text: string }
  export interface ChatResult {   // resolved after the stream completes
    promptTokens: number
    completionTokens: number
  }
  // Yields text deltas, then returns token usage.
  export type ChatStream = AsyncGenerator<ChatChunk, ChatResult, void>
  export interface LLMAdapter { streamChat(params: ChatParams): ChatStream }
  ```
- **`gemini.ts`** — wraps the existing `generateContentStream` logic (moved out of `widget.ts`), mapping history to Gemini `contents` and system to `systemInstruction`; yields `chunk.text()`, returns usage from `usageMetadata`.
- **`claude.ts`** — `@anthropic-ai/sdk` (new dep). Messages streaming API; system prompt as the top-level `system` param, history as `messages`; yields text deltas from `content_block_delta` events; returns usage from the final message. **Consult the `claude-api` skill for exact API + model ids.**
- **`openai.ts`** — `openai` (new dep). Chat Completions streaming with `stream: true` and `stream_options: { include_usage: true }`; system prompt as a leading system message; yields `choices[0].delta.content`; returns usage from the final usage chunk.
- **`index.ts`** — `getAdapter(provider: LLMProvider): LLMAdapter` dispatch.

Each adapter is small, single-responsibility, and unit-testable against a mocked SDK stream (assert it forwards deltas in order and reports usage). The SSE handler stays provider-agnostic.

## 4. Key resolution + chat integration

New helper (in `apps/api/src/lib/llm/index.ts` or a small `resolve.ts`):

```ts
export function resolveApiKey(provider: LLMProvider, workspaceApiKeys: Record<string,string> | undefined):
  { ok: true; apiKey: string } | { ok: false; reason: 'missing_key' }
```

- Decrypt `workspaceApiKeys[provider]` if present → use it.
- Else if `provider === 'gemini'` and `process.env.GEMINI_API_KEY` set → platform fallback.
- Else → `{ ok: false, reason: 'missing_key' }`.

In **`POST /widget/chat`** ([apps/api/src/routes/widget.ts](../../../apps/api/src/routes/widget.ts)), replace steps 6–7's direct Gemini construction with:
1. `provider = providerOf(llmModel) ?? 'gemini'`.
2. `resolveApiKey(...)`. If `{ ok: false }`: this is a **pre-stream** condition → return JSON `502 { error: 'The AI provider is not configured. Add an API key in Settings.' }` (operator-facing truth) — but because the visitor sees only the widget, also persist a fallback assistant message (`"Sorry, I'm not able to answer right now."`) so the conversation isn't silently broken, and still emit the SSE `error` event if the stream has started. Since resolution happens before streaming, prefer the JSON path (the widget already treats a non-SSE response as an error and shows its generic error bubble).
3. Build `ChatMessage[]` from history (the last-10 window already fetched), call `getAdapter(provider).streamChat({ model: llmModel, systemPrompt: fullSystemPrompt, messages, apiKey })`, and drive the existing SSE loop from the async generator — `for await (const {text} of stream)` → `chunk` events; capture the generator's return value for `promptTokens`/`completionTokens`. All existing persistence, usage counters, Langfuse instrumentation, and `done`/`error` handling stay identical (they already only depend on `reply` + token counts).

Langfuse `generation.model` becomes `llmModel` (already is); `name` generalizes from `gemini-chat` to `llm-chat`.

## 5. Web UI

- **Agent page** ([apps/web/src/app/dashboard/agent/page.tsx](../../../apps/web/src/app/dashboard/agent/page.tsx)) — the model selector becomes provider-grouped over `LLM_MODELS` (headers "Gemini / Claude / OpenAI", cards per model). Selecting a non-Gemini model whose provider has no key set shows an inline hint linking to Settings → API keys. `PUT /workspace/agent` validation broadens from `GEMINI_MODELS` to `LLM_MODELS`.
- **Settings page** (from Sub-project A) gains an **API keys** card: one row per provider showing "Set ✓ / Not set", a paste-field + Save (`PUT /workspace/keys/:provider`), and a Remove button (`DELETE`). Values are write-only — never pre-filled. Gemini's row notes "Optional — uses the platform key if left empty."

## 6. Error handling summary

- Missing `API_KEY_ENCRYPTION_SECRET` → the crypto module throws on first use; document the env var in `apps/api/.env.example` and the architecture doc. (Chat that needs decryption fails loudly rather than silently mis-decrypting.)
- Missing customer key for Claude/OpenAI → pre-stream JSON 502 with an actionable message; widget shows its generic error bubble.
- Provider SDK errors mid-stream → existing `error` SSE event + Langfuse ERROR (unchanged).
- Decryption failure (tampered/rotated secret) → treated as a provider error for that request; logged; does not crash the process.

## 7. Testing & verification

- **Unit tests** (`bun test`, `apps/api` + `packages/shared`): crypto round-trip + tamper/wrong-key rejection; `resolveApiKey` (customer key, gemini fallback, missing → error); `providerOf`/`findModel`/catalog integrity (every model id unique, provider valid); each adapter forwarding deltas + usage against a mocked SDK stream.
- **Live E2E** (Gemini path, real services): chat still streams end-to-end via the new abstraction; set a (fake) Claude key → `keyStatus.claude` flips true, key never returned by `GET /workspace`; select a Claude model with no key → widget shows the error bubble and the operator-facing 502 message is correct.
- **Deferred verification** (documented, needs your keys): real Claude and OpenAI streaming responses. Adapters are unit-verified against mocked streams until keys are provided.

## Out of scope

Per-provider model parameters (temperature, max tokens) in the UI; streaming token-cost display; provider-specific tool use; key rotation UI; Cloud KMS (app-layer AES is the agreed posture, upgradeable later).
