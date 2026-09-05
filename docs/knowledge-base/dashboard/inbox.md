---
article_id: inbox
title: Inbox and conversations
slug: inbox-and-conversations
category: Conversations
route: /dashboard/inbox
roles: [owner, member]
summary: "Find customer conversations, take over from an agent, reply, add internal notes, assign work, resolve conversations, and manage tickets."
keywords: [inbox, conversations, waiting, takeover, assign, reply, internal note, resolved, tickets, unread]
related_articles: [agent-workflows, agent-tickets, team, channel-health]
status: published
updated_at: 2026-09-04
---

# Inbox and conversations

The Inbox is the shared workspace for customer conversations from deployed channels. It updates as new activity arrives and keeps agent replies, customer messages, operator replies, internal notes, assignments, escalation details, and ticket context together.

## Find a conversation

Search conversation content or use status filters:

- **Unread** needs a teammate's attention.
- **Mine** is assigned to you.
- **Tickets** has structured support-ticket activity.
- **Waiting** was moved to the human queue but has not been taken over.
- **Human** is currently controlled by a teammate.
- **Bot** is currently controlled by the agent.
- **Resolved** is complete.

You can also filter by agent. **Load older** retrieves earlier conversations or messages when pagination is available. Clear the search and filters if an expected conversation is missing.

## Conversation states

**Bot** means the agent can continue responding. **Waiting** means a workflow requested human attention. **Human** means a teammate has taken control. **Resolved** closes the active support flow.

Choose **Take over** to move an unresolved conversation to human control before replying. Resolve a conversation when no further action is expected. A later customer message may create new activity according to the channel behavior.

## Reply, note, assign, and review context

When a conversation is in human control, use **Reply** to send a message to the customer. Replies are delivered through the original channel. Delivery problems appear in the conversation or Channel health.

Use **Internal note** for private teammate context. Notes are stored in the timeline but are never sent to the customer. Check the composer mode before sending sensitive information.

Use the assignment control to give the conversation to a workspace member. Assignment identifies responsibility; it does not automatically send the assignee a customer-visible message. Customer details expose the known visitor identity and channel metadata. Guest visitors may have limited identity data.

Agent messages render supported Markdown such as paragraphs, headings, emphasis, lists, links, and code. Customer messages are displayed as customer-authored text.

## Tickets

If the agent created a support ticket, the ticket panel contains its number, priority, status, collected fields, delivery state, and related conversation. External webhook or email delivery is a copy; Ayooda keeps the durable ticket record. Use the **Tickets** filter to find affected records, including delivery failures.

## Troubleshooting

- If a reply control is unavailable, take over the conversation first or verify that it is not resolved.
- If a customer reply fails, inspect the conversation error and Channel health before retrying.
- If live updates stop, use **Retry**; existing conversations are not changed by reloading.
- If a member cannot see an agent's conversations, an owner should review that agent's Security access.

