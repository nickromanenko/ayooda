# Ayooda Sub-project G — Multiple Agents Per Workspace — Design Spec

**Date:** 2026-08-01
**Status:** Approved for planning
**Scope:** Let a workspace define N agents instead of one. Each agent owns its identity, system prompt, LLM model, OpenRouter key, knowledge base, and tools ("per-agent everything"). Each channel (widget/Telegram) picks which agent answers. Knowledge is isolated per agent via a Pinecone namespace stored on the agent doc. Billing/usage stays workspace-level.

## Background

Today a workspace has exactly one agent, stored inline at `workspaces/{id}.agent` (`name`, `photoURL`, `description`, `systemPrompt`, `llmModel`). Both channels resolve it in `prepareTurn` ([apps/api/src/lib/chat/agent-turn.ts](../../../apps/api/src/lib/chat/agent-turn.ts)); channel docs only cache `agentName`/`agentPhotoURL` for widget display. Knowledge (`workspaces/{id}/knowledge/*`) and tools (`workspaces/{id}/tools/*`) are workspace-level subcollections; the Pinecone namespace `ws_{workspaceId}` is hardcoded in **two** places — `namespaceFor` ([apps/api/src/lib/pinecone.ts](../../../apps/api/src/lib/pinecone.ts)) and directly in the scraper ([apps/scraper/src/index.ts](../../../apps/scraper/src/index.ts)). There is one encrypted OpenRouter key per workspace (`workspace.openRouterKey`).

This sub-project makes the agent a first-class, multi-instance entity that owns knowledge, tools, and its key, with channels routing to a chosen agent.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| What each agent owns | **Per-agent everything**: identity, systemPrompt, llmModel, OpenRouter key, knowledge, tools. |
| Storage shape | **Reparent** knowledge and tools under `workspaces/{id}/agents/{agentId}/…`. Each agent stores its own Pinecone namespace string. |
| Namespace / migration | The migrated **default agent keeps `ws_{workspaceId}`** (existing vectors stay valid — no re-embedding); **new agents get `ws_{workspaceId}_ag_{agentId}`**. |
| Billing/usage | **Workspace-level, unchanged.** No per-agent usage attribution in v1. |
| Channel routing | `channel.agentId` selects the agent; missing/stale → the workspace's default agent (visitors never hard-fail). |

---

## 1. Data model (Firestore + shared types)

New subcollection `workspaces/{id}/agents/{agentId}`:

```
{
  name: string
  photoURL: string | null
  description: string
  systemPrompt: string
  llmModel: string
  openRouterKey?: string       // AES-256-GCM (crypto.ts), server-only, NEVER returned
  knowledgeNamespace: string   // e.g. "ws_{workspaceId}" (default) or "ws_{workspaceId}_ag_{agentId}" (new)
  isDefault: boolean           // exactly one true per workspace
  createdAt, updatedAt
}
```

Reparented subcollections (unchanged shapes, new location):
- `workspaces/{id}/agents/{agentId}/knowledge/{docId}` (was `workspaces/{id}/knowledge/{docId}`)
- `workspaces/{id}/agents/{agentId}/tools/{toolId}` (was `workspaces/{id}/tools/{toolId}`)

Channel doc gains `agentId: string`. Workspace doc keeps `usage`/`subscription`; `agent` and `openRouterKey` remain only for the migration window, then unused.

Shared types (`packages/shared`): `AgentDoc` (the API↔web contract: `id`, `name`, `photoURL`, `description`, `systemPrompt`, `llmModel`, `hasOpenRouterKey`, `isDefault`; **no** `knowledgeNamespace`, **no** key) and `AgentSummary` (`id`, `name`, `photoURL`, `llmModel`, `isDefault`) for pickers/lists.

## 2. Agent resolution in `prepareTurn`

`PrepareTurnInput` gains `agentId?: string` (the widget/Telegram routes already load the channel doc — they pass `channel.agentId`). `prepareTurn`:

1. Resolve the agent: if `agentId` given, load `agents/{agentId}`; if absent or the doc is missing, load the workspace's `isDefault == true` agent (query `agents where isDefault == true limit 1`). If still none (unmigrated/edge), fall back to `workspace.agent` inline (backward-compat safety net).
2. Use `agent.systemPrompt`, `agent.llmModel` (with `LEGACY_MODEL_MAP`), `agent.openRouterKey` for `resolveOpenRouterKey` (platform-key fallback unchanged), `namespaceFor(agent.knowledgeNamespace)` for RAG, and `loadTools(workspaceId, agentId)` for tools.

