import { describe, expect, test } from 'bun:test'
import { validateMcpServerInput } from './validate'

const valid = {
  name: 'Shopify MCP',
  url: 'https://mcp.shopify.example/mcp',
  transport: 'streamable-http',
  headers: [{ key: 'X-Env', value: 'prod' }],
  auth: { type: 'bearer', secret: 'sk_test' },
  enabled: true,
}

describe('validateMcpServerInput', () => {
  test('accepts a valid server', () => {
    const r = validateMcpServerInput(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.url).toBe('https://mcp.shopify.example/mcp')
      expect(r.value.transport).toBe('streamable-http')
      expect(r.value.auth.type).toBe('bearer')
      expect(r.value.secret).toBe('sk_test')
    }
  })

  test('defaults transport and enabled', () => {
    const r = validateMcpServerInput({ name: 'X', url: 'https://a.example/mcp', auth: { type: 'none' } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.transport).toBe('streamable-http')
      expect(r.value.enabled).toBe(true)
    }
  })

  test('rejects non-https URLs', () => {
    expect(validateMcpServerInput({ ...valid, url: 'http://a.example/mcp' }).ok).toBe(false)
  })

  test('rejects an invalid transport', () => {
    expect(validateMcpServerInput({ ...valid, transport: 'stdio' }).ok).toBe(false)
  })

  test('rejects header auth without a header name', () => {
    expect(validateMcpServerInput({ ...valid, auth: { type: 'header' } }).ok).toBe(false)
  })

  test('rejects managed MCP headers', () => {
    expect(validateMcpServerInput({ ...valid, headers: [{ key: 'Accept', value: 'x' }] }).ok).toBe(false)
  })
})
