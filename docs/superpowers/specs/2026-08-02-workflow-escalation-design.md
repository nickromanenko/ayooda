# Ayooda Sub-project H — Workflow Builder (Escalation Rules) — Design Spec

**Date:** 2026-08-02
**Status:** Approved for planning
**Scope:** Let a workspace owner define an ordered list of rules that escalate a conversation to a human during a bot turn, based on triggers (visitor asks for a human, low knowledge confidence, N bot replies, keyword, off-hours). The first matching enabled rule fires: the bot goes silent, the conversation enters a **waiting** queue in the inbox, and the visitor sees an optional handoff message. Rules are workspace-level. Escalate-to-human is the only action in v1.

## Background

Today conversations are `bot | human | resolved` ([packages/shared/src/index.ts](../../../packages/shared/src/index.ts) `ConversationStatus`). The bot answers every turn via `prepareTurn` ([apps/api/src/lib/chat/agent-turn.ts](../../../apps/api/src/lib/chat/agent-turn.ts)) unless an operator manually takes over from the inbox (`POST /conversations/:id/takeover` → `status: 'human'`, `operatorId` set). `prepareTurn` already computes RAG `sources` filtered at a `0.6` score threshold — a ready-made confidence signal. Telegram stays silent when `status === 'human'`; the widget currently has **no** such guard (a latent gap this spec closes). There is no automatic escalation.

This adds a rules engine evaluated each bot turn that can hand a conversation to a human before the LLM is called.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Shape | **Ordered rules list** (trigger → action), first enabled match wins. No visual node-graph. |
| Triggers (v1) | **ask_for_human, low_confidence, bot_replies, keyword, off_hours** (all five). |
| Action (v1) | **escalate to a human** + optional handoff message. No routing-to-agent, no auto-reply. |
| Rule scope | **Workspace-level** (escalation targets the one shared human team/inbox). |
| Escalation state | A new conversation status **`waiting`** (escalated, no operator yet), distinct from `human` (operator engaged). |
| Notifications | **Inbox real-time only** (existing Firestore listeners). No email/push. |

---

## 1. Data model (Firestore + shared types)

New subcollection `workspaces/{id}/workflowRules/{ruleId}`:

```
{
  name: string
  enabled: boolean
  order: number                 // ascending; ties broken by createdAt
  trigger: { type: TriggerType, config: TriggerConfig }
  action: { type: 'escalate', handoffMessage?: string }
  createdAt, updatedAt
}
```

Trigger types and configs:
- `ask_for_human` → `{ phrases: string[] }` — case-insensitive substring match of any phrase in the visitor message. Default phrases: `['human','agent','representative','real person','speak to someone','talk to a person']`.
- `low_confidence` → `{}` — fires when RAG returned **0** sources over the 0.6 threshold (`sourceCount === 0`).
- `bot_replies` → `{ count: number }` — fires when the conversation's `botReplyCount >= count` (i.e. after `count` bot replies, the next visitor turn escalates). `count` is 1–50.
- `keyword` → `{ keywords: string[] }` — case-insensitive substring match of any keyword in the visitor message.
- `off_hours` → `{ timezone: string, days: number[], start: string, end: string }` — `days` are open weekdays (0=Sun…6=Sat); `start`/`end` are `"HH:MM"` (24h) in `timezone`. Fires when the current time is **outside** the open window (a closed day, or before `start`/at-or-after `end`).

Shared types (`packages/shared`): `TriggerType`, `TriggerConfig` (a discriminated union per type), `WorkflowAction`, `WorkflowRule` (the API↔web contract, minus timestamps), and the `EscalationContext` used by the engine.

**Conversation changes** ([shared `ConversationStatus`, `ConversationDoc`]):
- `ConversationStatus` gains `'waiting'` → `'bot' | 'waiting' | 'human' | 'resolved'`.
- `ConversationDoc` gains `escalationReason?: string` and `botReplyCount?: number`.

## 2. Engine (pure) — `apps/api/src/lib/workflow/engine.ts`

- `EscalationContext = { messageLower: string; botReplyCount: number; sourceCount: number; now: Date }`.
- `matchesTrigger(trigger, ctx): boolean` — one pure predicate per trigger type. `off_hours` derives the local weekday + `HH:MM` in `trigger.config.timezone` via `Intl.DateTimeFormat(undefined, { timeZone, weekday, hour, minute, hourCycle:'h23' })` applied to `ctx.now`.
- `evaluateRules(rules: WorkflowRule[], ctx): WorkflowRule | null` — filters `enabled`, sorts by `order` then `createdAt`, returns the first whose trigger matches, else `null`.

No Firestore, no I/O — fully unit-testable with a fixed `now`.

## 3. `prepareTurn` integration ([apps/api/src/lib/chat/agent-turn.ts])

`PreparedTurn` gains two kinds:
- `{ kind: 'silent' }` — the bot must not answer (a human owns/queued the conversation).
- `{ kind: 'escalated'; message: string }` — deliver `message` to the visitor and surface the conversation in the inbox; no LLM call.

Flow changes inside `prepareTurn`:
1. **Silence guard:** when the conversation already exists and its status is not `'bot'` (i.e. `waiting`/`human`/`resolved`), append the visitor message (as today for Telegram) and return `{ kind: 'silent' }` before any RAG/LLM work. This closes the widget gap and makes escalation idempotent (a `waiting` conversation never re-escalates or gets a bot reply).
2. **Escalation:** after RAG computes `sources` (so `sourceCount = sources.length`) and before key resolution / the LLM call, load enabled rules from `workspaces/{id}/workflowRules` (non-fatal on error → `[]`) and call `evaluateRules(rules, { messageLower: trimmed.toLowerCase(), botReplyCount: conv.botReplyCount ?? 0, sourceCount, now: new Date() })`. On a match: update the conversation to `{ status: 'waiting', escalationReason: rule.name, operatorId: null, updatedAt }`, and return `{ kind: 'escalated', message: rule.action.handoffMessage?.trim() || DEFAULT_HANDOFF }` (`DEFAULT_HANDOFF = 'Let me connect you with someone from our team.'`).
3. **Normal path unchanged:** if no rule matches, continue to key resolution + `ready`. `persist` additionally increments `botReplyCount` on the conversation (a `FieldValue.increment(1)` alongside the existing bookkeeping) so `bot_replies` can fire on later turns.

