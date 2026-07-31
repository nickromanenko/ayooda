# Ayooda Team Members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-13-team-members-design.md`: a workspace owner invites teammates by email who auto-join as inbox operators (members), with owner/member roles enforced across the API and reflected in the web nav.

**Architecture:** Roles live on the user doc (`role`, default `'owner'` for existing users). Invites are `pendingInvites/{emailLower}` docs; `POST /auth/verify` auto-joins a first-time user whose email matches a pending invite (no new workspace). A `requireOwner` middleware gates owner-only routes; members keep the inbox. A `/team` route manages invites/members; the web shows a Team page and role-based nav.

**Tech Stack:** Hono 4 on Bun, firebase-admin 12, Next.js 16, `bun test`. No new dependencies.

## Global Constraints

- One workspace per user; invites only work for emails without an existing account. No workspace switcher.
- Roles: `owner` (full) and `member` (inbox + human takeover only). Missing `role` on a user doc is treated as `owner` (no backfill).
- Invite delivery: create a `pendingInvites/{emailLower}` doc; auto-join on first sign-in by email match. No email sending. Owner gets a copyable `/signup?invite=<email>` link.
- Owner-only API surfaces: `PUT /workspace`, `PUT /workspace/agent`, `PUT/DELETE /workspace/key`, all `/knowledge`, all `/channels`, all authed `/billing`, all `/team` mutations. Members keep: all `/conversations`, `GET /workspace`, `GET/PUT /user`. Public routes (`/widget/*`, `/telegram/webhook`, `/billing/webhook`) are unaffected.
- Remove-member = delete the `users/{uid}` doc (they re-provision a fresh workspace on next login). The workspace owner can never be removed.
- Env: `WEB_PUBLIC_URL` (base for the invite link; falls back to a relative path) — document in `apps/api/.env.example`.
- `@ayooda/shared` builds to `dist/` — run `pnpm --filter @ayooda/shared build` after editing it. `apps/web` is **Next.js 16** — consult `apps/web/node_modules/next/dist/docs/` before App Router work. Run `corepack enable` if `pnpm` is missing.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Shared types

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `WorkspaceRole = 'owner' | 'member'`; `UserDoc.role?: WorkspaceRole`; `PendingInvite`. Tasks 2–7 import these.

_No unit test — type-only; the compile is the check._

- [ ] **Step 1: Add the types**

In `packages/shared/src/index.ts`, add near the other type exports:

```ts
export type WorkspaceRole = 'owner' | 'member'

export interface PendingInvite {
  email: string       // lowercased
  workspaceId: string
  invitedBy: string   // uid of the inviting owner
  createdAt: Date
}
```

And add `role?: WorkspaceRole` to the existing `UserDoc` interface.

- [ ] **Step 2: Build + typecheck**

Run: `pnpm --filter @ayooda/shared build && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): workspace role + pending invite types"
```

---

### Task 2: Invite email normalization (pure)

**Files:**
- Create: `apps/api/src/lib/team/invite.ts`
- Create: `apps/api/src/lib/team/invite.test.ts`

**Interfaces:**
- Produces: `normalizeInviteEmail(raw: string): { ok: true; email: string } | { ok: false; error: string }`. Task 6 calls it.

- [ ] **Step 1: Write the failing test** — `apps/api/src/lib/team/invite.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { normalizeInviteEmail } from './invite'

describe('normalizeInviteEmail', () => {
  test('trims and lowercases', () => {
    expect(normalizeInviteEmail('  Alice@Example.COM ')).toEqual({ ok: true, email: 'alice@example.com' })
  })
  test('rejects empty', () => {
    expect(normalizeInviteEmail('   ').ok).toBe(false)
  })
  test('rejects missing @', () => {
    expect(normalizeInviteEmail('notanemail').ok).toBe(false)
  })
  test('rejects @ with no local or domain part', () => {
    expect(normalizeInviteEmail('@example.com').ok).toBe(false)
    expect(normalizeInviteEmail('alice@').ok).toBe(false)
  })
  test('rejects over-length (>254)', () => {
    const long = 'a'.repeat(250) + '@x.com'
    expect(normalizeInviteEmail(long).ok).toBe(false)
  })
  test('accepts a normal address', () => {
    expect(normalizeInviteEmail('bob.smith+tag@sub.example.io')).toEqual({ ok: true, email: 'bob.smith+tag@sub.example.io' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/team/invite.test.ts`
