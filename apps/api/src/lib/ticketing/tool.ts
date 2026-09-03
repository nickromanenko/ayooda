import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { TicketingConfig } from '@ayooda/shared'
import { loadTicketingConfig, safeTicketingConfig } from './config'
import { createSupportTicket } from './service'

export function ticketingPrompt(config: TicketingConfig): string {
  const fields = config.fields.length
    ? config.fields.map((field) => `- ${field.label} (${field.id}, ${field.type}${field.required ? ', required' : ', optional'}): ${field.description || 'Collect this value from the customer.'}${field.options ? ` Allowed values: ${field.options.join(', ')}.` : ''}`).join('\n')
    : '- No custom fields are configured.'
  return `Support ticket intake is enabled. Offer a ticket only when the customer wants an issue recorded or followed up. Collect subject, description, priority, and these configured fields:\n${fields}\n${config.requireConfirmation ? 'Before calling submit_support_ticket, summarize the request and receive explicit customer confirmation. Set customerConfirmed=true only after they confirm.' : 'Customer confirmation is not required, but do not create tickets for ordinary questions.'}\nNever claim a ticket exists until the tool succeeds. Never request passwords, authentication codes, full payment-card details, or other secrets. After success, use the acknowledgement returned by the tool.`
}

export async function loadTicketingTool(input: { workspaceId: string; agentId: string; conversationId: string }): Promise<{ tools: ToolSet; instructions: string }> {
  const stored = await loadTicketingConfig(input.workspaceId, input.agentId)
  const config = safeTicketingConfig(stored)
  if (!config.enabled) return { tools: {}, instructions: '' }
  const tools: ToolSet = {
    submit_support_ticket: tool({
      description: 'Create one durable support ticket for this conversation after collecting all required fields and confirmation.',
      inputSchema: z.object({
        subject: z.string().min(1).max(160).describe('Concise ticket subject'),
        description: z.string().min(1).max(4000).describe('Complete problem description and requested outcome'),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
        customerConfirmed: z.boolean().describe('True only when the customer explicitly confirmed submission'),
        fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      }),
      execute: async (submission) => {
        try {
          const result = await createSupportTicket({ ...input, submission, createdBy: 'agent' })
          return { ok: true, ...result }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'Ticket could not be created.' }
        }
      },
    }),
  }
  return { tools, instructions: ticketingPrompt(config) }
}
