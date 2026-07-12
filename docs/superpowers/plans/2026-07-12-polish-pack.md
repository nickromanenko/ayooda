# Ayooda Polish Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three v1-polish items from `docs/superpowers/specs/2026-07-12-polish-pack-design.md`: a real Settings page, knowledge re-indexing, and in-memory rate limiting on the public widget endpoints.

**Architecture:** A pure sliding-window rate limiter guards `POST /widget/chat` and the SSE events endpoint. A new `POST /knowledge/:id/reindex` re-triggers the existing ingestor after clearing old vectors. New `PUT /workspace`, `GET/PUT /user` endpoints back a rebuilt Settings page (profile, workspace rename, embed snippet, sign out). All additive; no schema migrations.

**Tech Stack:** Hono 4 on Bun (`apps/api`), Next.js 16 App Router (`apps/web`), firebase-admin 12, `bun test`.

## Global Constraints

- `apps/web` is **Next.js 16** — per `apps/web/AGENTS.md`, consult `apps/web/node_modules/next/dist/docs/` before App Router work; APIs differ from training data. All pages here are client components, so this rarely bites.
- API on **Bun**; run `corepack enable` if `pnpm` is missing.
- Match the inline-style + CSS-var idiom of the file you edit (see `apps/web/src/app/dashboard/agent/page.tsx`). No new styling systems.
- Rate limiter is **per-instance in-memory** (Cloud Run may scale → effective limit × instances). This is acceptable abuse-protection, documented as such. No Redis.
- Rate-limit thresholds (exact, module constants): chat 60/min per channel, 30/min per IP; events 20/min per IP. Window = 60_000 ms. 429 responses carry a `Retry-After` header in seconds.
- New API validation failures return JSON 4xx **before** any side effect.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Sliding-window rate limiter (pure lib)

**Files:**
- Create: `apps/api/src/lib/rate-limit.ts`
- Create: `apps/api/src/lib/rate-limit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `rateLimit(key: string, limit: number, windowMs: number, now?: number): { ok: boolean; retryAfterMs: number }` — pure sliding-window counter over a module-level `Map`. Task 2 calls it.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/rate-limit.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { rateLimit, __resetRateLimit } from './rate-limit'

describe('rateLimit', () => {
  test('allows up to the limit then rejects', () => {
    __resetRateLimit()
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, 1000, 0).ok).toBe(true)
    }
    const denied = rateLimit('k', 3, 1000, 0)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfterMs).toBe(1000) // oldest at t=0, window 1000, now 0
  })

  test('window slides as the clock advances', () => {
    __resetRateLimit()
    expect(rateLimit('k', 1, 1000, 0).ok).toBe(true)
    expect(rateLimit('k', 1, 1000, 500).ok).toBe(false) // still in window
    expect(rateLimit('k', 1, 1000, 1000).ok).toBe(true) // first ts expired (>= now-window)
  })

  test('keys are independent', () => {
    __resetRateLimit()
    expect(rateLimit('a', 1, 1000, 0).ok).toBe(true)
    expect(rateLimit('b', 1, 1000, 0).ok).toBe(true)
  })

  test('retryAfterMs reflects the oldest in-window timestamp', () => {
    __resetRateLimit()
    rateLimit('k', 2, 1000, 100)
    rateLimit('k', 2, 1000, 300)
    const denied = rateLimit('k', 2, 1000, 800)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfterMs).toBe(300) // oldest(100)+1000-800
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/rate-limit.test.ts`
Expected: FAIL — cannot resolve `./rate-limit`.

- [ ] **Step 3: Implement `apps/api/src/lib/rate-limit.ts`**

```ts
/**
 * In-memory sliding-window rate limiter.
 * Per-instance only (Cloud Run may run several instances → effective limit scales
 * with instance count). Adequate for abuse protection on public endpoints.
 */

const buckets = new Map<string, number[]>()

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { ok: boolean; retryAfterMs: number } {
  const cutoff = now - windowMs
  const times = (buckets.get(key) ?? []).filter((t) => t > cutoff)

  if (times.length >= limit) {
    const oldest = times[0]
    buckets.set(key, times)
    return { ok: false, retryAfterMs: oldest + windowMs - now }
  }

  times.push(now)
  buckets.set(key, times)
  return { ok: true, retryAfterMs: 0 }
}

/** Test-only: clear all buckets between cases. */
export function __resetRateLimit(): void {
  buckets.clear()
}
```

