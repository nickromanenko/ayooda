---
article_id: agent-mcp
title: MCP servers
slug: mcp-servers
category: Agents
route: /dashboard/agents/:agentId/mcp
roles: [owner, member]
summary: "Connect an agent to remote Model Context Protocol servers, configure transport and authentication, discover tools, and test connections."
keywords: [MCP, Model Context Protocol, streamable HTTP, SSE, remote server, discovered tools, bearer token]
related_articles: [agent-tools, agent-test, agent-security]
status: published
updated_at: 2026-09-04
---

# MCP servers

An MCP server publishes a set of external tools through the Model Context Protocol. When a server is enabled, the agent can discover and call those tools during conversations.

## Add a server

Choose **New server** and provide a recognizable name, a public HTTPS server URL, and one of the supported transports:

- **Streamable HTTP** for the current HTTP transport;
- **HTTP + SSE** for compatible servers that expose server-sent events.

Add required headers and select no authentication, bearer-token authentication, or a custom authentication header. Authentication secrets are stored securely and are not displayed again. When editing, leave the secret blank if the interface indicates the saved secret will be retained. Use **Enabled** to make the server available to the agent.

## Test tool discovery

Select **Test** on a saved server. A successful result lists the tool names and descriptions discovered from the server. Zero tools can be a valid protocol response but usually means the server is not publishing useful capabilities to this client.

If the connection fails, verify the transport, exact endpoint path, TLS certificate, authentication header, token permissions, and whether the remote server is reachable from the public internet.

## Security

Treat every discovered tool as executable integration code. Review the MCP server operator, tool descriptions, data handling, and side effects before enabling it. Prefer least-privilege credentials and a server dedicated to the intended workspace or agent. Deleting or disabling the MCP connection stops future access but does not undo actions already performed by its tools.