On escalation, `prepareTurn` itself writes the handoff message as a normal assistant message (no `llmModel`/token metadata) in the same step as the status update, so it appears once in the inbox transcript and widget history. The caller only **delivers** `message` to the visitor — it does not persist it.

## 4. Channel callers

- **Widget** ([apps/api/src/routes/widget.ts]): handle the new kinds after `prepareTurn`. For `escalated`, emit `message` as a single SSE `chunk` then `done` (no `streamChat`, no persist — `prepareTurn` already saved it). For `silent`, emit `done` with no chunk (the visitor's message is saved; the operator/inbox handles the reply). The existing `gated`/`error`/`ready` paths are unchanged.
- **Telegram** ([apps/api/src/routes/telegram.ts]): for `escalated`, `sendMessage` the handoff text (no persist); for `silent`, do nothing (200). Broaden the existing human-silence check so the bot stays silent for **any** non-`bot` status (`status !== 'bot'`), not just `'human'` — covering `waiting`. (This complements the `prepareTurn` silence guard, which also handles the widget.)

## 5. Inbox — the Waiting queue

- `GET /conversations?status=waiting` already works (generic status filter). The inbox web page ([apps/web/src/app/dashboard/inbox](../../../apps/web/src/app/dashboard/inbox)) gains a **Waiting** tab/filter and shows each conversation's `escalationReason`. Waiting conversations are visually distinguished (they need pickup).
- Picking up = the existing `POST /conversations/:id/takeover` (works from any status → `human`). No new endpoint.
- The widget's live event feed already streams `status` changes, so a visitor in an escalated conversation sees the operator's messages once they take over.

## 6. API — `apps/api/src/routes/workflows.ts` (requireAuth + requireOwner)

Mounted at `/workflows`:
- `GET /workflows` — list rules (ordered by `order`).
- `POST /workflows` `{ name, trigger, action, enabled? }` — validate; assign `order = max(order)+1`. Returns the rule.
- `PUT /workflows/:id` — update name/enabled/trigger/action (re-validate).
- `DELETE /workflows/:id` — delete (idempotent).
- `PUT /workflows/reorder` `{ orderedIds: string[] }` — set each rule's `order` to its index (batch); ignores ids not in the workspace.

A pure `validateRule(input): { ok: true; value } | { ok: false; error }` helper (trigger type ∈ enum, per-type config shape, action type `escalate`, handoffMessage length ≤ 500, name 1–80) is unit-tested and shared by POST/PUT.

## 7. Web — Workflows page

- New owner-only **Workflows** sidebar link ([apps/web/src/components/dashboard/Sidebar.tsx](../../../apps/web/src/components/dashboard/Sidebar.tsx)) → `/dashboard/workflows`.
- `apps/web/src/app/dashboard/workflows/page.tsx` (client, mirrors the existing dashboard idiom): an ordered list of rules with an enable toggle, up/down reorder buttons (calling `PUT /workflows/reorder`), and delete; plus an editor — name, a trigger-type `<select>` that swaps in type-specific config inputs (phrases textarea, count number, keywords textarea, off-hours timezone/day-checkboxes/start/end), and the optional handoff-message field. Inline validation errors surfaced from 4xx.

## 8. Billing / usage

Unaffected. Escalated turns make **no** LLM call (cheaper); the conversation was already counted on creation. No new counters beyond `botReplyCount` (not billing-related).

## 9. Error handling

- Rule load failure in `prepareTurn` → treat as no rules (bot answers normally); logged.
- Invalid rule payload → `400` with a specific message.
- `off_hours` with an unknown timezone → `Intl.DateTimeFormat` throws; `matchesTrigger` catches and returns `false` (rule simply doesn't fire) so a bad config never breaks a turn. `validateRule` rejects timezones that don't construct a formatter.
- Escalation is idempotent via the silence guard (§3.1): a `waiting` conversation is never re-evaluated.
- Reorder with stale/foreign ids → those ids are skipped; no error.

## 10. Testing & verification

- **Unit (`bun test`):** each `matchesTrigger` predicate (phrase/keyword substring, `sourceCount===0`, `botReplyCount>=count`, off-hours inside/outside window across two timezones and a closed day); `evaluateRules` (disabled skipped, order respected, first match wins, no-match → null); `validateRule` (each trigger's config shape, bad type, over-length handoff/name, bad timezone).
- **Live E2E:** create one rule per trigger; drive a widget conversation that (a) says "can I talk to a human" → escalates with the handoff message and appears in the Waiting queue; (b) asks something off-topic with no knowledge → low_confidence escalates; (c) after N replies → bot_replies escalates; (d) a keyword message escalates; (e) an off_hours window escalates. Confirm the bot goes silent post-escalation (further visitor messages get no bot reply), the operator can take over (waiting → human), and the Telegram path escalates identically. Clean up test rules/conversations.

## Out of scope (v1)

Visual node-graph builder; routing-to-agent and auto-reply actions; multi-step/branching flows; email/push notifications; per-agent rules; LLM-based intent detection (v1 is keyword/phrase matching); SLA timers / auto-resolve; analytics on escalation rates.
