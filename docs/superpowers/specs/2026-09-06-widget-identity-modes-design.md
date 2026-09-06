# Ayooda — Simple and Verified Widget Identity — Design Spec

**Date:** 2026-09-06

**Status:** Implemented (v1); framework packages remain follow-up work

**Scope:** Add an endpoint-free browser identification flow for customers who want names, emails, and application user IDs attached to widget conversations, while preserving the existing server-signed JWT flow for trusted identity, cross-device history, and sensitive workflows. Improve the Deploy UI and documentation so the distinction is understandable and both integrations are quick to adopt.

## Background

Ayooda currently supports anonymous widget visitors and server-verified signed-in customers. Verified identity is secure, but integrating it requires the host application to mint a short-lived JWT on its server and make that JWT available to the browser. The current documentation presents this as a dedicated identity endpoint, which is more setup than many customers need when their immediate goal is simply to see a visitor's name and email in the Inbox.

Passing a user ID or email directly from browser JavaScript cannot prove who the visitor is. Anyone who can execute code on the host page can change those values and impersonate another identifier. The product therefore needs two explicit identity levels rather than weakening the verified flow:

- **identified, unverified** — convenient browser-provided profile data, suitable for routing and operator context but not proof of identity;
- **verified** — server-signed identity, suitable for restoring history across devices and identity-sensitive workflows.

Anonymous visitors remain supported.

## Goals

1. Let a customer identify a signed-in application user with one browser command and no customer-owned endpoint.
2. Clearly distinguish anonymous, unverified, and verified visitors throughout the system.
3. Prevent unverified identifiers from unlocking another user's conversation history or trusted data.
4. Preserve the existing signed JWT integration and its security guarantees.
5. Make upgrading from simple identification to verified identity additive rather than a rewrite.
6. Provide concise plain JavaScript, React, Next.js, and Angular guidance.
7. Make logout safe and obvious.

## Non-goals

- Treating browser-provided identity as authentication.
- Restoring unverified conversations on another browser or device.
- Allowing an unverified profile to overwrite verified customer attributes.
- Accepting a customer's application authentication token, Firebase ID token, session cookie, or OAuth access token directly in Ayooda.
- Building full framework SDK packages in the first release. Package helpers are a follow-up after the browser API is stable.
- Custom visitor attributes, company objects, avatars, phone numbers, or CRM synchronization in v1.
- Automatically merging historical guest conversations with an identified or verified customer.

## Product decisions

| Decision | Choice |
|---|---|
| Simple API | `Ayooda('boot', { user: { id, name?, email? } })` |
| Trust | Browser-supplied profiles are always marked **unverified**. |
| Server interaction | The widget calls Ayooda's public session API itself. The customer creates no endpoint. |
| History | Unverified identity may resume only through an opaque session held in the same browser. The public `user.id` is never sufficient to retrieve history. |
| Verified flow | `Ayooda('boot', { identityToken })` remains supported and recommended for authenticated products. |
| Cross-device continuity | Verified identities only. |
| Trusted attributes | Verified values take precedence and cannot be overwritten by unverified calls. |
| Logout | `Ayooda('shutdown')` revokes the Ayooda session, removes stored identity state, and clears the visible conversation. |
| Upgrade path | Calling `boot` with a valid JWT replaces an unverified session with a verified session. No automatic conversation merge in v1. |
| Default availability | Simple identification is accepted unless an owner disables it or requires verified identity. |

---

## 1. Customer-facing integration

### 1.1 Anonymous installation

The existing script continues to support guests without an initialization call:

```html
<script
  src="https://cdn.ayooda.live/widget.js"
  data-agent-id="YOUR_CHANNEL_ID"
  async
></script>
```

### 1.2 Simple identification

Applications with a signed-in user can initialize Ayooda directly from browser state:

```html
<script>
  window.Ayooda = window.Ayooda || function (...args) {
    (window.Ayooda.q = window.Ayooda.q || []).push(args)
  }

  window.Ayooda('boot', {
    user: {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
    },
  })
</script>
<script
  src="https://cdn.ayooda.live/widget.js"
  data-agent-id="YOUR_CHANNEL_ID"
  async
></script>
```

Only `user.id` is required. It must be a stable ID from the customer's application, not an Ayooda conversation ID or a changing login-session ID.

