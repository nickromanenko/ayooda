/**
 * One-time migration: create a default agent per workspace and reparent
 * knowledge + tools under it; tag channels with the default agent id.
 * Idempotent — skips workspaces that already have an `agents` subcollection.
 *
 * Run: bun run apps/api/scripts/migrate-agents.ts
 */
import { adminDb } from '../src/lib/firebase-admin'

async function migrateWorkspace(wsId: string, wsData: FirebaseFirestore.DocumentData): Promise<'skipped' | 'migrated'> {
  const agentsCol = adminDb.collection(`workspaces/${wsId}/agents`)
  const existing = await agentsCol.limit(1).get()
  if (!existing.empty) return 'skipped'

  const now = new Date()
  const inline = wsData.agent ?? {}
  const agentRef = agentsCol.doc()
  const agent: Record<string, unknown> = {
    name: inline.name ?? 'Support Agent',
    photoURL: inline.photoURL ?? null,
    description: inline.description ?? '',
    systemPrompt: inline.systemPrompt ?? 'You are a helpful customer support agent. Answer questions based on the provided context.',
    llmModel: inline.llmModel ?? 'google/gemini-2.5-flash',
    knowledgeNamespace: `ws_${wsId}`,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  }
  if (wsData.openRouterKey) agent.openRouterKey = wsData.openRouterKey
  await agentRef.set(agent)

  // Reparent knowledge
  const knowledge = await adminDb.collection(`workspaces/${wsId}/knowledge`).get()
  for (const d of knowledge.docs) {
    await agentRef.collection('knowledge').doc(d.id).set(d.data())
    await d.ref.delete()
  }

  // Reparent tools
  const tools = await adminDb.collection(`workspaces/${wsId}/tools`).get()
  for (const d of tools.docs) {
    await agentRef.collection('tools').doc(d.id).set(d.data())
    await d.ref.delete()
  }

  // Tag channels
  const channels = await adminDb.collection(`workspaces/${wsId}/channels`).get()
  for (const d of channels.docs) await d.ref.update({ agentId: agentRef.id })

  return 'migrated'
}

async function main() {
  const workspaces = await adminDb.collection('workspaces').get()
  let migrated = 0, skipped = 0
  for (const ws of workspaces.docs) {
    const result = await migrateWorkspace(ws.id, ws.data())
    if (result === 'migrated') { migrated++; console.log(`[migrate] ${ws.id}: migrated`) }
    else { skipped++ }
  }
  console.log(`[migrate] done — migrated ${migrated}, skipped ${skipped}`)
  process.exit(0)
}

main().catch((err) => { console.error('[migrate] failed:', err); process.exit(1) })
