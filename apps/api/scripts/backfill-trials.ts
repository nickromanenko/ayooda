/**
 * One-time: grant existing (pre-billing) workspaces a fresh 14-day trial so the
 * hard gate doesn't cut them off on deploy. Run manually:
 *   cd apps/api && set -a && source .env && set +a && bun run scripts/backfill-trials.ts
 */
import { adminDb } from '../src/lib/firebase-admin'
import { TRIAL_DAYS } from '@ayooda/shared'

const snap = await adminDb.collection('workspaces').get()
const now = new Date()
let updated = 0
for (const doc of snap.docs) {
  if (doc.data().subscription) continue // already has billing state
  await doc.ref.update({
    subscription: {
      status: 'trialing',
      tier: null,
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
    'usage.periodConversationCount': 0,
    'usage.periodStart': now,
  })
  updated++
}
console.log(`Backfilled ${updated} workspace(s).`)
process.exit(0)
