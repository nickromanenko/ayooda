# CRM Integration Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a catalog of prebuilt CRM/e-commerce/support tool templates that prefill the existing tool builder, so owners don't hand-write the HTTP config.

**Architecture:** A typed catalog (`TOOL_TEMPLATES`) + a pure `applyTemplate` live in `packages/shared`. The Tools page gets a picker (gallery → setup fields → the existing editor, pre-filled). No backend or data-model change — creation still flows through `POST /agents/:agentId/tools` with `validateToolInput`.

**Tech Stack:** `@ayooda/shared` (types + catalog + pure fn), Bun + `validateToolInput` (api catalog-validity test), Next.js App Router client page (web). Tests: `bun test`.

## Global Constraints

- **Placeholder syntax:** `{{setupKey}}` = owner setup constant (substituted at apply time); `{param}` = LLM param (left intact). `applyTemplate` only touches `{{…}}`.
- **Catalog lives in `packages/shared`**; the API does not import or serve it. The secret is **always owner-entered**, never in a template.
- **v1 templates are read lookups** (`kind: 'read'`): `shopify_order_lookup`, `stripe_customer_lookup`, `hubspot_contact_lookup`, `zendesk_ticket_lookup`, `generic_rest_get`.
- **Every catalog entry, after applying sample setup values, must pass `validateToolInput`** (https URL, name slug `^[a-zA-Z0-9_-]{1,48}$`, every remaining `{param}` declared, valid auth shape).
- **Web** mirrors the existing Tools-page idiom (`'use client'` + `apiRequest`, inline styles); `apps/web/AGENTS.md` — modified Next.js, no new framework APIs. The template flow only produces a prefilled `FormState`; save/test are unchanged.

---

### Task 1: Shared template types + catalog + `applyTemplate` (+ api validity test)

**Files:**
- Modify: `packages/shared/src/index.ts` (append)
- Create: `apps/api/src/lib/tools/templates.test.ts`

**Interfaces:**
- Consumes: existing shared `ToolMethod`, `ToolParamType`, `ToolAuthType`, `ToolKind`, `ToolParam`; api `validateToolInput` ([apps/api/src/lib/tools/validate.ts](../../../apps/api/src/lib/tools/validate.ts)).
- Produces: `ToolTemplateSetupField`, `ToolTemplate`, `TOOL_TEMPLATES: ToolTemplate[]`, `applyTemplate(template, setupValues): { name; description; method; urlTemplate; params; headers; auth; kind }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/tools/templates.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { TOOL_TEMPLATES, applyTemplate } from '@ayooda/shared'
import { validateToolInput } from './validate'

const SAMPLE: Record<string, string> = { shop: 'my-store', apiVersion: '2024-01', subdomain: 'mycompany', baseUrl: 'https://api.example.com' }

describe('applyTemplate', () => {
  test('substitutes {{setup}} and leaves {param} intact', () => {
    const shopify = TOOL_TEMPLATES.find((t) => t.id === 'shopify_order_lookup')!
    const applied = applyTemplate(shopify, SAMPLE)
    expect(applied.urlTemplate).toBe('https://my-store.myshopify.com/admin/api/2024-01/orders.json?status=any&name={orderNumber}')
    expect(applied.auth).toEqual({ type: 'header', headerName: 'X-Shopify-Access-Token' })
    expect(applied.name).toBe('shopify_order_lookup')
  })
  test('handles a template with no setup fields', () => {
    const stripe = TOOL_TEMPLATES.find((t) => t.id === 'stripe_customer_lookup')!
    expect(applyTemplate(stripe, {}).urlTemplate).toBe('https://api.stripe.com/v1/customers?email={email}')
  })
  test('substitutes a base-url setup field for the generic template', () => {
    const generic = TOOL_TEMPLATES.find((t) => t.id === 'generic_rest_get')!
    expect(applyTemplate(generic, SAMPLE).urlTemplate).toBe('https://api.example.com/{id}')
  })
})

describe('catalog validity', () => {
  test('every template produces a payload that passes validateToolInput', () => {
    const failures = TOOL_TEMPLATES
      .filter((t) => !validateToolInput({ ...applyTemplate(t, SAMPLE), writeEnabled: false, enabled: true }).ok)
      .map((t) => t.id)
    expect(failures).toEqual([])
  })
  test('ships the five expected templates', () => {
    expect(TOOL_TEMPLATES.map((t) => t.id).sort()).toEqual(
      ['generic_rest_get', 'hubspot_contact_lookup', 'shopify_order_lookup', 'stripe_customer_lookup', 'zendesk_ticket_lookup'],
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/tools/templates.test.ts`
Expected: FAIL — `TOOL_TEMPLATES` / `applyTemplate` are not exported from `@ayooda/shared`.

