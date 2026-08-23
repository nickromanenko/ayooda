import type { WorkflowTrigger, WorkflowRule, EscalationContext } from '@ayooda/shared'

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => Number(n))
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Local weekday (0–6) + minutes-since-midnight for `now` in `timezone`. Throws on a bad timezone. */
function localParts(now: Date, timezone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return { day: DAY_INDEX[weekday] ?? 0, minutes: hour * 60 + minute }
}

export function matchesTrigger(trigger: WorkflowTrigger, ctx: EscalationContext): boolean {
  switch (trigger.type) {
    case 'ask_for_human':
      return trigger.phrases.some((p) => p.trim() && ctx.messageLower.includes(p.toLowerCase()))
    case 'keyword':
      return trigger.keywords.some((k) => k.trim() && ctx.messageLower.includes(k.toLowerCase()))
    case 'low_confidence':
      return ctx.sourceCount === 0
    case 'bot_replies':
      return ctx.botReplyCount >= trigger.count
    case 'off_hours': {
      try {
        const { day, minutes } = localParts(ctx.now, trigger.timezone)
        const open = trigger.days.includes(day) && minutes >= toMinutes(trigger.start) && minutes < toMinutes(trigger.end)
        return !open
      } catch {
        return false // bad timezone → never fire
      }
    }
    default:
      return false
  }
}

export function evaluateRules(rules: WorkflowRule[], ctx: EscalationContext): WorkflowRule | null {
  return evaluateWorkflow(rules, ctx)[0] ?? null
}

/**
 * Return matching rules in execution order. A reply action may opt into the
 * next matching rule; every other action is terminal for the current turn.
 * Legacy escalation rules therefore keep their original first-match behavior.
 */
export function evaluateWorkflow(rules: WorkflowRule[], ctx: EscalationContext): WorkflowRule[] {
  const ordered = rules.filter((r) => r.enabled).sort((a, b) => a.order - b.order)
  const matches: WorkflowRule[] = []
  for (const rule of ordered) {
    if (!matchesTrigger(rule.trigger, ctx)) continue
    matches.push(rule)
    if (rule.action.type !== 'reply' || !rule.action.continue) break
  }
  return matches
}
