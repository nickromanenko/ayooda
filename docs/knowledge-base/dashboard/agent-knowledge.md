---
article_id: agent-knowledge
title: Agent knowledge
slug: agent-knowledge
category: Agents
route: /dashboard/agents/:agentId/knowledge
roles: [owner, member]
summary: "Add website and document sources, monitor indexing readiness, search and filter sources, refresh content, schedule website sync, and resolve errors."
keywords: [knowledge, documents, website, upload, indexing, chunks, reindex, refresh, auto-sync, stale]
related_articles: [agent-test, agent-usage, agent-info]
status: published
updated_at: 2026-09-04
---

# Agent knowledge

Knowledge contains the trusted material this agent can retrieve when answering. Knowledge is isolated per agent. Adding a source to one agent does not make it available to another.

## Add knowledge

Choose **Add knowledge** to index a public website URL or upload a supported document. New content is excluded from answers until indexing finishes, so adding a source cannot immediately introduce partially processed text.

Use source material with clear headings, current facts, and enough context to stand alone. Avoid duplicates and remove obsolete policies rather than expecting the model to decide which conflicting version is correct.

## Health and readiness

The health panel reports the percentage of sources ready and distinguishes:

- **Ready** — indexed and available to retrieval.
- **Indexing** — still processing and not yet available.
- **Needs attention** — failed, empty, or stale.

An empty source means no usable readable text was found. A stale website has not refreshed for more than 30 days. A failed source shows the last indexing or synchronization error and failed-attempt count when available. **Refresh issues** queues affected sources again.

Filter sources by health or search by source name. A source displays its type, status, chunk information, timestamps, and next scheduled sync when applicable.

## Refresh, schedule, and delete

Use **Refresh now** for a website or **Re-index** for an uploaded document. Website sources can synchronize daily, weekly, monthly, or remain manual. The next run is shown after automatic synchronization is enabled.

Deleting a source removes it from this agent and removes its indexed content. Confirm that another source covers any still-current information before deletion.

## Troubleshooting and verification

If a website remains empty, confirm the page is public, contains server-readable text, and is not blocked from automated access. If a document fails, verify its type, size, and readable content, then re-index it. After material changes, ask a representative question in Test and update the regression suite. Knowledge confidence on Usage measures retrieval support, not guaranteed factual correctness.

