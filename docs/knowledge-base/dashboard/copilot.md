---
article_id: copilot
title: Copilot
slug: copilot
category: Conversations
route: /dashboard/copilot
roles: [owner, member]
summary: "Use your team's agents privately for internal questions and create persistent Copilot threads without contacting customers."
keywords: [copilot, internal chat, threads, agent chat, team assistant, private]
related_articles: [agents, agent-knowledge, agent-security, agent-usage]
status: published
updated_at: 2026-09-04
---

# Copilot

Copilot lets a signed-in teammate chat privately with the workspace's agents. It is useful for finding an answer in company knowledge, drafting a response, or checking how an agent reasons without opening a customer conversation.

## Start and manage a thread

Choose an agent in **New thread**, then select **New thread** or send the first message. The response streams into the conversation and supports Markdown. The thread appears in your thread list and remains available after a reload. Select a thread to continue it, or use its delete control to remove it.

Threads belong to the signed-in teammate. They are separate from the customer Inbox and are not delivered to any customer channel. A thread stays associated with the agent selected when it was created.

## Which information Copilot uses

Copilot uses the selected agent's saved identity, system instructions, model, and indexed knowledge. Only knowledge sources that finished indexing are available. Agent access rules still apply: members can use only agents an owner has granted them access to.

Copilot is not the same as the Test sandbox. Use Test to validate workflows, confidence, tool behavior, and regression cases. Use Copilot for ongoing internal work.

## Limits and troubleshooting

Copilot usage is subject to the workspace's service and plan limits. If an expected agent does not appear, ask an owner to grant access on the agent's Security page. If a reply fails, retry after checking that the agent still has a valid model configuration and that the workspace service is active. Loading an older part of a long thread does not resend any messages.

Do not paste secrets or data that your organization does not permit in an AI conversation. An internal thread is private from customers, but it is still workspace data.

