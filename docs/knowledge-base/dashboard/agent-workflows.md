---
article_id: agent-workflows
title: Workflows and hand-offs
slug: workflows-and-hand-offs
category: Agents
route: /dashboard/agents/:agentId/escalation
roles: [owner, member]
summary: "Build visual conversation workflows or ordered fallback rules for hand-off, assignment, routing, replies, and resolution."
keywords: [workflows, escalation, hand-off, human queue, low confidence, business hours, route agent, assign teammate, resolve]
related_articles: [inbox, agent-test, agent-tickets, team]
status: published
updated_at: 2026-09-04
---

# Workflows and hand-offs

Workflows decide what happens when a conversation meets specific conditions. They provide predictable paths for human requests, low-confidence answers, business schedules, keywords, routing, assignment, exact replies, and resolution.

## Visual graph

The Graph view connects a start node to condition and action nodes. Add nodes, edit the selected node in the inspector, connect labeled outputs to destinations, and use **Auto-layout** when the canvas becomes difficult to read. Condition nodes have yes and no branches; action nodes either end the path or continue when that action supports continuation.

When ordered rules already exist, Ayooda can present an automatically converted graph as a preview. Customer conversations continue using ordered rules until the graph is saved and activated. Once active, the graph replaces ordered-rule execution. **Return to ordered rules** switches the active engine back.

## Ordered rules fallback

Rules are evaluated in their displayed order. Move a rule up or down to change priority. A rule contains:

- a name and enabled state;
- a trigger such as a human request, keyword match, low knowledge confidence, or scheduled time condition;
- an action such as move to the human queue, assign a teammate, route to another agent, resolve, or send an exact reply;
- an optional customer-facing explanation where supported;
- continuation behavior for reply actions where available.

Routing must target another valid agent; assignment must target a current teammate. Avoid loops between agents and overlapping high-priority rules that produce contradictory outcomes.

## Test before launch

Use the Test page's human hand-off and uncertain-question scenarios, then add regression cases for critical workflow outcomes. The sandbox reports the resulting flow state. A hand-off stops that sandbox conversation until it is reset. In production, waiting conversations appear in the Inbox for a teammate.

