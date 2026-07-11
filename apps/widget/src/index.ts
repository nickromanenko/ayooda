/**
 * Ayooda Widget — embeddable chat bubble
 *
 * Usage:
 *   <script src="https://<host>/widget.js"
 *           data-agent-id="<channelId>"
 *           data-api-url="https://<api-host>"   (optional, defaults to prod URL)
 *           async></script>
 */

import { extractSSEMessages } from './sse'

// ---------------------------------------------------------------------------
// Bootstrap — read attributes synchronously before any async work
// ---------------------------------------------------------------------------

const $script = document.currentScript as HTMLScriptElement | null
const CHANNEL_ID = $script?.getAttribute('data-agent-id') ?? ''
const API_BASE =
  $script?.getAttribute('data-api-url') ??
  'https://ayooda-api-uc.a.run.app' // placeholder: update with real Cloud Run URL

if (!CHANNEL_ID) {
  console.error('[Ayooda] Missing data-agent-id attribute on widget script tag')
} else {
  init()
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WidgetConfig {
  agentName: string
  agentPhotoURL: string | null
  widgetColor: string
  widgetPosition: 'bottom-right' | 'bottom-left'
  welcomeMessage: string
}

interface ChatDone {
  conversationId: string
  messageId: string
  sources: Array<{ docId: string; source: string; score: number }>
}

// ---------------------------------------------------------------------------
// State helpers (sessionStorage / localStorage)
// ---------------------------------------------------------------------------

function getVisitorId(): string {
  const key = 'ayooda_visitor_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}

function getConversationId(): string {
  const key = `ayooda_conv_${CHANNEL_ID}`
  let id = sessionStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(key, id)
  }
  return id
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchConfig(): Promise<WidgetConfig> {
  const res = await fetch(`${API_BASE}/widget/config/${CHANNEL_ID}`)
  if (!res.ok) throw new Error('Failed to load widget config')
  return res.json()
}

const FIRST_CHUNK_TIMEOUT_MS = 30_000

async function sendMessageStream(
  message: string,
  conversationId: string,
  visitorId: string,
  handlers: { onChunk: (text: string) => void; onDone: (done: ChatDone) => void },
): Promise<void> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    FIRST_CHUNK_TIMEOUT_MS,
  )

  try {
    const res = await fetch(`${API_BASE}/widget/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: CHANNEL_ID, conversationId, message, visitorId }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body || !res.headers.get('content-type')?.includes('text/event-stream')) {
      throw new Error('Failed to send message')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { messages, rest } = extractSSEMessages(buffer)
        buffer = rest
        for (const msg of messages) {
          if (timeout) {
            clearTimeout(timeout) // first frame arrived — stop the watchdog
            timeout = null
          }
          if (msg.event === 'chunk') {
            handlers.onChunk((JSON.parse(msg.data) as { text: string }).text)
          } else if (msg.event === 'done') {
            finished = true
            handlers.onDone(JSON.parse(msg.data) as ChatDone)
          } else if (msg.event === 'error') {
            throw new Error((JSON.parse(msg.data) as { error: string }).error)
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {}) // release the connection on every exit path
    }

    if (!finished) throw new Error('Stream ended without completion')
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function buildCSS(color: string): string {
  return `
    :host { all: initial; font-family: system-ui, -apple-system, sans-serif; }

    #container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 12px;
    }

    #toggle {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: ${color};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      flex-shrink: 0;
    }
    #toggle:hover { transform: scale(1.06); box-shadow: 0 6px 20px rgba(0,0,0,0.22); }
    #toggle svg { width: 24px; height: 24px; fill: white; }

    #panel {
      width: 360px;
      height: 520px;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.16);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    #panel.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateY(12px) scale(0.97);
    }

    /* Header */
    #header {
      background: ${color};
      color: #fff;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    #avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(255,255,255,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      flex-shrink: 0;
      overflow: hidden;
    }
    #avatar img { width: 100%; height: 100%; object-fit: cover; }
    #agent-name { font-size: 15px; font-weight: 600; flex: 1; }
    #close-btn {
      background: none;
      border: none;
      color: rgba(255,255,255,0.8);
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      border-radius: 6px;
    }
    #close-btn:hover { color: #fff; background: rgba(255,255,255,0.15); }

    /* Messages */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scroll-behavior: smooth;
    }
    #messages::-webkit-scrollbar { width: 4px; }
    #messages::-webkit-scrollbar-thumb { background: #e4e4e7; border-radius: 2px; }

    .msg {
      max-width: 80%;
      padding: 9px 13px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.5;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .msg.user {
      align-self: flex-end;
      background: ${color};
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .msg.bot {
      align-self: flex-start;
      background: #f4f4f5;
      color: #18181b;
      border-bottom-left-radius: 4px;
    }
    .msg.error {
      align-self: flex-start;
      background: #fef2f2;
      color: #dc2626;
      border-bottom-left-radius: 4px;
    }
    .msg.system {
      align-self: center;
      background: transparent;
      color: #a1a1aa;
      font-size: 12px;
      padding: 2px 8px;
    }

    /* Typing indicator */
    .typing {
      align-self: flex-start;
      background: #f4f4f5;
      border-radius: 14px;
      border-bottom-left-radius: 4px;
      padding: 10px 14px;
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .typing span {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #a1a1aa;
      animation: bounce 1.2s infinite;
    }
    .typing span:nth-child(2) { animation-delay: 0.2s; }
    .typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-5px); }
    }

    /* Input area */
    #input-area {
      padding: 12px 16px;
      border-top: 1px solid #e4e4e7;
      display: flex;
      gap: 8px;
      align-items: flex-end;
      flex-shrink: 0;
    }
    #input {
      flex: 1;
      border: 1px solid #d4d4d8;
      border-radius: 10px;
      padding: 9px 12px;
      font-size: 14px;
      font-family: inherit;
      resize: none;
      max-height: 100px;
      outline: none;
      color: #18181b;
      background: #fff;
      transition: border-color 0.15s;
      line-height: 1.4;
    }
    #input:focus { border-color: ${color}; }
    #input::placeholder { color: #a1a1aa; }

    #send-btn {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: ${color};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity 0.15s;
    }
    #send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    #send-btn svg { width: 18px; height: 18px; fill: white; }

    /* Powered-by */
    #poweredby {
      text-align: center;
      font-size: 11px;
      color: #a1a1aa;
      padding: 6px 0 10px;
      flex-shrink: 0;
    }
    #poweredby a { color: #a1a1aa; text-decoration: none; }
    #poweredby a:hover { color: #71717a; }
  `
}

// ---------------------------------------------------------------------------
// SVG icons
// ---------------------------------------------------------------------------

const ICON_CHAT = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
</svg>`