Expected: FAIL — cannot resolve `./invite`.

- [ ] **Step 3: Implement `apps/api/src/lib/team/invite.ts`**

```ts
/** Normalize + minimally validate an invite email. Not RFC-perfect — just enough to catch obvious junk. */
export function normalizeInviteEmail(raw: string): { ok: true; email: string } | { ok: false; error: string } {
  const email = raw.trim().toLowerCase()
  if (email.length === 0) return { ok: false, error: 'Email is required' }
  if (email.length > 254) return { ok: false, error: 'Email is too long' }
  const at = email.indexOf('@')
  if (at <= 0 || at === email.length - 1 || email.indexOf('@', at + 1) !== -1) {
    return { ok: false, error: 'Enter a valid email address' }
  }
  if (!email.slice(at + 1).includes('.')) return { ok: false, error: 'Enter a valid email address' }
  return { ok: true, email }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/team/invite.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/lib/team/invite.ts apps/api/src/lib/team/invite.test.ts
git commit -m "feat(api): invite email normalization helper"
```

---

### Task 3: role in requireAuth + requireOwner middleware

**Files:**
- Modify: `apps/api/src/middleware/auth.ts`

**Interfaces:**
- Consumes: `WorkspaceRole` from Task 1.
- Produces: `AuthVariables` gains `role: WorkspaceRole`; `requireAuth` sets it; new `requireOwner` middleware. Tasks 4, 6 use `requireOwner`.

_No unit test — middleware over Firestore; verified in Task 8 E2E (member 403s on owner routes)._

- [ ] **Step 1: Extend the middleware**

Read `apps/api/src/middleware/auth.ts`. Add the import `import type { WorkspaceRole } from '@ayooda/shared'`. Extend `AuthVariables`:

```ts
export type AuthVariables = {
  uid: string
  workspaceId: string
  role: WorkspaceRole
}
```

In `requireAuth`, after `const userData = userDoc.data()!` and setting `uid`/`workspaceId`, also set the role (default `'owner'` for existing users without the field):

```ts
    c.set('role', (userData.role as WorkspaceRole) ?? 'owner')
```

Add the `requireOwner` middleware at the end of the file:

```ts
/** Gate a route to workspace owners. Must run AFTER requireAuth. */
export const requireOwner = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  if (c.get('role') !== 'owner') {
    return c.json({ error: 'Owner access required' }, 403)
  }
  await next()
})
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter api typecheck`
Expected: PASS (existing routes still compile — `role` is a new optional-to-set context var).
```bash
git add apps/api/src/middleware/auth.ts
git commit -m "feat(api): role in auth context + requireOwner middleware"
```

---

### Task 4: Apply requireOwner to owner-only routes; GET /workspace returns role

**Files:**
- Modify: `apps/api/src/routes/workspace.ts`
- Modify: `apps/api/src/routes/knowledge.ts`
- Modify: `apps/api/src/routes/channels.ts`
- Modify: `apps/api/src/routes/billing.ts`

**Interfaces:**
- Consumes: `requireOwner` (Task 3).
- Produces: owner-only enforcement; `GET /workspace` includes `role`.

_No unit test — middleware wiring; verified in Task 8 (member gets 403)._

- [ ] **Step 1: `workspace.ts` — gate mutations, keep GET for members, return role**

In `apps/api/src/routes/workspace.ts`: import `requireOwner` alongside `requireAuth`. The router has `workspace.use('*', requireAuth)` (keep it — members may GET). Add `requireOwner` inline to each mutation route: change `workspace.put('/', async (c) => {` → `workspace.put('/', requireOwner, async (c) => {`, and the same for `workspace.put('/agent', ...)`, `workspace.put('/key', ...)`, `workspace.delete('/key', ...)`. In the `GET /` handler's response object, add `role: c.get('role')`.