`namespaceFor` ([pinecone.ts](../../../apps/api/src/lib/pinecone.ts)) changes signature from `namespaceFor(workspaceId)` (building `ws_${workspaceId}`) to `namespaceFor(namespace: string)` (uses the string directly). All callers pass the agent's `knowledgeNamespace`.

`loadTools` ([tools.ts](../../../apps/api/src/lib/chat/tools.ts)) changes from `loadTools(workspaceId)` → `loadTools(workspaceId, agentId)`, reading `workspaces/{id}/agents/{agentId}/tools`.

A small pure helper `resolveAgentDoc(agentId, defaultAgent, byId)` is unit-testable for the default-fallback logic.

## 3. Scraper (per-agent namespace)

`triggerIngestion` ([apps/api/src/lib/scraper.ts](../../../apps/api/src/lib/scraper.ts)) `IngestionJobParams` gains `agentId: string` and `namespace: string`. Both the Cloud Run Job env and the local spawn env gain `AGENT_ID` and `PINECONE_NAMESPACE`.

`apps/scraper/src/index.ts`:
- Reads `AGENT_ID` and `PINECONE_NAMESPACE`.
- Writes the knowledge doc status to `workspaces/{ws}/agents/{AGENT_ID}/knowledge/{DOC_ID}` (was `workspaces/{ws}/knowledge/{DOC_ID}`).
- Upserts vectors into `namespace(PINECONE_NAMESPACE)` (was hardcoded `ws_${workspaceId}`); vector metadata gains `agentId`.

## 4. API routes

### 4a. `/agents` (new — `apps/api/src/routes/agents.ts`, requireAuth + requireOwner)
- **`GET /agents`** — list `AgentDoc[]` for the workspace (ordered: default first, then `createdAt`).
- **`POST /agents`** `{ name, description?, systemPrompt?, llmModel? }` — create with `isDefault:false`, `knowledgeNamespace: "ws_{workspaceId}_ag_{newId}"`, sensible defaults (systemPrompt/model matching the seed). Returns the `AgentDoc`.
- **`GET /agents/:id`** — one `AgentDoc` (404 if not in workspace).
- **`PUT /agents/:id`** — update `name`/`photoURL`/`description`/`systemPrompt`/`llmModel` (validate `llmModel` against `LLM_MODELS`).
- **`PUT /agents/:id/key`** `{ apiKey }` / **`DELETE /agents/:id/key`** — per-agent OpenRouter key (encrypt/clear). Replaces `PUT/DELETE /workspace/key`.
- **`POST /agents/:id/default`** — set this agent `isDefault:true` and unset the previous default (batch). 404 if not in workspace.
- **`DELETE /agents/:id`** — guards, in order: **400** if `isDefault`; **400** if it is the last agent; **409** if any channel has `agentId == :id` (body lists the blocking channel names — reassign first). On success: delete the agent doc, purge its Pinecone namespace (`namespaceFor(agent.knowledgeNamespace).deleteAll()`), delete all `agents/:id/knowledge` docs + their Storage files, and delete all `agents/:id/tools` docs.

Delete-guard logic (`isDefault` / last / channels-attached → which failure) lives in a pure, unit-testable helper.

### 4b. Knowledge & tools → agent-scoped
Knowledge ([apps/api/src/routes/knowledge.ts](../../../apps/api/src/routes/knowledge.ts)) and tools ([apps/api/src/routes/tools.ts](../../../apps/api/src/routes/tools.ts)) mount under `/agents/:agentId/…`:
- Mount points: `app.route('/agents/:agentId/knowledge', knowledgeRoutes)` and `app.route('/agents/:agentId/tools', toolRoutes)` — **but** Hono param access across `app.route` requires reading `agentId` from the path inside each handler; a shared middleware `requireAgent` (after `requireOwner`) loads `agents/{agentId}`, 404s if not in the caller's workspace, and sets `c.set('agentId', id)` + `c.set('agentNamespace', ns)`.
- Knowledge handlers use `workspaces/{ws}/agents/{agentId}/knowledge`, `namespaceFor(agentNamespace)`, storage path `workspaces/{ws}/agents/{agentId}/knowledge/{docId}/{file}`, and pass `agentId` + `namespace` to `triggerIngestion`.
- Tools handlers use `workspaces/{ws}/agents/{agentId}/tools`.

### 4c. Channels
- `channels.ts` create: set `agentId = <default agent id>` and cache the chosen agent's `name`/`photoURL` in the widget config.
- New **`PUT /channels/:id/agent`** `{ agentId }` — reassign (validate the agent is in the workspace); update `channel.agentId` and refresh the cached widget `agentName`/`agentPhotoURL`.
- The public widget-config endpoint resolves name/photo from the channel's agent (fallback default).

## 5. Migration

