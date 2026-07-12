# Ayooda Sub-project A — Polish Pack — Design Spec

**Date:** 2026-07-12
**Status:** Approved for planning
**Scope:** Three independent v1-polish items: a real Settings page, knowledge re-indexing, and widget rate limiting.

## Background

After the v1-completion work, three small gaps remain from the review/roadmap: the Settings page is a `"Coming soon."` stub, there is no way to re-index a knowledge source (only add/delete), and the public widget endpoints have no rate limiting (an abuse vector against the platform Gemini quota). These are independent and low-risk; they ship together as one plan.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Settings scope | Essentials: profile (display name editable, email read-only), workspace rename, embed-snippet shortcut, sign out. **No** danger zone / workspace deletion this round. |
| Re-index | New endpoint + button; deletes old vectors before re-triggering the ingestor. |
| Rate limiting | In-memory sliding window on `/widget/*`, per-channel and per-IP, 429 on exceed. |

---

## 1. Settings page

### 1a. API

Two new authenticated endpoints (extend existing route files):

- **`PUT /workspace`** ([apps/api/src/routes/workspace.ts](../../../apps/api/src/routes/workspace.ts)) — body `{ name: string }`. Trim; reject empty or >80 chars with 400. Updates `workspaces/{id}.name`. Returns `{ ok: true }`.
- **`PUT /user`** — new route file [apps/api/src/routes/user.ts](../../../apps/api/src/routes/user.ts), mounted at `/user` in [apps/api/src/index.ts](../../../apps/api/src/index.ts). `requireAuth`. Body `{ displayName: string }`. Trim; reject empty or >80 chars with 400. Updates `users/{uid}.displayName` (Firestore) **and** the Firebase Auth user's `displayName` via `adminAuth.updateUser(uid, { displayName })`. Returns `{ ok: true }`. Also add `GET /user` returning `{ email, displayName, photoURL }` from the `users/{uid}` doc so the settings page can render current values without a client Firestore read.

Email is never editable here (it is the Firebase Auth identity).

### 1b. Web

Replace [apps/web/src/app/dashboard/settings/page.tsx](../../../apps/web/src/app/dashboard/settings/page.tsx) (the `"Coming soon."` stub) with a client component with three cards, matching the existing dashboard inline-style idiom (see `agent/page.tsx`):

- **Profile** — display-name input (pre-filled from `GET /user`), email shown read-only/disabled, Save button → `PUT /user`. On success also refresh any cached name.
- **Workspace** — workspace-name input (pre-filled from `useWorkspace()`), Save → `PUT /workspace`; on success re-fetch the workspace so the sidebar/name updates.
- **Widget install** — read-only embed snippet (fetched from `GET /channels`, the `web_widget` channel's `embedCode`) with a copy button; a link to `/dashboard/channels` for full instructions. If no channel exists yet, show a prompt linking to channels.
- **Sign out** — a button calling the existing `signOut()` from `AuthProvider`.

Each save shows inline success/error, mirroring the agent page's Saved/error pattern. No new shared types needed.

## 2. Re-index a knowledge source

### 2a. API

**`POST /knowledge/:id/reindex`** in [apps/api/src/routes/knowledge.ts](../../../apps/api/src/routes/knowledge.ts), `requireAuth`:

1. Load `workspaces/{wsId}/knowledge/{id}`; 404 if missing.
2. Best-effort delete existing vectors: `namespaceFor(wsId).deleteMany({ docId: id })` (same as DELETE). Wrapped in try/catch, non-fatal.
3. Reset the doc: `{ status: 'pending', chunkCount: 0, errorMessage: null, indexedAt: null }`.
4. Re-trigger ingestion via the existing `triggerIngestion` with the doc's stored type: for `webpage` pass `url: doc.source`; for `file` pass `storagePath: doc.storagePath`. Guard: if a `file` doc has no `storagePath` (shouldn't happen), 409 with a clear message.
5. Return `{ ok: true, status: 'pending' }`.

