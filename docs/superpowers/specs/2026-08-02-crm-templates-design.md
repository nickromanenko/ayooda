# Ayooda Sub-project I — CRM Integration Templates — Design Spec

**Date:** 2026-08-02
**Status:** Approved for planning
**Scope:** Prebuilt, one-click templates that prefill the existing tool builder for common CRM/e-commerce/support APIs, so an owner doesn't hand-write the HTTP config. A template is a typed catalog entry + a pure substitution function + a picker on the Tools page. No backend or data-model change — creation still flows through the existing `POST /agents/:agentId/tools` with `validateToolInput`.

## Background

The tool/webhook actions feature ([apps/api/src/routes/tools.ts](../../../apps/api/src/routes/tools.ts), [apps/api/src/lib/chat/tools.ts](../../../apps/api/src/lib/chat/tools.ts)) lets an owner define per-agent HTTP tools: `name`, `description`, `method`, `urlTemplate` with `{param}` placeholders, `params[]`, `headers[]`, an AES-encrypted `bearer`/`header` auth secret, and `kind` (`read`/`write` with `writeEnabled`). Tools execute during a chat via the SSRF-guarded `executeTool` (params fill `{placeholder}`s in the URL, then leftover args go to the query string for GET or a flat JSON body for writes). Today the owner writes all of that by hand on the Tools page ([apps/web/src/app/dashboard/tools/page.tsx](../../../apps/web/src/app/dashboard/tools/page.tsx)).

This adds a catalog of ready-made templates to eliminate that friction for common APIs.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Mechanism | **Prefill + setup fields.** A template declares owner-provided "setup fields" (e.g. store subdomain) substituted into the URL/headers at apply time, producing a ready tool that opens in the existing editor. |
| Placeholder syntax | **`{{setupKey}}`** = setup constant (substituted at apply time); **`{param}`** = LLM param (left intact for runtime). |
| Where it lives | **`packages/shared`** — the typed catalog `TOOL_TEMPLATES` + a pure `applyTemplate`. Web imports both; the API is unchanged (an api unit test cross-checks the catalog against `validateToolInput`). |
| Templates (v1) | **Shopify order lookup, Stripe customer lookup, HubSpot contact-by-id, Zendesk ticket lookup, Generic REST (GET)** — all **read** lookups. |
| Secret | **Always owner-entered**, never in a template. Each template carries a `secretLabel` to guide the owner. |

Constraint that shaped the set: the executor supports `{placeholder}`/query-param GETs and flat-body writes, with static `bearer`/`header` secrets — so v1 excludes OAuth CRMs (Salesforce) and nested-body search APIs (HubSpot contact-by-email).

---

## 1. Catalog + types (`packages/shared/src/index.ts`)

```ts
export interface ToolTemplateSetupField {
  key: string          // e.g. 'shop' — referenced as {{shop}}
  label: string        // 'Store subdomain'
  placeholder?: string // 'my-store'
  help?: string        // one-line guidance
}

export interface ToolTemplate {
  id: string           // 'shopify_order_lookup'
  label: string        // 'Shopify — order lookup'
  category: string     // 'E-commerce' | 'CRM' | 'Support' | 'Generic'
  description: string
  setupFields: ToolTemplateSetupField[]
  toolName: string             // slug for the created tool (^[a-zA-Z0-9_-]{1,48}$)
  toolDescription: string      // shown to the LLM
  method: ToolMethod
  urlTemplate: string          // may contain {{setup}} and {param}
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>  // values may contain {{setup}}
  auth: { type: ToolAuthType; headerName?: string } // no secret
  kind: ToolKind               // 'read' in v1
  secretLabel: string          // e.g. 'Shopify Admin API access token'
}

export const TOOL_TEMPLATES: readonly ToolTemplate[]
```

