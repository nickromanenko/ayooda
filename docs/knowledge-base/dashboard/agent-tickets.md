---
article_id: agent-tickets
title: Support ticket intake
slug: support-ticket-intake
category: Agents
route: /dashboard/agents/:agentId/tickets
roles: [owner, member]
summary: "Configure when an agent creates support tickets, which fields it collects, what happens after submission, and how optional external delivery works."
keywords: [tickets, ticket intake, custom fields, customer confirmation, webhook, support email, signing secret, delivery health]
related_articles: [inbox, agent-workflows, agent-deploy, channel-health]
status: published
updated_at: 2026-09-04
---

# Support ticket intake

Ticket intake lets an agent collect a structured follow-up request. Ayooda always stores a durable ticket linked to its customer and conversation. An optional webhook or support-email destination receives a copy.

## Agent behavior

Enable ticket intake to expose the trusted ticket tool in real customer conversations. The agent should create a ticket only when the customer asks for follow-up, not for every ordinary question.

**Require customer confirmation** is recommended because it lets the customer review the intent before submission. **After submission** can let the agent continue helping or move the conversation to the human queue. Customize the acknowledgement shown after creation and use `{number}` where the generated ticket number should appear.

Changes affect new agent turns after **Save ticket settings**.

## Information to collect

Subject, description, and priority are always collected. Add up to ten custom fields. Each custom field has a customer-facing label, stable field ID, type, agent guidance, required state, and choices when the type is select.

Use stable lowercase field IDs because external systems may depend on them. Guidance should tell the agent how to ask for the value without exposing internal-only instructions. Order fields in the sequence that makes sense for the conversation.

## Delivery destinations

- **Ayooda only** keeps the ticket in the shared Inbox with no external delivery.
- **Webhook** posts signed JSON to a public HTTPS endpoint. Redirects and private network addresses are blocked.
- **Support email** sends through an active email channel. Replies to that email do not synchronize back to Ayooda in the current version.

Webhook requests include an event ID for deduplication and an `X-Ayooda-Signature`. Verify the HMAC-SHA256 signature against `timestamp.raw_body`. The signing secret is displayed only when generated or rotated; copy it immediately and store it securely. Rotation invalidates the previous secret for future deliveries.

## Test and monitor delivery

**Save & send test** uses synthetic data and does not create a ticket or customer. Delivery health reports failed production copies and the latest success. A failed external delivery does not remove the Ayooda ticket. Open affected tickets from the health row, correct the destination, and use event IDs to make webhook retries safe.

