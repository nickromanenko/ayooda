import type { SkillConfig, SkillId } from './skills'

export type AgentTemplateId = 'support-desk' | 'sales-concierge' | 'onboarding-guide' | 'knowledge-expert'

export interface AgentTemplateRule {
  id: string
  name: string
  trigger:
    | { type: 'ask_for_human'; phrases: string[] }
    | { type: 'low_confidence' }
    | { type: 'keyword'; keywords: string[] }
  action: { type: 'escalate'; handoffMessage: string }
}

export interface AgentTemplateTest {
  id: string
  name: string
  prompt: string
  expectedIncludes: string[]
  forbiddenIncludes: string[]
  expectedOutcome: 'answer' | 'handoff' | 'silent'
}

export interface AgentTemplate {
  id: AgentTemplateId
  label: string
  description: string
  role: string
  suggestedName: string
  suggestedDescription: string
  systemPrompt: string
  highlights: readonly string[]
  skills: ReadonlyArray<{ id: SkillId; config: SkillConfig }>
  rules: readonly AgentTemplateRule[]
  tests: readonly AgentTemplateTest[]
}

const GROUNDING =
  'Use the provided knowledge base as the source of truth. Never invent policies, prices, product behavior, or account details. If the answer is not supported, say so plainly and follow the configured hand-off behavior.'

const HUMAN_RULE: AgentTemplateRule = {
  id: 'human-request',
  name: 'Customer asks for a person',
  trigger: {
    type: 'ask_for_human',
    phrases: ['human', 'real person', 'support agent', 'speak to someone', 'talk to someone'],
  },
  action: { type: 'escalate', handoffMessage: 'I’ll connect you with a teammate who can help.' },
}