`apps/api/scripts/migrate-agents.ts` (idempotent, like `backfill-trials.ts`). For each workspace **without** an `agents` subcollection:
1. Create `agents/{defaultId}` from `workspace.agent` with `isDefault:true`, `knowledgeNamespace: "ws_{workspaceId}"`, and `openRouterKey` copied from `workspace.openRouterKey` if present.
2. Reparent every `workspaces/{id}/knowledge/*` doc → `agents/{defaultId}/knowledge/*` (copy fields, delete original; leave Storage objects in place — `storagePath` strings still resolve).
3. Reparent every `workspaces/{id}/tools/*` → `agents/{defaultId}/tools/*`.
4. Set `agentId = defaultId` on every channel.

Existing Pinecone vectors already live in `ws_{workspaceId}` = the default agent's namespace, so RAG keeps working with no re-embedding. New-workspace seeding: `auth.ts` and onboarding create the **default agent doc** (in the subcollection) rather than inline `workspace.agent`.

## 6. Web

- **Agents page** `apps/web/src/app/dashboard/agents/page.tsx` (Sidebar label "Agent" → "Agents", route `/dashboard/agents`): list agents (default badge), create, set-default, delete (guard errors surfaced inline), and a per-agent editor (name, photoURL, description, systemPrompt, model select, OpenRouter key). Mirrors the existing dashboard client-page idiom (`'use client'` + `apiRequest`, inline styles).
- **Knowledge page** ([apps/web/src/app/dashboard/knowledge/page.tsx](../../../apps/web/src/app/dashboard/knowledge/page.tsx)) gains an **agent selector** at the top; scrape/upload/list/reindex/delete target `/agents/:agentId/knowledge`.
- **Tools page** ([apps/web/src/app/dashboard/tools/page.tsx](../../../apps/web/src/app/dashboard/tools/page.tsx)) gains the same agent selector; CRUD/test target `/agents/:agentId/tools`.
- **Channels page** ([apps/web/src/app/dashboard/channels/page.tsx](../../../apps/web/src/app/dashboard/channels/page.tsx)): a per-channel agent dropdown → `PUT /channels/:id/agent`.
- The existing single **Agent page** is replaced by the Agents page; onboarding continues to configure the default agent.
- `GET /workspace` still returns `role` for nav; it no longer needs to return the inline `agent` (the dashboard overview reads the default agent from `/agents`). Keep returning `agent` during migration for backward-compat, sourced from the default agent when present.

**Web caution:** `apps/web/AGENTS.md` warns this is a modified Next.js — all new/changed pages mirror the existing client-page idiom and introduce no new framework APIs.

## 7. Billing / usage

Unchanged. The entitlement gate in `prepareTurn` stays keyed on the workspace; `usage.conversationCount`/`periodConversationCount`/token counters remain workspace-level. Agent count does not affect caps.

## 8. Error handling

- Delete default agent → **400**; delete last agent → **400**; delete agent with channels attached → **409** (lists blocking channels).
- Stale/missing `channel.agentId` → `prepareTurn` falls back to the default agent; a workspace with no agents at all → falls back to inline `workspace.agent` (migration safety net). Visitors never see a hard failure from agent resolution.
- Per-agent key absent + non-Gemini model → the existing pre-stream 502 (now per agent).
- `requireAgent` 404s when `:agentId` is not in the caller's workspace (blocks cross-workspace access to knowledge/tools).
- Migration is idempotent (skips workspaces that already have `agents`).

## 9. Testing & verification

- **Unit (`bun test`):** `resolveAgentDoc` default-fallback (explicit id → that agent; missing id → default; missing agent → default); the delete-guard helper (default → 400 reason, last → 400 reason, channels-attached → 409 reason, otherwise ok); the new-agent namespace builder (`ws_{ws}_ag_{id}`); `loadTools(ws, agentId)` path/selection (extend existing tools tests for the new arg).
- **Live E2E:** migrate a test workspace (default agent created, knowledge/tools reparented, channels tagged, RAG still answers from `ws_{workspaceId}`); create a second agent with a different model + systemPrompt + its own key; assign agent A to the widget and agent B to Telegram and confirm each answers in its own persona/model; index a doc under agent B and confirm agent A cannot retrieve it (namespace isolation); delete guards (default/last/attached → blocked); delete a spare agent and confirm its namespace/knowledge/tools/files are purged. Clean up test agents afterward.

## Out of scope (v1)

Per-agent usage/billing attribution; per-agent rate limits; agent-to-agent handoff/routing (that's the workflow-builder sub-project); sharing one knowledge doc across multiple agents; bulk agent import; per-agent widget theming beyond name/photo.
