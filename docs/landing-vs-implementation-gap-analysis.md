# Landing Page vs. Implemented Functionality — Gap Analysis

- **Date:** 2026-08-24
- **Branch:** `master` (audit baseline `fb5f2d1`, plus the current working tree)
- **Scope:** `apps/web/src/components/LandingPage.tsx` (marketing) vs. `apps/api`, `apps/web`, `apps/widget`, `packages/shared` (product)
- **Method:** Read the landing page end-to-end, then traced every promoted capability to its implementation in the API routes, lib modules, shared types, and dashboard pages.

---

## Status legend

| Status | Meaning |
|---|---|
| ✅ Implemented | Ships and is reachable in the product today |
| 🟠 Partial | A real, smaller version exists, but not what the landing page shows |
| 🔴 Missing | Promoted but not implemented anywhere |
| 🟡 Risk | Not a code gap per se, but an unsubstantiated/at-risk claim |

**Priority:** P0 = false claim, ship-blocker · P1 = high-value gap · P2 = should fix soon · P3 = polish

---

## Executive summary

The core product loop is real and shipped — sign up → create an agent → ingest knowledge → deploy a web widget, Telegram bot, email mailbox, Slack app, or Twilio SMS number → RAG chat with workflows, escalation, human takeover, analytics, and Stripe billing. Nine of the twelve original gaps are now resolved. Three landing claims remain broader than the implementation: the three unshipped Meta channels (GAP-04), upstream knowledge syncing beyond webpages (GAP-06), and managed private-network model endpoints (GAP-08).

---

## 1. What is actually implemented (verified)

| Area | Status | Evidence |
|---|---|---|
| Auth: Google + email/password, forgot/reset | ✅ | `apps/api/src/routes/auth.ts`, `apps/web/src/app/(auth)/*` |
| Workspace, multi-agent, per-agent access, roles | ✅ | `apps/api/src/routes/agents.ts`, `routes/team.ts` |
| Knowledge: website scrape, file upload (PDF/DOCX/TXT/CSV/MD), re-index, delete | ✅ | `apps/api/src/routes/knowledge.ts`, `apps/scraper/` |
| RAG chat: streaming SSE, source attribution, session history, system prompt | ✅ | `apps/api/src/lib/chat/*`, `apps/widget/src/sse.ts` |
| LLM choice: searchable live AI Gateway language-model catalog (including Meta Llama), with 6 recommended defaults and platform or per-agent Gateway keys | ✅ | `lib/llm/{model-catalog,resolve,gateway-key}.ts`, `components/dashboard/ModelPicker.tsx` |
| Web widget: script tag, Shadow DOM, color/position/welcome, branding hide (Core+) | ✅ | `apps/widget/src/index.ts`, `routes/agent-channels.ts` |
| Telegram channel (bot token → webhook) | ✅ | `routes/agent-channels.ts`, `lib/telegram/*` |
| Email channel (Resend: inbound webhook → conversation → agent auto-reply; operator replies via email) | ✅ | `routes/email.ts`, `lib/email/*`, `routes/agent-channels.ts`, `routes/conversations.ts` |
| Slack channel (signed Events API → DMs/mention threads → agent or Inbox reply) | ✅ | `routes/slack.ts`, `lib/slack/*`, `routes/agent-channels.ts`, `routes/conversations.ts` |
| SMS channel (Twilio: signed inbound webhook → agent or Inbox reply) | ✅ | `routes/sms.ts`, `lib/sms/*`, `routes/agent-channels.ts`, `routes/conversations.ts` |
| Live inbox: realtime, status filters, takeover, operator reply, resolve | ✅ | `apps/web/src/app/dashboard/inbox/page.tsx`, `routes/conversations.ts` |
| Visual workflows (branching graph with 5 conditions → response, resolve, human queue, teammate assignment, or agent routing; ordered-rules fallback) | ✅ | `routes/workflows.ts`, `lib/workflow/*`, `dashboard/agents/[agentId]/escalation/WorkflowGraphEditor.tsx` |
| Skills: memory, scoring (1–5 + summary), web search | ✅ | `routes/skills.ts`, `lib/skills/*` |
| Custom HTTP tools (REST) + 4 read templates + SSRF guard | ✅ | `lib/chat/tools.ts`, `TOOL_TEMPLATES` in `packages/shared/src/index.ts` |
| MCP (Model Context Protocol) — connect to external MCP servers (streamable HTTP + SSE), discover and call their tools during conversations | ✅ | `lib/mcp/*`, `routes/mcp.ts`, `dashboard/agents/[agentId]/mcp/page.tsx` |
| Billing: Stripe checkout/portal, Lite/Core/Max $25/$55/$195, 14-day trial, $0.05 overage | ✅ | `routes/billing.ts`, `packages/shared/src/plans.ts` |
| Copilot (internal team chat over your agents) | ✅ | `routes/copilot.ts`, `apps/web/src/app/dashboard/copilot/page.tsx` |
| Basic usage analytics (conversations, automation rate, tokens, docs/chunks) | ✅ | `routes/agent-usage.ts`, `dashboard/agents/[agentId]/usage/page.tsx` |
| CSAT aggregate (avg + 1–5 distribution) + CSV export of conversations | ✅ | `routes/agent-usage.ts`, `dashboard/agents/[agentId]/usage/page.tsx` |
| Channel reliability: provider diagnostics, delivery health, recent failures | ✅ | `lib/channels/reliability.ts`, `routes/channels.ts`, `dashboard/channels/page.tsx` |
| Channel reliability alerts: configurable consecutive-failure threshold, email/Slack incident and recovery notices | ✅ | `lib/channels/alerts.ts`, `routes/channels.ts`, `dashboard/channels/page.tsx` |
| Product analytics: Mixpanel autocapture and EU-hosted session recording | ✅ | `components/providers/MixpanelAnalytics.tsx`, `docs/product-analytics.md` |

