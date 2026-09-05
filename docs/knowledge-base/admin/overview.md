---
article_id: admin-overview
title: Admin platform overview
slug: admin-overview
category: Administration
route: /admin
roles: [admin]
summary: "Understand platform-wide account, workspace, subscription, and usage metrics."
keywords: [admin, overview, platform metrics, subscriptions, usage]
related_articles: [admin-users, admin-workspaces, admin-audit-log]
status: published
updated_at: 2026-09-05
---

# Admin platform overview

The Admin overview summarizes Ayooda's platform activity without exposing customer conversations, prompts, or stored credentials. Only users with the separate platform administrator role can open this area.

## Metrics

The top cards show total users and workspaces, recent signups, active and trialing subscriptions, past-due subscriptions, current-period conversations, and recorded token usage. These values come from Firestore aggregations and may update shortly after customer activity.

An em dash with **Unavailable right now** means the metric query failed. It does not mean the value is zero. Retry before drawing conclusions from a missing metric.

## Recent activity

Recent users and workspaces help identify new account setup. Open a user or workspace from its corresponding directory for more context. Admin pages intentionally expose operational metadata only; use customer-facing tools and approved support procedures for customer content.

Use **Back to workspace** to leave platform operations and return to your own dashboard.
