# Ayooda Sub-project O — Copilot (Internal Team Chat) — Design Spec

**Date:** 2026-08-15
**Status:** Approved for planning
**Scope:** An authenticated in-app chat surface where workspace members talk to their own agents. Serves two uses through one surface: a persistent internal assistant with per-user history, and the test bench for an agent you are configuring. Reaches this by extracting the reusable middle of `prepareTurn` into shared modules and adding a second thin orchestrator, so Copilot adds no branches to the channel path.

## Background

Every existing chat path — web widget and Telegram — runs through `prepareTurn` in [apps/api/src/lib/chat/agent-turn.ts](../../../apps/api/src/lib/chat/agent-turn.ts). That function is channel-shaped: it takes a `channelId`, `channelType` and `visitorId`, gates new conversations against the workspace's plan quota, evaluates escalation rules, and writes conversations the support inbox reads.

An internal user needs none of those four and all of what sits between them — agent resolution, RAG over the agent's Pinecone namespace, gateway-key resolution, prompt assembly, tools, and the skill hooks added in [Sub-project N](2026-08-14-agent-skills-framework-design.md).

There is also no way to try an agent today without embedding the widget or wiring a Telegram bot, which puts real friction in the configure → test → refine loop that determines whether a customer's agent is any good.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Purpose | **Both** — a persistent internal assistant that doubles as the agent test bench. One surface, two entry points. |
| Pipeline reuse | **Extract the shared middle; two thin orchestrators.** Not a mode flag inside `prepareTurn`, not a fake "copilot channel". |
| Billing | **Its own counter and cap.** Copilot never touches the customer-conversation quota. |
| Visibility | **Private per person.** Enforced structurally by the storage path, not by a filter. |
| Support inbox | Copilot threads **never appear** there. The inbox is a queue of customers needing a human. |
| Escalation rules | **Do not run** on Copilot turns — handing an internal chat to "waiting for a human" is meaningless. |
| Scoring skill | **Skipped** for Copilot — internal chats would pollute the owner's conversation-quality metrics. |
| Memory / Web Search skills | **Apply normally.** Both are useful internally. |
| Agent selection | **Per thread, not per message.** Switching agents starts a new thread. |
| Out of scope | File upload, voice, Raia's copilot button/action system, per-workspace Copilot configuration. |

---

## 1. The extraction

Four modules come out of `prepareTurn`, each consumed by **both** orchestrators:

| New module | Export | What moves |
|---|---|---|
| `chat/agent-resolution.ts` | `resolveAgentRec(workspaceId, agentId)` | Picking the specific agent, else the workspace default, else the legacy inline `workspace.agent` config. |
| `chat/retrieval.ts` | `retrieveContext(namespace, message, trace)` → `{ contextBlocks, sources }` | The embed + Pinecone query + 0.6 score filter. Keeps its own try/catch, so both callers inherit non-fatal retrieval. |
| `chat/prompt.ts` | `buildChatParams({ systemPrompt, contextBlocks, skillBlocks, history, message, apiKey, model })` → `ChatParams` | Context-section assembly and message-array construction. Pure. |
| `chat/turn-tools.ts` | `loadTurnTools(workspaceId, agentId, skills, skillCtx)` → `{ tools, skillTools }` | Wraps the existing `loadTools` + `gatherTools`; each independently non-fatal. |

What **stays** in `prepareTurn`: the billing gate, the silence/reopen gate, conversation-document lifecycle, escalation rules, and the `persist` closure. These are channel concerns.

`prepareCopilotTurn` reads as: resolve agent → load enabled skills → retrieve → gather context → resolve key → build params → load tools → persist. Its differences from the channel path are expressed by the calls it does not make, not by flags.

**Hard rule:** `prepareTurn`'s behaviour must not change. The existing API test suite — including `agent-turn.test.ts`'s silence-gate coverage — must pass **unedited**. A test that needs changing means the extraction changed behaviour and is wrong.

