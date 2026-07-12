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

---

## Firestore Schema

```
users/
  {userId}
    email: string
    displayName: string
    photoURL: string | null
    workspaceId: string
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
| POST | `/auth/verify` | Verify JWT, create user + workspace if new |
| GET | `/workspace` | Get workspace + agent config (includes `hasOpenRouterKey: boolean`, never the raw key) |
| PUT | `/workspace/agent` | Update agent identity and LLM config (model validated against the full multi-provider catalog) |
| PUT | `/workspace` | Update workspace name |
| PUT | `/workspace/key` | Set the workspace's OpenRouter API key (encrypted at rest before storing) |
| DELETE | `/workspace/key` | Remove the workspace's stored OpenRouter API key |
| GET | `/user` | Get current user profile |
| PUT | `/user` | Update user profile (`displayName`) |
| POST | `/knowledge/scrape` | Trigger scraper job for a URL |
| POST | `/knowledge/upload` | Multipart file upload (pdf/docx/txt/csv/md, max 10 MB) → Firebase Storage → ingestion job |
| GET | `/knowledge` | List knowledge base documents |
| DELETE | `/knowledge/:id` | Delete doc + Pinecone vectors |
| POST | `/knowledge/:id/reindex` | Clear existing Pinecone vectors and re-run ingestion for the doc |
| GET | `/conversations` | List conversations (filter by status, channel) |
| GET | `/conversations/:id` | Get conversation with messages |
| POST | `/conversations/:id/takeover` | Operator takes over conversation |
| POST | `/conversations/:id/resolve` | Mark conversation as resolved |
| GET | `/channels` | List channels for workspace |
| POST | `/channels/web-widget` | Create or update web widget channel |
| POST | `/channels/telegram` | Connect a workspace's Telegram bot: validates the token via `getMe`, encrypts and stores it, registers the webhook |
| DELETE | `/channels/telegram` | Disconnect the Telegram channel |
| POST | `/billing/checkout` | Create a Stripe Checkout session for the selected tier, returns the hosted URL |
| POST | `/billing/portal` | Create a Stripe Customer Portal session, returns the hosted URL |
| GET | `/billing` | Current plan, usage, and entitlement status (no Stripe IDs) |

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

## Security Model

### API Authentication
- All protected routes validate Firebase ID tokens via Firebase Admin SDK
- Token contains `uid` → API looks up `users/{uid}` → resolves `workspaceId`
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
