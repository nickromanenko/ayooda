import type { ToolMethod, ToolParam } from '@ayooda/shared'
import type { OpenRouterTool } from '../llm/openrouter'

export interface StoredTool {
  id: string
  name: string
  description: string
  method: ToolMethod
  urlTemplate: string
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>
  auth: { type: 'none' | 'bearer' | 'header'; headerName?: string; secretEnc?: string }
  kind: 'read' | 'write'
  writeEnabled: boolean
  enabled: boolean
}

export function toOpenRouterTools(tools: StoredTool[]): OpenRouterTool[] {
  return tools.map((t) => {
    const properties: Record<string, { type: string; description: string }> = {}
    const required: string[] = []
    for (const p of t.params) {
      properties[p.name] = { type: p.type, description: p.description }
      if (p.required) required.push(p.name)
    }
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: { type: 'object', properties, required, additionalProperties: false },
      },
    }
  })
}

export interface BuiltRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** Build the HTTP request for a tool call. Throws on an unfilled placeholder. Auth is applied later by executeTool. */
export function buildToolRequest(tool: StoredTool, args: Record<string, unknown>): BuiltRequest {
  const used = new Set<string>()
  const url = tool.urlTemplate.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, name: string) => {
    const v = args[name]
    if (v === undefined || v === null) throw new Error(`missing required param: ${name}`)
    used.add(name)
    return encodeURIComponent(String(v))
  })

  const headers: Record<string, string> = {}
  for (const h of tool.headers) headers[h.key] = h.value

  const leftover: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (!used.has(k) && v !== undefined) leftover[k] = v
  }

  if (tool.method === 'POST' || tool.method === 'PUT' || tool.method === 'PATCH') {
    headers['Content-Type'] = 'application/json'
    return { url, method: tool.method, headers, body: JSON.stringify(leftover) }
  }

  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(leftover)) qs.append(k, String(v))
  const query = qs.toString()
  const full = query ? url + (url.includes('?') ? '&' : '?') + query : url
  return { url: full, method: tool.method, headers }
}