- [ ] **Step 2: `knowledge.ts` — all owner-only**

In `apps/api/src/routes/knowledge.ts`: import `requireOwner`. After the existing `knowledge.use('*', requireAuth)`, add `knowledge.use('*', requireOwner)`.

- [ ] **Step 3: `channels.ts` — all owner-only**

In `apps/api/src/routes/channels.ts`: import `requireOwner`. After `channels.use('*', requireAuth)`, add `channels.use('*', requireOwner)`.

- [ ] **Step 4: `billing.ts` — gate the three authed endpoints (NOT the webhook)**

Read `apps/api/src/routes/billing.ts`. The webhook is registered first and is public — do not touch it. For the authed endpoints, add `requireOwner` after `requireAuth`:
- The `billing.use('/checkout', requireAuth)` / `billing.use('/portal', requireAuth)` lines: add `billing.use('/checkout', requireOwner)` and `billing.use('/portal', requireOwner)` immediately after them (middleware runs in registration order, so requireAuth then requireOwner).
- The inline `billing.get('/', requireAuth, async (c) => {...})`: change to `billing.get('/', requireAuth, requireOwner, async (c) => {...})`.
Import `requireOwner` in the file.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter api typecheck`
Expected: PASS.
```bash
git add apps/api/src/routes/workspace.ts apps/api/src/routes/knowledge.ts apps/api/src/routes/channels.ts apps/api/src/routes/billing.ts
git commit -m "feat(api): gate owner-only routes; GET /workspace returns role"
```

---

### Task 5: Auth-verify auto-join intercept

**Files:**
- Modify: `apps/api/src/routes/auth.ts`

**Interfaces:**
- Produces: first-time users whose email matches a `pendingInvites/{emailLower}` doc join that workspace as `role:'member'` (no new workspace); other new users get `role:'owner'`.

_No unit test — Firestore batch; verified in Task 8 E2E._

- [ ] **Step 1: Intercept before creating a new workspace**

In `apps/api/src/routes/auth.ts`, the "First login" section starts after `if (userSnap.exists) { ... }`. Insert the pending-invite check between that block and the existing `const workspaceRef = adminDb.collection('workspaces').doc()` line:

```ts
  // Auto-join: if this email was invited, attach as a member instead of creating a workspace.
  const emailLower = (email ?? '').trim().toLowerCase()
  if (emailLower) {
    const inviteRef = adminDb.doc(`pendingInvites/${emailLower}`)
    const inviteSnap = await inviteRef.get()
    if (inviteSnap.exists) {
      const invite = inviteSnap.data() as { workspaceId: string }
      const batch = adminDb.batch()
      batch.set(userRef, {
        email: email ?? '',
        displayName: name ?? '',
        photoURL: picture ?? null,
        workspaceId: invite.workspaceId,
        role: 'member',
        createdAt: new Date(),
      })
      batch.delete(inviteRef)
      await batch.commit()
      return c.json({ workspaceId: invite.workspaceId })
    }
  }
```

Then, in the existing new-workspace path's `batch.set(userRef, {...})`, add `role: 'owner',` to the user payload (so owners are explicitly marked; members are set above).

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter api typecheck`
Expected: PASS.
```bash
git add apps/api/src/routes/auth.ts
git commit -m "feat(api): auto-join invited users on first sign-in"
```

---

### Task 6: /team route

**Files:**
- Create: `apps/api/src/routes/team.ts`
- Modify: `apps/api/src/index.ts` (mount `/team`)
- Modify: `apps/api/.env.example` (`WEB_PUBLIC_URL`)

**Interfaces:**
- Consumes: `normalizeInviteEmail` (Task 2), `requireAuth` + `requireOwner` (Task 3), `adminDb`.
- Produces: `GET /team`, `POST /team/invite`, `DELETE /team/invite/:email`, `DELETE /team/member/:uid`. Task 7 calls them.

_No unit test — Firestore I/O; verified in Task 8._

- [ ] **Step 1: Create `apps/api/src/routes/team.ts`**

