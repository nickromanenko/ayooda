# Ayooda Sub-project D — Telegram Channel — Design Spec

**Date:** 2026-07-12
**Status:** Approved for planning
**Scope:** Let a workspace connect its own Telegram bot so the same RAG agent answers Telegram DMs, routed into the existing conversations/inbox with human takeover and billing parity.

## Background

Ayooda currently answers only through the embedded web widget. `ChannelType` already includes `'telegram'` but no Telegram integration exists. This adds a second channel: a per-workspace bot (white-label) whose messages flow through the same RAG pipeline, the same Firestore conversations/messages, the same inbox + human takeover, and the same billing gate.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Bot model | **Per-workspace bot token** — each workspace pastes its own BotFather token; stored AES-256-GCM encrypted (reusing `apps/api/src/lib/crypto.ts`). Each bot has its own webhook. |
| Message scope | **Text only** — non-text updates get a polite "I can only read text right now." |
| Takeover | Operator replies in the inbox are also delivered to the Telegram chat via `sendMessage`. |
| Human-active behavior | When a conversation is in `human` status, the bot **stays silent** on new inbound messages (saved for the operator, no auto-reply). |
| Billing | Telegram new conversations go through the same `checkEntitlement` gate; an unentitled workspace's bot politely declines. |
| Transport | Telegram **webhook** (not long-polling), one per bot, secured by Telegram's `secret_token` header. |

---

## 1. Shared agent-turn extraction (`apps/api/src/lib/chat/`)

The RAG orchestration is currently inline in `POST /widget/chat` ([apps/api/src/routes/widget.ts](../../../apps/api/src/routes/widget.ts)). Extract the channel-agnostic core into `apps/api/src/lib/chat/agent-turn.ts` so both the widget and Telegram reuse it, without duplicating RAG logic and without changing the widget's behavior.

**Two-phase design** (so the widget keeps its pre-stream 402 and token streaming):

```ts
export interface PrepareTurnInput {
  workspaceId: string
  channelId: string
  conversationId: string
  visitorId: string
  message: string
  channelType: 'web_widget' | 'telegram'
  // telegram-only: chat id to persist on a new conversation (for later operator delivery)
  telegramChatId?: number
}

export type PreparedTurn =
  | { kind: 'gated'; reason: GateReason }                       // billing gate on a NEW conversation
  | { kind: 'error'; error: string }                            // missing/undecryptable key (pre-send)
  | {
      kind: 'ready'
      chatParams: ChatParams                                    // model, systemPrompt, messages, apiKey (for streamChat)
      sources: Array<{ docId: string; source: string; score: number }>
      trace: LangfuseTrace
      // Persist the assistant reply + update conversation + usage counters. Returns the saved message id.
      persist: (reply: string, promptTokens: number, completionTokens: number) => Promise<string>
    }

export async function prepareTurn(input: PrepareTurnInput): Promise<PreparedTurn>
```

`prepareTurn` performs, in order (identical to the current widget flow): conversation get-or-create with the visitorId ownership check; the **billing gate** on a new conversation (via `checkEntitlement`/`shouldResetPeriod`) → returns `{kind:'gated'}` before creating; conversation create + lifetime/period counters; save the user message; fetch last-10 history; RAG embed + Pinecone retrieval (non-fatal); provider + `resolveOpenRouterKey` (→ `{kind:'error'}` on missing/undecryptable key); build the full system prompt + `ChatParams`; create the Langfuse trace (name `agent-chat`, metadata includes `channelType`). It returns a `persist` closure capturing `convRef`/`messagesRef`/`workspaceRef` that saves the assistant message (with `sources`, `llmModel`, token counts), updates `lastMessage`/`updatedAt`, and increments `usage.messageCount` (+2) / `usage.tokenCount` — exactly today's behavior.

For a new **telegram** conversation, `prepareTurn` also stores `channelType: 'telegram'` and `telegramChatId` on the conversation doc (so operator delivery later knows where to send).

