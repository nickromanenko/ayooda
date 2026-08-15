# Ayooda — Architecture

## Overview

Ayooda is a multi-tenant SaaS platform that lets companies deploy an AI-powered customer support agent on their website and other messaging channels. Each company (workspace) configures one agent with its own knowledge base, identity, and channel integrations. Two channels are live today: the **web widget** and **Telegram** (per-workspace bot, white-label — a workspace connects its own bot by pasting a BotFather token).

---

## Infrastructure Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CUSTOMER'S WEBSITE                          │
│                                                                       │
│   <script src="https://<proj>.web.app/widget.js"                     │
│           data-agent-id="abc123" async></script>                     │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ HTTP (widget API)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       FIREBASE PROJECT                               │
│                                                                       │
│  ┌─────────────────────────────┐   ┌──────────────────────────────┐ │
│  │     Firebase App Hosting    │   │     Firebase Hosting (CDN)   │ │
│  │                             │   │                              │ │
│  │   apps/web (Next.js)        │   │  apps/widget/dist/widget.js  │ │
│  │   - Landing page            │   │  Served at /widget.js        │ │
│  │   - Auth pages              │   └──────────────────────────────┘ │
│  │   - Dashboard               │                                     │
│  └──────────────┬──────────────┘                                     │
│                 │ API calls (Firebase JWT)                           │
│                 ▼                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Cloud Run                                  │   │
│  │                                                               │   │
│  │  ┌─────────────────────────┐  ┌──────────────────────────┐  │   │
│  │  │   ayooda-api            │  │   ayooda-scraper         │  │   │
│  │  │   (Hono on Bun)         │  │   (Cloud Run Job)        │  │   │
│  │  │                         │  │                          │  │   │
│  │  │  - Auth middleware       │  │  - Puppeteer/Playwright  │  │   │
│  │  │  - Workspace CRUD        │  │  - Crawl website URLs    │  │   │
│  │  │  - Knowledge ingestion   │  │  - Chunk text content    │  │   │
│  │  │  - RAG chat endpoint     │  │  - Embed via Gemini API  │  │   │
│  │  │  - Widget public API     │  │  - Upsert to Pinecone    │  │   │
│  │  │  - Trigger scraper job   │  │  - Update Firestore doc  │  │   │
│  │  └────────────┬────────────┘  └──────────────────────────┘  │   │
│  └───────────────┼───────────────────────────────────────────────┘  │
│                  │                                                    │
│  ┌───────────────┼───────────────────────────────────────────────┐  │
│  │   Firestore   │              Firebase Auth                    │  │
│  │               │                                               │  │
│  │  users/       │              - Google Sign-In                 │  │
│  │  workspaces/  │              - Email / Password               │  │
│  │    knowledge/ │              - JWT token verification         │  │
│  │    channels/  │                                               │  │
│  │    conversations/                                             │  │
│  │      messages/│                                               │  │
│  │    visitorMemory/                                             │  │
│  │    copilotUsers/                                              │  │
│  └───────────────┘───────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
        ┌────────────┐  ┌────────────┐  ┌────────────┐
        │  Pinecone  │  │ Gemini API │  │ OpenRouter │
        │            │  │            │  │            │
        │ Vector DB  │  │ Embeddings │  │ Chat LLMs  │
        │ Per-workspace  gemini-      │  │ (Gemini /  │
        │ namespace  │  embedding-001│  │ Claude/GPT)│
        └────────────┘  └────────────┘  └────────────┘
                                         (workspace key, else platform
                                          key for Gemini-family only)
