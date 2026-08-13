import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

interface IngestionJobParams {
  workspaceId: string
  docId: string
  docType: 'webpage' | 'file'
  url?: string
  storagePath?: string
  agentId?: string
  namespace?: string
}

/**
 * Trigger ingestion for a given knowledge doc (webpage scrape or file processing).
 *
 * Production (SCRAPER_JOB_URL is set):
 *   Executes a Cloud Run Job via the Cloud Run v2 Jobs API.
 *   The Job container reads WORKSPACE_ID / DOC_ID / DOC_TYPE / URL / STORAGE_PATH from the override env.
 *
 * Local dev (SCRAPER_JOB_URL is empty):
 *   Spawns the scraper TypeScript entry point directly with Bun (fire-and-forget).
 */
export function triggerIngestion(params: IngestionJobParams): void {
  const jobUrl = process.env.SCRAPER_JOB_URL

  if (jobUrl) {
    triggerCloudRunJob(jobUrl, params).catch((err) =>
      console.error('[scraper-trigger] Cloud Run trigger failed:', err),
    )
  } else {
    triggerLocal(params)
  }
}

/**
 * Fetch an OAuth2 access token for the runtime service account from the GCP
 * metadata server. Required to call the Cloud Run Admin API (run.googleapis.com):
 * outbound fetch from Cloud Run is NOT auto-authenticated — the app must obtain
 * and attach the token itself. Only reachable when running on GCP (Cloud Run);
 * in local dev SCRAPER_JOB_URL is empty so this path never runs.
 */
async function fetchMetadataAccessToken(): Promise<string> {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  )
  if (!res.ok) {
    throw new Error(`metadata token request failed: HTTP ${res.status}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) {
    throw new Error('metadata token response missing access_token')
  }
  return json.access_token
}

export async function triggerCloudRunJob(
  jobUrl: string,
  params: IngestionJobParams,
): Promise<void> {
  const jobEnv = [
    { name: 'WORKSPACE_ID', value: params.workspaceId },
    { name: 'DOC_ID', value: params.docId },
    { name: 'DOC_TYPE', value: params.docType },
    ...(params.url ? [{ name: 'URL', value: params.url }] : []),
    ...(params.storagePath ? [{ name: 'STORAGE_PATH', value: params.storagePath }] : []),
    ...(params.agentId ? [{ name: 'AGENT_ID', value: params.agentId }] : []),
    ...(params.namespace ? [{ name: 'PINECONE_NAMESPACE', value: params.namespace }] : []),
  ]

  const body = {
    overrides: {
      containerOverrides: [
        {
          env: jobEnv,
        },
      ],
    },
  }

  // The Cloud Run Admin API requires an OAuth2 Bearer access token for the
  // runtime service account (which must hold roles/run.invoker on the job).
  const accessToken = await fetchMetadataAccessToken()
  const res = await fetch(jobUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
}

function triggerLocal(params: IngestionJobParams): void {
  // Resolve path to the scraper entry relative to this file's location:
  //   apps/api/src/lib/scraper.ts  →  ../../../ (up 3)  →  apps/
  //   then scraper/src/index.ts
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const scraperEntry = path.resolve(__dirname, '../../../scraper/src/index.ts')

  const env = {
    ...process.env,
    WORKSPACE_ID: params.workspaceId,
    DOC_ID: params.docId,
    DOC_TYPE: params.docType,
    ...(params.url ? { URL: params.url } : {}),
    ...(params.storagePath ? { STORAGE_PATH: params.storagePath } : {}),
    ...(params.agentId ? { AGENT_ID: params.agentId } : {}),
    ...(params.namespace ? { PINECONE_NAMESPACE: params.namespace } : {}),
  }

  console.log(`[scraper-trigger] Spawning local scraper for docId=${params.docId}`)

  // Local dev only (triggerLocal runs when SCRAPER_JOB_URL is empty), so surface
  // the scraper's stderr in the API console and log spawn failures — otherwise a
  // broken spawn leaves the doc stuck at "pending" with no clue why.
  const child = spawn('bun', ['run', scraperEntry], {
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  child.on('error', (err) => console.error('[scraper-trigger] failed to spawn local scraper:', err))
  child.unref()
}
