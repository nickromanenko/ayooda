import { generateObject } from 'ai'
import { z } from 'zod'
import type { ScoringConfig } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { registerSkill } from './registry'
import { SKILL_LLM_MODEL, type ConversationContext, type SkillModule } from './types'
import { createRuntimeLanguageModel } from '../llm/runtime'

const MAX_SUMMARY_CHARS = 500

export const DEFAULT_RUBRIC =
  'Grade how well the agent resolved the visitor\'s request. 5 = fully resolved, accurate and clear. ' +
  '3 = partially resolved, or correct but hard to follow. 1 = failed to help, was inaccurate, or ignored the question.'

export function buildScoringPrompt(rubric: string | undefined, transcript: string): string {
  return [
    'Score this customer-support conversation and summarise it for the business owner.',
    rubric?.trim() || DEFAULT_RUBRIC,
    `Write the summary in at most 2 sentences, under ${MAX_SUMMARY_CHARS} characters.`,
    `\n---\n${transcript}\n---`,
  ].join('\n\n')
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, Math.round(n)))
}

export const scoringSkill: SkillModule<ScoringConfig> = {
  id: 'scoring',

  async afterConversation(ctx: ConversationContext<ScoringConfig>) {
    const transcript = ctx.messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const { object } = await generateObject({
      model: createRuntimeLanguageModel(ctx.runtime, ctx.runtime.type === 'gateway' ? SKILL_LLM_MODEL : ctx.modelId),
      schema: z.object({ score: z.number(), summary: z.string() }),
      prompt: buildScoringPrompt(ctx.config.rubric, transcript),
    })
    await adminDb.doc(`workspaces/${ctx.workspaceId}/conversations/${ctx.conversationId}`).update({
      score: clampScore(object.score),
      summary: object.summary.trim().slice(0, MAX_SUMMARY_CHARS),
      scoredAt: new Date(),
    })
  },
}

registerSkill(scoringSkill)