- [ ] **Step 3: Add the types, catalog, and `applyTemplate` to shared**

Append to `packages/shared/src/index.ts`:

```ts
// ---------------------------------------------------------------------------
// Tool templates (CRM / e-commerce starters)
// ---------------------------------------------------------------------------

export interface ToolTemplateSetupField {
  key: string          // referenced in the template as {{key}}
  label: string
  placeholder?: string
  help?: string
}

export interface ToolTemplate {
  id: string
  label: string
  category: string     // 'E-commerce' | 'CRM' | 'Support' | 'Generic'
  description: string
  setupFields: ToolTemplateSetupField[]
  toolName: string     // slug for the created tool
  toolDescription: string
  method: ToolMethod
  urlTemplate: string  // may contain {{setup}} and {param}
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>  // values may contain {{setup}}
  auth: { type: ToolAuthType; headerName?: string } // no secret — owner-entered
  kind: ToolKind
  secretLabel: string
}

export const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    id: 'shopify_order_lookup',
    label: 'Shopify — order lookup',
    category: 'E-commerce',
    description: 'Look up an order by its order number in your Shopify store.',
    setupFields: [
      { key: 'shop', label: 'Store subdomain', placeholder: 'my-store', help: 'The part before .myshopify.com' },
      { key: 'apiVersion', label: 'API version', placeholder: '2024-01' },
    ],
    toolName: 'shopify_order_lookup',
    toolDescription: 'Look up a Shopify order by its order number (e.g. #1001) to check status, fulfillment, and totals.',
    method: 'GET',
    urlTemplate: 'https://{{shop}}.myshopify.com/admin/api/{{apiVersion}}/orders.json?status=any&name={orderNumber}',
    params: [{ name: 'orderNumber', type: 'string', description: 'The order number, e.g. #1001', required: true }],
    headers: [],
    auth: { type: 'header', headerName: 'X-Shopify-Access-Token' },
    kind: 'read',
    secretLabel: 'Shopify Admin API access token',
  },
  {
    id: 'stripe_customer_lookup',
    label: 'Stripe — customer lookup',
    category: 'CRM',
    description: 'Find a Stripe customer by email address.',
    setupFields: [],
    toolName: 'stripe_customer_lookup',
    toolDescription: 'Look up a Stripe customer by email to check their account and subscription details.',
    method: 'GET',
    urlTemplate: 'https://api.stripe.com/v1/customers?email={email}',
    params: [{ name: 'email', type: 'string', description: "The customer's email address", required: true }],
    headers: [],
    auth: { type: 'bearer' },
    kind: 'read',
    secretLabel: 'Stripe secret key (sk_…)',
  },
  {
    id: 'hubspot_contact_lookup',
    label: 'HubSpot — contact by id',
    category: 'CRM',
    description: 'Fetch a HubSpot contact by its record id.',
    setupFields: [],
    toolName: 'hubspot_contact_lookup',
    toolDescription: 'Fetch a HubSpot contact by its record id to read their name, email, and phone.',
    method: 'GET',
    urlTemplate: 'https://api.hubapi.com/crm/v3/objects/contacts/{contactId}?properties=email,firstname,lastname,phone',
    params: [{ name: 'contactId', type: 'string', description: 'The HubSpot contact record id', required: true }],
    headers: [],
    auth: { type: 'bearer' },
    kind: 'read',
    secretLabel: 'HubSpot private-app token',
  },
  {
    id: 'zendesk_ticket_lookup',
    label: 'Zendesk — ticket lookup',
    category: 'Support',
    description: 'Look up a Zendesk support ticket by id.',
    setupFields: [{ key: 'subdomain', label: 'Zendesk subdomain', placeholder: 'mycompany', help: 'The part before .zendesk.com' }],
    toolName: 'zendesk_ticket_lookup',
    toolDescription: 'Look up a Zendesk support ticket by its id to check its status and latest comments.',
    method: 'GET',
    urlTemplate: 'https://{{subdomain}}.zendesk.com/api/v2/tickets/{ticketId}.json',
    params: [{ name: 'ticketId', type: 'string', description: 'The Zendesk ticket id', required: true }],
    headers: [],
    auth: { type: 'header', headerName: 'Authorization' },
    kind: 'read',
    secretLabel: 'Basic auth value — "Basic " + base64("you@co.com/token:APITOKEN")',
  },
  {
    id: 'generic_rest_get',
    label: 'Generic REST (GET)',
    category: 'Generic',
    description: 'A blank GET request to any REST API — a starting point you can edit.',
    setupFields: [{ key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com', help: 'Without a trailing slash' }],
    toolName: 'rest_lookup',
    toolDescription: 'Look up a record by id from an external API.',
    method: 'GET',
    urlTemplate: '{{baseUrl}}/{id}',
    params: [{ name: 'id', type: 'string', description: 'The record id to look up', required: true }],
    headers: [],
    auth: { type: 'bearer' },
    kind: 'read',
    secretLabel: 'Bearer token (or set auth to None for a public API)',
  },
]

/** Substitute {{setup}} placeholders (URL + header values) from setupValues; leave {param} intact. */
export function applyTemplate(
  template: ToolTemplate,
  setupValues: Record<string, string>,
): {
  name: string
  description: string
  method: ToolMethod
  urlTemplate: string
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>
  auth: { type: ToolAuthType; headerName?: string }
  kind: ToolKind
} {
  const sub = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => setupValues[k] ?? '')
  return {
    name: template.toolName,
    description: template.toolDescription,
    method: template.method,
    urlTemplate: sub(template.urlTemplate),
    params: template.params.map((p) => ({ ...p })),
    headers: template.headers.map((h) => ({ key: h.key, value: sub(h.value) })),
    auth: { ...template.auth },
    kind: template.kind,
  }
}
```

