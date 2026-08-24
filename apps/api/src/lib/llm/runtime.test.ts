import { describe, expect, test } from 'bun:test'
import { assertCustomRuntimeUrl } from './runtime'

describe('custom runtime URL confinement', () => {
  test('allows only paths beneath the configured API prefix', () => {
    expect(assertCustomRuntimeUrl('https://models.example.com/v1', 'https://models.example.com/v1/chat/completions').pathname)
      .toBe('/v1/chat/completions')
    expect(() => assertCustomRuntimeUrl('https://models.example.com/v1', 'https://models.example.com/other')).toThrow('escaped')
    expect(() => assertCustomRuntimeUrl('https://models.example.com/v1', 'https://attacker.example/v1/chat/completions')).toThrow('escaped')
  })
})
