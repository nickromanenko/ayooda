# Ayooda Sub-project E — Team Members — Design Spec

**Date:** 2026-07-13
**Status:** Approved for planning
**Scope:** Let a workspace owner invite teammates who log in and act as operators in the shared inbox (human takeover), with owner/member roles and basic invite management. No email-sending infrastructure.

## Background

Today every user gets their own workspace on first login (`POST /auth/verify`), and `requireAuth` reads a single `users/{uid}.workspaceId`. There is no way for two people to share a workspace. This adds team membership: an owner invites teammates by email; on first sign-in with that email they join the workspace as a **member** (operator) rather than getting their own workspace.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Membership | **One workspace per user.** A user belongs to exactly one workspace (created or joined). Invites only work for emails without an existing Ayooda account. No workspace switcher. |
| Invite delivery | **Invite by email + auto-join on sign-in.** A pending-invite record; the person joins when they first sign in with that email. Owner also gets a copyable `/signup?invite=<email>` link. No email sending. |
| Roles | **Owner + Member.** Owner: full access. Member: inbox + human takeover only. |
| Management | Owner can **invite, list members + pending invites, revoke a pending invite, and remove a member.** No role-changing. |

---

## 1. Data model (Firestore + shared types)

- `users/{uid}` gains `role: 'owner' | 'member'`. Existing user docs have no `role`; `requireAuth` treats **missing role as `'owner'`** (every current user owns their workspace) — no backfill needed.
- New top-level collection `pendingInvites/{emailLower}` → `{ email: string, workspaceId: string, invitedBy: string, createdAt: Date }`. The doc id is the lowercased email, so at most one pending invite exists per email globally (consistent with one-workspace-per-user). Direct `get()` by email drives auto-join; `where('workspaceId','==',ws)` lists a workspace's invites.

Shared types (`packages/shared`): `WorkspaceRole = 'owner' | 'member'`; add `role?: WorkspaceRole` to `UserDoc`; a `PendingInvite` interface.

No `members` subcollection — the team roster is derived by querying `users where workspaceId == <ws>` (Firestore auto-indexes the single field).

## 2. Auth intercept — auto-join on first sign-in

In `POST /auth/verify` ([apps/api/src/routes/auth.ts](../../../apps/api/src/routes/auth.ts)), the existing "first login" branch (after `if (userSnap.exists)`, before creating the new workspace batch) gains a pending-invite check:

1. Lowercase the token's `email`. If empty, proceed to the normal new-workspace path.
2. `get()` `pendingInvites/{emailLower}`. **If it exists:** in one batch, create `users/{uid}` with `{ email, displayName, photoURL, workspaceId: invite.workspaceId, role: 'member', createdAt }` and delete the pending-invite doc — **do not** create a workspace. Return `{ workspaceId: invite.workspaceId }`.
3. **Else:** the existing path — create the user + a new workspace + trial, and set `role: 'owner'` on the user doc.

Idempotency preserved: a returning user (`userSnap.exists`) still short-circuits at the top, unchanged.

## 3. Role enforcement

- Extend `AuthVariables` ([apps/api/src/middleware/auth.ts](../../../apps/api/src/middleware/auth.ts)) with `role: WorkspaceRole`. In `requireAuth`, after loading the user doc, set `role = userData.role ?? 'owner'` (no extra read).
- New middleware `requireOwner` (same file or a sibling): if `c.get('role') !== 'owner'` → `403 { error: 'Owner access required' }`. It runs after `requireAuth`.
- Apply `requireOwner` to owner-only mutations/surfaces:
  - `PUT /workspace`, `PUT /workspace/agent`, `PUT/DELETE /workspace/key`
  - all `/knowledge` (scrape, upload, reindex, delete, list)
  - all `/channels` (web-widget, telegram connect/disconnect) — but **not** the public `POST /telegram/webhook` (no auth) or `POST /widget/*` (no auth)
  - all `/billing` authed endpoints (`GET /billing`, checkout, portal) — **not** the public webhook
  - all `/team` mutations (below)
- Members retain access to: all `/conversations` (inbox + takeover: list, messages, takeover, resolve, operator send), `GET /workspace` (dashboard context/agent read), and `GET/PUT /user` (self profile). `GET /channels` is owner-only (it exposes embed/config); the inbox does not need it.

`GET /workspace` additionally returns the caller's `role` so the web app can shape navigation.

## 4. Team endpoints (`/team`, requireAuth + requireOwner)

New route `apps/api/src/routes/team.ts` mounted at `/team`:

- **`GET /team`** — returns `{ members: Array<{ uid, email, displayName, role }>, invites: Array<{ email, createdAt }> }`. Members from `users where workspaceId == ws`; invites from `pendingInvites where workspaceId == ws`.
- **`POST /team/invite`** `{ email }` — normalize (trim + lowercase); validate it's a plausible email (contains `@`, ≤254 chars) else 400. Reject with 409 if: a user already exists with that email (`users where email == emailLower` non-empty → "This email already has an Ayooda account"), or a pending invite already exists (`pendingInvites/{emailLower}` exists → "Already invited"). Otherwise create `pendingInvites/{emailLower}` `{ email, workspaceId, invitedBy: uid, createdAt }`. Return `{ email, inviteLink: `${WEB_URL}/signup?invite=${emailLower}` }` (WEB_URL from an env var `WEB_PUBLIC_URL`, default the dashboard origin). The link is a convenience — auto-join is by email match, not a token.
- **`DELETE /team/invite/:email`** — delete `pendingInvites/{emailLower}` (idempotent → 200). Scope check: only delete if the doc's `workspaceId === ws` (don't touch another workspace's invite).
- **`DELETE /team/member/:uid`** — remove a member. Load `users/{uid}`; 404 if missing or `workspaceId !== ws` (can't remove someone from another workspace). Guard: if the target uid is the workspace's `ownerId` (or the target's `role === 'owner'`), 400 "Cannot remove the owner". Otherwise delete `users/{uid}`. (On their next login, `auth.verify` sees no user doc and provisions them a fresh solo workspace; their current session's API calls 404 at `requireAuth` and the web app redirects to login.)

Email validation and normalization live in a small pure helper (`normalizeInviteEmail(raw): { ok: true; email } | { ok: false; error }`) so they're unit-testable.

## 5. Web

- **Sidebar** ([apps/web/src/components/dashboard/Sidebar.tsx](../../../apps/web/src/components/dashboard/Sidebar.tsx)) — take the caller's `role` (from `GET /workspace` via a small client fetch or a prop). For a **member**, show only **Inbox** (hide Overview/Agent/Knowledge/Channels/Settings/Billing/Team). For an **owner**, show all plus a new **Team** link.
- **Dashboard layout** ([apps/web/src/app/dashboard/layout.tsx](../../../apps/web/src/app/dashboard/layout.tsx)) — it already verifies the session server-side and reads the workspace. No hard redirect needed, but owner-only pages should be resilient: since the API 403s members on owner-only routes, those pages already fail gracefully; the sidebar simply doesn't surface them. (A member navigating directly to an owner URL sees the page's load error / empty state — acceptable for v1; the nav is the primary guard.)
- **Team page** `apps/web/src/app/dashboard/team/page.tsx` (client): lists members and pending invites, an invite form (email → `POST /team/invite`, shows the copyable invite link + inline errors), a Revoke button per pending invite (`DELETE /team/invite/:email`), and a Remove button per member except the owner (`DELETE /team/member/:uid`). Matches the existing dashboard inline-style idiom.
- **Signup page** reads `?invite=<email>` (optional): pre-fills the email field and shows "You're joining a team" copy. The auto-join happens server-side regardless; this is UX polish.

## 6. Error handling

- Invite to an already-registered or already-invited email → 409 with a clear message; the team page surfaces it inline.
- Removing the owner → 400. Removing a non-member (wrong workspace) → 404.
- A member hitting an owner-only endpoint → 403 (the web nav prevents this in normal use).
- Auth-verify auto-join is idempotent-safe: the pending invite is deleted in the same batch as user creation, so a retry finds `userSnap.exists` and short-circuits.
- Missing `WEB_PUBLIC_URL` → the invite link falls back to a relative `/signup?invite=…`; documented in `.env.example`.

## 7. Testing & verification

- **Unit tests** (`bun test`): `normalizeInviteEmail` (trim/lowercase, rejects missing `@`, over-length, empty); the `requireOwner` decision (role owner → pass, member → 403) if extractable as a pure check.
- **Live E2E**: owner `POST /team/invite {email}` → pending invite created, `GET /team` shows it; simulate a brand-new user with that email calling `POST /auth/verify` → a `users/{uid}` doc is created with `role:'member'` and `workspaceId` = the inviting workspace, **no new workspace**, and the pending invite is gone; that member's token 200s on `GET /conversations` but 403s on `POST /knowledge/scrape` and `GET /channels`; owner `DELETE /team/member/:uid` removes the user doc; inviting an email that already has an account → 409. Verify `GET /workspace` returns `role`.
- **Web**: owner sees the Team nav + page and can invite/revoke/remove; a member session sees only Inbox.
- Clean up all test users/invites afterward.

## Out of scope

Multi-workspace membership / workspace switcher; role-changing (promote/demote); an Admin tier; actual email delivery of invites; per-member activity/audit logs; transferring ownership; seat-based billing limits (billing caps are per-workspace conversations, unaffected by member count).