Note the window boundary: a timestamp is "in window" when `t > now - windowMs` (strict), so the test's `now=1000` case (first ts at 0, `0 > 0` is false) correctly expires it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/rate-limit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/lib/rate-limit.ts apps/api/src/lib/rate-limit.test.ts
git commit -m "feat(api): in-memory sliding-window rate limiter"
```

---

### Task 2: Rate-limit the public widget endpoints

**Files:**
- Modify: `apps/api/src/routes/widget.ts`

**Interfaces:**
- Consumes: `rateLimit` from Task 1.
- Produces: `POST /widget/chat` and `GET /widget/conversations/:id/events` return `429 { error: 'Too many requests' }` with `Retry-After` (seconds) when limits are exceeded.

_No unit test — thin glue over the tested limiter; verified by Task 6 E2E (429 under load)._

- [ ] **Step 1: Add the import and limit constants**

In `apps/api/src/routes/widget.ts`, add to the imports near the top:

```ts
import { rateLimit } from '../lib/rate-limit'
```

Below the existing `const HEARTBEAT_MS` (or near the top of the file with other constants), add:

```ts
const RATE_WINDOW_MS = 60_000
const CHAT_LIMIT_PER_CHANNEL = 60
const CHAT_LIMIT_PER_IP = 30
const EVENTS_LIMIT_PER_IP = 20

/** Best-effort client IP from Cloud Run's forwarding headers. */
function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return c.req.header('x-real-ip') ?? 'unknown'
}
```

- [ ] **Step 2: Guard `POST /widget/chat`**

In the `widget.post('/chat', ...)` handler, immediately after the field-validation block (the existing `if (!channelId || !conversationId || !message?.trim() || !visitorId) { ... }`) and before the channel lookup, add:

```ts
  // Rate limit before any Firestore/LLM work
  const ip = clientIp(c)
  const chLimit = rateLimit(`chat:ch:${channelId}`, CHAT_LIMIT_PER_CHANNEL, RATE_WINDOW_MS)
  const ipLimit = rateLimit(`chat:ip:${ip}`, CHAT_LIMIT_PER_IP, RATE_WINDOW_MS)
  const worst = !chLimit.ok ? chLimit : !ipLimit.ok ? ipLimit : null
  if (worst) {
    c.header('Retry-After', String(Math.ceil(worst.retryAfterMs / 1000)))
    return c.json({ error: 'Too many requests' }, 429)
  }
```

- [ ] **Step 3: Guard the events endpoint**

In `widget.get('/conversations/:conversationId/events', ...)`, after the `if (!channelId || !visitorId) { ... }` validation and before `findChannel`, add:

```ts
  const ip = clientIp(c)
  const evLimit = rateLimit(`events:ip:${ip}`, EVENTS_LIMIT_PER_IP, RATE_WINDOW_MS)
  if (!evLimit.ok) {
    c.header('Retry-After', String(Math.ceil(evLimit.retryAfterMs / 1000)))
    return c.json({ error: 'Too many requests' }, 429)
  }
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter api typecheck`
Expected: PASS.
```bash
git add apps/api/src/routes/widget.ts
git commit -m "feat(api): rate-limit public widget chat and events endpoints"
```

---

### Task 3: Re-index a knowledge source (API + web)

**Files:**
- Modify: `apps/api/src/routes/knowledge.ts`
- Modify: `apps/web/src/app/dashboard/knowledge/page.tsx`

**Interfaces:**
- Consumes: existing `triggerIngestion`, `namespaceFor`, `adminDb`.
- Produces: `POST /knowledge/:id/reindex` → `{ ok: true, status: 'pending' }` (or 404/409). A re-index button on each eligible doc row.

_No unit test — Firestore/ingestor side effects; verified in Task 6 E2E._

- [ ] **Step 1: Add the reindex endpoint**

In `apps/api/src/routes/knowledge.ts`, add after the `POST /upload` route (and before `DELETE /:id`):

```ts
/** POST /knowledge/:id/reindex — clear vectors and re-run ingestion for an existing doc */
knowledge.post('/:id/reindex', async (c) => {
  const workspaceId = c.get('workspaceId')
  const docId = c.req.param('id')

  const docRef = adminDb.doc(`workspaces/${workspaceId}/knowledge/${docId}`)
  const snap = await docRef.get()
  if (!snap.exists) return c.json({ error: 'Not found' }, 404)

  const data = snap.data() as {
    type: 'webpage' | 'file'
    source: string
    storagePath?: string
  }

  if (data.type === 'file' && !data.storagePath) {
    return c.json({ error: 'This file cannot be re-indexed (no stored file).' }, 409)
  }

  // Best-effort clear existing vectors (same as delete)
  try {
    await namespaceFor(workspaceId).deleteMany({ docId })
  } catch (err) {
    console.warn(`[knowledge] Pinecone clear failed for reindex ${docId}:`, err)
  }

  await docRef.update({
    status: 'pending',
    chunkCount: 0,
    errorMessage: null,
    indexedAt: null,
  })

  triggerIngestion(
    data.type === 'file'
      ? { workspaceId, docId, docType: 'file', storagePath: data.storagePath }
      : { workspaceId, docId, docType: 'webpage', url: data.source },
  )

  return c.json({ ok: true, status: 'pending' })
})
```

- [ ] **Step 2: Typecheck the API**

Run: `pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 3: Add the re-index button on the knowledge page**