The browser command does not contain or require a secret. The widget exchanges the profile with Ayooda for an opaque session and stores that session according to the channel's configured conversation-persistence policy.

### 1.3 Verified identification

The current JWT form remains unchanged:

```js
Ayooda('boot', { identityToken })
```

The JWT must be signed on the customer's server. Customers may return it from a dedicated identity endpoint, add it to an existing session or `/me` response, or use a future framework helper. Ayooda must not prescribe a dedicated endpoint as the only integration pattern.

### 1.4 Updating a profile

For an unchanged user ID, customers may refresh browser-provided display fields:

```js
Ayooda('update', {
  user: {
    id: currentUser.id,
    name: currentUser.name,
    email: currentUser.email,
  },
})
```

Rules:

- An unverified session may update its own `name` and `email`.
- Changing `user.id` creates a separate unverified identity session and clears the visible conversation before loading the new session.
- A browser-provided `update` must not downgrade or mutate an active verified session. It returns a console warning and is ignored.
- `update({ identityToken })` retains the existing verified behavior.

### 1.5 Logout

Applications must call:

```js
Ayooda('shutdown')
```

before or as part of application logout. Shutdown:

1. revokes the active opaque Ayooda session on a best-effort basis;
2. clears its persisted session token and identity fingerprint;
3. closes live event connections;
4. clears the rendered conversation;
5. returns the widget to guest mode, or to the authentication-required state when verified identity is mandatory.

The documentation must place this step next to every initialization example rather than hiding it in a production checklist.

---

## 2. Identity and authorization model

### 2.1 Trust levels

```ts
type WidgetIdentityTrust = 'anonymous' | 'unverified' | 'verified'

interface WidgetCustomerIdentity {
  externalId?: string
  name?: string
  email?: string
  trust: WidgetIdentityTrust
}
```

| Capability | Anonymous | Unverified | Verified |
|---|---:|---:|---:|
| Start and continue current browser conversation | Yes | Yes | Yes |
| Show supplied name/email in Inbox | No | Yes | Yes |
| Same-browser resume with opaque session | Existing persistence rules | Yes | Yes |
| Find history using public application user ID | No | No | Yes |
| Cross-browser/device history | No | No | Yes |
| Trusted identity badge | No | No | Yes |
| Identity-sensitive tools/workflows | No | No | Yes |
| Override previously verified attributes | No | No | With a new valid token |

An unverified external ID is display/context data. It is never an authorization key. Every public conversation, message, event, and feedback request continues to require either the browser-local visitor scope or an opaque session token.

### 2.2 Why existing application tokens are not accepted

Ayooda must not ask customers to send Firebase ID tokens, application session cookies, or general OAuth access tokens to the widget. Those credentials may authorize unrelated application APIs and would unnecessarily expand the impact of browser or Ayooda compromise. A purpose-bound Ayooda JWT remains the verified option.

### 2.3 Attribute precedence

Use the following precedence when displaying or consuming customer data:

1. attributes from the active verified session;
2. attributes already stored as verified on the conversation/customer;
3. attributes from the active unverified session;
4. guest-derived or manually entered information.

An unverified request may add context to an anonymous conversation in the same browser scope, but it cannot replace non-empty verified fields. Downgrading `customerVerified` from `true` to `false` is forbidden.

### 2.4 Operational restrictions

Any feature that relies on identity must explicitly declare its minimum trust level. In v1:

- support agents may see and use unverified name/email as customer-provided context;
- ticket intake may copy unverified contact fields but must retain their trust status;
- tools that read account data, change an account, disclose private information, or perform privileged writes require verified identity;
- memory may remain scoped to the opaque visitor ID, but must not use an unverified external ID to join memories across devices;
- exports and webhooks include `identityTrust` so downstream systems do not mistake the data for verified identity.

---

## 3. Public API design

### 3.1 Session endpoint

Extend `POST /widget/session` to accept exactly one identity form.

Verified request:

```json
{
  "channelId": "channel_123",
  "identityToken": "eyJ..."
}
```

Unverified request:

```json
{
  "channelId": "channel_123",
  "user": {
    "id": "customer_456",
    "name": "Alice Example",
    "email": "alice@example.com"
  },
  "resumeToken": "optional-existing-opaque-session-token"
}
```

Successful response:

