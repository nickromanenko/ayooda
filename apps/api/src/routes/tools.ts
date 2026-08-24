import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { encryptSecret } from '../lib/crypto'
import { validateToolInput, type ValidatedTool } from '../lib/tools/validate'
import { planToolBundleInstall, prepareToolBundle, toolBundleDocumentId } from '../lib/tools/bundles'
import { buildOAuthAuthorizeUrl, isOAuthConnectorId, oauthAvailable } from '../lib/tools/connectors'
import { resolveConnectorAccessTokenEnc } from '../lib/tools/credential'
import { executeTool, type StoredTool } from '../lib/chat/tools'
import { TOOL_BUNDLES, templatesForToolBundle, type ConnectorStatus, type ToolDef } from '@ayooda/shared'

const tools = new Hono<{ Variables: AuthVariables }>()
tools.use('*', requireAuth)
tools.use('*', requireAgent)

function toToolDef(id: string, d: DocumentData): ToolDef {
  return {
    id,
    ...(d.bundleId ? { bundleId: d.bundleId } : {}),
    ...(d.templateId ? { templateId: d.templateId } : {}),
    name: d.name,
    description: d.description,
    method: d.method,
    urlTemplate: d.urlTemplate,
    params: d.params ?? [],
    headers: d.headers ?? [],
    ...(d.bodyTemplate ? { bodyTemplate: d.bodyTemplate, bodyEncoding: d.bodyEncoding ?? 'json' } : {}),
    auth: {
      type: d.auth?.type ?? 'none',
      ...(d.auth?.headerName ? { headerName: d.auth.headerName } : {}),
      ...(d.auth?.credentialId ? { credentialId: d.auth.credentialId } : {}),
    },
    hasSecret: !!d.auth?.secretEnc || !!d.auth?.credentialId,
    kind: d.kind,
    writeEnabled: !!d.writeEnabled,
    enabled: d.enabled !== false,
  }
}

function toolDocument(v: ValidatedTool, metadata: Record<string, unknown> = {}, credentialId?: string): Record<string, unknown> {
  return {
    name: v.name, description: v.description, method: v.method, urlTemplate: v.urlTemplate,
    params: v.params, headers: v.headers,
    ...(v.bodyTemplate ? { bodyTemplate: v.bodyTemplate, bodyEncoding: v.bodyEncoding ?? 'json' } : {}),
    auth: buildAuth(v, credentialId),
    kind: v.kind, writeEnabled: v.writeEnabled, enabled: v.enabled,
    ...metadata,
    createdAt: new Date(), updatedAt: new Date(),
  }
}

function buildAuth(v: ValidatedTool, credentialId?: string): { type: string; headerName?: string; secretEnc?: string; credentialId?: string } {
  if (v.auth.type === 'none') return { type: 'none' }
  const out: { type: string; headerName?: string; secretEnc?: string; credentialId?: string } = { type: v.auth.type }
  if (v.auth.type === 'header' && v.auth.headerName) out.headerName = v.auth.headerName
  if (credentialId) out.credentialId = credentialId
  else if (v.secret) out.secretEnc = encryptSecret(v.secret)
  return out
}

function toStoredTool(id: string, d: DocumentData): StoredTool {
  return {
    id, name: d.name, description: d.description, method: d.method, urlTemplate: d.urlTemplate,
    params: d.params ?? [], headers: d.headers ?? [], auth: d.auth ?? { type: 'none' },
    ...(d.bodyTemplate ? { bodyTemplate: d.bodyTemplate, bodyEncoding: d.bodyEncoding ?? 'json' } : {}),
    kind: d.kind, writeEnabled: !!d.writeEnabled, enabled: d.enabled !== false,
  }
}

/** GET /tools — list this workspace's tools (never returns secrets). */
tools.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const snap = await adminDb.collection(`workspaces/${ws}/agents/${agentId}/tools`).get()
  return c.json({ tools: snap.docs.map((d) => toToolDef(d.id, d.data())) })
})

/** GET /tools/connectors — masked workspace credential and OAuth availability state. */
tools.get('/connectors', async (c) => {
  const ws = c.get('workspaceId')!
  const snap = await adminDb.collection(`workspaces/${ws}/connectorCredentials`).get()
  const byProvider = new Map(snap.docs.map((doc) => [doc.id, doc.data()]))
  const connectors: ConnectorStatus[] = TOOL_BUNDLES.map((bundle) => {
    const data = byProvider.get(bundle.id)
    const updatedAt = data?.updatedAt
    return {
      providerId: bundle.id,
      connected: !!data?.accessTokenEnc,
      authMode: data?.authMode === 'oauth' || data?.authMode === 'token' ? data.authMode : null,
      oauthAvailable: oauthAvailable(bundle.id),
      setup: data?.setup && typeof data.setup === 'object' ? data.setup as Record<string, string> : {},
      updatedAt: typeof updatedAt?.toDate === 'function' ? updatedAt.toDate().toISOString() : updatedAt instanceof Date ? updatedAt.toISOString() : null,
    }
  })
  return c.json({ connectors })
})

