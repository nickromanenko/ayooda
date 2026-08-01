export interface ToolCall { id: string; name: string; arguments: string }
export interface OpenRouterTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

interface WireToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatParams {
  model: string
  systemPrompt: string
  messages: ChatMessage[]
  apiKey: string
  tools?: OpenRouterTool[]
}
export interface ChatChunk { text: string }
export interface ChatResult { promptTokens: number; completionTokens: number; toolCalls?: ToolCall[] }

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Stream a chat completion from OpenRouter (OpenAI-compatible SSE).
 * Yields text deltas; returns token usage and any accumulated tool calls after the stream completes.
 */
export async function* streamChat(
  params: ChatParams,
): AsyncGenerator<ChatChunk, ChatResult, void> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ayooda.live',
      'X-Title': 'Ayooda',
    },
    body: JSON.stringify({
      model: params.model,
      messages: [{ role: 'system', content: params.systemPrompt }, ...params.messages],
      stream: true,
      stream_options: { include_usage: true },
      ...(params.tools?.length ? { tools: params.tools } : {}),
    }),
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter error ${res.status}: ${detail.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let promptTokens = 0
  let completionTokens = 0
  const toolAcc: Array<{ id: string; name: string; arguments: string }> = []

  // Parse one SSE frame → { text?, done? }. Throws on a mid-stream error event.
  const parseFrame = (frame: string): { text?: string; done?: boolean } => {
    const line = frame.split('\n').find((l) => l.startsWith('data:'))
    if (!line) return {}
    const data = line.slice(5).trim()
    if (data === '[DONE]') return { done: true }
    let parsed: {
      choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      error?: { message?: string }
    }
    try { parsed = JSON.parse(data) } catch { return {} }
    if (parsed.error) throw new Error(`OpenRouter stream error: ${parsed.error.message ?? 'unknown'}`)
    if (parsed.usage) {
      promptTokens = parsed.usage.prompt_tokens ?? promptTokens
      completionTokens = parsed.usage.completion_tokens ?? completionTokens
    }
    const tcs = parsed.choices?.[0]?.delta?.tool_calls
    if (tcs) {
      for (const tc of tcs) {
        const idx = tc.index ?? 0
        const cur = (toolAcc[idx] ??= { id: '', name: '', arguments: '' })
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name = tc.function.name
        if (tc.function?.arguments) cur.arguments += tc.function.arguments
      }
    }
    const text = parsed.choices?.[0]?.delta?.content
    return text ? { text } : {}
  }

  try {
    let finished = false
    while (!finished) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      // On the final read, append a frame separator so a trailing frame without
      // its own blank line still gets processed.
      const toSplit = done ? buffer + '\n\n' : buffer
      const frames = toSplit.split('\n\n')
      buffer = done ? '' : (frames.pop() ?? '')
      for (const frame of frames) {
        const r = parseFrame(frame)
        if (r.text) yield { text: r.text }
        if (r.done) { finished = true; break }
      }
      if (done) break
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  const toolCalls = toolAcc.filter((t) => t && t.id)
  return { promptTokens, completionTokens, ...(toolCalls.length ? { toolCalls } : {}) }
}