```

---

## Services

### apps/web — Next.js (Firebase App Hosting)

The combined landing page and dashboard application.

- **Runtime**: Node.js via Firebase App Hosting
- **Framework**: Next.js (App Router)
- **Auth**: Firebase Auth client SDK
- **Real-time**: Firestore client SDK with `onSnapshot` listeners
- **Styling**: Tailwind CSS + shadcn/ui

Public routes:
- `/` — Landing page
- `/login` — Sign in
- `/signup` — Create account

Protected routes (require Firebase auth session):
- `/dashboard` — Overview & analytics
- `/dashboard/inbox` — Live conversation inbox
- `/dashboard/knowledge` — Knowledge base management
- `/dashboard/agent` — Agent identity + LLM config
- `/dashboard/channels` — Channels + embed code generator
- `/dashboard/settings` — Workspace settings
- `/dashboard/team` — Team members + invites (owner only)

### apps/api — Hono on Bun (Cloud Run)

The REST API backend. All dashboard routes require a Firebase JWT in the `Authorization: Bearer <token>` header. Widget endpoints are public but validated by `agentId`; the Telegram webhook is public but authenticated via a per-channel secret token (see [Security Model](#security-model)).

- **Runtime**: Bun
- **Framework**: Hono
- **Auth middleware**: Firebase Admin SDK JWT verification
- **Deployment**: Cloud Run (always-on, min 1 instance)

Both channels (web widget, Telegram) share the RAG orchestration in `apps/api/src/lib/chat/agent-turn.ts` (`prepareTurn`) — see [Chat Flow](#chat-flow).

### apps/widget — Embeddable JS (Firebase Hosting CDN)

A self-contained TypeScript bundle compiled with Vite. No runtime framework dependencies. Served as a single `.js` file from Firebase Hosting's global CDN.

- **Bundle target**: ES2020, IIFE format
- **Size target**: < 30kb gzipped
- **Rendering**: Shadow DOM (style isolation from host page)
- **Communication**: Calls `ayooda-api` `/widget/*` endpoints

### apps/scraper — Puppeteer Job (Cloud Run Job)

A Cloud Run Job (not a continuous service) triggered by the main API. Now a general ingestor — scrapes a website or extracts text from an uploaded file, chunks it, generates embeddings, and upserts into Pinecone.

- **Runtime**: Node.js (or Bun)
- **Ingestion mode**: `DOC_TYPE` env var selects `webpage` (uses `URL`) or `file` (uses `STORAGE_PATH`, a Firebase Storage object path)
- **Scraping**: Puppeteer + crawlee for multi-page crawl (`webpage` mode)
- **File text extraction**: pdf-parse (PDF), mammoth (DOCX), UTF-8 read (txt/csv/md) (`file` mode)
- **Chunking**: Recursive text splitter (~500 tokens, 50-token overlap)
- **Embeddings**: Google `gemini-embedding-001` via `@google/generative-ai` (768-dim via `outputDimensionality`)
- **Vector storage**: Pinecone client

### packages/shared — TypeScript Types

Shared type definitions consumed by both `apps/web` and `apps/api`.

```typescript
// Firestore document shapes, API request/response types, enums
export type LLMProvider = 'gemini' | 'claude' | 'openai'
export const LLM_MODELS: LLMModel[]  // provider-aware catalog keyed by OpenRouter slug, e.g. 'anthropic/claude-sonnet-4.5'
export type KnowledgeDocStatus = 'pending' | 'processing' | 'indexed' | 'error'
export type ConversationStatus = 'bot' | 'human' | 'resolved'
export type ChannelType = 'web_widget' | 'telegram'
// ... full models
```

### Skills

Per-agent, opt-in capabilities layered onto the chat turn without touching the core RAG flow.

- **Catalogue** (`packages/shared/src/skills.ts`): a fixed `SKILLS` array — `memory`, `scoring`, `web_search` — each entry carrying `id`, `label`, `description`, `defaultConfig`, and `minTier` (the lowest plan tier the skill is available on; `null` means every plan, including trial). `validateSkillConfig` validates a skill's stored config against its shape before use, falling back to `defaultConfig` on invalid input.
- **Attachment**: `workspaces/{workspaceId}/agents/{agentId}/skills/{skillId}` — one doc per skill per agent, `{ enabled: boolean, config: object }`. `loadEnabledSkills()` (`apps/api/src/lib/skills/registry.ts`) reads the enabled rows, drops any not entitled by the workspace's plan tier, and returns them ordered by the catalogue (not Firestore's return order) so hook execution is deterministic.
- **Modules**: each skill is a `SkillModule` (`apps/api/src/lib/skills/types.ts`) implementing up to three hooks:
  - `contributeContext(ctx)` — returns an optional string block folded into the system prompt (e.g. memory's recalled facts about the visitor).
  - `contributeTools(ctx)` — returns an AI SDK `ToolSet` the model can call mid-turn (e.g. web search's `web_search` tool).
  - `afterConversation(ctx)` — runs once a conversation is resolved, off the request path (e.g. scoring's score + summary, memory's fact extraction).
  Modules register themselves via `registerSkill()` as a side effect of being imported by `apps/api/src/lib/skills/all.ts`, the single barrel both `prepareTurn` and the sweep import.
- **Where `prepareTurn` calls them** (`apps/api/src/lib/chat/agent-turn.ts`): after RAG retrieval, `gatherContext()` calls every loaded skill's `contributeContext` and appends the results to the prompt; before dispatching to the LLM, `gatherTools()` calls `contributeTools` and merges the results into the tool set alongside the agent's configured webhook tools. Both (`apps/api/src/lib/skills/run.ts`) isolate each skill's hook in its own try/catch — one skill throwing never blocks another or fails the turn.
- **The sweep** (`apps/api/src/lib/skills/sweep.ts`, exposed as `POST /internal/sweep`): a Cloud Scheduler-driven maintenance pass, authenticated by comparing the `x-sweep-secret` header to the `SWEEP_SECRET` env var (constant-time, byte-length compare — an unset secret never matches, so the endpoint stays closed by default). Each run does three independent, individually-isolated phases:
  1. **Idle close** — bot conversations idle for 30+ minutes are marked `resolved`, stamped `autoClosedAt`, and flagged `pendingPostProcess: true`.
  2. **Post-process** — every conversation flagged `pendingPostProcess` (auto-closed or operator-resolved) runs each loaded skill's `afterConversation` hook, then is stamped `postProcessedAt` and `pendingPostProcess: false` regardless of which (or whether any) skills fired. `postProcessedAt` is the idempotency marker: it's what makes a conversation "done," independent of `scoredAt` (written only by the scoring skill), so an agent with only the memory skill enabled doesn't get re-processed — and re-charged for the extraction LLM call — on every sweep run. If a skill's hook throws, the conversation still gets its flag cleared but the run is counted as `failed`, not `scored`, in the report.
  3. **Memory purge** — `visitorMemory` docs with an expired `nextExpiryAt` have their stale facts dropped.
  The endpoint returns a `{ closed, scored, purged, failed }` report per run.

### Copilot

An authenticated in-app chat surface (`/dashboard/copilot`) where team members talk to their own workspace agents — a test/staff-assist surface, not a customer channel.

- **Threads**: `workspaces/{workspaceId}/copilotUsers/{uid}/threads/{threadId}`, with a `messages` subcollection. The thread *list* is server-served — `GET /copilot/threads` (`apps/api/src/routes/copilot.ts`) reads it via the Admin SDK, which bypasses Firestore rules. The **only** client-side Firestore read is opening a thread: `apps/web/src/app/dashboard/copilot/page.tsx` attaches an `onSnapshot` listener directly to that thread's `messages` subcollection, and the `{uid}` path segment is the entire privacy mechanism for it (see [Firestore Security Rules](#firestore-security-rules)). The collection is deliberately named `threads`, not `conversations`: the sweep's `collectionGroup('conversations')` queries (`apps/api/src/lib/skills/sweep.ts`) match only that literal collection name, so Copilot threads are structurally invisible to it — never auto-closed, scored, or extracted into visitor memory.
- **Orchestration**: `prepareCopilotTurn` (`apps/api/src/lib/chat/copilot-turn.ts`) is a second orchestrator alongside `prepareTurn` (`apps/api/src/lib/chat/agent-turn.ts`). Both share the four modules extracted from `prepareTurn` for this reuse — agent resolution (`agent-resolution.ts`), RAG retrieval (`retrieval.ts`), prompt assembly (`prompt.ts`), and tool loading (`turn-tools.ts`). Copilot filters the scoring skill out of its loaded skill set (`skillsForCopilot`), since scoring exists to grade customer conversations, not staff testing.
- **Usage**: Copilot has its own cap, `usage.copilotPeriodCount`, checked once per thread on creation (never per message) via `checkCopilotEntitlement` (`apps/api/src/lib/billing/copilot-entitlement.ts`), and it never touches `usage.periodConversationCount`, the customer-conversation quota. The two counters share one `usage.periodStart`, so both `prepareTurn` and the Copilot route (`apps/api/src/routes/copilot.ts`) reset **both** counters together whenever `shouldResetPeriod` detects a rollover — resetting only one would either lock out paying customers or leave Copilot's cap permanently exhausted for a workspace with no customer traffic.

---

## Firestore Schema

```
users/
  {userId}
    email: string
    displayName: string
    photoURL: string | null
    workspaceId: string
    role: 'owner' | 'member'   ← missing on existing users treated as 'owner' (no backfill); members are inbox operators only
    createdAt: Timestamp

pendingInvites/
  {emailLower}                 ← email (lowercased) as doc id ⇒ one pending invite per email, globally
    email: string
    workspaceId: string
    invitedBy: string          ← uid of the inviting owner
    createdAt: Timestamp

workspaces/
  {workspaceId}
    name: string
    ownerId: string
    createdAt: Timestamp
    agent:
      name: string
      photoURL: string | null
      description: string
      systemPrompt: string
      llmModel: string           ← OpenRouter slug, e.g. 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash' (provider derived from slug)
    openRouterKey: string | undefined  ← workspace's own OpenRouter key, AES-256-GCM encrypted (API_KEY_ENCRYPTION_SECRET), server-only, never returned
    subscription:
      status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
      tier: 'lite' | 'core' | 'max' | null
      trialEndsAt: Timestamp | null        ← 14 days from workspace creation; trial lives in Firestore only, no Stripe object yet
      currentPeriodEnd: Timestamp | null
      stripeCustomerId: string | null      ← server-only, never returned to clients
      stripeSubscriptionId: string | null  ← server-only, never returned to clients
    usage:
      conversationCount: number
      messageCount: number
      tokenCount: number
      periodConversationCount: number      ← resets each billing/trial period; checked against the tier/trial cap for entitlement
      periodStart: Timestamp

  {workspaceId}/knowledge/
    {docId}
      type: 'webpage' | 'file'
      source: string             ← URL or original filename
      status: 'pending' | 'processing' | 'indexed' | 'error'
      chunkCount: number
      errorMessage: string | null
      createdAt: Timestamp
      indexedAt: Timestamp | null

  {workspaceId}/channels/
    {channelId}
      type: 'web_widget' | 'telegram'
      config:
        widgetColor: string      ← hex color
        widgetPosition: 'bottom-right' | 'bottom-left'
        welcomeMessage: string
        agentName: string        ← copied from agent for widget perf
        agentPhotoURL: string | null
      embedCode: string          ← generated <script> tag
      isActive: boolean
      createdAt: Timestamp
      botTokenEnc: string        ← telegram only; AES-256-GCM encrypted BotFather token, server-only, never returned by any endpoint
      webhookSecret: string      ← telegram only; server-only, matched against Telegram's X-Telegram-Bot-Api-Secret-Token header
      telegram:                  ← telegram only, server-only
        botUsername: string
        botId: number

  {workspaceId}/conversations/
    {conversationId}
      channelId: string
      channelType: 'web_widget' | 'telegram'
      visitorId: string          ← anonymous ID set by widget
      telegramChatId: number | null  ← set when channelType = 'telegram'
      status: 'bot' | 'human' | 'resolved'
      operatorId: string | null  ← userId of operator if status = 'human'
      hadTakeover: boolean       ← set true on operator takeover; used for dashboard automation rate
      createdAt: Timestamp
      updatedAt: Timestamp
      lastMessage: string        ← preview of last message content

    {conversationId}/messages/
      {messageId}
        role: 'user' | 'assistant' | 'operator'
        content: string
        createdAt: Timestamp
        metadata:
          sources: Array<{ docId: string, source: string, score: number }>
          llmProvider: string
          promptTokens: number
          completionTokens: number
```

---

## Pinecone Schema

- **Index**: One index per Ayooda environment (`ayooda-prod`, `ayooda-dev`)
- **Namespace**: One namespace per workspace — `workspace_{workspaceId}`
- **Dimensions**: 768 (Google `gemini-embedding-001`, truncated via `outputDimensionality`)
- **Metric**: cosine

Vector metadata per chunk:
```json
{
  "workspaceId": "abc123",
  "docId": "firestore-doc-id",
  "source": "https://example.com/pricing",
  "chunkIndex": 3,
  "text": "...chunk text for retrieval display..."
}
```

---

## API Surface

### Protected endpoints (require `Authorization: Bearer <firebase-jwt>`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/verify` | Verify JWT, create user + workspace if new — or, if the email matches a `pendingInvites` doc, join as a `member` of that workspace instead (invite consumed in the same batch) |
| GET | `/workspace` | Get workspace + agent config (includes `hasOpenRouterKey: boolean`, never the raw key, and the caller's `role`) |
| PUT | `/workspace/agent` | Update agent identity and LLM config (model validated against the full multi-provider catalog) — **owner only** |
| PUT | `/workspace` | Update workspace name — **owner only** |
| PUT | `/workspace/key` | Set the workspace's OpenRouter API key (encrypted at rest before storing) — **owner only** |
| DELETE | `/workspace/key` | Remove the workspace's stored OpenRouter API key — **owner only** |
| GET | `/user` | Get current user profile |
| PUT | `/user` | Update user profile (`displayName`) |
| GET | `/team` | List workspace members and pending invites — **owner only** |
| POST | `/team/invite` | Invite by email, creates `pendingInvites/{emailLower}`; `409` if the email already has an account or is already invited — **owner only** |
| DELETE | `/team/invite/:email` | Revoke a pending invite (scoped to the caller's workspace) — **owner only** |
| DELETE | `/team/member/:uid` | Remove a member — never the owner; deletes their `users/{uid}` doc, so they re-provision a fresh solo workspace on next login — **owner only** |
| POST | `/knowledge/scrape` | Trigger scraper job for a URL — **owner only** |
| POST | `/knowledge/upload` | Multipart file upload (pdf/docx/txt/csv/md, max 10 MB) → Firebase Storage → ingestion job — **owner only** |
| GET | `/knowledge` | List knowledge base documents — **owner only** |
| DELETE | `/knowledge/:id` | Delete doc + Pinecone vectors — **owner only** |
| POST | `/knowledge/:id/reindex` | Clear existing Pinecone vectors and re-run ingestion for the doc — **owner only** |
| GET | `/conversations` | List conversations (filter by status, channel) |
| GET | `/conversations/:id` | Get conversation with messages |
| POST | `/conversations/:id/takeover` | Operator takes over conversation |
| POST | `/conversations/:id/resolve` | Mark conversation as resolved |
| GET | `/channels` | List channels for workspace — **owner only** |
| POST | `/channels/web-widget` | Create or update web widget channel — **owner only** |
| POST | `/channels/telegram` | Connect a workspace's Telegram bot: validates the token via `getMe`, encrypts and stores it, registers the webhook — **owner only** |
| DELETE | `/channels/telegram` | Disconnect the Telegram channel — **owner only** |
| POST | `/billing/checkout` | Create a Stripe Checkout session for the selected tier, returns the hosted URL — **owner only** |
| POST | `/billing/portal` | Create a Stripe Customer Portal session, returns the hosted URL — **owner only** |
| GET | `/billing` | Current plan, usage, and entitlement status (no Stripe IDs) — **owner only** |

### Public endpoints (no auth, validated by agentId)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/widget/config/:agentId` | Fetch agent appearance config for widget |
| POST | `/widget/chat` | Send message, receive AI response as an SSE stream (`chunk` / `done` / `error` events); gated for new conversations, see [Billing](#billing) |
| GET | `/widget/conversations/:id/events` | SSE feed of operator messages + status changes; requires `channelId` & `visitorId` query params |
| POST | `/telegram/webhook/:channelId` | Inbound Telegram updates; authenticated by matching the `X-Telegram-Bot-Api-Secret-Token` header to the channel's stored webhook secret via a constant-time compare — `401` on mismatch, otherwise always `200` (so Telegram never retry-storms) |
| POST | `/billing/webhook` | Stripe webhook, signature-verified — syncs `subscription` state to Firestore |

---

## Chat Flow

The core turn — billing gate → conversation setup → RAG retrieval → OpenRouter key resolution → prompt + persist — is implemented once in `apps/api/src/lib/chat/agent-turn.ts` (`prepareTurn`) and reused by both channels. The widget streams the response to the client as it's generated; Telegram accumulates the full response and delivers it with a single `sendMessage` call. New conversations on either channel go through the same billing gate (see [Billing](#billing)).

### Web Widget

```
Widget sends message
       │
       ▼
POST /widget/chat
  { agentId, conversationId, message }
       │
       ├─ 1. Resolve workspaceId from agentId (Firestore channel lookup)
       │
       ├─ 2. Fetch workspace agent config (llmModel, systemPrompt) and resolve the
       │       OpenRouter API key: workspace's own encrypted key (covers any model)
       │       or platform OPENROUTER_API_KEY (Gemini-family models only) — no key
       │       available → pre-stream JSON 502
       │
       ├─ 3. Embed message → Google gemini-embedding-001 (768-dim vector via outputDimensionality)
       │
       ├─ 4. Query Pinecone (namespace: workspace_{id}, top-k: 5)
       │
       ├─ 5. Build prompt:
       │       [system: agent persona + instructions]
       │       [context: top-k chunks from Pinecone]
       │       [history: last N messages from Firestore]
       │       [user: current message]
       │
       ├─ 6. Stream LLM response via OpenRouter (single OpenAI-compatible
       │       streaming endpoint; provider inferred from the model catalog slug)
       │       → SSE stream back to widget
       │
       └─ 7. On stream complete:
               Save user message + assistant message to Firestore
               Update conversation.updatedAt + lastMessage
               Increment workspace.usage.conversationCount
```

### Telegram

```
Telegram servers send an update
       │
       ▼
POST /telegram/webhook/:channelId
  (public; secret-token header checked against the channel's webhookSecret —
   401 on mismatch, otherwise always 200 so Telegram never retry-storms)
       │
       ├─ Non-text message → polite decline reply, no further processing
       │
       ├─ Conversation.status = 'human' → bot stays silent (operator has taken over)
       │
       └─ Otherwise → prepareTurn() (same billing gate, retrieval, key resolution,
               prompt + persist as the widget)
               → full response accumulated, then sent via Telegram sendMessage
```

Operator inbox replies to a Telegram conversation are delivered to the chat the same way, via `sendMessage`.

---

## Billing

### Model
- Three subscription tiers, billed monthly via Stripe: **Lite** ($25, 100 conversations/mo), **Core** ($55, 500 conversations/mo), **Max** ($195, 1500 conversations/mo)
- 14-day free trial, no card required — tracked entirely in Firestore (`subscription.trialEndsAt`), not in Stripe; trial conversation cap is 50
- Stripe Checkout (hosted) starts a subscription; Stripe Customer Portal (hosted) handles plan changes and cancellation
- A signed Stripe webhook (`POST /billing/webhook`) syncs `workspaces/{id}.subscription` from Stripe events
- Metered overage billing is out of scope for v1 (future)

### Entitlement
Resolved server-side on each gated request, no Stripe secrets exposed:
- `active` / `past_due` → the tier's monthly conversation cap applies
- `trialing` and within `trialEndsAt` → trial cap (50)
- Over the applicable cap, or trial/subscription expired → not entitled
- `active` subscription whose `tier` hasn't synced from Stripe yet → fail-open (avoids false gating on webhook lag)
- Stripe `unpaid` / `incomplete` statuses → fail closed

### Gate
`POST /widget/chat` hard-gates NEW conversations only: when the workspace is not entitled, it returns a pre-stream JSON `402` before any tokens stream. In-progress conversations are never gated mid-stream. The widget surfaces its generic error bubble on `402` — visitors never see billing-specific copy.

### Setup scripts (one-time, `apps/api/scripts/`)
- `setup-stripe.ts` — creates the Lite/Core/Max Stripe products and prices
- `backfill-trials.ts` — grants existing workspaces a fresh 14-day trial

---

## Team & Roles

### Model
- Each workspace has one **owner** and any number of **members**. Role lives on `users/{uid}.role` (`'owner' | 'member'`); a missing `role` (existing users, no backfill) is treated as `'owner'`.
- Members are inbox operators only — they can work `/conversations` (inbox + takeover) but cannot touch knowledge, channels, billing, workspace settings, or team management.

### Invites (no email infrastructure)
- The owner invites by email: `POST /team/invite` creates `pendingInvites/{emailLower}` (`{ email, workspaceId, invitedBy, createdAt }`) — email as the doc id means one pending invite per email, globally. `409` if the email already has an account or is already invited.
- On a first-time user's `POST /auth/verify`, if their email matches a pending invite, they're created as a `member` of that invite's workspace (no new workspace provisioned) and the invite doc is deleted in the same batch.
- The owner also gets a copyable `{WEB_PUBLIC_URL}/signup?invite=<email>` link from the invite response — auto-join is matched by email, not a token.
- `DELETE /team/invite/:email` revokes a pending invite (scoped to the caller's workspace). `DELETE /team/member/:uid` removes a member — never the owner — by deleting their `users/{uid}` doc, so they re-provision a fresh solo workspace on next login.

### Enforcement
- `requireOwner` middleware (must run after `requireAuth`) 403s non-owners: `PUT /workspace*`, `PUT`/`DELETE /workspace/key`, all `/knowledge`, all `/channels`, all authed `/billing`, all `/team` mutations.
- Members keep access to all `/conversations`, `GET /workspace` (now includes `role`), and `GET`/`PUT /user`. Public routes are unaffected.

---

## Security Model

### API Authentication
- All protected routes validate Firebase ID tokens via Firebase Admin SDK
- Token contains `uid` → API looks up `users/{uid}` → resolves `workspaceId` and `role`
- All data operations are scoped to the resolved `workspaceId`

### Widget Public Endpoints
- No auth required (widget runs on customer's anonymous visitors)
- `agentId` is validated against Firestore — invalid IDs return 404
- Rate limiting: in-memory, per-instance sliding-window limiter — `POST /widget/chat` allows 60 req/min per channel and 30 req/min per IP; `GET /widget/conversations/:id/events` allows 20 req/min per IP; over-limit requests get `429` with a `Retry-After` header
- CORS restricted to the workspace's registered domain (future)

### Telegram Public Endpoint
- No Firebase auth (Telegram servers call it directly)
- Authenticated by comparing Telegram's `X-Telegram-Bot-Api-Secret-Token` header to the channel's stored `webhookSecret` via a constant-time compare — `401` on mismatch
- Always returns `200` otherwise (even on internal errors), so Telegram never retry-storms the webhook

### Firestore Security Rules
- Client-side reads/writes from `apps/web` use Firestore rules requiring `request.auth.uid`
- The `workspaces/{id}` document itself is server-only (`allow read, write: if false`) — only the Admin SDK (which bypasses rules) can read or write it, so the AES-256-GCM-encrypted `openRouterKey` is never client-readable; no API endpoint returns the key either (only `hasOpenRouterKey`)
- `copilotUsers/{uid}/threads/{threadId}` (and its `messages` subcollection) allow read only `if request.auth.uid == uid` — a one-line comparison with no `get()` lookup, so another member's threads are simply not addressable. Writes are `allow write: if false`; only the API (Admin SDK) creates and appends to threads
- Server-side (API) uses Firebase Admin SDK which bypasses Firestore rules

### OpenRouter API Keys (bring-your-own-key)
- Each workspace may store one OpenRouter key at `workspaces/{id}.openRouterKey`, encrypted at rest with AES-256-GCM (app-layer; key derived from `API_KEY_ENCRYPTION_SECRET`)
- Never returned in any API response — `GET /workspace` exposes only `hasOpenRouterKey: boolean`; set/cleared via `PUT /workspace/key` / `DELETE /workspace/key`
- Resolution: workspace's own key covers all models; otherwise the platform `OPENROUTER_API_KEY` is used for Gemini-family models only; non-Gemini models with no key configured return a pre-stream JSON 502
- Possible future upgrade: move to Cloud KMS-backed envelope encryption

### Telegram Bot Tokens (bring-your-own-bot)
- Each workspace connects its own BotFather token at `channels/{id}.botTokenEnc`, encrypted at rest the same way as OpenRouter keys (AES-256-GCM, `API_KEY_ENCRYPTION_SECRET`)
- `POST /channels/telegram` validates the token via Telegram's `getMe` before encrypting and storing it, and registers the webhook (`{API_PUBLIC_URL}/telegram/webhook/:channelId`)
- Never returned by any endpoint

### Billing (Stripe)
- `POST /billing/webhook` is public but signature-verified: Stripe's async `constructEventAsync` checks the signature against the raw request body and `STRIPE_WEBHOOK_SECRET`
- The webhook resolves the target workspace via `metadata.workspaceId` (subscription events) or `client_reference_id` (checkout session events)
- `stripeCustomerId` / `stripeSubscriptionId` are never returned in any API response; `GET /billing` returns plan, usage, and entitlement only

---

## Deployment Topology

```
GitHub main branch
       │
       ├─── Firebase App Hosting ──► apps/web (Next.js)
       │     (auto-deploy on push)
       │
       ├─── Cloud Build + Cloud Run ──► apps/api (Hono/Bun Docker)
       │     (Dockerfile in apps/api/)
       │
       ├─── Cloud Build + Cloud Run Jobs ──► apps/scraper
       │     (Dockerfile in apps/scraper/)
       │
       └─── Firebase Hosting (manual deploy) ──► apps/widget/dist/widget.js
             firebase deploy --only hosting
```

### Environment Variables

**apps/api (Cloud Run secrets):**
```
FIREBASE_PROJECT_ID
FIREBASE_SERVICE_ACCOUNT_KEY  ← JSON, stored as Cloud Run secret
FIREBASE_STORAGE_BUCKET       ← optional, defaults to <project-id>.firebasestorage.app
PINECONE_API_KEY
PINECONE_INDEX
GEMINI_API_KEY                ← for embeddings
OPENROUTER_API_KEY            ← platform fallback, used for Gemini-family models when a workspace has no key of its own
API_KEY_ENCRYPTION_SECRET     ← encrypts/decrypts customer OpenRouter keys and Telegram bot tokens (AES-256-GCM)
SCRAPER_JOB_URL               ← Cloud Run Job trigger URL
API_PUBLIC_URL                ← public HTTPS base URL, used to register each workspace's Telegram webhook
WEB_PUBLIC_URL                ← public base URL of apps/web, used to build the team invite link (/signup?invite=<email>)
TELEGRAM_BOT_API_KEY          ← local testing only, one bot; production tokens are per-workspace, stored per-channel (see Telegram Bot Tokens)
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_LITE
STRIPE_PRICE_CORE
STRIPE_PRICE_MAX
BILLING_SUCCESS_URL           ← Checkout/Portal return URL on success
BILLING_CANCEL_URL            ← Checkout return URL on cancel
```

**apps/web (Firebase App Hosting env):**
```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_API_URL           ← Cloud Run API URL
```

**apps/scraper (Cloud Run Job env):**
```
FIREBASE_PROJECT_ID
FIREBASE_SERVICE_ACCOUNT_KEY
FIREBASE_STORAGE_BUCKET       ← optional, defaults to <project-id>.firebasestorage.app
PINECONE_API_KEY
PINECONE_INDEX
GEMINI_API_KEY
```

---

## Future Channels

The `channels` collection is typed to support additional channel types. Adding a new channel requires:
1. New channel type in `packages/shared`
2. Channel-specific config in Firestore
3. New bot runner in the API or a separate Cloud Run service
4. Authentication/webhook setup per platform

Planned channels in priority order:
1. **Web Widget** — v1 ✓
2. **Telegram** — v1 ✓ (per-workspace bot, white-label)
3. **WhatsApp** — Meta Cloud API webhook
4. **Messenger** — Meta page webhook
5. **Slack** — Slack app with Events API
6. **Instagram** — Meta messaging webhook
