# Raia — Agents & Skills: how it works (analysis for Ayooda)

Source of truth: `/Users/nick/Projects/raiaai/raia-api` (NestJS monorepo, TypeORM + Postgres) and
`/Users/nick/Projects/raiaai/raia-ui` (React 18 + Vite + React Query). `raia-livechat-v2` is out of scope.

---

## 1. The big picture

Raia's central object is an **Agent** — one configurable AI persona that belongs to an
**Organization**. An agent by itself is just: identity + AI config (model/instructions) + a private
**OpenAI vector store** for its documents. Everything else — how the agent can be reached (chat
widget, email, SMS, voice, Slack, Teams, API, MCP), what it can do (functions, web search, calendar,
escalation), and how it is governed (scoring, auditor, memory, data retention) — is attached as a
**Skill**.

Three layers to keep separate in your head:

| Layer | Table | Meaning |
|---|---|---|
| Skill catalogue | `agent_skills` | Global, seeded by migrations. ~24 rows. Never created by users. |
| Skill attachment | `agents_to_agent_skills` | "This agent has this skill", plus its `config` JSONB and `skillIdentifier`. |
| Skill sub-resources | `agent_functions`, `agent_webhooks`, `agent_scraps`, `escalations`, `external_retrievers`, `agent_mcp_integrations`, `agent_api_keys`, … | Rows owned by a specific attachment row. |

The knowledge base is **not** a skill. It is built into the agent (`agents.vectorStoreId` + `files`),
and several skills (Scraping, External Retrievers, Web Search, Packs) feed into or beside it.

---

## 2. Creating an agent

### 2.1 API contract

`POST /agents` → `AgentsController.createAgent` → `AgentsService.createByUser`
(`apps/api/src/agents/controllers/agents.controller.ts:161`, `services/agents.service.ts:481`).

Permission: `ACTION.CREATE_AGENT` on `RESOURCE.ORGANIZATION`.

