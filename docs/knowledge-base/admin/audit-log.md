---
article_id: admin-audit-log
title: Admin audit log
slug: admin-audit-log
category: Administration
route: /admin/audit-log
roles: [admin]
summary: "Review who performed platform account and administrator-role actions and whether they succeeded."
keywords: [admin, audit log, accountability, security, account actions]
related_articles: [admin-users, admin-user-detail, admin-overview]
status: published
updated_at: 2026-09-05
---

# Admin audit log

The audit log records platform administrator actions in newest-first order. Events identify the actor, action, target, outcome, timestamp, and a concise summary.

Use the exact target UID to find activity for one account, or filter by action type. A failed event means the requested operation did not fully complete and should be investigated before retrying.

## Recorded information

Audit metadata is deliberately allowlisted. Events do not store Firebase tokens, authorization headers, API keys, encrypted credentials, customer messages, or full user and workspace documents.

CLI changes to the platform administrator role are recorded with a system actor. Browser account actions show the signed-in administrator. Audit records are server-managed and cannot be modified through the dashboard or client Firestore SDK.
