import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { assertSafeHttpsUrl } from '../tools/ssrf'
import { decryptSecret } from '../crypto'
import type { McpTransportType } from '@ayooda/shared'

/**
 * Connection machinery for a single MCP server. The heavy lifting (transport,
 * JSON-RPC framing, protocol negotiation) is the official SDK's; this file adds
 * the two things a hosted, multi-tenant product must own itself: SSRF protection
 * on the configured URL, and hard timeouts so a dead server can't stall a turn.
 */

export interface McpServerConfig {
  url: string
  transport: McpTransportType
  headers: Array<{ key: string; value: string }>
  auth: { type: 'none' | 'bearer' | 'header'; headerName?: string; secretEnc?: string }
}

export const CONNECT_TIMEOUT_MS = 10_000
export const LIST_TIMEOUT_MS = 20_000
export const CALL_TIMEOUT_MS = 30_000

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))) },
    )
  })
}

/** Resolve the host and refuse private/loopback/link-local targets before the
 *  SDK ever dials them. Mirrors the custom-tool executor's guard. */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  return assertSafeHttpsUrl(rawUrl)
}

function buildHeaders(config: McpServerConfig): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const h of config.headers) headers[h.key] = h.value
  if (config.auth.type !== 'none' && config.auth.secretEnc) {
    let secret: string
    try { secret = decryptSecret(config.auth.secretEnc) } catch { return headers }
    if (config.auth.type === 'bearer') headers['Authorization'] = `Bearer ${secret}`
    else if (config.auth.type === 'header' && config.auth.headerName) headers[config.auth.headerName] = secret
  }
  return headers
}

/** Connect to one server. Throws on SSRF block, bad URL, or handshake timeout. */
export async function connectMcpServer(config: McpServerConfig): Promise<Client> {
  const url = await assertSafeUrl(config.url)
  const headers = buildHeaders(config)
  const client = new Client({ name: 'ayooda', version: '1.0.0' })
  const transport = config.transport === 'sse'
    ? new SSEClientTransport(url, { requestInit: { headers } })
    : new StreamableHTTPClientTransport(url, { requestInit: { headers } })
  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'mcp connect')
  return client
}

/** Best-effort close, never throws. */
export async function closeQuietly(client: Client): Promise<void> {
  try { await client.close() } catch { /* ignore */ }
}