---

## 2. Gap register

### ✅ GAP-01 — "Model Context Protocol" (MCP) — **IMPLEMENTED 2026-08-22**
- **Claim:** Hero pill *"New — Model Context Protocol support"* · Features tab *"MCP connections · live"* · Integrations *"wire up anything custom via MCP…"* + "Read the MCP docs" button · MCP node in the orbit ring.
- **Was:** `grep -rin "mcp"` matched **only** `LandingPage.tsx`. No MCP server/client/doc.
- **Now:** Real MCP client support ships. An agent can connect to any external MCP server over **streamable HTTP** or **HTTP+SSE**, list its tools, and call them mid-conversation (widget, Telegram, and Copilot), with per-server auth (bearer/custom header), SSRF protection, and timeouts.
  - Shared types: `packages/shared/src/mcp.ts`
  - Client/loader: `apps/api/src/lib/mcp/{client,tools,json-schema-to-zod,validate}.ts`
  - Routes (CRUD + connection test): `apps/api/src/routes/mcp.ts`
  - Turn wiring: `lib/chat/turn-tools.ts`, `lib/chat/{agent-turn,copilot-turn,tools}.ts`
  - Dashboard: `apps/web/src/app/dashboard/agents/[agentId]/mcp/page.tsx` + `AgentTabs.tsx`
- **Status:** ✅ Implemented · **Priority:** P0 (resolved)

