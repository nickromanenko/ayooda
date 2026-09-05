---
article_id: agents
title: Manage agents
slug: manage-agents
category: Agents
route: /dashboard/agents
roles: [owner, member]
summary: "Create, find, and open AI support agents, and understand how agent access and defaults work."
keywords: [agents, create agent, templates, duplicate, default agent, support agent]
related_articles: [agent-info, agent-security, agent-deploy, team]
status: published
updated_at: 2026-09-04
---

# Manage agents

An agent is the container for a support experience. Its identity, instructions, model, knowledge, skills, tools, workflows, ticket behavior, channels, analytics, and access are configured independently.

## Agent list

The Agents page shows the agents available to your account. Select a card to open its Info page and the full agent navigation. The default badge identifies the agent initially selected by features such as the Copilot picker and new channel setup.

Owners can create agents. Members see only agents they have been granted access to. An owner can manage access from an agent's Security page.

## Create an agent

Choose **Create agent**, enter the required identity information, and select the setup offered by the creation dialog. A clear, purpose-specific name and description make the agent easier for teammates to select. After creation:

1. refine the instructions and model on Info;
2. add and index trusted Knowledge;
3. configure safe Workflows and ticket behavior;
4. create regression tests and run a sandbox conversation;
5. deploy a channel only after launch-readiness checks are understood.

Creating another agent does not copy knowledge or channels unless the creation flow explicitly says it is duplicating an existing agent.

## Multiple agents and the default

Use separate agents when audiences, knowledge, behavior, access, or channels need meaningful isolation. Avoid creating multiple agents solely for small wording changes that can be handled by one system prompt or channel configuration.

Only one agent is the workspace default. The default agent cannot be deleted; make another agent the default first. Deleting a non-default agent removes its configuration and cannot be undone, so review its channels and dependencies before deletion.