`applyTemplate(template, setupValues: Record<string, string>)` returns `{ name, description, method, urlTemplate, params, headers, auth, kind }` (shapes matching the create payload's fields, minus the secret): it replaces every `{{key}}` in `urlTemplate` and in each header `value` with `setupValues[key]` (missing → empty string), and leaves `{param}` untouched. Plain text replacement (setup values land in path/subdomain/query and are owner-controlled; https + SSRF validation remain the safety net). Pure and unit-testable.

### The five templates

1. **`shopify_order_lookup`** (E-commerce) — setup `shop` ("Store subdomain", e.g. `my-store`), `apiVersion` ("API version", placeholder `2024-01`). `GET https://{{shop}}.myshopify.com/admin/api/{{apiVersion}}/orders.json?status=any&name={orderNumber}`. Auth `{ type: 'header', headerName: 'X-Shopify-Access-Token' }` (the token is the owner-entered secret, sent as that header by the executor — it is **not** a static `headers[]` entry). `headers: []`. Param `orderNumber` (string, required, "The order number, e.g. #1001"). `secretLabel: 'Shopify Admin API access token'`.
2. **`stripe_customer_lookup`** (CRM) — no setup. `GET https://api.stripe.com/v1/customers?email={email}`. Auth `{ type: 'bearer' }`. Param `email` (string, required). `secretLabel: 'Stripe secret key (sk_…)'`.
3. **`hubspot_contact_lookup`** (CRM) — no setup. `GET https://api.hubapi.com/crm/v3/objects/contacts/{contactId}?properties=email,firstname,lastname,phone`. Auth `{ type: 'bearer' }`. Param `contactId` (string, required, "The HubSpot contact record id"). `secretLabel: 'HubSpot private-app token'`.
4. **`zendesk_ticket_lookup`** (Support) — setup `subdomain` ("Zendesk subdomain", e.g. `mycompany`). `GET https://{{subdomain}}.zendesk.com/api/v2/tickets/{ticketId}.json`. Auth `{ type: 'header', headerName: 'Authorization' }`. Param `ticketId` (string, required). `secretLabel: 'Basic auth value — "Basic " + base64("you@co.com/token:APITOKEN")'`.
5. **`generic_rest_get`** (Generic) — setup `baseUrl` ("Base URL", placeholder `https://api.example.com`). `GET {{baseUrl}}/{id}`. Auth `{ type: 'bearer' }`. Param `id` (string, required). `secretLabel: 'Bearer token (leave auth as None if the API is public)'`.

Each template's `toolName` is a distinct slug (`shopify_order_lookup`, `stripe_customer_lookup`, `hubspot_contact_lookup`, `zendesk_ticket_lookup`, `rest_lookup`); the owner can rename before saving (and must, if that name already exists on the agent — the existing 409 on duplicate name surfaces it).

## 2. Web — template picker (Tools page)

[apps/web/src/app/dashboard/tools/page.tsx] gains a **"Start from a template"** button beside "New tool" (visible only when not already editing). Flow (all client-side, three sub-views driven by local state — `gallery` → `setup` → the existing editor):

1. **Gallery:** a grid of cards from `TOOL_TEMPLATES` (label, category chip, description). A "Blank tool" affordance remains (the existing "New tool").
2. **Setup:** on selecting a card, show one input per `setupField` (label, placeholder, help) and a note: "You'll need: {secretLabel}." **Continue** is disabled until every setup field is non-empty.
3. **Prefill:** **Continue** calls `applyTemplate(template, setupValues)` and populates the existing `FormState` (`name`, `description`, `method`, `urlTemplate`, `params`, `headers`, `authType`, `headerName`, `secret: ''`, `hasSecret: false`, `kind`, `writeEnabled: false`), then opens the normal editor. The owner reviews, enters the secret, and saves via the existing `POST /agents/:agentId/tools`. Test/save are unchanged.

No new endpoints, no changes to the editor/save/test logic — the template flow only produces a prefilled `FormState`.

## 3. Backend

Unchanged. Created tools go through `POST /agents/:agentId/tools` → `validateToolInput` as today. The catalog is static shared data; the API neither imports nor serves it.

## 4. Error handling

- Missing setup value → **Continue** stays disabled (client guard); `applyTemplate` treats a missing key as empty string defensively.
- A mistyped setup value (bad subdomain) produces a tool that fails validation on save (non-https/invalid URL → 400) or errors at Test time (SSRF/DNS/HTTP) — the existing tool safeguards catch it; the template flow adds none of its own network calls.
- Duplicate `toolName` on the agent → the existing 409 ("A tool with that name already exists.") surfaces; the owner renames.

## 5. Testing & verification

- **Unit (`bun test`):** in `apps/api` (where `validateToolInput` lives), a test importing `TOOL_TEMPLATES` + `applyTemplate` from `@ayooda/shared`:
  - `applyTemplate` substitutes `{{setup}}` in `urlTemplate` and header values, leaves `{param}` intact, and handles a template with no setup fields.
  - **Catalog validity:** for every entry in `TOOL_TEMPLATES`, applying representative setup values yields a payload that passes `validateToolInput` (catches a malformed catalog entry — bad slug, non-https URL, placeholder without a matching param, bad auth shape).
- **Web:** `pnpm --filter web typecheck && build`; manual: pick each template → fill setup → prefilled editor appears → save → Test.
- **Live E2E:** apply the Shopify template against a real store + Admin API token, `POST /agents/:id/tools/:id/test` returns a real order; a widget chat that asks about an order triggers the tool and answers from the result. Clean up test tools.

## Out of scope (v1)

OAuth CRMs (Salesforce) and token refresh; nested-body search APIs (HubSpot contact-by-email); write templates (writes remain hand-built with the existing opt-in); a server-side connector subsystem / per-CRM branded config; template versioning or remote catalog; auto-detecting the owner's CRM.
