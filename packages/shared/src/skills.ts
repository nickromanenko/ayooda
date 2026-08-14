import type { PlanTier } from './plans'

export type SkillId = 'memory' | 'scoring' | 'web_search'

export interface MemoryConfig { retentionDays: number }
export interface ScoringConfig { rubric?: string }
export interface WebSearchConfig { maxResults: number }
export type SkillConfig = MemoryConfig | ScoringConfig | WebSearchConfig

export interface SkillDef {
  id: SkillId
  label: string
  description: string
  defaultConfig: SkillConfig
  minTier: PlanTier | null   // null = available on every plan, including trial
}

export const SKILLS: readonly SkillDef[] = [
  {
    id: 'memory',
    label: 'Memory',
    description:
      'Remembers facts about a visitor — their name, account or an unresolved issue — and recalls them the next time they get in touch.',
    defaultConfig: { retentionDays: 90 } as MemoryConfig,
    minTier: null,
  },
  {
    id: 'scoring',
    label: 'Scoring',
    description:
      'Scores each finished conversation from 1 to 5 and writes a short summary, so you can spot where the agent struggled.',
    defaultConfig: {} as ScoringConfig,
    minTier: null,
  },
  {
    id: 'web_search',
    label: 'Web Search',
    description:
      'Lets the agent search the public web when an answer is not in its knowledge base.',
    defaultConfig: { maxResults: 3 } as WebSearchConfig,
    minTier: 'core',
  },
]

const SKILL_IDS: readonly string[] = SKILLS.map((s) => s.id)

export function isSkillId(v: string): v is SkillId {
  return SKILL_IDS.includes(v)
}

export function skillDef(id: string): SkillDef | undefined {
  return SKILLS.find((s) => s.id === id)
}

/** Trial (tier null) ranks 0, below every paid plan. */
const TIER_RANK: Record<PlanTier, number> = { lite: 1, core: 2, max: 3 }
const rank = (t: PlanTier | null): number => (t ? TIER_RANK[t] : 0)

export function meetsTier(current: PlanTier | null, min: PlanTier | null): boolean {
  return rank(current) >= rank(min)
}

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })

function intInRange(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) return null
  return v
}

export function validateSkillConfig(
  id: SkillId,
  raw: unknown,
): { ok: true; value: SkillConfig } | Fail {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('Config must be an object.')
  }
  const o = raw as Record<string, unknown>

  if (id === 'memory') {
    const days = o.retentionDays === undefined ? 90 : intInRange(o.retentionDays, 1, 365)
    if (days === null) return fail('Retention must be a whole number of days between 1 and 365.')
    return { ok: true, value: { retentionDays: days } }
  }

  if (id === 'scoring') {
    if (o.rubric === undefined) return { ok: true, value: {} }
    if (typeof o.rubric !== 'string') return fail('Rubric must be text.')
    const rubric = o.rubric.trim()
    if (rubric.length > 2000) return fail('Rubric must be 2000 characters or fewer.')
    return { ok: true, value: rubric ? { rubric } : {} }
  }

  const maxResults = o.maxResults === undefined ? 3 : intInRange(o.maxResults, 1, 5)
  if (maxResults === null) return fail('Max results must be a whole number between 1 and 5.')
  return { ok: true, value: { maxResults } }
}
