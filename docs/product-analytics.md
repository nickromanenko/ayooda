# Product analytics

The web application initializes the official `mixpanel-browser` SDK from the root layout through the client-only `MixpanelAnalytics` component.

## Current configuration

- Project token: `8a369be75a1879a51cc7fd8a7f368284` (a browser-visible Mixpanel project token, not a secret)
- Ingestion host: `https://api-eu.mixpanel.com`
- Autocapture: enabled
- Session recording: 100% of eligible sessions
- Initialization: once per browser page lifecycle, including React development remounts

Anonymous visitors use Mixpanel's generated distinct ID. Once Firebase restores or creates an authenticated session, the integration calls `identify` with the stable Firebase UID. It resets Mixpanel on sign-out. It does not set People properties or send server-side events.

## Product events

| Event | When it fires | Properties |
| --- | --- | --- |
| `Marketing CTA Clicked` | A public landing CTA is clicked | CTA copy, destination path/domain, page path |
| `Sign Up Completed` | Email, Google, or account-link signup completes | Authentication method |
| `Sign In Completed` | Email, Google, or account-link login completes | Authentication method |
| `Agent Created` | A dashboard agent is successfully created | Role, whether a logo was selected |
| `Knowledge Source Added` | A website or file is accepted for indexing | Source type, onboarding/dashboard context |
| `Agent Test Started` | The first sandbox message is accepted | Whether tools were enabled |
| `Channel Connected` | A widget, Telegram, email, Slack, or SMS channel connects | Channel type, onboarding/dashboard context |
| `Connector Installed` | A connector is installed via token or OAuth | Provider, install method, action count when known |
| `MCP Server Connected` | A new MCP server is saved | Transport and authentication type |
| `Checkout Started` | Stripe returns a valid checkout URL | Selected tier |
| `Checkout Completed` | Stripe redirects back with a success status | None |

Event names and property shapes live in `apps/web/src/lib/product-analytics.ts`. The typed wrapper is best-effort: analytics failures never block an application workflow. Checkout-start tracking uses `sendBeacon` and immediate delivery because the browser leaves the application directly afterward.

## Privacy boundary

Autocapture and full session recording apply to both the public site and authenticated dashboard. Before production launch, the privacy policy and consent flow should describe this collection and be reviewed for every jurisdiction where Ayooda operates.

Manual event properties must remain operational metadata only. Do not add emails, names, message content, prompts, URLs supplied as knowledge, filenames, agent/document/conversation IDs, credentials, webhook URLs, or other customer-provided payloads. Firebase UID is used only as Mixpanel's distinct ID.
