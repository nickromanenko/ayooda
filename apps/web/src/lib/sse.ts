/**
 * Minimal SSE reader for fetch responses. The dashboard's second copy of this
 * loop (the widget has the first) — sharing it would need a browser-targeted
 * package, since packages/shared is deliberately dependency-free and DOM-free.
 */
export async function readSSE(
  res: Response,
  handlers: { onEvent: (event: string, data: string) => void | Promise<void> },
): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (data) await handlers.onEvent(event, data)
    }
  }
}
