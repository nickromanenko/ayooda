export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatParams { model: string; systemPrompt: string; messages: ChatMessage[]; apiKey: string }
export interface ChatChunk { text: string }
export interface ChatResult { promptTokens: number; completionTokens: number }

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Stream a chat completion from OpenRouter (OpenAI-compatible SSE).
 * Yields text deltas; returns token usage after the stream completes.
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

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        let parsed: {
          choices?: Array<{ delta?: { content?: string } }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        try { parsed = JSON.parse(data) } catch { continue }
        const text = parsed.choices?.[0]?.delta?.content
        if (text) yield { text }
        if (parsed.usage) {
          promptTokens = parsed.usage.prompt_tokens ?? promptTokens
          completionTokens = parsed.usage.completion_tokens ?? completionTokens
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  return { promptTokens, completionTokens }
}
