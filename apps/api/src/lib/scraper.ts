import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

interface ScraperJobParams {
  workspaceId: string
  docId: string
  url: string
}

/**
 * Trigger the scraper for a given knowledge doc.
 *
 * Production (SCRAPER_JOB_URL is set):
 *   Executes a Cloud Run Job via the Cloud Run v2 Jobs API.
 *   The Job container reads WORKSPACE_ID / DOC_ID / URL from the override env.
 *
 * Local dev (SCRAPER_JOB_URL is empty):
 *   Spawns the scraper TypeScript entry point directly with Bun (fire-and-forget).
 */
export function triggerScraper(params: ScraperJobParams): void {
  const jobUrl = process.env.SCRAPER_JOB_URL

  if (jobUrl) {
    triggerCloudRunJob(jobUrl, params).catch((err) =>
      console.error('[scraper-trigger] Cloud Run trigger failed:', err),
    )
  } else {
    triggerLocal(params)
  }
}

async function triggerCloudRunJob(jobUrl: string, params: ScraperJobParams): Promise<void> {
  const body = {
    overrides: {
      containerOverrides: [
        {
          env: [
            { name: 'WORKSPACE_ID', value: params.workspaceId },
            { name: 'DOC_ID', value: params.docId },
            { name: 'URL', value: params.url },
          ],
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

function triggerLocal(params: ScraperJobParams): void {
  // Resolve path to scraper entry relative to this file's location:
  //   apps/api/src/lib/scraper.ts  →  ../../..  →  apps/
  //   then ../scraper/src/index.ts
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const scraperEntry = path.resolve(__dirname, '../../../../scraper/src/index.ts')

  const env = {
    ...process.env,
    WORKSPACE_ID: params.workspaceId,
    DOC_ID: params.docId,
    URL: params.url,
  }

  console.log(`[scraper-trigger] Spawning local scraper for docId=${params.docId}`)

  const child = spawn('bun', ['run', scraperEntry], {
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  child.unref()
}
