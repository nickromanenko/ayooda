const API = 'https://api.telegram.org'

interface TgResponse<T> { ok: boolean; result?: T; description?: string }

async function call<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as TgResponse<T>
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`)
  }
  return data.result as T
}

export interface BotInfo { id: number; username: string; first_name: string }

/** GET-style with no body; Telegram accepts POST for all methods, so reuse call(). */
export function getMe(token: string): Promise<BotInfo> {
  return call<BotInfo>(token, 'getMe')
}

export function setWebhook(token: string, url: string, secretToken: string): Promise<boolean> {
  return call<boolean>(token, 'setWebhook', { url, secret_token: secretToken, allowed_updates: ['message'] })
}

export function deleteWebhook(token: string): Promise<boolean> {
  return call<boolean>(token, 'deleteWebhook', {})
}

export function sendMessage(token: string, chatId: number, text: string): Promise<{ message_id: number }> {
  return call<{ message_id: number }>(token, 'sendMessage', { chat_id: chatId, text })
}
