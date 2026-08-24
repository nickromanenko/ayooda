import { validateRequest } from 'twilio'

/** Twilio signs the exact public URL followed by its sorted form parameters. */
export function verifyTwilioSignature(
  authToken: string,
  signature: string | undefined,
  publicUrl: string,
  params: Record<string, string>,
): boolean {
  if (!authToken || !signature || !publicUrl) return false
  try {
    return validateRequest(authToken, signature, publicUrl, params)
  } catch {
    return false
  }
}

export function formParams(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(raw)) result[key] = value
  return result
}
