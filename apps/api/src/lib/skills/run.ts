import type { ToolSet } from 'ai'
import type { LoadedSkill } from './registry'
import type { SkillContext } from './types'

/** Every hook is isolated: a failing skill is logged and skipped, never fatal. */
export async function gatherContext(skills: LoadedSkill[], ctx: SkillContext<any>): Promise<string[]> {
  const results = await Promise.all(
    skills.map(async (s) => {
      if (!s.module.contributeContext) return null
      const span = ctx.trace.span({ name: `skill:${s.def.id}:context` })
      try {
        const block = await s.module.contributeContext({ ...ctx, config: s.config })
        span.end({ output: { chars: block?.length ?? 0 } })
        return block
      } catch (err) {
        console.warn(`[skills] ${s.def.id} contributeContext failed:`, err)
        span.end({ output: { error: true } })
        return null
      }
    }),
  )
  return results.filter((b): b is string => !!b)
}

export async function gatherTools(skills: LoadedSkill[], ctx: SkillContext<any>): Promise<ToolSet> {
  let out: ToolSet = {}
  for (const s of skills) {
    if (!s.module.contributeTools) continue
    try {
      out = { ...out, ...(await s.module.contributeTools({ ...ctx, config: s.config })) }
    } catch (err) {
      console.warn(`[skills] ${s.def.id} contributeTools failed:`, err)
    }
  }
  return out
}
