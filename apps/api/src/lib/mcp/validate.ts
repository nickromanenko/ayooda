import type { McpTransportType, McpServerAuthType, McpServerHeader } from '@ayooda/shared'

export interface ValidatedMcpServer {
  name: string
  url: string
  transport: McpTransportType
  headers: McpServerHeader[]
  auth: { type: McpServerAuthType; headerName?: string }
  secret?: string
  enabled: boolean
}

const TRANSPORTS: McpTransportType[] = ['streamable-http', 'sse']
const AUTH_TYPES: McpServerAuthType[] = ['none', 'bearer', 'header']
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'accept', 'content-type', 'mcp-protocol-version', 'mcp-session-id'])

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })

export function validateMcpServerInput(
  raw: unknown,
): { ok: true; value: ValidatedMcpServer } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Invalid request body.')
  const o = raw as Record<string, unknown>

  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (name.length < 1 || name.length > 80) return fail('Name must be 1–80 characters.')

  const url = typeof o.url === 'string' ? o.url.trim() : ''
  let parsed: URL
  try { parsed = new URL(url) } catch { return fail('URL is not valid.') }
  if (parsed.protocol !== 'https:') return fail('URL must use https://.')

  const transport = (o.transport ?? 'streamable-http') as McpTransportType
  if (!TRANSPORTS.includes(transport)) return fail('Transport must be "streamable-http" or "sse".')

  const rawHeaders = Array.isArray(o.headers) ? o.headers : []
  if (rawHeaders.length > 20) return fail('A server may have at most 20 headers.')
  const headers: McpServerHeader[] = []
  const seenKeys = new Set<string>()
  for (const h of rawHeaders) {
    if (!h || typeof h !== 'object') return fail('Each header must be an object.')
    const hh = h as Record<string, unknown>
    const key = typeof hh.key === 'string' ? hh.key.trim() : ''
    const value = typeof hh.value === 'string' ? hh.value : ''
    if (!key) return fail('Header keys cannot be empty.')
    if (FORBIDDEN_HEADERS.has(key.toLowerCase())) return fail(`Header "${key}" is managed by the MCP client and cannot be set.`)
    if (seenKeys.has(key.toLowerCase())) return fail(`Duplicate header "${key}".`)
    seenKeys.add(key.toLowerCase())
    headers.push({ key, value })
  }

  const rawAuth = (o.auth ?? { type: 'none' }) as Record<string, unknown>
  const authType = rawAuth.type as McpServerAuthType
  if (!AUTH_TYPES.includes(authType)) return fail('Auth type must be none, bearer, or header.')
  const auth: ValidatedMcpServer['auth'] = { type: authType }
  if (authType === 'header') {
    const headerName = typeof rawAuth.headerName === 'string' ? rawAuth.headerName.trim() : ''
    if (!headerName) return fail('Header auth requires a header name.')
    auth.headerName = headerName
  }
  const secret = typeof rawAuth.secret === 'string' && rawAuth.secret.length > 0 ? rawAuth.secret : undefined

  const enabled = o.enabled === undefined ? true : o.enabled === true

  return { ok: true, value: { name, url, transport, headers, auth, secret, enabled } }
}