- [ ] **Step 4: Build shared, then run the test**

Run: `pnpm --filter @ayooda/shared typecheck && pnpm --filter @ayooda/shared build && cd apps/api && bun test src/lib/tools/templates.test.ts`
Expected: PASS (all `applyTemplate` + catalog-validity tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts apps/api/src/lib/tools/templates.test.ts
git commit -m "feat(shared): CRM tool template catalog + applyTemplate"
```

---

### Task 2: Tools page — template picker

**Files:**
- Modify: `apps/web/src/app/dashboard/tools/page.tsx`

**Interfaces:**
- Consumes: `TOOL_TEMPLATES`, `applyTemplate`, `ToolTemplate` (Task 1); the existing `FormState` + editor.

- [ ] **Step 1: Import the catalog + type**

In `apps/web/src/app/dashboard/tools/page.tsx`, extend the `@ayooda/shared` import to add the catalog, the fn, and the type:

```ts
import { TOOL_TEMPLATES, applyTemplate, type ToolDef, type ToolMethod, type ToolParamType, type ToolAuthType, type ToolKind, type ToolTemplate } from '@ayooda/shared'
```

(Merge with the existing `import type { … } from '@ayooda/shared'` line — it becomes a single `import { … }` since `TOOL_TEMPLATES`/`applyTemplate` are runtime values.)

- [ ] **Step 2: Add picker state + the apply helper**

After the `agentId` state declarations, add:

```ts
  const [picker, setPicker] = useState<'gallery' | { template: ToolTemplate; setup: Record<string, string> } | null>(null)
```

Add a helper next to `startCreate`:

```ts
  function chooseTemplate(template: ToolTemplate) {
    setPicker({ template, setup: Object.fromEntries(template.setupFields.map((f) => [f.key, ''])) })
  }
  function applyPickedTemplate(p: { template: ToolTemplate; setup: Record<string, string> }) {
    const a = applyTemplate(p.template, p.setup)
    setForm({
      id: null,
      name: a.name, description: a.description, method: a.method, urlTemplate: a.urlTemplate,
      params: a.params.map((x) => ({ ...x })), headers: a.headers.map((x) => ({ ...x })),
      authType: a.auth.type, headerName: a.auth.headerName ?? '', secret: '', hasSecret: false,
      kind: a.kind, writeEnabled: false, enabled: true,
    })
    setPicker(null); setError(''); setTestResult(''); setTestArgs('{}')
  }
```

- [ ] **Step 3: Header buttons — add "Start from a template"**

Replace the header's single "New tool" button:

```tsx
        {!form && <button type="button" onClick={startCreate} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 16px' }}><Plus size={14} /> New tool</button>}
```

with (shown only when neither editing nor picking):

```tsx
        {!form && !picker && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setPicker('gallery')} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 16px' }}>Start from a template</button>
            <button type="button" onClick={startCreate} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 16px' }}><Plus size={14} /> New tool</button>
          </div>
        )}
