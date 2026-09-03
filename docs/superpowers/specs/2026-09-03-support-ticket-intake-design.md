# Ayooda — Support Ticket Intake & Delivery — Design Spec

**Date:** 2026-09-03
**Status:** Implemented (v1)
**Scope:** Let an agent collect a structured support request during a customer conversation, create a durable ticket inside Ayooda, and optionally deliver that ticket to a customer-owned webhook or support email address. Ayooda remains the source of truth if external delivery is unavailable. Native helpdesk connectors and bidirectional synchronization are follow-up work.

## Background

Ayooda already stores customer conversations, supports automated hand-off into a shared waiting queue, lets teammates take over and reply, and can execute opt-in HTTP write tools. Those pieces do not yet form a reliable ticket-intake product:

- a waiting conversation is an operational queue item, not a structured support ticket;
- a model-selected write tool is not a durable guarantee that every accepted request was recorded;
- a webhook failure can otherwise lose the customer's request;
- there is no ticket number, ticket lifecycle, structured intake schema, or delivery history;
- external helpdesks need retry, signing, idempotency, and observable delivery state.

This project introduces an Ayooda-owned ticket record and treats webhook/email integration as delivery from that record, not as the record itself.

## Goals

1. Let an owner enable ticket intake for an individual agent.
2. Let the agent ask for configured required information before submission.
3. Require clear customer intent and, by default, explicit confirmation before creating a ticket.
4. Persist a ticket atomically and idempotently inside Ayooda.
5. Make tickets usable from the existing Inbox without requiring an external system.
6. Optionally deliver a ticket through a signed outbound webhook or support email.
7. Preserve and expose delivery failures with automatic retry and manual resend.
8. Keep tenant data, credentials, and customer PII isolated and protected.

## Non-goals

- Replacing a full ITSM/helpdesk product.
- Native Zendesk, Intercom, Freshdesk, Salesforce, Jira, or ServiceNow OAuth integrations in v1.
- Bidirectional status/comment synchronization with external systems in v1.
- Arbitrary customer-authored code or payload templates.
- Multiple tickets from one conversation in v1.
- Attachments, SLA policies, approval chains, or custom ticket-status workflows in v1.
- Creating a ticket for every conversation automatically.

## Product decisions

| Decision | Choice |
|---|---|
| Source of truth | **Ayooda ticket first.** External delivery never owns the only copy. |
| Scope | Ticket intake configuration is **per agent**. Tickets belong to the workspace. |
| Creation mechanism | A trusted built-in `submit_support_ticket` tool, exposed only when ticket intake is enabled. |
| Ticket cardinality | At most **one ticket per conversation** in v1. Repeated submission returns the existing ticket. |
| Default destination | Ayooda Inbox. An external destination is optional. |
| External destinations | One optional **webhook** or **support email** destination per agent in v1. |
| Confirmation | Required by default; owners may disable it. |
| Delivery | Asynchronous outbox with retry. Ticket creation succeeds even if delivery fails. |
| Workflow interaction | Ticket creation does not automatically hand off. The owner chooses whether successful submission keeps the bot active or moves the conversation to `waiting`. |
| External acknowledgement | A webhook may return an external id and URL, which Ayooda records. |

---

## 1. Customer experience

### 1.1 Recognizing a ticket request

When ticket intake is enabled, the agent receives a built-in `submit_support_ticket` tool plus system guidance describing:

- when to offer ticket creation;
- the configured intake fields;
- which fields are required;
- whether customer confirmation is required;
- that ticket creation must not be claimed until the tool succeeds.

The model may offer a ticket when the customer explicitly asks to report a problem, requests follow-up, or cannot resolve the issue in chat. It must not silently convert ordinary questions into tickets.

### 1.2 Collecting information

The agent collects missing required values conversationally. Standard fields are always available:

- `subject` — required, 1–160 characters;
- `description` — required, 1–4,000 characters;
- `priority` — `low | normal | high | urgent`, default `normal`;
- customer `name`, `email`, and `phone` when available from the channel or conversation.

