# Ayooda — Architecture

## Overview

Ayooda is a multi-tenant SaaS platform that lets companies deploy an AI-powered customer support agent on their website and other messaging channels. Each company (workspace) configures one agent with its own knowledge base, identity, and channel integrations.

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
        │  Pinecone  │  │ Gemini API │  │  LLM APIs  │
        │            │  │            │  │            │
        │ Vector DB  │  │ Embeddings │  │ Claude /   │
        │ Per-workspace  gemini-      │  │ GPT-4o /  │
        │ namespace  │  embedding-001│  │ Gemini     │
        └────────────┘  └────────────┘  └────────────┘
                                         (customer's own API key)
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

The REST API backend. All dashboard routes require a Firebase JWT in the `Authorization: Bearer <token>` header. Widget endpoints are public but validated by `agentId`.

- **Runtime**: Bun
- **Framework**: Hono
- **Auth middleware**: Firebase Admin SDK JWT verification
- **Deployment**: Cloud Run (always-on, min 1 instance)

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
export type LLMProvider = 'claude' | 'openai' | 'gemini'
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
      llmProvider: 'claude' | 'openai' | 'gemini'
      llmApiKey: string          ← encrypted at rest via Cloud KMS (future)
      llmModel: string           ← e.g. 'claude-opus-4-6', 'gpt-4o', 'gemini-2.0-flash'
    usage:
      conversationCount: number
      messageCount: number
      tokenCount: number

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
      type: 'web_widget'
      config:
        widgetColor: string      ← hex color
        widgetPosition: 'bottom-right' | 'bottom-left'
        welcomeMessage: string
        agentName: string        ← copied from agent for widget perf
        agentPhotoURL: string | null
      embedCode: string          ← generated <script> tag
      isActive: boolean
      createdAt: Timestamp

  {workspaceId}/conversations/
    {conversationId}
      channelId: string
      visitorId: string          ← anonymous ID set by widget
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
| GET | `/workspace` | Get workspace + agent config |
| PUT | `/workspace/agent` | Update agent identity and LLM config |
| PUT | `/workspace` | Update workspace name |
| POST | `/knowledge/scrape` | Trigger scraper job for a URL |
| POST | `/knowledge/upload` | Multipart file upload (pdf/docx/txt/csv/md, max 10 MB) → Firebase Storage → ingestion job |
| GET | `/knowledge` | List knowledge base documents |
| DELETE | `/knowledge/:id` | Delete doc + Pinecone vectors |
| GET | `/conversations` | List conversations (filter by status, channel) |
| GET | `/conversations/:id` | Get conversation with messages |
| POST | `/conversations/:id/takeover` | Operator takes over conversation |
| POST | `/conversations/:id/resolve` | Mark conversation as resolved |
| GET | `/channels` | List channels for workspace |
| POST | `/channels/web-widget` | Create or update web widget channel |

### Public endpoints (no auth, validated by agentId)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/widget/config/:agentId` | Fetch agent appearance config for widget |
| POST | `/widget/chat` | Send message, receive AI response as an SSE stream (`chunk` / `done` / `error` events) |
| GET | `/widget/conversations/:id/events` | SSE feed of operator messages + status changes; requires `channelId` & `visitorId` query params |

---

## RAG Chat Flow

```
Widget sends message
       │
       ▼
POST /widget/chat
  { agentId, conversationId, message }
       │
       ├─ 1. Resolve workspaceId from agentId (Firestore channel lookup)
       │
       ├─ 2. Fetch workspace agent config (LLM provider, API key, model, systemPrompt)
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
       ├─ 6. Stream LLM response (Claude / GPT-4o / Gemini)
       │       → SSE stream back to widget
       │
       └─ 7. On stream complete:
               Save user message + assistant message to Firestore
               Update conversation.updatedAt + lastMessage
               Increment workspace.usage.conversationCount
```

---

## Security Model

### API Authentication
- All protected routes validate Firebase ID tokens via Firebase Admin SDK
- Token contains `uid` → API looks up `users/{uid}` → resolves `workspaceId`
- All data operations are scoped to the resolved `workspaceId`

### Widget Public Endpoints
- No auth required (widget runs on customer's anonymous visitors)
- `agentId` is validated against Firestore — invalid IDs return 404
- Rate limiting applied per `agentId` (e.g. 30 requests/minute using in-memory or Redis)
- CORS restricted to the workspace's registered domain (future)

### Firestore Security Rules
- Client-side reads/writes from `apps/web` use Firestore rules requiring `request.auth.uid`
- Sensitive fields (`agent.llmApiKey`) are write-only from the API server (Admin SDK bypasses rules) — never returned to the client
- Server-side (API) uses Firebase Admin SDK which bypasses Firestore rules

### LLM API Keys
- Stored in Firestore `workspaces/{id}.agent.llmApiKey`
- Never returned in any API response (redacted in GET /workspace)
- Future: encrypt with Cloud KMS before storing

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
SCRAPER_JOB_URL               ← Cloud Run Job trigger URL
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
2. **Telegram** — bot token + webhook
3. **WhatsApp** — Meta Cloud API webhook
4. **Messenger** — Meta page webhook
5. **Slack** — Slack app with Events API
6. **Instagram** — Meta messaging webhook