### ✅ GAP-02 — "First-party connectors" and write actions
- **Claim:** Shopify/Stripe/HubSpot/Notion/Zendesk/Linear/Intercom/Zapier shown as live connectors; demo runs `shopify.orders.refund`, `stripe.customer.update`, *"refunded · customer notified · ticket closed (4.1s)"*.
- **Now (2026-08-23):** the tool gallery ships provider-aware API-token templates for all eight advertised brands. Shopify includes order/transaction lookup and refund-with-notification; Stripe and HubSpot include customer/contact updates; Zendesk includes public resolution + solve; Notion, Linear, and Intercom include lookups; Zapier includes a Catch Hook action. JSON and form-encoded request bodies are supported end-to-end, write tools remain disabled until explicitly enabled, and manual write tests require confirmation.
- **Now, phase 2 (2026-08-24):** the Tools dashboard groups all eight providers into connector cards with available/partial/installed status. One setup and credential step atomically installs every missing provider action, deterministic document ids make retries duplicate-safe, provider-specific setup is host/format validated, and write actions remain disabled for explicit review. Individual templates and fully custom tools remain available.
- **Now, phase 3 (2026-08-24):** Shopify, HubSpot, Zendesk, Notion, Linear, and Intercom support server-configured OAuth installation with one-time, ten-minute state records, encrypted access/refresh-token storage, automatic missing-action installation, and refresh-token rotation before expiry. OAuth is only shown when that provider's client id/secret and the public API callback base are configured. Private-token fallback remains available where provider policy permits it; Stripe uses a restricted key and Zapier uses its Catch Hook URL.
- **Now, shared credential lifecycle:** every provider bundle references one encrypted `workspaces/{workspace}/connectorCredentials/{provider}` record rather than copying a secret into each action. Replacing that credential updates every referencing action, and reconnecting migrates phase-2 bundle actions away from embedded secrets. Connector status returned to the web is masked and Firestore client access remains denied.
- **Status:** ✅ Implemented · **Priority:** P0 (resolved)

### ✅ GAP-03 — Visual "Workflows" builder
- **Claim:** *"Design complex automations, visually… drag-and-drop flows to model triage, escalation, and routing logic"* with a branching node graph.
- **Was:** `lib/workflow/*` was a flat ordered list of **escalation rules** — 5 triggers (`ask_for_human`, `low_confidence`, `bot_replies`, `keyword`, `off_hours`) → single action **`escalate`**.
- **Now, phase 1 (2026-08-23):** those triggers can send an exact response, resolve the conversation, place it in the human queue, assign a specific teammate, or route future turns to another AI agent. Response actions can stop immediately or continue through later matching rules and into the normal AI response. Targets are workspace-verified before storage, routed conversations stay with their destination, and legacy escalation rules remain compatible.
- **Now, phase 2A (2026-08-23):** each agent has a persisted, visual directed graph with Start, condition, and action nodes; explicit Yes/No/Next branches; sequential response actions; an inspector for all phase-1 triggers/actions; auto-layout; pause/resume; and a safe return to ordered rules. Existing rules open as a non-active converted preview and only switch runtimes after explicit activation. The graph executes ahead of the rules fallback with cycle, reachability, target, size, and runtime-step validation.
- **Now, phase 2B (2026-08-24):** nodes can be dragged directly around the canvas with grid-snapped persisted positions. Labeled Yes, No, and Next output handles can be dragged onto condition or action nodes to create or rewire paths, with a live connection preview, connected-port states, drop-target emphasis, and immediate cycle prevention. Keyboard selection, auto-layout, and inspector connection selects remain available as accessible alternatives.
- **Status:** ✅ Implemented · **Priority:** P1 (resolved)

