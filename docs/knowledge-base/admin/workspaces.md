---
article_id: admin-workspaces
title: Admin workspace directory
slug: admin-workspaces
category: Administration
route: /admin/workspaces
roles: [admin]
summary: "Search customer workspaces and review plan, onboarding, and aggregate usage status."
keywords: [admin, workspaces, tenants, plans, subscription status, usage]
related_articles: [admin-workspace-detail, admin-users, admin-overview]
status: published
updated_at: 2026-09-05
---

# Admin workspace directory

The workspace directory provides a platform-wide view of Ayooda tenants. Search by workspace-name prefix or exact workspace ID, then filter by subscription status or plan.

Each row shows the owner, current subscription classification, current-period conversation count, and creation date. These are operational summaries; the directory does not expose customer messages, agent prompts, encrypted connector credentials, or API keys.

## Subscription status

Subscription data is synchronized from Stripe. Do not treat Firestore fields as an independent billing control. Past-due workspaces deserve review in Stripe before contacting the customer or changing access.

Open a workspace for member and resource counts. The initial admin console keeps workspace management read-only: it does not transfer ownership, move users, alter plans, suspend workspaces, or delete tenant data.