```ts
import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { normalizeInviteEmail } from '../lib/team/invite'

const team = new Hono<{ Variables: AuthVariables }>()

team.use('*', requireAuth)
team.use('*', requireOwner)

/** GET /team — members + pending invites for the workspace */
team.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const [usersSnap, invitesSnap] = await Promise.all([
    adminDb.collection('users').where('workspaceId', '==', workspaceId).get(),
    adminDb.collection('pendingInvites').where('workspaceId', '==', workspaceId).get(),
  ])
  const members = usersSnap.docs.map((d) => {
    const u = d.data()
    return { uid: d.id, email: u.email ?? '', displayName: u.displayName ?? '', role: u.role ?? 'owner' }
  })
  const invites = invitesSnap.docs.map((d) => {
    const i = d.data()
    return { email: i.email as string, createdAt: i.createdAt?.toDate?.() ?? null }
  })
  return c.json({ members, invites })
})

/** POST /team/invite { email } — create a pending invite */
team.post('/invite', async (c) => {
  const workspaceId = c.get('workspaceId')
  const uid = c.get('uid')
  const body = await c.req.json<{ email?: string }>()
  const result = normalizeInviteEmail(body.email ?? '')
  if (!result.ok) return c.json({ error: result.error }, 400)
  const email = result.email

  // Reject if a user with that email already exists
  const existingUser = await adminDb.collection('users').where('email', '==', email).limit(1).get()
  if (!existingUser.empty) {
    return c.json({ error: 'This email already has an Ayooda account.' }, 409)
  }
  // Reject if already invited (anywhere — one invite per email)
  const inviteRef = adminDb.doc(`pendingInvites/${email}`)
  if ((await inviteRef.get()).exists) {
    return c.json({ error: 'This email has already been invited.' }, 409)
  }

  await inviteRef.set({ email, workspaceId, invitedBy: uid, createdAt: new Date() })

  const base = process.env.WEB_PUBLIC_URL ?? ''
  return c.json({ email, inviteLink: `${base}/signup?invite=${encodeURIComponent(email)}` })
})

/** DELETE /team/invite/:email — revoke a pending invite (scoped to this workspace) */
team.delete('/invite/:email', async (c) => {
  const workspaceId = c.get('workspaceId')
  const email = c.req.param('email').trim().toLowerCase()
  const ref = adminDb.doc(`pendingInvites/${email}`)
  const snap = await ref.get()
  if (snap.exists && snap.data()!.workspaceId === workspaceId) {
    await ref.delete()
  }
  return c.json({ ok: true })
})

/** DELETE /team/member/:uid — remove a member (not the owner) */
team.delete('/member/:uid', async (c) => {
  const workspaceId = c.get('workspaceId')
  const targetUid = c.req.param('uid')
  const userRef = adminDb.doc(`users/${targetUid}`)
  const snap = await userRef.get()
  if (!snap.exists || snap.data()!.workspaceId !== workspaceId) {
    return c.json({ error: 'Member not found' }, 404)
  }
  // Never remove the workspace owner
  const wsSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  if (wsSnap.data()?.ownerId === targetUid || snap.data()!.role === 'owner') {
    return c.json({ error: 'Cannot remove the workspace owner' }, 400)
  }
  await userRef.delete()
  return c.json({ ok: true })
})

export default team
```

- [ ] **Step 2: Mount + env**

