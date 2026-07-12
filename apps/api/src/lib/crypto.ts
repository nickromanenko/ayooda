import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/** 32-byte key derived from the configured secret (any length in, 32 bytes out). */
function key(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET
  if (!secret) throw new Error('API_KEY_ENCRYPTION_SECRET is not set')
  return createHash('sha256').update(secret).digest()
}

/** Encrypt to "v1:<iv b64>:<authTag b64>:<ciphertext b64>". */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

/** Decrypt a "v1:..." payload. Throws on tamper, wrong key, or malformed input. */
export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(':')
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed encrypted payload')
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}
