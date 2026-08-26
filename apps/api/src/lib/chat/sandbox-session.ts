export const SANDBOX_MESSAGE_MAX = 5_000

export function sandboxSessionsPath(workspaceId: string, uid: string): string {
  return `workspaces/${workspaceId}/sandboxUsers/${uid}/sandboxSessions`
}

export function sandboxSessionPath(workspaceId: string, uid: string, sessionId: string): string {
  return `${sandboxSessionsPath(workspaceId, uid)}/${sessionId}`
}

export function isSandboxSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

type SandboxChat = {
  message: string
  sessionId?: string
  allowTools: boolean
}

export function validateSandboxChatBody(raw: unknown):
  | { ok: true; value: SandboxChat }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid request body.' }
  const body = raw as Record<string, unknown>
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return { ok: false, error: 'message is required.' }
  if (message.length > SANDBOX_MESSAGE_MAX) {
    return { ok: false, error: `message must be ${SANDBOX_MESSAGE_MAX.toLocaleString()} characters or fewer.` }
  }
  if (body.sessionId !== undefined && body.sessionId !== null && !isSandboxSessionId(body.sessionId)) {
    return { ok: false, error: 'Invalid sessionId.' }
  }
  if (body.allowTools !== undefined && typeof body.allowTools !== 'boolean') {
    return { ok: false, error: 'allowTools must be a boolean.' }
  }
  return {
    ok: true,
    value: {
      message,
      ...(body.sessionId ? { sessionId: body.sessionId as string } : {}),
      allowTools: body.allowTools === true,
    },
  }
}