**Widget refactor** ([apps/api/src/routes/widget.ts](../../../apps/api/src/routes/widget.ts)): the `POST /chat` handler keeps its rate-limit + channel lookup, then calls `prepareTurn(...)`. On `gated` → the existing `402 { error, reason }` JSON; on `error` → the existing `502` JSON; on `ready` → `streamSSE` driving `streamChat(chatParams)` with `onDelta = writeSSE chunk`, then `persist(...)`, then the `done` event — **byte-identical SSE contract**. This refactor must preserve the widget's current behavior; the E2E re-verifies streaming, the 402 gate, and the 502.

## 2. Telegram client + update parser (`apps/api/src/lib/telegram/`)

`apps/api/src/lib/telegram/client.ts` — thin `fetch` wrappers over the Bot API (`https://api.telegram.org/bot<token>/<method>`):
- `getMe(token)` → `{ id, username, first_name }` (validates the token on connect).
- `setWebhook(token, url, secretToken)` / `deleteWebhook(token)`.
- `sendMessage(token, chatId, text)` — used for bot replies and operator delivery.
All return parsed JSON; non-`ok` Telegram responses throw with the `description`.

`apps/api/src/lib/telegram/update.ts` — pure `parseUpdate(update): ParsedUpdate` (TDD):
```ts
export type ParsedUpdate =
  | { kind: 'text'; chatId: number; userId: number; text: string }
  | { kind: 'nontext'; chatId: number; userId: number } // message but no usable text (photo/voice/sticker/…)
  | { kind: 'ignore' }                                   // edited messages, channel posts, callbacks, etc.
```
Reads `update.message`; a `message` with non-empty `text` → `text`; a `message` without text → `nontext`; anything else (`edited_message`, `channel_post`, `callback_query`, missing message) → `ignore`. Fully unit-testable.

## 3. Connect / disconnect (authed, under `/channels`)

Extend [apps/api/src/routes/channels.ts](../../../apps/api/src/routes/channels.ts):

- **`POST /channels/telegram`** `{ botToken }` — validate via `getMe` (400 on invalid token). Generate a random `webhookSecret` (32 hex). Create (or update) a `telegram` channel doc: `{ type:'telegram', id, workspaceId, botTokenEnc: encryptSecret(botToken), webhookSecret, telegram: { botUsername, botId }, isActive: true, createdAt }`. Call `setWebhook(token, `${API_BASE}/telegram/webhook/${channelId}`, webhookSecret)`. Return `{ channelId, botUsername }`. Idempotent: one telegram channel per workspace — re-connecting replaces the token + re-registers the webhook. `API_BASE` from an env var (`API_PUBLIC_URL`) — required for webhook registration.
- **`DELETE /channels/telegram`** — `deleteWebhook(token)` (best-effort), delete the channel doc. Return `{ ok: true }`.
- **`GET /channels`** already lists channels; the telegram channel's response must **never** include `botTokenEnc`/`webhookSecret` (strip them, like other secrets) — expose only `botUsername`/`isActive`.

## 4. Inbound webhook (`POST /telegram/webhook/:channelId`, public)

New route `apps/api/src/routes/telegram.ts` mounted at `/telegram`:

- Public (no `requireAuth`). Auth is Telegram's secret: compare the `X-Telegram-Bot-Api-Secret-Token` header against the channel's stored `webhookSecret`; mismatch → 401. Unknown channel → 200 (acknowledge, so Telegram doesn't retry forever) + warn.
- Read the JSON body, `parseUpdate`. `ignore` → 200 immediately. `nontext` → `sendMessage(token, chatId, "I can only read text right now.")`, 200. `text` → proceed.
- Map to a conversation: `conversationId = tg_<chatId>`, `visitorId = tg_<userId>`.
- Load the conversation. **If it exists and `status === 'human'`** → save the incoming message as a `user` message and **do not auto-reply** (operator handles it via the inbox); 200.
- Otherwise run the agent turn: `prepareTurn({ workspaceId, channelId, conversationId, visitorId, message: text, channelType:'telegram', telegramChatId: chatId })`.
  - `gated` → `sendMessage(token, chatId, "This assistant is temporarily unavailable.")`, 200.
  - `error` → `sendMessage(token, chatId, "The assistant isn't configured yet. Please contact the site owner.")`, 200 (and it's logged).
  - `ready` → consume `streamChat(chatParams)` fully (accumulate all deltas; no streaming to Telegram), `persist(reply, promptTokens, completionTokens)`, then `sendMessage(token, chatId, reply)`. 200.
- The route always returns 200 quickly on handled updates (Telegram retries non-2xx). Bot-API/Firestore errors inside are caught, logged, and still 200 (avoid retry storms) — except signature mismatch (401) which must reject.
- The bot token is decrypted from the channel's `botTokenEnc` for `sendMessage`.

## 5. Operator takeover delivery

In [apps/api/src/routes/conversations.ts](../../../apps/api/src/routes/conversations.ts) `POST /:id/messages`: after saving the operator message + updating the conversation (existing), if the conversation's `channelType === 'telegram'` and it has a `telegramChatId`, load the workspace's telegram channel, decrypt its token, and `sendMessage(token, telegramChatId, content)` (best-effort; a Telegram send failure is logged, doesn't fail the request). This mirrors how the widget's live event feed delivers operator messages. Web-widget conversations are unaffected (no `channelType`/`telegramChatId`).

## 6. Shared types (`packages/shared`)

- `ConversationDoc` gains `channelType?: ChannelType` and `telegramChatId?: number`.
- `ChannelDoc` gains optional telegram fields: `botTokenEnc?: string` (encrypted, server-only), `webhookSecret?: string` (server-only), `telegram?: { botUsername: string; botId: number }`.
- No new `ChannelType` value needed (`'telegram'` already exists).

## 7. Web — Connect Telegram card

On [apps/web/src/app/dashboard/channels/page.tsx](../../../apps/web/src/app/dashboard/channels/page.tsx), replace the "coming soon" Telegram mention with a real card: a bot-token input (password field) + Connect → `POST /channels/telegram` → shows "Connected as @botUsername" with a Disconnect button (`DELETE /channels/telegram`). Include a one-line hint ("Create a bot with @BotFather and paste its token."). Token is write-only (never returned). Telegram conversations appear in the existing inbox; add a small channel badge (Telegram vs Web) on inbox rows if the conversation's `channelType` is set (minor, optional).

## 8. Error handling

- Invalid bot token on connect → 400 with Telegram's message.
- Missing `API_PUBLIC_URL` env → connect returns 500 with a clear message (webhook can't be registered); documented in `.env.example`.
- Webhook secret mismatch → 401 (the only non-200 for a delivered update).
- Telegram API failures on send → logged, non-fatal (the conversation/persistence already succeeded).
- Decrypt failure on the stored token → treated as a send error, logged; the update is acknowledged 200.
- Billing gate / key errors surface as polite Telegram messages (§4), never raw internals.

## 9. Testing & verification

- **Unit tests** (`bun test`): `parseUpdate` (text / nontext / edited_message / channel_post / callback_query / missing-message); the Telegram client's request shaping + non-ok throw against a mocked `fetch`; `prepareTurn`'s gated/error/ready branches are largely covered by the existing entitlement/openrouter unit tests, but add a focused test that a `gated` outcome does not create an assistant message (mock-light or via the extracted gate).
- **Widget regression**: re-verify (E2E) the widget still streams, gates (402), and errors (502) after the `prepareTurn` refactor.
- **Live Telegram (with the real `TELEGRAM_BOT_API_KEY`)**: `getMe` validates the token and returns the bot username; `POST /channels/telegram` stores it encrypted + registers a webhook (verify via Telegram `getWebhookInfo`); `GET /channels` never leaks the token/secret. Drive the inbound path with a **synthetic** Telegram Update POSTed to `/telegram/webhook/:channelId` with the correct secret header → confirm the agent turn runs and a `sendMessage` is attempted (and the message is persisted in the conversation + visible to the inbox). Operator delivery: `POST /conversations/:id/messages` on a telegram conversation attempts `sendMessage`.
- **Deferred (documented, needs a public tunnel + you messaging the bot once)**: a true end-to-end round-trip (message the bot from a real Telegram account → reply arrives on the phone). Everything reachable locally is verified; the final hop needs `API_PUBLIC_URL` to be a real HTTPS endpoint Telegram can reach.

## Out of scope

Media ingestion (photos/voice/files as knowledge or answers); inline keyboards/commands beyond text; group chats (DM/private chats only for v1); Telegram-specific formatting (Markdown/HTML) beyond plain text; WhatsApp/Messenger (later sub-projects).