## 2. Data model

```
workspaces/{ws}/copilotUsers/{uid}/threads/{threadId}
                                          └── messages/{messageId}
```

Two deliberate choices in that path:

**The `{uid}` segment makes privacy structural.** The security rule is `request.auth.uid == uid` — no `get()` lookup, no field comparison, and no way to address another member's threads. This matters because the dashboard reads Firestore directly from the browser (`onSnapshot` in the inbox), so an API-only check would be bypassable by anyone opening a client listener.

**The collection is named `threads`, not `conversations`.** The sweep runs `collectionGroup('conversations')` twice ([lib/skills/sweep.ts](../../../apps/api/src/lib/skills/sweep.ts)); a collection named `conversations` anywhere in the tree would be reached by it, and Copilot threads would be silently auto-closed and scored. Naming makes that structurally impossible rather than relying on a filter a later edit could drop. Nothing performs a collection-group query on `messages`, so that name is safe.

Thread document:

```ts
{
  uid: string            // redundant with the path; kept for admin queries
  agentId: string
  title: string          // first user message, truncated to 80 chars
  createdAt: Date
  updatedAt: Date
  lastMessage: string    // truncated to 200 chars, for the list
}
```

Messages reuse the existing `{ role, content, createdAt, metadata }` shape, so `metadata.sources` renders with code that already exists.

**Firestore rules** gain read-only client access, writes staying server-side:

```
match /copilotUsers/{uid}/threads/{threadId} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
  match /messages/{messageId} {
    allow read: if request.auth != null && request.auth.uid == uid;
    allow write: if false;
  }
}
```

## 3. Billing

`WorkspaceUsage` gains `copilotPeriodCount: number`, reset on the same period boundary as `periodConversationCount` by reusing `shouldResetPeriod` — one billing calendar, not two.

`PlanDef` gains `copilotCap: number`. Trial is **not** a `PlanDef` — `PlanTier` is only `lite | core | max`, and the trial allowance lives in the standalone `TRIAL_CONVERSATION_CAP` constant that `checkEntitlement` reads. Copilot mirrors that shape with a new `TRIAL_COPILOT_CAP`:

| Tier | `conversationCap` (existing) | `copilotCap` (new) |
|---|---|---|
| lite | 100 | 200 |
| core | 500 | 1000 |
| max | 1500 | 3000 |
| *trial* | `TRIAL_CONVERSATION_CAP` = 50 | `TRIAL_COPILOT_CAP` = 50 (new constant, not a `PlanDef` field) |

**The cap is not the only gate.** `checkCopilotEntitlement` must mirror the status ladder in `checkEntitlement`: `active`/`past_due` get the plan cap (failing open on an unknown tier, so a transient Stripe sync state never locks out a paying customer); `trialing` gets `TRIAL_COPILOT_CAP` and is refused once `trialEndsAt` has passed; `canceled`, `expired` and a missing subscription are refused outright. Reading `tier` alone would let an expired trial or a cancelled customer keep free LLM spend through Copilot — the exact abuse this cap exists to prevent.

The cap is checked **once per thread, when its first message is sent** — mirroring how customer conversations gate on creation, so a long thread is not punished per message. Creating an empty thread therefore consumes nothing; a thread that is never messaged never counts. Over cap returns HTTP 402 with reason `copilot_limit`, distinct from the customer-conversation reason so the UI never tells someone their customers are blocked when it is their own internal allowance.

No overage billing. This cap is a spend guard, not a revenue line.

## 4. API

A new router mounted at `/copilot` with `requireAuth` only — members use this, not just owners.

| Route | Behaviour |
|---|---|
| `GET /copilot/threads` | The caller's threads, newest first. A plain read of their own path, not a filtered query. |
| `POST /copilot/chat` | SSE (`chunk` / `done` / `error`), body `{ message, threadId?, agentId? }`. |
| `DELETE /copilot/threads/:id` | Deletes the thread and its messages. |

