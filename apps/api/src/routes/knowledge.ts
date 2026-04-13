import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'

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

  // TODO: trigger Cloud Run scraper job here once deployed
  // await triggerScraperJob({ workspaceId, docId: docRef.id, url: normalised })

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

  await docRef.delete()

  // TODO: delete vectors from Pinecone
  // await pinecone.index(process.env.PINECONE_INDEX!).namespace(`workspace_${workspaceId}`)
  //   .deleteMany({ filter: { docId } })

  return c.json({ ok: true })
})

export default knowledge
