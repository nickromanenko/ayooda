/** Shape we read from a Stripe subscription object (item-level current_period_end per API 2026-06-24+). */
export interface StripeSubShape {
  status?: string
  current_period_end?: number // legacy (pre-2026-06-24) top-level fallback
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> }
}

/** Period end as a Date: item-level first (current API), then legacy top-level, else null. */
export function subscriptionPeriodEnd(sub: StripeSubShape): Date | null {
  const item = sub.items?.data?.[0]?.current_period_end
  const top = sub.current_period_end
  const secs = item ?? top
  return secs ? new Date(secs * 1000) : null
}

/** First price id on the subscription (for tier resolution). */
export function subscriptionPriceId(sub: StripeSubShape): string | undefined {
  return sub.items?.data?.[0]?.price?.id
}
