export function adminPageLimit(raw: string | undefined): number {
  const parsed = Number(raw ?? 25)
  if (!Number.isInteger(parsed) || parsed < 1) return 25
  return Math.min(parsed, 100)
}

export function encodeAdminCursor(documentId: string): string {
  return Buffer.from(JSON.stringify({ id: documentId }), 'utf8').toString('base64url')
}

export function decodeAdminCursor(raw: string | undefined): string | null {
  if (!raw || raw.length > 512) return null
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { id?: unknown }
    return typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value.id) ? value.id : null
  } catch {
    return null
  }
}

export function normalizedAdminQuery(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase().slice(0, 100)
}
