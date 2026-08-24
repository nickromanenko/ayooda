import type { ConnectorAuthMode } from '@ayooda/shared'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const OAUTH_CONNECTOR_IDS = ['shopify', 'hubspot', 'zendesk', 'notion', 'linear', 'intercom'] as const
export type OAuthConnectorId = (typeof OAUTH_CONNECTOR_IDS)[number]

export interface ConnectorCredentialData {
  providerId: string
  authMode: ConnectorAuthMode
  accessTokenEnc: string
  refreshTokenEnc?: string
  expiresAt?: Date
  setup: Record<string, string>
  scopes?: string[]
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scopes?: string[]
}

type Env = Record<string, string | undefined>
type FetchFn = typeof fetch

const CLIENT_ENV: Record<OAuthConnectorId, [string, string]> = {
  shopify: ['SHOPIFY_OAUTH_CLIENT_ID', 'SHOPIFY_OAUTH_CLIENT_SECRET'],
  hubspot: ['HUBSPOT_OAUTH_CLIENT_ID', 'HUBSPOT_OAUTH_CLIENT_SECRET'],
  zendesk: ['ZENDESK_OAUTH_CLIENT_ID', 'ZENDESK_OAUTH_CLIENT_SECRET'],
  notion: ['NOTION_OAUTH_CLIENT_ID', 'NOTION_OAUTH_CLIENT_SECRET'],
  linear: ['LINEAR_OAUTH_CLIENT_ID', 'LINEAR_OAUTH_CLIENT_SECRET'],
  intercom: ['INTERCOM_OAUTH_CLIENT_ID', 'INTERCOM_OAUTH_CLIENT_SECRET'],
}

export function isOAuthConnectorId(value: string): value is OAuthConnectorId {
  return OAUTH_CONNECTOR_IDS.includes(value as OAuthConnectorId)
}

function credentials(providerId: OAuthConnectorId, env: Env): { clientId: string; clientSecret: string } | null {
  const [idKey, secretKey] = CLIENT_ENV[providerId]
  const clientId = env[idKey]?.trim()
  const clientSecret = env[secretKey]?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export function oauthAvailable(providerId: string, env: Env = process.env): boolean {
  return isOAuthConnectorId(providerId) && credentials(providerId, env) !== null && !!env.API_PUBLIC_URL?.trim()
}

export function connectorOAuthCallbackUrl(providerId: string, env: Env = process.env): string {
  const base = env.API_PUBLIC_URL?.replace(/\/$/, '')
  if (!base) throw new Error('API_PUBLIC_URL is required for OAuth connectors.')
  return `${base}/connector-oauth/${encodeURIComponent(providerId)}/callback`
}

export function buildOAuthAuthorizeUrl(
  providerId: OAuthConnectorId,
  state: string,
  setup: Record<string, string>,
  env: Env = process.env,
): string {
  const client = credentials(providerId, env)
  if (!client) throw new Error(`${providerId} OAuth is not configured.`)
  const redirectUri = connectorOAuthCallbackUrl(providerId, env)
  let url: URL

  if (providerId === 'shopify') {
    url = new URL(`https://${setup.shop}.myshopify.com/admin/oauth/authorize`)
    url.searchParams.set('scope', 'read_orders,write_orders')
  } else if (providerId === 'hubspot') {
    url = new URL('https://app.hubspot.com/oauth/authorize')
    url.searchParams.set('scope', 'crm.objects.contacts.read crm.objects.contacts.write')
  } else if (providerId === 'zendesk') {
    url = new URL(`https://${setup.subdomain}.zendesk.com/oauth/authorizations/new`)
    url.searchParams.set('scope', 'tickets:read tickets:write')
  } else if (providerId === 'notion') {
    url = new URL('https://api.notion.com/v1/oauth/authorize')
    url.searchParams.set('owner', 'user')
  } else if (providerId === 'linear') {
    url = new URL('https://linear.app/oauth/authorize')
    url.searchParams.set('scope', 'read')
    url.searchParams.set('actor', 'app')
  } else {
    url = new URL('https://app.intercom.com/oauth')
  }

  url.searchParams.set('client_id', client.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  return url.toString()
}

function scopes(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string') return undefined
  return value.split(/[ ,]+/).map((item) => item.trim()).filter(Boolean)
}

function normalizeTokens(raw: unknown): OAuthTokens {
  if (!raw || typeof raw !== 'object') throw new Error('Provider returned an invalid token response.')
  const data = raw as Record<string, unknown>
  const accessToken = typeof data.access_token === 'string'
    ? data.access_token
    : typeof data.token === 'string' ? data.token : ''
  if (!accessToken) throw new Error('Provider did not return an access token.')
  return {
    accessToken,
    ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}),
    ...(typeof data.expires_in === 'number' ? { expiresIn: data.expires_in } : {}),
    ...(scopes(data.scope) ? { scopes: scopes(data.scope) } : {}),
  }
}

