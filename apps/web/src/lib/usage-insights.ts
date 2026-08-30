export type UsageInsight = {
  id: string
  level: 'urgent' | 'warning' | 'opportunity' | 'positive'
  title: string
  detail: string
  action: string
  href: string
}

export type UsageInsightInput = {
  agentId: string
  conversations: { total: number; resolved: number; waiting: number }
  automationRate: number | null
  handoffs: { total: number; causes: Array<{ reason: string; count: number; percentage: number }> }
  confidence: { average: number | null; lowRate: number | null; count: number; threshold: number }
  csat: { average: number | null; count: number }
  timing: { firstReply: { averageMs: number | null; count: number } }
  knowledge: { docs: number; indexed: number }
  workspace: { periodConversations: number; includedCap: number }
}

export function buildUsageInsights(input: UsageInsightInput): UsageInsight[] {
  const base = `/dashboard/agents/${input.agentId}`
  const insights: UsageInsight[] = []
  if (input.conversations.waiting > 0) insights.push({
    id: 'waiting', level: 'urgent', title: `${input.conversations.waiting} ${input.conversations.waiting === 1 ? 'customer is' : 'customers are'} waiting`,
    detail: 'Human attention is required in the inbox now.', action: 'Open inbox', href: `/dashboard/inbox?agentId=${input.agentId}&status=waiting`,
  })
  if (input.conversations.total === 0) return [{
    id: 'launch', level: 'opportunity', title: 'Start collecting real performance data',
    detail: 'Deploy this agent to a customer channel. Insights will appear as conversations accumulate.', action: 'Review deployment', href: `${base}/deploy`,
  }]
  if (input.knowledge.docs === 0 || input.knowledge.indexed < input.knowledge.docs) insights.push({
    id: 'knowledge-health', level: 'warning', title: input.knowledge.docs === 0 ? 'The agent has no indexed knowledge' : 'Some knowledge sources are unavailable',
    detail: input.knowledge.docs === 0 ? 'Add trusted sources before relying on customer answers.' : `${input.knowledge.indexed}/${input.knowledge.docs} sources are indexed. Resolve the remaining sources.`,
    action: 'Fix knowledge', href: `${base}/knowledge`,
  })
  if (input.confidence.count >= 5 && (input.confidence.lowRate ?? 0) >= 25) insights.push({
    id: 'low-confidence', level: 'warning', title: `${input.confidence.lowRate}% of responses have weak knowledge support`,
    detail: `Review recurring customer questions and add coverage for answers below the ${input.confidence.threshold}% threshold.`, action: 'Improve knowledge', href: `${base}/knowledge`,
  })
  if (input.csat.count >= 5 && input.csat.average !== null && input.csat.average < 4) insights.push({
    id: 'csat', level: 'warning', title: `Customer satisfaction is ${input.csat.average.toFixed(1)} out of 5`,
    detail: 'Use failed or low-scoring conversations to add regression tests before changing instructions.', action: 'Open test suite', href: `${base}/test`,
  })
  if (input.conversations.resolved >= 5 && input.automationRate !== null && input.automationRate < 60) insights.push({
    id: 'automation', level: 'opportunity', title: `Automation is resolving ${input.automationRate}% of conversations`,
    detail: 'Review handoff causes to find requests the agent could safely handle with better knowledge or workflows.', action: 'Review workflows', href: `${base}/escalation`,
  })
  const topCause = input.handoffs.causes[0]
  if (input.handoffs.total >= 3 && topCause && topCause.percentage >= 30) insights.push({
    id: 'handoff-cause', level: 'opportunity', title: `“${topCause.reason}” drives ${topCause.percentage}% of handoffs`,
    detail: `${topCause.count} conversations followed this path. Decide whether it needs better automation or a clearer escalation rule.`, action: 'Tune workflow', href: `${base}/escalation`,
  })
  if (input.timing.firstReply.count >= 5 && (input.timing.firstReply.averageMs ?? 0) > 30_000) insights.push({
    id: 'response-time', level: 'warning', title: 'First replies average more than 30 seconds',
    detail: 'Test model latency and connected tools; slow external actions can delay every first response.', action: 'Test agent', href: `${base}/test`,
  })
  const planShare = input.workspace.includedCap > 0 ? input.workspace.periodConversations / input.workspace.includedCap * 100 : 0
  if (planShare >= 80) insights.push({
    id: 'plan', level: planShare >= 100 ? 'urgent' : 'warning', title: `${Math.round(planShare)}% of the included conversation allowance is used`,
    detail: 'Review the workspace plan before customer traffic is interrupted or billed as overage.', action: 'Manage plan', href: '/dashboard/billing',
  })
  if (!insights.length) insights.push({
    id: 'healthy', level: 'positive', title: 'No immediate performance issues detected',
    detail: 'Keep the regression suite current and review this page as more customer data arrives.', action: 'Review tests', href: `${base}/test`,
  })
  const priority = { urgent: 0, warning: 1, opportunity: 2, positive: 3 }
  return insights.sort((a, b) => priority[a.level] - priority[b.level]).slice(0, 4)
}
