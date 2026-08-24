import { generateObject } from 'ai'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { MemoryConfig, VisitorMemoryFact } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { registerSkill } from './registry'
import { SKILL_LLM_MODEL, type ConversationContext, type SkillContext, type SkillModule } from './types'
import { createRuntimeLanguageModel } from '../llm/runtime'

export const MAX_FACTS = 20
const MAX_NEW_FACTS = 3
const MAX_FACT_CHARS = 200

export function liveFacts(facts: VisitorMemoryFact[], now: Date): VisitorMemoryFact[] {
  return facts.filter((f) => f.expiresAt.getTime() > now.getTime())
}

export function formatMemoryBlock(facts: VisitorMemoryFact[]): string | null {
  if (facts.length === 0) return null
  return [
    'What you remember about this visitor from previous conversations:',
    ...facts.map((f) => `- ${f.text}`),
  ].join('\n')
}

export function mergeFacts(
  existing: VisitorMemoryFact[],
  incoming: string[],
  now: Date,
  retentionDays: number,
  idFor: (i: number) => string = () => randomUUID(),
): VisitorMemoryFact[] {
  const seen = new Set(existing.map((f) => f.text.trim().toLowerCase()))
  const expiresAt = new Date(now.getTime() + retentionDays * 86_400_000)
  const added: VisitorMemoryFact[] = []
  incoming.forEach((raw, i) => {
    const text = raw.trim().slice(0, MAX_FACT_CHARS)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) return
    seen.add(key)
    added.push({ id: idFor(i), text, createdAt: now, expiresAt })
  })
  const all = [...existing, ...added]
  if (all.length <= MAX_FACTS) return all
  return [...all].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(all.length - MAX_FACTS)
}

export function nextExpiry(facts: VisitorMemoryFact[]): Date | null {
  if (facts.length === 0) return null
  return facts.reduce((min, f) => (f.expiresAt < min ? f.expiresAt : min), facts[0]!.expiresAt)
}

const memoryDoc = (ws: string, visitorId: string) =>
  adminDb.doc(`workspaces/${ws}/visitorMemory/${visitorId}`)

/** Firestore returns Timestamps; normalise to Date. */
function toFacts(raw: unknown): VisitorMemoryFact[] {
  if (!Array.isArray(raw)) return []
  return raw.map((f) => ({
    id: String(f.id),
    text: String(f.text),
    createdAt: f.createdAt?.toDate?.() ?? new Date(f.createdAt),
    expiresAt: f.expiresAt?.toDate?.() ?? new Date(f.expiresAt),
  }))
}

export const memorySkill: SkillModule<MemoryConfig> = {
  id: 'memory',

  async contributeContext(ctx: SkillContext<MemoryConfig>) {
    const snap = await memoryDoc(ctx.workspaceId, ctx.visitorId).get()
    if (!snap.exists) return null
    return formatMemoryBlock(liveFacts(toFacts(snap.data()!.facts), new Date()))
  },

  async afterConversation(ctx: ConversationContext<MemoryConfig>) {
    const transcript = ctx.messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const { object } = await generateObject({
      model: createRuntimeLanguageModel(ctx.runtime, ctx.runtime.type === 'gateway' ? SKILL_LLM_MODEL : ctx.modelId),
      schema: z.object({ facts: z.array(z.string()).max(MAX_NEW_FACTS) }),
      prompt:
        `Extract at most ${MAX_NEW_FACTS} durable facts about the visitor from this support conversation. ` +
        `Include identity, account details, stated preferences and unresolved issues. ` +
        `Ignore small talk, anything about the agent, and anything true only during this conversation. ` +
        `Each fact must stand alone in under ${MAX_FACT_CHARS} characters. Return an empty array if there is nothing durable.` +
        `\n\n---\n${transcript}\n---`,
    })
    if (object.facts.length === 0) return

    const ref = memoryDoc(ctx.workspaceId, ctx.visitorId)
    const snap = await ref.get()
    const now = new Date()
    const existing = liveFacts(toFacts(snap.data()?.facts), now)
    const facts = mergeFacts(existing, object.facts, now, ctx.config.retentionDays)
    await ref.set({ facts, nextExpiryAt: nextExpiry(facts), updatedAt: now })
  },
}

registerSkill(memorySkill)