```json
{
  "sessionToken": "opaque-random-token",
  "expiresAt": "2026-09-07T12:00:00.000Z",
  "conversationId": "conversation-id",
  "identityTrust": "unverified"
}
```

Validation:

- reject a request containing both `identityToken` and `user`;
- `user.id`: required string, trimmed, 1–200 characters, no control characters;
- `name`: optional string, trimmed, at most 120 characters, no control characters;
- `email`: optional valid email, normalized to lowercase, at most 254 characters;
- reject unknown or nested user fields in v1;
- apply the existing domain check and channel-active check;
- rate-limit by channel and IP;
- never log the raw profile, JWT, session token, or email;
- return `Cache-Control: no-store`.

If `resumeToken` resolves to an unexpired unverified session with the same channel and external ID, refresh its profile and return that identity's latest browser-scoped conversation. If it is absent, invalid, expired, verified, or belongs to another ID, create a new unverified session. Never reveal whether a supplied external ID exists elsewhere.

When `identityVerification.requireAuthentication` is true, reject the `user` form with `403`; only a valid JWT may create a session.

### 3.2 Session lifecycle

Unverified sessions use cryptographically random bearer tokens. Store only a SHA-256 hash of the token, matching verified-session behavior.

```ts
interface WidgetSessionRecord {
  channelId: string
  visitorId: string
  customer: {
    externalId: string
    name?: string
    email?: string
    trust: 'unverified' | 'verified'
  }
  createdAt: Timestamp
  updatedAt: Timestamp
  expiresAt: Timestamp
}
```

- Verified visitor IDs remain deterministically derived from workspace, channel, and signed external ID so they support cross-device continuity.
- Unverified visitor IDs are random and are never derived from `user.id`.
- Unverified continuity comes only from possession of the opaque `resumeToken` in the same browser.
- Session expiry remains 24 hours initially. A later setting may make this configurable.
- `DELETE /widget/session` revokes both verified and unverified sessions.
- The existing expired-session cleanup process must cover both trust levels.

### 3.3 Error behavior

Identity setup must not make a guest-compatible widget disappear.

- If simple identification fails and verified identity is not required, log one sanitized console error and initialize as a guest with a fresh conversation.
- If a JWT was provided and is invalid, never silently downgrade that request to unverified or anonymous identity.
- If verified identity is required, keep the composer disabled and show the existing authentication-required state.
- Do not show technical JWT/session errors inside the customer chat transcript.

---

## 4. Widget runtime behavior

### 4.1 Command types

```ts
interface AyoodaUser {
  id: string
  name?: string
  email?: string
}

type AyoodaBootOptions =
  | { user: AyoodaUser; identityToken?: never }
  | { identityToken: string; user?: never }

interface AyoodaCommand {
  (command: 'boot' | 'update', options: AyoodaBootOptions): void
  (command: 'shutdown'): void
}
```

Queued calls made before the async script loads must support both identity forms. If multiple queued identity commands exist, process them in order after initialization so an explicit later `shutdown` or identity change wins.

### 4.2 Persistence

Store the unverified session token separately from guest conversation storage. The storage entry includes only:

```ts
interface StoredWidgetIdentitySession {
  token: string
  expiresAt: string
  externalIdFingerprint: string
}
```

The fingerprint is SHA-256 over `channelId + NUL + user.id`; do not store the raw external ID solely to index the session. Storage follows widget persistence:

- `session`: `sessionStorage`;
- `visitor`: `localStorage`, bounded by both session expiry and configured persistence days;
- `fresh`: memory only.

On `boot({ user })`, reuse the token only if it is unexpired and its fingerprint matches. Otherwise revoke it best-effort, clear it, and create a new session.

### 4.3 Races and repeated calls

- Consecutive identical `boot` calls must be idempotent from the host application's perspective.
- Use a monotonically increasing identity operation/version so a slower earlier request cannot replace a later login, logout, or identity change.
- `shutdown` wins over all pending boot/update requests.
- Avoid duplicate history rendering when a session is refreshed.
- React Strict Mode's development effect replay must not create duplicate conversations.

---

## 5. Conversation and Inbox data

Add or normalize these conversation fields:

```ts
customerExternalId?: string
customerName?: string | null
customerEmail?: string | null
customerIdentityTrust?: 'unverified' | 'verified'
customerVerified?: boolean // compatibility mirror; true only for verified
```

For new conversations, persist the current session identity. For existing conversations:

