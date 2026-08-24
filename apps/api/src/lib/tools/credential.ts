import { adminDb } from '../firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { decryptSecret, encryptSecret } from '../crypto'
import { isOAuthConnectorId, refreshOAuthTokens, tokenExpiry } from './connectors'

function dateMillis(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  return null
}

/** Resolve and, when necessary, refresh one workspace connector credential. Returns encrypted material only. */
export async function resolveConnectorAccessTokenEnc(workspaceId: string, credentialId: string): Promise<string | undefined> {
  const ref = adminDb.doc(`workspaces/${workspaceId}/connectorCredentials/${credentialId}`)
  const snap = await ref.get()
  if (!snap.exists) return undefined
  const data = snap.data()!
  const current = typeof data.accessTokenEnc === 'string' ? data.accessTokenEnc : undefined
  const expiresAt = dateMillis(data.expiresAt)
  if (!expiresAt || expiresAt > Date.now() + 60_000 || data.authMode !== 'oauth') return current
  if (!isOAuthConnectorId(credentialId) || typeof data.refreshTokenEnc !== 'string') return current

  try {
    const refreshed = await refreshOAuthTokens(
      credentialId,
      decryptSecret(data.refreshTokenEnc),
      data.setup && typeof data.setup === 'object' ? data.setup : {},
    )
    const update = {
      accessTokenEnc: encryptSecret(refreshed.accessToken),
      ...(refreshed.refreshToken ? { refreshTokenEnc: encryptSecret(refreshed.refreshToken) } : {}),
      expiresAt: tokenExpiry(refreshed.expiresIn) ?? FieldValue.delete(),
      ...(refreshed.scopes ? { scopes: refreshed.scopes } : {}),
      updatedAt: new Date(),
    }
    await ref.update(update)
    return update.accessTokenEnc
  } catch (error) {
    console.error(`[connector/${credentialId}] token refresh failed`, error)
    return current
  }
}
