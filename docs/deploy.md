# Deployment Runbook

Ships the whole stack to the `ayooda-1791f` Firebase/GCP project. Follow the sections in order — later steps depend on earlier ones. **Deploy the API and web together**: the web app calls only the current API surface (the old `/workspace/agent` and `/workspace/key` endpoints were removed).

> **How deploys run.** The **API** (`ayooda-api` Cloud Run service) and **scraper** (`ayooda-scraper` Cloud Run Job) deploy via **GitHub Actions** on push to `master` — `.github/workflows/deploy-api.yml` and `deploy-scraper.yml` build to **Artifact Registry** (`us-central1-docker.pkg.dev/ayooda-1791f/ayooda/{api,scraper}`) and roll out; both also support manual `workflow_dispatch`. The **web** auto-deploys via Firebase App Hosting on `master`. These CI flows do **not** set env vars/secrets — those persist on the service/job and are configured once via the commands below. The **widget** and **Firestore** deploy from the CLI (§2, §4a).

## Prerequisites

```bash
npm install -g firebase-tools
gcloud auth login
gcloud config set project ayooda-1791f
firebase use ayooda-1791f
```

---

## 0. One-time infra & accounts

- **Firebase**: Firestore (Native mode), Authentication (Google + Email/Password), a Storage bucket (`ayooda-1791f.firebasestorage.app`), and a service-account JSON (Project settings → Service accounts).
- **Pinecone**: the active index is **`ayooda-dev`** — **768 dimensions, cosine** (must match `gemini-embedding-001` @ 768). A dedicated `ayooda-prod` index is optional and currently deferred; if you create one, point `PINECONE_INDEX` on both the API service and the scraper job at it and re-index (§6).
- **Vercel AI Gateway**: create an account and an API key. The free tier serves only some models (Gemini Flash); **add paid credits** to use Claude / GPT / Gemini Pro. A workspace agent can also bring its own Gateway key.
- **Stripe**: a Stripe account (test or live) for billing (§3).

---

## 1. Secrets — Secret Manager (one-time)

```bash
echo -n "$FIREBASE_SERVICE_ACCOUNT_KEY_JSON" | gcloud secrets create firebase-service-account-key --data-file=-
echo -n "$PINECONE_API_KEY"                  | gcloud secrets create pinecone-api-key            --data-file=-
echo -n "$GEMINI_API_KEY"                     | gcloud secrets create gemini-api-key              --data-file=-
echo -n "$API_KEY_ENCRYPTION_SECRET"          | gcloud secrets create api-key-encryption-secret   --data-file=-
echo -n "$AI_GATEWAY_API_KEY"                 | gcloud secrets create ai-gateway-api-key          --data-file=-
echo -n "$STRIPE_SECRET_KEY"                  | gcloud secrets create stripe-secret-key           --data-file=-
echo -n "$STRIPE_WEBHOOK_SECRET"              | gcloud secrets create stripe-webhook-secret       --data-file=-
# Optional tracing:
# echo -n "$LANGFUSE_SECRET_KEY" | gcloud secrets create langfuse-secret-key --data-file=-
```

> **`API_KEY_ENCRYPTION_SECRET` must stay stable** — rotating it invalidates every stored encrypted value (agent Gateway keys, tool secrets, Telegram bot tokens). `stripe-webhook-secret` is filled in after §3.

---

## 2. Firestore — rules + indexes

```bash
firebase deploy --only firestore
```

Deploys `firestore.rules` (agents/tools/workflowRules are server-only; knowledge/tools secrets are never client-readable) and `firestore.indexes.json`. Watch the Firebase console for index builds to finish. If a query later needs a composite index, add it to `firestore.indexes.json` and re-run this command.

---

## 3. Stripe — products, prices, overage meter, webhook

```bash
cd apps/api
set -a && source .env && set +a          # must include STRIPE_SECRET_KEY
bun run scripts/setup-stripe.ts
```

`setup-stripe.ts` is idempotent and prints:
- `STRIPE_PRICE_LITE`, `STRIPE_PRICE_CORE`, `STRIPE_PRICE_MAX` (the three membership prices), and
- `STRIPE_PRICE_OVERAGE` + `STRIPE_OVERAGE_METER_EVENT` (the metered $0.05/conversation overage price + its Billing Meter).

Paste all five into the API env (§4). Then:
- Register a webhook endpoint in the Stripe dashboard → `POST {API_PUBLIC_URL}/billing/webhook`, subscribe to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`; copy its signing secret into the `stripe-webhook-secret` Secret Manager value.
- Set `BILLING_SUCCESS_URL` and `BILLING_CANCEL_URL` (e.g. `https://<web-domain>/dashboard/billing?checkout=success|cancel`).

