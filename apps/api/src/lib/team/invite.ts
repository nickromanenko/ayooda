/** Normalize + minimally validate an invite email. Not RFC-perfect — just enough to catch obvious junk. */
export function normalizeInviteEmail(raw: string): { ok: true; email: string } | { ok: false; error: string } {
  const email = raw.trim().toLowerCase()
  if (email.length === 0) return { ok: false, error: 'Email is required' }
  if (email.length > 254) return { ok: false, error: 'Email is too long' }
  const at = email.indexOf('@')
  if (at <= 0 || at === email.length - 1 || email.indexOf('@', at + 1) !== -1) {
    return { ok: false, error: 'Enter a valid email address' }
  }
  if (!email.slice(at + 1).includes('.')) return { ok: false, error: 'Enter a valid email address' }
  return { ok: true, email }
}