```

- [ ] **Step 4: Guard the tools list + add the picker UI**

Change the tools-list block guard from `{!form && (` to `{!form && !picker && (` (so the list hides while picking). Its opening line is:

```tsx
      {!form && (
        <div style={card}>
          <p style={label}>Your tools</p>
```

becomes:

```tsx
      {!form && !picker && (
        <div style={card}>
          <p style={label}>Your tools</p>
```

Then, immediately **after** that list block's closing `)}`, add the picker UI:

```tsx
      {picker === 'gallery' && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={label}>Choose a template</p>
            <button type="button" onClick={() => setPicker(null)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>Cancel</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {TOOL_TEMPLATES.map((t) => (
              <button key={t.id} type="button" onClick={() => chooseTemplate(t)} style={{ textAlign: 'left', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-sm)', padding: 14, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t.label}</span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 20, background: 'var(--panel-2)', color: 'var(--ink-mute)' }}>{t.category}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{t.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {picker && picker !== 'gallery' && (
        <div style={card}>
          <p style={label}>{picker.template.label}</p>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 16 }}>{picker.template.description}</p>
          {picker.template.setupFields.map((f) => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'block', marginBottom: 4 }}>{f.label}</label>
              <input
                placeholder={f.placeholder}
                value={picker.setup[f.key] ?? ''}
                onChange={(e) => setPicker({ template: picker.template, setup: { ...picker.setup, [f.key]: e.target.value } })}
                style={input}
              />
              {f.help && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>{f.help}</p>}
            </div>
          ))}
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 8 }}>You'll add the secret next: <strong style={{ color: 'var(--ink-dim)' }}>{picker.template.secretLabel}</strong></p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => applyPickedTemplate(picker)}
              disabled={picker.template.setupFields.some((f) => !picker.setup[f.key]?.trim())}
              className="btn btn-primary"
              style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: picker.template.setupFields.some((f) => !picker.setup[f.key]?.trim()) ? 0.5 : 1 }}
            >
              Continue
            </button>
            <button type="button" onClick={() => setPicker('gallery')} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Back</button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/dashboard/tools/page.tsx
git commit -m "feat(web): CRM template picker on the Tools page"
```

---

## Live E2E (after all tasks — from the spec §5)

Against the dev API + web with a real workspace:

1. Open **Tools → Start from a template**; the gallery shows all five (Shopify, Stripe, HubSpot, Zendesk, Generic).
2. Pick **Shopify — order lookup**, fill `shop` + `apiVersion`, **Continue** → the editor opens pre-filled with the substituted URL, the `orderNumber` param, and `X-Shopify-Access-Token` header auth; the secret field is empty.
3. Enter a real Admin API token, **Save**, then **Test** with `{ "orderNumber": "#1001" }` → a real order JSON comes back.
4. In a widget chat, ask about that order → the agent calls the tool and answers from the result.
5. Rename collision: applying the same template twice → the second save 409s ("A tool with that name already exists.") until renamed.

Clean up test tools.

## Out of scope (v1)

OAuth CRMs (Salesforce); nested-body search APIs (HubSpot contact-by-email); write templates; a server-side connector subsystem; template versioning / remote catalog; auto-detecting the owner's CRM.
