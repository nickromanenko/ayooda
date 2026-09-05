---
article_id: admin-users
title: Admin user directory
slug: admin-users
category: Administration
route: /admin/users
roles: [admin]
summary: "Search Ayooda users and review workspace, role, and account-access information."
keywords: [admin, users, accounts, access status, search]
related_articles: [admin-user-detail, admin-workspaces, admin-audit-log]
status: published
updated_at: 2026-09-05
---

# Admin user directory

The user directory lists Ayooda accounts across workspaces. Search by an email prefix, display-name prefix, or exact Firebase UID. Filters narrow the list to active or disabled accounts and platform administrators.

## Roles and status

Workspace roles and platform roles are separate. An `owner` or `member` describes access inside one workspace. An `admin` badge grants access to Ayooda platform operations and does not replace the workspace role.

Account status reflects Ayooda's server-side access record and Firebase Authentication. A disabled account cannot sign in and its existing sessions are revoked.

## Safe use

Open a user to review details before taking action. Do not disable an account based only on a similar display name; verify the email, UID, and workspace. The directory does not provide bulk actions because account access changes require individual review.