---

## 4. Deploy the services

### 4a. Widget → Firebase Hosting

```bash
pnpm --filter widget build
firebase deploy --only hosting:widget
```

Served at `https://ayooda-1791f.web.app/widget.js` (set `WIDGET_BASE_URL` to this origin below).

### 4b. API → Cloud Run

The image build + rollout is automatic: pushing to `master` (any change under `apps/api/**` or `packages/shared/**`) runs `deploy-api.yml`, which builds `us-central1-docker.pkg.dev/ayooda-1791f/ayooda/api:<sha>` and `gcloud run deploy ayooda-api`. Trigger a build without a code change with `gh workflow run deploy-api.yml`.

CI never touches env/secrets. Configure them **once** on the service (they persist across revisions). Create the four sensitive Secret Manager secrets per §1, grant the runtime service account `roles/secretmanager.secretAccessor` on each, then:

```bash
gcloud run services update ayooda-api --region us-central1 \
  --update-secrets "FIREBASE_SERVICE_ACCOUNT_KEY=firebase-service-account-key:latest,PINECONE_API_KEY=pinecone-api-key:latest,GEMINI_API_KEY=gemini-api-key:latest,API_KEY_ENCRYPTION_SECRET=api-key-encryption-secret:latest,AI_GATEWAY_API_KEY=ai-gateway-api-key:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest" \
  --update-env-vars "FIREBASE_PROJECT_ID=ayooda-1791f,FIREBASE_STORAGE_BUCKET=ayooda-1791f.firebasestorage.app,PINECONE_INDEX=ayooda-dev,WIDGET_BASE_URL=https://ayooda-1791f.web.app,ALLOWED_ORIGINS=https://<web-domain>,API_PUBLIC_URL=https://<api-domain>,WEB_PUBLIC_URL=https://<web-domain>,STRIPE_PRICE_LITE=price_...,STRIPE_PRICE_CORE=price_...,STRIPE_PRICE_MAX=price_...,STRIPE_PRICE_OVERAGE=price_...,STRIPE_OVERAGE_METER_EVENT=ayooda_overage_conversations,BILLING_SUCCESS_URL=https://<web-domain>/dashboard/billing?checkout=success,BILLING_CANCEL_URL=https://<web-domain>/dashboard/billing?checkout=cancel,SCRAPER_JOB_URL=<set-after-4c>"
```

Any `--update-env-vars` / `--update-secrets` call mints a new revision — that *is* the redeploy that picks up the config.

**Env checklist (must all be present):** secrets — `FIREBASE_SERVICE_ACCOUNT_KEY`, `PINECONE_API_KEY`, `GEMINI_API_KEY`, `API_KEY_ENCRYPTION_SECRET`, `AI_GATEWAY_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; config — `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `PINECONE_INDEX=ayooda-dev`, `WIDGET_BASE_URL`, `ALLOWED_ORIGINS`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `STRIPE_PRICE_LITE/CORE/MAX`, `STRIPE_PRICE_OVERAGE`, `STRIPE_OVERAGE_METER_EVENT`, `BILLING_SUCCESS_URL`, `BILLING_CANCEL_URL`, `SCRAPER_JOB_URL`. Note the deployed service URL and use it for `API_PUBLIC_URL` + the web's `NEXT_PUBLIC_API_URL`.

### 4c. Scraper → Cloud Run Job

The image updates automatically: pushing to `master` (any change under `apps/scraper/**` or `packages/shared/**`) runs `deploy-scraper.yml`, which builds `us-central1-docker.pkg.dev/ayooda-1791f/ayooda/scraper:<sha>` and `gcloud run jobs update ayooda-scraper`. The build uses `apps/scraper/Dockerfile.dockerignore` (BuildKit picks it over the repo-root `.dockerignore`, which excludes `apps/scraper`) — do not delete it or the CI build breaks.

Create the job **once** (CI only updates the image thereafter):

```bash
gcloud run jobs create ayooda-scraper \
  --image us-central1-docker.pkg.dev/ayooda-1791f/ayooda/scraper:latest --region us-central1 \
  --memory 2Gi --cpu 2 --task-timeout 900s --max-retries 1 \
  --service-account <runtime-sa> \
  --set-secrets "FIREBASE_SERVICE_ACCOUNT_KEY=firebase-service-account-key:latest,PINECONE_API_KEY=pinecone-api-key:latest,GEMINI_API_KEY=gemini-api-key:latest" \
  --set-env-vars "FIREBASE_PROJECT_ID=ayooda-1791f,FIREBASE_STORAGE_BUCKET=ayooda-1791f.firebasestorage.app,PINECONE_INDEX=ayooda-dev"
```

