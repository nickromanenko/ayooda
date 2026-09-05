---
article_id: agent-security
title: Agent security and access
slug: agent-security-and-access
category: Security
route: /dashboard/agents/:agentId/security
roles: [owner]
summary: "Control member access and securely configure the model connection through AI Gateway or a custom OpenAI-compatible endpoint."
keywords: [security, agent access, members, AI Gateway, API key, custom endpoint, OpenAI compatible, model connection]
related_articles: [team, agent-info, agent-tools, agent-mcp]
status: published
updated_at: 2026-09-04
---

# Agent security and access

Security controls who can configure this agent and which secure model connection handles its AI activity. Only the workspace owner can manage these settings.

## Member access

Owners always have access and cannot be disabled. Enable access beside a member to let that person see and configure this agent. Creating, deleting, and changing the default agent remain owner actions.

Workspace members can still access the shared Inbox and Copilot, but the agents available to them are constrained by agent access where applicable. Invite a missing person on Team before granting access here. Use least privilege and remove access promptly when responsibilities change.

## AI Gateway key

An agent can use its own Vercel AI Gateway key or the platform key when one is available. The status badge identifies the active or standby source. **Verify & save** checks the authenticated credit endpoint without generating content or spending tokens.

Keys are encrypted at rest and write-only after saving. To change one, paste a replacement. Removing an agent key returns to the platform key when available; otherwise model access is disabled until another valid connection is configured.

## OpenAI-compatible endpoint

A custom endpoint requires a public HTTPS base URL and model ID, plus an API key unless the endpoint is explicitly keyless. Verification reads the endpoint's `/models` response and confirms the model ID without generating content. When active, the custom endpoint overrides AI Gateway for customer chat, Copilot, and background skills; the Gateway configuration remains a fallback for use after removal.

Requests are restricted to the saved base URL. Use an endpoint and credentials intended for this workspace, confirm its data-retention policy, and avoid keyless public endpoints unless they are protected by other trusted controls.

Removing a custom endpoint deletes its stored secret and restores AI Gateway behavior. Removed and replaced secrets cannot be recovered. After any connection change, run a Test conversation and the regression suite before relying on customer traffic.

Tool, MCP, channel, ticket-webhook, and provider credentials are configured on their corresponding pages. Model access here does not grant those external integrations additional permissions.