Owners may configure up to 10 custom fields:

```ts
type TicketFieldType = 'text' | 'long_text' | 'number' | 'boolean' | 'select'

interface TicketIntakeField {
  id: string                 // stable slug; immutable after first use
  label: string              // 1–60 chars
  description: string        // instruction for the agent, <= 240 chars
  type: TicketFieldType
  required: boolean
  options?: string[]         // select only; 1–20 unique values
}
```

The agent should ask only for information that is missing and relevant. It must not ask for secrets, passwords, full payment-card details, authentication codes, or other prohibited credentials. Field descriptions are owner-provided instructions, not authorization to collect sensitive data.

### 1.3 Confirmation

With confirmation enabled, the agent summarizes the proposed ticket and asks the customer to confirm. The built-in tool receives `customerConfirmed: true`; the API rejects a submission without it.

Example:

> I can submit this to the support team with the subject “Unable to sign in” and your contact email jane@example.com. Should I create the ticket?

After creation, the agent responds with the Ayooda ticket number and the configured acknowledgement message. It must not promise successful delivery to an external system unless that delivery has already completed.

### 1.4 After submission

The configuration controls one of two outcomes:

- `continue` — the agent confirms the ticket and may continue helping;
- `handoff` — the conversation moves to `waiting`, the bot becomes silent under the existing conversation guard, and the acknowledgement doubles as the hand-off message.

If the same conversation asks to submit again, the tool returns the existing ticket instead of creating a duplicate. The agent tells the customer that the request is already recorded.

---

## 2. Data model

### 2.1 Agent ticket-intake configuration

Document: `workspaces/{workspaceId}/agents/{agentId}/settings/ticketing`

```ts
interface TicketingConfig {
  enabled: boolean
  requireConfirmation: boolean       // default true
  afterSubmission: 'continue' | 'handoff'
  acknowledgementMessage: string     // <= 500 chars
  fields: TicketIntakeField[]         // <= 10
  destination:
    | { type: 'internal' }
    | { type: 'webhook'; url: string; signingSecretEnc: string }
    | { type: 'email'; address: string }
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

API responses never return `signingSecretEnc`. They return `hasSigningSecret: boolean`. A new signing secret is generated server-side, displayed once, encrypted with the existing API-key encryption facility, and can be rotated by the owner.

### 2.2 Tickets

Collection: `workspaces/{workspaceId}/tickets/{ticketId}`

```ts
type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

