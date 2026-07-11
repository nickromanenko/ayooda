/**
 * Minimal SSE frame parser for fetch-streamed responses.
 * (EventSource can't POST, so the chat stream is read manually.)
 */

export interface SSEMessage {
  event: string
  data: string
}

export function extractSSEMessages(buffer: string): { messages: SSEMessage[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const frames = normalized.split('\n\n')
  const rest = frames.pop() ?? ''
  const messages: SSEMessage[] = []

  for (const frame of frames) {
    if (!frame.trim()) continue
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    messages.push({ event, data: dataLines.join('\n') })
  }

  return { messages, rest }
}
