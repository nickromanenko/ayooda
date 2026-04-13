/**
 * Ayooda Scraper — Cloud Run Job entry point
 *
 * Required env vars:
 *   WORKSPACE_ID, DOC_ID, URL
 *   FIREBASE_PROJECT_ID
 *   GOOGLE_APPLICATION_CREDENTIALS  (or FIREBASE_SERVICE_ACCOUNT_KEY for inline JSON)
 *   PINECONE_API_KEY, PINECONE_INDEX
 *   GEMINI_API_KEY
 */

import puppeteer from 'puppeteer'
import { initializeApp, getApps, cert, type AppOptions } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { Pinecone } from '@pinecone-database/pinecone'
import { GoogleGenerativeAI } from '@google/generative-ai'

// ---------------------------------------------------------------------------
// Firebase Admin
// ---------------------------------------------------------------------------

function initFirebase() {
  if (getApps().length > 0) return
  const options: AppOptions = { projectId: process.env.FIREBASE_PROJECT_ID }
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

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' })
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH)
    const res = await model.batchEmbedContents({
      requests: batch.map((text) => ({
        content: { parts: [{ text }], role: 'user' as const },
      })),
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
  workspaceId: string,
  docId: string,
  source: string,
  chunks: string[],
  embeddings: number[][],
): Promise<void> {
  const ns = pinecone.index(process.env.PINECONE_INDEX!).namespace(`ws_${workspaceId}`)

  const vectors = chunks.map((text, i) => ({
    id: `${docId}_${i}`,
    values: embeddings[i],
    metadata: { workspaceId, docId, source, chunkIndex: i, text },
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
  const url = process.env.URL

  if (!workspaceId || !docId || !url) {
    console.error('Missing required env vars: WORKSPACE_ID, DOC_ID, URL')
    process.exit(1)
  }

  initFirebase()
  const db = getFirestore()
  const docRef = db.doc(`workspaces/${workspaceId}/knowledge/${docId}`)

  try {
    // Mark as processing
    await docRef.update({ status: 'processing' })
    console.log(`[scraper] Processing ${url}`)

    // Crawl
    const pages = await crawl(url)
    console.log(`[scraper] Crawled ${pages.size} pages`)

    // Chunk
    const allChunks: string[] = []
    for (const [pageUrl, text] of pages) {
      const chunks = chunkText(text)
      console.log(`[scraper] ${pageUrl}: ${chunks.length} chunks`)
      allChunks.push(...chunks)
    }

    if (allChunks.length === 0) {
      throw new Error('No text content found on the page')
    }

    // Embed
    console.log(`[scraper] Embedding ${allChunks.length} chunks…`)
    const embeddings = await embedBatch(allChunks, process.env.GEMINI_API_KEY!)

    // Upsert to Pinecone
    console.log(`[scraper] Upserting to Pinecone…`)
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! })
    await upsertVectors(pinecone, workspaceId, docId, url, allChunks, embeddings)

    // Mark as indexed
    await docRef.update({
      status: 'indexed',
      chunkCount: allChunks.length,
      indexedAt: FieldValue.serverTimestamp(),
      errorMessage: null,
    })

    console.log(`[scraper] Done — ${allChunks.length} chunks indexed`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[scraper] Failed:', message)
    await docRef.update({ status: 'error', errorMessage: message }).catch(() => {})
    process.exit(1)
  }
}

main()
