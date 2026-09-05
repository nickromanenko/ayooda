# Platform Admin Role and Dashboard — Implementation Plan

**Date:** 2026-09-05  
**Status:** Proposed  
**Goal:** Add a global Ayooda administrator role and a separately guarded admin console for operating the platform, inspecting users and workspaces, and performing a small set of safe, audited support actions.

## 1. Current-state findings

- Ayooda currently has only workspace-scoped roles: `owner` and `member`.
- API authentication loads `users/{uid}` on every request and derives the user's workspace and workspace role from that document.
- The dashboard server layout verifies the Firebase session cookie, loads the same user document, and redirects based on workspace onboarding state.
- The dashboard sidebar receives only the workspace role. There is no global platform permission.
- Most sensitive data is already served through the Admin-SDK API rather than read directly by the browser.
- `/dashboard` has a server-side authentication check, while `proxy.ts` only provides a coarse cookie-presence redirect.
- Firestore currently allows a user to write their complete own `users/{uid}` document. A platform role stored there would therefore be self-assignable unless this rule is fixed first.
- Administrators may need to operate without depending on the state of their own workspace, so `/admin` should not inherit the dashboard's onboarding and workspace-layout assumptions.

## 2. Product decisions

### 2.1 Keep platform and workspace authorization separate

Do not add `admin` to `WorkspaceRole`. Use two independent fields:

```ts
type WorkspaceRole = 'owner' | 'member'
type PlatformRole = 'admin'

interface UserDoc {
  // existing fields
  role?: WorkspaceRole
  platformRole?: PlatformRole
}
```

A platform admin may still be an owner or member of a normal workspace. Their platform role grants access to `/admin`; it does not silently change what they can do inside a customer's workspace.

### 2.2 Firestore is the authoritative role source in v1

Use `users/{uid}.platformRole` rather than Firebase custom claims for the initial implementation.

Reasons:

- the API already reads the user document on every authenticated request;
- assignment and revocation take effect immediately;
- custom claims are copied into ID tokens and session cookies and can remain stale until token refresh or re-login;
- one source of truth is easier to audit and test.

Custom claims can later be added as a performance hint, but authorization must continue to fail closed against the authoritative server-side record.

### 2.3 Bootstrap admins outside the product UI

The first release must not let an admin grant or revoke platform-admin access in the browser. Add explicit CLI scripts that accept an existing Firebase UID or email, update only `platformRole`, and write an audit record:

```bash
pnpm admin:grant -- user@example.com
pnpm admin:revoke -- user@example.com
```

This avoids an accidental privilege-management loop while the admin console itself is new. Browser-based role management can be a later `super_admin` feature if needed.

### 2.4 Start read-heavy and make every mutation explicit

The first useful admin console should include:

1. Platform overview.
2. Searchable, paginated users.
3. Searchable, paginated workspaces.
4. User and workspace detail views.
5. Safe user actions: disable/enable sign-in and revoke sessions.
6. An immutable admin audit log.

Do not initially add permanent deletion, workspace ownership transfer, impersonation, arbitrary Firestore editing, or direct subscription-field editing. Those actions have cross-system or destructive consequences and need dedicated designs.

## 3. Admin information architecture

Use a distinct `/admin` application shell so an administrator always knows whether they are operating Ayooda or a customer workspace.

### `/admin` — Overview

- total users and workspaces;
- signups in the last 7 and 30 days;
- subscription breakdown: trialing, active, past due, canceled/expired;
- aggregate period conversations and token usage;
- recent signups and recently active workspaces;
- attention cards for past-due subscriptions and operational failures that the platform can reliably derive.

Metrics should show `Unavailable` rather than `0` when a query fails.

### `/admin/users` — Users

- paginated table with name, email, UID, workspace, workspace role, platform role, created date, and sign-in status;
- prefix search by normalized email or display name, plus direct UID lookup;
- filters for active/disabled and platform admins;
- detail drawer or `/admin/users/[uid]` page;
- actions: disable sign-in, enable sign-in, revoke sessions;
- clear confirmation copy describing the effect of each action.

Disabling a user must both disable the Firebase Auth account and revoke refresh tokens. Existing API calls should also fail immediately by checking the authoritative disabled state.

### `/admin/workspaces` — Workspaces

- paginated table with name, workspace ID, owner, member count, plan/status, created date, and current-period usage;
- filters for subscription status and plan;
- detail page with members, agents, channels, conversation/ticket counts, usage, onboarding state, and Stripe identifiers presented as links where safe;
- no secrets, encrypted credentials, message contents, system prompts, or raw customer PII in list responses.

The first release is read-only for workspaces. Subscription changes must continue through Stripe. Suspension, ownership transfer, and deletion each require a separate workflow before being added.

### `/admin/audit-log` — Audit log