Idempotent enough: re-indexing a doc already `pending`/`processing` just resets and re-triggers (the ingestor overwrites vectors by deterministic ids `${docId}_${i}`, and step 2 clears any orphans from a shrinking doc).

### 2b. Web

On [apps/web/src/app/dashboard/knowledge/page.tsx](../../../apps/web/src/app/dashboard/knowledge/page.tsx), add a re-index button (a `RotateCw` lucide icon) next to the existing delete button on each doc row. Only shown for docs in `indexed` or `error` status (not while `pending`/`processing`). Clicking calls `POST /knowledge/:id/reindex`, then `fetchDocs()`; the existing 4s polling picks up the status transitions. Disable + spinner while the request is in flight (mirror the delete button's `deletingId` pattern with a `reindexingId`).

## 3. Widget rate limiting

### 3a. Limiter

New module [apps/api/src/lib/rate-limit.ts](../../../apps/api/src/lib/rate-limit.ts): a pure, in-memory sliding-window counter.

```ts
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number }
```

- Module-level `Map<string, number[]>` of timestamps per key. On each call: drop timestamps older than `now - windowMs`, then if `count >= limit` return `{ ok: false, retryAfterMs }` (retryAfter = oldest-in-window + windowMs − now), else push `now` and return `{ ok: true }`.
- A periodic sweep (or lazy eviction on access) prevents unbounded growth: on each call also delete the key's array if it becomes empty.
- `now` is injected for testability: signature actually `rateLimit(key, limit, windowMs, now = Date.now())`. (Tests pass an explicit clock; production omits it.)

This is per-instance (Cloud Run may run multiple instances → effective limit scales with instance count). Acceptable for abuse protection; documented as such. A Redis-backed limiter is a future upgrade, out of scope.

### 3b. Middleware

Apply in [apps/api/src/routes/widget.ts](../../../apps/api/src/routes/widget.ts) to the mutating/expensive public endpoints — **`POST /widget/chat`** and the SSE **`GET /widget/conversations/:id/events`** (a long-lived connection). Do **not** rate-limit `GET /widget/config/:channelId` (cheap, cacheable) beyond a generous ceiling, or leave it unlimited this round.

Limits (constants at module top, tuned conservative-but-usable):
- Per channel: `CHAT_LIMIT_PER_CHANNEL = 60` requests / `60_000` ms.
- Per IP: `CHAT_LIMIT_PER_IP = 30` / `60_000` ms.

Key derivation: channel key = `chat:ch:${channelId}`; IP key = `chat:ip:${clientIp}` where `clientIp` = first value of `X-Forwarded-For` (Cloud Run sets it) falling back to a connection-info header, else `'unknown'`. Check both; if either fails, return `429` with a JSON body `{ error: 'Too many requests' }` and a `Retry-After` header (seconds, ceil of retryAfterMs). The check runs **before** any Firestore work or streaming begins (stays JSON, consistent with other pre-stream validation).

For the events endpoint, use a lighter limit (`EVENTS_LIMIT_PER_IP = 20 / 60_000`) keyed by IP only, applied at connection open.

## Error handling summary

- All new API validation failures return JSON 4xx before side effects.
- Rate-limit rejections are JSON 429 with `Retry-After`; never a broken stream.
- Re-index vector cleanup and re-trigger failures follow the existing best-effort / `status:'error'` surfaces.

## Testing & verification

- **Unit tests** (`bun test`, `apps/api`): `rateLimit` — allows up to the limit, rejects the next, window slides as the injected clock advances, empty-key eviction. Re-index request-shape validation if any pure logic is extracted.
- **Live E2E** (Gemini path, real services): re-index an indexed source → returns to `pending` → `indexed`; hammer `POST /widget/chat` past the per-IP limit → observe 429 + `Retry-After`; settings page saves display name (reflected in Firebase Auth) and workspace name (reflected in sidebar); embed snippet copies.
- **Regression:** normal single widget chats and the events feed still work under the limits.

## Out of scope

Workspace deletion / danger zone; Redis-backed distributed rate limiting; avatar upload; re-index-all button.