In `apps/web/src/app/dashboard/knowledge/page.tsx`:

1. Add `RotateCw` to the lucide import (the line importing `Trash2` etc.): `import { Globe, Loader2, CheckCircle2, XCircle, Trash2, Plus, AlertCircle, FileText, RotateCw } from 'lucide-react'` (keep whatever icons are already imported; add `RotateCw`).
2. Add state next to `deletingId`: `const [reindexingId, setReindexingId] = useState<string | null>(null)`.
3. Add the handler next to `handleDelete`:

```tsx
  async function handleReindex(id: string) {
    setReindexingId(id)
    try {
      await apiRequest(`/knowledge/${id}/reindex`, { method: 'POST' })
      await fetchDocs()
    } finally {
      setReindexingId(null)
    }
  }
```

4. In the doc-row JSX, immediately before the existing delete `<button>`, add a re-index button shown only for `indexed`/`error` docs:

```tsx
                {(doc.status === 'indexed' || doc.status === 'error') && (
                  <button
                    type="button"
                    onClick={() => void handleReindex(doc.id)}
                    disabled={reindexingId === doc.id}
                    style={{ flexShrink: 0, padding: 6, borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', opacity: reindexingId === doc.id ? 0.4 : 1, transition: 'color .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-mute)')}
                    aria-label="Re-index"
                  >
                    {reindexingId === doc.id
                      ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                      : <RotateCw size={14} />}
                  </button>
                )}
```

- [ ] **Step 4: Typecheck + lint the web app**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: typecheck PASS; lint shows only the 16 pre-existing failures (none in `knowledge/page.tsx`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/knowledge.ts apps/web/src/app/dashboard/knowledge/page.tsx
git commit -m "feat: re-index knowledge sources on demand"
```

---

### Task 4: User + workspace settings endpoints

**Files:**
- Create: `apps/api/src/routes/user.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/routes/workspace.ts`

**Interfaces:**
- Consumes: `requireAuth`, `adminDb`, `adminAuth`.
- Produces: `GET /user` → `{ email, displayName, photoURL }`; `PUT /user` `{ displayName }` → `{ ok: true }`; `PUT /workspace` `{ name }` → `{ ok: true }`. Task 5 calls all three.

_No unit test — Firestore/Auth side effects; verified in Task 6 E2E._

- [ ] **Step 1: Create the user route**

Create `apps/api/src/routes/user.ts`:

```ts
import { Hono } from 'hono'
import { adminDb, adminAuth } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'

const user = new Hono<{ Variables: AuthVariables }>()

user.use('*', requireAuth)

/** GET /user — current user's profile */
user.get('/', async (c) => {
  const uid = c.get('uid')
  const snap = await adminDb.doc(`users/${uid}`).get()
  if (!snap.exists) return c.json({ error: 'User not found' }, 404)
  const data = snap.data()!
  return c.json({
    email: data.email,
    displayName: data.displayName ?? '',
    photoURL: data.photoURL ?? null,
  })
})

/** PUT /user — update display name (Firestore + Firebase Auth) */
user.put('/', async (c) => {
  const uid = c.get('uid')
  const body = await c.req.json<{ displayName?: string }>()
  const displayName = body.displayName?.trim()
  if (!displayName || displayName.length > 80) {
    return c.json({ error: 'displayName is required (max 80 chars)' }, 400)
  }
  await adminDb.doc(`users/${uid}`).update({ displayName })
  await adminAuth.updateUser(uid, { displayName })
  return c.json({ ok: true })
})

export default user
```

- [ ] **Step 2: Mount the user route**

In `apps/api/src/index.ts`, add the import alongside the others (after `import workspaceRoutes ...`):

```ts
import userRoutes from './routes/user'
```

And mount it alongside the others (after `app.route('/workspace', workspaceRoutes)`):

```ts
app.route('/user', userRoutes)
```

- [ ] **Step 3: Add `PUT /workspace` (rename)**

In `apps/api/src/routes/workspace.ts`, add after the `GET /` handler (before `PUT /agent`):

```ts
/** PUT /workspace — rename the workspace */
workspace.put('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()
  if (!name || name.length > 80) {
    return c.json({ error: 'name is required (max 80 chars)' }, 400)
  }
  await adminDb.doc(`workspaces/${workspaceId}`).update({ name })
  return c.json({ ok: true })
})
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter api typecheck`
Expected: PASS.
```bash
git add apps/api/src/routes/user.ts apps/api/src/index.ts apps/api/src/routes/workspace.ts
git commit -m "feat(api): user profile + workspace rename endpoints"
```

---

### Task 5: Settings page

**Files:**
- Modify: `apps/web/src/app/dashboard/settings/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `GET/PUT /user`, `PUT /workspace`, `GET /channels` (Task 4 + existing); `useWorkspace`, `apiRequest`, `useAuth().signOut`.
- Produces: the user-visible settings page.

