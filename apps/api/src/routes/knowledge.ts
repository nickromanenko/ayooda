import { Hono } from 'hono'
import { adminDb, adminBucket } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { triggerIngestion } from '../lib/scraper'
import { namespaceFor } from '../lib/pinecone'
import {
  deleteDocumentVectors,
  isKnowledgeSyncInterval,
  knowledgeSyncLeaseUntil,
  nextKnowledgeSyncAt,
  validateKnowledgeFile,
} from '@ayooda/shared'

const knowledge = new Hono<{ Variables: AuthVariables }>()

knowledge.use('*', requireAuth)
knowledge.use('*', requireAgent)

/** POST /knowledge/scrape — queue a URL for scraping */
knowledge.post('/scrape', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
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
    .collection(`workspaces/${workspaceId}/agents/${agentId}/knowledge`)
    .where('source', '==', normalised)
    .where('type', '==', 'webpage')
    .limit(1)
    .get()

  if (!existing.empty) {
    const doc = existing.docs[0]
    return c.json({ docId: doc.id, status: doc.data().status })
  }

  const docRef = await adminDb.collection(`workspaces/${workspaceId}/agents/${agentId}/knowledge`).add({
    type: 'webpage',
    source: normalised,
    status: 'pending',
    chunkCount: 0,
    errorMessage: null,
    createdAt: new Date(),
    indexedAt: null,
    autoSyncEnabled: false,
    syncIntervalHours: null,
    lastSyncedAt: null,
    nextSyncAt: null,
    syncStartedAt: null,
    syncFailures: 0,
    syncError: null,
  })

  // Fire-and-forget: Cloud Run Job in prod, local Bun spawn in dev
  void triggerIngestion({ workspaceId, docId: docRef.id, docType: 'webpage', url: normalised, agentId, namespace: c.get('agentNamespace')! })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[knowledge] scraper launch failed:', message)
      await docRef.update({ status: 'error', errorMessage: message }).catch(() => {})
    })

  return c.json({ docId: docRef.id, status: 'pending' }, 201)
})

/** POST /knowledge/upload — upload a file (pdf/docx/txt/csv/md) for indexing */
knowledge.post('/upload', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return c.json({ error: 'file is required (multipart form-data)' }, 400)

  const validation = validateKnowledgeFile(file.name, file.size)
  if (!validation.ok) {
    return c.json({ error: validation.error }, file.size > 0 && validation.error.includes('10 MB') ? 413 : 400)
  }

  // Dedupe by filename within the workspace
  const existing = await adminDb
    .collection(`workspaces/${workspaceId}/agents/${agentId}/knowledge`)
    .where('source', '==', file.name)
    .where('type', '==', 'file')
    .limit(1)
    .get()
  if (!existing.empty) {
    return c.json({ error: `"${file.name}" has already been uploaded` }, 409)
  }

  const docRef = adminDb.collection(`workspaces/${workspaceId}/agents/${agentId}/knowledge`).doc()
  const storagePath = `workspaces/${workspaceId}/agents/${agentId}/knowledge/${docRef.id}/${file.name}`

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

  void triggerIngestion({ workspaceId, docId: docRef.id, docType: 'file', storagePath, agentId, namespace: c.get('agentNamespace')! })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[knowledge] ingestor launch failed:', message)
      await docRef.update({ status: 'error', errorMessage: message }).catch(() => {})
    })

  return c.json({ docId: docRef.id, status: 'pending' }, 201)
})

/** POST /knowledge/:id/reindex — re-run ingestion for an existing doc */
knowledge.post('/:id/reindex', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const docId = c.req.param('id')

  const docRef = adminDb.doc(`workspaces/${workspaceId}/agents/${agentId}/knowledge/${docId}`)
  const snap = await docRef.get()
  if (!snap.exists) return c.json({ error: 'Not found' }, 404)

  const data = snap.data() as {
    type: 'webpage' | 'file'
    source: string
    storagePath?: string
    autoSyncEnabled?: boolean
  }

  if (data.type === 'file' && !data.storagePath) {
    return c.json({ error: 'This file cannot be re-indexed (no stored file).' }, 409)
  }

  await docRef.update({
    status: 'pending',
    chunkCount: 0,
    errorMessage: null,
    indexedAt: null,
    ...(data.type === 'webpage' && data.autoSyncEnabled
      ? { syncStartedAt: new Date(), nextSyncAt: knowledgeSyncLeaseUntil(new Date()), syncError: null }
      : {}),
  })

  try {
    await triggerIngestion(
      data.type === 'file'
        ? { workspaceId, docId, docType: 'file', storagePath: data.storagePath, agentId, namespace: c.get('agentNamespace')! }
        : { workspaceId, docId, docType: 'webpage', url: data.source, agentId, namespace: c.get('agentNamespace')! },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await docRef.update({ status: 'error', errorMessage: message, syncStartedAt: null }).catch(() => {})
    return c.json({ error: 'Could not start indexing. Please try again.' }, 502)
  }

  return c.json({ ok: true, status: 'pending' })
})

/** PATCH /knowledge/:id/sync — configure automatic refresh for a webpage source. */
knowledge.patch('/:id/sync', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const docId = c.req.param('id')
  const body = await c.req.json<{ intervalHours?: unknown }>().catch(() => null)

  if (!body || (body.intervalHours !== null && !isKnowledgeSyncInterval(body.intervalHours))) {
    return c.json({ error: 'intervalHours must be null, 24, 168, or 720' }, 400)
  }

  const docRef = adminDb.doc(`workspaces/${workspaceId}/agents/${agentId}/knowledge/${docId}`)
  const snap = await docRef.get()
  if (!snap.exists) return c.json({ error: 'Not found' }, 404)
  if (snap.data()?.type !== 'webpage') {
    return c.json({ error: 'Automatic syncing is only available for webpage sources.' }, 409)
  }

  const interval = body.intervalHours
  const now = new Date()
  await docRef.update(interval === null
    ? {
        autoSyncEnabled: false,
        syncIntervalHours: null,
        nextSyncAt: null,
        syncStartedAt: null,
        syncFailures: 0,
        syncError: null,
      }
    : {
        autoSyncEnabled: true,
        syncIntervalHours: interval,
        nextSyncAt: nextKnowledgeSyncAt(now, interval),
        syncStartedAt: null,
        syncFailures: 0,
        syncError: null,
      })

  return c.json({
    ok: true,
    autoSyncEnabled: interval !== null,
    syncIntervalHours: interval,
    nextSyncAt: interval === null ? null : nextKnowledgeSyncAt(now, interval),
  })
})

/** GET /knowledge — list all knowledge docs for the workspace */
knowledge.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/agents/${agentId}/knowledge`)
    .orderBy('createdAt', 'desc')
    .get()

  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  return c.json(docs)
})

/** DELETE /knowledge/:id — remove a knowledge doc and its vectors */
knowledge.delete('/:id', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const docId = c.req.param('id')

  const docRef = adminDb.doc(`workspaces/${workspaceId}/agents/${agentId}/knowledge/${docId}`)
  const snap = await docRef.get()
  if (!snap.exists) return c.json({ error: 'Not found' }, 404)

  // Delete Pinecone vectors (best-effort — don't block on failure)
  try {
    await deleteDocumentVectors(namespaceFor(c.get('agentNamespace')!), docId)
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
