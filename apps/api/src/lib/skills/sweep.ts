import { timingSafeEqual } from 'node:crypto'
import {
  KNOWLEDGE_SYNC_LEASE_MINUTES,
  isKnowledgeSyncInterval,
  knowledgeSyncLeaseUntil,
  knowledgeSyncRetryAt,
  type PlanTier,
  type VisitorMemoryFact,
} from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { triggerIngestion } from '../scraper'
import { resolveGatewayKey } from '../llm/resolve'
import { liveFacts, nextExpiry } from './memory'
import { loadEnabledSkills } from './registry'
import { elapsedMs } from '../analytics/timing'
import './all'   // registers every skill module; without it the sweep silently skips scoring

export const IDLE_CLOSE_MINUTES = 30
export const IDLE_LOOKBACK_HOURS = 24
export const SWEEP_BATCH = 100

export function idleCutoff(now: Date): Date {
  return new Date(now.getTime() - IDLE_CLOSE_MINUTES * 60_000)
}

/**
 * Lower bound for the idle-close query. Without it the query matches every historical `bot`
 * conversation in the database, so the first run would resolve the entire backlog 100 at a
 * time — visible in every customer's inbox — and flag it all for LLM post-processing.
 * Conversations that predate this feature are never picked up, by design.
 */
export function idleFloor(now: Date): Date {
  return new Date(now.getTime() - IDLE_LOOKBACK_HOURS * 60 * 60_000)
}

/** Constant-time compare; an empty expected secret never matches, so an unset env var stays closed. */
export function secretMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false
  // Compare BYTE length, not string length — a multi-byte character can have the same
  // string .length as a single-byte one but a different Buffer length, and timingSafeEqual
  // throws (not returns false) when its two buffers differ in byte length.
  const providedBuf = Buffer.from(provided)
  const expectedBuf = Buffer.from(expected)
  if (providedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(providedBuf, expectedBuf)
}

export function purgeFacts(
  facts: VisitorMemoryFact[],
  now: Date,
): { facts: VisitorMemoryFact[]; nextExpiryAt: Date | null } {
  const kept = liveFacts(facts, now)
  return { facts: kept, nextExpiryAt: nextExpiry(kept) }
}

export interface SweepReport { closed: number; scored: number; purged: number; synced: number; failed: number }

type DateLike = Date | { toDate?: () => Date } | null | undefined

function asDate(value: DateLike): Date | null {
  if (value instanceof Date) return value
  return value?.toDate?.() ?? null
}

export function isKnowledgeSyncClaimable(data: Record<string, any>, now: Date): boolean {
  if (data.type !== 'webpage' || data.autoSyncEnabled !== true || !isKnowledgeSyncInterval(data.syncIntervalHours)) {
    return false
  }
  const dueAt = asDate(data.nextSyncAt)
  if (!dueAt || dueAt.getTime() > now.getTime()) return false

  if (data.status === 'pending' || data.status === 'processing') {
    const startedAt = asDate(data.syncStartedAt)
    if (!startedAt) return false
    const leaseMs = KNOWLEDGE_SYNC_LEASE_MINUTES * 60_000
    return startedAt.getTime() + leaseMs <= now.getTime()
  }
  return true
}

