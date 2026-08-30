import { Hono } from 'hono'
import { FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { adminDb, adminBucket } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { namespaceFor } from '../lib/pinecone'
import { agentNamespace, agentDeleteGuard } from '../lib/agents/agent-helpers'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import { gatewayKeyStatus, parseGatewayKeyBody, testGatewayKey } from '../lib/llm/gateway-key'
import { loadGatewayModelCatalog, recommendedGatewayModels, validateGatewayModelSelection } from '../lib/llm/model-catalog'
import { customEndpointStatus, parseCustomEndpointBody, testCustomEndpoint } from '../lib/llm/custom-endpoint'
import { buildAgentReadiness } from '../lib/agent-readiness'
import { agentCoreSnapshot, changedCoreFields, isAgentCoreSnapshot, type AgentCoreSnapshot } from '../lib/agents/version-history'
import { parseDuplicateAgentInput, remapWorkflowAgentReferences } from '../lib/agents/duplicate'
import { agentRole, agentTemplate, isAgentRoleId, isAgentTemplateId, DEFAULT_AGENT_ROLE_ID, validateAgentImage, MAX_AGENT_IMAGE_BYTES, canEditAgent, type AgentDoc, type AgentAccessEntry, type GatewayModelCatalog, type WorkspaceRole } from '@ayooda/shared'

const agents = new Hono<{ Variables: AuthVariables }>()
agents.use('*', requireAuth)

/**
 * Configuring an agent is open to owners and to members granted access to that
 * agent. Creating, deleting and re-defaulting one stays owner-only: those are
 * decisions about the workspace's shape, not about a single agent.
 *
 * These routes use :id rather than :agentId, so they cannot reuse the
 * requireAgent middleware and load the agent themselves.
 */
const editableAgent = async (
  c: { get: (k: 'workspaceId' | 'role' | 'uid') => string | undefined; req: { param: (k: string) => string } },
): Promise<{ ok: true; ref: FirebaseFirestore.DocumentReference; data: DocumentData } | { ok: false; status: 403 | 404 }> => {
  const ws = c.get('workspaceId')!
  const ref = adminDb.doc(`workspaces/${ws}/agents/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, status: 404 }
  const data = snap.data()!
  if (!canEditAgent(c.get('role') as WorkspaceRole, data.editorUids as string[] | undefined, c.get('uid'))) {
    return { ok: false, status: 403 }
  }
  return { ok: true, ref, data }
}

const denied = (status: 403 | 404) =>
  status === 404
    ? ({ error: 'Agent not found' } as const)
    : ({ error: 'You do not have access to this agent' } as const)

const DEFAULT_PROMPT = 'You are a helpful customer support agent. Answer questions based on the provided context.'
const DEFAULT_MODEL = 'google/gemini-2.5-flash'
const AGENT_VERSION_LIMIT = 20

async function versionActor(uid: string): Promise<string> {
  const snap = await adminDb.doc(`users/${uid}`).get()
  const data = snap.data()
  return String(data?.displayName || data?.email || 'Teammate')
}

async function trimAgentVersions(ref: FirebaseFirestore.DocumentReference) {
  const snap = await ref.collection('coreVersions').orderBy('createdAt', 'desc').limit(AGENT_VERSION_LIMIT + 10).get()
  const expired = snap.docs.slice(AGENT_VERSION_LIMIT)
  if (!expired.length) return
  const batch = adminDb.batch()
  expired.forEach((doc) => batch.delete(doc.ref))
  await batch.commit()
}

function toAgentDoc(id: string, d: DocumentData): AgentDoc {
  return {
    id,
    name: d.name,
    photoURL: d.photoURL ?? null,
    role: d.role ?? null,
    description: d.description ?? '',
    systemPrompt: d.systemPrompt ?? '',
    llmModel: d.llmModel ?? DEFAULT_MODEL,
    isDefault: d.isDefault === true,
  }
}

/** GET /agents — list (default first, then newest). */
agents.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const uid = c.get('uid')
  const role = c.get('role')
  const snap = await adminDb.collection(`workspaces/${ws}/agents`).get()
  const list = snap.docs
    .filter((d) => canEditAgent(role, d.data().editorUids as string[] | undefined, uid))
    .map((d) => toAgentDoc(d.id, d.data()))
  list.sort((a, b) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1))
  return c.json({ agents: list })
})

/** POST /agents — create a non-default agent with a fresh namespace. */
agents.post('/', requireOwner, async (c) => {
  const ws = c.get('workspaceId')
  const uid = c.get('uid')
  const body = await c.req.json<{ name?: string; description?: string; systemPrompt?: string; llmModel?: string; role?: string; templateId?: string }>().catch(() => ({} as { name?: string; description?: string; systemPrompt?: string; llmModel?: string; role?: string; templateId?: string }))
  const name = body.name?.trim()
  if (!name || name.length > 80) return c.json({ error: 'name is required (max 80 chars)' }, 400)
  if (body.llmModel !== undefined) {
    const model = await validateGatewayModelSelection(body.llmModel)
    if (!model.ok) return c.json({ error: model.error }, model.reason === 'invalid' ? 400 : 503)
  }
  if (body.role !== undefined && !isAgentRoleId(body.role)) return c.json({ error: 'Invalid role' }, 400)
  if (body.templateId !== undefined && !isAgentTemplateId(body.templateId)) return c.json({ error: 'Invalid agent template' }, 400)
  const template = body.templateId ? agentTemplate(body.templateId) : undefined

  // The role's only job: seed the starting prompt so a freshly created agent is
  // already useful. An explicit systemPrompt in the body always wins.
  const role = body.role ?? template?.role ?? DEFAULT_AGENT_ROLE_ID
  const seededPrompt = agentRole(role)?.systemPrompt ?? DEFAULT_PROMPT

  const ref = adminDb.collection(`workspaces/${ws}/agents`).doc()
  const now = new Date()
  const doc = {
    name,
    photoURL: null,
    role,
    description: body.description?.trim() || template?.suggestedDescription || '',
    systemPrompt: body.systemPrompt?.trim() || template?.systemPrompt || seededPrompt,
    llmModel: body.llmModel ?? DEFAULT_MODEL,
    knowledgeNamespace: agentNamespace(ws, ref.id),
    isDefault: false,
    // Seeded so the Usage tab can distinguish "nothing yet" from "not tracked":
    // trackedSince marks when these counters started, since they only accrue
    // forward. Conversation counts are derived from the conversations
    // collection instead, so those stay accurate for the agent's whole life.
    usage: { messageCount: 0, tokenCount: 0, trackedSince: now },
    createdAt: now,
    updatedAt: now,
    ...(template ? { templateId: template.id } : {}),
  }
  if (!template) {
    await ref.set(doc)
  } else {
    const batch = adminDb.batch()
    batch.set(ref, doc)
    template.skills.forEach((skill) => {
      batch.set(ref.collection('skills').doc(skill.id), {
        enabled: true,
        config: skill.config,
        createdAt: now,
        updatedAt: now,
      })
    })
    template.rules.forEach((rule, order) => {
      batch.set(ref.collection('workflowRules').doc(`template-${rule.id}`), {
        name: rule.name,
        enabled: true,
        order,
        trigger: rule.trigger,
        action: rule.action,
        createdAt: now,
        updatedAt: now,
      })
    })
    template.tests.forEach((testCase) => {
      batch.set(ref.collection('evaluationCases').doc(`template-${testCase.id}`), {
        name: testCase.name,
        prompt: testCase.prompt,
        expectedIncludes: testCase.expectedIncludes,
        forbiddenIncludes: testCase.forbiddenIncludes,
        expectedOutcome: testCase.expectedOutcome,
        enabled: true,
        createdBy: uid,
        createdAt: now,
        updatedAt: now,
      })
    })
    await batch.commit()
  }
  return c.json(toAgentDoc(ref.id, doc))
})

/** POST /agents/:id/duplicate — create a reusable copy without customer data or deployment state. */
agents.post('/:id/duplicate', requireOwner, async (c) => {
  const workspaceId = c.get('workspaceId')!
  const uid = c.get('uid')!
  const sourceRef = adminDb.doc(`workspaces/${workspaceId}/agents/${c.req.param('id')}`)
  const sourceSnap = await sourceRef.get()
  if (!sourceSnap.exists) return c.json({ error: 'Agent not found' }, 404)
  const source = sourceSnap.data()!
  const parsed = parseDuplicateAgentInput(await c.req.json().catch(() => null), String(source.name ?? 'Agent'))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const collections = [
    ...(parsed.value.copyTools ? ['tools'] : []),
    ...(parsed.value.copySkills ? ['skills'] : []),
    ...(parsed.value.copyWorkflows ? ['workflowRules', 'workflowGraph'] : []),
    ...(parsed.value.copyTests ? ['evaluationCases'] : []),
  ]
  const snapshots = await Promise.all(collections.map(async (name) => ({ name, snap: await sourceRef.collection(name).get() })))
  const targetRef = adminDb.collection(`workspaces/${workspaceId}/agents`).doc()
  const now = new Date()
  const copied: Record<string, number> = {}

  try {
    let batch = adminDb.batch()
    let operations = 0
    for (const { name, snap } of snapshots) {
      copied[name] = snap.size
      for (const sourceDoc of snap.docs) {
        const data = name === 'workflowRules' || name === 'workflowGraph'
          ? remapWorkflowAgentReferences(sourceDoc.data(), sourceSnap.id, targetRef.id)
          : { ...sourceDoc.data() }
        delete data.createdAt
        delete data.updatedAt
        batch.set(targetRef.collection(name).doc(sourceDoc.id), {
          ...data,
          createdAt: now,
          updatedAt: now,
          ...(name === 'evaluationCases' ? { createdBy: uid } : {}),
        })
        operations += 1
        if (operations === 450) {
          await batch.commit()
          batch = adminDb.batch()
          operations = 0
        }
      }
    }
    if (operations) await batch.commit()

    const target = {
      name: parsed.value.name,
      photoURL: null,
      role: source.role ?? null,
      description: String(source.description ?? ''),
      systemPrompt: String(source.systemPrompt ?? DEFAULT_PROMPT),
      llmModel: String(source.llmModel ?? DEFAULT_MODEL),
      knowledgeNamespace: agentNamespace(workspaceId, targetRef.id),
      isDefault: false,
      usage: { messageCount: 0, tokenCount: 0, trackedSince: now },
      clonedFromAgentId: sourceSnap.id,
      createdAt: now,
      updatedAt: now,
    }
    // Write the parent last: partially copied subcollections never become a
    // visible agent if a batch fails halfway through.
    await targetRef.set(target)
    return c.json({ agent: toAgentDoc(targetRef.id, target), copied }, 201)
  } catch (error) {
    await adminDb.recursiveDelete(targetRef).catch(() => {})
    console.error('[agents] duplicate failed:', error)
    return c.json({ error: 'Could not duplicate this agent. No copy was kept.' }, 500)
  }
})

/** GET /agents/:id/models — live language-model catalog, with stable defaults on outage. */
agents.get('/:id/models', async (c) => {
  const gate = await editableAgent(c)
  if (!gate.ok) return c.json(denied(gate.status), gate.status)
  try {
    return c.json(await loadGatewayModelCatalog())
  } catch (err) {
    console.warn('[agents] Gateway model catalog unavailable:', err)
    const fallback: GatewayModelCatalog = {
      models: recommendedGatewayModels(),
      dynamic: false,
      fetchedAt: null,
      warning: 'Live model catalog is unavailable. Recommended models remain selectable.',
    }
    return c.json(fallback)
  }
})

/** GET /agents/:id/versions — recent restorable core-configuration snapshots. */
agents.get('/:id/versions', async (c) => {
  const gate = await editableAgent(c)
  if (!gate.ok) return c.json(denied(gate.status), gate.status)
  const snap = await gate.ref.collection('coreVersions').orderBy('createdAt', 'desc').limit(AGENT_VERSION_LIMIT).get()
  return c.json({
    versions: snap.docs.flatMap((doc) => {
      const data = doc.data()
      if (!isAgentCoreSnapshot(data.snapshot)) return []
      return [{
        id: doc.id,
        snapshot: data.snapshot,
        changedFields: Array.isArray(data.changedFields) ? data.changedFields : [],
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
        createdByName: typeof data.createdByName === 'string' ? data.createdByName : 'Teammate',
        reason: data.reason === 'restore' ? 'restore' : 'save',
      }]
    }),
  })
})

/** POST /agents/:id/versions/:versionId/restore — restore core settings and preserve an undo snapshot. */
agents.post('/:id/versions/:versionId/restore', async (c) => {
  const gate = await editableAgent(c)
  if (!gate.ok) return c.json(denied(gate.status), gate.status)
  const versionRef = gate.ref.collection('coreVersions').doc(c.req.param('versionId'))
  const versionSnap = await versionRef.get()
  if (!versionSnap.exists) return c.json({ error: 'Configuration version not found' }, 404)
  const restore = versionSnap.data()!.snapshot
  if (!isAgentCoreSnapshot(restore)) return c.json({ error: 'This configuration version cannot be restored' }, 409)
  if (restore.role !== null && !isAgentRoleId(restore.role)) return c.json({ error: 'This version uses an unavailable agent role' }, 409)
  const model = await validateGatewayModelSelection(restore.llmModel)
  if (!model.ok) return c.json({ error: 'This version uses a model that is no longer available. Choose a current model instead.' }, 409)

  const uid = c.get('uid')!
  const actor = await versionActor(uid)
  await adminDb.runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(gate.ref)
    if (!currentSnap.exists) throw new Error('Agent not found')
    const current = agentCoreSnapshot(currentSnap.data()!)
    const changedFields = changedCoreFields(current, restore)
    if (!changedFields.length) return
    transaction.set(gate.ref.collection('coreVersions').doc(), {
      snapshot: current,
      changedFields,
      createdAt: new Date(),
      createdBy: uid,
      createdByName: actor,
      reason: 'restore',
      restoredFromVersionId: versionSnap.id,
    })
    transaction.update(gate.ref, { ...restore, updatedAt: new Date() })
  })
  await trimAgentVersions(gate.ref).catch((error) => console.warn('[agents] version cleanup failed:', error))
  const after = await gate.ref.get()
  return c.json(toAgentDoc(after.id, after.data()!))
})

/** GET /agents/:id/readiness — actionable launch checks derived from current configuration. */
agents.get('/:id/readiness', async (c) => {
  const gate = await editableAgent(c)
  if (!gate.ok) return c.json(denied(gate.status), gate.status)
  const workspaceId = c.get('workspaceId')
  const agentId = c.req.param('id')
  const [knowledgeSnap, runSnap, channelSnap, graphSnap, ruleSnap] = await Promise.all([
    gate.ref.collection('knowledge').get(),
    gate.ref.collection('evaluationRuns').orderBy('createdAt', 'desc').limit(1).get(),
    adminDb.collection(`workspaces/${workspaceId}/channels`).where('agentId', '==', agentId).get(),
    gate.ref.collection('workflowGraph').doc('main').get(),
    gate.ref.collection('workflowRules').where('enabled', '==', true).get(),
  ])
  const knowledgeRows = knowledgeSnap.docs.map((doc) => doc.data())
  const staleCutoff = Date.now() - 30 * 86_400_000
  const knowledgeIssue = (row: DocumentData) => {
    const indexedAt = typeof row.indexedAt?.toDate === 'function' ? row.indexedAt.toDate() as Date : null
    const stale = row.type === 'webpage' && row.status === 'indexed' && row.autoSyncEnabled !== true
      && (!indexedAt || indexedAt.getTime() < staleCutoff)
    return row.status === 'error' || row.syncError || (row.status === 'indexed' && Number(row.chunkCount) <= 0) || stale
  }
  const knowledgeReady = knowledgeRows.filter((row) => row.status === 'indexed' && Number(row.chunkCount) > 0 && !knowledgeIssue(row)).length
  const knowledgeIssues = knowledgeRows.filter(knowledgeIssue).length
  const latestRun = runSnap.docs[0]?.data()
  const channels = channelSnap.docs.map((doc) => doc.data())
  const widget = channels.find((channel) => channel.type === 'web_widget')
  const liveChannels = channels.filter((channel) => channel.isActive !== false && (channel.type !== 'web_widget' || channel.lastSeenAt)).length
  const graphHasHandoff = graphSnap.exists && Array.isArray(graphSnap.data()?.nodes)
    && graphSnap.data()!.nodes.some((node: { kind?: string; action?: { type?: string } }) => node.kind === 'action' && ['escalate', 'assign_teammate'].includes(node.action?.type ?? ''))
  const ruleHasHandoff = ruleSnap.docs.some((doc) => ['escalate', 'assign_teammate'].includes(doc.data().action?.type))
  const custom = gate.data.customEndpoint as { baseURL?: unknown; modelId?: unknown } | undefined
  const runtimeConfigured = Boolean(
    (typeof custom?.baseURL === 'string' && typeof custom.modelId === 'string')
    || gate.data.gatewayKey
    || process.env.AI_GATEWAY_API_KEY,
  )
  return c.json(buildAgentReadiness({
    agentId,
    name: String(gate.data.name ?? ''),
    systemPrompt: String(gate.data.systemPrompt ?? ''),
    llmModel: String(gate.data.llmModel ?? ''),
    runtimeConfigured,
    knowledgeReady,
    knowledgeTotal: knowledgeRows.length,
    knowledgeIssues,
    evaluationPassed: Number(latestRun?.passed ?? 0),
    evaluationTotal: Number(latestRun?.total ?? 0),
    liveChannels,
    configuredChannels: channels.length,
    widgetConfigured: Boolean(widget),
    widgetInstalled: Boolean(widget?.lastSeenAt),
    widgetDomains: Array.isArray(widget?.config?.allowedDomains) ? widget.config.allowedDomains.length : 0,
    handoffConfigured: Boolean(graphHasHandoff || ruleHasHandoff),
  }))
})

/** GET /agents/:id */
agents.get('/:id', async (c) => {
  const gate = await editableAgent(c)
  if (!gate.ok) return c.json(denied(gate.status), gate.status)
  const snap = await gate.ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  return c.json(toAgentDoc(snap.id, snap.data()!))
})

/** PUT /agents/:id — update identity/prompt/model. */
agents.put('/:id', async (c) => {
  const gate = await editableAgent(c)
  if (!gate.ok) return c.json(denied(gate.status), gate.status)
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = gate.ref
  const body = await c.req.json<{ name?: string; photoURL?: string | null; description?: string; systemPrompt?: string; llmModel?: string; role?: string }>().catch(() => ({} as { name?: string; photoURL?: string | null; description?: string; systemPrompt?: string; llmModel?: string; role?: string }))
  if (body.llmModel !== undefined && body.llmModel !== gate.data.llmModel) {
    const model = await validateGatewayModelSelection(body.llmModel)
    if (!model.ok) return c.json({ error: model.error }, model.reason === 'invalid' ? 400 : 503)
  }
  if (body.role !== undefined && !isAgentRoleId(body.role)) return c.json({ error: 'Invalid role' }, 400)

  const update: Record<string, unknown> = { updatedAt: new Date() }
  // Changing the role later relabels the agent; it deliberately does not rewrite
  // a systemPrompt the owner may have customised.
  if (body.role !== undefined) update.role = body.role
  if (body.name !== undefined) { const n = body.name.trim(); if (!n || n.length > 80) return c.json({ error: 'name is required (max 80 chars)' }, 400); update.name = n }
  if (body.photoURL !== undefined) update.photoURL = body.photoURL
  if (body.description !== undefined) update.description = body.description
  if (body.systemPrompt !== undefined) update.systemPrompt = body.systemPrompt
  if (body.llmModel !== undefined) update.llmModel = body.llmModel

  const uid = c.get('uid')!
  const actor = await versionActor(uid)
  await adminDb.runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(ref)
    if (!currentSnap.exists) throw new Error('Agent not found')
    const current = agentCoreSnapshot(currentSnap.data()!)
    const next: AgentCoreSnapshot = {
      ...current,
      ...(typeof update.name === 'string' ? { name: update.name } : {}),
      ...(typeof update.description === 'string' ? { description: update.description } : {}),
      ...(typeof update.systemPrompt === 'string' ? { systemPrompt: update.systemPrompt } : {}),
      ...(typeof update.llmModel === 'string' ? { llmModel: update.llmModel } : {}),
      ...(typeof update.role === 'string' ? { role: update.role } : {}),
    }
    const changedFields = changedCoreFields(current, next)
    if (changedFields.length) transaction.set(ref.collection('coreVersions').doc(), {
      snapshot: current,
      changedFields,
      createdAt: new Date(),
      createdBy: uid,
      createdByName: actor,
      reason: 'save',
    })
    transaction.update(ref, update)
  })
  await trimAgentVersions(ref).catch((cleanupError) => console.warn('[agents] version cleanup failed:', cleanupError))
  const after = await ref.get()
  return c.json(toAgentDoc(after.id, after.data()!))
})

/** POST /agents/:id/default — make this the workspace default. */
agents.post('/:id/default', requireOwner, async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const col = adminDb.collection(`workspaces/${ws}/agents`)
  const target = await col.doc(id).get()
  if (!target.exists) return c.json({ error: 'Agent not found' }, 404)
  const all = await col.where('isDefault', '==', true).get()
  const batch = adminDb.batch()
  all.docs.forEach((d) => { if (d.id !== id) batch.update(d.ref, { isDefault: false }) })
  batch.update(col.doc(id), { isDefault: true, updatedAt: new Date() })
  await batch.commit()
  return c.json({ ok: true })
})

/** DELETE /agents/:id — guarded; purges namespace, knowledge (+ files), tools. */
agents.delete('/:id', requireOwner, async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${id}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  const data = snap.data()!

  const [countSnap, channelsSnap] = await Promise.all([
    adminDb.collection(`workspaces/${ws}/agents`).count().get(),
    adminDb.collection(`workspaces/${ws}/channels`).where('agentId', '==', id).get(),
  ])
  const attachedChannels = channelsSnap.docs.map((d) => {
    const ch = d.data()
    return ch.type === 'telegram' ? 'Telegram' : ch.type === 'web_widget' ? 'Website' : ch.type === 'email' ? 'Email' : ch.type === 'slack' ? 'Slack' : ch.type === 'sms' ? 'SMS' : (ch.type ?? d.id)
  })
  const guard = agentDeleteGuard({
    isDefault: data.isDefault === true,
    isLast: countSnap.data().count <= 1,
    attachedChannels,
  })
  if (!guard.ok) return c.json({ error: guard.error }, guard.status)

  // Purge vectors (best-effort)
  try { await namespaceFor(data.knowledgeNamespace ?? `ws_${ws}_ag_${id}`).deleteAll() } catch (err) { console.warn('[agents] namespace purge failed:', err) }

  // Delete knowledge docs + their storage files
  const knowledgeSnap = await adminDb.collection(`workspaces/${ws}/agents/${id}/knowledge`).get()
  for (const d of knowledgeSnap.docs) {
    const sp = d.data().storagePath as string | undefined
    if (sp) { try { await adminBucket().file(sp).delete() } catch (err) { console.warn('[agents] storage delete failed:', err) } }
    await d.ref.delete()
  }

  // Delete the agent's own subcollections. Channels are not among them: the
  // guard above refuses to delete an agent that still has one attached.
  for (const sub of ['tools', 'skills', 'workflowRules', 'workflowGraph', 'coreVersions']) {
    const subSnap = await adminDb.collection(`workspaces/${ws}/agents/${id}/${sub}`).get()
    for (const d of subSnap.docs) await d.ref.delete()
  }

  await ref.delete()
  return c.json({ ok: true })
})

/**
 * POST /agents/:id/photo — upload the agent's logo (multipart, field "file").
 *
 * The object is made publicly readable because the chat widget renders it with a
 * plain <img src> on the customer's own site, where no credentials exist. Only
 * this one object is exposed, not the bucket.
 */
agents.post('/:id/photo', async (c) => {
  const gate = await editableAgent(c)
  if (!gate.ok) return c.json(denied(gate.status), gate.status)
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = gate.ref
  const snap = await ref.get()

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return c.json({ error: 'file is required (multipart form-data)' }, 400)

  const validation = validateAgentImage(file.name, file.size)
  if (!validation.ok) {
    return c.json({ error: validation.error }, file.size > MAX_AGENT_IMAGE_BYTES ? 413 : 400)
  }

  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  // Cache-bust on replacement: a fixed key would keep serving the old image from
  // CDN/browser caches long after the owner changed it.
  const storagePath = `workspaces/${ws}/agents/${id}/logo-${Date.now()}${ext}`
  const object = adminBucket().file(storagePath)

  await object.save(Buffer.from(await file.arrayBuffer()), {
    contentType: file.type || 'image/png',
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  })

  try {
    await object.makePublic()
  } catch (err) {
    await object.delete().catch(() => {})
    console.error('[agents] makePublic failed for agent logo:', err)
    return c.json({ error: 'Could not publish the image. Check bucket public-access settings.' }, 500)
  }

  const photoURL = `https://storage.googleapis.com/${adminBucket().name}/${storagePath}`
  const previousPath = snap.data()!.photoStoragePath as string | undefined
  await ref.update({ photoURL, photoStoragePath: storagePath, updatedAt: new Date() })

  // Best-effort cleanup of the object we just replaced.
  if (previousPath && previousPath !== storagePath) {
    await adminBucket().file(previousPath).delete().catch(() => {})
  }

  return c.json({ photoURL })
})

/** DELETE /agents/:id/photo — clear the logo and remove the stored object. */
agents.delete('/:id/photo', async (c) => {
  const gate = await editableAgent(c)
  if (!gate.ok) return c.json(denied(gate.status), gate.status)
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = gate.ref
  const snap = await ref.get()

  const path = snap.data()!.photoStoragePath as string | undefined
  if (path) await adminBucket().file(path).delete().catch(() => {})
  await ref.update({ photoURL: null, photoStoragePath: FieldValue.delete(), updatedAt: new Date() })
  return c.json({ ok: true })
})

/** GET /agents/:id/gateway-key — masked credential status; owner-only because it controls spend. */
agents.get('/:id/gateway-key', requireOwner, async (c) => {
  const ref = adminDb.doc(`workspaces/${c.get('workspaceId')}/agents/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  return c.json(gatewayKeyStatus(snap.data()!.gatewayKey))
})

/** PUT /agents/:id/gateway-key — verify, encrypt, and store a write-only AI Gateway key. */
agents.put('/:id/gateway-key', requireOwner, async (c) => {
  const ref = adminDb.doc(`workspaces/${c.get('workspaceId')}/agents/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)

  const parsed = parseGatewayKeyBody(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const verified = await testGatewayKey(parsed.apiKey)
  if (!verified.ok) {
    return c.json({ error: verified.error }, verified.reason === 'invalid' ? 400 : 502)
  }

  await ref.update({ gatewayKey: encryptSecret(parsed.apiKey), updatedAt: new Date() })
  return c.json(gatewayKeyStatus('configured'))
})

/** DELETE /agents/:id/gateway-key — remove the override and return to platform fallback. */
agents.delete('/:id/gateway-key', requireOwner, async (c) => {
  const ref = adminDb.doc(`workspaces/${c.get('workspaceId')}/agents/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)

  await ref.update({ gatewayKey: FieldValue.delete(), updatedAt: new Date() })
  return c.json(gatewayKeyStatus(undefined))
})

/** GET /agents/:id/custom-endpoint — masked endpoint configuration; the key is never returned. */
agents.get('/:id/custom-endpoint', requireOwner, async (c) => {
  const ref = adminDb.doc(`workspaces/${c.get('workspaceId')}/agents/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  return c.json(customEndpointStatus(snap.data()!.customEndpoint))
})

/** PUT /agents/:id/custom-endpoint — verify model discovery, encrypt the key, and activate the endpoint. */
agents.put('/:id/custom-endpoint', requireOwner, async (c) => {
  const ref = adminDb.doc(`workspaces/${c.get('workspaceId')}/agents/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  const parsed = parseCustomEndpointBody(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const existing = snap.data()!.customEndpoint as { baseURL?: string; apiKeyEnc?: string } | undefined
  let apiKey: string | undefined
  let apiKeyEnc: string | undefined
  try {
    if (typeof parsed.value.apiKey === 'string') {
      apiKey = parsed.value.apiKey
      apiKeyEnc = encryptSecret(apiKey)
    } else if (parsed.value.apiKey === undefined && existing?.apiKeyEnc && existing.baseURL === parsed.value.baseURL) {
      apiKey = decryptSecret(existing.apiKeyEnc)
      apiKeyEnc = existing.apiKeyEnc
    } else if (parsed.value.apiKey === undefined) {
      return c.json({ error: 'Enter an API key, or explicitly choose a keyless endpoint.' }, 400)
    }
  } catch {
    return c.json({ error: 'The saved endpoint key could not be read. Enter a replacement key.' }, 400)
  }

  const verified = await testCustomEndpoint({
    baseURL: parsed.value.baseURL,
    modelId: parsed.value.modelId,
    ...(apiKey ? { apiKey } : {}),
  })
  if (!verified.ok) return c.json({ error: verified.error }, verified.reason === 'invalid' ? 400 : 502)

  await ref.update({
    customEndpoint: {
      baseURL: parsed.value.baseURL,
      modelId: parsed.value.modelId,
      ...(apiKeyEnc ? { apiKeyEnc } : {}),
    },
    updatedAt: new Date(),
  })
  return c.json(customEndpointStatus({ baseURL: parsed.value.baseURL, modelId: parsed.value.modelId, ...(apiKeyEnc ? { apiKeyEnc } : {}) }))
})

/** DELETE /agents/:id/custom-endpoint — return this agent to its Gateway model and key. */
agents.delete('/:id/custom-endpoint', requireOwner, async (c) => {
  const ref = adminDb.doc(`workspaces/${c.get('workspaceId')}/agents/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  await ref.update({ customEndpoint: FieldValue.delete(), updatedAt: new Date() })
  return c.json(customEndpointStatus(undefined))
})

/**
 * GET /agents/:id/access — the workspace's people and who may configure this
 * agent. Owner-only: deciding who can configure an agent is an owner's call.
 * Owners are listed as always-having-access and cannot be toggled off.
 */
agents.get('/:id/access', requireOwner, async (c) => {
  const ws = c.get('workspaceId')
  const snap = await adminDb.doc(`workspaces/${ws}/agents/${c.req.param('id')}`).get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  const editors: string[] = (snap.data()!.editorUids as string[] | undefined) ?? []

  const usersSnap = await adminDb.collection('users').where('workspaceId', '==', ws).get()
  const people: AgentAccessEntry[] = usersSnap.docs.map((d) => {
    const u = d.data()
    const role = ((u.role as WorkspaceRole) ?? 'owner')
    const isOwner = role === 'owner'
    return {
      uid: d.id,
      email: (u.email as string) ?? '',
      displayName: (u.displayName as string) ?? '',
      role,
      hasAccess: isOwner || editors.includes(d.id),
      locked: isOwner,
    }
  })
  people.sort((a, b) => (a.locked === b.locked ? a.displayName.localeCompare(b.displayName) : a.locked ? -1 : 1))
  return c.json({ people })
})

/** PUT /agents/:id/access/:uid — grant a member access to this agent. */
agents.put('/:id/access/:uid', requireOwner, async (c) => {
  const ws = c.get('workspaceId')
  const uid = c.req.param('uid')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${c.req.param('id')}`)
  if (!(await ref.get()).exists) return c.json({ error: 'Agent not found' }, 404)

  // Only someone already in this workspace — never an arbitrary uid.
  const userSnap = await adminDb.doc(`users/${uid}`).get()
  if (!userSnap.exists || userSnap.data()!.workspaceId !== ws) {
    return c.json({ error: 'That person is not in this workspace' }, 404)
  }

  await ref.update({ editorUids: FieldValue.arrayUnion(uid), updatedAt: new Date() })
  return c.json({ ok: true })
})

/** DELETE /agents/:id/access/:uid — revoke it. Idempotent. */
agents.delete('/:id/access/:uid', requireOwner, async (c) => {
  const ws = c.get('workspaceId')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${c.req.param('id')}`)
  if (!(await ref.get()).exists) return c.json({ error: 'Agent not found' }, 404)
  await ref.update({ editorUids: FieldValue.arrayRemove(c.req.param('uid')), updatedAt: new Date() })
  return c.json({ ok: true })
})

export default agents
