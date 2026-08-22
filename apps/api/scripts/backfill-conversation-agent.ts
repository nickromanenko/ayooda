/**
 * One-time: attribute conversations that predate agent tagging.
 *
 * Conversations created before agentId was written carry no agent at all, so
 * they count towards the workspace total on the Overview but towards no agent's
 * Usage tab — a workspace reads "1 conversation" and its only agent reads "0".
 * Assign the orphans to the channel's agent where the channel still exists,
 * otherwise to the workspace default, which is who was answering at the time.
 *
 * Firestore cannot query for a missing field, so this scans conversations in
 * pages and filters in memory. Idempotent — a conversation that already has an
 * agentId is left alone.
 *
 * Run:      cd apps/api && set -a && source .env && set +a && bun run scripts/backfill-conversation-agent.ts
 * Dry run:  ... DRY=1 bun run scripts/backfill-conversation-agent.ts
 */
import { adminDb } from '../src/lib/firebase-admin'

const DRY = process.env.DRY === '1'
const PAGE = 300

async function defaultAgentId(wsId: string): Promise<string | null> {
  const snap = await adminDb
    .collection(`workspaces/${wsId}/agents`)
    .where('isDefault', '==', true)
    .limit(1)
    .get()
  if (!snap.empty) return snap.docs[0]!.id
  const any = await adminDb.collection(`workspaces/${wsId}/agents`).limit(1).get()
  return any.empty ? null : any.docs[0]!.id
}

async function channelAgents(wsId: string): Promise<Map<string, string>> {
  const snap = await adminDb.collection(`workspaces/${wsId}/channels`).get()
  const m = new Map<string, string>()
  for (const d of snap.docs) {
    const agentId = d.data().agentId
    if (typeof agentId === 'string') m.set(d.id, agentId)
  }
  return m
}

let scanned = 0
let fixed = 0
let skippedNoAgent = 0

const workspaces = await adminDb.collection('workspaces').get()
for (const ws of workspaces.docs) {
  const [fallback, byChannel] = await Promise.all([defaultAgentId(ws.id), channelAgents(ws.id)])

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  let wsFixed = 0
  for (;;) {
    let q = adminDb.collection(`workspaces/${ws.id}/conversations`).orderBy('__name__').limit(PAGE)
    if (cursor) q = q.startAfter(cursor)
    const page = await q.get()
    if (page.empty) break

    const batch = adminDb.batch()
    let pending = 0
    for (const doc of page.docs) {
      scanned++
      const data = doc.data()
      if (typeof data.agentId === 'string' && data.agentId) continue

      const target = byChannel.get(data.channelId as string) ?? fallback
      if (!target) { skippedNoAgent++; continue }

      if (!DRY) { batch.update(doc.ref, { agentId: target }); pending++ }
      fixed++; wsFixed++
    }
    if (pending) await batch.commit()

    cursor = page.docs[page.docs.length - 1]
    if (page.size < PAGE) break
  }

  if (wsFixed) console.log(`[conversations] ${ws.id.slice(0, 8)}…: attributed ${wsFixed}`)
}

console.log(
  `[conversations] ${DRY ? 'DRY RUN — ' : ''}scanned ${scanned}, ` +
  `attributed ${fixed}, skipped ${skippedNoAgent} (workspace has no agent)`,
)
process.exit(0)
