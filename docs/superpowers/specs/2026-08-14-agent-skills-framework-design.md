# Ayooda Sub-project N — Agent Skills Framework (Memory, Scoring, Web Search) — Design Spec

**Date:** 2026-08-14
**Status:** Approved for planning
**Scope:** Introduce a per-agent **skills** framework — a code-defined catalogue, a per-agent attachment record carrying `enabled` + `config`, and three typed hook points in the agent turn — then build three skills on it: **Memory** (per-visitor facts recalled across conversations), **Scoring** (post-conversation score + summary for the owner), and **Web Search** (a Tavily-backed tool). Adds one scheduled sweep endpoint driven by Cloud Scheduler. Live Chat, Copilot and Calendar are explicitly out of scope and get their own sub-projects.

## Background

Ayooda agents today are configured by a fixed set of fields — `systemPrompt`, `llmModel`, `knowledgeNamespace` — plus two per-agent extension points that already work well: knowledge (a Pinecone namespace) and tools (`workspaces/{ws}/agents/{agentId}/tools`, loaded by `loadTools` in [apps/api/src/lib/chat/tools.ts](../../../apps/api/src/lib/chat/tools.ts)). Every capability beyond those requires editing `prepareTurn` ([apps/api/src/lib/chat/agent-turn.ts](../../../apps/api/src/lib/chat/agent-turn.ts)), a 268-line function that already handles billing gating, conversation setup, RAG, escalation rules, key resolution and prompt assembly, and which every channel depends on.

This design is modelled on Raia's skill system (analysed in [docs/raia-agents-and-skills-analysis.md](../../raia-agents-and-skills-analysis.md)), minus its OpenAI coupling. Raia stores its catalogue in a database table and its attachments in a join table with a `config` JSONB column. We keep the same *separation* — catalogue vs. attachment vs. skill-owned data — but the catalogue lives in code, because ours is a fixed set the product team ships, not user data.

The framework's success criterion: **adding skill number four is a new file, not a bigger `prepareTurn`.**

## Decisions (agreed)

