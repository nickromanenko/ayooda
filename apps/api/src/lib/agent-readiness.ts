export type ReadinessStatus = 'complete' | 'blocker' | 'recommended'

export type ReadinessItem = {
  id: 'configuration' | 'knowledge' | 'evaluation' | 'channel' | 'domains' | 'handoff'
  label: string
  description: string
  status: ReadinessStatus
  detail: string
  href: string
  action: string
  required: boolean
}

export type AgentReadinessInput = {
  agentId: string
  name: string
  systemPrompt: string
  llmModel: string
  runtimeConfigured: boolean
  knowledgeReady: number
  knowledgeTotal: number
  knowledgeIssues: number
  evaluationPassed: number
  evaluationTotal: number
  liveChannels: number
  configuredChannels: number
  widgetConfigured: boolean
  widgetInstalled: boolean
  widgetDomains: number
  handoffConfigured: boolean
}

export function buildAgentReadiness(input: AgentReadinessInput) {
  const base = `/dashboard/agents/${input.agentId}`
  const configurationComplete = Boolean(input.name.trim() && input.systemPrompt.trim() && input.llmModel.trim() && input.runtimeConfigured)
  const knowledgeComplete = input.knowledgeReady > 0 && input.knowledgeIssues === 0
  const evaluationComplete = input.evaluationTotal > 0 && input.evaluationPassed === input.evaluationTotal
  const channelComplete = input.liveChannels > 0
  const domainsRequired = input.widgetConfigured
  const domainsComplete = !domainsRequired || input.widgetDomains > 0

  const items: ReadinessItem[] = [
    {
      id: 'configuration', label: 'Agent configured', description: 'Identity, instructions, model, and runtime are available.',
      status: configurationComplete ? 'complete' : 'blocker',
      detail: configurationComplete ? 'The agent can generate responses.' : input.runtimeConfigured ? 'Complete the agent name, instructions, and model.' : 'Connect a model runtime before testing or deployment.',
      href: configurationComplete ? `${base}` : input.runtimeConfigured ? `${base}` : `${base}/security`,
      action: configurationComplete ? 'Review' : input.runtimeConfigured ? 'Complete setup' : 'Configure runtime', required: true,
    },
    {
      id: 'knowledge', label: 'Knowledge ready', description: 'At least one source is usable and no source has an indexing issue.',
      status: knowledgeComplete ? 'complete' : 'blocker',
      detail: input.knowledgeTotal === 0 ? 'No knowledge sources added.' : `${input.knowledgeReady}/${input.knowledgeTotal} sources ready${input.knowledgeIssues ? ` · ${input.knowledgeIssues} need attention` : ''}.`,
      href: `${base}/knowledge`, action: knowledgeComplete ? 'Review' : 'Fix knowledge', required: true,
    },
    {
      id: 'evaluation', label: 'Regression suite passing', description: 'Saved checks confirm answers and workflow behavior.',
      status: evaluationComplete ? 'complete' : 'blocker',
      detail: input.evaluationTotal === 0 ? 'No completed evaluation run yet.' : `${input.evaluationPassed}/${input.evaluationTotal} tests passed in the latest run.`,
      href: `${base}/test`, action: evaluationComplete ? 'View results' : 'Run tests', required: true,
    },
    {
      id: 'channel', label: 'Customer channel live', description: 'Customers have at least one active, reachable channel.',
      status: channelComplete ? 'complete' : 'blocker',
      detail: channelComplete ? `${input.liveChannels} live ${input.liveChannels === 1 ? 'channel' : 'channels'}.` : input.configuredChannels ? 'A channel is configured but not live yet.' : 'No customer channels connected.',
      href: `${base}/deploy#channels`, action: channelComplete ? 'Review channels' : 'Connect channel', required: true,
    },
    {
      id: 'domains', label: 'Widget embedding restricted', description: 'Only approved websites can load the widget.',
      status: domainsComplete ? 'complete' : 'blocker',
      detail: !input.widgetConfigured ? 'Applies when the website widget is enabled.' : input.widgetDomains ? `${input.widgetDomains} approved ${input.widgetDomains === 1 ? 'domain' : 'domains'}.` : 'Any website can currently embed this widget.',
      href: `${base}/deploy#website-widget`, action: domainsComplete ? 'Review' : 'Restrict domains', required: domainsRequired,
    },
    {
      id: 'handoff', label: 'Human fallback prepared', description: 'A workflow can route customers to a teammate when automation should stop.',
      status: input.handoffConfigured ? 'complete' : 'recommended',
      detail: input.handoffConfigured ? 'A handoff workflow is configured.' : 'Recommended before handling real customer traffic.',
      href: `${base}/escalation`, action: input.handoffConfigured ? 'Review workflow' : 'Add handoff', required: false,
    },
  ]
  const required = items.filter((item) => item.required)
  const completed = required.filter((item) => item.status === 'complete').length
  return {
    ready: completed === required.length,
    score: required.length ? Math.round(completed / required.length * 100) : 0,
    blockers: required.length - completed,
    completed,
    required: required.length,
    items,
  }
}
