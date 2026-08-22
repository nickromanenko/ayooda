/**
 * One-time: seed usage counters on agents created before per-agent tracking.
 *
 * Message and token counts only accrue forward, so `trackedSince` records when
 * they started — that lets the Usage tab say "since 3 March" instead of showing
 * a zero that reads like a bug. Conversation counts are derived from the
 * conversations collection and need no backfill.
 *
 * Idempotent — skips any agent that already has usage.trackedSince.
 *
 * Run: cd apps/api && set -a && source .env && set +a && bun run scripts/backfill-agent-usage.ts
 */
import { adminDb } from '../src/lib/firebase-admin'

const now = new Date()
let seeded = 0
let skipped = 0

const workspaces = await adminDb.collection('workspaces').get()
for (const ws of workspaces.docs) {
  const agents = await ws.ref.collection('agents').get()
  for (const a of agents.docs) {
    if (a.data().usage?.trackedSince) { skipped++; continue }
    await a.ref.update({
      'usage.messageCount': a.data().usage?.messageCount ?? 0,
      'usage.tokenCount': a.data().usage?.tokenCount ?? 0,
      'usage.trackedSince': now,
    })
    seeded++
    console.log(`[agent-usage] ${ws.id.slice(0, 8)}…/${a.id.slice(0, 8)}… seeded`)
  }
}

console.log(`[agent-usage] done — ${seeded} seeded, ${skipped} already tracked`)
process.exit(0)
