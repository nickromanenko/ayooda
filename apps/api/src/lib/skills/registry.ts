import {
  SKILLS,
  skillDef,
  meetsTier,
  validateSkillConfig,
  isSkillId,
  type PlanTier,
  type SkillConfig,
  type SkillDef,
  type SkillId,
} from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import type { SkillModule } from './types'

export interface SkillRow { id: string; enabled: boolean; config: unknown }
export interface LoadedSkill { def: SkillDef; module: SkillModule<any>; config: SkillConfig }

export type SkillModuleMap = Partial<Record<SkillId, SkillModule<any>>>

/** Populated by each skill module's own file via registerSkill(). */
export const SKILL_MODULES: SkillModuleMap = {}

export function registerSkill(module: SkillModule<any>): void {
  SKILL_MODULES[module.id] = module
}

/**
 * Pure selection: enabled + known + entitled + has a module, config validated with
 * fallback to the catalogue default, ordered by the SKILLS array so hook order is
 * deterministic regardless of Firestore's return order.
 */
export function selectSkills(
  rows: SkillRow[],
  tier: PlanTier | null,
  modules: SkillModuleMap,
): LoadedSkill[] {
  const byId = new Map<SkillId, LoadedSkill>()
  for (const r of rows) {
    if (!r.enabled || !isSkillId(r.id)) continue
    const def = skillDef(r.id)
    if (!def || !meetsTier(tier, def.minTier)) continue
    const module = modules[r.id]
    if (!module) continue
    const parsed = validateSkillConfig(r.id, r.config)
    const config = parsed.ok ? parsed.value : def.defaultConfig
    if (!parsed.ok) console.warn(`[skills] ${r.id}: invalid stored config, using default — ${parsed.error}`)
    byId.set(r.id, { def, module, config })
  }
  return SKILLS.map((d) => byId.get(d.id)).filter((s): s is LoadedSkill => !!s)
}

export async function loadEnabledSkills(
  workspaceId: string,
  agentId: string,
  tier: PlanTier | null,
): Promise<LoadedSkill[]> {
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/agents/${agentId}/skills`)
    .where('enabled', '==', true)
    .get()
  const rows: SkillRow[] = snap.docs.map((d) => ({
    id: d.id,
    enabled: d.data().enabled === true,
    config: d.data().config ?? {},
  }))
  return selectSkills(rows, tier, SKILL_MODULES)
}
