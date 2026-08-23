// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) — external tool servers an agent can call
// ---------------------------------------------------------------------------

export type McpTransportType = 'streamable-http' | 'sse'
export type McpServerAuthType = 'none' | 'bearer' | 'header'

/** Auth as returned to the web (no secret). Storage adds `secretEnc`; requests send `secret` (write-only). */
export interface McpServerAuth {
  type: McpServerAuthType
  headerName?: string
}

export interface McpServerHeader {
  key: string
  value: string
}

/** An MCP server as returned by GET /agents/:agentId/mcp — never carries the secret. */
export interface McpServerDef {
  id: string
  name: string
  url: string
  transport: McpTransportType
  headers: McpServerHeader[]
  auth: McpServerAuth
  hasSecret: boolean
  enabled: boolean
}

export const MCP_TRANSPORT_LABELS: Record<McpTransportType, string> = {
  'streamable-http': 'Streamable HTTP',
  sse: 'HTTP + SSE',
}
