import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { triggerScraper } from '../lib/scraper'
import { namespaceFor } from '../lib/pinecone'

const knowledge = new Hono<{ Variables: AuthVariables }>()

knowledge.use('*', requireAuth)

/** POST /knowledge/scrape — queue a URL for scraping */
knowledge.post('/scrape', async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{ url: string }>()

  if (!body.url) return c.json({ error: 'url is required' }, 400)

  let normalised: string
  try {
    normalised = new URL(body.url).toString()
  } catch {
    return c.json({ error: 'Invalid URL' }, 400)
  }

  // Check for duplicate URL in this workspace
  const existing = await adminDb
    .collection(`workspaces/${workspaceId}/knowledge`)
    .where('source', '==', normalised)
    .where('type', '==', 'webpage')
    .limit(1)
    .get()

  if (!existing.empty) {
    const doc = existing.docs[0]
    return c.json({ docId: doc.id, status: doc.data().status })
  }

  const docRef = await adminDb.collection(`workspaces/${workspaceId}/knowledge`).add({
    type: 'webpage',
    source: normalised,
    status: 'pending',
    chunkCount: 0,
    errorMessage: null,
    createdAt: new Date(),
    indexedAt: null,
  })

  // Fire-and-forget: Cloud Run Job in prod, local Bun spawn in dev
  triggerScraper({ workspaceId, docId: docRef.id, url: normalised })

  return c.json({ docId: docRef.id, status: 'pending' }, 201)
})

/** GET /knowledge — list all knowledge docs for the workspace */
knowledge.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/knowledge`)
    .orderBy('createdAt', 'desc')
    .get()

  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  return c.json(docs)
})

/** DELETE /knowledge/:id — remove a knowledge doc and its vectors */
knowledge.delete('/:id', async (c) => {
  const workspaceId = c.get('workspaceId')
  const docId = c.req.param('id')

  const docRef = adminDb.doc(`workspaces/${workspaceId}/knowledge/${docId}`)
  const snap = await docRef.get()
  if (!snap.exists) return c.json({ error: 'Not found' }, 404)

  // Delete Pinecone vectors (best-effort — don't block on failure)
  try {
    await namespaceFor(workspaceId).deleteMany({ docId })
  } catch (err) {
    console.warn(`[knowledge] Pinecone delete failed for doc ${docId}:`, err)
  }

  await docRef.delete()
  return c.json({ ok: true })
})

export default knowledge