/** POST /tools/connectors/:provider/oauth/start — create one-time state and return the provider authorization URL. */
tools.post('/connectors/:provider/oauth/start', async (c) => {
  const providerId = c.req.param('provider')
  if (!isOAuthConnectorId(providerId) || !oauthAvailable(providerId)) {
    return c.json({ error: 'OAuth is not configured for this provider.' }, 400)
  }
  const body = await c.req.json().catch(() => null)
  const input = body && typeof body === 'object' ? body as { setup?: Record<string, string> } : {}
  const prepared = prepareToolBundle({ ...input, bundleId: providerId, credentialId: providerId })
  if (!prepared.ok) return c.json({ error: prepared.error }, 400)

  const state = randomBytes(32).toString('base64url')
  const states = adminDb.collection('connectorOAuthStates')
  const expired = await states.where('expiresAt', '<', new Date()).limit(25).get()
  const stateBatch = adminDb.batch()
  for (const doc of expired.docs) stateBatch.delete(doc.ref)
  stateBatch.set(states.doc(state), {
    providerId,
    workspaceId: c.get('workspaceId'),
    agentId: c.get('agentId'),
    uid: c.get('uid'),
    setup: input.setup ?? {},
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  })
  await stateBatch.commit()
  return c.json({ authorizeUrl: buildOAuthAuthorizeUrl(providerId, state, input.setup ?? {}) })
})

/** POST /tools — create a tool. */
tools.post('/', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const result = validateToolInput(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const v = result.value

  const dup = await adminDb.collection(`workspaces/${ws}/agents/${agentId}/tools`).where('name', '==', v.name).limit(1).get()
  if (!dup.empty) return c.json({ error: 'A tool with that name already exists.' }, 409)

  const doc = toolDocument(v)
  const ref = await adminDb.collection(`workspaces/${ws}/agents/${agentId}/tools`).add(doc)
  return c.json(toToolDef(ref.id, doc))
})

/** POST /tools/bundles — atomically install every missing action in a provider bundle. */
tools.post('/bundles', async (c) => {
  const ws = c.get('workspaceId')!
  const agentId = c.get('agentId')!
  const raw = await c.req.json().catch(() => null)
  const prepared = prepareToolBundle(raw)
  if (!prepared.ok) return c.json({ error: prepared.error }, 400)

  const credentialId = prepared.tools.some((tool) => tool.value.auth.type !== 'none') ? prepared.bundle.id : undefined
  const secret = prepared.tools.find((tool) => tool.value.secret)?.value.secret
  const credentialRef = credentialId ? adminDb.doc(`workspaces/${ws}/connectorCredentials/${credentialId}`) : null
  if (credentialRef && !secret) {
    const credential = await credentialRef.get()
    if (!credential.exists || credential.data()?.providerId !== prepared.bundle.id || !credential.data()?.accessTokenEnc) {
      return c.json({ error: 'Connect this provider or enter a credential before installing its actions.' }, 400)
    }
  }

  const col = adminDb.collection(`workspaces/${ws}/agents/${agentId}/tools`)
  const existing = await col.get()
  const plan = planToolBundleInstall(prepared.tools, existing.docs.map((doc) => ({ id: doc.id, name: String(doc.data().name ?? '') })))
  const batch = adminDb.batch()
  const installed: ToolDef[] = []
  let writes = 0

  if (credentialRef && secret) {
    const now = new Date()
    batch.set(credentialRef, {
      providerId: prepared.bundle.id,
      authMode: 'token',
      accessTokenEnc: encryptSecret(secret),
      refreshTokenEnc: FieldValue.delete(),
      expiresAt: FieldValue.delete(),
      scopes: FieldValue.delete(),
      setup: (raw as { setup?: Record<string, string> } | null)?.setup ?? {},
      createdBy: c.get('uid'),
      createdAt: now,
      updatedAt: now,
    }, { merge: true })
    writes++
  }

  if (credentialId) {
    const templates = templatesForToolBundle(prepared.bundle)
    for (const existingDoc of existing.docs) {
      const data = existingDoc.data()
      const template = templates.find((item) => item.id === data.templateId || item.toolName === data.name)
      if (!template || template.auth.type === 'none') continue
      const preparedTool = prepared.tools.find((item) => item.templateId === template.id)!
      batch.update(existingDoc.ref, {
        urlTemplate: preparedTool.value.urlTemplate,
        headers: preparedTool.value.headers,
        bodyTemplate: preparedTool.value.bodyTemplate ?? null,
        bodyEncoding: preparedTool.value.bodyTemplate ? (preparedTool.value.bodyEncoding ?? 'json') : null,
        auth: {
          type: template.auth.type,
          ...(template.auth.headerName ? { headerName: template.auth.headerName } : {}),
          credentialId,
        },
        updatedAt: new Date(),
      })
      writes++
    }
    const agents = await adminDb.collection(`workspaces/${ws}/agents`).get()
    for (const agent of agents.docs) {
      if (agent.id === agentId) continue
      const providerTools = await agent.ref.collection('tools').where('bundleId', '==', prepared.bundle.id).get()
      for (const providerTool of providerTools.docs) {
        const template = templates.find((item) => item.id === providerTool.data().templateId)
        const preparedTool = template ? prepared.tools.find((item) => item.templateId === template.id) : undefined
        if (!template || !preparedTool || template.auth.type === 'none') continue
        batch.update(providerTool.ref, {
          urlTemplate: preparedTool.value.urlTemplate,
          headers: preparedTool.value.headers,
          bodyTemplate: preparedTool.value.bodyTemplate ?? null,
          bodyEncoding: preparedTool.value.bodyTemplate ? (preparedTool.value.bodyEncoding ?? 'json') : null,
          auth: {
            type: template.auth.type,
            ...(template.auth.headerName ? { headerName: template.auth.headerName } : {}),
            credentialId,
          },
          updatedAt: new Date(),
        })
        writes++
      }
    }
  }

  for (const tool of plan.install) {
    const id = toolBundleDocumentId(tool.templateId)
    const doc = toolDocument(tool.value, { bundleId: prepared.bundle.id, templateId: tool.templateId }, credentialId)
    batch.set(col.doc(id), doc)
    writes++
    installed.push(toToolDef(id, doc))
  }

  if (writes) await batch.commit()
  return c.json({
    bundleId: prepared.bundle.id,
    status: installed.length ? 'installed' : 'already_installed',
    installed,
    skippedTemplateIds: plan.skippedTemplateIds,
  })
})

