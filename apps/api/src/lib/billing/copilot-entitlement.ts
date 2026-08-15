import { planFor, TRIAL_COPILOT_CAP, type Subscription } from '@ayooda/shared'

/**
 * Copilot has its own allowance and never touches the customer-conversation
 * quota. Checked once per thread, when its first message is written.
 */
export function checkCopilotEntitlement({
  subscription,
  copilotPeriodCount,
}: {
  subscription: Subscription | undefined
  copilotPeriodCount: number | undefined
}): { entitled: boolean; cap: number } {
  const plan = planFor(subscription?.tier ?? null)
  const cap = plan?.copilotCap ?? TRIAL_COPILOT_CAP
  return { entitled: (copilotPeriodCount ?? 0) < cap, cap }
}
