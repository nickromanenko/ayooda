---
article_id: agent-tools
title: Agent tools and connectors
slug: agent-tools-and-connectors
category: Agents
route: /dashboard/agents/:agentId/tools
roles: [owner, member]
summary: "Connect provider action bundles or create custom HTTP tools with parameters, headers, authentication, access rules, request bodies, and tests."
keywords: [tools, connectors, API, HTTP action, OAuth, bearer token, headers, request body, CRM, test tool]
related_articles: [agent-mcp, agent-test, agent-security, agent-workflows]
status: published
updated_at: 2026-09-04
---

# Agent tools and connectors

Tools let an agent read from or make changes in an external system during a conversation. Because a tool can have real side effects, its description, inputs, credentials, access mode, and testing need the same care as an integration.

## Connect a provider

**Connect provider** opens a gallery of provider bundles and individual action templates. A bundle installs a complete action set after one setup and credential or OAuth step. If part of a bundle already exists, Ayooda installs only missing actions or updates the connection as indicated.

Templates are starting points. Review every installed action, its permitted operations, and its credentials before using it with customers.

## Create a custom HTTP tool

Choose **New tool** and configure:

- a unique machine-friendly name and a description telling the model when to use it;
- the HTTP method and URL template, with placeholders such as `{orderId}`;
- typed parameters, descriptions, and whether each is required;
- request headers and an optional JSON request-body template for methods that send a body;
- no authentication, a bearer token, or a custom authentication header;
- the tool's access behavior shown in the form.

Placeholders in URLs, headers, and body templates should correspond to defined parameters. Secrets are write-only after saving; leave a secret blank while editing when the interface says the stored value will be kept.

## Test and operate safely

Use **Run test** with safe sample values before saving or enabling production use. A test can call the real endpoint and may cause the same side effects as a live request. Use test accounts, least-privilege credentials, idempotency controls, and narrowly scoped APIs.

The Test sandbox keeps connected tools off by default. Turning them on makes them live. If a tool fails, inspect its rendered URL, required inputs, authentication, provider response, and network availability. Deleting a tool prevents future calls but does not reverse changes already made in the external system.

