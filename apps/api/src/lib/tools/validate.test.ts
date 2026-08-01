import { describe, expect, test } from 'bun:test'
import { validateToolInput } from './validate'

const base = {
  name: 'order_lookup',
  description: 'Look up an order by id',
  method: 'GET',
  urlTemplate: 'https://api.shop.com/orders/{orderId}',
  params: [{ name: 'orderId', type: 'string', description: 'the id', required: true }],
  headers: [],
  auth: { type: 'none' },
  kind: 'read',
}

describe('validateToolInput', () => {
  test('accepts a valid read tool', () => {
    const r = validateToolInput(base)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name).toBe('order_lookup')
      expect(r.value.writeEnabled).toBe(false)
      expect(r.value.enabled).toBe(true)
    }
  })
  test('rejects a non-https url', () => {
    const r = validateToolInput({ ...base, urlTemplate: 'http://api.shop.com/x' })
    expect(r.ok).toBe(false)
  })
  test('rejects a placeholder with no matching param', () => {
    const r = validateToolInput({ ...base, urlTemplate: 'https://x.com/{missing}' })
    expect(r.ok).toBe(false)
  })
  test('rejects a bad name', () => {
    expect(validateToolInput({ ...base, name: 'bad name!' }).ok).toBe(false)
  })
  test('rejects a duplicate param name', () => {
    const r = validateToolInput({ ...base, params: [base.params[0], base.params[0]], urlTemplate: 'https://x.com/' })
    expect(r.ok).toBe(false)
  })
  test('header auth requires headerName', () => {
    expect(validateToolInput({ ...base, auth: { type: 'header' } }).ok).toBe(false)
    expect(validateToolInput({ ...base, auth: { type: 'header', headerName: 'X-Key', secret: 's' } }).ok).toBe(true)
  })
  test('write tool carries writeEnabled through', () => {
    const r = validateToolInput({ ...base, method: 'POST', kind: 'write', writeEnabled: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.writeEnabled).toBe(true)
  })
  test('rejects a forbidden header key', () => {
    expect(validateToolInput({ ...base, headers: [{ key: 'Host', value: 'x' }] }).ok).toBe(false)
  })
})