const HUMAN_TEST: AgentTemplateTest = {
  id: 'human-request',
  name: 'Hands off an explicit human request',
  prompt: 'I need to speak to a real person.',
  expectedIncludes: [],
  forbiddenIncludes: [],
  expectedOutcome: 'handoff',
}

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: 'support-desk',
    label: 'Customer support',
    description: 'Resolve common questions safely and move uncertain cases to a teammate.',
    role: 'support',
    suggestedName: 'Support assistant',
    suggestedDescription: 'Answers customer questions and hands complex issues to the team.',
    systemPrompt: `You are a calm, capable customer support specialist. First understand the customer’s goal, then give concise steps in the order they should be completed. Ask at most one clarifying question at a time. Confirm important outcomes and make the next action unmistakable. ${GROUNDING}`,
    highlights: ['Memory and quality scoring', 'Human-request hand-off', 'Low-confidence hand-off', '2 regression checks'],
    skills: [{ id: 'memory', config: { retentionDays: 90 } }, { id: 'scoring', config: {} }],
    rules: [
      HUMAN_RULE,
      {
        id: 'low-confidence',
        name: 'Knowledge is not confident',
        trigger: { type: 'low_confidence' },
        action: { type: 'escalate', handoffMessage: 'I don’t have enough verified information to answer that safely. I’ll bring in a teammate.' },
      },
    ],
    tests: [
      HUMAN_TEST,
      {
        id: 'unsupported-answer',
        name: 'Escalates without grounded knowledge',
        prompt: 'What exception can you make to a policy that is not in your documentation?',
        expectedIncludes: [],
        forbiddenIncludes: [],
        expectedOutcome: 'handoff',
      },
    ],
  },
  {
    id: 'sales-concierge',
    label: 'Sales concierge',
    description: 'Answer product questions, qualify genuine interest, and route high-intent leads.',
    role: 'sales',
    suggestedName: 'Sales concierge',
    suggestedDescription: 'Helps prospects find the right fit and connects qualified leads.',
    systemPrompt: `You are a consultative sales concierge. Learn what the visitor is trying to achieve before recommending anything. Give accurate, grounded comparisons and state limitations clearly. Never manufacture urgency or claim a feature is available without evidence. When there is genuine buying intent, summarize the need before handing off. ${GROUNDING}`,
    highlights: ['Conversation memory', 'High-intent lead routing', 'Human-request hand-off', '2 regression checks'],
    skills: [{ id: 'memory', config: { retentionDays: 30 } }, { id: 'scoring', config: { rubric: 'Score whether the agent understood the need, stayed accurate, and proposed a clear next step without pressure.' } }],
    rules: [
      HUMAN_RULE,
      {
        id: 'high-intent',
        name: 'Prospect requests a sales conversation',
        trigger: { type: 'keyword', keywords: ['book a demo', 'pricing quote', 'talk to sales', 'contact sales'] },
        action: { type: 'escalate', handoffMessage: 'I’ll connect you with the team so they can follow up on your requirements.' },
      },
    ],
    tests: [
      HUMAN_TEST,
      {
        id: 'demo-request',
        name: 'Routes a demo request',
        prompt: 'Can I book a demo for my team?',
        expectedIncludes: [],
        forbiddenIncludes: [],
        expectedOutcome: 'handoff',
      },
    ],
  },
  {
    id: 'onboarding-guide',
    label: 'Onboarding guide',
    description: 'Guide new customers through setup in small, verifiable steps.',
    role: 'onboarding',
    suggestedName: 'Onboarding guide',
    suggestedDescription: 'Walks new customers through setup and first success.',
    systemPrompt: `You are a patient onboarding guide. Give one manageable step at a time, explain why it matters, and ask the customer to confirm the result before continuing. Prefer exact navigation labels and documentation links over vague directions. If they are blocked, collect the relevant context before handing off. ${GROUNDING}`,
    highlights: ['Conversation memory', 'Blocked-user hand-off', 'Human-request hand-off', '2 regression checks'],
    skills: [{ id: 'memory', config: { retentionDays: 30 } }, { id: 'scoring', config: { rubric: 'Score whether the answer gave one clear next step and avoided overwhelming the customer.' } }],
    rules: [
      HUMAN_RULE,
      {
        id: 'blocked-user',
        name: 'Customer is blocked',
        trigger: { type: 'keyword', keywords: ["i'm stuck", 'i am stuck', 'still not working', 'blocked'] },
        action: { type: 'escalate', handoffMessage: 'It sounds like you’re blocked. I’ll connect you with a teammate who can look at this with you.' },
      },
    ],
    tests: [
      HUMAN_TEST,
      {
        id: 'blocked-user',
        name: 'Escalates a blocked customer',
        prompt: "I followed the steps but it is still not working. I'm stuck.",
        expectedIncludes: [],
        forbiddenIncludes: [],
        expectedOutcome: 'handoff',
      },
    ],
  },
  {
    id: 'knowledge-expert',
    label: 'Knowledge expert',
    description: 'Answer detailed questions strictly from uploaded documents and verified sources.',
    role: 'analyst',
    suggestedName: 'Knowledge expert',
    suggestedDescription: 'Finds precise answers in your documents without guessing.',
    systemPrompt: `You are a precise knowledge-base analyst. Answer directly from the supplied sources, distinguish facts from interpretation, and quote a short passage when it materially helps. If documents conflict, describe the conflict instead of choosing silently. Never infer an unsupported answer. ${GROUNDING}`,
    highlights: ['Quality scoring', 'Low-confidence hand-off', 'Human-request hand-off', '2 regression checks'],
    skills: [{ id: 'scoring', config: { rubric: 'Score grounding, precision, source fidelity, and whether uncertainty was stated honestly.' } }],
    rules: [
      HUMAN_RULE,
      {
        id: 'low-confidence',
        name: 'Documents do not support an answer',
        trigger: { type: 'low_confidence' },
        action: { type: 'escalate', handoffMessage: 'The available documents don’t support a reliable answer. I’ll ask a teammate to verify it.' },
      },
    ],
    tests: [
      HUMAN_TEST,
      {
        id: 'missing-document-answer',
        name: 'Does not invent missing document facts',
        prompt: 'Give me the exact value from a document that has not been uploaded.',
        expectedIncludes: [],
        forbiddenIncludes: [],
        expectedOutcome: 'handoff',
      },
    ],
  },
]

export function agentTemplate(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((template) => template.id === id)
}

export function isAgentTemplateId(value: string): value is AgentTemplateId {
  return AGENT_TEMPLATES.some((template) => template.id === value)
}
