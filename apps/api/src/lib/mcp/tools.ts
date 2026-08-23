import { tool, type ToolSet } from 'ai'
import type { DocumentData } from 'firebase-admin/firestore'
import { z } from 'zod'
import { adminDb } from '../firebase-admin'
import { jsonSchemaToZod } from './json-schema-to-zod'
import { connectMcpServer, closeQuietly, withTimeout, LIST_TIMEOUT_MS, CALL_TIMEOUT_MS, type McpServerConfig } from './client'

/** One MCP server as stored in Firestore (secrets still encrypted). */
export interface StoredMcpServer extends McpServerConfig {
  id: string
  name: string
  enabled: boolean
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

function toStored(id: string, d: DocumentData): StoredMcpServer {
  return {
    id,
    name: (d.name as string) ?? 'MCP server',
    url: d.url as string,
    transport: (d.transport as StoredMcpServer['transport']) ?? 'streamable-http',
    headers: (d.headers as McpServerConfig['headers']) ?? [],
    auth: (d.auth as McpServerConfig['auth']) ?? { type: 'none' },
    enabled: d.enabled !== false,
  }
}

/** The agent's enabled MCP servers, newest first. */
export async function loadMcpServers(workspaceId: string, agentId: string): Promise<StoredMcpServer[]> {
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/agents/${agentId}/mcpServers`)
    .where('enabled', '==', true)
    .get()
  return snap.docs
    .map((d) => toStored(d.id, d.data()))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
  return s || 'server'
}

/** Namespace an MCP tool under its server so two servers can't collide. */
export function mcpToolName(serverName: string, toolName: string): string {
  return `mcp_${slugify(serverName)}_${toolName}`
}

/** Connect and list a server's tools. Caller must not let this reject a whole turn. */
export async function listServerTools(config: StoredMcpServer): Promise<McpToolInfo[]> {
  const client = await connectMcpServer(config)
  try {
    const res = await withTimeout(client.listTools(), LIST_TIMEOUT_MS, 'mcp listTools')
    return (res.tools ?? []).map((t) => ({
      name: t.name,
      description: typeof t.description === 'string' ? t.description : undefined,
      inputSchema: (t.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
    }))
  } finally {
    await closeQuietly(client)
  }
}

/** Convert an MCP tool's structured result content into the single string the
 *  model sees as the tool output (matches how custom HTTP tools return text). */
export function mcpResultToString(result: {
  content?: Array<Record<string, unknown>>
  isError?: boolean
}): string {
  const parts: string[] = []
  for (const item of result.content ?? []) {
    if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
    else if (item.type === 'image') parts.push(`[image: ${String(item.mimeType ?? 'image')}]`)
    else if (item.type === 'audio') parts.push('[audio]')
    else if (item.type === 'resource') {
      parts.push(typeof item.text === 'string' ? item.text : JSON.stringify(item))
    } else {
      parts.push(JSON.stringify(item))
    }
  }
  const text = parts.join('\n').trim()
  if (result.isError) return `error: ${text || 'tool call failed'}`
  return text || '(no output)'
}

function toAiSdkTool(config: StoredMcpServer, info: McpToolInfo) {
  const inputSchema = jsonSchemaToZod(info.inputSchema ?? { type: 'object' }) as unknown as z.ZodType<Record<string, unknown>>
  return tool({
    description: info.description ?? `Tool "${info.name}" from MCP server "${config.name}".`,
    inputSchema,
    execute: async (args: Record<string, unknown>) => {
      const client = await connectMcpServer(config)
      try {
        const res = await withTimeout(
          client.callTool({ name: info.name, arguments: args }),
          CALL_TIMEOUT_MS,
          `mcp call ${info.name}`,
        )
        return mcpResultToString(res as { content?: Array<Record<string, unknown>>; isError?: boolean })
      } finally {
        await closeQuietly(client)
      }
    },
  })
}

/**
 * Load every enabled MCP server's tools as an AI SDK ToolSet, namespaced under
 * the server. Per-server failures are logged and skipped — one unreachable
 * server must never cost a turn the other servers' and skills' tools.
 */
export async function loadMcpTools(workspaceId: string, agentId: string): Promise<ToolSet> {
  const out: ToolSet = {}
  let servers: StoredMcpServer[]
  try {
    servers = await loadMcpServers(workspaceId, agentId)
  } catch (err) {
    console.warn('[mcp] server load failed:', err)
    return out
  }

  for (const server of servers) {
    try {
      const infos = await listServerTools(server)
      for (const info of infos) {
        const name = mcpToolName(server.name, info.name)
        out[name] = toAiSdkTool(server, info)
      }
    } catch (err) {
      console.warn(`[mcp] server "${server.name}" tools unavailable:`, err)
    }
  }
  return out
}