_No unit test — thin UI; verified in Task 6 E2E._

- [ ] **Step 1: Replace the settings page**

Replace the entire contents of `apps/web/src/app/dashboard/settings/page.tsx`:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Check, Copy, LogOut } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/components/providers/AuthProvider'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)',
  background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14,
  outline: 'none', fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontFamily: 'var(--font-mono)',
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 8,
}
const cardStyle: React.CSSProperties = {
  background: 'var(--panel)', border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20,
}

function SaveButton({ saving, saved, disabled }: { saving: boolean; saved: boolean; disabled?: boolean }) {
  return (
    <button type="submit" disabled={saving || disabled} className="btn btn-primary"
      style={{ justifyContent: 'center', borderRadius: 'var(--r-sm)', minWidth: 130,
        opacity: saving || disabled ? 0.5 : 1, cursor: saving || disabled ? 'not-allowed' : 'pointer',
        background: saved ? 'var(--mint)' : undefined, color: saved ? '#081a10' : undefined }}>
      {saving ? <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</span>
        : saved ? <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Check size={14} /> Saved</span>
        : 'Save changes'}
    </button>
  )
}

export default function SettingsPage() {
  const { signOut } = useAuth()

  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [embedCode, setEmbedCode] = useState('')
  const [loading, setLoading] = useState(true)

  const [savingProfile, setSavingProfile] = useState(false)
  const [savedProfile, setSavedProfile] = useState(false)
  const [savingWs, setSavingWs] = useState(false)
  const [savedWs, setSavedWs] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [userRes, wsRes, chRes] = await Promise.all([
        apiRequest('/user'),
        apiRequest('/workspace'),
        apiRequest('/channels'),
      ])
      if (userRes.ok) {
        const u = await userRes.json() as { email: string; displayName: string }
        setEmail(u.email); setDisplayName(u.displayName)
      }
      if (wsRes.ok) {
        const w = await wsRes.json() as { name: string }
        setWorkspaceName(w.name)
      }
      if (chRes.ok) {
        const channels = await chRes.json() as Array<{ type: string; embedCode?: string }>
        const widget = channels.find((c) => c.type === 'web_widget')
        if (widget?.embedCode) setEmbedCode(widget.embedCode)
      }
    } catch {
      setError('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) return
    setSavingProfile(true); setSavedProfile(false); setError('')
    try {
      const res = await apiRequest('/user', { method: 'PUT', body: JSON.stringify({ displayName: displayName.trim() }) })
      if (!res.ok) throw new Error('Failed to save profile')
      setSavedProfile(true); setTimeout(() => setSavedProfile(false), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setSavingProfile(false) }
  }

  async function saveWorkspace(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceName.trim()) return
    setSavingWs(true); setSavedWs(false); setError('')
    try {
      const res = await apiRequest('/workspace', { method: 'PUT', body: JSON.stringify({ name: workspaceName.trim() }) })
      if (!res.ok) throw new Error('Failed to save workspace')
      setSavedWs(true); setTimeout(() => setSavedWs(false), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setSavingWs(false) }
  }

  function copyEmbed() {
    void navigator.clipboard.writeText(embedCode)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink-mute)', padding: '48px 0', justifyContent: 'center' }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} /> Loading…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Manage your profile, workspace, and widget.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13, marginBottom: 20 }}>{error}</div>
      )}

      {/* Profile */}
      <form onSubmit={(e) => void saveProfile(e)} style={cardStyle}>
        <p style={labelStyle}>Profile</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="displayName" style={{ ...labelStyle, textTransform: 'none', fontFamily: 'var(--font-sans)', letterSpacing: 0, fontSize: 13 }}>Display name</label>
            <input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="email" style={{ ...labelStyle, textTransform: 'none', fontFamily: 'var(--font-sans)', letterSpacing: 0, fontSize: 13 }}>Email</label>
            <input id="email" type="email" value={email} disabled style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }} />
          </div>
          <div><SaveButton saving={savingProfile} saved={savedProfile} disabled={!displayName.trim()} /></div>
        </div>
      </form>

      {/* Workspace */}
      <form onSubmit={(e) => void saveWorkspace(e)} style={cardStyle}>
        <p style={labelStyle}>Workspace</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="wsName" style={{ ...labelStyle, textTransform: 'none', fontFamily: 'var(--font-sans)', letterSpacing: 0, fontSize: 13 }}>Workspace name</label>
            <input id="wsName" type="text" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} style={inputStyle} />
          </div>
          <div><SaveButton saving={savingWs} saved={savedWs} disabled={!workspaceName.trim()} /></div>
        </div>
      </form>

      {/* Widget install */}
      <div style={cardStyle}>
        <p style={labelStyle}>Widget install</p>
        {embedCode ? (
          <>
            <pre style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-sm)', padding: 12, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', overflowX: 'auto', margin: '0 0 12px' }}>{embedCode}</pre>
            <button type="button" onClick={copyEmbed} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px' }}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy snippet'}
            </button>
          </>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>No widget yet. <a href="/dashboard/channels" style={{ color: 'var(--accent)' }}>Set one up →</a></p>
        )}
      </div>

      {/* Sign out */}
      <div style={cardStyle}>
        <p style={labelStyle}>Session</p>
        <button type="button" onClick={() => void signOut()} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', color: '#f87171' }}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: typecheck + build PASS; lint shows only the 16 pre-existing failures (none in `settings/page.tsx`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/dashboard/settings/page.tsx
