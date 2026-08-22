/**
 * One-time migration: reparent escalation rules from the workspace onto its
 * default agent — workspaces/{ws}/workflowRules → workspaces/{ws}/agents/{default}/workflowRules.
 *
 * Escalation is agent behaviour, so the rules now live under the agent that
 * applies them. Existing rules go to the default agent, which is the one that
 * was answering when they were written.
 *
 * Idempotent — skips a workspace whose default agent already has rules, and
 * leaves the originals in place until the copy has been verified. Re-run with
 * PURGE=1 to delete the old workspace-level collection afterwards.
 *
 * Run: cd apps/api && set -a && source .env && set +a && bun run scripts/migrate-workflow-rules.ts
 */
import { adminDb } from '../src/lib/firebase-admin'

const PURGE = process.env.PURGE === '1'

async function migrateWorkspace(wsId: string): Promise<'skipped' | 'empty' | 'migrated' | 'no-agent'> {
  const legacy = await adminDb.collection(`workspaces/${wsId}/workflowRules`).get()
  if (legacy.empty) return 'empty'

  const agentsSnap = await adminDb
    .collection(`workspaces/${wsId}/agents`)
    .where('isDefault', '==', true)
    .limit(1)
    .get()
  if (agentsSnap.empty) return 'no-agent'
  const agentRef = agentsSnap.docs[0]!.ref

  const target = agentRef.collection('workflowRules')
  const existing = await target.limit(1).get()
  if (!existing.empty) {
    if (PURGE) {
      for (const d of legacy.docs) await d.ref.delete()
      console.log(`[workflows] ${wsId}: purged ${legacy.size} legacy rule(s)`)
    }
    return 'skipped'
  }

  for (const d of legacy.docs) {
    await target.doc(d.id).set(d.data())
  }
  console.log(`[workflows] ${wsId}: copied ${legacy.size} rule(s) → agents/${agentRef.id}`)

  if (PURGE) {
    for (const d of legacy.docs) await d.ref.delete()
    console.log(`[workflows] ${wsId}: purged ${legacy.size} legacy rule(s)`)
  }

  return 'migrated'
}

const workspaces = await adminDb.collection('workspaces').get()
const tally = { skipped: 0, empty: 0, migrated: 0, 'no-agent': 0 }

for (const ws of workspaces.docs) {
  try {
    tally[await migrateWorkspace(ws.id)]++
  } catch (err) {
    console.error(`[workflows] ${ws.id}: FAILED —`, err)
  }
}

console.log(
  `[workflows] done — ${tally.migrated} migrated, ${tally.skipped} already had rules, ` +
  `${tally.empty} had none, ${tally['no-agent']} had no default agent`,
)
if (!PURGE) console.log('[workflows] originals kept. Re-run with PURGE=1 once you have verified the copy.')
process.exit(0)
