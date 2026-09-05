---
article_id: agent-usage
title: Agent usage and outcomes
slug: agent-usage-and-outcomes
category: Analytics
route: /dashboard/agents/:agentId/usage
roles: [owner, member]
summary: "Interpret an agent's conversations, automation, CSAT, timing, knowledge confidence, hand-offs, tokens, plan share, trends, and CSV export."
keywords: [usage, analytics, automation rate, CSAT, tokens, confidence, hand-offs, response time, resolution time, CSV]
related_articles: [dashboard-overview, inbox, agent-knowledge, billing]
status: published
updated_at: 2026-09-04
---

# Agent usage and outcomes

Usage explains what one agent has handled and how it contributes to workspace consumption. Use **Export CSV** for offline analysis of the available usage data.

## Headline metrics

- **Conversations** is the agent's total, with current-period usage when available.
- **Automation rate** is the share of resolved conversations completed without human takeover.
- **Avg CSAT** and its distribution use customer feedback received for this agent.
- **Tokens used** and **Messages** cover the period since per-agent tracking began; they may not represent the agent's full lifetime.
- **Knowledge docs** and chunks show indexed retrieval material.
- **Avg first reply** and **Avg resolution** use only events for which timing is tracked.
- **Knowledge confidence** summarizes retrieval evidence supporting responses.

A dash or explanatory empty state means there is not enough tracked data. It does not mean zero performance.

## Confidence, outcomes, and hand-offs

The 30-day confidence view shows average retrieval support, the share below the configured threshold, and a trend. Confidence measures supporting retrieval evidence, not guaranteed correctness. Review low-confidence conversations and improve or remove source material as needed.

**How conversations ended** separates automated, handed-off, and still-open conversations. Waiting conversations link to the Inbox. **Hand-off causes** groups the recorded reasons, helping identify missing knowledge, unclear workflows, or requests that should intentionally remain human.

The decision layer at the top converts current metrics and trends into operational recommendations. Validate recommendations against actual conversations before changing production behavior.

## Plan share

**Share of this period's plan** compares this agent's conversations with the workspace allowance and other agents' usage. The cap is shared across the workspace. If the database index needed for the per-agent period figure is still being created, Ayooda reports the value as unavailable rather than as zero. Billing contains the authoritative workspace plan and estimated overage.

Sandbox tests do not enter customer analytics or conversation limits, so use deployed-channel traffic when evaluating production performance.

