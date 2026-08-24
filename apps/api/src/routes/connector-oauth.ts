import { Hono, type Context } from 'hono'
import { FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { encryptSecret } from '../lib/crypto'
import { exchangeOAuthCode, isOAuthConnectorId, tokenExpiry, verifyOAuthCallback } from '../lib/tools/connectors'
import { planToolBundleInstall, prepareToolBundle, toolBundleDocumentId, type PreparedBundleTool } from '../lib/tools/bundles'
import { templatesForToolBundle } from '@ayooda/shared'

const connectorOAuth = new Hono()

function dashboardUrl(agentId: string, providerId: string, outcome: 'success' | 'error'): string {
  const base = (process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const url = new URL(`${base}/dashboard/agents/${encodeURIComponent(agentId)}/tools`)
  url.searchParams.set('connector', providerId)
  url.searchParams.set('oauth', outcome)
  return url.toString()
}

function expiresAtMillis(value: unknown): number {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  return 0
}

function oauthToolDocument(tool: PreparedBundleTool, bundleId: string) {
  const value = tool.value
  return {
    name: value.name,
    description: value.description,
    method: value.method,
    urlTemplate: value.urlTemplate,
    params: value.params,
    headers: value.headers,
    ...(value.bodyTemplate ? { bodyTemplate: value.bodyTemplate, bodyEncoding: value.bodyEncoding ?? 'json' } : {}),
    auth: {
      type: value.auth.type,
      ...(value.auth.headerName ? { headerName: value.auth.headerName } : {}),
      credentialId: bundleId,
    },
    kind: value.kind,
    writeEnabled: false,
    enabled: true,
    bundleId,
    templateId: tool.templateId,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

async function callback(c: Context) {
  const providerId = c.req.param('provider') ?? ''
  const state = c.req.query('state')
  const code = c.req.query('code')
  if (!isOAuthConnectorId(providerId) || !state) return c.text('Invalid OAuth callback.', 400)

  const stateRef = adminDb.doc(`connectorOAuthStates/${state}`)
  let stateData: DocumentData | undefined
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(stateRef)
    if (!snap.exists) return
    stateData = snap.data()
    tx.delete(stateRef)
  })
  const agentId = typeof stateData?.agentId === 'string' ? stateData.agentId : ''
  if (!stateData || stateData.providerId !== providerId || expiresAtMillis(stateData.expiresAt) < Date.now()) {
    return c.text('OAuth state is invalid or expired. Start the connection again.', 400)
  }
  if (!verifyOAuthCallback(providerId, new URL(c.req.url).searchParams)) {
    return c.text('OAuth callback signature is invalid.', 400)
  }
  if (providerId === 'shopify' && c.req.query('shop') !== `${stateData.setup?.shop}.myshopify.com`) {
    return c.text('OAuth callback shop does not match the requested connection.', 400)
  }
  if (!code || c.req.query('error')) return c.redirect(dashboardUrl(agentId, providerId, 'error'))

  try {
    const setup = stateData.setup && typeof stateData.setup === 'object' ? stateData.setup as Record<string, string> : {}
    const prepared = prepareToolBundle({ bundleId: providerId, credentialId: providerId, setup })
    if (!prepared.ok) throw new Error(prepared.error)
    const tokens = await exchangeOAuthCode(providerId, code, setup)
    const ws = String(stateData.workspaceId)
    const col = adminDb.collection(`workspaces/${ws}/agents/${agentId}/tools`)
    const existing = await col.get()
    const plan = planToolBundleInstall(prepared.tools, existing.docs.map((doc) => ({ id: doc.id, name: String(doc.data().name ?? '') })))
    const batch = adminDb.batch()
    const now = new Date()

    batch.set(adminDb.doc(`workspaces/${ws}/connectorCredentials/${providerId}`), {
      providerId,
      authMode: 'oauth',
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : FieldValue.delete(),
      expiresAt: tokenExpiry(tokens.expiresIn) ?? FieldValue.delete(),
      scopes: tokens.scopes ?? FieldValue.delete(),
      setup,
      createdBy: String(stateData.uid),
      createdAt: now,
      updatedAt: now,
    }, { merge: true })

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
          credentialId: providerId,
        },
        updatedAt: now,
      })
    }
    const agents = await adminDb.collection(`workspaces/${ws}/agents`).get()
    for (const agent of agents.docs) {
      if (agent.id === agentId) continue
      const providerTools = await agent.ref.collection('tools').where('bundleId', '==', providerId).get()
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
            credentialId: providerId,
          },
          updatedAt: now,
        })
      }
    }
    for (const tool of plan.install) batch.set(col.doc(toolBundleDocumentId(tool.templateId)), oauthToolDocument(tool, providerId))
    await batch.commit()
    return c.redirect(dashboardUrl(agentId, providerId, 'success'))
  } catch (error) {
    console.error(`[connector-oauth/${providerId}] callback failed`, error)
    return c.redirect(dashboardUrl(agentId, providerId, 'error'))
  }
}

connectorOAuth.get('/:provider/callback', callback)

export default connectorOAuth
