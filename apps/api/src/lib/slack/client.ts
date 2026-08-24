const SLACK_API = 'https://slack.com/api'
const SLACK_TIMEOUT_MS = 10_000
export const SLACK_MESSAGE_CHUNK_LENGTH = 3_900

type SlackResponse<T> = { ok?: boolean; error?: string } & T

async function call<T>(token: string, method: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  })
  const data = await response.json().catch(() => ({})) as SlackResponse<T>
  if (!response.ok || data.ok !== true) throw new Error(`Slack ${method} failed: ${data.error ?? response.status}`)
  return data
}

export interface SlackIdentity {
  teamId: string
  teamName: string
  botUserId: string
}

export async function authTest(token: string, fetchImpl: typeof fetch = fetch): Promise<SlackIdentity> {
  const data = await call<{ team_id?: string; team?: string; user_id?: string }>(token, 'auth.test', {}, fetchImpl)
  if (!data.team_id || !data.team || !data.user_id) throw new Error('Slack auth.test returned an incomplete bot identity')
  return { teamId: data.team_id, teamName: data.team, botUserId: data.user_id }
}

export function splitSlackMessage(text: string, limit = SLACK_MESSAGE_CHUNK_LENGTH): string[] {
  const remaining = text.trim()
  if (!remaining) return []
  const chunks: string[] = []
  let rest = remaining
  while (rest.length > limit) {
    const paragraph = rest.lastIndexOf('\n\n', limit)
    const line = rest.lastIndexOf('\n', limit)
    const space = rest.lastIndexOf(' ', limit)
    const preferredCut = Math.max(paragraph, line, space)
    const cut = preferredCut > 0 ? preferredCut : limit
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

export async function sendSlackMessage(
  token: string,
  channel: string,
  text: string,
  threadTs?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const chunks = splitSlackMessage(text)
  for (const chunk of chunks) {
    await call(token, 'chat.postMessage', {
      channel,
      text: chunk,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      unfurl_links: false,
      unfurl_media: false,
    }, fetchImpl)
  }
}