export async function runSweep(now = new Date()): Promise<SweepReport> {
  const report: SweepReport = { closed: 0, scored: 0, purged: 0, synced: 0, failed: 0 }

  // 1. Close idle bot conversations. The query itself (not just each document update) is
  // wrapped so a transient failure — e.g. the composite index still building right after
  // a fresh `firebase deploy --only firestore:indexes` — can't take down the other phases.
  try {
    const idle = await adminDb
      .collectionGroup('conversations')
      .where('status', '==', 'bot')
      .where('updatedAt', '<', idleCutoff(now))
      // Bounded below so only recently-active conversations are considered; the existing
      // `status ASC, updatedAt ASC` composite index already covers this range predicate.
      .where('updatedAt', '>', idleFloor(now))
      .limit(SWEEP_BATCH)
      .get()
    for (const doc of idle.docs) {
      try {
        const data = doc.data()
        const resolutionMs = data.timingTrackedAt ? elapsedMs(data.createdAt, now) : null
        await doc.ref.update({
          status: 'resolved', autoClosedAt: now, pendingPostProcess: true,
          ...(resolutionMs !== null ? { resolvedAt: now, resolutionMs } : {}),
        })
        report.closed++
      } catch (err) {
        console.warn('[sweep] close failed:', doc.ref.path, err)
        report.failed++
      }
    }
  } catch (err) {
    console.warn('[sweep] idle-close query failed:', err)
    report.failed++
  }

  // 2. Post-process everything flagged — auto-closed and operator-resolved alike.
  try {
    const pending = await adminDb
      .collectionGroup('conversations')
      .where('pendingPostProcess', '==', true)
      .limit(SWEEP_BATCH)
      .get()
    for (const doc of pending.docs) {
      try {
        const { hookFailed } = await postProcess(doc)
        // Stamp postProcessedAt regardless of which skills ran (or whether any are enabled):
        // the marker's job is to make this conversation idempotent, independent of whether the
        // scoring skill (the only one that writes scoredAt) happened to run. Without it, a
        // memory-only agent whose flag-clearing update keeps failing would re-run fact
        // extraction — and re-charge the LLM — on every single sweep, forever.
        await doc.ref.update({ pendingPostProcess: false, postProcessedAt: now })
        if (hookFailed) report.failed++
        else report.scored++
      } catch (err) {
        // The flag stays set, so the next run retries this conversation.
        console.warn('[sweep] post-process failed:', doc.ref.path, err)
        report.failed++
      }
    }
  } catch (err) {
    console.warn('[sweep] pending-post-process query failed:', err)
    report.failed++
  }

  // 3. Purge expired memory.
  try {
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
  } catch (err) {
    console.warn('[sweep] purge query failed:', err)
    report.failed++
  }

  // 4. Refresh due webpage knowledge. A transaction claims each source and writes a
  // one-hour lease before the external job is launched, preventing overlapping sweeps
  // from starting duplicate crawls while allowing abandoned jobs to be recovered.
  try {
    const due = await adminDb
      .collectionGroup('knowledge')
      .where('autoSyncEnabled', '==', true)
      .where('nextSyncAt', '<=', now)
      .limit(SWEEP_BATCH)
      .get()

    for (const doc of due.docs) {
      try {
        const source = await adminDb.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref)
          if (!fresh.exists || !isKnowledgeSyncClaimable(fresh.data()!, now)) return null
          const url = fresh.data()!.source
          if (typeof url !== 'string' || !url) return null
          tx.update(doc.ref, {
            status: 'pending',
            chunkCount: 0,
            errorMessage: null,
            syncError: null,
            syncStartedAt: now,
            nextSyncAt: knowledgeSyncLeaseUntil(now),
          })
          return url
        })
        if (!source) continue

        // workspaces/{workspaceId}/agents/{agentId}/knowledge/{docId}
        const agentRef = doc.ref.parent.parent
        const workspaceRef = agentRef?.parent.parent
        if (!agentRef || !workspaceRef) throw new Error(`Unexpected knowledge path: ${doc.ref.path}`)
        const agentSnap = await agentRef.get()
        if (!agentSnap.exists) throw new Error(`Agent not found for ${doc.ref.path}`)
        const namespace = String(agentSnap.data()?.knowledgeNamespace ?? `ws_${workspaceRef.id}`)

        await triggerIngestion({
          workspaceId: workspaceRef.id,
          agentId: agentRef.id,
          docId: doc.id,
          docType: 'webpage',
          url: source,
          namespace,
        })
        report.synced++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[sweep] knowledge sync failed:', doc.ref.path, err)
        await adminDb.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref)
          if (!fresh.exists) return
          const data = fresh.data()!
          const failures = Math.max(0, Number(data.syncFailures) || 0) + 1
          tx.update(doc.ref, {
            status: 'error',
            errorMessage: message,
            syncError: message,
            syncFailures: failures,
            syncStartedAt: null,
            nextSyncAt: data.autoSyncEnabled === true && isKnowledgeSyncInterval(data.syncIntervalHours)
              ? knowledgeSyncRetryAt(now, failures)
              : null,
          })
        }).catch(() => {})
        report.failed++
      }
    }
  } catch (err) {
    console.warn('[sweep] knowledge-sync query failed:', err)
    report.failed++
  }

  return report
}

async function postProcess(doc: FirebaseFirestore.QueryDocumentSnapshot): Promise<{ hookFailed: boolean }> {
  const data = doc.data()
  // Already processed — scoredAt (written only by the scoring skill) is honoured for
  // conversations processed before postProcessedAt existed; postProcessedAt is the
  // skill-agnostic marker that makes this idempotent even when no skill writes its own flag.
  if (data.scoredAt || data.postProcessedAt) return { hookFailed: false }
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
  if (!agentDoc) return { hookFailed: false }

  const skills = (await loadEnabledSkills(workspaceId, agentDoc.id, tier))
    .filter((s) => !!s.module.afterConversation)
  if (skills.length === 0) return { hookFailed: false }

  const key = resolveGatewayKey(agentDoc.data()?.gatewayKey)
  if (!key.ok) return { hookFailed: false }

  const msgSnap = await doc.ref.collection('messages').orderBy('createdAt', 'asc').limit(50).get()
  const messages = msgSnap.docs.map((m) => ({
    role: String(m.data().role), content: String(m.data().content),
  }))
  if (messages.length === 0) return { hookFailed: false }

  let hookFailed = false
  for (const s of skills) {
    try {
      await s.module.afterConversation!({
        workspaceId, agentId: agentDoc.id, conversationId,
        visitorId: String(data.visitorId ?? ''),
        messages, apiKey: key.apiKey, config: s.config,
      })
    } catch (err) {
      // Kept isolated per skill so one failing hook doesn't block another, but surfaced to
      // the caller so the sweep report counts this conversation as failed, not scored.
      console.warn(`[sweep] ${s.def.id} afterConversation failed:`, doc.ref.path, err)
      hookFailed = true
    }
  }
  return { hookFailed }
}
