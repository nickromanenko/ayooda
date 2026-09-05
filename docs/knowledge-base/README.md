# Ayooda product knowledge base

This directory is the canonical, version-controlled source for Ayooda help articles. The articles describe the product as it behaves today and are written for two future consumers:

1. the Knowledge Base section in the dashboard;
2. the Ayooda support agent's retrieval index.

The Markdown files are the source of truth. A later importer can publish them to a dedicated database collection without changing their prose.

## Article metadata

Every article starts with YAML frontmatter:

```yaml
---
article_id: dashboard-overview
title: Dashboard overview
slug: dashboard-overview
category: Dashboard
route: /dashboard
roles: [owner, member]
summary: "A one-sentence search and listing description."
keywords: [overview, metrics]
related_articles: [agents, inbox]
status: published
updated_at: 2026-09-04
---
```

- `article_id` is the stable database and cross-link identifier. Do not reuse or silently rename it.
- `slug` is the public URL segment for a future help center.
- `route` is the dashboard page the article explains. Dynamic agent routes use `:agentId`.
- `roles` identifies who can use the page. An owner-only article may still be searchable by members if it helps explain why a control is unavailable.
- `summary` should make sense in search results without the article body.
- `keywords` contains product terms and likely user queries, not keyword stuffing.
- `related_articles` contains article IDs, not file paths.
- `status` is `draft`, `published`, or `archived`.
- `updated_at` records the last product-accuracy review.

## Writing rules

- Document the current product, not planned behavior.
- Use the labels shown in the interface so search results match a user's language.
- Explain permissions, side effects, safety concerns, empty states, and recovery steps.
- Never include credentials, signing secrets, private URLs, or customer data.
- Keep headings descriptive because headings will be useful retrieval boundaries.
- Link related concepts by article title only when the prose needs it; the frontmatter supplies machine-readable relationships.

## Dashboard coverage

| Dashboard page | Article |
| --- | --- |
| Overview | [Dashboard overview](dashboard/overview.md) |
| Inbox | [Inbox and conversations](dashboard/inbox.md) |
| Copilot | [Copilot](dashboard/copilot.md) |
| Agents | [Manage agents](dashboard/agents.md) |
| Agent · Info | [Agent identity and model](dashboard/agent-info.md) |
| Agent · Knowledge | [Agent knowledge](dashboard/agent-knowledge.md) |
| Agent · Skills | [Agent skills](dashboard/agent-skills.md) |
| Agent · Tools | [Agent tools and connectors](dashboard/agent-tools.md) |
| Agent · MCP | [MCP servers](dashboard/agent-mcp.md) |
| Agent · Workflows | [Workflows and hand-offs](dashboard/agent-workflows.md) |
| Agent · Tickets | [Support ticket intake](dashboard/agent-tickets.md) |
| Agent · Test | [Test chat and regression suite](dashboard/agent-test.md) |
| Agent · Deploy | [Deploy agents and channels](dashboard/agent-deploy.md) |
| Agent · Usage | [Agent usage and outcomes](dashboard/agent-usage.md) |
| Agent · Security | [Agent security and access](dashboard/agent-security.md) |
| Channel health | [Channel health and alerts](dashboard/channel-health.md) |
| Billing | [Billing and plans](dashboard/billing.md) |
| Team | [Team members and invitations](dashboard/team.md) |
| Settings | [Profile and workspace settings](dashboard/settings.md) |
| Knowledge Base | [Use the dashboard Knowledge Base](dashboard/knowledge-base.md) |

## Database publishing

Published articles are synchronized to the separate `knowledgeBaseArticles` collection. One document represents one article and includes the frontmatter fields plus:

- `bodyMarkdown`: the Markdown body without frontmatter;
- `sourcePath`: the repository-relative path to the file;
- `contentHash`: a hash used to avoid unnecessary re-indexing;
- `publishedAt`, `createdAt`, and `updatedAt`: server timestamps;
- `searchText` or separate search-index metadata as required by the selected search service.

Validate without database access:

```bash
pnpm kb:validate
pnpm kb:import -- --dry-run
```

Publish with Firebase Admin credentials configured:

```bash
pnpm kb:import
```

The importer upserts by `article_id`, validates the complete corpus before writing, and skips unchanged content by `contentHash`. It does not delete or archive missing database records automatically. Database edits are not the authoring workflow: update the Markdown, review it, then republish and re-index the changed article.

