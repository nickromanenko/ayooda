/**
 * In-memory sliding-window rate limiter.
 * Per-instance only (Cloud Run may run several instances → effective limit scales
 * with instance count). Adequate for abuse protection on public endpoints.
 */

const buckets = new Map<string, number[]>()
let lastSweep = 0

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { ok: boolean; retryAfterMs: number } {
  // Periodic sweep: evict keys with no live timestamps
  if (now - lastSweep >= windowMs) {
    lastSweep = now
    for (const [k, ts] of buckets) {
      const live = ts.filter((t) => t > now - windowMs)
      if (live.length === 0) buckets.delete(k)
      else buckets.set(k, live)
    }
  }

  const cutoff = now - windowMs
  const times = (buckets.get(key) ?? []).filter((t) => t > cutoff)

  if (times.length >= limit) {
    const oldest = times[0]
    buckets.set(key, times)
    return { ok: false, retryAfterMs: oldest + windowMs - now }
  }

  times.push(now)
  buckets.set(key, times)
  return { ok: true, retryAfterMs: 0 }
}

/** Test-only: clear all buckets between cases. */
export function __resetRateLimit(): void {
  buckets.clear()
  lastSweep = 0
}

/** Test-only: get current bucket count. */
export function __bucketCount(): number {
  return buckets.size
}
