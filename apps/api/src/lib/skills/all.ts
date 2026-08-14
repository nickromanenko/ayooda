/**
 * Importing a skill module runs its registerSkill() side effect. Every entry point
 * that reads SKILL_MODULES — the turn and the sweep — imports this barrel, so
 * registration has one owner. Without it, selectSkills silently skips the skill.
 */
import './memory'
import './scoring'
import './web-search'
