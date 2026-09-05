---
article_id: dashboard-overview
title: Dashboard overview
slug: dashboard-overview
category: Dashboard
route: /dashboard
roles: [owner, member]
summary: "Understand workspace activity, launch progress, agent status, and recent conversations from the dashboard overview."
keywords: [overview, dashboard, automation rate, launch checklist, conversations, agents live]
related_articles: [agents, agent-deploy, agent-usage, inbox]
status: published
updated_at: 2026-09-04
---

# Dashboard overview

The Overview page is the workspace's starting point. It summarizes current support activity and shows the most useful next setup step. Values are read from the workspace's agents, knowledge sources, channels, and conversations.

## Launch checklist

The launch checklist follows the default agent and covers five milestones:

1. **Configure identity** — add a recognizable name, purpose, system instructions, and model.
2. **Index trusted knowledge** — make at least one source ready for retrieval.
3. **Pass regression tests** — create tests for important answers and workflow behavior and run them successfully.
4. **Configure human hand-off** — give uncertain or sensitive requests a route to a teammate.
5. **Launch a channel** — connect a customer channel and confirm that it receives real traffic.

A completed check means Ayooda detected the required configuration. It does not guarantee that the configuration is ideal for every customer question. Open a checklist action to review the corresponding agent page.

## Workspace metrics

- **Total conversations** counts customer conversations in the workspace and may show the average number of messages.
- **Automation rate** is the percentage of resolved conversations that finished without a human takeover. It is unavailable until at least one conversation is resolved.
- **Knowledge docs** counts indexed sources and shows the number of searchable chunks.
- **Agents live** compares agents that are deployed to at least one channel with the total number of agents.

Use the per-agent Usage page for deeper outcome, confidence, timing, CSAT, and consumption data. Workspace totals can differ from an individual agent's totals.

## Agent status and recent conversations

**Your agents** shows each agent's indexed-document count, default status, and deployed channels. Select an agent to configure it. **Recent conversations** opens the selected conversation directly in the Inbox.

If an agent says **not deployed**, its configuration still exists and can be tested in the sandbox, but customers cannot reach it through a channel. If metrics are empty, finish the checklist and create test or live traffic; sandbox conversations do not contribute to customer analytics or plan limits.