- newest-first, cursor-paginated events;
- filters by actor, action, and target;
- human-readable summaries plus technical IDs;
- no credentials, tokens, message bodies, or secret configuration values.

### Navigation

- pass `isPlatformAdmin` from the authenticated dashboard server layout into `Sidebar`;
- show a separated `Admin` link near the account/settings controls only to admins;
- provide `Back to workspace` in the admin shell;
- do not treat hiding the link as authorization—the route and every API endpoint remain server-guarded.

## 4. Data model

### User extensions

```ts
interface UserDoc {
  // existing fields
  platformRole?: 'admin'
  emailLower?: string
  displayNameLower?: string
  accessStatus?: 'active' | 'disabled'
  disabledAt?: Timestamp | null
  disabledBy?: string | null
  updatedAt?: Timestamp
}
```

`accessStatus` is an immediate API-side kill switch and a mirror of the intended Firebase Auth state. Firebase Auth remains responsible for preventing future sign-in.

### Admin audit events

Collection: `adminAuditLogs/{eventId}`

```ts
interface AdminAuditEvent {
  actorUid: string
  actorEmail: string
  action: string
  targetType: 'user' | 'workspace' | 'platform_role'
  targetId: string
  outcome: 'succeeded' | 'failed'
  summary: string
  metadata: Record<string, string | number | boolean | null>
  createdAt: Timestamp
}
```

Only allowlisted metadata may be recorded. Do not persist request authorization headers, Firebase tokens, API keys, message text, or complete before/after documents.

### Search fields and backfill

New and updated users should receive `emailLower`, `displayNameLower`, `accessStatus`, and `updatedAt`. Add an idempotent backfill for existing users. Firestore queries should use cursor pagination and bounded limits; do not load all users into the browser.

## 5. Authorization architecture

### API middleware

Extend `AuthVariables` with:

```ts
platformRole?: PlatformRole
accessStatus: 'active' | 'disabled'
```

`requireAuth` must:

1. verify the Firebase ID token;
2. load `users/{uid}`;
3. fail closed if required identity/workspace fields are missing;
4. reject `accessStatus === 'disabled'`;
5. set workspace and platform authorization variables.

Refactor its current broad `try/catch` so only token verification and identity lookup errors become authentication responses. Exceptions thrown by downstream handlers after `await next()` must not be mislabeled as `Invalid token`.

Add `requirePlatformAdmin`, which must run after `requireAuth` and return `403` unless `platformRole === 'admin'`.

Mount all platform endpoints below `/admin` and apply both middleware functions to the entire router. Admin handlers must use explicit response DTOs; they must never serialize raw Firestore documents.

### Web route guard

Create a separate `apps/web/src/app/admin/layout.tsx` that:

1. requires `__session`;
2. verifies the session cookie with revocation checking;
3. loads `users/{uid}` through the server Admin SDK;
4. rejects disabled users;
5. permits only `platformRole === 'admin'`.

Authenticated non-admins should receive a clear access-denied page with a route back to `/dashboard`. Unauthenticated visitors should be redirected to `/login?from=/admin/...`.

Add `/admin/:path*` to the proxy matcher for the coarse cookie check, while retaining the server layout as the real authorization boundary.

### Firestore rules

Before adding the role, change the user rule to:

```text
allow read: if request.auth != null && request.auth.uid == userId;
allow write: if false;
```

The existing profile update already goes through the API, so the client does not require direct user-document writes. Explicitly deny client access to `adminAuditLogs`. The API and Next.js server Admin SDK continue to bypass client rules.

## 6. API design

Create `apps/api/src/routes/admin.ts` with thin handlers backed by focused modules in `apps/api/src/lib/admin/`.

### Read endpoints

- `GET /admin/overview`
- `GET /admin/users?limit=&cursor=&query=&status=&platformRole=`
- `GET /admin/users/:uid`
- `GET /admin/workspaces?limit=&cursor=&query=&subscriptionStatus=&tier=`
- `GET /admin/workspaces/:workspaceId`
- `GET /admin/audit-log?limit=&cursor=&actorUid=&action=&targetId=`

Use opaque, signed or validated cursor payloads rather than accepting arbitrary document paths. Default to 25 records and cap at 100.

### Mutation endpoints

- `POST /admin/users/:uid/disable`
- `POST /admin/users/:uid/enable`
- `POST /admin/users/:uid/revoke-sessions`

Each mutation must:

1. validate the target and refuse unsafe self-disable operations;
2. perform a fixed, narrowly scoped operation;
3. write a success or failure audit event;
4. return the refreshed safe user DTO;
5. be idempotent where possible.

Add mutation rate limits per admin UID and structured logs with an operation ID. Never add a general-purpose `PATCH /admin/doc` endpoint.

## 7. Implementation sequence

### Phase 1 — Role foundation and security