async function tokenRequest(url: string, init: RequestInit, fetchFn: FetchFn): Promise<OAuthTokens> {
  const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(10_000) })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Provider token exchange failed (${response.status}).`)
  return normalizeTokens(body)
}

export async function exchangeOAuthCode(
  providerId: OAuthConnectorId,
  code: string,
  setup: Record<string, string>,
  env: Env = process.env,
  fetchFn: FetchFn = fetch,
): Promise<OAuthTokens> {
  const client = credentials(providerId, env)
  if (!client) throw new Error(`${providerId} OAuth is not configured.`)
  const redirectUri = connectorOAuthCallbackUrl(providerId, env)

  if (providerId === 'notion') {
    return tokenRequest('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    }, fetchFn)
  }

  if (providerId === 'zendesk') {
    return tokenRequest(`https://${setup.subdomain}.zendesk.com/oauth/tokens`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri }),
    }, fetchFn)
  }

  const endpoint = providerId === 'shopify'
    ? `https://${setup.shop}.myshopify.com/admin/oauth/access_token`
    : providerId === 'hubspot'
      ? 'https://api.hubapi.com/oauth/v3/token'
      : providerId === 'linear'
        ? 'https://api.linear.app/oauth/token'
        : 'https://api.intercom.io/auth/eagle/token'
  const body = new URLSearchParams({ code, client_id: client.clientId, client_secret: client.clientSecret })
  if (providerId !== 'intercom') {
    body.set('grant_type', 'authorization_code')
    body.set('redirect_uri', redirectUri)
  }
  if (providerId === 'shopify') body.set('expiring', '1')
  return tokenRequest(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  }, fetchFn)
}

export async function refreshOAuthTokens(
  providerId: OAuthConnectorId,
  refreshToken: string,
  setup: Record<string, string>,
  env: Env = process.env,
  fetchFn: FetchFn = fetch,
): Promise<OAuthTokens> {
  const client = credentials(providerId, env)
  if (!client) throw new Error(`${providerId} OAuth is not configured.`)
  if (providerId === 'intercom') throw new Error('Intercom does not provide refresh tokens for this OAuth flow.')

  if (providerId === 'notion') {
    return tokenRequest('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    }, fetchFn)
  }
  if (providerId === 'zendesk') {
    return tokenRequest(`https://${setup.subdomain}.zendesk.com/oauth/tokens`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret }),
    }, fetchFn)
  }

  const endpoint = providerId === 'shopify'
    ? `https://${setup.shop}.myshopify.com/admin/oauth/access_token`
    : providerId === 'hubspot'
      ? 'https://api.hubapi.com/oauth/v3/token'
      : 'https://api.linear.app/oauth/token'
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refreshToken,
    client_id: client.clientId, client_secret: client.clientSecret,
  })
  return tokenRequest(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  }, fetchFn)
}

export function tokenExpiry(expiresIn?: number, now = Date.now()): Date | undefined {
  return expiresIn && expiresIn > 0 ? new Date(now + expiresIn * 1000) : undefined
}

/** Shopify signs its callback query in addition to OAuth state; other providers rely on state. */
export function verifyOAuthCallback(providerId: OAuthConnectorId, query: URLSearchParams, env: Env = process.env): boolean {
  if (providerId !== 'shopify') return true
  const client = credentials(providerId, env)
  const supplied = query.get('hmac')
  if (!client || !supplied || !/^[a-f0-9]{64}$/i.test(supplied)) return false
  const signed = [...query.entries()]
    .filter(([key]) => key !== 'hmac')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  const expected = createHmac('sha256', client.clientSecret).update(signed).digest()
  const actual = Buffer.from(supplied, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
