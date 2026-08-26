export interface FeedMessage {
  id: string
  role: string
  content: string
}

/** Reconciles live conversation events with replies already rendered by POST streams. */
export class MessageBuffer {
  private renderedIds = new Set<string>()
  private pending = new Map<string, FeedMessage>()

  accept(message: FeedMessage, defer: boolean): FeedMessage[] {
    if (this.renderedIds.has(message.id) || this.pending.has(message.id)) return []
    if (defer) {
      this.pending.set(message.id, message)
      return []
    }
    this.renderedIds.add(message.id)
    return [message]
  }

  markRendered(id: string | undefined) {
    if (id) this.renderedIds.add(id)
  }

  flush(): FeedMessage[] {
    const messages: FeedMessage[] = []
    for (const message of this.pending.values()) {
      if (this.renderedIds.has(message.id)) continue
      this.renderedIds.add(message.id)
      messages.push(message)
    }
    this.pending.clear()
    return messages
  }
}