- an unverified session may update unverified name/email for its own visitor scope;
- a verified session may set or replace verified fields;
- an unverified session must not change a conversation whose `customerIdentityTrust` is `verified`;
- old records with `customerVerified === true` are interpreted as `verified`;
- old records without identity fields are interpreted as anonymous.

Inbox presentation:

- verified customer: name/email plus a compact shield/check badge with tooltip “Verified by your application”;
- unverified customer: name/email plus a neutral badge with tooltip “Provided by the website; not verified”;
- anonymous customer: retain the existing guest presentation;
- never use alarming red styling for unverified identity—it is expected, not an error;
- include trust status in the customer details panel and accessible text, not color alone.

Search may match unverified name, email, and external ID, but results and exports retain the trust label.

---

## 6. Deploy settings and onboarding

Replace the current single-purpose identity section with three progressive cards or an equivalent stepped control:

1. **Guests** — “Anyone can start a conversation.” This reflects `requireAuthentication === false`.
2. **Identify users** — endpoint-free browser setup. Controlled by `allowUnverifiedIdentification`, default `true`.
3. **Verify users** — secure JWT setup. Controlled by the existing verification secret and enabled state.

Owner controls:

```ts
interface WidgetIdentitySettings {
  allowUnverifiedIdentification: boolean // default true
  verificationEnabled: boolean           // maps from current enabled
  requireVerifiedIdentity: boolean        // maps from current requireAuthentication
}
```

Compatibility may retain the existing Firestore keys in the first migration, but API responses and UI copy should use the clearer names.

The Deploy UI must provide:

- a “Quick setup” code sample using `boot({ user })`;
- a clear “Unverified” explanation directly beside the sample;
- a “Secure setup” sample using `identityToken`;
- framework tabs for HTML/JavaScript, React/Next.js, and Angular;
- a copyable logout line in every tab;
- a capability comparison table;
- status showing last successful verified exchange and sanitized verification failures;
- a link to the full identity documentation;
- an explicit warning before enabling “Require verified identity.”

If verified identity is required, the unverified toggle becomes disabled with explanatory text. The saved configuration must never permit `requireVerifiedIdentity: true` while verification is disabled.

---

## 7. Documentation

Update the public identity guide and dashboard knowledge-base article. Lead with the one-line simple integration, then explain verification as an upgrade for stronger guarantees.

Required examples:

- plain JavaScript queue + boot + shutdown;
- React effect driven by authenticated user state;
- Next.js script installed once in the root layout;
- Angular service initialization and logout;
- adding a signed token to an existing session response;
- dedicated JWT endpoint as one option, not the default wording;
- safe user switching;
- SPA navigation behavior;
- troubleshooting CSP, allowed-domain, invalid-profile, and expired-session errors.

Every example must state:

- do not put the signing secret in frontend code;
- browser-provided identity is unverified;
- call `shutdown` at logout;
- use a stable internal user ID rather than email as `id`;
- do not pass passwords, access tokens, session cookies, or other application credentials.

---

## 8. Privacy, abuse prevention, and observability

### 8.1 Privacy

- Send only fields explicitly passed by the host application.
- Do not infer additional profile attributes from the host page.
- Do not place profile values or tokens in URLs.
- Session responses use `no-store` and session endpoints accept POST only.
- Dashboard copy reminds owners to cover support-widget identity data in their privacy notice.
- Deletion/export workflows treat unverified and verified profiles consistently while preserving the trust label.

### 8.2 Abuse controls

- Retain allowed-domain enforcement, understanding that Origin is a deployment restriction rather than user authentication.
- Rate-limit session creation by channel and IP.
- Bound repeated identity changes per browser/IP to deter profile spam.
- Never join records globally by an unverified email or external ID.
- Escape identity values in the Inbox and all exports.

### 8.3 Metrics

Add privacy-safe counters without profile values:

- `widget_identity_session_created_total{trust}`;
- `widget_identity_session_resumed_total{trust}`;
- `widget_identity_session_failed_total{mode,reason}`;
- `widget_identity_shutdown_total{trust}`;
- per-channel last unverified identification time;
- existing verified success/failure status remains.

Logs may include workspace/channel IDs and a coarse failure code, but never JWTs, session tokens, names, emails, raw external IDs, or their reversible encodings.

---

## 9. Backward compatibility and rollout

