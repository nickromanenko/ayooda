import { describe, expect, test } from 'bun:test'
import { DEFAULT_TICKETING_CONFIG } from '@ayooda/shared'
import { ticketingPrompt } from './tool'

describe('ticketing agent guidance', () => {
  test('requires confirmation and forbids claiming success before the tool returns', () => {
    const prompt = ticketingPrompt({
      ...DEFAULT_TICKETING_CONFIG,
      enabled: true,
      fields: [{ id: 'order_id', label: 'Order ID', description: 'The order reference.', type: 'text', required: true }],
    })
    expect(prompt).toContain('explicit customer confirmation')
    expect(prompt).toContain('Order ID (order_id, text, required)')
    expect(prompt).toContain('Never claim a ticket exists until the tool succeeds')
    expect(prompt).toContain('Never request passwords')
  })
})