const ICON_CLOSE = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor">
  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
</svg>`

const ICON_SEND = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
</svg>`

// ---------------------------------------------------------------------------
// Widget class
// ---------------------------------------------------------------------------

class AyoodaWidget {
  private shadow: ShadowRoot
  private panel!: HTMLElement
  private messages!: HTMLElement
  private input!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private open = false
  private sending = false
  private conversationId: string
  private visitorId: string
  private config: WidgetConfig
  private renderedIds = new Set<string>()
  private eventSource: EventSource | null = null
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private feedSuspended = false // set on immediate failure (conversation may not exist yet)

  constructor(host: HTMLElement, config: WidgetConfig) {
    this.config = config
    this.conversationId = getConversationId()
    this.visitorId = getVisitorId()

    this.shadow = host.attachShadow({ mode: 'open' })
    this.build()
  }

  private build() {
    const { agentName, agentPhotoURL, widgetColor, welcomeMessage } = this.config

    const style = document.createElement('style')
    style.textContent = buildCSS(widgetColor)
    this.shadow.appendChild(style)

    const container = document.createElement('div')
    container.id = 'container'
    container.innerHTML = `
      <div id="panel" class="hidden">
        <div id="header">
          <div id="avatar">
            ${
              agentPhotoURL
                ? `<img src="${agentPhotoURL}" alt="${agentName}" />`
                : agentName.charAt(0).toUpperCase()
            }
          </div>
          <span id="agent-name">${agentName}</span>
          <button id="close-btn" aria-label="Close chat">${ICON_CLOSE}</button>
        </div>
        <div id="messages" role="log" aria-live="polite"></div>
        <div id="input-area">
          <textarea
            id="input"
            rows="1"
            placeholder="Type a message\u2026"
            aria-label="Chat message"
          ></textarea>
          <button id="send-btn" aria-label="Send" disabled>${ICON_SEND}</button>
        </div>
        <div id="poweredby">Powered by <a href="https://ayooda.com" target="_blank" rel="noopener">Ayooda</a></div>
      </div>
      <button id="toggle" aria-label="Open chat">${ICON_CHAT}</button>
    `
    this.shadow.appendChild(container)

    // Refs
    this.panel = container.querySelector('#panel')!
    this.messages = container.querySelector('#messages')!
    this.input = container.querySelector<HTMLTextAreaElement>('#input')!
    this.sendBtn = container.querySelector<HTMLButtonElement>('#send-btn')!

    // Event listeners
    container.querySelector('#toggle')!.addEventListener('click', () => this.toggle())
    container.querySelector('#close-btn')!.addEventListener('click', () => this.toggle(false))
    this.sendBtn.addEventListener('click', () => this.submit())
    this.input.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent
      if (ke.key === 'Enter' && !ke.shiftKey) {
        ke.preventDefault()
        this.submit()
      }
    })
    this.input.addEventListener('input', () => {
      this.sendBtn.disabled = !this.input.value.trim() || this.sending
      this.input.style.height = 'auto'
      this.input.style.height = `${Math.min(this.input.scrollHeight, 100)}px`
    })

    // Welcome message
    this.appendBotMessage(welcomeMessage)
  }

  private toggle(force?: boolean) {
    this.open = force !== undefined ? force : !this.open
    this.panel.classList.toggle('hidden', !this.open)
    if (this.open) {
      this.input.focus()
      this.scrollToBottom()
      this.openFeed()
    } else {
      this.closeFeed()
    }
  }

  private openFeed() {
    if (this.eventSource || this.feedSuspended || !this.open) return
    const url =
      `${API_BASE}/widget/conversations/${this.conversationId}/events` +
      `?channelId=${encodeURIComponent(CHANNEL_ID)}&visitorId=${encodeURIComponent(this.visitorId)}`
    const es = new EventSource(url)
    this.eventSource = es

    es.onopen = () => {
      this.reconnectDelay = 1000
    }

    es.addEventListener('message', (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as { id: string; role: string; content: string }
      if (this.renderedIds.has(msg.id)) return
      this.renderedIds.add(msg.id)
      this.appendBotMessage(msg.content)
    })

    es.addEventListener('status', (e: MessageEvent) => {
      const { status } = JSON.parse(e.data) as { status: string }
      if (status === 'human') this.appendSystemNote("You're now chatting with a human")
      else if (status === 'resolved') this.appendSystemNote('This conversation has been resolved')
    })

    es.onerror = () => {
      // Read readyState before we close() it ourselves — close() forces CLOSED
      // synchronously, which would erase the signal. Per spec, a fatal error
      // (e.g. 404 — no conversation yet) leaves readyState CLOSED when `error`
      // fires; a transient/retryable error leaves it CONNECTING.
      const wasFatal = es.readyState === EventSource.CLOSED
      es.close()
      this.eventSource = null
      if (wasFatal && this.reconnectDelay === 1000) {
        // never connected (e.g. 404 — no conversation yet): wait for the next send
        this.feedSuspended = true
        return
      }
      if (!this.open) return
      this.reconnectTimer = setTimeout(() => this.openFeed(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
    }
  }

  private closeFeed() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.eventSource?.close()
    this.eventSource = null
  }

  private appendSystemNote(text: string) {
    const div = document.createElement('div')
    div.className = 'msg system'
    div.textContent = text
    this.messages.appendChild(div)
    this.scrollToBottom()
  }

  private appendMessage(text: string, role: 'user' | 'bot' | 'error'): HTMLElement {
    const div = document.createElement('div')
    div.className = `msg ${role}`
    div.textContent = text
    this.messages.appendChild(div)
    this.scrollToBottom()
    return div
  }

  private appendBotMessage(text: string) {
    return this.appendMessage(text, 'bot')
  }

  private showTyping(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'typing'
    div.innerHTML = '<span></span><span></span><span></span>'
    this.messages.appendChild(div)
    this.scrollToBottom()
    return div
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      this.messages.scrollTop = this.messages.scrollHeight
    })
  }

  private async submit() {
    const text = this.input.value.trim()
    if (!text || this.sending) return

    this.sending = true
    this.sendBtn.disabled = true
    this.input.value = ''
    this.input.style.height = 'auto'

    this.appendMessage(text, 'user')
    const typingEl = this.showTyping()
    let bubble: HTMLElement | null = null

    try {
      await sendMessageStream(text, this.conversationId, this.visitorId, {
        onChunk: (chunk) => {
          if (!bubble) {
            typingEl.remove()
            bubble = this.appendBotMessage('')
          }
          bubble.textContent += chunk
          this.scrollToBottom()
        },
        onDone: (done) => {
          this.renderedIds.add(done.messageId)
          this.feedSuspended = false
          this.openFeed()
          if (!bubble) {
            // model produced no chunks (empty reply) — show something sane
            typingEl.remove()
            this.appendMessage('Sorry, I could not generate a response.', 'error')
          }
        },
      })
    } catch {
      typingEl.remove()
      if (!bubble) this.appendMessage('Sorry, something went wrong. Please try again.', 'error')
    } finally {
      this.sending = false
      this.sendBtn.disabled = !this.input.value.trim()
    }
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  try {
    const config = await fetchConfig()
    const host = document.createElement('div')
    host.id = 'ayooda-widget-host'
    document.body.appendChild(host)
    new AyoodaWidget(host, config)
  } catch (err) {
    console.error('[Ayooda] Failed to initialize widget:', err)
  }
}
