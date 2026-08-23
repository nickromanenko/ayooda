import { describe, expect, test } from 'bun:test'
import { mcpToolName, mcpResultToString } from './tools'

describe('mcpToolName', () => {
  test('namespaces a tool under its server slug', () => {
    expect(mcpToolName('Shopify MCP', 'orders.refund')).toBe('mcp_shopify_mcp_orders.refund')
  })

  test('falls back for a slug-less name', () => {
    expect(mcpToolName('!!!', 'lookup')).toBe('mcp_server_lookup')
  })
})

describe('mcpResultToString', () => {
  test('joins text content blocks', () => {
    expect(mcpResultToString({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a\nb')
  })

  test('prefixes errors', () => {
    expect(mcpResultToString({ content: [{ type: 'text', text: 'boom' }], isError: true })).toBe('error: boom')
  })

  test('renders non-text blocks as placeholders', () => {
    expect(mcpResultToString({ content: [{ type: 'image', mimeType: 'image/png' }] })).toBe('[image: image/png]')
  })

  test('falls back to a marker when there is no content', () => {
    expect(mcpResultToString({})).toBe('(no output)')
  })
})