There is deliberately **no** "create thread" route. `POST /copilot/chat` takes either a `threadId` (continue) or an `agentId` (start), creating the thread as it writes the first message. That makes empty threads structurally impossible rather than something to clean up later, and it means the Test button can target an agent without writing anything until the user actually says something. Supplying neither, or both, is a 400. The `agentId` must belong to the caller's workspace, else 404.

The thread is resolved from the caller's own path, so one belonging to another uid is not addressable — cross-user access fails as a 404 without needing an ownership comparison. The `copilotPeriodCount` gate runs only on the create branch, then `prepareCopilotTurn` runs and streams via the existing `runAgentTurn`.

Rate limiting reuses `rateLimit` keyed on `uid` rather than IP, with a lower ceiling than the widget's — an authenticated team member has no reason to burst.

## 5. Web

`/dashboard/copilot`: thread list on the left (title, agent, timestamp), chat pane on the right, agent picker when starting a thread. Messages render `metadata.sources`, so "where did that answer come from" works immediately — most of what makes this usable as a test bench.

`apps/web` has **no SSE consumer** today; the widget's lives in a separate vanilla-TS bundle Next.js cannot import as-is. Copilot therefore adds a ~30-line reader (`res.body.getReader()`, `TextDecoder`, SSE frame splitting) colocated with the page. This is knowingly the second implementation of that loop; sharing it would require a new browser-targeted package, since `packages/shared` is deliberately dependency-free and DOM-free, and that is more machinery than the duplication costs.

**The test-bench entry point** is a single affordance: a **Test** button in the agent editor deep-linking to `/dashboard/copilot?agent=<id>`. That opens the page with a *composer* targeting that agent and no thread yet — the thread is created on the first message, so repeatedly clicking Test does not litter the list with empties. The daily-assistant page *is* the test bench, entered by a different door.

The thread list uses an `onSnapshot` listener on the caller's own path, matching the inbox's existing pattern.

## 6. Error handling

| Failure | Behaviour |
|---|---|
| Retrieval fails | Non-fatal; the turn proceeds without context. Inherited from `retrieveContext`'s own try/catch, so both orchestrators get it. |
| Skill hook throws | Already isolated per hook by `gatherContext` / `gatherTools`. |
| Missing gateway key | 502 with the same guidance the widget path returns. |
| Over the Copilot cap | 402, reason `copilot_limit`. |
| Thread not found or not the caller's | 404. Indistinguishable by design — the path prevents addressing another user's thread. |

## 7. Testing

- **Extracted modules** become independently testable for the first time. `buildChatParams` is pure. `resolveAgentRec` takes injected snapshots, following `resolveAgentDoc` in `agent-helpers.test.ts`.
- **`prepareCopilotTurn`** is tested on exactly the points where it differs from the channel path: the customer-conversation counter is untouched, escalation does not run, the scoring hook is not invoked, and Memory/Web Search still are.
- **Cap logic** is pure and tested at its boundary, like the existing plan validators.
- **Regression proof:** the existing API tests pass **unedited**. This is the property that makes refactoring the hottest file in the codebase acceptable, and it is a hard gate, not an aspiration.

## 8. Rollout

No migration. A workspace with no `copilotUsers` subtree simply has no threads; the feature is invisible until someone opens the page.

Deployment order: shared types and API first (inert without UI) → `firestore.rules` → the web page. The rules must land before the UI, because the thread list uses a client listener and would otherwise be denied.

## Out of scope

- **File upload, voice, and Raia's copilot button/action system** — Copilot here is a chat surface over existing agents, not a configurable product of its own.
- **Per-workspace Copilot configuration** — no settings object; behaviour comes from the agent.
- **Sharing threads between members** — revisit if people ask; privacy is the safer default to start from.
- **Overage billing on `copilotCap`** — the cap is a spend guard.