interface SupportTicket {
  number: number                    // workspace-scoped, human-readable sequence
  workspaceId: string              // repeated only if required by collection-group jobs
  agentId: string
  conversationId: string
  channelId: string | null
  channelType: ChannelType | null
  status: TicketStatus
  priority: TicketPriority
  subject: string
  description: string
  fields: Record<string, string | number | boolean>
  customer: {
    name: string | null
    email: string | null
    phone: string | null
    visitorId: string | null
  }
  assigneeUid: string | null
  transcriptMessageCount: number
  deliveryState: 'not_configured' | 'pending' | 'delivered' | 'failed'
  externalId: string | null
  externalUrl: string | null
  createdAt: Timestamp
  createdBy: 'agent' | 'operator'
  updatedAt: Timestamp
  resolvedAt?: Timestamp
}
```

The ticket stores structured data and references the conversation; it does not duplicate the entire transcript. Webhook/email delivery builds a bounded transcript snapshot at delivery time.

The conversation gains:

```ts
ticketId?: string
ticketNumber?: number
```

These fields make ticket lookup and one-ticket-per-conversation enforcement cheap.

### 2.3 Workspace sequence

Document: `workspaces/{workspaceId}/counters/tickets`

```ts
{ nextNumber: number }
```

Ticket creation uses a Firestore transaction to increment the sequence, create the ticket, set the conversation's `ticketId`/`ticketNumber`, and—when an external destination is configured—create an outbox record. If `conversation.ticketId` already exists, the transaction returns that ticket without incrementing the sequence.

### 2.4 Delivery outbox

Collection: `workspaces/{workspaceId}/ticketDeliveries/{deliveryId}`

```ts
interface TicketDelivery {
  eventId: string
  ticketId: string
  event: 'ticket.created'
  payload: TicketCreatedEvent        // immutable, bounded event created with the ticket
  payloadSha256: string
  destinationType: 'webhook' | 'email'
  status: 'pending' | 'processing' | 'delivered' | 'failed'
  attemptCount: number
  nextAttemptAt: Timestamp
  lastAttemptAt?: Timestamp
  deliveredAt?: Timestamp
  responseStatus?: number
  safeError?: string
  leaseExpiresAt?: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

The outbox document is API-only and contains the immutable bounded payload required for at-least-once delivery. List/detail APIs expose only delivery diagnostics, never `payload`. No destination secret or raw response body is written into delivery records. Each attempt resolves the agent's current destination configuration; correcting a URL, email address, or signing secret therefore applies to pending retries without rewriting the ticket or event.

---

## 3. Trusted ticket tool

Add a built-in tool in the chat preparation path when `TicketingConfig.enabled === true`:

```ts
submit_support_ticket({
  subject,
  description,
  priority,
  customerConfirmed,
  fields
})
```

This is implemented separately from owner-configured HTTP tools. It calls a trusted internal ticket service directly and cannot select arbitrary URLs or credentials.

Server validation:

1. Confirm the workspace, agent, and conversation match the authenticated turn context.
2. Re-read the current ticketing configuration.
3. Enforce confirmation when configured.
4. Validate standard and custom fields, types, choices, lengths, and required values.
5. Reject unknown custom field ids.
6. Sanitize customer identity from channel-owned conversation metadata; do not trust model-supplied identity over known channel data.
7. Run the idempotent Firestore transaction described in §2.3.
8. Return only safe ticket details:

```ts
{
  created: boolean
  ticketId: string
  ticketNumber: number
  status: 'open'
  deliveryState: SupportTicket['deliveryState']
}
```

The tool result becomes model context, allowing the agent to acknowledge the correct number. Tool failure produces a clear retryable response; the agent must say the ticket was not created.

### Operator-created tickets

Inbox operators may also create a ticket from a conversation. `POST /conversations/:conversationId/ticket` calls the same service with `createdBy: 'operator'`. Confirmation is not required for an authenticated teammate, but all field validation and idempotency rules still apply.

---

## 4. Delivery behavior

### 4.1 Internal

Every created ticket is immediately available in Ayooda, regardless of destination configuration. `deliveryState` is `not_configured` when the destination is internal-only.

### 4.2 Outbound webhook

Ayooda sends an HTTPS `POST` with a stable envelope:

```json
{
  "id": "evt_01J...",
  "type": "ticket.created",
  "createdAt": "2026-09-03T12:00:00.000Z",
  "data": {
    "ticket": {
      "id": "abc123",
      "number": 1042,
      "status": "open",
      "priority": "normal",
      "subject": "Unable to sign in",
      "description": "Password reset completes but sign-in still fails.",
      "fields": { "accountId": "A-42" },
      "customer": { "name": "Jane Smith", "email": "jane@example.com", "phone": null },
      "agent": { "id": "agent_123", "name": "Kim" },
      "conversation": {
        "id": "conv_456",
        "channel": "web_widget",
        "dashboardUrl": "https://app.ayooda.live/dashboard/inbox?conversation=conv_456",
        "messages": []
      }
    }
  }
}
```

`messages` contains at most the latest 100 messages and at most 128 KB of serialized transcript data. Each entry contains `role`, `content`, and `createdAt`; internal notes and message metadata are excluded.

Headers:

```text
Content-Type: application/json
User-Agent: Ayooda-Webhooks/1.0
X-Ayooda-Event: ticket.created
X-Ayooda-Event-Id: evt_01J...
X-Ayooda-Timestamp: 1788436800
X-Ayooda-Signature: v1=<hex HMAC-SHA256>
```

The signature input is `<timestamp>.<raw request body>`. Reject destination URLs that are not HTTPS or that resolve to loopback, link-local, private, metadata, or otherwise blocked addresses. Reuse the existing SSRF address policy, but share the networking primitive rather than invoking a model-configured tool.

Any `2xx` response marks delivery successful. A JSON response may optionally contain:

```json
{ "externalId": "ZD-123", "externalUrl": "https://helpdesk.example/tickets/123" }
```

Both values are length- and URL-validated before storage. Response bodies are otherwise discarded.

### 4.3 Support email

Email delivery sends a plain-text and HTML version containing the ticket number, structured fields, customer identity, a bounded transcript, and a deep link to Ayooda. The subject is:

```text
[Ayooda #1042] Unable to sign in
```

The configured address is the recipient. Replies do not synchronize to Ayooda in v1. The settings UI must say this explicitly.

### 4.4 Retry and leasing

Ticket creation performs one best-effort asynchronous dispatch after the transaction. A scheduled worker processes remaining outbox records using a lease to prevent duplicate workers.

Retry schedule: immediately, 1 minute, 5 minutes, 30 minutes, 2 hours, and 12 hours. After six failed attempts, status becomes `failed`. Timeouts, network failures, `408`, `425`, `429`, and `5xx` retry. Other `4xx` responses fail permanently after the first attempt because configuration or payload is invalid.

Delivery is at-least-once. Consumers must deduplicate with `X-Ayooda-Event-Id`. The same event id and body are reused on every attempt.

The existing authenticated internal sweep endpoint may schedule this processor initially. The delivery function itself remains isolated so it can move to Cloud Tasks or another queue without changing ticket creation.

---

## 5. API

All routes require authentication. Configuration and delivery mutation require owner access; ticket operations follow existing Inbox permissions.

### Agent configuration

- `GET /agents/:agentId/ticketing` — safe configuration plus destination health; owner only.
- `PUT /agents/:agentId/ticketing` — validate and replace configuration; owner only.
- `POST /agents/:agentId/ticketing/secret/rotate` — generate a new webhook signing secret and return it once; owner only.
- `POST /agents/:agentId/ticketing/test` — send a synthetic, clearly labelled test payload; owner only. It does not create a ticket.

Changing from webhook to another destination removes the encrypted signing secret. Disabling ticket intake does not delete existing tickets.

### Tickets

- `GET /tickets?status=&priority=&agentId=&assignee=&search=` — workspace ticket list, newest first, cursor-paginated.
- `GET /tickets/:id` — ticket plus safe delivery summary and referenced conversation identity.
- `PATCH /tickets/:id` — update status, priority, or assignee.
- `POST /tickets/:id/resend` — owner-only; create a new delivery attempt using the existing event id when the previous delivery is failed.
- `POST /conversations/:conversationId/ticket` — operator-created ticket using the shared creation service.

Search covers ticket number, subject, description, customer name/email, external id, and configured text fields. The API caps page size at 50.

---

## 6. Dashboard UX

### 6.1 Agent → Tickets settings

Add a **Tickets** agent tab containing:

1. **Enable ticket intake** toggle and short behavioral explanation.
2. **Agent behavior:** require confirmation, continue vs hand off, acknowledgement message.
3. **Information to collect:** fixed standard fields plus reorderable custom fields, required toggles, select options, and validation guidance.
4. **Delivery:**
   - Keep in Ayooda;
   - Webhook URL, signing-secret state, rotate/copy flow, payload preview, and Send test;
   - Support email address and Send test.
5. **Delivery health:** last successful delivery, current failures, and a direct link to affected tickets.

Unsaved-change protection follows the existing agent settings behavior. Secret rotation requires confirmation because the previous secret stops validating new events immediately.

### 6.2 Inbox

Extend the Inbox with a **Tickets** view/filter rather than adding another primary navigation destination in v1. Ticket rows show:

- ticket number and subject;
- customer;
- priority and status;
- agent and assignee;
- external-delivery status;
- last update time.

Opening a ticket uses the existing conversation transcript with a structured ticket panel. Operators can change status, priority, and assignee, open the external ticket when available, and retry failed delivery when authorized.

Conversation rows with a ticket show a compact `#1042` badge. Creating a ticket manually is available in the conversation action menu and is disabled when a ticket already exists.

### 6.3 Attention center and global search

- Failed ticket deliveries appear in **Needs attention** with a deep link to the ticket.
- Open tickets are searchable by number, subject, customer, and external id from global dashboard search.
- A newly created ticket does not appear as an attention item merely for being open; attention is reserved for delivery failure or a separately configured queue/SLA feature.

### 6.4 States and accessibility

- Loading uses stable skeleton rows; no layout shift.
- Empty states distinguish “ticket intake is not configured” from “no tickets yet.”
- Errors preserve already loaded ticket data and offer retry.
- All controls meet existing 40 px desktop / 44 px mobile targets.
- Dialogs trap and restore focus; Escape closes non-destructive dialogs.
- Dynamic counts use tabular numerals and status is not communicated by color alone.

---

## 7. Permissions and security

- Owners configure destinations, rotate secrets, send tests, view delivery diagnostics, and retry delivery.
- Members can view and operate tickets through the same workspace/agent-access rules as the Inbox, but cannot see destination configuration or delivery response details.
- Every ticket and delivery query is scoped by authenticated `workspaceId`; ids never authorize access by themselves.
- Webhook secrets, connector credentials, and raw authorization headers are never returned or logged.
- Delivery errors pass through a redaction function before persistence.
- External URLs open with safe link attributes and are restricted to `https:`.
- Payload previews use synthetic data, never a real customer transcript.
- Customer-visible messages must not expose webhook failures, endpoint URLs, stack traces, or external credentials.
- Firestore rules explicitly deny direct client access to ticketing settings, tickets, deliveries, and counters; access remains API-only.
- Ticket deletion/retention follows workspace conversation-retention policy. Deleting a conversation with a referenced ticket must either delete both or retain a redacted audit stub according to the final retention policy; implementation must not leave an unrestricted orphan.

## 8. Reliability and observability

Record metrics without customer content:

- tickets created by agent/operator;
- duplicate submission prevented;
- ticket creation validation failure;
- delivery attempt/success/failure by destination type;
- delivery latency;
- permanently failed deliveries;
- manual resends.

Tracing may include workspace, agent, ticket, event, attempt number, status, and duration, but never ticket text, customer contact data, webhook secrets, or response bodies.

The ticket transaction is the success boundary presented to the customer. External delivery is an independently observable asynchronous state.

## 9. Billing and limits

- Ticket creation does not increment conversation count; the underlying customer conversation is already metered.
- The built-in ticket tool runs inside the existing LLM turn and adds no separate model charge beyond that turn.
- v1 applies safety limits of 10 custom fields, one ticket per conversation, a 128 KB outbound transcript, and six delivery attempts.
- Plan-based ticket or integration limits are deferred until pricing explicitly includes them. The UI must not imply a paid entitlement that is not enforced server-side.

## 10. Error handling

| Failure | Behavior |
|---|---|
| Missing required field | Tool returns a structured validation error; agent asks only for the missing information. |
| Confirmation missing | No ticket is created; agent asks for confirmation. |
| Duplicate call | Return the existing ticket and `created: false`. |
| Firestore transaction failure | Agent states that submission failed and offers to retry; no success claim. |
| Webhook/email failure | Ticket remains created; delivery retries asynchronously and is visible to operators. |
| Permanently invalid endpoint | Delivery fails once, owner sees configuration guidance and can test after editing. |
| Destination changed during retry | The next attempt uses the current destination and signing secret. The stored event id and immutable payload remain stable; the dashboard makes this retry behavior explicit. |
| Conversation is already resolved | Operator creation requires reopening; agent creation is rejected by the existing silence guard. |
| External response contains unsafe URL | Store the external id if valid; discard the URL. |

## 11. Testing and verification

### Unit tests

- Ticket configuration and custom-field validation, including duplicate ids and select options.
- Tool argument validation, confirmation enforcement, and known-identity precedence.
- Idempotent ticket transaction and sequence allocation under concurrent duplicate calls.
- Webhook payload bounds and exclusion of internal notes/metadata.
- HMAC signing against fixed vectors.
- URL/DNS SSRF rejection and redirect refusal.
- Retry classification, schedule, maximum attempts, and lease expiry.
- External response validation and error redaction.

### API integration tests

- Owner can configure/rotate/test; member cannot.
- Workspace and agent isolation on every route.
- Agent and operator creation call the same service and produce one ticket.
- Ticket query/filter/search pagination.
- Status/priority/assignee updates respect Inbox permissions.
- Failed delivery can be retried without producing a second ticket or event id.

### Web tests

- Settings disclose what is stored, what is sent, and that email replies do not sync.
- Required/optional field editor remains accessible on keyboard and mobile.
- Secret is displayed once and masked afterward.
- Inbox ticket badges, filters, structured panel, delivery status, and retry states.
- Attention-center and global-search deep links resolve the correct ticket.

### Live end-to-end

1. Enable ticket intake with confirmation and one required custom field.
2. Ask the widget agent to open a request; verify it asks for the field and confirmation.
3. Confirm; verify exactly one Ayooda ticket and one outbox record are created and the customer receives the correct ticket number.
4. Repeat the request in the same conversation; verify the existing ticket is returned.
5. Deliver to a signed test webhook; verify signature, event id, bounded transcript, and external id/URL capture.
6. Force `500` and timeout responses; verify retry timing, no duplicate ticket, and dashboard failure visibility.
7. Configure `handoff`; verify the conversation moves to `waiting` only after ticket creation succeeds.
8. Repeat through email, Slack, Telegram, SMS, and web-widget conversations to verify normalized customer identity.

## 12. Rollout

1. Deploy data types, validators, ticket service, and API routes behind `TICKETING_ENABLED=false`.
2. Deploy settings and Inbox UI hidden behind the same server-controlled flag.
3. Enable for internal/test workspaces; run live webhook and email verification.
4. Enable for a small workspace cohort while monitoring creation failures, duplicate prevention, and delivery latency.
5. Enable generally; retain a kill switch for external delivery without disabling internal ticket creation.

No backfill is required. Existing waiting conversations remain conversations and are not automatically converted into tickets.

## Follow-up phases

### Phase 2 — native destinations

Add OAuth-backed Zendesk, Intercom, Freshdesk, Jira Service Management, Linear, and Salesforce connectors. Each implements the same ticket-delivery interface and stores `externalId`/`externalUrl`; ticket creation and Inbox UX remain unchanged.

### Phase 3 — bidirectional synchronization

Add provider callbacks or polling for external status, assignment, and comments. Use provider event ids plus per-ticket cursors to prevent loops. Generic webhook customers receive an authenticated inbound API for status updates.

### Phase 4 — advanced intake

Multiple tickets per conversation, attachments, conditional field schemas, ticket templates, automatic categorization, SLA policies, approval workflows, and ticket analytics.

## Acceptance criteria

- An enabled agent can conversationally collect all required fields and create a ticket only after required confirmation.
- Ticket creation is atomic, workspace-isolated, and idempotent under concurrent duplicate calls.
- The customer receives a real Ayooda ticket number only after persistence succeeds.
- Every ticket is usable in Ayooda even with no external destination or during destination outage.
- Webhook/email failures never lose or duplicate the ticket and are visible with retry controls.
- Webhook delivery is HTTPS-only, SSRF-protected, HMAC-signed, bounded, and at-least-once with a stable event id.
- Owners can configure and test delivery without exposing stored secrets or real customer data.
- Members can operate tickets but cannot access destination credentials or owner-only diagnostics.
- Ticket state is discoverable in Inbox, global search, and the attention center where appropriate.