Then set `SCRAPER_JOB_URL` on the API service to the job's **Cloud Run v2** run URL (the trigger in `apps/api/src/lib/scraper.ts` posts the `overrides.containerOverrides` v2 body and authenticates with a metadata access token):
`https://run.googleapis.com/v2/projects/ayooda-1791f/locations/us-central1/jobs/ayooda-scraper:run`
and grant the API's runtime service account `roles/run.invoker` on the job. (Per-doc vars `WORKSPACE_ID`/`AGENT_ID`/`DOC_ID`/`DOC_TYPE`/`URL`/`STORAGE_PATH`/`PINECONE_NAMESPACE` are injected per run by the API — do not set them on the job.)

### 4d. Web → Firebase App Hosting

Set `NEXT_PUBLIC_API_URL` (the Cloud Run API URL) and the `NEXT_PUBLIC_FIREBASE_*` values in `apps/web/apphosting.yaml`, plus the server-side `FIREBASE_SERVICE_ACCOUNT_KEY`. Then push to `master` (App Hosting auto-deploys) or:

```bash
firebase apphosting:rollouts:create --project ayooda-1791f --backend <backend-id>
```

**Deploy the web at the same time as the API (§4b).**

---

## 5. Data migrations (run once, after the API image has prod creds)

Run each from a machine with the production env loaded (`cd apps/api && set -a && source .env.prod && set +a && bun run scripts/<name>.ts`). **Order matters:**

1. **`scripts/migrate-agents.ts`** — *required.* Creates the default agent per workspace, reparents `knowledge` + `tools` under it, tags channels with `agentId`. Without it, agent resolution / knowledge / tools break for pre-existing workspaces. Idempotent.
2. **`scripts/backfill-trials.ts`** — grants existing workspaces a fresh 14-day trial so pre-billing workspaces aren't immediately gated. Run before customers hit the billing gate.
3. **`scripts/backfill-overage-item.ts`** — adds the metered overage price (`STRIPE_PRICE_OVERAGE`) to existing `active`/`past_due`/`trialing` subscriptions so overage bills. Requires `STRIPE_PRICE_OVERAGE` in the env. Idempotent.

---

## 6. Re-index existing knowledge

Because the deployment stays on **`ayooda-dev`**, existing vectors are preserved in their original (legacy) namespaces — `migrate-agents.ts` does not re-embed. Re-indexing is only needed if you (a) move to a fresh `ayooda-prod` index, or (b) want existing docs served from their new **per-agent namespaces**. In either case, re-run ingestion per doc — the dashboard **Knowledge → re-index** button, or a scripted pass re-triggering `triggerIngestion` for every `agents/{id}/knowledge` doc. New scrapes/uploads always index into the per-agent namespace with no action.

---

## 7. Post-deploy smoke test

- [ ] Sign up (Google or email/password) → land in the dashboard.
- [ ] Complete onboarding → a **default agent** is created.
- [ ] Add a knowledge URL/file → it reaches **`indexed`** (validates the scraper job trigger + Pinecone `ayooda-dev` path).
- [ ] Open the widget embed on a test page → chat returns a **grounded** answer (use a **Gemini** model — works on the free Gateway tier).
- [ ] **Billing** page shows usage against the included pack; a checkout creates a subscription with **two items** (flat + metered).
- [ ] Add a **Workflow** rule (e.g. "ask for a human") → a matching message moves the conversation to the inbox **Waiting** queue; take it over.
- [ ] Create a **Tool** and run **Test** → a live response comes back.
- [ ] (Optional) Connect **Telegram** and message the bot.

---

## 8. Known limitations & deferred follow-ups

Tracked so they aren't lost. **All recommended to defer** — none block shipping.

| Item | Source feature | Severity | Recommendation |
|---|---|---|---|
| Reindex UI swallows a non-2xx response | knowledge/polish | minor UX | defer |
| Per-IP rate limit trusts `X-Forwarded-For` (spoofable) | polish/rate-limit | low (per-channel limit is the backstop) | defer |
| Channel-connect TOCTOU on concurrent connects | Telegram | low (single owner in practice) | defer |
| Remove-member orphans `operatorId` on taken-over convos | team members | low | defer |
| Events-feed reconnect cursor (operator msgs lost in reconnect gaps) | v1 SSE | low | defer |
| Invite create not transactional (tight race) | team members | low | defer |
| Live E2Es unrun: tool round-trip, per-agent namespace isolation, overage metering, Gateway multi-provider | multiple | verification | run during/after this deploy with real keys |