### Phase 1 — Data and API

1. Add trust to the internal customer/session types.
2. Interpret existing verified sessions and `customerVerified: true` as verified.
3. Extend `/widget/session` with the mutually exclusive `user` request.
4. Create random visitor scopes for unverified identities and implement resume-token handling.
5. Add validation, rate limits, and unit tests.

### Phase 2 — Widget runtime

1. Accept queued and live `boot/update` calls with `user`.
2. Add identity-session persistence and race protection.
3. Implement logout cleanup and safe fallback.
4. Test reloads, SPAs, Strict Mode, identity switching, and async script ordering.

### Phase 3 — Dashboard and documentation

1. Add the identity trust indicator to Inbox customer details.
2. Redesign the Deploy identity section around Quick and Secure setup.
3. Update the public guide and knowledge-base article.
4. Add installation diagnostics for simple and verified identity.

### Phase 4 — Framework helpers (follow-up)

After the browser API stabilizes, publish small optional helpers:

- `@ayooda/browser` — typed command API;
- `@ayooda/react` — provider/hook handling boot, updates, Strict Mode, and logout;
- `@ayooda/node` — JWT creation and validation helpers;
- `@ayooda/nextjs` — route-handler factory plus React provider;
- equivalent server helpers for Python, PHP, and Ruby based on demand.

These packages reduce boilerplate but do not change the security model. Verified identity always requires code executing in a trusted server environment.

---

## 10. Testing requirements

### API unit/integration tests

- accepts a valid minimal unverified profile;
- normalizes optional name/email;
- rejects missing, empty, oversized, malformed, or control-character fields;
- rejects requests containing both identity forms;
- rejects unverified identification when disabled or when verified identity is required;
- creates a random visitor ID unrelated to the supplied external ID;
- resumes only with a valid token for the same channel and external ID;
- does not reveal whether an external ID exists;
- prevents unverified updates to verified fields;
- preserves existing JWT verification and key-rotation behavior;
- rejects expired/revoked sessions and never falls back when a session token was supplied;
- enforces domain restrictions and rate limits.

### Widget tests

- queued `boot({ user })` before script initialization;
- boot after script initialization;
- repeated identical boot calls;
- update of name/email;
- switch from user A to user B without leaking messages;
- upgrade from unverified to verified;
- unverified call during a verified session is ignored;
- logout during an in-flight session request;
- reload continuity for `session` and `visitor` persistence;
- no persistence for `fresh`;
- fallback to guest after a simple-identification network failure;
- no fallback after an invalid JWT;
- no duplicate host, conversation, or messages under React Strict Mode;
- CSP/domain errors remain actionable in the console.

### End-to-end acceptance

1. Install only the script: anonymous chat works unchanged.
2. Call `boot({ user })`: Inbox shows supplied profile with an Unverified badge.
3. Reload in the same permitted persistence scope: the conversation resumes through the opaque session.
4. Copy the public external ID to another browser: no history is disclosed.
5. Call `shutdown`, then boot another user: the previous conversation is not visible.
6. Boot with a valid JWT: Inbox shows Verified and cross-browser continuity works.
7. Attempt browser-provided profile updates after verification: verified attributes remain unchanged.
8. Enable “Require verified identity”: guests and unverified users cannot send; a valid JWT can.

---

## 11. Acceptance criteria

- A customer can attach ID, name, and email with `Ayooda('boot', { user })` and no customer-owned backend endpoint.
- The Inbox never presents that browser-provided identity as verified.
- Knowing or guessing an unverified external ID cannot retrieve another visitor's conversation.
- Same-browser continuity uses an opaque bearer session, not the public external ID.
- Verified JWT behavior, key rotation, and cross-device continuity continue to work.
- Unverified values cannot overwrite verified values.
- Logout reliably clears local identity state and the visible conversation.
- The Deploy page explains the capability/security difference before users choose an integration.
- Documentation makes the easy path primary and presents a dedicated endpoint as only one verified-token delivery option.

## Future considerations

- Custom attributes with per-attribute trust and write policy.
- Company/account association through verified tokens.
- Verified email links for businesses without application authentication.
- Identity merge tools with an auditable operator workflow.
- Public-key/JWKS verification for enterprise customers that prefer asymmetric signing.
- Expiring and revoking all widget sessions for a customer from an authenticated server API.
