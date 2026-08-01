/** True if an IP (v4 or v6 literal) must never be called: loopback, private,
 * link-local, unique-local, CGNAT, multicast/reserved. Unparseable → true (fail closed). */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase()
  if (addr.includes(':')) {
    if (addr === '::1' || addr === '::') return true
    const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mapped) return isBlockedAddress(mapped[1]!)
    if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true // fc00::/7 ULA
    if (/^fe[89ab][0-9a-f]:/.test(addr)) return true // fe80::/10 link-local
    return false
  }
  const parts = addr.split('.')
  if (parts.length !== 4) return true
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = nums as [number, number, number, number]
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // link-local incl. 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a >= 224) return true // multicast + reserved
  return false
}
