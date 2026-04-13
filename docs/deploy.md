# Deployment Guide

## Prerequisites

```bash
npm install -g firebase-tools
gcloud auth login
gcloud config set project ayooda-1791f
```

---

## 1. Firestore — push rules and indexes

```bash
firebase deploy --only firestore
```

This deploys `firestore.rules` and `firestore.indexes.json`.

---

## 2. Widget — build and deploy to Firebase Hosting

```bash
pnpm --filter widget build
firebase deploy --only hosting
```

The `dist/widget.js` IIFE is served from `https://ayooda-1791f.web.app/widget.js`.

---

## 3. API — build and deploy to Cloud Run

### Build and push the Docker image

```bash
gcloud builds submit apps/api \
  --tag gcr.io/ayooda-1791f/ayooda-api \
  --ignore-file apps/api/.dockerignore \
  --gcs-source-staging-dir gs://ayooda-1791f_cloudbuild/source
```

### Deploy to Cloud Run

```bash
gcloud run deploy ayooda-api \
  --image gcr.io/ayooda-1791f/ayooda-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 10 \
  --set-secrets "FIREBASE_SERVICE_ACCOUNT_KEY=firebase-service-account-key:latest,PINECONE_API_KEY=pinecone-api-key:latest,GEMINI_API_KEY=gemini-api-key:latest" \
  --set-env-vars "FIREBASE_PROJECT_ID=ayooda-1791f,PINECONE_INDEX=ayooda-prod,WIDGET_BASE_URL=https://ayooda-1791f.web.app,ALLOWED_ORIGINS=https://ayooda-1791f.web.app"
```

After deploy, note the service URL and update `NEXT_PUBLIC_API_URL` in `apps/web/apphosting.yaml`.

### Create secrets in Secret Manager (one-time)

```bash
echo -n "$FIREBASE_SERVICE_ACCOUNT_KEY_JSON" | \
  gcloud secrets create firebase-service-account-key --data-file=-

echo -n "$PINECONE_API_KEY" | \
  gcloud secrets create pinecone-api-key --data-file=-

echo -n "$GEMINI_API_KEY" | \
  gcloud secrets create gemini-api-key --data-file=-
```

---

## 4. Scraper — build and deploy as a Cloud Run Job

```bash
# Build image
gcloud builds submit apps/scraper \
  --tag gcr.io/ayooda-1791f/ayooda-scraper \
  --ignore-file apps/scraper/.dockerignore

# Create the Cloud Run Job
gcloud run jobs create ayooda-scraper \
  --image gcr.io/ayooda-1791f/ayooda-scraper \
  --region us-central1 \
  --memory 1Gi \
  --cpu 2 \
  --task-timeout 10m \
  --max-retries 1 \
  --set-secrets "FIREBASE_SERVICE_ACCOUNT_KEY=firebase-service-account-key:latest,PINECONE_API_KEY=pinecone-api-key:latest,GEMINI_API_KEY=gemini-api-key:latest" \
  --set-env-vars "FIREBASE_PROJECT_ID=ayooda-1791f,PINECONE_INDEX=ayooda-prod"
```

Then set `SCRAPER_JOB_URL` in the API Cloud Run service to the job execution URL:

```
https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/ayooda-1791f/jobs/ayooda-scraper:run
```

The API uses the Cloud Run Jobs REST API to trigger the job. Make sure the API's service account has the `roles/run.invoker` IAM role on the job.

---

## 5. Web (Next.js) — deploy via Firebase App Hosting

### One-time setup (in Firebase console or CLI)

```bash
firebase apphosting:backends:create \
  --project ayooda-1791f \
  --location us-central1
```

Point it to the `apps/web` directory in the monorepo. App Hosting reads `apps/web/apphosting.yaml` automatically.

### Deploy

```bash
# App Hosting auto-deploys on push to the connected branch (main/master).
# To trigger a manual deploy:
firebase apphosting:rollouts:create \
  --project ayooda-1791f \
  --backend <backend-id>
```

Or simply push to `master` — App Hosting auto-deploys via the GitHub integration.

---

## Post-deployment checklist

- [ ] Update `NEXT_PUBLIC_API_URL` in `apps/web/apphosting.yaml` with the real Cloud Run URL
- [ ] Update `SCRAPER_JOB_URL` in the API Cloud Run service env vars with the job execution URL
- [ ] Update `ALLOWED_ORIGINS` in the API to include the App Hosting domain
- [ ] Verify `firebase deploy --only firestore` succeeded (check Firebase console for index build status)
- [ ] Test the widget embed on a test HTML page pointing to the production API
