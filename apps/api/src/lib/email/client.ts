const API = 'https://api.resend.com'

export interface SendEmailInput {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
  html?: string
  /** Message-ID of the inbound email we are replying to (for threading). */
  inReplyTo?: string
}

export interface ReceivedEmail {
  id: string
  from: string
  to: string[]
  subject: string
  text: string | null
  html: string | null
  message_id?: string
  in_reply_to?: string
  headers?: Record<string, string>
}

async function call(apiKey: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init?.headers ?? {}) },
  })
  return res
}

/** Send a plain-text email. Throws with the provider's error on failure. */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const body: Record<string, unknown> = {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
  }
  if (input.inReplyTo) {
    body.headers = { 'In-Reply-To': input.inReplyTo, 'References': input.inReplyTo }
  }

  const res = await call(input.apiKey, '/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Resend send failed (${res.status}): ${text.slice(0, 200)}`)
  }
}

/** Retrieve a received email's full content (the webhook carries only metadata). */
export async function getReceivedEmail(apiKey: string, emailId: string): Promise<ReceivedEmail> {
  const res = await call(apiKey, `/emails/receiving/${encodeURIComponent(emailId)}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Resend retrieve failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return (await res.json()) as ReceivedEmail
}

/** Validate a Resend API key by listing domains (200 ⇒ the key is usable). */
export async function assertValidApiKey(apiKey: string): Promise<void> {
  const res = await call(apiKey, '/domains')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Invalid Resend API key (${res.status}): ${text.slice(0, 200)}`)
  }
}
