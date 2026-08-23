/**
 * Ayooda Scraper — Cloud Run Job entry point
 *
 * Required env vars:
 *   WORKSPACE_ID, DOC_ID, DOC_TYPE (webpage|file)
 *   URL (webpage) or STORAGE_PATH (file)
 *   FIREBASE_PROJECT_ID
 *   GOOGLE_APPLICATION_CREDENTIALS  (or FIREBASE_SERVICE_ACCOUNT_KEY for inline JSON)
 *   FIREBASE_STORAGE_BUCKET  (optional; defaults to `${FIREBASE_PROJECT_ID}.firebasestorage.app`)
 *   PINECONE_API_KEY, PINECONE_INDEX
 *   GEMINI_API_KEY
 */

import puppeteer from 'puppeteer'
import { initializeApp, getApps, cert, type AppOptions } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { Pinecone } from '@pinecone-database/pinecone'
import { GoogleGenerativeAI, type EmbedContentRequest } from '@google/generative-ai'
import {
  isKnowledgeSyncInterval,
  knowledgeSyncRetryAt,
  nextKnowledgeSyncAt,
} from '@ayooda/shared'
import { extractText } from './extract'

// ---------------------------------------------------------------------------
// Firebase Admin
// ---------------------------------------------------------------------------

function initFirebase() {
  if (getApps().length > 0) return
  const options: AppOptions = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ?? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`,
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    options.credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
  }
  initializeApp(options)
}

// ---------------------------------------------------------------------------
// Crawling
// ---------------------------------------------------------------------------

const MAX_PAGES = 25

/**
 * Crawl up to MAX_PAGES same-origin pages starting from `startUrl`.
 * Returns a map of url → raw page text.
 */
async function crawl(startUrl: string): Promise<Map<string, string>> {
  const origin = new URL(startUrl).origin
  const visited = new Set<string>()
  const queue = [startUrl]
  const results = new Map<string, string>()

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    while (queue.length > 0 && results.size < MAX_PAGES) {
      const url = queue.shift()!
      if (visited.has(url)) continue
      visited.add(url)

      let text: string
      let links: string[]
      try {
        ;({ text, links } = await scrapePage(browser, url))
      } catch (err) {
        console.warn(`Skipping ${url}:`, err)
        continue
      }

      if (text.trim().length > 100) {
        results.set(url, text)
      }

      // Enqueue same-origin links not yet visited
      for (const link of links) {
        if (!visited.has(link) && !queue.includes(link)) {
          queue.push(link)
        }
      }
    }
  } finally {
    await browser.close()
  }

  return results
}

async function scrapePage(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  url: string,
): Promise<{ text: string; links: string[] }> {
  const origin = new URL(url).origin
  const page = await browser.newPage()
  await page.setUserAgent(
    'Mozilla/5.0 (compatible; AyoodaBot/1.0; +https://ayooda.com/bot)',
  )

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })

    const { text, links } = await page.evaluate((pageOrigin: string) => {
      // Remove noisy elements
      const remove = ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header', '[aria-hidden="true"]']
      remove.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => el.remove())
      })

      const rawText = document.body?.innerText ?? ''
      const cleaned = rawText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join('\n')

      // Collect same-origin links
      const hrefs: string[] = []
      document.querySelectorAll('a[href]').forEach((el) => {
        try {
          const href = el.getAttribute('href')!
          const resolved = new URL(href, pageOrigin)
          if (
            resolved.origin === pageOrigin &&
            !resolved.pathname.match(/\.(pdf|png|jpg|jpeg|gif|svg|zip|mp4|css|js)$/i)
          ) {
            // Normalise: strip hash and trailing slash
            resolved.hash = ''
            const normalised = resolved.toString().replace(/\/$/, '')
            hrefs.push(normalised)
          }
        } catch {
          // ignore malformed hrefs
        }
      })

      return { text: cleaned, links: [...new Set(hrefs)] }
    }, origin)

    return { text, links }
  } finally {
    await page.close()
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const CHUNK_WORDS = 400
const OVERLAP_WORDS = 40

/**
 * Split text into overlapping word-based chunks.
 * Each chunk is ~CHUNK_WORDS words with OVERLAP_WORDS carry-over from the previous chunk.
 */
function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS, words.length)
    chunks.push(words.slice(start, end).join(' '))
    if (end === words.length) break
    start = end - OVERLAP_WORDS
  }

  return chunks
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

const EMBED_BATCH = 100
const EMBEDDING_DIMENSIONS = 768 // must match the 768-dim Pinecone index

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' })
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH)
    const res = await model.batchEmbedContents({
      requests: batch.map(
        (text) =>
          ({
            content: { parts: [{ text }], role: 'user' as const },
            outputDimensionality: EMBEDDING_DIMENSIONS,
          }) as unknown as EmbedContentRequest,
      ),
    })
    results.push(...res.embeddings.map((e) => e.values))
  }

  return results
}

// ---------------------------------------------------------------------------
// Pinecone upsert
// ---------------------------------------------------------------------------

const UPSERT_BATCH = 100

async function upsertVectors(
  pinecone: Pinecone,
  namespace: string,
  workspaceId: string,
  agentId: string | undefined,
  docId: string,
  source: string,
  chunks: string[],
  embeddings: number[][],
): Promise<void> {
  const ns = pinecone.index(process.env.PINECONE_INDEX!).namespace(namespace)

  const vectors = chunks.map((text, i) => ({
    id: `${docId}_${i}`,
    values: embeddings[i],
    metadata: { workspaceId, ...(agentId ? { agentId } : {}), docId, source, chunkIndex: i, text },
  }))

  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    await ns.upsert(vectors.slice(i, i + UPSERT_BATCH))
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const workspaceId = process.env.WORKSPACE_ID
  const docId = process.env.DOC_ID
  const docType = process.env.DOC_TYPE ?? 'webpage'
  const url = process.env.URL
  const storagePath = process.env.STORAGE_PATH
  const agentId = process.env.AGENT_ID
  const namespace = process.env.PINECONE_NAMESPACE ?? `ws_${workspaceId}`

  if (!workspaceId || !docId) {
    console.error('Missing required env vars: WORKSPACE_ID, DOC_ID')
    process.exit(1)
  }
  if (docType === 'webpage' && !url) {
    console.error('DOC_TYPE=webpage requires URL')
    process.exit(1)
  }
  if (docType === 'file' && !storagePath) {
    console.error('DOC_TYPE=file requires STORAGE_PATH')
    process.exit(1)
  }
  if (docType !== 'webpage' && docType !== 'file') {
    console.error(`Unknown DOC_TYPE: ${docType}`)
    process.exit(1)
  }

  initFirebase()
  const db = getFirestore()
  const docRef = agentId
    ? db.doc(`workspaces/${workspaceId}/agents/${agentId}/knowledge/${docId}`)
    : db.doc(`workspaces/${workspaceId}/knowledge/${docId}`)

  try {
    // Mark as processing
    await docRef.update({ status: 'processing' })
    console.log(`[scraper] Processing ${docType === 'file' ? storagePath : url}`)

    const allChunks: string[] = []
    let source: string

    if (docType === 'file') {
      source = storagePath!.split('/').pop()!
      console.log(`[ingestor] Downloading ${storagePath}`)
      const [buffer] = await getStorage().bucket().file(storagePath!).download()
      const text = await extractText(source, buffer)
      allChunks.push(...chunkText(text))
      console.log(`[ingestor] ${source}: ${allChunks.length} chunks`)
    } else {
      source = url!
      const pages = await crawl(url!)
      console.log(`[ingestor] Crawled ${pages.size} pages`)
      for (const [pageUrl, text] of pages) {
        const chunks = chunkText(text)
        console.log(`[ingestor] ${pageUrl}: ${chunks.length} chunks`)
        allChunks.push(...chunks)
      }
    }

    if (allChunks.length === 0) {
      throw new Error('No text content found')
    }

    // Embed
    console.log(`[scraper] Embedding ${allChunks.length} chunks…`)
    const embeddings = await embedBatch(allChunks, process.env.GEMINI_API_KEY!)

    // Replace vectors only after crawling and embedding succeed, so an automatic refresh
    // keeps serving the previous index for almost the entire job instead of going dark.
    console.log(`[scraper] Replacing Pinecone vectors…`)
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! })
    await pinecone.index(process.env.PINECONE_INDEX!).namespace(namespace).deleteMany({ docId })
    await upsertVectors(pinecone, namespace, workspaceId, agentId, docId, source, allChunks, embeddings)

    // Mark as indexed and schedule the next refresh from completion time. Reading the
    // current document here means interval changes made while a crawl was running win.
    const completedAt = new Date()
    const current = (await docRef.get()).data()
    const interval = current?.syncIntervalHours
    const autoSyncEnabled = docType === 'webpage' && current?.autoSyncEnabled === true && isKnowledgeSyncInterval(interval)
    await docRef.update({
      status: 'indexed',
      chunkCount: allChunks.length,
      indexedAt: FieldValue.serverTimestamp(),
      errorMessage: null,
      ...(docType === 'webpage' ? {
        lastSyncedAt: completedAt,
        nextSyncAt: autoSyncEnabled ? nextKnowledgeSyncAt(completedAt, interval) : null,
        syncStartedAt: null,
        syncFailures: 0,
        syncError: null,
      } : {}),
    })

    console.log(`[scraper] Done — ${allChunks.length} chunks indexed`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[scraper] Failed:', message)
    const failedAt = new Date()
    const current = await docRef.get().then((snap) => snap.data()).catch(() => undefined)
    const interval = current?.syncIntervalHours
    const autoSyncEnabled = docType === 'webpage' && current?.autoSyncEnabled === true && isKnowledgeSyncInterval(interval)
    const failureCount = Math.max(0, Number(current?.syncFailures) || 0) + 1
    await docRef.update({
      status: 'error',
      errorMessage: message,
      ...(docType === 'webpage' ? {
        syncStartedAt: null,
        syncFailures: failureCount,
        syncError: message,
        nextSyncAt: autoSyncEnabled ? knowledgeSyncRetryAt(failedAt, failureCount) : null,
      } : {}),
    }).catch(() => {})
    process.exit(1)
  }
}

main()
