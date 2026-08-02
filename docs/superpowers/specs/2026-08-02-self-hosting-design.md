# Ayooda Sub-project J — Self-Hosting (Docs-Only Deploy Guide) — Design Spec

**Date:** 2026-08-02
**Status:** Approved for planning
**Scope:** A documentation-only self-hosting deliverable: `docs/self-hosting.md` plus three per-app `.env.example` config templates. No application code, no Docker Compose stack, no web Dockerfile, no scraper HTTP mode. The guide explains how to run the existing Ayooda apps on the customer's own infrastructure, backed by **their own** Firebase project (Firestore/Auth/Storage) and their own Pinecone/Gemini/OpenRouter keys.

## Background

Ayooda is Firebase-native: Firestore (database, via Firebase Admin), Firebase Auth (Google + Email/Password login), and Firebase Storage (knowledge file uploads) are Google-managed and cannot be containerized. Pinecone (vector DB), Gemini (embeddings), OpenRouter (chat), and Stripe (billing) are external SaaS. Today the four apps deploy to Google infra: **api** → Cloud Run (`apps/api/Dockerfile`, Bun/Hono), **web** → Firebase App Hosting (Next.js; **no Dockerfile**, `NEXT_PUBLIC_*` baked at build), **scraper** → Cloud Run Job (`apps/scraper/Dockerfile`, Puppeteer/Chromium), **widget** → Firebase Hosting CDN (Vite static `widget.js`).

"Self-hosting" here = a customer runs these app containers/processes on their own infra pointed at **their own** Firebase project + keys. It is **not** a de-Firebase rewrite (Firestore/Auth/Storage remain their Google-managed Firebase project — the standard BYO-Firebase model).

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Self-host model | **Bring-your-own-Firebase**, docs-only. Customer runs web + api + scraper + widget with their own Firebase project + Pinecone/Gemini/OpenRouter keys. |
| Deliverable | **`docs/self-hosting.md`** + `apps/api/.env.example`, `apps/web/.env.example`, `apps/scraper/.env.example`. No code, no compose. |
| Honesty | The three real gaps (scraper trigger, web build-time config, billing gate) are documented plainly with workarounds, not hidden. |

---

## 1. `docs/self-hosting.md` — structure

### 1.1 Overview & architecture
- The four apps and their runtimes; the request/data flow (visitor → widget → api → Firestore/Pinecone/OpenRouter; operator → web → api).
- What remains Google-managed: **your own** Firebase project's Firestore + Auth + Storage. A short note that full de-Firebase self-hosting is out of scope.

### 1.2 What you need (accounts & keys)
- **Firebase project** with: Firestore in **Native mode**; Authentication providers **Google** + **Email/Password** enabled; a **Storage bucket** (default `<project>.firebasestorage.app`); a **service-account JSON** (Project Settings → Service accounts → Generate new private key).
- **Pinecone** index: **768 dimensions, cosine** metric (must match the Gemini `gemini-embedding-001` @ 768 embedding size), serverless is fine. Note the index name.
- **Gemini API key** (`GEMINI_API_KEY`) — embeddings (direct Google API, not OpenRouter).
- **OpenRouter API key** (`OPENROUTER_API_KEY`) — platform chat fallback (Gemini-only unless a workspace sets its own key).
- **Optional Stripe** (billing) and **optional Langfuse** (tracing) — the app runs without either.

