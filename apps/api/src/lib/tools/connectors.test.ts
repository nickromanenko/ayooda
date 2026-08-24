import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { buildOAuthAuthorizeUrl, exchangeOAuthCode, oauthAvailable, refreshOAuthTokens, tokenExpiry, verifyOAuthCallback } from './connectors'

const env = {
  API_PUBLIC_URL: 'https://api.example.com/',
  SHOPIFY_OAUTH_CLIENT_ID: 'shop-id', SHOPIFY_OAUTH_CLIENT_SECRET: 'shop-secret',
  NOTION_OAUTH_CLIENT_ID: 'notion-id', NOTION_OAUTH_CLIENT_SECRET: 'notion-secret',
  LINEAR_OAUTH_CLIENT_ID: 'linear-id', LINEAR_OAUTH_CLIENT_SECRET: 'linear-secret',
}

describe('connector OAuth', () => {
  test('only reports OAuth available with a callback base and both client credentials', () => {
    expect(oauthAvailable('linear', env)).toBe(true)
    expect(oauthAvailable('hubspot', env)).toBe(false)
    expect(oauthAvailable('stripe', env)).toBe(false)
  })

  test('builds a state-bound Shopify authorization URL for the configured shop', () => {
    const url = new URL(buildOAuthAuthorizeUrl('shopify', 'state-1', { shop: 'acme' }, env))
    expect(url.origin).toBe('https://acme.myshopify.com')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.com/connector-oauth/shopify/callback')
    expect(url.searchParams.get('scope')).toContain('write_orders')
  })

  test('verifies Shopify callback HMACs and rejects changed callback data', () => {
    const query = new URLSearchParams({ code: 'code-1', shop: 'acme.myshopify.com', state: 'state-1', timestamp: '1' })
    const signed = [...query.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&')
    query.set('hmac', createHmac('sha256', 'shop-secret').update(signed).digest('hex'))
    expect(verifyOAuthCallback('shopify', query, env)).toBe(true)
    query.set('code', 'changed')
    expect(verifyOAuthCallback('shopify', query, env)).toBe(false)
  })

  test('uses Basic auth and JSON for the Notion code exchange', async () => {
    let request: { url: string; init?: RequestInit } | undefined
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init }
      return Response.json({ access_token: 'oauth-token', workspace_name: 'Acme' })
    }) as typeof fetch
    const result = await exchangeOAuthCode('notion', 'code-1', {}, env, fakeFetch)
    expect(result.accessToken).toBe('oauth-token')
    expect(request?.url).toBe('https://api.notion.com/v1/oauth/token')
    expect((request?.init?.headers as Record<string, string>).Authorization).toStartWith('Basic ')
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({ code: 'code-1', grant_type: 'authorization_code' })
  })

  test('normalizes Linear refresh and expiry fields', async () => {
    const fakeFetch = (async () => Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 86399, scope: 'read write' })) as unknown as typeof fetch
    const result = await exchangeOAuthCode('linear', 'code', {}, env, fakeFetch)
    expect(result).toEqual({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 86399, scopes: ['read', 'write'] })
    expect(tokenExpiry(60, 1_000)?.getTime()).toBe(61_000)
  })

  test('refreshes Linear tokens with the rotating refresh-token grant', async () => {
    let body = ''
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body)
      return Response.json({ access_token: 'next-access', refresh_token: 'next-refresh', expires_in: 100 })
    }) as typeof fetch
    const result = await refreshOAuthTokens('linear', 'old-refresh', {}, env, fakeFetch)
    expect(new URLSearchParams(body).get('grant_type')).toBe('refresh_token')
    expect(new URLSearchParams(body).get('refresh_token')).toBe('old-refresh')
    expect(result.refreshToken).toBe('next-refresh')
  })
})
