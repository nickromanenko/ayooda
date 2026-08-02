# Self-Hosting Deploy Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a docs-only self-hosting deliverable — `docs/self-hosting.md` plus three `.env.example` config templates — so a customer can run Ayooda on their own infra with their own Firebase project + keys.

**Architecture:** Documentation + configuration templates only. No application code, no Docker Compose, no web Dockerfile, no scraper HTTP mode. The `.env.example` files mirror exactly the variables the code reads; the guide documents the bring-your-own-Firebase model and the three real caveats (scraper trigger, web build-time config, billing gate).

**Tech Stack:** Markdown docs; `.env.example` config templates. Verification via `grep` cross-checks + the existing `bun test` suite staying green.

## Global Constraints

- **Docs-only:** deliverables are `docs/self-hosting.md`, `apps/api/.env.example`, `apps/web/.env.example`, `apps/scraper/.env.example`. No code, no compose, no new Dockerfile.
- **BYO-Firebase model:** the customer runs the app processes on their own infra, backed by their own Firebase project (Firestore Native, Auth Google + Email/Password, Storage) + their own Pinecone (**768-dim, cosine**) / Gemini / OpenRouter keys. Not a de-Firebase rewrite.
- **Every variable the code reads must appear** (active or commented-optional) in the matching `.env.example`; per-job/injected vars (`WORKSPACE_ID`, `AGENT_ID`, `DOC_ID`, `DOC_TYPE`, `URL`, `STORAGE_PATH`, `PINECONE_NAMESPACE`) and runtime-only `NODE_ENV`/`PORT` injection are excluded from the "must be user-set" set.
- **Three caveats stated plainly:** scraper needs GCP Cloud Run Jobs *or* a repo-checkout host with Chromium (the slim api container can't run local ingestion); web `NEXT_PUBLIC_*` are build-time; no-Stripe workspaces hit the trial/billing gate (workaround: Stripe, or set `workspaces/{id}.subscription.status='active'`).
- Existing `bun test` suite must remain green (no code touched).

---

### Task 1: The three `.env.example` templates

**Files:**
- Create: `apps/api/.env.example`
- Create: `apps/web/.env.example`
- Create: `apps/scraper/.env.example`

**Interfaces:**
- Consumes: the actual `process.env.*` reads in each app (`apps/api/src`, `apps/web/src`, `apps/scraper/src`).
- Produces: config templates referenced by `docs/self-hosting.md` (Task 2).

- [ ] **Step 1: Create `apps/api/.env.example`**

```bash
# ─── Firebase (your own project) ────────────────────────────────
FIREBASE_PROJECT_ID=your-firebase-project-id
# Service-account JSON as a single-line string (Project settings → Service accounts → Generate new private key)
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-firebase-project-id","private_key":"..."}
FIREBASE_STORAGE_BUCKET=your-firebase-project-id.firebasestorage.app

# ─── Vector DB + models ─────────────────────────────────────────
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_INDEX=ayooda                 # the index MUST be 768-dim, cosine
GEMINI_API_KEY=your-gemini-api-key    # embeddings (Google AI Studio)
OPENROUTER_API_KEY=sk-or-...          # platform chat fallback (Gemini-only unless a workspace adds its own key)

# ─── Secrets ────────────────────────────────────────────────────
API_KEY_ENCRYPTION_SECRET=change-me-to-a-random-32-plus-char-string   # encrypts BYO keys, tool secrets, Telegram tokens

# ─── Networking / wiring ────────────────────────────────────────
PORT=8080
ALLOWED_ORIGINS=https://app.example.com    # comma-separated web origins allowed by CORS
API_PUBLIC_URL=https://api.example.com      # public HTTPS base of this api (Telegram webhooks)
WEB_PUBLIC_URL=https://app.example.com      # base for team-invite links
WIDGET_BASE_URL=https://cdn.example.com     # where widget.js is hosted (embed snippets point here)

# ─── Scraper trigger ────────────────────────────────────────────
# Empty  → api spawns the scraper as a LOCAL SUBPROCESS (needs Chromium + scraper deps in this
#          runtime; see docs/self-hosting.md → "Scraper / knowledge ingestion").
# Set    → a Cloud Run Job "run" URL, to use Cloud Run Jobs (needs GCP).
SCRAPER_JOB_URL=

# ─── Optional: Stripe billing (omit the whole block to run without billing) ──
# STRIPE_SECRET_KEY=sk_test_...
# STRIPE_WEBHOOK_SECRET=whsec_...
# STRIPE_PRICE_LITE=price_...
# STRIPE_PRICE_CORE=price_...
# STRIPE_PRICE_MAX=price_...
# BILLING_SUCCESS_URL=https://app.example.com/dashboard/billing?success=1
# BILLING_CANCEL_URL=https://app.example.com/dashboard/billing?canceled=1

# ─── Optional: Langfuse tracing ─────────────────────────────────
# LANGFUSE_BASE_URL=https://cloud.langfuse.com
# LANGFUSE_PUBLIC_KEY=pk-lf-...
# LANGFUSE_SECRET_KEY=sk-lf-...
```

- [ ] **Step 2: Create `apps/web/.env.example`**

```bash
# ─── Firebase web client config (Project settings → your Web app) ──
# NOTE: NEXT_PUBLIC_* are baked in at BUILD time — rebuild the web app after changing any of these.
NEXT_PUBLIC_FIREBASE_API_KEY=your-web-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-firebase-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-firebase-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-firebase-project-id.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-web-app-id

# Public base URL of the api service (also build-time)
NEXT_PUBLIC_API_URL=https://api.example.com

# ─── Server-side (dashboard session verification via Firebase Admin) ──
# Same service-account JSON as the api. NOT public — do not prefix with NEXT_PUBLIC_.
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-firebase-project-id","private_key":"..."}
```

- [ ] **Step 3: Create `apps/scraper/.env.example`**

```bash
# ─── Firebase (the SAME project as the api) ─────────────────────
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-firebase-project-id","private_key":"..."}
FIREBASE_STORAGE_BUCKET=your-firebase-project-id.firebasestorage.app

# ─── Vector DB + embeddings ─────────────────────────────────────
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_INDEX=ayooda                 # 768-dim, cosine (must match the api)
GEMINI_API_KEY=your-gemini-api-key

# ─── Chromium (Puppeteer) ───────────────────────────────────────
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Per-job vars (WORKSPACE_ID, AGENT_ID, DOC_ID, DOC_TYPE, URL, STORAGE_PATH, PINECONE_NAMESPACE)
# are injected by the api trigger at runtime — do not set them here.
```

- [ ] **Step 4: Cross-check every code-read var is present**

Run this per app; it prints code-read vars that are **missing** from the `.env.example` (active or commented). Expected output: **empty** for each app.

```bash
cd /Users/nick/Projects/ayooda
for app in api web scraper; do
  echo "== $app =="
  comm -23 \
    <(grep -rhoE "process\.env\.[A-Z0-9_]+" apps/$app/src | sed 's/process\.env\.//' | sort -u \
        | grep -vE "^(WORKSPACE_ID|AGENT_ID|DOC_ID|DOC_TYPE|URL|STORAGE_PATH|PINECONE_NAMESPACE|NODE_ENV)$") \
    <(grep -oE "^#? *[A-Z0-9_]+=" apps/$app/.env.example | tr -d '#= ' | sort -u)
done
```

Expected: each `== app ==` header is followed by no lines (every user-settable var is templated). If a var prints, add it to the matching `.env.example`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/.env.example apps/web/.env.example apps/scraper/.env.example
git commit -m "docs: .env.example templates for self-hosting"
```

---

### Task 2: `docs/self-hosting.md`

**Files:**
- Create: `docs/self-hosting.md`

**Interfaces:**
- Consumes: the `.env.example` files (Task 1); existing repo paths (`firestore.rules`, `firestore.indexes.json`, `apps/api/Dockerfile`, `apps/api/scripts/backfill-trials.ts`).

- [ ] **Step 1: Write the guide**

Create `docs/self-hosting.md` with exactly this content:

````markdown
# Self-Hosting Ayooda

Run Ayooda on your own infrastructure, backed by **your own** Firebase project and API keys.

> **What "self-hosting" means here.** Ayooda's database (Firestore), login (Firebase Auth), and file storage (Firebase Storage) are Google-managed services. Self-hosting means you run the **application** yourself (the web, api, scraper, and widget), pointed at **your own** Firebase project plus your own Pinecone / Gemini / OpenRouter keys. It is **not** a from-scratch, dependency-free deployment — a full de-Firebase build (Postgres, self-hosted auth, S3/MinIO, an OSS vector DB) is out of scope.

## Architecture

| App | Runtime | Role |
|-----|---------|------|
| **web** | Next.js (Node) | Dashboard + landing. Talks to the api; verifies sessions with Firebase Admin. |
| **api** | Bun / Hono | REST API: auth, workspaces, agents, knowledge, tools, workflows, chat, billing, channels. |
| **scraper** | Node + Puppeteer/Chromium | Crawls URLs / parses uploaded files → embeds → upserts to Pinecone. Triggered by the api. |
| **widget** | Static JS (Vite) | The embeddable `widget.js` visitors load on customer sites. |

**Data flow:** visitor → widget → api → (Firestore, Pinecone, OpenRouter) → streamed reply. Operator → web → api. Knowledge: web/api → scraper → (Gemini embeddings, Pinecone).

Everything persistent lives in **your** Firebase project (Firestore) and **your** Pinecone index. No data flows to Ayooda.

## 1. What you need

- **A Firebase project** with:
  - **Firestore** in **Native mode**.
  - **Authentication** → enable **Google** and **Email/Password** providers.
  - **Storage** → a default bucket (`<project-id>.firebasestorage.app`).
  - A **service-account JSON** (Project settings → Service accounts → *Generate new private key*).
  - The **Web app config** (Project settings → your Web app → SDK setup) for the `NEXT_PUBLIC_FIREBASE_*` values.
- **A Pinecone index** — **768 dimensions, cosine** metric (must match the Gemini `gemini-embedding-001` @ 768 embedding size). Serverless is fine. Note its name.
- **A Gemini API key** (`GEMINI_API_KEY`) — Google AI Studio. Used for embeddings.
- **An OpenRouter API key** (`OPENROUTER_API_KEY`) — the platform chat fallback. (A workspace can also add its own key per agent; without any key, only Gemini chat models work.)
- **Optional:** Stripe (billing) and Langfuse (tracing). Ayooda runs without either.
- **Tooling:** Node 20+, [Bun](https://bun.sh) 1.3+, pnpm 10+, the Firebase CLI, and Chromium (for the scraper).

## 2. One-time backend setup

```bash
# From the repo root
npm i -g firebase-tools
firebase login
firebase use <your-firebase-project-id>

# Deploy security rules + indexes (uses this repo's firestore.rules + firestore.indexes.json)
firebase deploy --only firestore:rules,firestore:indexes
```

`firestore.indexes.json` provisions the composite and collection-group indexes the app needs (e.g. the `channels.id` collection-group index and the conversations composite). The Storage bucket is created automatically the first time a file is uploaded, or you can create it in the console.

## 3. Configuration

Copy each template and fill it in:

```bash
cp apps/api/.env.example      apps/api/.env
cp apps/web/.env.example      apps/web/.env
cp apps/scraper/.env.example  apps/scraper/.env
```

### api (`apps/api/.env`)

| Variable | What it is |
|---|---|
| `FIREBASE_PROJECT_ID` | Your Firebase project id. |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | The service-account JSON, as a single-line string. |
| `FIREBASE_STORAGE_BUCKET` | `<project-id>.firebasestorage.app`. |
| `PINECONE_API_KEY` / `PINECONE_INDEX` | Your Pinecone key and the 768-dim/cosine index name. |
| `GEMINI_API_KEY` | Embeddings key. |
| `OPENROUTER_API_KEY` | Platform chat fallback key. |
| `API_KEY_ENCRYPTION_SECRET` | Random 32+ char string. Encrypts BYO keys, tool secrets, and Telegram tokens — **keep it stable**, rotating it invalidates stored secrets. |
| `PORT` | Listen port (default 8080). |
| `ALLOWED_ORIGINS` | Comma-separated web origins allowed by CORS (include your web URL). |
| `API_PUBLIC_URL` | Public HTTPS base of the api (used to register Telegram webhooks). |
| `WEB_PUBLIC_URL` | Base URL used in team-invite links. |
| `WIDGET_BASE_URL` | Where `widget.js` is hosted (embed snippets point here). |
| `SCRAPER_JOB_URL` | Empty for local-subprocess ingestion; a Cloud Run Job run URL to use Cloud Run Jobs. See §5. |
| `STRIPE_*`, `BILLING_*` | *Optional.* Billing (see §7). |
| `LANGFUSE_*` | *Optional.* Tracing. |

### web (`apps/web/.env`)

All `NEXT_PUBLIC_*` are **build-time** — the web app must be rebuilt after any change.

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | Your Firebase Web app config (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId). |
| `NEXT_PUBLIC_API_URL` | Public base URL of the api. |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Server-side only (dashboard session verification via Firebase Admin). **Not** public. |

### scraper (`apps/scraper/.env`)

| Variable | What it is |
|---|---|
| `FIREBASE_PROJECT_ID` / `FIREBASE_SERVICE_ACCOUNT_KEY` / `FIREBASE_STORAGE_BUCKET` | Same Firebase project as the api. |
| `PINECONE_API_KEY` / `PINECONE_INDEX` | Same Pinecone index as the api. |
| `GEMINI_API_KEY` | Embeddings key. |
| `PUPPETEER_EXECUTABLE_PATH` | Path to system Chromium (e.g. `/usr/bin/chromium`). |

Per-job variables (`WORKSPACE_ID`, `AGENT_ID`, `DOC_ID`, `DOC_TYPE`, `URL`, `STORAGE_PATH`, `PINECONE_NAMESPACE`) are injected by the api trigger — you never set them by hand.

## 4. Build & run the api and web

**Install + build shared:**

```bash
pnpm install
pnpm --filter @ayooda/shared build
```

**api** — the repo ships a container:

```bash
docker build -f apps/api/Dockerfile -t ayooda-api .
docker run -p 8080:8080 --env-file apps/api/.env ayooda-api
```

(Or run it directly: `cd apps/api && bun run src/index.ts`.) See §5 for the ingestion caveat that affects which of these you want.

**web** — Next.js. `NEXT_PUBLIC_*` must be present at build time:

```bash
pnpm --filter web build
pnpm --filter web start -p 3000
```

## 5. Scraper / knowledge ingestion

The api triggers ingestion in one of two modes:

- **Cloud Run Jobs** (`SCRAPER_JOB_URL` set): the api calls the Cloud Run Jobs API. Requires GCP and the scraper deployed as a Cloud Run Job (`apps/scraper/Dockerfile`). Choose this if you already run on GCP.
- **Local subprocess** (`SCRAPER_JOB_URL` empty): the api spawns the scraper's entry point as a child process. This needs the **scraper source, its dependencies, and Chromium** available in the **api's** runtime — so run the api from a **repo checkout** (`cd apps/api && bun run src/index.ts`) on a host with Chromium installed and `PUPPETEER_EXECUTABLE_PATH` set, **not** the slim `apps/api/Dockerfile` image (which contains only the api).

**Recommendation for a non-GCP self-host:** run the api from a repo checkout on a VM that also has Chromium, and leave `SCRAPER_JOB_URL` empty. Knowledge scraping and file ingestion then work via the local subprocess.

## 6. Widget & wiring

Build and host the widget, then make the URLs agree:

```bash
pnpm --filter widget build   # → apps/widget/dist/widget.js
```

Serve `widget.js` from any static host you control and set `WIDGET_BASE_URL` (api) to that origin — generated embed snippets will point there.

The cross-service URLs must line up:

| Variable | Set on | Points at |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | web (build) | the api's public URL |
| `ALLOWED_ORIGINS` | api | the web's public origin(s) |
| `API_PUBLIC_URL` | api | the api's own public URL (Telegram webhooks) |
| `WEB_PUBLIC_URL` | api | the web's public URL (invite links) |
| `WIDGET_BASE_URL` | api | where `widget.js` is hosted |

Worked example: web at `https://app.acme.com`, api at `https://api.acme.com`, widget at `https://cdn.acme.com` →
`NEXT_PUBLIC_API_URL=https://api.acme.com`, `ALLOWED_ORIGINS=https://app.acme.com`, `API_PUBLIC_URL=https://api.acme.com`, `WEB_PUBLIC_URL=https://app.acme.com`, `WIDGET_BASE_URL=https://cdn.acme.com`.

## 7. Known limitations & workarounds

- **Billing gate.** With no Stripe configured, each workspace gets a 14-day Firestore trial and is then **gated on new conversations**. To run without billing, either configure Stripe (fill the `STRIPE_*`/`BILLING_*` block, register the webhook, run `apps/api/scripts/setup-stripe.ts`), or manually mark a workspace active in Firestore: set `workspaces/{id}.subscription` to `{ status: "active", tier: "max", currentPeriodEnd: <a far-future timestamp>, trialEndsAt: null, stripeCustomerId: null, stripeSubscriptionId: null }`. (`apps/api/scripts/backfill-trials.ts` can also refresh trials.) A first-class `BILLING_ENABLED` toggle is a future enhancement.
- **Scraper needs GCP or a repo-checkout host with Chromium** (see §5) — the slim api container alone cannot run local ingestion.
- **Web Firebase config is build-time** — switching Firebase projects or API URLs requires rebuilding the web app.
- **Multi-tenant by design.** Every user who signs up gets their own workspace; there is no single-tenant lock. For a private instance, restrict sign-ups at the Firebase Auth layer (e.g. an authorized-domain / allow-list, or disable public sign-up).

## 8. Verify it works

1. Open the web app and **sign up** (Google or email/password).
2. Complete **onboarding** — a default agent is created.
3. Add a **knowledge** URL or upload a file; confirm it reaches **indexed** (this exercises the scraper + Pinecone path).
4. Create the **web-widget** channel and open the embed snippet on a test page.
5. **Chat** through the widget and confirm you get an answer grounded in your knowledge base.
6. *(Optional)* Connect **Telegram** with a BotFather token and message the bot.

If ingestion never leaves `pending`/`processing`, re-check §5 (the scraper mode) and the Pinecone index dimension (768).
````

- [ ] **Step 2: Verify referenced repo paths exist**

Run: the referenced files must all exist.

```bash
cd /Users/nick/Projects/ayooda
for f in firestore.rules firestore.indexes.json apps/api/Dockerfile apps/api/scripts/backfill-trials.ts apps/api/scripts/setup-stripe.ts apps/widget/package.json; do
  test -e "$f" && echo "OK  $f" || echo "MISSING  $f"
done
```

Expected: every line prints `OK`. If any prints `MISSING`, fix the reference in the guide (or remove it).

- [ ] **Step 3: Confirm the guide references no unknown env vars**

Every `NEXT_PUBLIC_*`/`FIREBASE_*`/`PINECONE_*`/etc. name in the guide should be a real code var. Sanity grep — the guide's variable names should all appear in the `.env.example` files:

```bash
cd /Users/nick/Projects/ayooda
comm -23 \
  <(grep -oE "\b[A-Z][A-Z0-9_]{3,}\b" docs/self-hosting.md | sort -u) \
  <(cat apps/*/.env.example | grep -oE "^#? *[A-Z0-9_]+=" | tr -d '#= ' | sort -u) \
  | grep -E "FIREBASE|PINECONE|GEMINI|OPENROUTER|STRIPE|LANGFUSE|BILLING|SCRAPER|WIDGET|ALLOWED|API_|WEB_|PORT|WORKSPACE|AGENT|DOC_|STORAGE|PUPPETEER|NEXT_PUBLIC" || echo "OK — no unknown env var names"
```

Expected: `OK — no unknown env var names` (any remaining lines are non-env acronyms like `HTTP`/`JSON`/`REST`/`CORS`/`GCP`/`SDK` — confirm each is not an env var).

- [ ] **Step 4: Full test suite still green (no code changed)**

Run: `cd apps/api && bun test`
Expected: PASS (unchanged — this task adds only docs).

- [ ] **Step 5: Commit**

```bash
git add docs/self-hosting.md
git commit -m "docs: self-hosting deploy guide"
```

---

## Out of scope

Docker Compose; a web Dockerfile / Next standalone image; a scraper HTTP-trigger service; a `BILLING_ENABLED` code toggle; de-Firebase work; Kubernetes/Helm; automated provisioning.