- Add `PlatformRole`, safe admin DTOs, and user extensions to `@ayooda/shared`.
- Lock down direct writes to `users/{uid}` in `firestore.rules`.
- Update `/auth/verify` and `/user` to maintain normalized fields and timestamps.
- Extend `requireAuth`; add and unit-test `requirePlatformAdmin`.
- Add `admin:grant`, `admin:revoke`, and user-field backfill scripts.
- Add deployment/runbook documentation for bootstrapping and emergency revocation.

**Acceptance:** a normal owner cannot assign themselves admin access through Firestore, admin role revocation takes effect on the next request, and workspace authorization behavior is unchanged.

### Phase 2 — Guarded shell and read-only overview

- Add `/admin` to the web proxy matcher.
- Build the server-guarded admin layout and separate admin navigation.
- Pass `isPlatformAdmin` to the existing dashboard sidebar and render the admin link.
- Add `/admin/overview` API aggregation service and overview page.
- Add loading, empty, partial-failure, and retry states.

**Acceptance:** direct navigation and API requests from a non-admin are denied; an admin can move between their workspace and the admin console; failed metrics never masquerade as zero.

### Phase 3 — User directory and safe account actions

- Implement normalized user search and cursor pagination.
- Build the users table and detail page.
- Join bounded Firebase Auth account state without exposing provider secrets.
- Implement disable, enable, and session-revocation actions with confirmations.
- Add audit logging before exposing the first mutation.

**Acceptance:** all actions are authorized, idempotent, immediately enforced, visibly confirmed, and represented in the audit log.

### Phase 4 — Workspace directory

- Implement workspace list/search/filter endpoints.
- Add workspace detail aggregation with bounded parallel count queries.
- Build workspace list and detail pages.
- Link to Stripe using safe customer/subscription IDs when present; do not mutate subscription fields.
- Avoid N+1 subcollection counts on list pages—load expensive details only on the selected workspace.

**Acceptance:** admins can diagnose account setup, plan, usage, agents, channels, and ticket/conversation volume without gaining access to stored secrets or raw conversations.

### Phase 5 — Audit and operational polish

- Build the audit-log page and filters.
- Add admin-specific structured error reporting and latency metrics.
- Add contextual Knowledge Base articles for each admin section.
- Add keyboard/focus behavior, responsive tables/cards, accessible confirmations, and explicit destructive-action styling.
- Document incident procedures for revoking an admin and disabling a compromised user.

**Acceptance:** every admin mutation is attributable and searchable, the admin console is usable at desktop and tablet widths, and operational procedures do not require code changes.

## 8. Tests and verification

### Unit/API tests

- admin middleware allows platform admins and rejects owners/members;
- missing or unknown `platformRole` fails closed;
- disabled users cannot use normal or admin APIs;
- DTO serializers exclude secrets and raw private documents;
- cursor parsing rejects malformed or oversized values;
- user mutations reject self-disable and audit both success and failure;
- overview aggregations preserve `unavailable` independently per metric.

### Firestore rules tests

- users can read their own profile;
- users cannot write `platformRole`, `role`, `workspaceId`, or any other user fields directly;
- non-admin browser clients cannot read admin audit records;
- existing Inbox and Copilot client reads still pass.

### Web tests

- admin link appears only for a platform admin;
- admin layout rejects a valid non-admin session;
- loading, empty, error, pagination, filters, and confirmation states render correctly;
- tables retain usable card layouts on narrow screens;
- focus returns to the triggering control after dialogs close.

### Manual acceptance matrix

Test with three existing Firebase accounts: platform admin, workspace owner, and workspace member.

- Each can still use their normal permitted dashboard features.
- Only the admin sees the link and can load `/admin`.
- Owner/member calls to every `/admin/*` endpoint return `403`.
- Disabling the member blocks the next API request and future sign-in.
- Re-enabling restores access without changing workspace membership.
- Audit events contain no secrets or customer message content.

Run the full repository gates: shared build/tests, API tests and typecheck, web tests/typecheck/lint, Firestore rules tests, production build, and `git diff --check`.

## 9. Explicit non-goals for the first release

- impersonating a user;
- reading arbitrary customer conversations from the admin console;
- permanently deleting users or workspaces;
- moving users between workspaces;
- transferring workspace ownership;
- manually editing Stripe-controlled subscription state;
- editing encrypted credentials or agent prompts;
- granting platform roles from the browser;
- a general Firestore document editor.

These capabilities should be added only as narrow, separately specified workflows with step-up authentication, complete auditing, and recovery procedures.

## 10. Recommended first delivery

Ship Phases 1–4 as the initial admin feature. This gives Ayooda a secure operational console with useful support capabilities while keeping the most dangerous actions out of scope. Phase 5 should immediately follow before broader internal use.