/** PUT /tools/:id — update a tool (keeps the existing secret if none supplied). */
tools.put('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const id = c.req.param('id')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${agentId}/tools/${id}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Tool not found' }, 404)

  const result = validateToolInput(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const v = result.value

  const dup = await adminDb.collection(`workspaces/${ws}/agents/${agentId}/tools`).where('name', '==', v.name).limit(1).get()
  if (!dup.empty && dup.docs[0]!.id !== id) return c.json({ error: 'A tool with that name already exists.' }, 409)

  const existing = snap.data()!
  let auth = buildAuth(v)
  // Keep the existing secret when the type still needs one and no new secret was supplied.
  if (v.auth.type !== 'none' && !v.secret && existing.auth?.secretEnc) {
    auth = { ...auth, secretEnc: existing.auth.secretEnc }
  }

  const doc = {
    name: v.name, description: v.description, method: v.method, urlTemplate: v.urlTemplate,
    params: v.params, headers: v.headers,
    bodyTemplate: v.bodyTemplate ?? null,
    bodyEncoding: v.bodyTemplate ? (v.bodyEncoding ?? 'json') : null,
    auth,
    kind: v.kind, writeEnabled: v.writeEnabled, enabled: v.enabled, updatedAt: new Date(),
  }
  await ref.update(doc)
  return c.json(toToolDef(id, { ...existing, ...doc }))
})

/** DELETE /tools/:id — idempotent. */
tools.delete('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  await adminDb.doc(`workspaces/${ws}/agents/${agentId}/tools/${c.req.param('id')}`).delete()
  return c.json({ ok: true })
})

/** POST /tools/:id/test { args } — run the tool through the guarded executor. */
tools.post('/:id/test', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const id = c.req.param('id')
  const snap = await adminDb.doc(`workspaces/${ws}/agents/${agentId}/tools/${id}`).get()
  if (!snap.exists) return c.json({ error: 'Tool not found' }, 404)
  const body = await c.req.json<{ args?: Record<string, unknown> }>().catch(() => ({} as { args?: Record<string, unknown> }))
  const data = snap.data()!
  let stored = toStoredTool(id, data)
  if (data.auth?.credentialId) {
    stored = { ...stored, auth: { ...stored.auth, secretEnc: await resolveConnectorAccessTokenEnc(ws, data.auth.credentialId) } }
  }
  const r = await executeTool(stored, body.args ?? {})
  return c.json(r)
})

export default tools
