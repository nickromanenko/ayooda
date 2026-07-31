import { Hono } from 'hono'
import { adminDb, adminBucket } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { triggerIngestion } from '../lib/scraper'
import { namespaceFor } from '../lib/pinecone'
import { validateKnowledgeFile } from '@ayooda/shared'

const knowledge = new Hono<{ Variables: AuthVariables }>()

knowledge.use('*', requireAuth)
knowledge.use('*', requireOwner)

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
  triggerIngestion({ workspaceId, docId: docRef.id, docType: 'webpage', url: normalised })

  return c.json({ docId: docRef.id, status: 'pending' }, 201)
})

/** POST /knowledge/upload — upload a file (pdf/docx/txt/csv/md) for indexing */
knowledge.post('/upload', async (c) => {
  const workspaceId = c.get('workspaceId')

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return c.json({ error: 'file is required (multipart form-data)' }, 400)

  const validation = validateKnowledgeFile(file.name, file.size)
  if (!validation.ok) {
    return c.json({ error: validation.error }, file.size > 0 && validation.error.includes('10 MB') ? 413 : 400)
  }

  // Dedupe by filename within the workspace
  const existing = await adminDb
    .collection(`workspaces/${workspaceId}/knowledge`)
    .where('source', '==', file.name)
    .where('type', '==', 'file')
    .limit(1)
    .get()
  if (!existing.empty) {
    return c.json({ error: `"${file.name}" has already been uploaded` }, 409)
  }

  const docRef = adminDb.collection(`workspaces/${workspaceId}/knowledge`).doc()
  const storagePath = `workspaces/${workspaceId}/knowledge/${docRef.id}/${file.name}`

  await adminBucket()
    .file(storagePath)
    .save(Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || 'application/octet-stream',
    })

  await docRef.set({
    type: 'file',
    source: file.name,
    storagePath,
    status: 'pending',
    chunkCount: 0,
    errorMessage: null,
    createdAt: new Date(),
    indexedAt: null,
  })

  triggerIngestion({ workspaceId, docId: docRef.id, docType: 'file', storagePath })

  return c.json({ docId: docRef.id, status: 'pending' }, 201)
})

/** POST /knowledge/:id/reindex — clear vectors and re-run ingestion for an existing doc */
knowledge.post('/:id/reindex', async (c) => {
  const workspaceId = c.get('workspaceId')
  const docId = c.req.param('id')

  const docRef = adminDb.doc(`workspaces/${workspaceId}/knowledge/${docId}`)
  const snap = await docRef.get()
  if (!snap.exists) return c.json({ error: 'Not found' }, 404)

  const data = snap.data() as {
    type: 'webpage' | 'file'
    source: string
    storagePath?: string
  }

  if (data.type === 'file' && !data.storagePath) {
    return c.json({ error: 'This file cannot be re-indexed (no stored file).' }, 409)
  }

  // Best-effort clear existing vectors (same as delete)
  try {
    await namespaceFor(workspaceId).deleteMany({ docId })
  } catch (err) {
    console.warn(`[knowledge] Pinecone clear failed for reindex ${docId}:`, err)
  }

  await docRef.update({
    status: 'pending',
    chunkCount: 0,
    errorMessage: null,
    indexedAt: null,
  })

  triggerIngestion(
    data.type === 'file'
      ? { workspaceId, docId, docType: 'file', storagePath: data.storagePath }
      : { workspaceId, docId, docType: 'webpage', url: data.source },
  )

  return c.json({ ok: true, status: 'pending' })
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

  // Delete the stored file, if any (best-effort — don't block on failure)
  const { storagePath } = snap.data() as { storagePath?: string }
  if (storagePath) {
    try {
      await adminBucket().file(storagePath).delete()
    } catch (err) {
      console.warn(`[knowledge] Storage delete failed for doc ${docId}:`, err)
    }
  }

  await docRef.delete()
  return c.json({ ok: true })
})

export default knowledge
