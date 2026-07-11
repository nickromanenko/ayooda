# Ayooda v1 Completion — Design Spec

**Date:** 2026-07-11
**Status:** Approved for planning
**Scope:** The four functional gaps between the v1 plan ([project-description.md](../../project-description.md), [architecture.md](../../architecture.md)) and the current implementation.

## Background

The v1 core loop works today: sign up → scrape a website into Pinecone → embed the widget → RAG answers via Gemini → watch conversations in a real-time inbox. Four planned v1 capabilities are missing:

1. **Operator messages never reach the visitor.** The dashboard side of human takeover works (`POST /conversations/:id/takeover|resolve|messages`), but the widget only renders the bot reply to its own `POST /widget/chat`; it has no channel for receiving operator messages or status changes.
2. **File uploads are advertised but not built.** `KnowledgeDocType = 'file'` exists in types and UI copy promises document upload, but there is no upload endpoint, no parsing, and no file input anywhere.
3. **No streaming.** The docs promise token-by-token SSE; `POST /widget/chat` uses non-streaming `generateContent` and returns one JSON blob.
4. **Dashboard metrics are placeholders and usage counters never increment.** `dashboard/page.tsx` shows hardcoded `'—'` values; `usage.{conversationCount,tokenCount}` is seeded at signup and never touched again.

## Design decisions (agreed)

| Decision | Choice |
|---|---|
| Spec scope | Core four only (no settings page, re-index, multi-LLM, ops fixes) |
| Widget takeover sync | SSE subscription with a server-side Firestore listener |
| File ingestion | Extend the existing Cloud Run scraper job into a general ingestor |
| Dashboard scope | Full plan metrics + working Get-started checklist + usage counters |

---

## 1. Streaming chat + live event feed (shared SSE plumbing)

### 1a. `POST /widget/chat` → SSE response

Request body unchanged (`{channelId, conversationId, message, visitorId}`, [apps/api/src/routes/widget.ts](../../../apps/api/src/routes/widget.ts)). The response becomes `text/event-stream`:

```
event: chunk   data: {"text": "<delta>"}
event: done    data: {"conversationId", "messageId", "sources": [...]}
event: error   data: {"error": "<message>"}
```

