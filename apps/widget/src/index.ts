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
import { escapeHtmlAttribute, safeAgentPhotoURL } from './identity'
import { renderMarkdown } from './markdown'
import { MessageBuffer, type FeedMessage } from './message-buffer'
import { resolveWidgetLocale, widgetStrings, type WidgetStrings } from './strings'
import { widgetAccessibleAccent, widgetForeground, type WidgetAppearance } from '@ayooda/shared'

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

interface WidgetConfig extends WidgetAppearance {
  agentName: string
  agentPhotoURL: string | null
}

interface ChatDone {
  conversationId: string
  messageId?: string
  sources: Array<{ docId: string; source: string; score: number }>
  status?: 'bot' | 'waiting' | 'human' | 'resolved'
  workflowAction?: string
}

interface ConversationHistory {
  messages: FeedMessage[]
  status: 'bot' | 'waiting' | 'human' | 'resolved'
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

function getConversationId(config: WidgetConfig): string {
  if (config.conversationPersistence === 'fresh') return crypto.randomUUID()
  const key = `ayooda_conv_${CHANNEL_ID}`
  const storage = config.conversationPersistence === 'visitor' ? localStorage : sessionStorage
  let id = storage.getItem(key)
  if (config.conversationPersistence === 'visitor') {
    const expiresAt = Number(localStorage.getItem(`${key}_expires`))
    if (!expiresAt || Date.now() > expiresAt) id = null
  }
  if (!id) {
    id = crypto.randomUUID()
    storage.setItem(key, id)
    if (config.conversationPersistence === 'visitor') {
      localStorage.setItem(`${key}_expires`, String(Date.now() + config.persistenceDays * 86_400_000))
    }
  }
  return id
}

function createConversationId(config: WidgetConfig): string {
  const id = crypto.randomUUID()
  if (config.conversationPersistence !== 'fresh') {
    const storage = config.conversationPersistence === 'visitor' ? localStorage : sessionStorage
    const key = `ayooda_conv_${CHANNEL_ID}`
    storage.setItem(key, id)
    if (config.conversationPersistence === 'visitor') {
      localStorage.setItem(`${key}_expires`, String(Date.now() + config.persistenceDays * 86_400_000))
    }
  }
  return id
}

function matchesPath(pathname: string, rule: string): boolean {
  const escaped = rule.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`).test(pathname)
}

function shouldRender(config: WidgetConfig): boolean {
  const mobile = window.matchMedia('(max-width: 600px)').matches
  if ((mobile && !config.showOnMobile) || (!mobile && !config.showOnDesktop)) return false
  const path = window.location.pathname
  if (config.includePaths.length && !config.includePaths.some((rule) => matchesPath(path, rule))) return false
  return !config.excludePaths.some((rule) => matchesPath(path, rule))
}

function observeWidgetVisibility(host: HTMLElement, config: WidgetConfig) {
  const update = () => { host.style.display = shouldRender(config) ? '' : 'none' }
  update()
  window.addEventListener('popstate', update)
  window.addEventListener('ayooda:navigation', update)
  window.matchMedia('(max-width: 600px)').addEventListener('change', update)
  const marker = '__ayoodaNavigationPatched'
  const markedHistory = history as History & { [marker]?: boolean }
  if (!markedHistory[marker]) {
    markedHistory[marker] = true
    const pushState = history.pushState.bind(history)
    const replaceState = history.replaceState.bind(history)
    history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
      pushState(data, unused, url)
      window.dispatchEvent(new Event('ayooda:navigation'))
    }
    history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
      replaceState(data, unused, url)
      window.dispatchEvent(new Event('ayooda:navigation'))
    }
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchConfig(): Promise<WidgetConfig> {
  const res = await fetch(`${API_BASE}/widget/config/${CHANNEL_ID}`)
  if (!res.ok) throw new Error('Failed to load widget config')
  return res.json()
}

async function fetchHistory(conversationId: string, visitorId: string): Promise<ConversationHistory | null> {
  const url = `${API_BASE}/widget/conversations/${conversationId}/messages` +
    `?channelId=${encodeURIComponent(CHANNEL_ID)}&visitorId=${encodeURIComponent(visitorId)}`
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to load conversation history')
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
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(payload.error ?? `Request failed (${res.status})`)
    }
    if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream')) {
      throw new Error('The server returned an invalid response.')
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

function buildCSS(config: WidgetConfig): string {
  const { widgetColor: color, widgetPosition: position, horizontalOffset, verticalOffset, theme } = config
  // The panel and launcher hug whichever edge the widget is pinned to, so a
  // left-hand widget opens leftwards instead of off the side of the viewport.
  const left = position === 'bottom-left'
  const foreground = widgetForeground(color)
  const accent = widgetAccessibleAccent(color)
  const darkVariables = `--aw-panel:#18181b;--aw-panel-soft:#27272a;--aw-ink:#fafafa;--aw-ink-muted:#a1a1aa;--aw-line:#3f3f46;--aw-bot:#27272a;--aw-code:#09090b;`
  const lightVariables = `--aw-panel:#fff;--aw-panel-soft:#fafafa;--aw-ink:#18181b;--aw-ink-muted:#71717a;--aw-line:#e4e4e7;--aw-bot:#f4f4f5;--aw-code:#27272a;`
  return `
    :host { all: initial; font-family: system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; ${theme === 'dark' ? darkVariables : lightVariables} }
    ${theme === 'auto' ? `@media (prefers-color-scheme: dark) { :host { ${darkVariables} } }` : ''}

    #container {
      position: fixed;
      bottom: max(${verticalOffset}px, env(safe-area-inset-bottom));
      ${left ? `left: max(${horizontalOffset}px, env(safe-area-inset-left));` : `right: max(${horizontalOffset}px, env(safe-area-inset-right));`}
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: ${left ? 'flex-start' : 'flex-end'};
      gap: 12px;
    }

    #toggle {
      width: 52px;
      height: 52px;
      box-sizing: border-box;
      padding: 0;
      border-radius: 50%;
      background: ${color};
      border: none;
      cursor: pointer;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${foreground};
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      transition-property: transform, background-color, box-shadow;
      transition-duration: 180ms;
      transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
      flex-shrink: 0;
    }
    @media (hover: hover) {
      #toggle:hover {
        background: color-mix(in srgb, ${color} 82%, #000);
        transform: translateY(-2px) scale(1.04);
        box-shadow:
          0 0 0 8px color-mix(in srgb, ${color} 14%, transparent),
          0 12px 28px rgba(0,0,0,0.28);
      }
    }
    #toggle:focus-visible {
      outline: none;
      box-shadow:
        0 0 0 4px #fff,
        0 0 0 7px color-mix(in srgb, ${color} 70%, transparent),
        0 8px 24px rgba(0,0,0,0.24);
    }
    #toggle:active { transform: translateY(0) scale(0.96); }
    #toggle svg { width: 24px; height: 24px; fill: currentColor; }
    #unread-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 18px;
      height: 18px;
      box-sizing: border-box;
      border: 2px solid #fff;
      border-radius: 999px;
      padding: 0 4px;
      background: #dc2626;
      color: #fff;
      font: 700 10px/14px system-ui, -apple-system, sans-serif;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    #unread-badge[hidden] { display: none; }
    .toggle-icon {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      opacity: 1;
      transform: scale(1);
      filter: blur(0);
      transition-property: opacity, transform, filter;
      transition-duration: 180ms;
      transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }
    .toggle-close {
      opacity: 0;
      transform: scale(0.25);
      filter: blur(4px);
    }
    #toggle[aria-expanded="true"] .toggle-chat {
      opacity: 0;
      transform: scale(0.25);
      filter: blur(4px);
    }
    #toggle[aria-expanded="true"] .toggle-close {
      opacity: 1;
      transform: scale(1);
      filter: blur(0);
    }

    #panel {
      width: 360px;
      height: min(520px, calc(100dvh - 100px));
      min-height: 360px;
      background: var(--aw-panel);
      color: var(--aw-ink);
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.16);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      visibility: visible;
      transition-property: opacity, transform, visibility;
      transition-duration: 200ms, 200ms, 0s;
      transition-delay: 0s;
      transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }
    #panel.hidden {
      opacity: 0;
      pointer-events: none;
      visibility: hidden;
      transform: translateY(12px) scale(0.97);
      transition-duration: 150ms, 150ms, 0s;
      transition-delay: 0s, 0s, 150ms;
    }

    /* Header */
    #header {
      background: ${color};
      color: ${foreground};
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
      background: color-mix(in srgb, ${foreground} 18%, transparent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      flex-shrink: 0;
      overflow: hidden;
      box-shadow:
        0 0 0 4px color-mix(in srgb, ${foreground} 22%, transparent),
        0 3px 10px rgba(0,0,0,0.16);
    }
    #avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      outline: 1px solid color-mix(in srgb, ${foreground} 12%, transparent);
      outline-offset: -1px;
    }
    #agent-identity { flex: 1; min-width: 0; }
    #agent-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; }
    #agent-status { display: block; margin-top: 2px; font-size: 11px; opacity: .78; }
    #header-actions { display: flex; align-items: center; gap: 2px; }
    #close-btn,
    #new-chat-btn {
      width: 40px;
      height: 40px;
      background: none;
      border: none;
      color: color-mix(in srgb, ${foreground} 82%, transparent);
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition-property: background-color, color, transform;
      transition-duration: 150ms;
      transition-timing-function: ease-out;
    }
    #close-btn:hover,
    #new-chat-btn:hover { color: ${foreground}; background: color-mix(in srgb, ${foreground} 15%, transparent); }
    #close-btn:focus-visible,
    #new-chat-btn:focus-visible { outline: 2px solid ${foreground}; outline-offset: 2px; }
    #close-btn:active,
    #new-chat-btn:active { transform: scale(0.96); }

    /* Messages */
    #message-stage { position: relative; flex: 1; min-height: 0; }
    #messages {
      position: absolute;
      inset: 0;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scroll-behavior: smooth;
    }
    #messages::-webkit-scrollbar { width: 4px; }
    #messages::-webkit-scrollbar-thumb { background: var(--aw-line); border-radius: 2px; }
    #jump-latest {
      position: absolute;
      left: 50%;
      bottom: 12px;
      z-index: 2;
      min-height: 36px;
      transform: translateX(-50%);
      border: none;
      border-radius: 999px;
      padding: 0 13px;
      background: var(--aw-panel);
      color: var(--aw-ink);
      box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 5px 16px rgba(0,0,0,0.14);
      cursor: pointer;
      font: 600 11px/1 system-ui, -apple-system, sans-serif;
      transition-property: transform, box-shadow;
      transition-duration: 150ms;
      transition-timing-function: ease-out;
    }
    #jump-latest[hidden] { display: none; }
    #jump-latest:hover { transform: translateX(-50%) translateY(-1px); box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 7px 20px rgba(0,0,0,0.18); }
    #jump-latest:active { transform: translateX(-50%) scale(0.96); }

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
      color: ${foreground};
      border-bottom-right-radius: 4px;
    }
    .msg.bot {
      align-self: flex-start;
      background: var(--aw-bot);
      color: var(--aw-ink);
      border-bottom-left-radius: 4px;
      white-space: normal;
    }
    .msg.bot > :first-child { margin-top: 0; }
    .msg.bot > :last-child { margin-bottom: 0; }
    .msg.bot p { margin: 0 0 10px; }
    .msg.bot ul,
    .msg.bot ol { margin: 7px 0 10px; padding-left: 20px; }
    .msg.bot ul { list-style: disc outside; }
    .msg.bot ol { list-style: decimal outside; }
    .msg.bot li { display: list-item; margin: 3px 0; padding-left: 1px; }
    .msg.bot li > p { margin: 0; }
    .msg.bot strong { font-weight: 700; }
    .msg.bot em { font-style: italic; }
    .msg.bot a {
      color: ${accent};
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
    }
    .msg.bot code {
      border-radius: 4px;
      background: rgba(0,0,0,0.07);
      padding: 1px 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.88em;
    }
    .msg.bot pre {
      margin: 8px 0 10px;
      overflow-x: auto;
      border-radius: 8px;
      background: var(--aw-code);
      color: #fafafa;
      padding: 10px 12px;
      white-space: pre;
    }
    .msg.bot pre code { background: transparent; padding: 0; color: inherit; }
    .msg.bot blockquote {
      margin: 8px 0 10px;
      border-left: 3px solid color-mix(in srgb, ${accent} 55%, transparent);
      padding-left: 10px;
      color: var(--aw-ink-muted);
    }
    .msg.bot h1,
    .msg.bot h2,
    .msg.bot h3,
    .msg.bot h4 { margin: 12px 0 6px; line-height: 1.25; font-weight: 700; }
    .msg.bot h1 { font-size: 1.2em; }
    .msg.bot h2 { font-size: 1.12em; }
    .msg.bot h3,
    .msg.bot h4 { font-size: 1em; }
    .msg.bot table {
      display: block;
      width: max-content;
      max-width: 100%;
      margin: 8px 0 10px;
      overflow-x: auto;
      border-collapse: collapse;
      font-size: 0.9em;
    }
    .msg.bot th,
    .msg.bot td { border: 1px solid var(--aw-line); padding: 5px 7px; text-align: left; }
    .msg.bot th { background: rgba(0,0,0,0.04); font-weight: 700; }
    .msg.bot hr { margin: 12px 0; border: 0; border-top: 1px solid var(--aw-line); }
    .msg.error {
      align-self: flex-start;
      background: #fef2f2;
      color: #dc2626;
      border-bottom-left-radius: 4px;
    }
    .retry-btn {
      display: block;
      min-height: 36px;
      margin-top: 8px;
      border: 1px solid currentColor;
      border-radius: 8px;
      padding: 0 11px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: 600 12px/1 system-ui, -apple-system, sans-serif;
    }
    .retry-btn:hover { background: rgba(220,38,38,.08); }
    .retry-btn:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    .msg.system {
      align-self: center;
      background: transparent;
      color: var(--aw-ink-muted);
      font-size: 12px;
      padding: 2px 8px;
    }

    /* Typing indicator */
    .typing {
      align-self: flex-start;
      background: var(--aw-bot);
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
      background: var(--aw-ink-muted);
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
      border-top: 1px solid var(--aw-line);
      flex-shrink: 0;
      background: var(--aw-panel);
    }
    #composer {
      position: relative;
      border-radius: 18px;
      background: var(--aw-panel);
      box-shadow:
        0 0 0 1px rgba(0,0,0,0.12),
        0 2px 5px rgba(0,0,0,0.04);
      transition-property: box-shadow;
      transition-duration: 180ms;
      transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }
    #composer:focus-within {
      box-shadow:
        0 0 0 2px ${accent},
        0 0 0 6px color-mix(in srgb, ${color} 13%, transparent),
        0 4px 12px rgba(0,0,0,0.08);
    }
    #input {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-height: 88px;
      max-height: 136px;
      border: none;
      border-radius: 18px;
      padding: 14px 52px 40px 14px;
      font-size: 14px;
      font-family: inherit;
      resize: none;
      outline: none;
      color: var(--aw-ink);
      background: var(--aw-panel);
      line-height: 1.45;
    }
    #input::placeholder { color: var(--aw-ink-muted); }
    #composer-hint {
      position: absolute;
      left: 14px;
      bottom: 13px;
      color: var(--aw-ink-muted);
      font-size: 10px;
      line-height: 1;
      pointer-events: none;
    }

    #send-btn {
      position: absolute;
      right: 7px;
      bottom: 7px;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: transparent;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${accent};
      transition-property: background-color, color, transform;
      transition-duration: 150ms;
      transition-timing-function: ease-out;
    }
    #send-btn:hover:not(:disabled) {
      background: color-mix(in srgb, ${color} 12%, transparent);
    }
    #send-btn:focus-visible { outline: 2px solid ${accent}; outline-offset: 1px; }
    #send-btn:active:not(:disabled) {
      transform: scale(0.96);
    }
    #send-btn:disabled { color: #c4c4cc; cursor: not-allowed; }
    #send-btn svg { width: 20px; height: 20px; fill: currentColor; }
    #panel[dir="rtl"] #input { padding: 14px 14px 40px 52px; }
    #panel[dir="rtl"] #send-btn { left: 7px; right: auto; }
    #panel[dir="rtl"] #composer-hint { left: auto; right: 14px; }
    #panel[dir="rtl"] .msg.bot blockquote { border-left: 0; border-right: 3px solid color-mix(in srgb, ${accent} 55%, transparent); padding-left: 0; padding-right: 10px; }

    /* Powered-by */
    #poweredby {
      text-align: center;
      font-size: 11px;
      color: var(--aw-ink-muted);
      padding: 6px 0 10px;
      flex-shrink: 0;
    }
    #poweredby a { color: var(--aw-ink-muted); text-decoration: none; }
    #poweredby a:hover { color: var(--aw-ink); }

    #launcher-greeting {
      max-width: 240px;
      border: 0;
      border-radius: 14px;
      padding: 10px 13px;
      background: var(--aw-panel);
      color: var(--aw-ink);
      box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 6px 20px rgba(0,0,0,.14);
      cursor: pointer;
      font: 500 13px/1.4 system-ui, -apple-system, sans-serif;
      text-align: left;
      opacity: 1;
      transform: translateY(0);
      transition-property: opacity, transform;
      transition-duration: 180ms;
      transition-timing-function: cubic-bezier(0.2,0,0,1);
    }
    #launcher-greeting[hidden] { display: none; }
    #launcher-greeting.dismissed { opacity: 0; transform: translateY(6px); pointer-events: none; }

    @media (max-width: 480px) {
      #container {
        left: max(12px, env(safe-area-inset-left));
        right: max(12px, env(safe-area-inset-right));
        bottom: max(12px, env(safe-area-inset-bottom));
      }
      #panel {
        width: 100%;
        height: min(520px, calc(100dvh - 88px));
        min-height: min(360px, calc(100dvh - 88px));
      }
      #close-btn,
      #new-chat-btn,
      #send-btn { width: 44px; height: 44px; }
      #composer-hint { font-size: 11px; }
    }

    @media (prefers-reduced-motion: reduce) {
      #toggle, .toggle-icon, #panel, #composer, #send-btn, .typing span { transition: none; animation: none; }
    }
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

const ICON_NEW_CHAT = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>
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
  private toggleBtn!: HTMLButtonElement
  private open = false
  private sending = false
  private conversationId: string
  private visitorId: string
  private config: WidgetConfig
  private strings: WidgetStrings
  private messageBuffer = new MessageBuffer()
  private jumpLatestBtn!: HTMLButtonElement
  private unreadBadge!: HTMLElement
  private statusText!: HTMLElement
  private historyReady: Promise<void>
  private unreadCount = 0
  private eventSource: EventSource | null = null
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private feedSuspended = false // set on immediate failure (conversation may not exist yet)
  private openTracked = false

  constructor(host: HTMLElement, config: WidgetConfig) {
    this.config = config
    this.strings = widgetStrings(config.locale, navigator.language)
    this.conversationId = getConversationId(config)
    this.visitorId = getVisitorId()

    this.shadow = host.attachShadow({ mode: 'open' })
    this.build()
    this.historyReady = this.loadHistory()
    this.setupProactiveBehavior()
  }

  private build() {
    const { agentName, agentPhotoURL, privacyPolicyURL, privacyNotice, launcherGreeting } = this.config
    const photoURL = safeAgentPhotoURL(agentPhotoURL)
    const escapedAgentName = escapeHtmlAttribute(agentName)
    const escapedInitial = escapeHtmlAttribute(agentName.charAt(0).toUpperCase())
    const escapedPhotoURL = photoURL ? escapeHtmlAttribute(photoURL) : null
    const escapedHeaderTitle = escapeHtmlAttribute(this.config.headerTitle || agentName)
    const escapedStatus = escapeHtmlAttribute(this.config.statusText || this.strings.online)
    const escapedPlaceholder = escapeHtmlAttribute(this.config.inputPlaceholder || this.strings.compose)
    const escapedGreeting = escapeHtmlAttribute(launcherGreeting)
    const escapedPrivacyNotice = escapeHtmlAttribute(privacyNotice)
    const escapedPrivacyURL = privacyPolicyURL ? escapeHtmlAttribute(privacyPolicyURL) : ''
    // Absent on responses from an older API: show the line rather than hide it.
    const showBranding = this.config.showBranding !== false

    const style = document.createElement('style')
    style.textContent = buildCSS(this.config)
    this.shadow.appendChild(style)

    const container = document.createElement('div')
    container.id = 'container'
    container.innerHTML = `
      <div id="panel" class="hidden" dir="${resolveWidgetLocale(this.config.locale, navigator.language) === 'ar' ? 'rtl' : 'ltr'}" role="dialog" aria-labelledby="agent-name" aria-hidden="true" inert>
        <div id="header">
          <div id="avatar">
            ${
              escapedPhotoURL
                ? `<img src="${escapedPhotoURL}" alt="" />`
                : escapedInitial
            }
          </div>
          <span id="agent-identity"><span id="agent-name">${escapedHeaderTitle}</span><span id="agent-status" role="status">${escapedStatus}</span></span>
          <span id="header-actions">
            <button id="new-chat-btn" type="button" aria-label="${escapeHtmlAttribute(this.strings.newConversation)}">${ICON_NEW_CHAT}</button>
            <button id="close-btn" type="button" aria-label="${escapeHtmlAttribute(this.strings.close)}">${ICON_CLOSE}</button>
          </span>
        </div>
        <div id="message-stage">
          <div id="messages" role="log" aria-live="polite" dir="auto"></div>
          <button id="jump-latest" type="button" hidden>${escapeHtmlAttribute(this.strings.newMessages)}</button>
        </div>
        <div id="input-area">
          <div id="composer">
            <textarea
              id="input"
              rows="1"
              placeholder="${escapedPlaceholder}"
              aria-label="Chat message"
              dir="auto"
            ></textarea>
            <span id="composer-hint" aria-hidden="true">${escapeHtmlAttribute(this.strings.inputHint)}</span>
            <button id="send-btn" type="button" aria-label="${escapeHtmlAttribute(this.strings.send)}" disabled>${ICON_SEND}</button>
          </div>
        </div>
        ${(showBranding || escapedPrivacyNotice || escapedPrivacyURL) ? `<div id="poweredby">${escapedPrivacyNotice ? `<span>${escapedPrivacyNotice}</span> ` : ''}${escapedPrivacyURL ? `<a href="${escapedPrivacyURL}" target="_blank" rel="noopener noreferrer">${escapeHtmlAttribute(this.strings.privacy)}</a>${showBranding ? ' · ' : ''}` : ''}${showBranding ? `${escapeHtmlAttribute(this.strings.poweredBy)} <a href="https://ayooda.live" target="_blank" rel="noopener noreferrer">Ayooda</a>` : ''}</div>` : ''}
      </div>
      ${launcherGreeting ? `<button id="launcher-greeting" type="button" hidden>${escapedGreeting}</button>` : ''}
      <button id="toggle" type="button" aria-label="${escapeHtmlAttribute(this.strings.openChat)} ${escapedAgentName}" aria-expanded="false" aria-controls="panel">
        <span class="toggle-icon toggle-chat" aria-hidden="true">${ICON_CHAT}</span>
        <span class="toggle-icon toggle-close" aria-hidden="true">${ICON_CLOSE}</span>
        <span id="unread-badge" hidden aria-label="Unread messages"></span>
      </button>
    `
    this.shadow.appendChild(container)

    // Refs
    this.panel = container.querySelector('#panel')!
    this.messages = container.querySelector('#messages')!
    this.input = container.querySelector<HTMLTextAreaElement>('#input')!
    this.sendBtn = container.querySelector<HTMLButtonElement>('#send-btn')!
    this.toggleBtn = container.querySelector<HTMLButtonElement>('#toggle')!
    this.jumpLatestBtn = container.querySelector<HTMLButtonElement>('#jump-latest')!
    this.unreadBadge = container.querySelector<HTMLElement>('#unread-badge')!
    this.statusText = container.querySelector<HTMLElement>('#agent-status')!
    container.querySelector('#launcher-greeting')?.addEventListener('click', () => this.toggle(true))

    // Event listeners
    this.toggleBtn.addEventListener('click', () => this.toggle())
    container.querySelector('#close-btn')!.addEventListener('click', () => this.toggle(false))
    container.querySelector('#new-chat-btn')!.addEventListener('click', () => this.startNewConversation())
    container.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape' && this.open) {
        event.preventDefault()
        this.toggle(false)
      }
    })
    this.sendBtn.addEventListener('click', () => this.submit())
    this.jumpLatestBtn.addEventListener('click', () => this.scrollToBottom(true))
    this.messages.addEventListener('scroll', () => {
      if (this.isNearBottom()) this.jumpLatestBtn.hidden = true
    }, { passive: true })
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
      this.input.style.height = `${Math.max(88, Math.min(this.input.scrollHeight, 136))}px`
    })
  }

  private async loadHistory() {
    try {
      const history = await fetchHistory(this.conversationId, this.visitorId)
      if (!history?.messages.length) {
        this.appendBotMessage(this.config.welcomeMessage, true)
      } else {
        for (const message of history.messages) {
          this.messageBuffer.markRendered(message.id)
          this.appendMessage(message.content, message.role === 'user' ? 'user' : 'bot', true)
        }
        if (history.status === 'human') this.appendSystemNote(this.strings.human, true)
        else if (history.status === 'waiting') this.appendSystemNote(this.strings.waiting, true)
        else if (history.status === 'resolved') this.appendSystemNote(this.strings.resolved, true)
      }
      this.openFeed()
    } catch {
      this.appendBotMessage(this.config.welcomeMessage, true)
    }
  }

  private toggle(force?: boolean) {
    this.open = force !== undefined ? force : !this.open
    this.panel.toggleAttribute('inert', !this.open)
    this.panel.setAttribute('aria-hidden', String(!this.open))
    this.panel.classList.toggle('hidden', !this.open)
    this.toggleBtn.setAttribute('aria-expanded', String(this.open))
    if (this.open) {
      if (!this.openTracked) {
        this.openTracked = true
        this.recordEvent('open')
      }
      const greeting = this.shadow.querySelector<HTMLElement>('#launcher-greeting')
      if (greeting) {
        greeting.classList.add('dismissed')
        setTimeout(() => { greeting.hidden = true }, 180)
      }
      this.setUnreadCount(0)
      this.input.focus()
      this.scrollToBottom(true)
      this.openFeed()
    } else {
      this.setUnreadCount(this.unreadCount)
      this.toggleBtn.focus({ preventScroll: true })
    }
  }

  private recordEvent(event: 'open' | 'conversation_started') {
    void fetch(`${API_BASE}/widget/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: CHANNEL_ID, event }),
      keepalive: true,
    }).catch(() => {})
  }

  private setupProactiveBehavior() {
    if (this.config.launcherGreeting) {
      setTimeout(() => {
        if (this.open) return
        const greeting = this.shadow.querySelector<HTMLElement>('#launcher-greeting')
        if (greeting) greeting.hidden = false
      }, this.config.launcherGreetingDelaySeconds * 1000)
    }
    if (this.config.autoOpenDelaySeconds > 0) {
      const key = `ayooda_auto_opened_${CHANNEL_ID}`
      if (!this.config.autoOpenOncePerSession || !sessionStorage.getItem(key)) {
        setTimeout(() => {
          if (this.open) return
          this.toggle(true)
          sessionStorage.setItem(key, '1')
        }, this.config.autoOpenDelaySeconds * 1000)
      }
    }
  }

  private startNewConversation() {
    if (this.sending) return
    this.eventSource?.close()
    this.eventSource = null
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.conversationId = createConversationId(this.config)
    this.messageBuffer = new MessageBuffer()
    this.feedSuspended = true
    this.messages.replaceChildren()
    this.setUnreadCount(0)
    this.setStatus('online')
    this.appendBotMessage(this.config.welcomeMessage, true)
    this.input.focus()
  }

  private openFeed() {
    if (this.eventSource || this.feedSuspended) return
    const url =
      `${API_BASE}/widget/conversations/${this.conversationId}/events` +
      `?channelId=${encodeURIComponent(CHANNEL_ID)}&visitorId=${encodeURIComponent(this.visitorId)}`
    const es = new EventSource(url)
    this.eventSource = es

    es.onopen = () => {
      this.reconnectDelay = 1000
      if (!this.sending) this.setStatus('online')
    }

    es.addEventListener('message', (e: MessageEvent) => {
      const message = JSON.parse(e.data) as FeedMessage
      for (const ready of this.messageBuffer.accept(message, this.sending)) {
        this.appendBotMessage(ready.content)
        this.playNotification()
        if (!this.open) this.setUnreadCount(this.unreadCount + 1)
      }
    })

    es.addEventListener('status', (e: MessageEvent) => {
      const { status } = JSON.parse(e.data) as { status: string }
      if (status === 'human') this.appendSystemNote(this.strings.human)
      else if (status === 'resolved') this.appendSystemNote(this.strings.resolved)
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
      if (this.open) this.setStatus('reconnecting')
      this.reconnectTimer = setTimeout(() => this.openFeed(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
    }
  }

  private setUnreadCount(count: number) {
    this.unreadCount = count
    this.unreadBadge.hidden = count === 0
    this.unreadBadge.textContent = count > 9 ? '9+' : String(count)
    this.toggleBtn.setAttribute(
      'aria-label',
      this.open ? this.strings.closeChat : `${count ? `${count} ${this.strings.unread}. ` : ''}${this.strings.openChat} ${this.config.agentName}`,
    )
  }

  private isNearBottom() {
    return this.messages.scrollHeight - this.messages.scrollTop - this.messages.clientHeight < 56
  }

  private appendSystemNote(text: string, forceScroll = false) {
    const stick = forceScroll || this.isNearBottom()
    const div = document.createElement('div')
    div.className = 'msg system'
    div.textContent = text
    this.messages.appendChild(div)
    this.afterContentChange(stick)
  }

  private appendMessage(text: string, role: 'user' | 'bot' | 'error', forceScroll = false): HTMLElement {
    const stick = forceScroll || role === 'user' || this.isNearBottom()
    const div = document.createElement('div')
    div.className = `msg ${role}`
    if (role === 'bot') this.renderBotMarkdown(div, text)
    else div.textContent = text
    this.messages.appendChild(div)
    this.afterContentChange(stick)
    return div
  }

  private renderBotMarkdown(element: HTMLElement, markdown: string) {
    element.innerHTML = renderMarkdown(markdown)
    element.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
    })
  }

  private appendBotMessage(text: string, forceScroll = false) {
    return this.appendMessage(text, 'bot', forceScroll)
  }

  private appendRetryError(message: string, originalText: string) {
    const element = this.appendMessage(message, 'error')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'retry-btn'
    button.textContent = this.strings.retry
    button.addEventListener('click', () => {
      element.remove()
      void this.submit(originalText, false)
    })
    element.appendChild(button)
  }

  private setStatus(status: 'online' | 'responding' | 'reconnecting') {
    this.statusText.textContent = status === 'responding'
      ? this.strings.responding
      : status === 'reconnecting'
        ? this.strings.reconnecting
        : (this.config.statusText || this.strings.online)
  }

  private playNotification() {
    if (!this.config.soundEnabled || this.open) return
    try {
      const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const context = new AudioContextClass()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = 660
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.14)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.15)
      oscillator.addEventListener('ended', () => void context.close())
    } catch { /* autoplay policies may block sound before a visitor interaction */ }
  }

  private showTyping(): HTMLElement {
    const stick = this.isNearBottom()
    const div = document.createElement('div')
    div.className = 'typing'
    div.innerHTML = '<span></span><span></span><span></span>'
    this.messages.appendChild(div)
    this.afterContentChange(stick)
    return div
  }

  private afterContentChange(stick: boolean) {
    if (stick) this.scrollToBottom(true)
    else this.jumpLatestBtn.hidden = false
  }

  private scrollToBottom(force = false) {
    requestAnimationFrame(() => {
      if (force || this.isNearBottom()) {
        this.messages.scrollTop = this.messages.scrollHeight
        this.jumpLatestBtn.hidden = true
      }
    })
  }

  private async submit(retryText?: string, appendUser = true) {
    await this.historyReady
    const text = (retryText ?? this.input.value).trim()
    if (!text || this.sending) return

    this.sending = true
    this.setStatus('responding')
    this.sendBtn.disabled = true
    this.input.value = ''
    this.input.style.height = 'auto'

    if (appendUser) this.appendMessage(text, 'user')
    const startedKey = `ayooda_started_${this.conversationId}`
    if (!sessionStorage.getItem(startedKey)) {
      sessionStorage.setItem(startedKey, '1')
      this.recordEvent('conversation_started')
    }
    const typingEl = this.showTyping()
    let bubble: HTMLElement | null = null
    let streamedMarkdown = ''

    try {
      await sendMessageStream(text, this.conversationId, this.visitorId, {
        onChunk: (chunk) => {
          const stick = this.isNearBottom()
          if (!bubble) {
            typingEl.remove()
            bubble = this.appendBotMessage('')
          }
          streamedMarkdown += chunk
          this.renderBotMarkdown(bubble, streamedMarkdown)
          this.afterContentChange(stick)
        },
        onDone: (done) => {
          this.messageBuffer.markRendered(done.messageId)
          if (done.status === 'waiting') this.appendSystemNote(this.strings.waiting)
          else if (done.status === 'human') this.appendSystemNote(this.strings.human)
          else if (done.status === 'resolved') this.appendSystemNote(this.strings.resolved)
          this.feedSuspended = false
          this.openFeed()
          if (!bubble) {
            // model produced no chunks (empty reply) — show something sane
            typingEl.remove()
            this.appendMessage(this.strings.emptyResponse, 'error')
          }
        },
      })
    } catch (error) {
      typingEl.remove()
      if (!bubble) {
        const message = error instanceof DOMException && error.name === 'AbortError'
          ? this.strings.timeout
          : error instanceof Error && error.message.includes('Too many')
            ? this.strings.rateLimit
            : this.strings.sendError
        this.appendRetryError(message, text)
      }
    } finally {
      this.sending = false
      this.setStatus('online')
      for (const pending of this.messageBuffer.flush()) {
        this.appendBotMessage(pending.content)
        if (!this.open) this.setUnreadCount(this.unreadCount + 1)
      }
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
    if (!config.enabled) return
    const host = document.createElement('div')
    host.id = 'ayooda-widget-host'
    document.body.appendChild(host)
    observeWidgetVisibility(host, config)
    new AyoodaWidget(host, config)
  } catch (err) {
    console.error('[Ayooda] Failed to initialize widget:', err)
  }
}
