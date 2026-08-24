const TWILIO_API = 'https://api.twilio.com/2010-04-01'
const TWILIO_TIMEOUT_MS = 10_000
export const SMS_MESSAGE_CHUNK_LENGTH = 1_500

function basicAuth(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`
}

async function twilioRequest<T>(
  accountSid: string,
  authToken: string,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(`${TWILIO_API}${path}`, {
    ...init,
    headers: { Authorization: basicAuth(accountSid, authToken), ...init.headers },
    signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
  })
  const data = await response.json().catch(() => ({})) as T & { message?: string }
  if (!response.ok) throw new Error(data.message ?? `Twilio request failed (${response.status})`)
  return data
}

/** Verify both the account credentials and that the configured number belongs to it. */
export async function assertTwilioNumber(
  accountSid: string,
  authToken: string,
  fromNumber: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await twilioRequest(accountSid, authToken, `/Accounts/${accountSid}.json`, {}, fetchImpl)
  const query = new URLSearchParams({ PhoneNumber: fromNumber, PageSize: '1' })
  const result = await twilioRequest<{ incoming_phone_numbers?: Array<{ phone_number?: string; capabilities?: { sms?: boolean } }> }>(
    accountSid,
    authToken,
    `/Accounts/${accountSid}/IncomingPhoneNumbers.json?${query}`,
    {},
    fetchImpl,
  )
  const number = result.incoming_phone_numbers?.find((candidate) => candidate.phone_number === fromNumber)
  if (!number) throw new Error('The SMS number does not belong to this Twilio account.')
  if (number.capabilities?.sms !== true) throw new Error('The Twilio number is not SMS capable.')
}

export function splitSmsMessage(text: string, limit = SMS_MESSAGE_CHUNK_LENGTH): string[] {
  let rest = text.trim()
  if (!rest) return []
  const chunks: string[] = []
  while (rest.length > limit) {
    const paragraph = rest.lastIndexOf('\n\n', limit)
    const line = rest.lastIndexOf('\n', limit)
    const space = rest.lastIndexOf(' ', limit)
    const cut = Math.max(paragraph, line, space) > 0 ? Math.max(paragraph, line, space) : limit
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

export async function sendSms(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  for (const chunk of splitSmsMessage(text)) {
    const body = new URLSearchParams({ From: from, To: to, Body: chunk })
    await twilioRequest(
      accountSid,
      authToken,
      `/Accounts/${accountSid}/Messages.json`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
      fetchImpl,
    )
  }
}