In `apps/api/src/index.ts`, add `import teamRoutes from './routes/team'` with the others and `app.route('/team', teamRoutes)` (after `/workspace`). In `apps/api/.env.example`, add: `WEB_PUBLIC_URL= # dashboard origin for invite links, e.g. https://app.ayooda.live`.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter api typecheck`
Expected: PASS.
```bash
git add apps/api/src/routes/team.ts apps/api/src/index.ts apps/api/.env.example
git commit -m "feat(api): team endpoints — list, invite, revoke, remove"
```

---

### Task 7: Web — role-based nav + Team page + signup invite prefill

**Files:**
- Modify: `apps/web/src/components/dashboard/Sidebar.tsx`
- Modify: `apps/web/src/app/dashboard/layout.tsx`
- Create: `apps/web/src/app/dashboard/team/page.tsx`
- Modify: `apps/web/src/app/(auth)/signup/page.tsx`

**Interfaces:**
- Consumes: `GET /team`, `POST /team/invite`, `DELETE /team/invite/:email`, `DELETE /team/member/:uid` (Task 6); the role read server-side.
- Produces: the Team UI + member-restricted nav.

_No unit test — UI; verified in Task 8._

- [ ] **Step 1: Pass role from the layout to the Sidebar**

In `apps/web/src/app/dashboard/layout.tsx` (a server component that already reads `users/{uid}` → `userSnap`), compute `const role = (userSnap.data()!.role as 'owner' | 'member') ?? 'owner'` and pass it: `<Sidebar role={role} />`.

- [ ] **Step 2: Role-based nav in `Sidebar.tsx`**

Change the component signature to `export function Sidebar({ role }: { role: 'owner' | 'member' })`. Add `Users` to the lucide import. Keep the existing `navItems`/`bottomItems` arrays but filter by role at render:
- Add a Team entry to `bottomItems`: `{ label: 'Team', href: '/dashboard/team', icon: Users }` (placed before Settings).
- For a **member**, render only the Inbox nav item and NO bottom items (no Billing/Settings/Team). Compute inside the component:
  ```ts
  const visibleNav = role === 'owner' ? navItems : navItems.filter((i) => i.href === '/dashboard/inbox')
  const visibleBottom = role === 'owner' ? bottomItems : []
  ```
  and map `visibleNav`/`visibleBottom` instead of `navItems`/`bottomItems`.

- [ ] **Step 3: Create `apps/web/src/app/dashboard/team/page.tsx`**

A client component matching the dashboard inline-style idiom (see `settings/page.tsx`). It:
- `apiRequest('/team')` → `{ members: Array<{uid,email,displayName,role}>, invites: Array<{email,createdAt}> }`.
- Renders a **Members** card (each row: displayName/email + role badge; a Remove button for rows where `role !== 'owner'` → `DELETE /team/member/{uid}` then refetch).
- Renders a **Pending invites** card (each row: email + a Revoke button → `DELETE /team/invite/{encodeURIComponent(email)}` then refetch). Hidden if none.
- Renders an **Invite** form: an email input + Invite button → `POST /team/invite {email}`. On success, show the returned `inviteLink` with a copy button and refetch; on error (400/409) show the `{error}` inline.
- Use `apiRequest` from `@/lib/api`; escape apostrophes in copy with `&apos;`.

Concrete component:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Copy, Check, Trash2, UserPlus } from 'lucide-react'
import { apiRequest } from '@/lib/api'

interface Member { uid: string; email: string; displayName: string; role: string }
interface Invite { email: string; createdAt: string | null }

const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20 }
const label: React.CSSProperties = { fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }
const input: React.CSSProperties = { flex: 1, padding: '10px 14px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('/team')
      if (res.ok) { const d = await res.json() as { members: Member[]; invites: Invite[] }; setMembers(d.members); setInvites(d.invites) }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function invite() {
    if (!email.trim()) return
    setInviting(true); setError(''); setInviteLink('')
    try {
      const res = await apiRequest('/team/invite', { method: 'POST', body: JSON.stringify({ email: email.trim() }) })
      const d = await res.json().catch(() => ({})) as { inviteLink?: string; error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not send invite'); return }
      setInviteLink(d.inviteLink ?? ''); setEmail(''); await load()
    } finally { setInviting(false) }
  }
  async function revoke(e: string) {
    setBusyId('invite:' + e)
    try { await apiRequest(`/team/invite/${encodeURIComponent(e)}`, { method: 'DELETE' }); await load() } finally { setBusyId('') }
  }
  async function remove(uid: string) {
    setBusyId('member:' + uid)
    try { await apiRequest(`/team/member/${uid}`, { method: 'DELETE' }); await load() } finally { setBusyId('') }
  }

  if (loading) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-mute)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Team</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Invite teammates to help answer conversations.</p>
      </div>

      {/* Invite */}
      <div style={card}>
        <p style={label}>Invite a teammate</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} placeholder="teammate@company.com" style={input} />
          <button type="button" onClick={() => void invite()} disabled={inviting || !email.trim()} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: inviting || !email.trim() ? 0.5 : 1 }}>
            <UserPlus size={14} /> {inviting ? 'Inviting…' : 'Invite'}
          </button>
        </div>
        {error && <p style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>{error}</p>}
        {inviteLink && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 6 }}>Share this link with them (they join when they sign up with the invited email):</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input readOnly value={inviteLink} style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
              <button type="button" onClick={() => { void navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 2000) }} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Members */}
      <div style={card}>
        <p style={label}>Members</p>
        {members.map((m) => (
          <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{m.displayName || m.email}</p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{m.email}</p>
            </div>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20, background: 'var(--bg-2)', color: m.role === 'owner' ? 'var(--accent)' : 'var(--ink-mute)' }}>{m.role}</span>
            {m.role !== 'owner' && (
              <button type="button" onClick={() => void remove(m.uid)} disabled={busyId === 'member:' + m.uid} aria-label="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 6 }}>
                {busyId === 'member:' + m.uid ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div style={card}>
          <p style={label}>Pending invites</p>
          {invites.map((i) => (
            <div key={i.email} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-dim)' }}>{i.email}</span>
              <button type="button" onClick={() => void revoke(i.email)} disabled={busyId === 'invite:' + i.email} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13, color: '#f87171' }}>
                {busyId === 'invite:' + i.email ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Signup `?invite` prefill**

In `apps/web/src/app/(auth)/signup/page.tsx`, read the `invite` search param (Next 16 client component: `useSearchParams()`), and if present, initialize the email field to it and show a small note like "You&apos;re joining a team — sign up with this email." Keep it minimal; do not change the signup logic (auto-join is server-side).

- [ ] **Step 5: Typecheck + lint + build**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: typecheck + build PASS; lint shows only pre-existing failures (none new in the edited/created files).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): team page, role-based nav, signup invite prefill"
```