git commit -m "feat(web): real settings page — profile, workspace, embed, sign out"
```

---

### Task 6: Verification pass

**Files:** none (verification only).

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm -r typecheck && pnpm -r --if-present test && pnpm --filter web build`
Expected: all pass (rate-limit tests included in the api suite).

- [ ] **Step 2: Live E2E (requires `apps/api/.env` + web dev server)**

Use superpowers:verification-before-completion. Start `pnpm --filter api dev` (port 3001) and `pnpm --filter web dev`. Sign in (reuse the token-minting approach from the prior round's `.superpowers/sdd/` scripts if convenient). Verify:
1. **Rate limit:** `for i in $(seq 1 35); do curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3001/widget/chat -H 'Content-Type: application/json' -d '{"channelId":"<real>","conversationId":"rl-test","message":"hi","visitorId":"rl-'$i'"}'; done` — later requests return `429` once the per-IP limit (30) is crossed; confirm a `Retry-After` header on one via `curl -si`.
2. **Re-index:** on the knowledge page, an indexed doc shows the re-index button; clicking returns it to "Indexing" then "Indexed"; API `POST /knowledge/:id/reindex` returns `{ ok: true, status: 'pending' }`.
3. **Settings:** display-name save persists (re-fetch `GET /user` shows it; the Firebase Auth user's displayName updates); workspace rename persists (sidebar/name reflects it after reload); embed snippet copies; sign out redirects to `/login`.

Record verified vs. skipped in the final report. Clean up any test conversations created.

- [ ] **Step 3: No commit** (verification only). Report results.