### 1.3 One-time backend setup
- `firebase login`, select the project (`firebase use <project>`).
- Deploy rules + indexes: `firebase deploy --only firestore:rules,firestore:indexes` (uses the repo's `firestore.rules` + `firestore.indexes.json`). Note the composite/collection-group indexes are required (e.g. `channels.id` collection-group; conversations composite) — deploying `firestore.indexes.json` provisions them.
- Provision the Storage bucket (created automatically on first Firebase Storage use, or via the console).

### 1.4 Configuration reference (env vars)
A table per app listing every variable, what it is, and where to get it — matching the `.env.example` files (§2). Cross-service URL vars are called out in §1.6.

**api** (`apps/api/.env`): `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_KEY` (JSON string), `FIREBASE_STORAGE_BUCKET`, `PINECONE_API_KEY`, `PINECONE_INDEX`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `API_KEY_ENCRYPTION_SECRET` (random 32+ chars — encrypts BYO keys, tool secrets, Telegram tokens), `ALLOWED_ORIGINS` (comma-separated web origins for CORS), `API_PUBLIC_URL` (public HTTPS base — Telegram webhooks), `WEB_PUBLIC_URL` (team-invite links), `WIDGET_BASE_URL` (where `widget.js` is hosted), `PORT` (default 8080), `SCRAPER_JOB_URL` (empty for local-spawn mode — see §1.5), and **optional** `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_LITE|CORE|MAX`/`BILLING_SUCCESS_URL`/`BILLING_CANCEL_URL`, `LANGFUSE_BASE_URL`/`LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`.

**web** (`apps/web/.env` — all **build-time**): `NEXT_PUBLIC_API_URL` (public api base), `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` (all from Firebase console → Project settings → Web app config), and the server-side session verification uses the same service-account credentials as the api (documented: the web app's server components read Firebase Admin via the service account — set the same `FIREBASE_*` server vars it expects).

**scraper** (`apps/scraper/.env`): `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `FIREBASE_STORAGE_BUCKET`, `PINECONE_API_KEY`, `PINECONE_INDEX`, `GEMINI_API_KEY`, `PUPPETEER_EXECUTABLE_PATH` (system Chromium path). Per-job vars (`WORKSPACE_ID`, `AGENT_ID`, `DOC_ID`, `DOC_TYPE`, `URL`/`STORAGE_PATH`, `PINECONE_NAMESPACE`) are injected by the trigger, not set by hand.

### 1.5 Build & run each app
- **api:** `docker build -f apps/api/Dockerfile -t ayooda-api .` then `docker run -p 8080:8080 --env-file apps/api/.env ayooda-api`. (In-container config comes from real env vars; `apps/api/.env` is the dev convenience file.)
- **web:** `pnpm --filter web build` (with `NEXT_PUBLIC_*` present at build time) then `pnpm --filter web start -p 3000`. Note that changing Firebase config requires a rebuild (build-time baking).
- **scraper / knowledge ingestion:** explain both trigger modes. `SCRAPER_JOB_URL` set → the api calls the **Cloud Run Jobs API** (needs GCP). `SCRAPER_JOB_URL` empty → the api **spawns the scraper as a local subprocess** (`triggerLocal`), which requires the scraper source + its deps + Chromium present in the api's runtime — i.e. run the api from a **repo checkout** (`bun run apps/api/src/index.ts`) on a host with Chromium installed and `PUPPETEER_EXECUTABLE_PATH` set, **not** the slim api container. State this trade-off explicitly.
- **widget:** `pnpm --filter widget build` → serve the resulting `widget.js` from any static host the customer controls; set `WIDGET_BASE_URL` (api) so generated embed codes point at it.

### 1.6 Wiring the pieces together
The cross-service URLs must agree: `NEXT_PUBLIC_API_URL` (web → api), `ALLOWED_ORIGINS` (api CORS allow-list including the web origin), `API_PUBLIC_URL` (public HTTPS for Telegram webhooks), `WEB_PUBLIC_URL` (invite links in api responses), `WIDGET_BASE_URL` (embed snippet host). A small worked example with placeholder hostnames.

### 1.7 Known limitations & workarounds
- **Billing gate:** without Stripe configured, a workspace gets the 14-day Firestore trial and is then gated on new conversations. Workarounds: configure Stripe (§1.2), or manually mark the workspace active by setting `workspaces/{id}.subscription.status = 'active'` in Firestore (document the exact field), or periodically run `apps/api/scripts/backfill-trials.ts` to refresh trials. A self-host billing toggle is a future code change, out of scope here.
- **Scraper needs GCP or a repo-checkout host with Chromium** (per §1.5) — the slim api container alone cannot run local ingestion.
- **Web Firebase config is build-time** — changing projects requires a rebuild.
- **Multi-tenant by design:** each signed-up user gets their own workspace; there is no "single-tenant lock" — self-hosters typically restrict signups at the Firebase Auth layer (e.g. allow-list) if they want a private instance.

### 1.8 Verification checklist
Sign up (web) → complete onboarding (default agent created) → add a knowledge URL/file (confirm it reaches `indexed` — validates the scraper path) → create the web-widget channel → chat through the widget and get a grounded answer → (optional) connect Telegram and message the bot.

## 2. `.env.example` files

Three files mirroring §1.4, with placeholder values and one-line comments, and the optional blocks (Stripe/Langfuse) clearly marked optional:
- `apps/api/.env.example`
- `apps/web/.env.example`
- `apps/scraper/.env.example`

These are configuration templates (no secrets, no logic).

## 3. Testing & verification

- **Docs build/consistency check:** the env-var tables in `docs/self-hosting.md` and the `.env.example` files must list exactly the variables the code reads (cross-check against `grep -rhoE "process\.env\.[A-Z0-9_]+"` over `apps/`). No orphan or missing vars.
- **Link/anchor sanity:** internal references (to `firestore.rules`, `firestore.indexes.json`, `apps/api/Dockerfile`, `apps/api/scripts/backfill-trials.ts`) point at real repo paths.
- No automated test suite changes (documentation deliverable). The existing `bun test` suite must remain green (unchanged).

## Out of scope

Docker Compose stack; a web Dockerfile / Next standalone image; a scraper HTTP-trigger service; a `BILLING_ENABLED` toggle or any billing code change; de-Firebase work (Postgres/self-hosted auth/S3/MinIO/OSS vector DB); Kubernetes/Helm; automated one-command provisioning.
