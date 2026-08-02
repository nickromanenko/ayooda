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

async function triggerCloudRunJob(jobUrl: string, params: IngestionJobParams): Promise<void> {
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

  // Cloud Run Jobs requires an OIDC token when called from another GCP service.
  // When running on Cloud Run itself, the metadata server provides one automatically
  // via the Authorization header populated by the service account.
  const res = await fetch(jobUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
}

function triggerLocal(params: IngestionJobParams): void {
  // Resolve path to scraper entry relative to this file's location:
  //   apps/api/src/lib/scraper.ts  →  ../../..  →  apps/
  //   then ../scraper/src/index.ts
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const scraperEntry = path.resolve(__dirname, '../../../../scraper/src/index.ts')

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

  const child = spawn('bun', ['run', scraperEntry], {
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  child.unref()
}
