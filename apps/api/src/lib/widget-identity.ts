import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { adminDb } from './firebase-admin'
import { decryptSecret } from './crypto'

export interface VerifiedWidgetCustomer {
  externalId: string
  name?: string
  email?: string
}

const SESSION_TTL_MS = 24 * 60 * 60_000
const MAX_IDENTITY_TTL_SECONDS = 15 * 60

function decodePart(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

export function verifyWidgetIdentityToken(token: string, secret: string, channelId: string, now = Date.now()): VerifiedWidgetCustomer {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed identity token')
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]
  const header = decodePart(encodedHeader) as { alg?: unknown; typ?: unknown }
  const payload = decodePart(encodedPayload) as Record<string, unknown>
  if (header.alg !== 'HS256' || (header.typ !== undefined && header.typ !== 'JWT')) throw new Error('Unsupported identity token')
  const expected = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest()
  const actual = Buffer.from(encodedSignature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid identity token signature')

  const nowSeconds = Math.floor(now / 1000)
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : ''
  const iat = typeof payload.iat === 'number' ? payload.iat : NaN
  const exp = typeof payload.exp === 'number' ? payload.exp : NaN
  if (!sub || sub.length > 200 || /[\u0000-\u001f\u007f]/.test(sub)) throw new Error('Identity token requires a valid sub')
  if (payload.aud !== `ayooda-widget:${channelId}`) throw new Error('Invalid identity token audience')
  if (!Number.isInteger(iat) || !Number.isInteger(exp) || iat > nowSeconds + 60 || exp <= nowSeconds - 60 || exp - iat > MAX_IDENTITY_TTL_SECONDS) {
    throw new Error('Identity token is expired or has an invalid lifetime')
  }
  const name = typeof payload.name === 'string' ? payload.name.trim() : undefined
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : undefined
  if (name && (name.length > 120 || /[\u0000-\u001f\u007f]/.test(name))) throw new Error('Identity name is invalid')
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Identity email is invalid')
  return { externalId: sub, ...(name ? { name } : {}), ...(email ? { email } : {}) }
}

function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function authenticatedVisitorId(workspaceId: string, channelId: string, externalId: string): string {
  const platformSecret = process.env.API_KEY_ENCRYPTION_SECRET
  if (!platformSecret) throw new Error('API_KEY_ENCRYPTION_SECRET is not set')
  return `auth_${createHmac('sha256', platformSecret).update(`${workspaceId}\0${channelId}\0${externalId}`).digest('base64url')}`
}

export async function createWidgetSession(workspaceId: string, channelId: string, customer: VerifiedWidgetCustomer) {
  const token = randomBytes(32).toString('base64url')
  const visitorId = authenticatedVisitorId(workspaceId, channelId, customer.externalId)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await adminDb.doc(`workspaces/${workspaceId}/widgetSessions/${sessionHash(token)}`).set({
    channelId, visitorId, customer, createdAt: new Date(), expiresAt,
  })
  return { token, visitorId, expiresAt }
}

export async function resolveWidgetSession(workspaceId: string, channelId: string, token?: string | null) {
  if (!token || token.length > 200) return null
  const snap = await adminDb.doc(`workspaces/${workspaceId}/widgetSessions/${sessionHash(token)}`).get()
  if (!snap.exists) return null
  const data = snap.data()!
  const expiresAt = data.expiresAt?.toDate?.() ?? data.expiresAt
  if (data.channelId !== channelId || !(expiresAt instanceof Date) || expiresAt.getTime() <= Date.now()) return null
  return { visitorId: data.visitorId as string, customer: data.customer as VerifiedWidgetCustomer }
}

export async function revokeWidgetSession(workspaceId: string, token?: string | null) {
  if (token && token.length <= 200) await adminDb.doc(`workspaces/${workspaceId}/widgetSessions/${sessionHash(token)}`).delete()
}

export function channelIdentitySecrets(data: Record<string, unknown>, now = Date.now()): string[] {
  const encrypted = data.identitySigningSecretEnc
  const secrets = typeof encrypted === 'string' ? [decryptSecret(encrypted)] : []
  const previous = data.identityPreviousSigningSecretEnc
  const expiryValue = data.identityPreviousSecretExpiresAt as Date | { toDate?: () => Date } | undefined
  const expiry = expiryValue instanceof Date ? expiryValue : expiryValue?.toDate?.()
  if (typeof previous === 'string' && expiry && expiry.getTime() > now) secrets.push(decryptSecret(previous))
  return secrets
}
