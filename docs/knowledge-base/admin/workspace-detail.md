---
article_id: admin-workspace-detail
title: Admin workspace details
slug: admin-workspace-detail
category: Administration
route: /admin/workspaces/:workspaceId
roles: [admin]
summary: "Inspect one workspace's owner, members, subscription identifiers, usage, and resource counts."
keywords: [admin, workspace details, members, agents, channels, tickets, Stripe]
related_articles: [admin-workspaces, admin-user-detail, admin-overview]
status: published
updated_at: 2026-09-05
---

# Admin workspace details

The workspace detail page helps diagnose account setup without opening customer content. It shows onboarding state, subscription and plan status, aggregate usage, members, and counts for agents, channels, conversations, and tickets.

## Members

The member list shows each person's workspace role and account-access status. Select a member to open the user detail page. Disabling a user affects that person's sign-in only; it does not modify or delete the workspace.

## Stripe references

When present, the Stripe customer identifier links to Stripe search. Verify whether you are viewing Stripe test mode or live mode before acting. Subscription state should be changed through Stripe's supported workflows, not by editing Firestore.

## Privacy and limitations

Counts are retrieved only for this selected workspace to avoid expensive platform-wide scans. The page intentionally omits messages, prompts, knowledge content, and secrets. Workspace deletion, suspension, ownership transfer, and subscription editing are not available in the first admin release.
