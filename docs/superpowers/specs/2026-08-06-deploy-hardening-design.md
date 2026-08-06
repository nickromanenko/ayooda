# Ayooda Sub-project M — Deploy / Hardening Pass — Design Spec

**Date:** 2026-08-06
**Status:** Approved for planning
**Scope:** Make everything merged this session shippable. Two in-repo deliverables: (1) harden + validate `firestore.rules` for the subcollections added this session; (2) rewrite `docs/deploy.md` into a single ordered deploy runbook covering the complete env/secret set, Stripe/Pinecone/Gateway setup, and the data-migration scripts, ending with a prod-readiness audit that lists the deferred code follow-ups. Running the actual deploys/migrations/console steps is the operator's job and out of scope.

## Background

`master` carries many merged-but-undeployed features: team members, tool/webhook actions, multiple agents (per-agent knowledge/tools/key), workflow/escalation, CRM templates, self-hosting docs, metered overage billing, and the Vercel AI SDK + AI Gateway migration. The deploy prerequisites are scattered across feature memories. `docs/deploy.md` predates the session and is stale (no chat key at all, no encryption secret, no Stripe/overage env, no `API_PUBLIC_URL`/`WEB_PUBLIC_URL`, no Pinecone `ayooda-prod` creation, and none of the migration scripts).

`firestore.rules` is **safe by deny-default** for the new subcollections (only the inbox uses the client SDK — `conversations`/`messages`, both covered; everything else routes through the Admin-SDK API), but it has a dead top-level `knowledge` match (knowledge moved under agents) and a stale `openRouterKey` comment.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Depth | **Runbook + Firestore rules tidy + audit.** No app-code behavior change beyond the rules file; deferred follow-ups are **listed, not fixed**. |
| Runbook | **Rewrite `docs/deploy.md`** (single source of truth), not a new file. |
| Audit | A section at the end of the runbook listing each deferred follow-up with a fix-now-vs-defer call. |
| Deploys | The operator runs all console/deploy/migration steps; this pass produces the doc + hardened rules only. |

---

## 1. `firestore.rules` hardening

Confirmed client-SDK Firestore usage (web): **only** `apps/web/src/app/dashboard/inbox/page.tsx` — `onSnapshot` over `workspaces/{ws}/conversations` and `.../conversations/{id}/messages`. All agents/knowledge/tools/workflows/billing/workspace access is via the Admin-SDK API. Therefore:

- **Remove** the top-level `match /knowledge/{docId}` block (knowledge now lives at `workspaces/{ws}/agents/{agentId}/knowledge`; no client reads the old path).
- **Add explicit server-only matches** (`allow read, write: if false`) with a comment, for defense-in-depth (they already deny by default, but explicit + commented prevents accidental loosening and documents intent — these hold encrypted keys/secrets and are Admin-SDK-managed):
  - `match /workspaces/{workspaceId}/agents/{agentId}` and nested `match /knowledge/{docId}` + `match /tools/{toolId}`.
  - `match /workspaces/{workspaceId}/workflowRules/{ruleId}`.
- **Keep unchanged:** `channels/{channelId}` (owner-only), `conversations/{conversationId}` + `messages/{messageId}` (workspace-member — the inbox needs client read access), the `workspaces/{workspaceId}` doc (`if false`), and `users/{userId}`.
- **Update the stale comment** on the workspace-doc match: `openRouterKey` → "encrypted per-agent AI Gateway keys and tool secrets (stored under agents/*), which must never be client-readable."
- **Validate** the rewritten file with the Firebase security-rules validation tool before committing. Any syntax error blocks the task.

Rules v2 semantics preserved (no `match` = deny). The explicit `if false` blocks are documentation + guardrails, not a behavior change (the effective access is identical to today).

## 2. Deploy runbook — rewrite `docs/deploy.md`

Ordered, with exact commands. Sections:

- **0. One-time infra & accounts:** Firebase project (Firestore Native, Auth Google+Email/Password, Storage); **create the Pinecone `ayooda-prod` index — 768-dim, cosine** (does not exist yet; old data lives in `ayooda-dev`); a **Vercel AI Gateway** account (paid credits for non-Gemini models; the free tier serves Gemini Flash only); a Stripe account.
- **1. Secrets (Secret Manager) — complete set:** `firebase-service-account-key`, `pinecone-api-key`, `gemini-api-key`, **`api-key-encryption-secret`, `ai-gateway-api-key`, `stripe-secret-key`, `stripe-webhook-secret`** (+ optional Langfuse). `API_KEY_ENCRYPTION_SECRET` must stay stable (rotating it invalidates every stored encrypted secret).
- **2. Firestore:** `firebase deploy --only firestore` (rules + indexes); watch the console for index builds; note that a new composite-index prompt from a query is applied by re-running the deploy after adding it to `firestore.indexes.json`.
- **3. Stripe setup:** run `apps/api/scripts/setup-stripe.ts` (creates the three products/prices **and** the overage meter + metered $0.05 price) → capture `STRIPE_PRICE_LITE/CORE/MAX`, **`STRIPE_PRICE_OVERAGE`, `STRIPE_OVERAGE_METER_EVENT`**; register a webhook endpoint (`POST {API_PUBLIC_URL}/billing/webhook`) → `STRIPE_WEBHOOK_SECRET`; set `BILLING_SUCCESS_URL` / `BILLING_CANCEL_URL`.
- **4. Deploy — widget → API → scraper → web** (existing infra steps, modernized). The **API Cloud Run env must include the complete current set:** the base creds + `API_KEY_ENCRYPTION_SECRET`, `AI_GATEWAY_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_LITE/CORE/MAX`, `STRIPE_PRICE_OVERAGE`, `STRIPE_OVERAGE_METER_EVENT`, `BILLING_SUCCESS_URL`, `BILLING_CANCEL_URL`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `WIDGET_BASE_URL`, `ALLOWED_ORIGINS`, `PINECONE_INDEX=ayooda-prod`, `SCRAPER_JOB_URL`. **API and web deploy together** (web calls the retired `/workspace/agent`+`/key` are gone; an old web against a new API — or vice versa — breaks agent/key editing).
- **5. Data migrations (ordered, run once against prod after the API image has creds):**
  1. `migrate-agents.ts` — **required**; creates the default agent, reparents knowledge/tools under it, tags channels. Without it, agent resolution/knowledge/tools break for existing workspaces.
  2. `backfill-trials.ts` — grants existing workspaces a fresh trial so pre-billing workspaces aren't immediately gated.
  3. `backfill-overage-item.ts` — adds the metered overage item to existing active/past_due/trialing subscriptions.
- **6. Re-index knowledge** into `ayooda-prod`: old embeddings are incompatible (different index/dimension history) and now belong in per-agent namespaces — re-run ingestion for existing knowledge docs (via the dashboard reindex or a scripted pass).
- **7. Post-deploy smoke test:** sign up → onboard (default agent created) → add knowledge → confirm `indexed` → widget chat returns a grounded answer (use a Gemini model — free Gateway tier) → Billing page shows usage → set an escalation rule and confirm it moves a conversation to the Waiting queue → create a tool and `/test` it. Telegram optional.
- **8. Known limitations & deferred follow-ups (audit):** a table listing each item, its source feature, severity, and a fix-now-vs-defer recommendation. Items: reindex UI swallows non-2xx (minor UX); XFF spoofability on the per-IP rate limit (per-channel limit is the backstop); channel-connect TOCTOU on concurrent connect; remove-member orphans `operatorId` on taken-over conversations; events-feed reconnect cursor (operator msgs lost in reconnect gaps); invite create not transactional; the deferred Live E2Es (tool round-trip, agent namespace isolation, overage metering, Gateway multi-provider — need running services + paid keys). **All recommended "defer"** (none are ship blockers); tracked here so they aren't lost.

## 3. Testing & verification

- **Rules:** validated with the Firebase security-rules validation tool (syntax/compile). The behavioral guarantee is unchanged (explicit `if false` = the existing deny-default), so no emulator round-trip is required; a one-line rationale is recorded in the doc.
- **Runbook consistency:** every env var named in the runbook's API-deploy step exists in `apps/api/.env.example`; every script path referenced exists under `apps/api/scripts/`; the Pinecone dimension (768) and index name (`ayooda-prod`) match `pinecone.ts`/the code.
- **Repo suite:** `bun test` + `pnpm -r typecheck` remain green (no app code changed).

## Out of scope

Running any deploy, migration, or console step; creating cloud resources; fixing the deferred follow-ups (listed only); any app-code behavior change beyond `firestore.rules`; changing infra topology (Cloud Run / App Hosting / Firebase Hosting stay).