- Replace `model.generateContent` with `model.generateContentStream`; forward text deltas as `chunk` events while accumulating the full reply.
- Persistence is unchanged in substance: after the stream completes, save the assistant message (with `sources`, `llmModel`, token counts from the stream's final `usageMetadata`) and update the conversation `lastMessage`/`updatedAt`. The `done` event carries the saved message's Firestore ID so the widget can dedupe against the event feed (§1b).
- Langfuse: same trace/generation structure; `generation.end` after stream completion with streamed usage. Errors mid-stream emit an `error` event, end the generation with `level: 'ERROR'`, and close the stream — the stream always terminates with `done` or `error`.
- Validation failures before streaming starts (missing fields, unknown channel) still return plain JSON 4xx — the widget treats a non-`text/event-stream` response as an error.
- Use Hono's `streamSSE` helper.

### 1b. `GET /widget/conversations/:conversationId/events` — live event feed

New public endpoint. Query params: `channelId`, `visitorId` (both required).

**Authorization:** resolve the channel (existing `findChannel` collection-group query) → `workspaceId` → load `workspaces/{wsId}/conversations/{conversationId}`. Reject 404 unless the conversation exists, belongs to that workspace, **and** its stored `visitorId` equals the query param. Conversation IDs are client-generated UUIDs; the visitorId check prevents cross-visitor reads even if an ID leaks.

**Behavior:** attach Admin SDK `onSnapshot` listeners to the conversation doc and its `messages` subcollection (ordered by `createdAt`, only changes after connect — use a `since` cursor of connect time). Forward as SSE:

```
event: message   data: {"id", "role", "content", "createdAt"}   // operator + assistant messages only
event: status    data: {"status": "bot"|"human"|"resolved"}
: heartbeat comment every 25s
```

- `user`-role messages are not forwarded (the visitor typed them).
- Detach Firestore listeners when the client disconnects (abort signal) — no leaked listeners.
- Cloud Run will cut long-lived requests at its timeout; that is expected. The widget reconnects (§1c).

### 1c. Widget changes ([apps/widget/src/index.ts](../../../apps/widget/src/index.ts))

- **Streaming render:** parse the SSE response of `POST /widget/chat` (fetch + ReadableStream; `EventSource` cannot POST). Append deltas into the assistant message bubble as they arrive; typing indicator only until the first chunk.
- **Event feed:** open `EventSource` on the events endpoint when the panel is open and a `conversationId` exists; close on panel close. Reconnect with exponential backoff (1s → 30s cap) on drop. Track rendered message IDs in a `Set` to dedupe messages already shown from the POST stream.
- **Status UX:** on `status: human`, render a system note ("You're now chatting with a human"); on `resolved`, a closing note. Operator messages render with the agent avatar (no new visual design needed).

## 2. Knowledge-base file uploads

### 2a. API: `POST /knowledge/upload`

Multipart (`file` field), `requireAuth`, in [apps/api/src/routes/knowledge.ts](../../../apps/api/src/routes/knowledge.ts):

- **Accepted:** `.pdf`, `.docx`, `.txt`, `.csv`, `.md` (validated by extension **and** MIME allowlist in `packages/shared`); max 10 MB. Violations → 400/413 before any doc is created.
- Store raw bytes in the project's Firebase Storage bucket at `workspaces/{wsId}/knowledge/{docId}/{filename}` via the Admin SDK.
- Create the `KnowledgeDoc`: `{type:'file', source: filename, status:'pending', chunkCount:0, ...}` plus a new `storagePath` field.
- Trigger the ingestor (existing `triggerScraper` in [apps/api/src/lib/scraper.ts](../../../apps/api/src/lib/scraper.ts), extended) with env `DOC_TYPE=file`, `STORAGE_PATH`, `WORKSPACE_ID`, `DOC_ID` — fire-and-forget, same as scrape.
- Dedupe: same `source` + `type:'file'` already present → 409 (mirrors the scrape-dedupe behavior).
- `DELETE /knowledge/:id`: for `type:'file'` docs, also delete the stored object (best-effort, like the Pinecone cleanup).

### 2b. Ingestor: generalize `apps/scraper`

Branch on `DOC_TYPE` in [apps/scraper/src/index.ts](../../../apps/scraper/src/index.ts):

- `webpage` (default, unchanged): existing Puppeteer BFS crawl.
- `file`: download `STORAGE_PATH` from the bucket, extract text by extension —
  - PDF → `pdf-parse`
  - DOCX → `mammoth` (`extractRawText`)
  - TXT / CSV / MD → UTF-8 read as-is
- Both paths converge on the **existing** pipeline: chunk (400 words / 40 overlap) → `text-embedding-004` batch embed → Pinecone upsert (`ws_{workspaceId}`, ids `${docId}_${i}`) → status `indexed` + `chunkCount`, or `error` + `errorMessage`. Empty extraction (e.g. scanned image-only PDF) → `error` with a clear message; OCR is out of scope.

### 2c. Web UI

- **Knowledge page** ([apps/web/src/app/dashboard/knowledge/page.tsx](../../../apps/web/src/app/dashboard/knowledge/page.tsx)): add a file browse/drop zone next to the URL form; upload via the existing `apiRequest` client (multipart). Uploaded docs appear in the same status-badged list; the existing 4s polling covers their status transitions with no changes.
- **Onboarding StepKnowledge:** same input, same component — extract a shared `KnowledgeUpload` component used in both places.

## 3. Dashboard metrics + usage tracking

### 3a. Write path (in `POST /widget/chat`)

- On conversation **creation** (the `!convSnap.exists` branch): `usage.conversationCount` `FieldValue.increment(1)` on the workspace doc.
- After each assistant message: `usage.tokenCount` `increment(promptTokens + completionTokens)` and `usage.messageCount` `increment(2)` (user + assistant); operator replies increment `usage.messageCount` by 1. (`messageCount` is a new `WorkspaceUsage` field, seeded to 0 for new workspaces; `FieldValue.increment` creates it on existing ones.)
- `POST /conversations/:id/takeover` additionally sets `hadTakeover: true` on the conversation doc (new field, added to `ConversationDoc`).

### 3b. Read path: `dashboard/page.tsx` becomes a server component

It already runs inside a layout that verifies the session and loads the workspace via the Admin SDK; the page does its own Admin SDK reads (no new API endpoint needed):

- **Total conversations** and per-status counts — Firestore `count()` aggregates on the `conversations` subcollection.
- **Automation rate** — `resolved && !hadTakeover` count ÷ resolved count (shown as "—" until ≥1 resolved conversation). Pre-existing conversations lack `hadTakeover`; treat missing as `false`.
- **Avg messages per conversation** — `usage.messageCount ÷ usage.conversationCount` from the workspace doc (no collection-group query needed). (The plan's "response time" is not measurable without per-message latency capture; this is the agreed substitute.)
- **Knowledge health** — fetch the workspace's knowledge docs (small collection, already fetched wholesale by `GET /knowledge`) and count/sum `chunkCount` in JS.
- **Recent activity** — last 5 conversations by `updatedAt`, linking to `/dashboard/inbox`.
- **Get-started checklist** — real `done` flags: agent configured (`agent.description` or non-default `systemPrompt` set), ≥1 `indexed` knowledge doc, ≥1 channel, ≥1 conversation.
- **Agent status card** — "Active" when a channel exists and ≥1 indexed doc, else "Setup incomplete".

## 4. Shared types (`packages/shared`)

- `ConversationDoc.hadTakeover?: boolean`
- `KnowledgeDoc.storagePath?: string`
- SSE event unions: `ChatStreamEvent = {type:'chunk',...} | {type:'done',...} | {type:'error',...}` and `ConversationEvent = {type:'message',...} | {type:'status',...}`
- `KNOWLEDGE_FILE_TYPES`: extension → MIME allowlist map + `MAX_UPLOAD_BYTES = 10 * 1024 * 1024`
- `ChatRequest` field `agentId` renamed to match reality (`channelId`) — the API already reads `channelId`; the shared type is stale.

## Error handling summary

- Both SSE endpoints always terminate with a final `done`/`error` event or clean close; the widget never waits forever (first-chunk timeout of 30s aborts and shows the standard error bubble).
- Firestore listeners on the events endpoint are detached on client disconnect.
- Upload validation happens before any Firestore/Storage write; ingestion failures use the existing `status:'error'` + `errorMessage` surface, shown in the existing UI.
- Metrics are read server-side in one pass; a failed Firestore aggregate (rare) surfaces via the route's error boundary. Cards that are merely *empty* (no resolved conversations yet) render "—".

## Testing & verification

The repo has no automated test harness today. Approach:

- **Unit tests** (Bun test in `apps/api`, node test in `apps/scraper`) for pure logic: upload validation (type/size), file-text extraction per format (fixture files), SSE event serialization, automation-rate math.
- **Manual E2E verification** (documented as scripts/checklists in the implementation plan):
  1. Widget on a test page → send message → observe token-by-token render.
  2. Dashboard takeover → operator reply → appears in the widget within ~1s; status notes render; resolve closes it out.
  3. Upload a PDF/DOCX/MD → status pending → processing → indexed → ask the widget a question answerable only from the file → answer cites it. Delete → vectors and stored file gone.
  4. Dashboard overview shows real numbers matching Firestore; checklist items flip as steps complete.
- **Regression guard:** existing scrape flow re-verified after the ingestor refactor.

## Out of scope (follow-up specs)

Multi-LLM / BYO API keys, billing UI, settings page, re-index endpoint, rate limiting on public endpoints, scraper Cloud Run OIDC auth fix, widget default API URL cleanup, Telegram/WhatsApp channels.