Body — `CreateAgentBodyDTO` (`agents/dtos/agents.controller.request.dtos.ts:45`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string 1..255 | ✅ | Internal name. **Must be unique inside the organization.** |
| `publicName` | string 1..255 | ✅ | Name shown to end users. |
| `roleId` | uuid | ✅ | FK → `agent_roles` (agent "type"). |
| `organizationId` | uuid | ✅ | Owning org. |
| `description` | string 0..512 | ✅ (may be empty) | Also fed to the model as agent description. |
| `instructions` | string 0..256 000 | optional | System prompt; stored on `agent_ai_configs`, not on the agent. |
| `avatarUrl`, `backgroundUrl` | string | optional | Storage URLs uploaded beforehand. |
| `agentSkillsIds` | uuid[] | ✅ (array required, may be empty) | Skills attached at creation. |
| `agentPacksIds` | uuid[] | ✅ (array required, may be empty) | Instruction packs copied into the agent. |
| `tags` | string[] | optional | Free-form. |
| `files` | `{fileName, storagePath}[]` | ✅ (array required, may be empty) | Pre-uploaded docs to copy into the agent. |
| `restrictDocumentsToOwnerOnly` | boolean | optional | Document visibility policy. |

### 2.2 What `createByUser` actually does (one transaction)

1. `SubscriptionLimitsService.checkIsOrganizationSubscriptionLimitExceeded(AGENT)` — plan gate.
2. `validateAgentName(name, organizationId)` — uniqueness inside the org.
3. Resolve the org's OpenAI credentials (`external_service_api_keys`, type `OPENAI`) — BYO key
   supported per org/agent.
4. **Create an OpenAI vector store** named after the agent → `vectorStoreId`.
5. Create `agent_ai_configs` row with defaults:
   `model = GPT_5_4`, `temperature = 1`, `topP = 1`, `reasoningEffort = LOW`,
   `isFileSearchEnabled = true`, `fileSearchMaxNumResults = 10`, `instructions`,
   `defaultErrorMessage`.
6. Save `agents` row with `status = DRAFT`, `roleId`, `organizationId`, `vectorStoreId`,
   `aiConfigId`, and the skill attachments (`skills: [{skillId}]` cascade → `agents_to_agent_skills`).
7. Copy org-level external service API keys onto the agent (`agents_to_external_service_api_keys`).
8. **`initSkills()`** — seeds default config for the skills that need one (see §4.2).
9. Rename the vector store to the agent id.
10. Create `user_agents` row: creator becomes `OWNER`.
11. `copyFilesToAgent()` — copies each uploaded file to
    `{orgName}/{userId}/agents/{agentId}/{uuid}_{fileName}` in cloud storage and inserts a `files` row
    with `entityType = AGENT_FILE`, `entityId = agentId`. *(Files are copied, not yet embedded.)*
12. `addAgentPacksToAgent()` — copies pack files to the agent and **appends pack instructions** into
    `aiConfig.instructions`, wrapped in `<!-- {pack} pack instruction -->` markers. Fails if the
    combined instructions exceed 256 000 chars.
13. Adds default conversation states.

On any failure the created vector store is deleted (compensating action).

### 2.3 What the UI actually sends

`raia-ui/src/pages/agent/pages/NewAgent/NewAgentForm.tsx` deliberately keeps creation minimal — the
old multi-step wizard is gone. The form collects only:

- **Agent type** (radio over `GET /agent-roles`) → `roleId`
- **Public name** → `publicName`
- **Internal name** → `name` (async-validated against `POST` check-name endpoint, debounced 300 ms)
- **Description** → `description` (with an "Optimize with AI" button hitting the prompt-optimizer)

and then hardcodes the rest:

```ts
agentSkillsIds: defaultSkillIds,   // skills whose systemName ∈ {LIVE_CHAT, SCORING, COPILOT}
agentPacksIds: [], tags: [], files: [], instructions: '', backgroundUrl: ''
```

`defaultSkillIds` is derived client-side by filtering `GET /agent-skills` on those three system names
(mirrors `agent_skills.isDefault = true` in the DB). After creation the user is redirected to the
agent page, where everything else is configured.

Route `RAMP_NEW_AGENT` is wrapped in `RequireOrganizationAdmin`.

### 2.4 Updating an agent

`PUT /agents/:agentId` — `UpdateAgentBodyDTO`: `name`, `publicName`, `description`, `avatarUrl`,
`backgroundUrl`, `tags`, `status`, `conversationStates[]`, `restrictDocumentsToOwnerOnly`.
Notably **instructions and model are NOT here** — they live on the AI-config endpoint
(`PUT /agents/:agentId/ai-config`). Skills are not here either — they have their own endpoints.

Side effects of `updateAgent`: name re-validated if changed; `restrictDocumentsToOwnerOnly` requires
an extra permission check; setting `status = DRAFT` forces `isEmailVerificationRequired = true` on the
chat skill; and the live-chat widget config is republished asynchronously.

Agent statuses: `draft` → `active` / `inactive` (`AGENT_STATUSES`).

### 2.5 Export / import

`POST /agents/:agentId/export` produces a token (`agent_exports`) with flags
`includeInstructions | includeDocuments | includeSettings`; `POST /agents/preview` inspects it and
`POST /agents/import` materialises a new agent from it (requires `roleId`, `name`, `publicName`,
`description`, `instructions`).

---

## 3. Data model & relations

```
organizations
   └─ agents ─────────────────────────────────────────────────────────────┐
        │  name (unique per org), publicName, description, tags, status    │
        │  roleId → agent_roles                                            │
        │  aiConfigId → agent_ai_configs (1:1)                             │
        │  vectorStoreId, overrideVectorStoreId  (OpenAI)                  │
        │  restrictDocumentsToOwnerOnly                                    │
        │                                                                  │
        ├─ user_agents            (users ↔ agent, role: owner/admin/editor/user/copilot_*)
        ├─ user_agent_invitations
        ├─ user_agent_favorites
        ├─ agents_to_agent_packs        → agent_packs   (copy-once: instructions appended + files copied)
        ├─ agents_to_linked_agent_packs → agent_packs   (live link: copiedInstructions + lastSyncedAt)
        ├─ agents_to_external_service_api_keys → external_service_api_keys (OPENAI | VAPI | TWILIO)
        ├─ agent_instructions_versions  (version history of the system prompt)
        ├─ agent_limits (1:1), agent_exports, conversations, resource_consumption_logs
        └─ agents_to_agent_skills ───────────────────────────────────────► agent_skills (catalogue)
               │  skillIdentifier (nullable, globally unique per skill)
               │  config JSONB (union of per-skill config shapes)
               │  status: active | inactive
               ├─ agent_scraps_to_agent_skills_config      → agent_scraps → agent_scraps_to_files → files
               ├─ external_retrievers_to_agent_skill_configs → external_retrievers (Pinecone)
               ├─ escalations_to_agent_skill_config        → escalations
               ├─ agent_skill_config_to_files              → files   (e.g. voice-skill docs)
               ├─ agent_api_keys
               └─ chat_skill_security_keys

files:  storagePath, fileName, size,
        entityType ∈ {agent_file, agent_pack, agent_scrap}, entityId (agent | pack | scrap id),
        vectorStoreFileId, vectorStoreUploadStatus ∈ {processing, done, failed}

agent_functions / agent_webhooks / agent_commands / agent_mcp_integrations → agents (by agentId)
```

Key constraints on `agents_to_agent_skills`:

- unique `(skillId, agentId)` where not deleted — an agent can hold each skill at most once;
- unique `(skillIdentifier, skillId)` where not deleted — a phone number / email address / widget id
  cannot be shared by two agents.

`agent_roles` is a plain lookup table (name + description), seeded with: *AI Assistant, AI Analyst,
AI Support Agent, AI Sales Agent, AI Creative Agent, AI Task Agent*. It is purely descriptive — it
does not alter behaviour.

`agent_ai_configs`: `model`, `temperature`, `topP`, `reasoningEffort`, `instructions` (≤256 000),
`defaultErrorMessage`, `isFileSearchEnabled`, `fileSearchMaxNumResults`, `isCodeInterpreterEnabled`,
`isOutputJsonSchemaEnabled`, `outputJsonSchema`.

---

## 4. Skills

### 4.1 Catalogue (`agent_skills`, seeded by migrations)

`systemName` is the enum the code switches on (`AGENT_SKILL_SYSTEM_NAME`).

| systemName | Name | Purpose | Default? |
|---|---|---|---|
| `LIVE_CHAT` | Live Chat | Embeddable website widget; the biggest config object by far. | ✅ |
| `SCORING` | Scoring | Auto-scores + summarises conversations. | ✅ |
| `COPILOT` | Copilot | In-app chat UI behaviour for internal users. | ✅ |
| `EMAIL` | Email | Send/receive email (Mailgun; per-org verified domains). | |
| `SMS` | SMS | Send/receive SMS (Twilio number). | |
| `VOICE` | Voice | Voice calls via VAPI assistant + phone number. | |
| `MS_TEAMS` | Microsoft Teams | Reply in Teams channels/DMs. | |
| `SLACK` | Slack | Reply to @mentions in mapped Slack channels/DMs. | |
| `API` | API | Expose agent over REST with `agent_api_keys`. | |
| `MCP` | MCP | Agent consumes MCP servers as tools. | |
| `WEBHOOK` | Webhooks | Outbound webhooks (`agent_webhooks`). | |
| `FUNCTION` | Function | Custom tool/function calls (`agent_functions`). | |
| `SCRAPING` | Scraping | Crawl websites into documents (Firecrawl/Apify). | |
| `EXTERNAL_RETRIEVERS` | External Retriever | Query an external Pinecone index at answer time. | |
| `WEB_SEARCH` | Web Search | Web search tool/function. | |
| `CALENDAR` | Calendar | Availability, booking, rescheduling; injects extra instructions. | |
| `ESCALATION` | Escalation | Trigger-phrase escalation to email/SMS/webhook/in-app. | |
| `AUDITOR` | Auditor | Audits conversations for sensitive data / policy violations. | |
| `MEMORY` | Memory | Per-user or per-agent memory with retention duration. | |
| `NOTIFICATIONS` | Notifications | Notify users of agent events. | |
| `AGENT_REPORT` | Report | Scheduled activity reports by email. | |
| `FEEDBACK` | Feedback | Collect/export user feedback for retraining. | |
| `ENHANCED_PROMPTING` | Enhanced Prompting | Rewrites short/vague user prompts with a smaller model. | |
| `DATA_RETENTION` | Data Retention | Retention days + anonymisation of conversations/users. | |

Admin-only CRUD on the catalogue: `POST/PUT/DELETE /agent-skills` requires `SUPER_ADMIN`; a skill
cannot be deleted while any agent uses it. Everyone can `GET /agent-skills`.

### 4.2 Attaching, archiving, detaching

| Action | Endpoint | Service | Permission |
|---|---|---|---|
| List catalogue | `GET /agent-skills` | `AgentSkillsService.findAll` | authenticated |
| Attach | `POST /agents/:agentId/skills` `{skillId}` | `AgentsService.addSkillToAgent` | `ADD_SKILL_TO_AGENT` |
| Archive / restore | `PUT /agents/:agentId/skills/:skillId` `{status}` | `updateSkillInAgent` | `UPDATE_SKILL_IN_AGENT` |
| Detach | `DELETE /agents/:agentId/skills/:skillId` | `deleteSkillFromAgent` | `DELETE_SKILL_FROM_AGENT` |

Notes:

- **Attach** just inserts `agents_to_agent_skills(agentId, skillId)` with `config = null`. The only
  special case is `ENHANCED_PROMPTING`, which is initialised immediately. Everything else stays
  "needs set up" until its own skill endpoint is called.
- At **creation time** `initSkills()` pre-seeds config for `LIVE_CHAT` (`BASE_CHAT_SKILL_CONFIG`,
  `skillIdentifier = agentId`), `SCORING`, `COPILOT`, and touches `API`.
- **Archive** = `status: inactive`. The row and its config survive; the runtime skips inactive skills.
- **Detach** is a soft delete and cascades into `SkillsService.deleteSkillResourcesFromAgent`:
  scraps, escalations, webhooks, functions, MCP integrations, API keys, Slack channel claims are
  removed; a Twilio number is released (if no other agent holds it); a VAPI assistant + phone number
  and voice-skill files are deleted. `isDefault` skills cannot be detached through the public
  endpoint (`CANNOT_DELETE_DEFAULT_AGENT_SKILL`).

### 4.3 Configuring a skill

Each skill owns a controller under its own path and follows the same shape:

```
GET    /{skill}-skill(s)/:agentId     → read config
PUT    /{skill}-skill(s)/:agentId     → create config  (first time)
PATCH  /{skill}-skill(s)/:agentId     → update config  (partial)
```

Controllers: `chat-skills`, `copilot-skills`, `email-skill`, `sms-skills`, `voice-skills`,
`scoring-skills`, `memory-skills`, `notifications-skills`, `web-search-skills`, `feedback-skills`,
`agent-report-skills`, `calendar-skill`, `auditor-skills`, `mcp-skills`, `api-skill`,
`external-retrievers-skills`, `escalations-skills`, `data-retention-skills`,
`enhanced-prompting-skills`, `ms-teams-skills`, plus `chat-skills/buttons`, `copilot-skills/buttons`,
`voice-skills/files`.

Two shared guards (`SkillsValidationService`):

- `validateCreatingConfigurationAndReturn` — the attachment must exist, must not already have
  `config`/`skillIdentifier`, and the requested `skillIdentifier` must not be taken by another agent
  (checked including soft-deleted rows).
- `validateExistingConfigurationAndReturn` — attachment exists, `config` is not null, status is not
  `inactive`. Otherwise `SKILL_DOES_NOT_CONFIGURED` / `SKILL_IS_INACTIVE`.

Writes go through `AgentsToAgentSkillsService.updateSkillConfigurationFully | ...PartiallyAndReturn |
...PartiallyBulk`.

**`skillIdentifier` semantics per skill** — the externally addressable handle:

| Skill | `skillIdentifier` |
|---|---|
| `LIVE_CHAT` | the agent id (widget key) |
| `EMAIL` | the inbound email address |
| `SMS` | the Twilio phone number |
| `VOICE` | the phone number bound to the VAPI assistant |
| others | `null` |

### 4.4 Config shapes (`AgentToAgentSkillConfig` union)

Defined in `apps/api/src/skills/types/agent-to-agent-skills.types.ts`. Highlights:

- **`ChatAgentSkillConfig`** — the largest: titles, suggestions, disclaimer, links, colors, allowed
  `origins`, `whitelistedIps`, `restrictedCountries`, auto-open mode/delay, voice & streaming
  toggles, citations, file upload, business-hours limits (`daysOfWeek`, `chatStartTime`,
  `unavailableDates`), pre-chat forms (`userFields`, `conversationFields` — text/email/phone/select),
  email & phone verification flags, buttons (webhook / prompt / escalation / open-url / end-chat…
  each with appearance conditions), and a nested `uiConfig` (light/dark themes, popup vs sidebar,
  launcher button styling, proactive bubble).
- **`CopilotAgentSkillConfig`** — internal chat UI: voice/streaming/reasoning toggles, citations,
  file upload (incl. "upload to training"), buttons, auto-archive, email/SMS command toggles.
- **`EmailAgentSkillConfig`** — `senderName`, `defaultSubject`, intro, signature, `mode`, auto-archive.
- **`SmsAgentSkillConfig`** — intro, signature, call-forwarding number, auto-archive.
- **`VoiceAgentSkillConfig`** — `vApiAssistantId`, `vApiPhoneNumberId`.
- **`ScoringAgentSkillConfig`** — `scoringPrompt`, `summaryPrompt`.
- **`MemoryAgentSkillConfig`** — `type` (`BY_USER` | `BY_AGENT`), `retentionDuration`.
- **`AgentReportSkillConfig`** — `frequency` (daily/weekly/monthly), `emails[]`.
- **`WebSearchAgentSkillConfig`** — `webSearchServiceType`, `prompt`.
- **`McpAgentSkillConfig`** — `serverDescription`, `toolDescription`.
- **`FeedbackAgentSkillConfig`** — `period`, `autoUpload`, `generationMode`.
- **`DataRetentionAgentSkillConfig`** — `retentionDays`, `anonymizeConversations`,
  `anonymizeConversationUsers`.
- **`MsTeamsAgentSkillConfig`** / **`SlackAgentSkillConfig`** — per-tenant/per-installation opt-in
  lists of teams, channels and users.
- **`EnhancedPromptingAgentSkillConfig`** — `prompt`.
- **`CalendarSkillConfig`**, **`AuditorAgentSkillConfig`**, **`NotificationsAgentSkillConfig`** live
  in their own modules.

### 4.5 Skills UI

Agent page tabs (`pages/agent/pages/Agent/constants.tsx`): **Info, Skills, Train, Usage, Security,
Launch, Report** — filtered by `USER_AGENT_ROLE` (Usage/Security/Report are owner/admin only).

The **Skills** tab is a two-column layout:

- Left — `ListSkills`: one card per attached skill. Cards are chosen by
  `SKILL_CARD[systemName]` and each renders a summary of its config plus an
  **Edit / Archive / Delete** row. Edit navigates to that skill's own page via
  `SKILL_PATH[systemName]` (e.g. `RAMP_AGENT_CHAT_SKILL`). A card shows a **"set up"** badge when its
  config is still missing, and archiving/editing is disabled in that state.
- Right — `ListSkillsToAdd`: the catalogue minus already-attached skills; a "+" button calls
  `POST /agents/:id/skills`.

Each skill then has a dedicated page/route (`pages/agent/routeConfig.tsx`) — ChatSkill, EmailSkill,
SMSSkill, VoiceSkill, ScrapingSkill (+ NewAgentScrap / ScrapViewOrUpdate), FunctionSkill (+ new/edit),
WebhookSkill (+ new/edit), McpSkill (+ NewMcpIntegration / McpIntegrationView), EscalationSkill and
ExternalRetrieversSkill (own nested route configs), SlackSkill (org-admin only), etc.

Data access mirrors this one-folder-per-skill structure:
`raia-ui/src/dataAccess/agent/{hooks,services,models,requestTypes}/{chatSkill,emailSkill,…}` with a
typed response model per skill config and `AgentSkillModel.parseSkillConfig` switching on
`systemName` to instantiate the right model.

---

## 5. Knowledge base

Raia has **four** distinct knowledge channels. Only the first is the "real" vector KB.

### 5.1 Agent documents → OpenAI vector store (primary)

- Every agent owns exactly one vector store, created at agent creation
  (`agents.vectorStoreId`). `overrideVectorStoreId` lets an operator point the agent at a
  different, externally-managed store.
- A document is two-phased:
  1. **Stored** — `files` row with `entityType = AGENT_FILE`, `entityId = agentId`. Upload flow:
     `POST /agent-files/documents/upload-url` (signed URL) → client uploads directly to cloud
     storage → `POST /agent-files/:agentId/files` registers the file.
  2. **Embedded** — `PUT /agent-files/:agentId/files/vector-store` `{fileId}` streams the file into
     the vector store and sets `vectorStoreFileId` + `vectorStoreUploadStatus`
     (`processing → done | failed`). `DELETE …/:fileId/vector-store` removes it.
     In the UI this is a per-document toggle in **Train → Documents**.
- Guards: max **500** files per vector store; duplicate/in-flight uploads rejected; file types
  limited to `SUPPORTED_FILE_SEARCH_TYPES` (pdf, txt, json, md, doc(x), xls(x), csv, rtf, htm(l),
  ppt(x), pages) and the model must be in `FILE_SEARCH_SUPPORTED_MODELS`.
- Other endpoints: paginated list with per-user permission filtering, single/bulk delete, zip &
  email download link, signed URL for a citation's source file, `PUT /agent-files/:agentId/vector-store`
  to **rebuild** the store (creates a new one, clears all `vectorStoreFileId`s, deletes the old),
  `PATCH …/override-vector-store`.
- `agents.restrictDocumentsToOwnerOnly` restricts document visibility to the uploader.

**At answer time** (`libs/openAI/src/services/openAI-messages.response-api.service.ts:249`) the
OpenAI Responses API request gets:

```ts
if (isFileSearchEnabled && vectorStoreId)
  tools.push({ type: 'file_search',
               vector_store_ids: [overrideVectorStoreId || vectorStoreId],
               max_num_results: fileSearchMaxNumResults });
if (isCodeInterpreterEnabled) tools.push({ type: 'code_interpreter', … });
if (functions.some(f => f.name === 'web-search')) tools.push({ type: 'web_search' });
// + one { type: 'mcp', server_url, allowed_tools } per active MCP integration
// + one function tool per agent function / calendar / escalation / auditor / web-search
```

`AgentAIConfigsService.getAgentAIConfigOrFail` assembles that payload: AI config +
`vectorStoreId`/`overrideVectorStoreId` + active functions + MCP integrations + base run instructions
+ linked-pack instructions + skill-derived extra instructions (e.g. the Calendar prompt).

### 5.2 Scraping skill → documents

`agent_scraps` (url, `crawlerType` Firecrawl|Apify, `crawlFormat`, `pageLimit`, `maxDepth`,
`excludeUrls`, `frequency` manual/scheduled, `autoUpload`, `crawlingStatus`, `crawlId`) is attached to
the agent **through the skill row** (`agent_scraps_to_agent_skills_config`), not directly to the agent.

Flow: `POST /agent-scraps` creates the scrap and immediately triggers `crawlUrl`; the crawler calls
back on `/agent-scraps/firecrawl/webhook` or `/agent-scraps/apify/webhook`; `handleCrawlEnding` merges
the crawled pages into a single file (`agent_scraps_to_files`, `entityType = AGENT_SCRAP`). If
`autoUpload` is on, `uploadNewAgentScrapFileToAgent` **flips the file to
`entityType = AGENT_FILE, entityId = agentId` and pushes it into the vector store**, removing the
previous version's embedding first. A cron re-crawls on the configured frequency.

### 5.3 Packs (instruction reuse) — two modes

`agent_packs` = reusable bundle of `instructions` + files, owned by an organization
(`isGlobal`, `isPrivate`, `status`).

- **Copy** (`agents_to_agent_packs`, `POST /agents/:id/packs`): pack instructions are **appended into
  the agent's own `aiConfig.instructions`** with HTML-comment markers, and pack files are copied into
  the agent's file set. One-way, no link back.
- **Link** (`agents_to_linked_agent_packs`): stores `copiedInstructions` + `lastSyncedAt`; pack files
  are still copied to the agent, but the instructions are kept **separate** from the agent's own
  prompt and are concatenated at request time by `getLinkedPacksInstructions`. `hasUpdate` is exposed
  in the UI, with explicit *sync* and *unlink (optionally transferring the text)* actions.

Instruction changes are versioned in `agent_instructions_versions` (with a snapshot of linked packs)
and restorable.

### 5.4 External Retrievers skill (Pinecone) — knowledge *outside* the vector store

`external_retrievers` (name, type, status, `config` JSONB) hang off the skill attachment row.
Pinecone config: `apiKey`, `indexName`, `host`, `namespace`, `fieldName`, `topK`, and either
`isEmbedded: true` or an explicit `{dimensions, model}` embedding pair.

At answer time this is **not** an OpenAI tool: the agent gets a *function* tool whose URL points back
at Raia's `POST /internal-api/external-retrievers/search`, which fans out to every active retriever
for the agent and returns the matched texts. The same search is reachable from the MCP server and the
public prompts API.

Web Search works the same way (`POST /internal-api/agents/:agentId/functions/web-search`), and is
additionally promoted to the native `web_search` tool when the model supports it.

---

## 6. Access control

- **Org level**: `USER_ORGANIZATION_ROLE` (owner/admin/member) gates agent creation and grants blanket
  access to all agents in the org.
- **Agent level**: `user_agents.role` ∈ `owner | admin | editor | user | copilot_user | copilot_admin`,
  plus `status`. Invitations via `POST /agents/:id/invite` (+ resend/delete/accept).
- Every controller method calls `PermissionsService.canOrFail({userId, action, resource, resourceId})`
  with fine-grained actions: `CREATE_AGENT`, `UPDATE_AGENT`, `DELETE_AGENT`, `READ_AGENTS`,
  `ADD_SKILL_TO_AGENT`, `UPDATE_SKILL_IN_AGENT`, `DELETE_SKILL_FROM_AGENT`, `TEST_SKILL_IN_AGENT`,
  `EXPORT_AGENT`, `DOWNLOAD_DOCUMENTS`, `CREATE|UPDATE|DELETE|GET_AGENT_EXTERNAL_RETRIEVER`, …
- Frontend mirrors it: `useTabs` filters agent tabs by `userAgentRole`; some routes are wrapped in
  `RequireOrganizationAdmin`.
- Most user-facing mutations are also wrapped in `@LogAction(...)` audit decorators
  (`USER_CREATE_AGENT`, `USER_ADD_AGENT_SKILL`, `USER_MODIFY_AGENT_SKILL`, …).

---

## 7. Takeaways for Ayooda

Ayooda today is "one agent per account, multiple channels per agent" with Firestore + Pinecone. The
pieces of Raia's design that transfer well:

1. **Three-table skill model.** A global catalogue (`agent_skills`), a join row carrying `config`
   JSONB + `status` + `skillIdentifier`, and skill-owned sub-resources. It makes adding a channel or
   capability a data change plus one controller, not a schema migration on the agent.
2. **Attach ≠ configure.** Attaching is one insert with `config = null`; the UI shows a "set up"
   badge; a validation service refuses to run an unconfigured or archived skill. This is a very cheap
   way to get an honest onboarding checklist.
3. **`skillIdentifier` as a globally unique external handle** (phone number, inbound email, widget
   key) with a partial unique index — solves routing inbound messages back to an agent without a
   separate channels table.
4. **Archive instead of delete**, with detach cascading into external cleanup (release Twilio number,
   delete VAPI assistant, drop Slack claims). Worth copying the explicit
   `deleteSkillResourcesFromAgent` switch rather than relying on FK cascades.
5. **Two-phase documents**: stored ≠ embedded, with an explicit per-file toggle and an
   upload-status enum. Ayooda's scraped-pages + uploads pipeline would benefit from the same
   `entityType/entityId` flip that Raia uses to promote a scraped page into the agent's KB.
6. **Packs, in link mode**, are a genuinely nice idea for shared prompt fragments: keep the copied
   text separate from the agent's own instructions, concatenate at request time, expose `hasUpdate`.
7. **Retrieval-as-a-function** for anything outside the primary vector store (Pinecone namespaces,
   web search) — the LLM calls back into your own internal API, so you keep auth, logging and
   per-agent scoping.

Divergences to be deliberate about: Raia is OpenAI-vector-store-centric (Ayooda uses Pinecone
directly with `text-embedding-004`), is Postgres/TypeORM (Ayooda is Firestore, so the join tables
become sub-collections or a `skills` map on the agent doc), and has a much heavier org/role model
than Ayooda needs today.