---

### Task 8: Verification + docs

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm -r typecheck && pnpm -r --if-present test && pnpm --filter web build`
Expected: all pass (invite helper's 6 tests included).

- [ ] **Step 2: Live E2E (real services)**

Use superpowers:verification-before-completion. Start the API; mint an owner ID token for the test workspace (reuse the prior rounds' `.superpowers/sdd/` token scripts). Verify:
1. `GET /workspace` (owner) returns `role: 'owner'`.
2. `POST /team/invite {email: "e2e-teammate-<rand>@example.com"}` → `{ email, inviteLink }`; `GET /team` shows the pending invite; inviting the same email again → 409; inviting an email that already has an account (use the owner's own email) → 409.
3. **Auto-join:** create a brand-new Firebase Auth user with the invited email (scratch script via `adminAuth.createUser`), mint its ID token, `POST /auth/verify` with it → response `workspaceId` equals the owner's workspace; the new `users/{uid}` doc has `role:'member'` and that `workspaceId`; `pendingInvites/{email}` is gone; **no new workspace** was created for them.
4. **Role gates:** with the member's token, `GET /conversations` → 200; `POST /knowledge/scrape` → 403; `GET /channels` → 403; `GET /team` → 403.
5. **Remove:** owner `DELETE /team/member/{memberUid}` → 200 and `users/{memberUid}` is deleted; removing the owner's own uid → 400.
6. **Revoke:** re-invite, then `DELETE /team/invite/{email}` → the pending invite is gone.
Record verified vs. deferred. Clean up: delete the created Firebase Auth test user, any leftover `pendingInvites`, and the member `users` doc.

- [ ] **Step 3: Web check (optional if a web dev server is available)**

Sign in as the owner → the Team nav appears and the page invites/lists/removes. (A full member-session browser check is optional; the API role gates are the enforcement and are covered in Step 2.)

- [ ] **Step 4: Update `docs/architecture.md`**

Add a Team Members section: owner/member roles (role on the user doc, default owner), `pendingInvites/{email}` collection, the auth-verify auto-join intercept, `requireOwner` gating (list the owner-only surfaces), the `/team` endpoints, and the `WEB_PUBLIC_URL` env var. Note remove-member deletes the user doc (they re-provision on next login).

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: architecture updates for team members"
```
