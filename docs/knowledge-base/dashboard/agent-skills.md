---
article_id: agent-skills
title: Agent skills
slug: agent-skills
category: Agents
route: /dashboard/agents/:agentId/skills
roles: [owner, member]
summary: "Enable and configure built-in agent abilities such as memory, web search, and response scoring."
keywords: [skills, memory, retention, web search, results, scoring, rubric, upgrade]
related_articles: [agent-knowledge, agent-test, agent-security, billing]
status: published
updated_at: 2026-09-04
---

# Agent skills

Skills are built-in capabilities that extend how an agent handles a conversation. They are different from Knowledge, custom HTTP Tools, and MCP servers. Enable only capabilities that match the agent's purpose and your data policy.

## Configure a skill

Use the switch on a skill card to enable or disable it. Enabled skills can expose configuration fields:

- **Memory** controls how many days extracted facts are remembered.
- **Web search** controls the maximum number of results per search and lets the agent consult the public web when appropriate.
- **Scoring** accepts an optional custom rubric for evaluating responses.

Numeric fields save after the field loses focus. Use permitted ranges shown by the input. A skill marked **Upgrade to enable** is unavailable on the current plan.

## Choose skills safely

Knowledge should remain the source of truth for company-specific policy. Public web search may be current but is not a substitute for approved internal documentation. Memory can improve continuity, but longer retention increases the amount of user-derived information retained. A scoring rubric should be observable and specific enough to produce consistent results.

After changing a skill, run representative Test conversations. For external or sensitive actions use Tools or MCP with deliberate access restrictions rather than attempting to encode an action as a prompt or skill.

