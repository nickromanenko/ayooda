---
article_id: admin-user-detail
title: Admin user details and account actions
slug: admin-user-detail
category: Administration
route: /admin/users/:uid
roles: [admin]
summary: "Review one account and safely disable, enable, or revoke its sessions."
keywords: [admin, user details, disable account, enable account, revoke sessions]
related_articles: [admin-users, admin-workspace-detail, admin-audit-log]
status: published
updated_at: 2026-09-05
---

# Admin user details and account actions

The user detail page combines the account's Firebase UID, email, workspace membership, roles, timestamps, and sign-in status. Confirm these identifiers before changing access.

## Disable account

**Disable account** prevents future Firebase sign-in, revokes refresh tokens, and marks the Ayooda user record disabled. The target's next authenticated API request is rejected. You cannot disable your own administrator account from this page.

## Enable account

**Enable account** restores Firebase sign-in and marks the Ayooda user record active. It does not change the person's workspace, workspace role, agent permissions, password, or platform role.

## Revoke sessions

**Revoke sessions** signs the user out across sessions without disabling future sign-in. Use it after a suspected credential leak or when support needs the user to authenticate again.

Every successful or failed action is recorded in the Admin audit log. Permanent deletion, impersonation, workspace reassignment, and platform-role changes are intentionally unavailable here.
