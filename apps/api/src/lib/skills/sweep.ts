import { timingSafeEqual } from 'node:crypto'
import type { PlanTier, VisitorMemoryFact } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { resolveGatewayKey } from '../llm/resolve'
import { liveFacts, nextExpiry } from './memory'
import { loadEnabledSkills } from './registry'
import './all'   // registers every skill module; without it the sweep silently skips scoring

export const IDLE_CLOSE_MINUTES = 30
export const SWEEP_BATCH = 100

export function idleCutoff(now: Date): Date {
  return new Date(now.getTime() - IDLE_CLOSE_MINUTES * 60_000)
}

/** Constant-time compare; an empty expected secret never matches, so an unset env var stays closed. */
export function secretMatches(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export function purgeFacts(
  facts: VisitorMemoryFact[],
  now: Date,
): { facts: VisitorMemoryFact[]; nextExpiryAt: Date | null } {
  const kept = liveFacts(facts, now)
  return { facts: kept, nextExpiryAt: nextExpiry(kept) }
}

export interface SweepReport { closed: number; scored: number; purged: number; failed: number }

export async function runSweep(now = new Date()): Promise<SweepReport> {
  const report: SweepReport = { closed: 0, scored: 0, purged: 0, failed: 0 }

  // 1. Close idle bot conversations.
  const idle = await adminDb
    .collectionGroup('conversations')
    .where('status', '==', 'bot')
    .where('updatedAt', '<', idleCutoff(now))
    .limit(SWEEP_BATCH)
    .get()
  for (const doc of idle.docs) {
    try {
      await doc.ref.update({ status: 'resolved', autoClosedAt: now, pendingPostProcess: true })
      report.closed++
    } catch (err) {
      console.warn('[sweep] close failed:', doc.ref.path, err)
      report.failed++
    }
  }

  // 2. Post-process everything flagged — auto-closed and operator-resolved alike.
  const pending = await adminDb
    .collectionGroup('conversations')
    .where('pendingPostProcess', '==', true)
    .limit(SWEEP_BATCH)
    .get()
  for (const doc of pending.docs) {
    try {
      await postProcess(doc)
      await doc.ref.update({ pendingPostProcess: false })
      report.scored++
    } catch (err) {
      // The flag stays set, so the next run retries this conversation.
      console.warn('[sweep] post-process failed:', doc.ref.path, err)
      report.failed++
    }
  }

  // 3. Purge expired memory.
  const stale = await adminDb
    .collectionGroup('visitorMemory')
    .where('nextExpiryAt', '<=', now)
    .limit(SWEEP_BATCH)
    .get()
  for (const doc of stale.docs) {
    try {
      const raw = (doc.data().facts ?? []) as Array<Record<string, any>>
      const facts: VisitorMemoryFact[] = raw.map((f) => ({
        id: String(f.id), text: String(f.text),
        createdAt: f.createdAt?.toDate?.() ?? new Date(f.createdAt),
        expiresAt: f.expiresAt?.toDate?.() ?? new Date(f.expiresAt),
      }))
      await doc.ref.update({ ...purgeFacts(facts, now), updatedAt: now })
      report.purged++
    } catch (err) {
      console.warn('[sweep] purge failed:', doc.ref.path, err)
      report.failed++
    }
  }

  return report
}

async function postProcess(doc: FirebaseFirestore.QueryDocumentSnapshot): Promise<void> {
  const data = doc.data()
  if (data.scoredAt) return               // already processed; never double-charge
  // workspaces/{ws}/conversations/{id}
  const workspaceId = doc.ref.parent.parent!.id
  const conversationId = doc.id

  const wsSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  const tier = (wsSnap.data()?.subscription?.tier as PlanTier | null | undefined) ?? null

  // Prefer the agent that actually served the conversation. Conversations created
  // before this feature shipped have no agentId — fall back to the default agent.
  const agentsCol = adminDb.collection(`workspaces/${workspaceId}/agents`)
  let agentDoc: FirebaseFirestore.DocumentSnapshot | null = null
  if (typeof data.agentId === 'string' && data.agentId) {
    const byId = await agentsCol.doc(data.agentId).get()
    if (byId.exists) agentDoc = byId
  }
  if (!agentDoc) {
    const defaultSnap = await agentsCol.where('isDefault', '==', true).limit(1).get()
    agentDoc = defaultSnap.empty ? null : defaultSnap.docs[0]!
  }
  if (!agentDoc) return

  const skills = (await loadEnabledSkills(workspaceId, agentDoc.id, tier))
    .filter((s) => !!s.module.afterConversation)
  if (skills.length === 0) return

  const key = resolveGatewayKey(agentDoc.data()?.gatewayKey)
  if (!key.ok) return

  const msgSnap = await doc.ref.collection('messages').orderBy('createdAt', 'asc').limit(50).get()
  const messages = msgSnap.docs.map((m) => ({
    role: String(m.data().role), content: String(m.data().content),
  }))
  if (messages.length === 0) return

  for (const s of skills) {
    try {
      await s.module.afterConversation!({
        workspaceId, agentId: agentDoc.id, conversationId,
        visitorId: String(data.visitorId ?? ''),
        messages, apiKey: key.apiKey, config: s.config,
      })
    } catch (err) {
      console.warn(`[sweep] ${s.def.id} afterConversation failed:`, doc.ref.path, err)
    }
  }
}
