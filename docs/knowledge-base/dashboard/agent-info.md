---
article_id: agent-info
title: Agent identity and model
slug: agent-identity-and-model
category: Agents
route: /dashboard/agents/:agentId
roles: [owner, member]
summary: "Configure an agent's name, image, description, system instructions, model, versions, default status, duplication, and deletion."
keywords: [agent info, identity, logo, photo, system prompt, model, version history, duplicate agent, default agent]
related_articles: [agents, agent-test, agent-security, agent-deploy]
status: published
updated_at: 2026-09-04
---

# Agent identity and model

The Info page defines who the agent is and which model follows its instructions. These settings affect customer channels, Copilot, the Test sandbox, and future conversations after saving.

## Identity

Upload a PNG, JPEG, or WebP image that customers and teammates can recognize. Replace or remove it at any time. If no image is set, Ayooda generates an avatar from the agent's identity.

- **Agent name** identifies the agent in the dashboard and is used as the default customer-facing header title.
- **Short description** explains the agent's purpose to teammates.
- **System prompt** defines personality, scope, tone, constraints, and operating instructions. Be explicit about what the agent should do when knowledge is missing or a request needs a human.

Image changes are saved immediately. Text and model changes remain unsaved until **Save agent** is selected; the page warns before a browser unload when edits are pending.

## Model and secure connection

Choose a model supported by the agent's active model connection. Credentials and custom OpenAI-compatible endpoints are managed on Security. A model ID must exist on the active provider or conversations can fail even if the Info settings save successfully.

After a meaningful change, use **Test agent** and run regression tests before relying on it in production.

## Version history and management

Saved configuration versions can be restored from version history. Restoring preserves the previous current configuration as an undo point.

Owners can **Duplicate agent** when a new agent needs a similar starting configuration. **Make default** changes which agent is initially selected by supported workspace flows; it does not reroute already configured channels. A default agent cannot be deleted. Make another agent the default first, then review the deletion confirmation carefully because deletion cannot be undone.