### 🟠 GAP-04 — Channels: "ten channels" — email, Slack, and SMS now ship, 3 channels remain
- **Claim:** FAQ *"Live chat, email, WhatsApp, Messenger, Instagram, SMS, Slack, in-app widgets"* · pricing *"Collaborative inbox for all customer emails"* · *"One agent. Ten channels."*
- **Was:** `ChannelType` was only `'web_widget' | 'telegram'`. Deploy page said *"Email and Slack are on the roadmap."*
- **Now (2026-08-22):** the **email channel ships** — `ChannelType` is `'web_widget' | 'telegram' | 'email'`. Inbound mail (Resend webhook, Svix-verified) is threaded into a conversation, the agent answers via RAG and auto-replies, and operator replies from the inbox send email too. See `routes/email.ts`, `lib/email/{client,parse,svix}.ts`, `routes/agent-channels.ts`, `routes/conversations.ts`, and the Deploy page's email panel.
- **Now, Slack phase 1 (2026-08-24):** an agent can connect an installed Slack bot with an encrypted Bot User OAuth Token and Signing Secret. The signed Events API route rejects replayed/forged requests and bot echoes, handles `message.im` and `app_mention`, keeps channel replies in their originating thread, deduplicates Slack retries through expiring Firestore receipts, and routes generated, workflow, and human Inbox replies back through `chat.postMessage`. The Deploy page provides the generated request URL and exact scopes/event subscriptions.
- **Now, SMS phase 1 (2026-08-24):** an agent can connect an SMS-capable Twilio number using live-verified credentials. The Auth Token is encrypted, inbound form webhooks are checked with Twilio's official signature validator against the exact generated URL, Message SID receipts prevent duplicate replies, and text messages flow through the same RAG/workflow, takeover, and Inbox operator-reply paths. Media-only MMS is intentionally outside phase 1.
- **Still missing:** WhatsApp, Messenger, Instagram. Slack installation is manual-token based; multi-workspace Slack OAuth distribution is a later phase.
- **Status:** 🟠 Partial (web widget + Telegram + email + Slack + SMS ship; 3 channels don't) · **Priority:** P1

### ✅ GAP-05 — Advertised analytics now ship
- **Claim:** *"Resolution rate, CSAT, hand-off causes, confidence trends — all in real time, all exportable."* Hero *"resolution time 00:04.1"* / *"1.8s first reply"*.
- **Was:** only counts existed (total, resolved, automated vs handed-off, tokens, docs/chunks). A per-conversation 1–5 score appeared in the inbox, but no aggregate CSAT and no CSV export.
- **Now (2026-08-22):** `routes/agent-usage.ts` returns an aggregate **CSAT** (average + 1–5 distribution, computed from the scoring skill's per-conversation scores) and exposes **`GET /agents/:agentId/usage/export`** (CSV of the agent's conversations). The Usage page shows an *Avg CSAT* tile, a *CSAT distribution* bar, and an *Export CSV* button. Added the `(agentId, score)` composite index to `firestore.indexes.json`.
- **Now (2026-08-23):** the Usage page also ranks hand-off causes from escalation-rule names and manual takeovers, with counts and percentages.
- **Now (2026-08-23):** newly tracked conversations record first-reply and resolution durations. The Usage page shows transparent averages and sample counts; older conversations without reliable timestamps are excluded.
- **Now (2026-08-23):** every response records a normalized **knowledge confidence** from its strongest retrieval match. Per-agent atomic counters and daily buckets power a 30-day trend, average, and low-confidence rate; conversation-level values are included in CSV exports. The dashboard explicitly distinguishes retrieval support from guaranteed answer correctness.
- **Status:** ✅ Implemented. The hero's exact "1.8s / 00:04.1" values remain illustrative rather than live workspace data. · **Priority:** P1 (resolved)

### 🟠 GAP-06 — Auto-syncing knowledge ships for webpages only
- **Claim:** *"Ayooda auto-syncs with helpdesk articles, docs, and product changes — no more stale answers."*
- **Was:** Ingestion was manual (paste URL / upload) and re-index required `POST /:id/reindex`.
- **Now (2026-08-23):** webpage sources can be refreshed daily, weekly, or monthly from the Knowledge dashboard. The existing internal sweep claims due sources transactionally, launches re-ingestion, prevents duplicate jobs with a one-hour recovery lease, and retries failures with bounded backoff. The dashboard exposes next/last sync state, errors, and a manual **Sync now** action. Uploaded files remain manual because their stored content is immutable; replacing a file requires a new upload.
- **Status:** 🟠 Partial. Scheduled webpage refresh ships, but the broader claim implies live upstream helpdesk/doc/product integrations that are not implemented. Uploaded files also remain manual. · **Priority:** P2

### ✅ GAP-07 — "Test before you ship" sandbox now ships
- **Claim:** *"Use the sandbox — real chat widget, fake traffic — to stress-test every flow."*
- **Was:** "Test agent" deep-linked into **Copilot**, which does not exercise customer escalation behavior and stores internal team threads.
- **Now (2026-08-23):** every agent has a dedicated **Test** tab with a widget-style chat preview, staged knowledge/uncertainty/hand-off scenarios, live retrieval sources and confidence, real escalation-rule evaluation, session reset, and an explicit opt-in for connected tools. Test traffic is stored under per-user `sandboxSessions`, excluded from the inbox, customer analytics, scoring, confidence trends, and conversation quotas, and automatically purged after seven days.
- **Status:** ✅ Implemented · **Priority:** P2 (resolved)

### 🟠 GAP-08 — Bring-your-own LLM / custom endpoint
- **Claim:** *"Claude, GPT, Llama, or your own model"* · *"Custom endpoint: your.company.internal"* · *"Llama 3.3 70B · Meta self-hosted"*.
- **Was:** 6 fixed models used one platform Gateway key. The runtime could decrypt an agent key, but no API or dashboard flow could ever set one.
- **Now (2026-08-23):** workspace owners can add, replace, or remove a per-agent Vercel AI Gateway key from the agent's Security tab. Keys are verified against the authenticated, non-generative credit endpoint before being encrypted with AES-256-GCM; API responses expose only masked status. Customer chat, Copilot, scoring, and memory automatically prefer the agent key and return to the platform fallback when it is removed.
- **Now, phase 2 (2026-08-23):** the agent editor discovers the live Gateway catalog, filters it to language models, and provides search, provider filtering, context size, and per-token pricing. Dynamic selections—including the catalog's Meta Llama models—are verified server-side before storage. The six original models remain recommended defaults and a five-minute server cache plus graceful fallback keeps editing available during Gateway catalog outages.
- **Now, phase 3 (2026-08-24):** owners can connect each agent to a public HTTPS OpenAI-compatible endpoint with a provider API key or explicit keyless mode. Ayooda verifies the configured model through the endpoint's non-generative `/models` response, encrypts the secret, and routes customer chat, Copilot, scoring, and memory through the custom model. Runtime requests are confined to the verified base URL, reject redirects, and re-check DNS to block private-address SSRF; removing the endpoint immediately restores AI Gateway.
- **Still missing:** the literal `your.company.internal` example requires deployment-level private networking/VPC support. The hosted product intentionally accepts only publicly resolvable HTTPS endpoints; a self-hosted Ayooda API can be adapted to reach private inference infrastructure within its own trusted network.
- **Status:** 🟠 Partial (Gateway BYOK, dynamic model/Llama selection, and public OpenAI-compatible/self-hosted endpoints ship; managed private-network connectivity does not) · **Priority:** P2

### ✅ GAP-09 — Security/trust claims grounded in shipped controls
- **Was:** the landing page claimed *"Enterprise-grade encryption, scoped API keys, SSO"*, *"GDPR-compliant"*, and *"Europe-hosted"* without SSO/SAML/OIDC, scoped API keys, formal compliance evidence, or code-enforced EU residency.
- **Now, phase 1 (2026-08-24):** the three trust badges sell controls that are directly enforced in the product: authenticated AES-256-GCM encryption for connector/model credentials, workspace roles plus per-agent editor authorization, and signature verification for inbound Slack, Twilio SMS, and Resend email traffic. The unsupported SSO, GDPR, and EU-hosting guarantees are no longer published.
- **Not advertised:** enterprise SSO and deployment-level regional data-residency controls remain future product opportunities. Formal compliance language should only return with the corresponding operational and legal evidence.
- **Status:** ✅ Marketing gap resolved. Every current public trust claim maps to an enforced control; SSO/residency are not represented as shipped. · **Priority:** P2 (resolved)

### ✅ GAP-10 — Social proof claims reframed around shipped capabilities
- **Was:** *"Trusted by modern support teams at 10,000+ companies"* plus three named testimonials with specific automation figures, none of which had supporting evidence in the repository.
- **Now (2026-08-24):** the unverified company count, customer identities, portraits, quotes, and outcome percentages are no longer published. The same high-value landing-page space now sells demonstrable product capabilities: grounded answers, guarded actions, and context-rich hand-offs, followed by a three-card outcome playbook tied to shipped knowledge retrieval, workflows, escalation rules, and the shared inbox.
- **Status:** ✅ Reframed (sales message retained; unsupported social proof removed) · **Priority:** P1 (resolved)

### ✅ GAP-11 — Landing-page CTAs now have real destinations
- **Was:** "Watch 90-sec demo" / "Watch demo" were inert buttons; "Browse connectors" went directly to signup rather than a catalog; "Read the MCP docs" had no handler; and "Ask Ayooda →" promised an embedded live agent that did not exist.
- **Now (2026-08-24):** both demo actions scroll to the existing scripted support-conversation demo; the integrations actions open new public `/connectors` and `/docs/mcp` resource pages; and the unsupported live-agent promise has been replaced with an honest "Test your own agent" signup path that leads into the shipped isolated sandbox flow. CTA targets live in a single tested `landing-links.ts` map so they cannot silently drift back to placeholders.
- **Status:** ✅ Implemented · **Priority:** P3 (resolved)

### ✅ GAP-12 — End-to-end resolution promise separated from performance claims
- **Was:** the hero and metadata promised a fixed automation outcome without product or customer evidence, while the scripted demo presented an exact resolution time as if it were live benchmark data.
- **Now (2026-08-24):** the hero still makes the commercial promise—*"Resolve routine tickets. Keep your team focused."*—and the metadata still sells end-to-end resolution, but neither asserts a fixed percentage. The animated conversation is explicitly labeled as a representative product walkthrough. Enabled write tools continue to support provider-specific actions, including the illustrated order and ticket flows.
- **Status:** ✅ Reframed (end-to-end capability retained; unsupported benchmark removed) · **Priority:** P2 (resolved)

---

## 3. Current gap priorities

| Order | Item | Status | Priority |
|---|---|---|---|
| 1 | **WhatsApp, Messenger, and Instagram channels** (GAP-04) | 🟠 Five channels ship; three advertised Meta channels remain | P1 |
| 2 | **Upstream knowledge connectors/sync** (GAP-06) | 🟠 Scheduled webpages ship; uploaded files and upstream helpdesk/doc systems remain manual | P2 |
| 3 | **Managed private-network model connectivity** (GAP-08) | 🟠 Public OpenAI-compatible endpoints ship; hosted VPC/private DNS connectivity does not | P2 |
| — | **GAP-01/02/03/05/07/09/10/11/12** | ✅ Resolved | — |

---

## 4. First item — MCP support (DONE)

> On user direction, the first item implemented was **building the missing MCP functionality** (GAP-01) rather than editing the landing page — "we don't need to fix the landing, we need to implement the missing functionality."

### What was built
- **Data model & validation** — `McpServerDef` / auth / transport types in `packages/shared/src/mcp.ts`; input validation in `apps/api/src/lib/mcp/validate.ts`.
- **MCP client** — official `@modelcontextprotocol/sdk` wrapped in `apps/api/src/lib/mcp/client.ts`: streamable-HTTP + SSE transports, per-server headers + bearer/custom-header auth (secrets encrypted), SSRF guard (`assertSafeUrl` reuses the custom-tool blocklist), and hard timeouts.
- **Tool discovery & call** — `apps/api/src/lib/mcp/tools.ts`: lists a server's tools, converts their JSON-Schema `inputSchema` to Zod (`json-schema-to-zod.ts`), namespaces them under the server, and calls them at runtime; failures are per-server non-fatal.
- **API routes** — `apps/api/src/routes/mcp.ts` mounted at `/agents/:agentId/mcp`: list/create/update/delete + `POST /:id/test` (live connection + tool listing).
- **Turn integration** — MCP tools are loaded alongside custom tools and skill tools in `lib/chat/turn-tools.ts` and merged in `runAgentTurn`, so they're available in the web widget, Telegram, and Copilot.
- **Dashboard** — new **MCP** tab (`AgentTabs.tsx` → `dashboard/agents/[agentId]/mcp/page.tsx`) to add/edit/test servers.

### Verification
- `pnpm --filter api typecheck` ✅ · `pnpm --filter web typecheck` ✅ · `pnpm --filter web lint` ✅ · `pnpm --filter api build` ✅
- `bun test` — **285 pass, 0 fail** (incl. new `lib/mcp/*.test.ts` covering the JSON-Schema→Zod converter, validation, and tool helpers).

### Definition of done — met
- GAP-01 is now ✅ Implemented; the "Model Context Protocol support" claim on the landing page is backed by a real, working feature.

### Remaining gap items
GAP-04 (WhatsApp/Messenger/Instagram), GAP-06 (upstream knowledge connectors beyond scheduled webpages), and GAP-08 (managed private-network endpoint connectivity) remain partial. GAP-01/02/03/05/07/09/10/11/12 are resolved. Enterprise SSO and regional controls remain product opportunities, but they are no longer landing-page gaps because the site does not advertise them.

---

## 5. Second item — Email channel (DONE)

> Implemented the **email channel** (GAP-04) with Resend, matching the existing web-widget/Telegram channel pattern.

### What was built
- **Shared** — `ChannelType` now includes `'email'`; `EmailChannelConfig` + `isEmailAddress` in `packages/shared/src/index.ts`.
- **Resend client** — `apps/api/src/lib/email/client.ts`: `sendEmail`, `getReceivedEmail`, and `assertValidApiKey` over the raw REST API (no extra dependency).
- **Parsing & threading** — `apps/api/src/lib/email/parse.ts`: extracts text (plain or HTML-stripped), from/to, subject, and message-id / in-reply-to; derives a stable thread conversation id.
- **Webhook verification** — `apps/api/src/lib/email/svix.ts`: manual Svix v1 HMAC-SHA256 signature check (verified against the Svix reference vector).
- **Inbound route** — `apps/api/src/routes/email.ts` (`POST /email/webhook/:channelId`, public): verify → fetch full email → thread into a conversation → `prepareTurn`/`runAgentTurn` → auto-reply via Resend; escalations send the handoff message; gated/errored workspaces stay silent (no bounce).
- **Connect/disconnect** — `POST/DELETE /agents/:agentId/channels/email` in `routes/agent-channels.ts` (validates the Resend key live, encrypts it, stores the webhook signing secret, returns the webhook URL).
- **Operator replies** — `routes/conversations.ts` now mirrors an inbox reply back out through Resend for `channelType === 'email'`.
- **Dashboard** — the Deploy page (`dashboard/agents/[agentId]/deploy/page.tsx`) gained an Email panel (connect form + webhook URL + disconnect).

### Verification
- `pnpm --filter api typecheck` ✅ · `pnpm --filter web typecheck` ✅ · `pnpm --filter web lint` ✅ · `pnpm --filter api build` ✅
- `bun test` — **299 pass, 0 fail** (added `lib/email/{svix,parse}.test.ts`).

### Definition of done — met
- GAP-04 is now 🟠 Partial (email + widget + Telegram + Slack + SMS ship; WhatsApp/Messenger/Instagram remain).

### Caveat
- No live end-to-end run against a real Resend mailbox was possible from here (no keys/domain in the repo); the connection path is verified by typecheck/build/bundling and unit-tested logic. Smoke-test against a real Resend inbound address before shipping.

---

## 6. Third item — Analytics: CSV export + aggregate CSAT (DONE)

> Implemented the **analytics** piece of GAP-05: aggregate CSAT and CSV export.

### What was built
- **CSAT aggregate** — `routes/agent-usage.ts` now returns `csat: { average, count, distribution: [1..5] }`, computed from the scoring skill's per-conversation scores (`where score >= 1`); degrades to null while the new `(agentId, score)` index builds.
- **CSV export** — `GET /agents/:agentId/usage/export` streams a CSV of the agent's conversations (id, visitor, channel, status, timestamps, score, summary, had_takeover, escalation_reason, last_message), RFC-4180 escaped.
- **Dashboard** — the Usage page (`dashboard/agents/[agentId]/usage/page.tsx`) gained an *Avg CSAT* tile, a *CSAT distribution* bar, and an *Export CSV* button (client-side blob download through the authed API).
- **Index** — added the `(agentId, score)` composite index to `firestore.indexes.json`.

### Verification
- `pnpm --filter api typecheck` ✅ · `pnpm --filter web typecheck` ✅ · `pnpm --filter web lint` ✅ · `pnpm --filter api build` ✅
- `bun test` — **303 pass, 0 fail** (added `routes/agent-usage.test.ts` for `csvCell`).

### Definition of done — met
- GAP-05 is now 🟠 Partial (CSAT + export ship; hand-off causes / confidence trends / timing metrics remain).