| Decision | Choice |
|---|---|
| First-cut scope | **Framework + Memory + Scoring + Web Search.** Live Chat expansion, Copilot and Calendar are separate sub-projects. |
| Attachment scope | **Per-agent**, matching `tools`, `systemPrompt` and `knowledgeNamespace`. |
| Framework shape | **Registry with typed hooks** — not inline conditionals in `prepareTurn`, not a middleware chain. |
| Hooks | **Three**: `contributeContext`, `contributeTools`, `afterConversation`. No `afterTurn` — no consumer. |
| Memory semantics | **Per-visitor facts** (Raia's `BY_USER`). No per-agent learned memory. |
| Memory storage | **Firestore**, one document per visitor. Pinecone stays reserved for knowledge. |
| Memory extraction | **At conversation end**, not per turn — one LLM call per conversation instead of one per message. |
| Scoring purpose | **Post-conversation owner review** (score + summary in the inbox). Not a live escalation signal. |
| Scheduling | **Cloud Scheduler → `POST /internal/sweep`** on the existing API. No new service, no new CI pipeline. |
| Idle conversations | The sweep **auto-closes** idle `bot` conversations so scoring has a trigger. Accepted product change. |
| Web search provider | **Tavily**, platform-funded key, capped per conversation, gated to paid tiers. |
| `skillIdentifier` | **Not implemented.** It exists in Raia to route inbound email/SMS/voice; none of these three skills are inbound channels. |

---

## 1. Catalogue — `packages/shared/src/skills.ts`

A new file, re-exported from `index.ts` (already 494 lines and not the place for this).

`SkillDef` references `PlanTier`, which lives in `index.ts` today — importing it from there while `index.ts` re-exports `skills.ts` is an import cycle. Plan and billing types (`PlanTier`, `PlanDef`, `PLANS`, `planFor`) therefore move to `packages/shared/src/plans.ts`, with `index.ts` and `skills.ts` both importing from it. Pure code motion, re-exported from `index.ts` so no consumer changes.

```ts
export type SkillId = 'memory' | 'scoring' | 'web_search'

export interface SkillDef<C = unknown> {
  id: SkillId
  label: string
  description: string
  configSchema: z.ZodType<C>
  defaultConfig: C
  minTier: PlanTier | null      // null = every plan, including trial
}

export const SKILLS: readonly SkillDef[]
export function skillDef(id: SkillId): SkillDef | undefined
export function isSkillId(v: string): v is SkillId
```

Each skill's zod schema is defined once here and consumed by three callers: the API's `PUT` validation, the web config form, and the skill module's typed access to its own config. There is no second definition to drift.

Config schemas:

```ts
memory:     { retentionDays: number }              // int 1–365, default 90
scoring:    { rubric?: string }                    // ≤ 2000 chars; omitted = default rubric
web_search: { maxResults: number }                 // int 1–5, default 3
```

Tier gating: `memory` and `scoring` are `null`; `web_search` is `'core'` — it is the only one with a per-call marginal cost.

## 2. Attachment — Firestore

```
workspaces/{ws}/agents/{agentId}/skills/{skillId}
  {
    enabled: boolean
    config: <skill-specific, validated against configSchema>
    createdAt: Date
    updatedAt: Date
  }
```

The document id **is** the skill id. That gives Raia's `(agentId, skillId)` uniqueness constraint for free — Firestore cannot hold two documents at one path.

Three states, matching Raia's model:
- **Document absent** — not attached.
- **`enabled: false`** — attached but off (Raia's *archived*). Config survives a disable/re-enable cycle.
- **`enabled: true`** — active.

Additions to existing shared types:

```ts
// ConversationDoc
score?: number            // 1–5
summary?: string          // ≤ 500 chars
scoredAt?: Date
searchCallCount?: number
autoClosedAt?: Date
pendingPostProcess?: boolean   // set when a conversation reaches `resolved`, cleared by the sweep
```

New collection, workspace-level (a visitor is the same person regardless of which agent answered):

```
workspaces/{ws}/visitorMemory/{visitorId}
  {
    facts: Array<{ id: string, text: string, createdAt: Date, expiresAt: Date }>
    nextExpiryAt: Date | null      // min(facts[].expiresAt); drives the purge query
    updatedAt: Date
  }
```

## 3. Skill modules — `apps/api/src/lib/skills/`

Files: `types.ts`, `registry.ts`, `memory.ts`, `scoring.ts`, `web-search.ts`.

```ts
export interface SkillContext<C> {
  workspaceId: string
  agentId: string
  conversationId: string
  visitorId: string
  message: string        // current user message, trimmed
  config: C              // already validated against the skill's schema
  trace: LangfuseTrace
}

export interface ConversationContext<C> {
  workspaceId: string
  agentId: string
  conversationId: string
  visitorId: string
  messages: Array<{ role: string; content: string }>
  config: C
}

export interface SkillModule<C = unknown> {
  id: SkillId
  contributeContext?(ctx: SkillContext<C>): Promise<string | null>
  contributeTools?(ctx: SkillContext<C>): Promise<ToolSet>
  afterConversation?(ctx: ConversationContext<C>): Promise<void>
}
```

The registry is `Record<SkillId, SkillModule<any>>`. The `any` is confined to that one declaration: config is validated against the skill's own schema before a module ever receives it.

`loadEnabledSkills(workspaceId, agentId, tier)` performs one query — the `skills` subcollection where `enabled == true` — then, for each row: resolves the catalogue entry (unknown ids are skipped, so a removed skill leaves no wreckage), drops any whose `minTier` exceeds the workspace tier, and parses `config` through the schema, falling back to `defaultConfig` if parsing fails. It returns `Array<{ def, module, config }>` ordered by the `SKILLS` array, so hook execution order is deterministic and independent of Firestore's return order.

## 4. Turn integration — `prepareTurn`

Three call sites, roughly 25 lines. Not a rewrite.

```
agent resolution
  └─ loadEnabledSkills()          ← needs agentId + workspace tier
billing gate → conversation setup → user message persisted
RAG (Pinecone)
  └─ contributeContext()          ← Promise.all; non-null blocks join the context section
escalation rules → key resolution → prompt assembly
loadTools()
  └─ contributeTools()            ← merged into ReadyTurn.skillTools
streamText (runAgentTurn)
persist()
```

`contributeContext` results are appended to the existing knowledge-context section under their own headings, keeping prompt assembly in one place.

`ReadyTurn` gains `skillTools: ToolSet`, and `runAgentTurn` merges `{ ...toAiSdkTools(tools, trace), ...skillTools }`. Skill tool names are namespaced by skill id (`web_search`), so they cannot collide with a customer-defined tool. Where a name does collide, the customer's tool wins and the collision is logged — a customer's existing integration must never break because we shipped a skill.

Each hook is individually try/caught, logged and skipped. This is the established convention in that function: RAG, escalation and tool loading are all already non-fatal. A failing skill must never cost a visitor their reply.

Every hook opens a Langfuse span (`skill:memory:context`, `skill:web_search:tools`), alongside the existing `pinecone-query` and `tool:*` spans.

## 5. Memory — `apps/api/src/lib/skills/memory.ts`

**Recall** (`contributeContext`): one read of `visitorMemory/{visitorId}`. Facts with `expiresAt <= now` are filtered out at read time regardless of whether the purge has run yet — the sweep is an optimisation for storage, never the correctness boundary for retention. Returns `null` when there are no live facts, so an empty memory adds nothing to the prompt. Otherwise a block:

```
What you remember about this visitor from previous conversations:
- <fact text>
```

**Extraction** (`afterConversation`): one `generateObject` call over the conversation transcript, against `google/gemini-2.5-flash` (fixed, not the agent's configured model — scoring and extraction should not run at Claude Sonnet prices; the Gateway key resolves all models). Schema: `{ facts: string[] }`, at most 3 per conversation, each ≤ 200 chars, instructed to capture durable facts about the visitor (identity, account, preferences, unresolved issues) and to ignore transient chatter.

New facts are deduped case-insensitively against existing ones, appended with `expiresAt = now + retentionDays`, and the array is capped at **20** facts by evicting oldest-first. `nextExpiryAt` is recomputed on every write.

**Purge** (sweep): collection-group query on `visitorMemory` where `nextExpiryAt <= now`, bounded per run; each document is rewritten with expired facts dropped and `nextExpiryAt` recomputed (`null` when no facts remain).

## 6. Scoring — `apps/api/src/lib/skills/scoring.ts`

`afterConversation` only. One `generateObject` over the transcript against the same fixed cheap model, returning:

```ts
{ score: number,     // integer 1–5
  summary: string }  // ≤ 500 chars
```

Default rubric grades how well the agent resolved the visitor's request; `config.rubric` replaces it when set. Result is written to the conversation document as `score`, `summary`, `scoredAt`.

Where both Memory and Scoring are enabled, the sweep still runs them as two independent hook calls — they read the same transcript but produce unrelated outputs, and coupling them would make either one's failure the other's problem.

Surfaced in the web inbox: score badge in the conversation list, score + summary at the top of the detail view.

## 7. Web Search — `apps/api/src/lib/skills/web-search.ts`

`contributeTools` returns a single AI SDK tool:

```ts
web_search: tool({
  description: 'Search the public web for current information not in the knowledge base.',
  inputSchema: z.object({ query: z.string().describe('The search query') }),
  execute: async ({ query }) => { … }
})
```

Backed by `POST https://api.tavily.com/search` with the platform key from `TAVILY_API_KEY`, requesting `config.maxResults` results and returning their extracted text joined into one string.

**Cap**: `MAX_SEARCHES_PER_CONVERSATION = 3`, tracked as `searchCallCount` on the conversation document and incremented per call. Past the cap the tool returns the string `"Search limit reached for this conversation."` — the model reads it and adapts. A Tavily error likewise returns an error *string*, never a thrown exception: a rejected tool promise mid-stream would break the reply.

Missing `TAVILY_API_KEY` disables the skill at load time with a logged warning, so a misconfigured deploy degrades instead of erroring per turn.

## 8. Sweep — `POST /internal/sweep`

Called by Cloud Scheduler every **15 minutes**. Authenticated by an `X-Sweep-Secret` header compared against `SWEEP_SECRET` with a timing-safe comparison — the same shape as the per-channel Telegram `webhookSecret` already in the codebase. (Cloud Scheduler OIDC is a later hardening step; it needs no design change.)

**A conversation reaching `resolved` by any path sets `pendingPostProcess: true`** — the sweep's auto-close, and equally an operator resolving it from the inbox. Without this, operator-resolved conversations would never be scored at all, since the sweep would only ever see the ones it closed itself. The existing resolve path in the conversations route sets the flag alongside the status.

Each run, bounded:

1. **Close idle conversations.** Collection-group query on `conversations` where `status == 'bot'` and `updatedAt < now - 30min`, limit **100**. Each is set to `status: 'resolved'` with `autoClosedAt` and `pendingPostProcess: true`.
2. **Run `afterConversation`** for conversations where `pendingPostProcess == true`, limit 100, for whichever skills that conversation's agent has enabled. The flag is cleared on completion, and conversations with `scoredAt` already set are skipped — so a retried or overlapping run cannot double-score or double-charge. Querying the flag rather than the conversations just closed is what makes operator-resolved conversations get scored too.
3. **Purge expired memory**, per §5, limit 100 documents.

Per-conversation try/catch: one bad conversation cannot abort the batch, and a conversation that fails keeps its flag so the next run retries it. The response reports counts (`closed`, `scored`, `purged`, `failed`) for observability.

Constants: `IDLE_CLOSE_MINUTES = 30`, `SWEEP_BATCH = 100`.

New indexes in `firestore.indexes.json`, collection-group scoped:
- `conversations`: composite `status ASC, updatedAt ASC` (step 1)
- `conversations`: single-field `pendingPostProcess` (step 2)
- `visitorMemory`: single-field `nextExpiryAt` (step 3)

Conversations created before this ships have no `pendingPostProcess` field and so are never picked up — intentional. Backfilling historical conversations would spend LLM calls scoring transcripts nobody is waiting on.

## 9. API routes

On the existing agents router ([apps/api/src/routes/agents.ts](../../../apps/api/src/routes/agents.ts)), which already applies `requireAuth` + `requireOwner`:

| Route | Behaviour |
|---|---|
| `GET /agents/:agentId/skills` | Every catalogue entry merged with its attachment state: `{ id, label, description, enabled, config, locked }`. `locked` is true when `minTier` exceeds the workspace tier. One call renders the whole UI. |
| `PUT /agents/:agentId/skills/:skillId` | Body `{ enabled, config }`. Rejects unknown skill ids (404) and config failing `configSchema` (400). Rejects enabling a locked skill (403). Upserts. |
| `DELETE /agents/:agentId/skills/:skillId` | Deletes the attachment document. Skill-owned data (visitor memory, scores already written) is left intact — unlike Raia, none of these three skills provision external resources that need releasing. |

The merged response shape is a shared type so web and API cannot disagree about it.

## 10. Web UI

A **Skills** section on `/dashboard/agents/[id]`. One card per catalogue entry: label, description, toggle, and an inline config form rendered from the skill's fields when enabled. Raia's two-column added/available split earns its keep at 24 skills; at three it is machinery without a payoff.

Locked skills render visibly, greyed, with an upgrade prompt — a skill the customer cannot see is a skill they cannot want.

## 11. Error handling

| Failure | Behaviour |
|---|---|
| Any hook throws | Caught per hook, logged, skipped. Turn continues. |
| Config fails schema at API | 400. Malformed config never reaches a hook. |
| Config fails schema at load | Falls back to `defaultConfig`, logged. A bad write cannot brick an agent. |
| Unknown skill id in Firestore | Row skipped at load. |
| Tavily error / cap exceeded | Tool returns an error string the model can read. Never throws. |
| `TAVILY_API_KEY` missing | Skill disabled at load with a warning. |
| Extraction or scoring fails | Logged; conversation still closes. |
| One conversation fails in sweep | Caught per item; batch continues. |

## 12. Testing

Colocated `*.test.ts` under `bun test`, using dependency injection rather than mocks — the pattern `runAgentTurn` already establishes with its injectable `streamText` and `execute` ([tools.ts:186](../../../apps/api/src/lib/chat/tools.ts#L186)). Each skill module takes its LLM and HTTP callables the same way and is testable without network.

- **`packages/shared`** — every config schema accepts its default and rejects representative bad input; `skillDef`/`isSkillId` round-trip.
- **Registry** — disabled rows skipped; above-tier rows filtered; unknown ids skipped; bad config falls back to default; ordering follows the `SKILLS` array regardless of input order.
- **Memory** — recall filters expired facts even with `nextExpiryAt` stale; recall returns `null` when empty; extraction dedupes case-insensitively; the 20-fact cap evicts oldest-first; `nextExpiryAt` recomputes correctly, including to `null`.
- **Scoring** — result written to the conversation doc; `scoredAt` makes a second run a no-op.
- **Web search** — cap returns the refusal string rather than calling Tavily; a Tavily error returns a string rather than throwing.
- **Sweep** — selects only sufficiently idle `bot` conversations; respects the batch limit; a rejected secret returns 401; an operator-resolved conversation is picked up via `pendingPostProcess`; a failing conversation keeps its flag for retry while the batch continues; a conversation with `scoredAt` set is skipped.
- **`prepareTurn`** — hooks fire at the right phase; contributed context reaches the prompt; contributed tools reach `runAgentTurn`; a customer tool wins a name collision; **and an injected always-throwing skill still yields a complete reply.**

That last one is the test that matters: it is the guarantee the whole isolation design exists to provide.

## 13. Rollout

No migration. An agent with no `skills` subcollection has no skills, and every existing agent behaves exactly as it does today. The feature is purely additive and every skill defaults to off, so nothing changes for any workspace until an owner enables one.

Deployment order: shared types and API first (inert without attachments), then the Firestore indexes, then the Cloud Scheduler job, then the web UI that lets owners turn skills on.

New environment variables: `TAVILY_API_KEY`, `SWEEP_SECRET`.

## Out of scope

- **Live Chat, Copilot, Calendar** — separate sub-projects on this framework.
- **`skillIdentifier`** — add it when the first inbound-channel skill needs routing.
- **Per-agent learned memory** (Raia's `BY_AGENT`) — overlaps the knowledge base and a single bad extraction poisons every conversation.
- **Bring-your-own Tavily key** — revisit if platform search cost becomes material.
- **Skill-level usage metering** — existing workspace usage counters are unchanged.
