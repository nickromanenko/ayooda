import { meetsTier, MIN_BRANDING_TIER, type PlanTier } from '@ayooda/shared'

/**
 * Whether a workspace may hide the "Powered by Ayooda" line.
 *
 * Checked when the setting is saved AND again every time the widget asks for
 * its config, so a workspace that downgrades or lapses gets the line back
 * without anything having to rewrite its stored setting.
 *
 * Deliberately strict: only a live paid plan at or above MIN_BRANDING_TIER
 * qualifies. A trial, a cancelled plan or a missing subscription does not.
 */
export function canHideBranding(subscription: unknown): boolean {
  if (!subscription || typeof subscription !== 'object') return false
  const sub = subscription as { status?: unknown; tier?: unknown }
  // past_due is a grace period on an existing paid plan, so it still qualifies.
  if (sub.status !== 'active' && sub.status !== 'past_due') return false
  return meetsTier((sub.tier as PlanTier | null) ?? null, MIN_BRANDING_TIER)
}
